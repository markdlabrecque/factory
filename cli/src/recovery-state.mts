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
//   Since #74 an attempt also carries its UUID, exact container name and host-owned attempt record path, fixed before
//   the repair process starts, and ends with one of orchestrator/recovery.mts's outcomes. Since #75 the claim and its
//   charge are first committed together in the admission record (board/admission.mts); beginAttempt then applies the
//   charge here, idempotently by attempt UUID, so a crash between the two writes is replayed without charging twice.
// - `episode.generation` (#75): the project's admission activity generation the jam was seen at. A normal admission
//   advances it, which restarts confirmation (observePass) and refuses an attempt on a jam confirmed before it.
// - `watch` (#56): per ticket, the last observed requirement fingerprint (`content`, the dispatcher's unitHash of title,
//   description, parent and human comments, which leaves out Sandcastle's own and system notes; `labels`, the ticket's
//   labels minus those Factory writes itself) and verified delivery marker (`delivery`, see deliveryMarker). observeTicket
//   compares each new observation with it: a changed fingerprint is an attributable human requirement change, a new
//   delivery marker is verified delivery progress by the ticket; either renews the ticket's spent budget. The first
//   observation only sets the baseline, and an unchanged one changes nothing, so repeated passes never renew.
// This module stores and checks only; it never detects jams, launches repairs or reads the tracker. Since #61 the tick's
// jam confirmation (jam-detect.mts) calls observeTicket and observePass after each completed scheduled pass. Transitions run under
// an exclusive per-project lock and write temp-file + rename (mode 0600). A missing file is an empty record; a malformed
// one throws and is never overwritten (fail closed: no attempt is allowed).
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunState } from '../../board/board.mts';
import type { Paths } from './paths.mts';

export const CONFIRM_PASSES = 2;
export const ATTEMPT_LIMIT = 2;
export const LOG_LIMIT = 100;

export type PassSeen = { pass: string; at: string };
export type Episode = { id: string; startedAt: string; tickets: number[]; passes: PassSeen[]; confirmedAt?: string;
  endedAt?: string; end?: 'cleared' | 'changed' | 'reset'; generation?: number };
// 'repaired' and 'blocked' are results of attempts recorded before #74; new attempts end with recovery.mts's outcomes.
export type AttemptResult = 'running' | 'delivered' | 'unresolved' | 'failed' | 'timed-out' | 'interrupted' | 'host-followup'
  | 'ownership-refused' | 'repaired' | 'blocked';
/** `id`, `container` and `record` (#74): the attempt's UUID, its exact container name and its host-owned attempt record
 *  (orchestrator/recovery.mts), all fixed before the repair process starts. */
export type Attempt = { seq: number; ticket: number; episode: string; startedAt: string; finishedAt?: string; result: AttemptResult;
  branch?: string; pid?: number; reason?: string; log?: string; report?: string; id?: string; container?: string; record?: string };
export type RenewalKind = 'progress' | 'requirement-change' | 'reset';
export type Renewal = { at: string; kind: RenewalKind; ticket?: number; detail?: string };
export type Budget = { used: number; renewedAt?: string; renewal?: RenewalKind };
export type Watch = { seenAt: string; content: string; labels: string[]; delivery?: string };
export type RecoveryState = { version: 1; root: string; nextSeq: number; episode?: Episode; episodes: Episode[];
  budgets: Record<string, Budget>; attempts: Attempt[]; renewals: Renewal[]; watch?: Record<string, Watch> };

