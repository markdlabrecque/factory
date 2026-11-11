// One scheduler tick (`factory schedule tick`, run by factory-tick.service; see commands/schedule.mts). Visits the
// registered projects one after another, in registry order (rotating the first project is #34), and runs one
// dispatcher pass (the project's own `.sandcastle/dispatch.sh`, as `factory dispatch` does) for each project that
// scheduleBlocker() clears: scheduler on, project opted in and not paused, checkout present and on its saved branch.
// The switches are read again before every project, so pausing takes effect from the next project on. A skipped
// project is logged with the reason. There is no pass timeout. Admission is the dispatcher's own three-slot cap,
// counted across every project from the shared board including launches not yet started (#32).
// One tick per user: a lock file holding the tick's pid; a live holder makes a second tick log and skip, a dead
// holder's lock is taken over. An aborted tick (SIGTERM from `systemctl stop`) stops its current pass and visits
// no more projects; runs already launched are detached and keep going. Output goes to stdout (the journal);
// bounded timing history is #36.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { Paths } from './paths.mts';
import { scaffoldName } from './paths.mts';
import { readRegistry } from './projects.mts';
import type { Project } from './projects.mts';
import { runStateDir } from './runs.mts';
import { currentBranch, readScheduler, scheduleBlocker } from './schedule.mts';
/** Runs one pass for a project; resolves to its exit code. Must stop the pass when `signal` aborts. */
export type Pass = (project: Project, script: string, signal: AbortSignal) => Promise<number>;
export type TickOptions = { pass?: Pass; log?: (line: string) => void; signal?: AbortSignal; now?: () => number };
export type TickResult = { result: 'done' | 'busy' | 'off' | 'interrupted'; passes: string[]; skipped: Record<string, string> };

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/** Takes the per-user tick lock; the pid of the live tick holding it otherwise. */
function lock(p: Paths): number | null {
  mkdirSync(dirname(p.tickLock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(p.tickLock, 'wx', 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(readFileSync(p.tickLock, 'utf8').trim());
      if (pid > 0 && alive(pid)) return pid;
      rmSync(p.tickLock, { force: true });
    }
  }
  throw new Error(`Couldn't take the scheduler lock ${p.tickLock}`);
}

/** The default pass: the project's dispatch.sh from its root, against the shared run-state folder. */
export const dispatchPass = (p: Paths): Pass => (project, script, signal) => new Promise((done, fail) => {
  const child = spawn(script, [], { cwd: project.root, stdio: 'inherit', env: { ...process.env, SANDCASTLE_STATE_DIR: runStateDir(p) } });
  const stop = () => child.kill('SIGTERM');
  signal.addEventListener('abort', stop, { once: true });
  child.on('error', fail);
  child.on('exit', (code, sig) => { signal.removeEventListener('abort', stop); done(code ?? (sig ? 128 : 1)); });
});

export async function tick(p: Paths, o: TickOptions = {}): Promise<TickResult> {
  const log = o.log ?? (line => console.log(line));
  const now = o.now ?? Date.now;
  const signal = o.signal ?? new AbortController().signal;
  const pass = o.pass ?? dispatchPass(p);
  const secs = (from: number) => `${Math.round((now() - from) / 1000)}s`;
  const out: TickResult = { result: 'done', passes: [], skipped: {} };
  const holder = lock(p);
  if (holder) { log(`tick skipped: another tick is running (pid ${holder})`); return { ...out, result: 'busy' }; }
  const started = now();
  try {
    if (!readScheduler(p).enabled) { log('tick skipped: scheduler is off'); return { ...out, result: 'off' }; }
    log('tick start');
    for (const { root } of readRegistry(p).projects) {
      if (signal.aborted) break;
      // Read again for each project: a switch flipped during the tick applies from here on.
      const global = readScheduler(p);
      const project = readRegistry(p).projects.find(x => x.root === root);
      if (!project) continue;
      const exists = existsSync(root);
      const script = join(root, scaffoldName, 'dispatch.sh');
      const reason = scheduleBlocker(global, project, exists, exists ? currentBranch(root) : null)
        ?? (existsSync(script) ? null : `no ${scaffoldName}/dispatch.sh`);
      if (reason) { log(`skip ${project.name}: ${reason}`); out.skipped[project.name] = reason; continue; }
      const from = now();
      log(`pass ${project.name} (${project.schedule!.branch}): start`);
      let code: number | string;
      try { code = await pass(project, script, signal); } catch (e) { code = (e as Error).message; }
      log(`pass ${project.name}: ${typeof code === 'number' ? `exit ${code}` : `failed: ${code}`} after ${secs(from)}${signal.aborted ? ' (interrupted)' : ''}`);
      out.passes.push(project.name);
    }
    if (signal.aborted) { log(`tick interrupted after ${secs(started)}`); return { ...out, result: 'interrupted' }; }
    log(`tick end: ${out.passes.length} passes, ${Object.keys(out.skipped).length} skipped, ${secs(started)}`);
    return out;
  } finally { rmSync(p.tickLock, { force: true }); }
}
