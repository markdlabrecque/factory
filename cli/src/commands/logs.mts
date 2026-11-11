// `factory logs [ticket] [-f]`: print a run's log file (`.sandcastle/logs/run-<n>.log`, written by dispatch.mts) for
// the project picked by runs.mts. Without a ticket, the project's most recently written run log. `-f` keeps printing
// what is appended (and starts over if the file is truncated) until interrupted. Read-only; reads no journalctl.
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Paths } from '../paths.mts';
import { resolveProject, runLog, ticketId } from '../runs.mts';

export type LogsOptions = {
  project?: string; cwd?: string; follow?: boolean;
  /** Test hooks: where output goes, how often -f polls, and what stops -f. */
  write?: (chunk: Buffer) => Promise<void> | void; pollMs?: number; signal?: AbortSignal;
};

const toStdout = (chunk: Buffer) => new Promise<void>(done => process.stdout.write(chunk, () => done()));

/** The newest `run-<n>.log` by modification time, or undefined when the project has none. */
function latestLog(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir).filter(f => /^run-\d+\.log$/.test(f)).map(f => join(dir, f))
    .map(f => ({ f, t: statSync(f).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
}

export async function logs(p: Paths, ticket: string | undefined, options: LogsOptions = {}) {
  const ctx = resolveProject(p, options);
  const dir = join(ctx.scaffold, 'logs');
  let file: string;
  if (ticket !== undefined) {
    file = runLog(ctx, ticket);
    if (!existsSync(file)) throw new Error(`No log for #${ticketId(ticket)} in ${ctx.name} yet: ${file}`);
  } else {
    const latest = latestLog(dir);
    if (!latest) throw new Error(`No run logs in ${ctx.name} yet (${dir}).`);
    file = latest;
    console.error(`factory: latest run log: ${file}`);
  }
  const write = options.write ?? toStdout;
  const fd = openSync(file, 'r');
  try {
    let offset = 0;
    const drain = async () => {
      const size = fstatSync(fd).size;
      if (size < offset) offset = 0; // truncated or rewritten: start over
      const buf = Buffer.alloc(64 * 1024);
      while (offset < size) {
        const n = readSync(fd, buf, 0, Math.min(buf.length, size - offset), offset);
        if (!n) break;
        offset += n;
        await write(Buffer.from(buf.subarray(0, n)));
      }
    };
    await drain();
    if (!options.follow) return;
    for (;;) {
      try { await sleep(options.pollMs ?? 500, undefined, { signal: options.signal }); } catch { return; }
      await drain();
    }
  } finally { closeSync(fd); }
}
