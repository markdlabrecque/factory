// Self-recovery's durable record (slice four, #55): one file per project, `<state>/recovery/<key>.json`, where `key` is
// derived from the project's canonical root and the file repeats `root`. It holds:
// - `episode`: the current jam. A jam is identified by its affected tickets (the sorted iids the jam detector reports).
//   Only completed dispatcher passes are observed (an interrupted pass is not passed in); each pass counts once, by its id.
//   The same jam on CONFIRM_PASSES consecutive completed passes is confirmed. A pass with a different jam starts a new
//   episode, and a pass with no jam ends it; ended episodes go to `episodes`, the bounded history.
// - `budgets`: per ticket, the repair attempts used since the budget was last renewed. A ticket gets ATTEMPT_LIMIT
//   attempts. Only renewBudget (verified progress by the ticket, or an attributable human requirement change) and
//   resetRecovery (explicit project reset) renew it. A new or ended episode does not, so the helper's own activity and
//   unrelated queue changes never buy more attempts.
// - `attempts` and `renewals`: bounded history (LOG_LIMIT each, oldest dropped) for reports. The budget counters, not
//   this history, decide whether another attempt is allowed. At most one attempt per project is `running` at a time.
// This module stores and checks only; it never detects jams, launches repairs or reads the tracker. Transitions run under
// an exclusive per-project lock and write temp-file + rename (mode 0600). A missing file is an empty record; a malformed
// one throws and is never overwritten (fail closed: no attempt is allowed).
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from './paths.mts';

export const CONFIRM_PASSES = 2;
export const ATTEMPT_LIMIT = 2;
export const LOG_LIMIT = 100;

export type PassSeen = { pass: string; at: string };
export type Episode = { id: string; startedAt: string; tickets: number[]; passes: PassSeen[]; confirmedAt?: string;
  endedAt?: string; end?: 'cleared' | 'changed' | 'reset' };
export type AttemptResult = 'running' | 'repaired' | 'failed' | 'timed-out' | 'blocked' | 'interrupted';
export type Attempt = { seq: number; ticket: number; episode: string; startedAt: string; finishedAt?: string; result: AttemptResult;
  branch?: string; pid?: number; reason?: string; log?: string; report?: string };
export type RenewalKind = 'progress' | 'requirement-change' | 'reset';
export type Renewal = { at: string; kind: RenewalKind; ticket?: number; detail?: string };
export type Budget = { used: number; renewedAt?: string; renewal?: RenewalKind };
export type RecoveryState = { version: 1; root: string; nextSeq: number; episode?: Episode; episodes: Episode[];
  budgets: Record<string, Budget>; attempts: Attempt[]; renewals: Renewal[] };

const RESULTS: AttemptResult[] = ['running', 'repaired', 'failed', 'timed-out', 'blocked', 'interrupted'];
const KINDS: RenewalKind[] = ['progress', 'requirement-change', 'reset'];
const ENDS = ['cleared', 'changed', 'reset'];
const isTime = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const isIid = (x: unknown) => Number.isInteger(x) && (x as number) > 0;
const optStr = (x: unknown) => x === undefined || typeof x === 'string';
const keep = <T,>(xs: T[]) => xs.slice(-LOG_LIMIT);

export const recoveryFile = (p: Paths, root: string) =>
  join(p.recovery, `${createHash('sha256').update(root).digest('hex').slice(0, 16)}.json`);
export const emptyRecovery = (root: string): RecoveryState => ({ version: 1, root, nextSeq: 1, episodes: [], budgets: {}, attempts: [], renewals: [] });

const validEpisode = (e: any) => e && typeof e.id === 'string' && isTime(e.startedAt) && Array.isArray(e.tickets) && e.tickets.every(isIid)
  && Array.isArray(e.passes) && e.passes.every((x: any) => typeof x?.pass === 'string' && isTime(x.at))
  && (e.confirmedAt === undefined || isTime(e.confirmedAt)) && (e.endedAt === undefined || isTime(e.endedAt))
  && (e.end === undefined || ENDS.includes(e.end));

