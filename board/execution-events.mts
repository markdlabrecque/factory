// Local observational events. Immutable files, per-stream process locks, no state/journal authority.
// Writers run after admission locks. Export is a read-only snapshot and never promises complete history.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { afterAdmission, observationFailure, ownerOf, ownerState, writeDurable } from './admission.mts';

export const REASONS = ['dependency-unsatisfied', 'dependency-unknown', 'conflict', 'capacity', 'analysis-stale', 'environment-unready', 'verification-fail', 'verification-inconclusive', 'publication-failed', 'ci-pending', 'ci-failed', 'requirements-changed', 'ownership-unknown', 'operator-pause', 'budget-exhausted', 'process-exited', 'merged', 'unspecified'] as const;
export type Reason = typeof REASONS[number];
export const KINDS = ['execution-admitted', 'stage-changed', 'parked-reason-changed', 'recovery-admitted', 'recovery-phase-changed', 'recovery-settled', 'action-requested', 'action-result'] as const;
export type Kind = typeof KINDS[number];
const STAGES = ['queued','waiting','setup','implementing','verifying','posting','pushing','ci','done','stopped'];
const PHASES = ['claimed','setup','repairing','verifying','delivering','finished','cleanup-pending'];
const OUTCOMES = ['delivered','unresolved','failed','timed-out','interrupted','host-followup','ownership-refused'];
export type Origin = 'runner' | 'recovery' | 'scheduler' | 'reconciliation' | 'cli' | 'board';
export const ACTIONS = ['retry', 'recovery-reset', 'recovery-review', 'schedule-on', 'schedule-off', 'update-apply', 'ticket-comment', 'ticket-verdict', 'ticket-archive', 'ticket-restore'] as const;
export type Action = typeof ACTIONS[number];
export type ActionResult = 'changed' | 'no-op' | 'refused' | 'failed';
export interface ProducerEvent {
  eventId: string; observedAt: string; project: string; ticket?: string;
  executionId?: string; recoveryAttemptId?: string; identityComplete: boolean;
  eventKind: Kind; from?: string; to?: string; reasonCode: Reason; origin: Origin;
  operationId?: string; actorIdentity?: 'unknown'; action?: Action; result?: ActionResult;
}
export interface ExecutionEvent extends ProducerEvent { version: 1; streamKey: string; sequence: number; recordedAt: string }
const id = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,255}$/.test(s);
const ticket = (s: unknown): s is string => typeof s === 'string' && /^[1-9]\d*$/.test(s) && Number.isSafeInteger(Number(s));
export function validTime(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.exec(s);
  if (!m || !Number.isFinite(Date.parse(s))) return false;
  const [, y, month, day, h, min, sec] = m.map(Number);
  const date = new Date(0); date.setUTCFullYear(y, month, 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= date.getUTCDate() && h < 24 && min < 60 && sec < 60;
}
export const eventIdFor = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const streamKey = (project: string, iid?: string) => createHash('sha256').update(JSON.stringify([project, iid ?? null])).digest('hex');
function stable(x: any): any {
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k,stable(v)]));
  return x;
}
const canonical = (x: object): string => JSON.stringify(stable(x));
const fields = ['eventId','observedAt','project','ticket','executionId','recoveryAttemptId','identityComplete','eventKind','from','to','reasonCode','origin','operationId','actorIdentity','action','result'];
function producer(x: any): ProducerEvent {
  if (!x || typeof x !== 'object' || !id(x.eventId) || !id(x.project) || !validTime(x.observedAt)
    || x.ticket !== undefined && !ticket(x.ticket) || !KINDS.includes(x.eventKind) || !REASONS.includes(x.reasonCode)
    || !['runner','recovery','scheduler','reconciliation','cli','board'].includes(x.origin)
    || typeof x.identityComplete !== 'boolean' || x.identityComplete && !id(x.executionId) && !id(x.recoveryAttemptId)
    || ['executionId','recoveryAttemptId','operationId','from','to'].some(k => x[k] !== undefined && !id(x[k]))
    || x.actorIdentity !== undefined && x.actorIdentity !== 'unknown'
    || x.action !== undefined && !ACTIONS.includes(x.action) || x.result !== undefined && !['changed','no-op','refused','failed'].includes(x.result)) throw Error('Invalid telemetry producer payload');
  if (['execution-admitted','recovery-admitted','stage-changed','parked-reason-changed'].includes(x.eventKind)
    && (!STAGES.includes(x.to) || x.from !== undefined && !STAGES.includes(x.from))) throw Error('Invalid telemetry stages');
  if (x.eventKind === 'execution-admitted' && !id(x.executionId)) throw Error('Missing execution identity');
  if (x.eventKind.startsWith('recovery-') && !id(x.recoveryAttemptId)) throw Error('Missing recovery identity');
  if (x.eventKind === 'recovery-phase-changed' && (!PHASES.includes(x.to) || x.from !== undefined && !PHASES.includes(x.from))) throw Error('Invalid telemetry phases');
  if (x.eventKind === 'recovery-settled' && (x.from !== 'running' || !OUTCOMES.includes(x.to))) throw Error('Invalid telemetry settlement');
  const action = x.eventKind === 'action-requested' || x.eventKind === 'action-result';
  if (action && (x.from !== undefined || x.to !== undefined || !id(x.operationId) || !ACTIONS.includes(x.action) || x.actorIdentity !== 'unknown'
    || (x.eventKind === 'action-result') !== (x.result !== undefined))) throw Error('Invalid telemetry action');
  if (!action && (x.action !== undefined || x.result !== undefined || x.actorIdentity !== undefined)) throw Error('Unexpected telemetry action fields');
  return Object.fromEntries(fields.filter(k => x[k] !== undefined).map(k => [k, x[k]])) as ProducerEvent;
}
function parseEvent(x: any, stream: string, name: string): ExecutionEvent {
  if (x?.version !== 1) throw Error('unsupported-version');
  const p = producer(x);
  if (Object.keys(x).some(k => ![...fields,'version','streamKey','sequence','recordedAt'].includes(k))) throw Error('unsupported-fields');
  if (x.streamKey !== stream || streamKey(p.project, p.ticket) !== stream) throw Error('foreign-stream');
  if (!Number.isSafeInteger(x.sequence) || x.sequence <= 0 || !validTime(x.recordedAt)
    || name !== `${String(x.sequence).padStart(12, '0')}-${p.eventId}.json`) throw Error('invalid-sequence-or-filename');
  return { ...p, version: 1, streamKey: stream, sequence: x.sequence, recordedAt: x.recordedAt };
}
// A separate reaping guard serializes the dead-owner check and removal. Without this guard,
// two stale-lock reclaimers can accidentally unlink a new live writer's lock. An abandoned guard fails closed.
function withStreamLock<T>(dir: string, fn: () => T, waitMs: number): T {
  const lockDir = join(dir, '.writer');
  mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const lock = join(lockDir, 'lock'), guard = join(lockDir, 'lock.reap');
  const owner = ownerOf(process.pid), tmp = join(lockDir, `${randomUUID()}.tmp`);
  writeDurable(tmp, JSON.stringify(owner));
  const deadline = Date.now() + waitMs;
  try {
    for (;;) {
      let guarded = false, acquired = false;
      try {
        // Creation as well as reclamation honors the guard. A live owner may release while
        // it is held, but no replacement can appear between the identity check and removal.
        symlinkSync(JSON.stringify(owner), guard); guarded = true;
        try { linkSync(tmp, lock); acquired = true; }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          const holder = JSON.parse(readFileSync(lock, 'utf8'));
          if (Number.isInteger(holder?.pid) && holder.pid > 0 && (holder.start === undefined || typeof holder.start === 'string') && ownerState(holder) === 'dead') {
            rmSync(lock, { force: true }); linkSync(tmp, lock); acquired = true;
          }
        }
      } catch (e) {
        if (!['ENOENT', 'EEXIST'].includes((e as NodeJS.ErrnoException).code ?? '')) throw Error('Telemetry lock unreadable');
      } finally { if (guarded) rmSync(guard); }
      if (acquired) break;
      if (Date.now() >= deadline) throw Error('Telemetry lock busy or unreadable');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  } finally { rmSync(tmp, { force: true }); }
  try { return fn(); } finally { rmSync(lock); }
}

