// One tick per user, and the record of which processes a tick owns. The lock file `<state>/scheduler/tick.lock` is
// JSON `{version:1, token, tick:{pid,startTicks}, pass?:{pid,startTicks,root}}`: the tick's own process, and the one
// dispatcher pass it spawned. The pass is spawned as the leader of a new process group (commands/dispatch.mts), so
// its pid is the group id and every non-detached child (shell, npx, ticket analysis) is in that group, while ticket
// runs the dispatcher detached are in their own groups. Cancellation (tick-cancel.mts) signals only the tick pid
// and that one group, after checking they are still the recorded processes (pid plus kernel start time, so a reused
// pid is never signalled). The file is created atomically with its content (link) and updated by rename, so a
// reader never sees an empty lock. A lock whose tick is dead and whose pass group is empty is reclaimed under an
// exclusive guard; a lock whose pass group is still alive is NOT reclaimed, so no second pass starts over an
// orphaned one. The tick drops the pass record (clearPass) only once the group is empty: leftover members after the
// leader exits are terminated first (commands/tick.mts). An unreadable lock or an abandoned guard fails closed with the path to inspect. No lock expires
// by age. Linux reads /proc for start times and group members; elsewhere only liveness of the pid is checked.
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { Paths } from './paths.mts';
export type ProcRef = { pid: number; startTicks: number | null };
export type LockInfo = { version: 1; token: string; tick: ProcRef; pass?: ProcRef & { root: string } };

/** `[pgrp, state, startTicks]` of a process from /proc, or null when it is gone or /proc is unavailable. */
function stat(pid: number): { pgrp: number; state: string; startTicks: number } | null {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return { state: f[0], pgrp: Number(f[2]), startTicks: Number(f[19]) };
  } catch { return null; }
}
const hasProc = existsSync('/proc/self/stat');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
export const procRef = (pid: number): ProcRef => ({ pid, startTicks: stat(pid)?.startTicks ?? null });
/** The process group of a process (null when unknown or gone). */
export const groupOf = (pid: number): number | null => stat(pid)?.pgrp ?? null;
/** The process group of this process. Never signalled. */
export const ownGroup = (): number | null => groupOf(process.pid);

/** True while the recorded process is still the same one: alive, not a zombie, and (where known) the same start time. */
export function sameProcess(ref: ProcRef): boolean {
  if (hasProc) {
    const s = stat(ref.pid);
    return !!s && s.state !== 'Z' && (ref.startTicks === null || s.startTicks === ref.startTicks);
  }
  return alive(ref.pid);
}
/** True while any non-zombie process is in group `pgid`. */
export function groupAlive(pgid: number): boolean {
  if (!hasProc) { try { process.kill(-pgid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } }
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const s = stat(Number(name));
    if (s && s.pgrp === pgid && s.state !== 'Z' && s.state !== 'X') return true;
  }
  return false;
}
/** The recorded pass group is still running. Its leader being replaced by a different process means the pid was reused. */
export function passAlive(pass: ProcRef): boolean {
  if (hasProc) {
    const leader = stat(pass.pid);
    if (leader && leader.state !== 'Z' && pass.startTicks !== null && leader.startTicks !== pass.startTicks) return false;
  }
  return groupAlive(pass.pid);
}

export function readLock(p: Paths): LockInfo | null {
  let text: string;
  try { text = readFileSync(p.tickLock, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  let d: any;
  try { d = JSON.parse(text); } catch { d = null; }
  const ref = (x: any) => Number.isInteger(x?.pid) && x.pid > 0 && (x.startTicks === null || Number.isInteger(x.startTicks));
  if (!(d?.version === 1 && typeof d.token === 'string' && ref(d.tick) && (d.pass === undefined || (ref(d.pass) && typeof d.pass.root === 'string'))))
    throw new Error(`The scheduler lock ${p.tickLock} is unreadable. Factory can't tell whether a tick is running; inspect it, and delete it only if no tick is.`);
  return d;
}
function writeLock(p: Paths, info: LockInfo, create: boolean) {
  mkdirSync(dirname(p.tickLock), { recursive: true });
  const temp = `${p.tickLock}.${process.pid}.${info.token}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(info) + '\n', { mode: 0o600 });
    if (create) linkSync(temp, p.tickLock); else renameSync(temp, p.tickLock);
  } finally { rmSync(temp, { force: true }); }
}

export type HeldLock = { info: LockInfo; recordPass(root: string, pid: number): void; clearPass(): void; release(): void; ownedByUs(): boolean };
/** Takes the lock. `busy` explains why not (a live tick, or an orphaned pass still running). Throws on an unreadable lock. */
export function acquireTickLock(p: Paths): HeldLock | { busy: string } {
  const info: LockInfo = { version: 1, token: randomUUID(), tick: procRef(process.pid) };
  for (let attempt = 0; attempt < 3; attempt++) {
    try { writeLock(p, info, true); return held(p, info); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const r = reclaimDeadLock(p);
    if (r.busy) return { busy: r.busy };
  }
  throw new Error(`Couldn't take the scheduler lock ${p.tickLock}`);
}
function held(p: Paths, info: LockInfo): HeldLock {
  const mine = () => readLock(p)?.token === info.token;
  const save = () => { if (mine()) writeLock(p, info, false); };
  return {
    info,
    ownedByUs: mine,
    recordPass(root, pid) { info.pass = { ...procRef(pid), root }; save(); },
    clearPass() { delete info.pass; save(); },
    release() { if (mine()) rmSync(p.tickLock, { force: true }); },
  };
}

/** Removes the lock when its tick is dead and its pass group is empty. `busy` names what is still running otherwise;
 *  `reclaimed` is true when a stale lock was removed. */
export function reclaimDeadLock(p: Paths): { busy?: string; reclaimed: boolean } {
  const old = readLock(p);
  if (!old) return { reclaimed: false };
  if (sameProcess(old.tick)) return { busy: `another tick is running (pid ${old.tick.pid})`, reclaimed: false };
  if (old.pass && passAlive(old.pass)) return { busy: `a dispatcher pass from a dead tick is still running (pid ${old.pass.pid}, project ${old.pass.root})`, reclaimed: false };
  const guard = `${p.tickLock}.reclaim`;
  let fd: number;
  try { fd = openSync(guard, 'wx', 0o600); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another process is reclaiming the scheduler lock (${guard}). If none is, delete that file.`);
    throw e;
  }
  try {
    if (readLock(p)?.token === old.token) { rmSync(p.tickLock, { force: true }); return { reclaimed: true }; }
    return { reclaimed: false };
  } finally { closeSync(fd); rmSync(guard, { force: true }); }
}
