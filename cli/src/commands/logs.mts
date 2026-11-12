// `factory logs [ticket] [-f]`: print a run's log file (`.sandcastle/logs/run-<n>.log`, written by dispatch.mts) for
// the project picked by runs.mts. Without a ticket, the project's most recently written run log. `-f` keeps printing
// what is appended (and starts over if the file is truncated) until interrupted. Read-only; reads no journalctl.
// `--recovery` (#62) shows repair logs instead: `.sandcastle/logs/recover-<n>.log`, appended by every recovery attempt on
// the ticket (recovery-run.mts), or the project's most recently written one without a ticket.
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Paths } from '../paths.mts';
import { recoveryLog, resolveProject, runLog, ticketId } from '../runs.mts';

export type LogsOptions = {
  project?: string; cwd?: string; follow?: boolean; recovery?: boolean;
  /** Test hooks: where output goes, how often -f polls, and what stops -f. */
  write?: (chunk: Buffer) => Promise<void> | void; pollMs?: number; signal?: AbortSignal;
};

const toStdout = (chunk: Buffer) => new Promise<void>(done => process.stdout.write(chunk, () => done()));

/** The newest `<prefix>-<n>.log` by modification time, or undefined when the project has none. */
function latestLog(dir: string, prefix: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir).filter(f => new RegExp(`^${prefix}-\\d+\\.log$`).test(f)).map(f => join(dir, f))
    .map(f => ({ f, t: statSync(f).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
}

export async function logs(p: Paths, ticket: string | undefined, options: LogsOptions = {}) {
  const ctx = resolveProject(p, options);
  const dir = join(ctx.scaffold, 'logs');
  const kind = options.recovery ? 'recovery' : 'run';
  let file: string;
  if (ticket !== undefined) {
    file = (options.recovery ? recoveryLog : runLog)(ctx, ticket);
    if (!existsSync(file)) throw new Error(`No ${options.recovery ? 'recovery ' : ''}log for #${ticketId(ticket)} in ${ctx.name} yet: ${file}`);
  } else {
    const latest = latestLog(dir, options.recovery ? 'recover' : 'run');
    if (!latest) throw new Error(`No ${kind} logs in ${ctx.name} yet (${dir}).`);
    file = latest;
    console.error(`factory: latest ${kind} log: ${file}`);
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