/** Publish complete content with an exclusive hard link, never rename over an existing event. */
export function appendEvent(state: string, input: ProducerEvent, hooks: { afterSync?: () => void; afterPublish?: () => void; waitMs?: number } = {}): ExecutionEvent {
  const p = producer(input), stream = streamKey(p.project, p.ticket), dir = join(state, 'telemetry', stream);
  // Event IDs appear in filenames; disallow path punctuation accepted for other identifiers.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,255}$/.test(p.eventId)) throw Error('Invalid telemetry event ID');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return withStreamLock(dir, () => {
    const events = readdirSync(dir).filter(n => n.endsWith('.json')).map(n => parseEvent(JSON.parse(readFileSync(join(dir, n), 'utf8')), stream, n));
    const same = events.find(e => e.eventId === p.eventId);
    if (same) {
      if (canonical(producer(same)) !== canonical(p)) throw Error('Conflicting telemetry event ID');
      return same;
    }
    const seqs = events.map(e => e.sequence).sort((a,b) => a-b);
    if (seqs.some((n,i) => n !== i+1)) throw Error('Telemetry sequence anomaly');
    const event: ExecutionEvent = { ...p, version: 1, streamKey: stream, sequence: seqs.length + 1, recordedAt: new Date().toISOString() };
    const name = `${String(event.sequence).padStart(12, '0')}-${event.eventId}.json`;
    const tmp = join(dir, `.${randomUUID()}.tmp`), fd = openSync(tmp, 'wx', 0o600);
    try { writeSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    try {
      hooks.afterSync?.();
      linkSync(tmp, join(dir, name));
      hooks.afterPublish?.();
      const folder = openSync(dir, 'r');
      try { fsyncSync(folder); } finally { closeSync(folder); }
    } finally { rmSync(tmp, { force: true }); }
    return event;
  }, hooks.waitMs ?? 250);
}
/** Diagnostics deliberately omit raw exceptions, identifiers and user content. Never affects the caller's outcome. */
export function observeEvent(state: string, input: ProducerEvent): void {
  afterAdmission(() => { try { appendEvent(state, input); } catch { observationFailure(); } });
}
export interface ExportReport { version: 1; coverage: 'observed-only'; identityGaps: number; diagnostics: { stream?: string; code: string }[]; events: ExecutionEvent[] }
export function exportEvents(state: string, filter: { project?: string; ticket?: string; since?: string } = {}): ExportReport {
  if (filter.ticket !== undefined && (!filter.project || !ticket(filter.ticket))) throw Error('A positive ticket filter requires --project');
  if (filter.since !== undefined && !validTime(filter.since)) throw Error('--since requires an ISO-8601 timestamp with timezone');
  const report: ExportReport = { version: 1, coverage: 'observed-only', identityGaps: 0, diagnostics: [], events: [] };
  const base = join(state, 'telemetry');
  let streams: string[];
  try { streams = readdirSync(base).sort(); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') report.diagnostics.push({ code: 'read-failed' });
    return report;
  }
  for (const stream of streams) {
    if (!/^[a-f0-9]{64}$/.test(stream)) { report.diagnostics.push({ code: 'invalid-stream' }); continue; }
    if (filter.project && filter.ticket && stream !== streamKey(filter.project, filter.ticket)) continue;
    let names: string[];
    try { names = readdirSync(join(base, stream)).filter(n => n.endsWith('.json')).sort(); }
    catch { report.diagnostics.push({ stream, code: 'read-failed' }); continue; }
    const selected: ExecutionEvent[] = [];
    let sequence = 0;
    const ids = new Set<string>();
    for (const name of names) {
      try {
        const e = parseEvent(JSON.parse(readFileSync(join(base, stream, name), 'utf8')), stream, name);
        if (ids.has(e.eventId) || e.sequence !== sequence + 1) {
          report.diagnostics.push({ stream, code: 'sequence-anomaly' });
          sequence = Math.max(sequence, e.sequence); continue;
        }
        sequence = e.sequence; ids.add(e.eventId);
        if ((!filter.project || e.project === filter.project) && (!filter.ticket || e.ticket === filter.ticket)
          && (!filter.since || Date.parse(e.observedAt) >= Date.parse(filter.since))) selected.push(e);
      } catch { report.diagnostics.push({ stream, code: 'corrupt-or-unsupported-event' }); }
    }
    report.events.push(...selected);
  }
  // Stable k-way merge: occurrence timestamps are not a global causal order. Preserve each stream's append order.
  const queues = new Map<string, ExecutionEvent[]>();
  for (const e of report.events) { const q = queues.get(e.streamKey) ?? []; q.push(e); queues.set(e.streamKey, q); }
  report.events = [];
  while (queues.size) {
    const e = [...queues.values()].map(q => q[0]).sort((a,b) => a.recordedAt.localeCompare(b.recordedAt) || a.streamKey.localeCompare(b.streamKey) || a.sequence-b.sequence)[0];
    report.events.push(e); const q = queues.get(e.streamKey)!; q.shift(); if (!q.length) queues.delete(e.streamKey);
  }
  report.identityGaps = report.events.filter(e => !e.identityComplete).length;
  return report;
}