const RESULTS: AttemptResult[] = ['running', 'delivered', 'unresolved', 'failed', 'timed-out', 'interrupted', 'host-followup',
  'ownership-refused', 'repaired', 'blocked'];
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
  && (e.end === undefined || ENDS.includes(e.end)) && (e.generation === undefined || (Number.isInteger(e.generation) && e.generation >= 0));

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
      && optStr(a.branch) && (a.pid === undefined || isIid(a.pid)) && optStr(a.reason) && optStr(a.log) && optStr(a.report)
      && optStr(a.id) && optStr(a.container) && optStr(a.record))
    && d.attempts.filter((a: any) => a.result === 'running').length <= 1
    && Array.isArray(d.renewals) && d.renewals.every((r: any) => isTime(r?.at) && KINDS.includes(r.kind)
      && (r.ticket === undefined || isIid(r.ticket)) && optStr(r.detail))
    && (d.watch === undefined || (d.watch && typeof d.watch === 'object' && !Array.isArray(d.watch)
      && Object.entries<any>(d.watch).every(([k, w]) => isIid(Number(k)) && isTime(w?.seenAt) && typeof w.content === 'string'
        && Array.isArray(w.labels) && w.labels.every((l: unknown) => typeof l === 'string') && optStr(w.delivery))));
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
 *  current episode, if any. A pass id already counted changes nothing. `generation` is the project's admission activity
 *  generation (board/admission.mts) when the pass ran: a different one than the episode's means normal work was admitted
 *  since, which breaks the confirmation, so the jam starts over from this pass. */
export function observePass(p: Paths, root: string, o: { pass: string; at: string; jam: number[] | null; generation?: number }): Episode | undefined {
  if (!isTime(o.at)) throw new Error(`Invalid pass time: ${o.at}`);
  const tickets = [...new Set(o.jam ?? [])].sort((a, b) => a - b);
  if (!tickets.every(isIid)) throw new Error(`Invalid jammed tickets: ${JSON.stringify(o.jam)}`);
  return mutateRecovery(p, root, s => {
    if (s.episode?.passes.some(x => x.pass === o.pass)) return { write: false, value: s.episode };
    if (!tickets.length) { const write = !!s.episode; endEpisode(s, o.at, 'cleared'); return { write, value: undefined }; }
    if (s.episode && (!sameJam(s.episode.tickets, tickets) || s.episode.generation !== o.generation)) endEpisode(s, o.at, 'changed');
    if (!s.episode) s.episode = { id: `${o.at}#${o.pass}`, startedAt: o.at, tickets, passes: [], ...(o.generation !== undefined ? { generation: o.generation } : {}) };
    const e = s.episode;
    e.passes = [...e.passes, { pass: o.pass, at: o.at }].slice(-CONFIRM_PASSES);
    if (!e.confirmedAt && e.passes.length >= CONFIRM_PASSES) e.confirmedAt = o.at;
    return { write: true, value: e };
  });
}

/** Why a repair attempt on `ticket` may not start now, or null. `generation`: the project's current admission activity
 *  generation; a jam confirmed at another one is stale (normal work was admitted since). */
export function attemptProblem(s: RecoveryState, ticket: number, generation?: number): string | null {
  const running = runningAttempt(s);
  if (running) return `Recovery attempt ${running.seq} on #${running.ticket} is still running.`;
  if (!s.episode?.confirmedAt) return `No confirmed jam: it must be seen on ${CONFIRM_PASSES} consecutive completed passes.`;
  if (s.episode.generation !== undefined && generation !== undefined && s.episode.generation !== generation) {
    return 'Normal work was admitted in this project since the jam was confirmed; confirmation starts over.';
  }
  if (!s.episode.tickets.includes(ticket)) return `#${ticket} is not part of the confirmed jam.`;
  if (!remainingAttempts(s, ticket)) return `#${ticket} has used its ${ATTEMPT_LIMIT} recovery attempts; it needs verified progress, a requirement change or a project reset.`;
  return null;
}
/** Record a new running attempt and spend one unit of the ticket's budget. Throws with the reason when not allowed.
 *  Idempotent by attempt UUID (`id`): an attempt already recorded is returned as it is, charging nothing. `replay` applies
 *  an attempt the admission record already admitted (cli/src/recovery-claim.mts) without rechecking whether it may start;
 *  it was checked when admitted, and its charge is applied here exactly once. */