/** The project's recovery record. Missing is empty; malformed or another project's file throws. */
export function readRecovery(p: Paths, root: string): RecoveryState {
  const file = recoveryFile(p, root);
  if (!existsSync(file)) return emptyRecovery(root);
  let d: any;
  try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error(`Recovery state is not valid JSON: ${file}. Fix or remove it; Factory will not overwrite it.`); }
  const ok = d?.version === 1 && d.root === root && isIid(d.nextSeq)
    && (d.episode === undefined || (validEpisode(d.episode) && d.episode.endedAt === undefined))
    && Array.isArray(d.episodes) && d.episodes.every(validEpisode)
    && d.budgets && typeof d.budgets === 'object' && !Array.isArray(d.budgets)
    && Object.entries<any>(d.budgets).every(([k, b]) => isIid(Number(k)) && Number.isInteger(b?.used) && b.used >= 0
      && (b.renewedAt === undefined || isTime(b.renewedAt)) && (b.renewal === undefined || KINDS.includes(b.renewal)))
    && Array.isArray(d.attempts) && d.attempts.every((a: any) => isIid(a?.seq) && isIid(a.ticket) && typeof a.episode === 'string'
      && isTime(a.startedAt) && (a.finishedAt === undefined || isTime(a.finishedAt)) && RESULTS.includes(a.result)
      && optStr(a.branch) && (a.pid === undefined || isIid(a.pid)) && optStr(a.reason) && optStr(a.log) && optStr(a.report))
    && d.attempts.filter((a: any) => a.result === 'running').length <= 1
    && Array.isArray(d.renewals) && d.renewals.every((r: any) => isTime(r?.at) && KINDS.includes(r.kind)
      && (r.ticket === undefined || isIid(r.ticket)) && optStr(r.detail));
  if (!ok) throw new Error(`Unsupported recovery state: ${file}. Fix or remove it; Factory will not overwrite it.`);
  return d;
}

/** Apply `change` to the project's record under its lock; the record is written only when `change` returns true. */
export function mutateRecovery<T>(p: Paths, root: string, change: (s: RecoveryState) => { write: boolean; value: T }): T {
  const file = recoveryFile(p, root);
  mkdirSync(p.recovery, { recursive: true });
  const lock = `${file}.lock`;
  let fd: number;
  try { fd = openSync(lock, 'wx', 0o600); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another factory command is changing recovery state (${lock}). Retry shortly; if none is running, delete that file.`);
    throw e;
  }
  try {
    const s = readRecovery(p, root);
    const { write, value } = change(s);
    if (write) {
      const temp = `${file}.${process.pid}.tmp`;
      try { writeFileSync(temp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, file); }
      catch (e) { rmSync(temp, { force: true }); throw e; }
    }
    return value;
  } finally { closeSync(fd); rmSync(lock, { force: true }); }
}

const sameJam = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
function endEpisode(s: RecoveryState, at: string, end: NonNullable<Episode['end']>) {
  if (!s.episode) return;
  s.episodes = keep([...s.episodes, { ...s.episode, endedAt: at, end }]);
  delete s.episode;
}
export const runningAttempt = (s: RecoveryState) => s.attempts.find(a => a.result === 'running');
/** Attempts the ticket has left in its current budget. */
export const remainingAttempts = (s: RecoveryState, ticket: number) => Math.max(0, ATTEMPT_LIMIT - (s.budgets[ticket]?.used ?? 0));

/** Record one completed dispatcher pass and the jam it saw (the affected tickets, or null/empty for none). Returns the
 *  current episode, if any. A pass id already counted changes nothing. */
export function observePass(p: Paths, root: string, o: { pass: string; at: string; jam: number[] | null }): Episode | undefined {
  if (!isTime(o.at)) throw new Error(`Invalid pass time: ${o.at}`);
  const tickets = [...new Set(o.jam ?? [])].sort((a, b) => a - b);
  if (!tickets.every(isIid)) throw new Error(`Invalid jammed tickets: ${JSON.stringify(o.jam)}`);
  return mutateRecovery(p, root, s => {
    if (s.episode?.passes.some(x => x.pass === o.pass)) return { write: false, value: s.episode };
    if (!tickets.length) { const write = !!s.episode; endEpisode(s, o.at, 'cleared'); return { write, value: undefined }; }
    if (s.episode && !sameJam(s.episode.tickets, tickets)) endEpisode(s, o.at, 'changed');
    if (!s.episode) s.episode = { id: `${o.at}#${o.pass}`, startedAt: o.at, tickets, passes: [] };
    const e = s.episode;
    e.passes = [...e.passes, { pass: o.pass, at: o.at }].slice(-CONFIRM_PASSES);
    if (!e.confirmedAt && e.passes.length >= CONFIRM_PASSES) e.confirmedAt = o.at;
    return { write: true, value: e };
  });
}