// Typed producer facts only. Legacy prose is never classified, persisted or treated as attribution.
type RunObservation = { project?: string; iid: string; executionId?: string; updatedAt?: string; stage?: string; note?: string; queueReasons?: { code: string }[]; recovery?: { id?: string }; delivery?: { reasonCode: string } };
const reasonAliases: Record<string, Reason> = { 'checks-pending': 'ci-pending', 'checks-missing': 'ci-pending', 'checks-failed': 'ci-failed', 'requirements': 'requirements-changed' };
export function observedReason(r: RunObservation): Reason {
  const codes = [...(r.queueReasons ?? []).map(x => x.code), r.delivery?.reasonCode];
  for (const c of codes) { if (c && REASONS.includes(c as Reason)) return c as Reason; if (c && reasonAliases[c]) return reasonAliases[c]; }
  return 'unspecified';
}
export function observeRun(state: string, previous: Partial<RunObservation>, next: RunObservation, origin: Origin = 'runner', reason?: Reason): void {
  try {
  const base = { project: next.project ?? 'unknown', ticket: next.iid, executionId: next.executionId, recoveryAttemptId: next.recovery?.id,
    identityComplete: !!next.project && !!next.executionId && (!next.recovery || !!next.recovery.id), observedAt: next.updatedAt ?? new Date().toISOString(), origin,
    reasonCode: reason ?? observedReason(next) };
  const emit = (eventKind: Kind, eventId = randomUUID()) => observeEvent(state, { ...base, eventKind, eventId, from: previous.stage, to: next.stage });
  if (next.executionId && next.executionId !== previous.executionId) emit('execution-admitted', eventIdFor('execution-admitted', next.executionId));
  if (next.recovery?.id && next.recovery.id !== previous.recovery?.id) emit('recovery-admitted', eventIdFor('recovery-admitted', next.recovery.id));
  if (next.stage !== previous.stage) emit('stage-changed');
  else if (['queued','waiting'].includes(next.stage ?? '') && (next.note !== previous.note || canonical(next.queueReasons ?? []) !== canonical(previous.queueReasons ?? []))) emit('parked-reason-changed');
  } catch { observationFailure(); }
}
/** Wrap an explicit synchronous entrypoint, not shared automation helpers. Producers name the observed result. */
export function controlAction<T>(state: string, target: { project: string; ticket?: string }, action: Action,
  fn: (done: ReturnType<typeof startAction>) => T, origin: 'cli' | 'board' = 'cli'): T {
  const done = startAction(state, target, action, origin);
  try { return fn(done); } catch (error) { done('failed'); throw error; }
}

/** Explicit request entrypoints only. Missing result means unknown, not failed or proof of inactivity. */
export function startAction(state: string, target: { project: string; ticket?: string }, action: Action, origin: 'cli' | 'board' = 'cli'): (result: ActionResult, reason?: Reason) => void {
  const operationId = randomUUID();
  const base = { ...target, operationId, action, origin, actorIdentity: 'unknown' as const, identityComplete: false };
  observeEvent(state, { ...base, eventId: randomUUID(), observedAt: new Date().toISOString(), eventKind: 'action-requested', reasonCode: 'unspecified' });
  let finished = false;
  return (result, reasonCode = 'unspecified') => {
    if (finished) return; finished = true;
    observeEvent(state, { ...base, eventId: randomUUID(), observedAt: new Date().toISOString(), eventKind: 'action-result', result, reasonCode });
  };
}