export function beginAttempt(p: Paths, root: string, o: { ticket: number; at: string; branch?: string; pid?: number; log?: string;
  id?: string; container?: string; record?: string; replay?: boolean; generation?: number }): Attempt {
  if (!isTime(o.at)) throw new Error(`Invalid attempt time: ${o.at}`);
  return mutateRecovery(p, root, s => {
    const known = o.id ? s.attempts.find(x => x.id === o.id) : undefined;
    if (known) return { write: false, value: known };
    if (!o.replay) {
      const problem = attemptProblem(s, o.ticket, o.generation);
      if (problem) throw new Error(problem);
    } else {
      const running = runningAttempt(s);
      if (running) throw new Error(`Recovery attempt ${running.seq} on #${running.ticket} is still running; admitted attempt ${o.id} cannot be recorded.`);
    }
    const a: Attempt = { seq: s.nextSeq++, ticket: o.ticket, episode: s.episode?.id ?? 'replayed', startedAt: o.at, result: 'running',
      ...(o.branch ? { branch: o.branch } : {}), ...(o.pid ? { pid: o.pid } : {}), ...(o.log ? { log: o.log } : {}),
      ...(o.id ? { id: o.id } : {}), ...(o.container ? { container: o.container } : {}), ...(o.record ? { record: o.record } : {}) };
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

/** The verified delivery a run record shows, or undefined: a finished run whose independent verifier passed and whose
 *  branch was delivered (a PR/MR), marked merged once the dispatcher saw it merge. A stopped, failing, unpushed or
 *  reserved record has none, so the helper's repair work counts only once it has been verified and delivered. */
export function deliveryMarker(r: Pick<RunState, 'stage' | 'verdict' | 'mr' | 'mergedAt'> | undefined): string | undefined {
  if (r?.stage !== 'done' || r.verdict !== 'PASS' || !r.mr) return undefined;
  return `${r.mergedAt ? 'merged' : 'delivered'} ${r.mr}`;
}

/** Compare one ticket's current requirement fingerprint and verified delivery with its baseline, then make them the
 *  baseline. `content` is the ticket's unitHash; `labels` excludes the labels Factory writes itself (ready, needs-human,
 *  done), so only a person's changes count. A changed fingerprint renews a spent budget as `requirement-change`, a new
 *  delivery marker (deliveryMarker) as `progress`; the first observation and an unchanged one renew nothing, and a
 *  missing marker never erases the last one. Returns the renewal recorded, or null. */
export function observeTicket(p: Paths, root: string,
  o: { ticket: number; at: string; content: string; labels: string[]; delivery?: string }): Renewal | null {
  if (!isIid(o.ticket) || !isTime(o.at) || typeof o.content !== 'string' || !Array.isArray(o.labels)
    || !o.labels.every(l => typeof l === 'string') || !optStr(o.delivery)) throw new Error(`Invalid ticket observation: ${JSON.stringify(o)}`);
  const labels = [...new Set(o.labels)].sort();
  return mutateRecovery(p, root, s => {
    const before = s.watch?.[o.ticket];
    const delivery = o.delivery ?? before?.delivery;
    const next: Watch = { seenAt: o.at, content: o.content, labels, ...(delivery ? { delivery } : {}) };
    s.watch = { ...s.watch, [o.ticket]: next };
    if (!before) return { write: true, value: null };
    const changes: string[] = [];
    if (before.content !== o.content) changes.push('title, description or comments changed');
    const added = labels.filter(l => !before.labels.includes(l)), removed = before.labels.filter(l => !labels.includes(l));
    if (added.length || removed.length) changes.push(`labels ${[...added.map(l => `+${l}`), ...removed.map(l => `-${l}`)].join(' ')}`);
    const progressed = !!o.delivery && o.delivery !== before.delivery;
    const unchanged = !changes.length && !progressed;
    if (unchanged) return { write: before.seenAt !== o.at, value: null };
    if (!s.budgets[o.ticket]?.used) return { write: true, value: null };
    const kind: RenewalKind = changes.length ? 'requirement-change' : 'progress';
    const detail = [...changes, ...(progressed ? [o.delivery!] : [])].join('; ');
    const r: Renewal = { at: o.at, kind, ticket: o.ticket, detail };
    s.budgets[o.ticket] = { used: 0, renewedAt: o.at, renewal: kind };
    s.renewals = keep([...s.renewals, r]);
    return { write: true, value: r };
  });
}
