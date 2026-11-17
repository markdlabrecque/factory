// Explicit short-lived diagnosis orchestration, outside scheduler/admission locks. Reserves the host journal before Pi,
// retains frozen inputs/output and proposals only, rechecking durable operator mode. No scheduler, reviewer, repair, tracker, edit or delivery effects.
import { existsSync, readFileSync, mkdirSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Owner } from '../../board/admission.mts';
import type { Snapshot, HumanRequest } from '../../orchestrator/supervisor-contract.mts';
import type { SupervisorPolicy } from '../../orchestrator/supervisor-policy.mts';
import type { ModelFamily } from '../../orchestrator/model-policy.mts';
import type { Diagnostic, DiagnosisDecision, DiagnosisMemory } from '../../orchestrator/supervisor.mts';
import type { Facts, Resources, Limits, SupervisorState, Event } from './supervisor-state.mts';
import { readSupervisor, commitSupervisor, incidentIdentity, supervisorHumanHold, supervisorRevisionHold } from './supervisor-state.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { supervisorHash, validateSnapshot } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
const { diagnosisBasis, diagnosisContext, parseDiagnosis, validateDiagnostic, validateDiagnosisDecision, DIAGNOSIS_OUTPUT_BYTES } = await import(flat ? './supervisor.mts' : '../../orchestrator/supervisor.mts');
const { supervisorCallHold } = await import(flat ? './supervisor-policy.mts' : '../../orchestrator/supervisor-policy.mts');
const { modelForRole } = await import(flat ? './model-policy.mts' : '../../orchestrator/model-policy.mts');
const { piAnalysisArgs } = await import(flat ? './models.mts' : '../../orchestrator/models.mts');
const { ownerOf, writeDurable } = await import(flat ? './admission.mts' : '../../board/admission.mts');

/** Real source boundary uses explicit ready/registration/handoff, not the legacy Pi print callback. Public host composition is separate. */
export type DiagnosisBoundary = import('./supervisor-openai.mts').OpenAIDiagnosisBoundary;
/** Legacy injection is component-only. Its booleans and Pi print arguments do not establish provider enforcement
 * or authorize an advisory send. The owned boundary cannot enter this legacy settlement path. */
export type ComponentDiagnosisBoundary = {
  model: string; reservation: Resources; pricingKnown: boolean; accountingKnown: boolean; enforceable: boolean;
  start(command: 'pi', argv: string[], options: { cwd: string; detached: true; input: string; deadline: string; maxOutputBytes: number; reservation: Resources }): ChildProcess;
  terminate(child: ChildProcess): Promise<boolean>; // exact owned process group, bounded termination + confirmed absence
  usage(child: ChildProcess | undefined): Resources | null;
};
export type DiagnosisAuthorization = {
  snapshot: Snapshot; facts: Facts; family: ModelFamily; policy: SupervisorPolicy;
  registered: boolean; globalAllowed: boolean; paused: boolean; outsideAdmissionLocks: boolean;
  /** Integer micro-USD and token cumulative limits shared by ALL projects in this host journal. */
  shared: Resources; capacity: number;
};
export type WorkerOptions = {
  stateDir: string; current(): DiagnosisAuthorization; boundary?: ComponentDiagnosisBoundary;
  signal?: AbortSignal; now?: () => number; invocationId: string; fence: string;
  /** Explicit provider-extension path, not a credential. No provider discovery or fallback. */
  subscriptionExtension?: string;
  timer?: (callback: () => void, ms: number) => () => void;
};
export type DiagnosisResult = { state: 'held'; reason: string } | { state: 'proposed' | 'reused'; decision: DiagnosisDecision; diagnosticId: string }
  | { state: 'human-required'; reason: string; diagnosticId: string };