/** Why a repair attempt on `ticket` may not start now, or null. */
export function attemptProblem(s: RecoveryState, ticket: number): string | null {
  const running = runningAttempt(s);
  if (running) return `Recovery attempt ${running.seq} on #${running.ticket} is still running.`;
  if (!s.episode?.confirmedAt) return `No confirmed jam: it must be seen on ${CONFIRM_PASSES} consecutive completed passes.`;
  if (!s.episode.tickets.includes(ticket)) return `#${ticket} is not part of the confirmed jam.`;
  if (!remainingAttempts(s, ticket)) return `#${ticket} has used its ${ATTEMPT_LIMIT} recovery attempts; it needs verified progress, a requirement change or a project reset.`;
  return null;
}
/** Record a new running attempt and spend one unit of the ticket's budget. Throws with the reason when not allowed. */
export function beginAttempt(p: Paths, root: string, o: { ticket: number; at: string; branch?: string; pid?: number; log?: string }): Attempt {
  if (!isTime(o.at)) throw new Error(`Invalid attempt time: ${o.at}`);
  return mutateRecovery(p, root, s => {
    const problem = attemptProblem(s, o.ticket);
    if (problem) throw new Error(problem);
    const a: Attempt = { seq: s.nextSeq++, ticket: o.ticket, episode: s.episode!.id, startedAt: o.at, result: 'running',
      ...(o.branch ? { branch: o.branch } : {}), ...(o.pid ? { pid: o.pid } : {}), ...(o.log ? { log: o.log } : {}) };
    s.attempts = keep([...s.attempts, a]);
    const b = s.budgets[o.ticket] ?? { used: 0 };
    s.budgets[o.ticket] = { ...b, used: b.used + 1 };
    return { write: true, value: a };
  });
}
/** Finish the running attempt `seq`. Its budget stays spent whatever the result. */
export function finishAttempt(p: Paths, root: string, seq: number,
  o: { at: string; result: Exclude<AttemptResult, 'running'>; reason?: string; log?: string; report?: string }): Attempt {
  if (!isTime(o.at) || !RESULTS.includes(o.result) || o.result === ('running' as AttemptResult)) throw new Error(`Invalid attempt finish: ${JSON.stringify(o)}`);
  return mutateRecovery(p, root, s => {
    const a = s.attempts.find(x => x.seq === seq);
    if (!a || a.result !== 'running') throw new Error(`Recovery attempt ${seq} is not running.`);
    Object.assign(a, { finishedAt: o.at, result: o.result }, o.reason ? { reason: o.reason } : {}, o.log ? { log: o.log } : {}, o.report ? { report: o.report } : {});
    return { write: true, value: a };
  });
}
/** Renew one ticket's budget after verified delivery progress by that ticket or an attributable human requirement change. */
export function renewBudget(p: Paths, root: string, o: { ticket: number; at: string; kind: 'progress' | 'requirement-change'; detail?: string }) {
  if (!isIid(o.ticket) || !isTime(o.at) || !['progress', 'requirement-change'].includes(o.kind)) throw new Error(`Invalid budget renewal: ${JSON.stringify(o)}`);
  mutateRecovery(p, root, s => {
    s.budgets[o.ticket] = { used: 0, renewedAt: o.at, renewal: o.kind };
    s.renewals = keep([...s.renewals, { at: o.at, kind: o.kind, ticket: o.ticket, ...(o.detail ? { detail: o.detail } : {}) }]);
    return { write: true, value: undefined };
  });
}
/** Explicit project reset: refuses while an attempt runs; ends the episode (confirmation starts over on later passes) and
 *  renews every ticket's budget. History, ticket work and evidence are kept; nothing is launched. */
export function resetRecovery(p: Paths, root: string, o: { at: string; detail?: string }) {
  if (!isTime(o.at)) throw new Error(`Invalid reset time: ${o.at}`);
  mutateRecovery(p, root, s => {
    const running = runningAttempt(s);
    if (running) throw new Error(`Recovery attempt ${running.seq} on #${running.ticket} is running; reset refused.`);
    endEpisode(s, o.at, 'reset');
    for (const k of Object.keys(s.budgets)) s.budgets[k] = { used: 0, renewedAt: o.at, renewal: 'reset' };
    s.renewals = keep([...s.renewals, { at: o.at, kind: 'reset', ...(o.detail ? { detail: o.detail } : {}) }]);
    return { write: true, value: undefined };
  });
}
