// Cancelling the scheduler's active tick. Used by `schedule off`, `uninstall` and reinstall (after the timer is
// disabled and stopped, so nothing new can start) and by the tick itself when it gets SIGTERM/SIGINT.
// What it may signal: the recorded tick process and the recorded dispatcher pass group, both owned by the tick lock
// (tick-lock.mts), and nothing else. Never a name match, never every Node or agent process, never a shared slice or
// cgroup. Ticket runs the dispatcher detached are in their own process groups and are not touched.
// Cancellation has its own deadline, and it is not a pass timeout: a pass that is running normally is never signalled.
// Once cancellation starts, the owned group gets SIGTERM and DEFAULT_GRACE_MS to exit, then SIGKILL (to that group
// only) and CONFIRM_MS to disappear. A tick asked to stop is given the group's whole deadline plus a margin before
// it too is killed. If anything owned is still alive after that, cancelTick throws and the lock and runtime files
// stay so a retry still knows what to cancel. Once confirmed, markInterrupted records any pass or tick that never wrote
// its own end as `interrupted` in state.json and the timing history.
import { reclaimDeadLock, groupAlive, ownGroup, passAlive, readLock, sameProcess } from './tick-lock.mts';
import type { ProcRef } from './tick-lock.mts';
import { markInterrupted } from './schedule-state.mts';
import type { Paths } from './paths.mts';
export const DEFAULT_GRACE_MS = 30_000;
export const CONFIRM_MS = 5_000;
export type CancelOptions = {
  graceMs?: number; confirmMs?: number; pollMs?: number;
  /** Signal sender; tests inject one that fails or does nothing. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};
export type GroupOutcome = { confirmed: boolean; escalated: boolean };
const defaults = (o: CancelOptions) => ({
  graceMs: o.graceMs ?? DEFAULT_GRACE_MS, confirmMs: o.confirmMs ?? CONFIRM_MS, pollMs: o.pollMs ?? 50,
  kill: o.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal)),
  sleep: o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms))), now: o.now ?? Date.now,
});
async function until(done: () => boolean, ms: number, d: ReturnType<typeof defaults>): Promise<boolean> {
  const end = d.now() + ms;
  while (!done()) { if (d.now() >= end) return false; await d.sleep(d.pollMs); }
  return true;
}
/** Signals a process group; true when it exists. Refuses group ids that are not a dedicated group. */
function sendGroup(pgid: number, signal: NodeJS.Signals, d: ReturnType<typeof defaults>): void {
  if (!Number.isInteger(pgid) || pgid <= 1 || pgid === ownGroup()) throw new Error(`Refusing to signal process group ${pgid}: not a dispatcher group Factory owns.`);
  try { d.kill(-pgid, signal); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
}

/** SIGTERM an owned dispatcher group, then SIGKILL it after the grace period. The group is the pass's pid. */
export async function terminateGroup(pgid: number, o: CancelOptions = {}): Promise<GroupOutcome> {
  const d = defaults(o);
  const gone = () => !groupAlive(pgid);
  if (gone()) return { confirmed: true, escalated: false };
  sendGroup(pgid, 'SIGTERM', d);
  if (await until(gone, d.graceMs, d)) return { confirmed: true, escalated: false };
  sendGroup(pgid, 'SIGKILL', d);
  return { confirmed: await until(gone, d.confirmMs, d), escalated: true };
}

export type CancelResult = { active: boolean; escalated: boolean };
/** Cancels the active tick and its dispatcher pass, and waits until both are gone. Returns whether one was active.
 *  Throws, leaving the lock in place, when it cannot confirm. */
export async function cancelTick(p: Paths, o: CancelOptions = {}): Promise<CancelResult> {
  const d = defaults(o);
  let info = readLock(p);
  if (!info) return { active: false, escalated: false };
  let active = false, escalated = false;
  const tick: ProcRef = info.tick;
  if (sameProcess(tick)) {
    active = true;
    if (tick.pid === process.pid) throw new Error('Refusing to cancel the current process as a tick.');
    d.kill(tick.pid, 'SIGTERM');
    // The tick stops its own pass on SIGTERM; give it that whole deadline plus a margin before killing it.
    const exited = await until(() => !sameProcess(tick), d.graceMs + d.confirmMs + 2000, d);
    if (!exited) {
      escalated = true;
      d.kill(tick.pid, 'SIGKILL');
      if (!await until(() => !sameProcess(tick), d.confirmMs, d)) throw new Error(`The scheduler tick (pid ${tick.pid}) did not exit after SIGKILL. Scheduler files are kept; retry once it is gone.`);
    }
    info = readLock(p) ?? info;
  }
  if (info.pass && passAlive(info.pass)) {
    active = true;
    const r = await terminateGroup(info.pass.pid, o);
    escalated ||= r.escalated;
    if (!r.confirmed) throw new Error(`The dispatcher pass (process group ${info.pass.pid}, project ${info.pass.root}) is still running after SIGTERM and SIGKILL. Scheduler files are kept; retry once it is gone.`);
  }
  const reclaim = reclaimDeadLock(p);
  if (reclaim.busy) throw new Error(`Couldn't confirm the tick is cancelled: ${reclaim.busy}.`);
  if (reclaim.reclaimed || active) markInterrupted(p, 'cancelled');
  return { active, escalated };
}
