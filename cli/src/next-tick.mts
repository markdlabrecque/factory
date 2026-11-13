// When the macOS supervisor's next tick is due, for the Board's timer strip. launchd has no timer to ask, so the supervisor
// (commands/supervise.mts) saves `<state>/scheduler/next-tick.json`, `{version:1, pid, startTicks, at}`, before each wait and
// removes it when the wait ends (a tick starts) and when it stops. It is a display hint, never a switch: nothing schedules from
// it. A reader trusts it only while the recorded supervisor process is still that process (pid plus start time where known), so
// a file a crashed supervisor left behind is ignored. Writes are temp-file + rename and best effort; a missing, malformed or
// stale file means the time is unknown.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Paths } from './paths.mts';
import { procRef, sameProcess } from './tick-lock.mts';

/** Records that this process's next tick is due at `at` (epoch ms), or clears the record when `at` is null. */
export function writeNextTick(p: Paths, at: number | null): void {
  if (at === null) { rmSync(p.nextTick, { force: true }); return; }
  mkdirSync(dirname(p.nextTick), { recursive: true });
  const temp = `${p.nextTick}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, ...procRef(process.pid), at: new Date(at).toISOString() }) + '\n', { mode: 0o600 });
    renameSync(temp, p.nextTick);
  } catch (e) { rmSync(temp, { force: true }); throw e; }
}

/** The recorded next-tick time (epoch ms) while its supervisor is still running, else null. */
export function readNextTick(p: Paths): number | null {
  let d: any;
  try { d = JSON.parse(readFileSync(p.nextTick, 'utf8')); } catch { return null; }
  const at = typeof d?.at === 'string' ? Date.parse(d.at) : NaN;
  if (d?.version !== 1 || !Number.isInteger(d.pid) || d.pid <= 0 || !(d.startTicks === null || Number.isInteger(d.startTicks)) || !Number.isFinite(at)) return null;
  return sameProcess({ pid: d.pid, startTicks: d.startTicks }) ? at : null;
}