const money = (usd: number) => Math.floor(usd * 1_000_000);
const resources = (x: Resources) => x && Number.isSafeInteger(x.tokens) && x.tokens > 0 && Number.isSafeInteger(x.cost) && x.cost > 0;
const held = (reason: string): DiagnosisResult => ({ state: 'held', reason });
const capped = (b: Buffer, bytes: number) => { const value = b.toString('utf8'); return Buffer.byteLength(value) <= bytes ? value : b.subarray(0, bytes - 3).toString('utf8'); };
const same = (a: unknown, b: unknown) => supervisorHash(a) === supervisorHash(b);
function usage(s: SupervisorState, kind?: 'diagnosis') {
  const calls = Object.values(s.reservations).filter(r => !kind || r.kind === kind);
  return { tokens: calls.reduce((n,r) => n + r.reserved.tokens, 0), costUsd: calls.reduce((n,r) => n + r.reserved.cost, 0) / 1_000_000, calls: calls.length };
}
function hostHold(a: DiagnosisAuthorization): string | undefined {
  validateSnapshot(a.snapshot);
  if (!a.registered || a.policy?.enabled !== true || !a.globalAllowed || a.paused || !a.outsideAdmissionLocks || a.snapshot.mode === 'stopped') return 'Current host authorization/lock/pause/stop holds diagnosis';
  if (!['openai','anthropic'].includes(a.family)) return 'Unknown configured family';
  if (!resources(a.shared) || !Number.isSafeInteger(a.capacity) || a.capacity <= 0) return 'Finite shared budgets/capacity required';
}
function memory(s: SupervisorState): DiagnosisMemory[] {
  return Object.values(s.diagnostics ?? {}).sort((a,b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id)).map(d => ({
    id: d.id, basisHash: d.basisHash, outcome: d.outcome, rationale: d.reason, reference: d.inputRef,
  }));
}
/** No automatic caller/scheduler wiring. Host must invoke after releasing its admission/scheduler locks. */
export async function diagnoseProject(o: WorkerOptions): Promise<DiagnosisResult> {
  const current = () => {
    const a = o.current(), control = readSupervisor(o.stateDir, a.snapshot.project).control;
    // A persisted mode can narrow current host authorization, never upgrade it.
    const mode = control?.mode === 'stopped' || a.snapshot.mode === 'stopped' ? 'stopped'
      : control?.mode === 'observe' || a.snapshot.mode === 'observe' ? 'observe' : a.snapshot.mode;
    return { ...a, snapshot: { ...a.snapshot, mode } };
  };
  const now = o.now ?? Date.now, iso = () => new Date(now()).toISOString();
  const timer = o.timer ?? ((f, ms) => { const t = setTimeout(f, ms); return () => clearTimeout(t); });
  let a: DiagnosisAuthorization, s: SupervisorState, owner: Owner;
  try {
    a = structuredClone(current()); const hold = hostHold(a); if (hold) return held(hold);
    const rel = relative(resolve(a.snapshot.project.root), resolve(o.stateDir));
    if (!rel || !rel.startsWith('..') && !rel.startsWith('/')) return held('Journal must be host-owned outside project/agent mounts');
    owner = ownerOf(process.pid); if (!owner.start) return held('Unknown controller PID/start identity');
    s = readSupervisor(o.stateDir, a.snapshot.project);
  } catch (e) { return held(String(e)); }
  const project = a.snapshot.project, incidentId = incidentIdentity(project, a.facts), basisHash = diagnosisBasis(a.snapshot);
  const commit = (event: Event) => { s = commitSupervisor(o.stateDir, project, s.revision, event); };
  const stamp = (suffix: string) => `${o.invocationId}:${suffix}`;
  try {
    if (!same(a.facts.scope, a.snapshot.scope) || a.facts.runId !== a.snapshot.material.runId) return held('Incident/snapshot scope mismatch');
    commit({ id: stamp('observe'), at: iso(), kind: 'observe', facts: a.facts, snapshotHash: supervisorHash(a.snapshot), reason: 'Bounded project diagnosis' });
    const m = s.incidents[incidentId];
    if (m.superseded || m.denied || m.incident.state === 'human-required' || supervisorHumanHold(s) || supervisorRevisionHold(s)) return held('Retained human/denial/supersession holds diagnosis');
    // Known unchanged decisions (especially waits) do not spend another call after restart.
    const known = Object.values(s.diagnostics ?? {}).find(d => d.incidentId === incidentId && d.basisHash === basisHash && d.outcome === 'proposed');
    if (o.signal?.aborted) return held('Diagnosis cancelled before reuse/reservation');
    if (known?.decision) {
      const expected = join(o.stateDir, 'supervisor', supervisorHash(project.root), supervisorHash(known.reservationId), 'input.json');
      if (known.inputRef !== expected) return held('Retained diagnosis input reference escaped its owned location');
      const fd = openSync(expected, constants.O_RDONLY | constants.O_NOFOLLOW);
      let retained: { snapshot: Snapshot };
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return held('Retained frozen diagnosis input is unknown/oversized');
        retained = JSON.parse(readFileSync(fd, 'utf8'));
      } finally { closeSync(fd); }
      if (supervisorHash(validateSnapshot(retained.snapshot)) !== known.snapshotHash || diagnosisBasis(retained.snapshot) !== basisHash)
        return held('Retained original diagnosis input changed; no reuse');
      // Reuse the original exact proposal, never rebind it to a later observation timestamp.
      validateDiagnosisDecision(known.decision, retained.snapshot, incidentId);
      if (known.decision.action.kind === 'gate-change' && Date.parse(known.decision.action.proposal.change.expiresAt) <= now()) return held('Cached gate proposal expired; no reusable decision');
      if (known.decision.action.kind === 'escalate') return held('Retained escalation requires its atomic human stop');
      return { state: 'reused', decision: known.decision, diagnosticId: known.id };
    }
    if (m.incident.diagnosisCalls >= 2) {
      const prior = Object.values(s.diagnostics ?? {}).filter(d => d.incidentId === incidentId).at(-1);
      if (prior) {
        const request: HumanRequest = { version: 1, id: stamp('exhausted'), project, scope: a.snapshot.scope, incidentId, proposalId: prior.id,
          reason: 'authority-uncertain', question: 'Diagnosis exhausted its unchanged-incident allowance without a current reusable decision. What authorized evidence or project-local step is needed?',
          evidence: [prior.inputRef], nextAction: 'Inspect retained diagnoses and current original evidence. Explicitly decide the next step without resetting budgets, clearing denial or accepting stale output.',
          delivery: { state: 'pending', attempts: 0 }, stop: 'required' };
        commit({ id: stamp('exhausted'), at: iso(), kind: 'human', request });
        return { state: 'human-required', reason: 'Unchanged-incident diagnosis exhausted', diagnosticId: prior.id };
      }
      return held('Diagnosis allowance exhausted; inspect retained reservations and establish authoritative cleanup/accounting');
    }
    if (o.signal?.aborted) return held('Diagnosis cancelled before reservation');
    const b = o.boundary, model = modelForRole(a.family, 'supervisor').model;
    if (!b || b.model !== model || b.enforceable !== true || !resources(b.reservation)) return held('Provider-enforceable all-in token/cost ceilings for fixed Mid are unavailable; paid work held');
    const limits = a.policy.limits;
    const preflight = supervisorCallHold(a.policy, 'diagnosis', { registered: a.registered, mode: a.snapshot.mode, globalAllowed: a.globalAllowed,
      pricingKnown: b.pricingKnown, accountingKnown: b.accountingKnown && !Object.values(s.reservations).some(r => r.state !== 'finished'),
      project: usage(s), role: usage(s, 'diagnosis'), reservation: { tokens: b.reservation.tokens, costUsd: b.reservation.cost / 1_000_000, calls: 1 },
      diagnosisCalls: m.incident.diagnosisCalls, activeDecisions: Object.values(s.reservations).filter(r => r.state !== 'finished').length });
    if (preflight || !limits) return held(preflight ?? 'Missing limits');
    const args = piAnalysisArgs(model, { FACTORY_PI_SUBSCRIPTION_EXTENSION: o.subscriptionExtension }, existsSync);
    // Frozen originals on stdin only; even filesystem reader tools could expose arbitrary host secrets.
    const tools = args.indexOf('--tools'); args.splice(tools, 2, '--no-tools');
    const input = readFileSync(new URL(flat ? './prompt.supervisor.md' : '../../orchestrator/prompt.supervisor.md', import.meta.url), 'utf8')
      + '\n\n' + JSON.stringify({ ...diagnosisContext(a.snapshot, incidentId, memory(s)), basisHash });
    const startedAt = iso(), deadline = new Date(Date.parse(startedAt) + limits.diagnosis.timeoutSeconds * 1000).toISOString();
    const dir = join(o.stateDir, 'supervisor', supervisorHash(project.root), supervisorHash(o.invocationId));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const inputRef = join(dir, 'input.json'); writeDurable(inputRef, JSON.stringify({ snapshot: a.snapshot, prompt: input }) + '\n');
    const journalLimits: Limits = { project: { tokens: limits.maxTokens, cost: money(limits.maxCostUsd) }, shared: a.shared,
      capacity: a.capacity, reviewCalls: limits.review.maxCalls, reviewTimeoutMs: limits.review.timeoutSeconds * 1000 };
    commit({ id: stamp('reserve'), at: startedAt, kind: 'reserve', limits: journalLimits,
      reservation: { id: o.invocationId, incidentId, kind: 'diagnosis', owner, fence: o.fence, at: startedAt, deadline,
        reserved: b.reservation, actual: null, state: 'active', reviewId: null } });
    let child: ChildProcess | undefined, outcome: Diagnostic['outcome'] = 'process-failed', reason = 'Worker failed before launch';
    let stdout = '', stderr = '', confirmed = true, actual: Resources | null = null, decision: DiagnosisDecision | null = null;
    try {
      const fresh = current(); const hold = hostHold(fresh);
      const { snapshot: freshSnapshot, ...freshAuth } = fresh, { snapshot: oldSnapshot, ...oldAuth } = a;
      if (hold || diagnosisBasis(freshSnapshot) !== basisHash || !same(freshAuth, oldAuth) || o.signal?.aborted) { outcome = 'cancelled'; reason = hold ?? 'Authorization changed before spawn'; }
      else {
        child = b.start('pi', args, { cwd: dir, detached: true, input, deadline, maxOutputBytes: DIAGNOSIS_OUTPUT_BYTES, reservation: b.reservation });
        // Retained group ownership survives controller failure. Never infer orphan cleanup or release a dead controller's charge.
        writeDurable(join(dir, 'process.json'), JSON.stringify({ controller: owner, pid: child.pid ?? null, fence: o.fence, reservationId: o.invocationId, deadline }) + '\n');
        const result = await new Promise<{ outcome: Diagnostic['outcome']; reason: string; confirmed: boolean }>(accept => {
          let done = false, out = Buffer.alloc(0), err = Buffer.alloc(0), cancelTimer = () => {};
          let cleanup: Promise<boolean> | undefined, closed = false, exitCode: number | null = null;
          const clean = () => cleanup ??= (async () => { try { return await b.terminate(child!); } catch { return false; } })();
          const finish = async (state: Diagnostic['outcome'], why: string) => {
            if (done) return; done = true; cancelTimer(); o.signal?.removeEventListener('abort', abort);
            const gone = await clean();
            stdout = capped(out, DIAGNOSIS_OUTPUT_BYTES); stderr = capped(err, 8192);
            accept({ outcome: state, reason: why, confirmed: gone });
          };
          const abort = () => { void finish('cancelled', 'Diagnosis cancelled; no proposal authority'); };
          cancelTimer = timer(() => { void finish('timeout', 'Diagnosis deadline exhausted'); }, Math.max(0, Date.parse(deadline) - now()));
          child!.stdout?.on('data', chunk => { if (done) return; const bytes = Buffer.from(chunk); const overflow = out.length + bytes.length > DIAGNOSIS_OUTPUT_BYTES;
            out = Buffer.concat([out, bytes.subarray(0, DIAGNOSIS_OUTPUT_BYTES - out.length)]); if (overflow) void finish('malformed', 'Diagnosis output overflow'); });
          child!.stderr?.on('data', chunk => { if (done) return; err = Buffer.concat([err, Buffer.from(chunk)]).subarray(0, 8188); });
          child!.once('error', e => { void finish('process-failed', `Pi process failed: ${e.message}`); });
          // Exit does not mean pipes drained. Begin owned-group cleanup on exit, but retain bounded data through close.
          // Descendant-held pipes cannot extend the deadline; timeout/cancel still finish immediately and fail closed.
          const completed = () => { if (closed) void finish(exitCode === 0 ? 'proposed' : 'process-failed', exitCode === 0 ? 'Process/pipes completed; output still requires validation' : `Pi exited ${exitCode}`); };
          child!.once('exit', code => { exitCode = code; void clean().then(completed); });
          child!.once('close', code => { closed = true; exitCode = code; completed(); });
          o.signal?.addEventListener('abort', abort, { once: true }); if (o.signal?.aborted) abort();
        });
        ({ outcome, reason, confirmed } = result);
      }
    } catch (e) {
      reason = String(e).slice(0, 4000); outcome = 'process-failed';
      if (child) { try { confirmed = await b.terminate(child); } catch { confirmed = false; } }
    }
    try { actual = b.usage(child); } catch { actual = null; }
    if (actual !== null && (!Number.isSafeInteger(actual.tokens) || actual.tokens < 0 || !Number.isSafeInteger(actual.cost) || actual.cost < 0
      || actual.tokens > b.reservation.tokens || actual.cost > b.reservation.cost)) actual = null;
    if (!confirmed || actual === null) { outcome = 'process-failed'; reason = 'Unknown process-group cleanup or final accounting; reservation/capacity retained'; }
    if (outcome === 'proposed') {
      try {
        const fresh = current();
        if (o.signal?.aborted || hostHold(fresh) || diagnosisBasis(fresh.snapshot) !== basisHash || !same(fresh.facts, a.facts)
          || fresh.family !== a.family || !same(fresh.policy, a.policy) || !same(fresh.shared, a.shared) || fresh.capacity !== a.capacity)
          { outcome = 'stale'; reason = 'Current authorization/material basis changed; no proposal authority'; }
        else if (now() >= Date.parse(deadline)) { outcome = 'timeout'; reason = 'Late output cannot succeed'; }
        else {
          decision = parseDiagnosis(stdout, a.snapshot, incidentId);
          if (decision.action.kind === 'gate-change' && Date.parse(decision.action.proposal.change.expiresAt) <= now()) throw Error('Gate proposal already expired');
          if (decision.action.kind === 'gate-change' && supervisorRevisionHold(s, decision.action.proposal.id)) throw Error('Diagnosis differs from exact operator-permitted revision');
          reason = decision.rationale;
        }
      } catch (e) { outcome = 'malformed'; reason = String(e).slice(0, 4000); }
    }
    if (outcome !== 'proposed') decision = null;
    const body = { reservationId: o.invocationId, incidentId, basisHash, snapshotHash: supervisorHash(a.snapshot), fence: o.fence, startedAt, completedAt: iso(), inputRef,
      outcome, reason, stdout, stderr, decision };
    const diagnostic: Diagnostic = { id: supervisorHash(body), ...body }; validateDiagnostic(diagnostic);
    // Retain raw bounded diagnostics even if a concurrent stop/CAS makes journal publication fail.
    writeDurable(join(dir, 'result.json'), JSON.stringify(diagnostic) + '\n');
    let request: HumanRequest | null = null;
    if (!decision || decision.action.kind === 'escalate') {
      const action = decision?.action.kind === 'escalate' ? decision.action : null;
      request = { version: 1, id: stamp('human'), project, scope: action?.factoryWide ? { kind: 'project' } : a.snapshot.scope,
        incidentId, proposalId: diagnostic.id, reason: action?.factoryWide ? 'factory-wide' : 'authority-uncertain',
        question: action?.question ?? `Diagnosis did not produce a usable proposal: ${reason}`,
        nextAction: action?.nextAction ?? 'Inspect retained input/output, confirm process cleanup and accounting, and decide the next authorized project step. Do not reset budgets or reuse stale output.',
        evidence: [inputRef, join(dir, 'result.json')], stop: 'required', delivery: { state: 'pending', attempts: 0 } };
    }
    s = readSupervisor(o.stateDir, project);
    // One atomic publication: completion + exact gate proposal OR actionable human stop, with no crash/reuse gap.
    commit({ id: stamp('result'), at: diagnostic.completedAt, kind: 'diagnosis', diagnostic, owner, actual, processConfirmed: confirmed, request });
    if (request || !decision) return { state: 'human-required', reason, diagnosticId: diagnostic.id };
    return { state: 'proposed', decision, diagnosticId: diagnostic.id };
  } catch (e) { return held(String(e)); }
}
