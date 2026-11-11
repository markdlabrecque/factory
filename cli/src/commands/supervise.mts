// The macOS scheduler's supervisor: the internal command `factory supervise`, run by the com.factory.tick launch agent
// (platform/scheduler-launchd.mts; not for people to type). launchd has no completion-relative timer, so the supervisor
// keeps the cadence itself: it waits FIRST_DELAY_MS (one minute) after it starts, runs one tick (commands/tick.mts, in
// this process), then waits INTERVAL_MS (five minutes) after that tick finished, and so on. Ticks never overlap and
// missed ones are not replayed. There is no tick or pass timeout. The tick asks launchd itself, before its lock, after it
// and before every project, whether the agent is enabled and running, so a disabled label means no work; the supervisor
// keeps no on/off state, file or restart marker of its own. A tick that fails or throws is logged and the cadence goes on.
// SIGTERM or SIGINT (what `launchctl bootout` sends after `factory schedule off` disabled the label) aborts: a wait ends
// at once and no further tick starts; a running tick cancels its dispatcher pass group (tick-cancel.mts), starts no later
// project and records the pass `interrupted`. The supervisor then exits 0, so KeepAlive (restart after failure only)
// never brings it back. If the pass group could not be confirmed gone, the tick lock keeps it recorded and `schedule off`
// reports the failure. Ticket runs the dispatcher detached are in their own process groups and keep going. Output is
// timestamped lines on stdout, which launchd writes to <state>/scheduler/tick.log.
import { setTimeout as delay } from 'node:timers/promises';
import type { Paths } from '../paths.mts';
import type { ScheduleBackend } from '../platform/scheduler.mts';
import { tick } from './tick.mts';
import type { TickOptions, TickResult } from './tick.mts';
export const FIRST_DELAY_MS = 60_000;
export const INTERVAL_MS = 300_000;
export type SuperviseOptions = Omit<TickOptions, 'signal' | 'log'> & {
  signal: AbortSignal; log?: (line: string) => void; firstDelayMs?: number; intervalMs?: number;
  /** Resolves true after `ms`, false as soon as `signal` aborts. Tests inject one. */
  wait?: (ms: number, signal: AbortSignal) => Promise<boolean>;
  /** The tick; tests inject one. */
  tick?: (p: Paths, o: TickOptions) => Promise<TickResult>;
};
const sleep = async (ms: number, signal: AbortSignal) => {
  try { await delay(ms, undefined, { signal }); return true; } catch { return false; }
};
/** Runs ticks until `signal` aborts; resolves to the exit code, 0. */
export async function supervise(p: Paths, o: SuperviseOptions): Promise<number> {
  const log = o.log ?? (line => console.log(`${new Date().toISOString()} ${line}`));
  const wait = o.wait ?? sleep;
  const run = o.tick ?? tick;
  const { signal } = o;
  log(`supervisor start (pid ${process.pid}): first tick in ${Math.round((o.firstDelayMs ?? FIRST_DELAY_MS) / 1000)}s`);
  let next = o.firstDelayMs ?? FIRST_DELAY_MS;
  while (!signal.aborted && await wait(next, signal) && !signal.aborted) {
    try {
      const r = await run(p, { ...o, log, signal });
      log(`tick ${r.result}`);
    } catch (e) { log(`tick failed: ${(e as Error).message}`); }
    next = o.intervalMs ?? INTERVAL_MS;
  }
  log('supervisor stopping: cancelled; no further tick');
  return 0;
}
/** What the launch agent runs: SIGTERM/SIGINT abort the supervisor. */
export async function superviseProcess(p: Paths, backend: ScheduleBackend, o: Partial<SuperviseOptions> = {}): Promise<number> {
  const abort = new AbortController();
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => abort.abort());
  return supervise(p, { ...o, backend, signal: abort.signal });
}
