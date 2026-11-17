// Short tick wake collection and explicit outside-lock, short-lived supervisor transport. Hints never authorize work.
// Existing diagnosis/review/application journals own fences, reservations, accounting and ambiguity; no retry scheduler.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { diagnoseProject } from './supervisor-worker.mts';
import type { WorkerOptions, DiagnosisResult, DiagnosisAuthorization } from './supervisor-worker.mts';
import { reviewGateProposal } from './supervisor-review.mts';
import type { ReviewOptions } from './supervisor-review.mts';
import { applyReviewedGate } from './supervisor-gate-apply.mts';
import type { GateOptions, GateResult } from './supervisor-gate-apply.mts';
import { readSupervisor } from './supervisor-state.mts';
import type { SupervisorState } from './supervisor-state.mts';
import type { DiagnosisDecision } from '../../orchestrator/supervisor.mts';
import type { HostOutcome } from '../../orchestrator/supervisor-contract.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { diagnosisBasis } = await import(flat ? './supervisor.mts' : '../../orchestrator/supervisor.mts');
const { supervisorHash } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
export type SupervisorWakeKind = 'checkpoint' | 'pass-completed' | 'run-failure' | 'gate-refusal' | 'delivery' | 'prerequisites' | 'requirements' | 'owner-response';
const kinds: SupervisorWakeKind[] = ['checkpoint','pass-completed','run-failure','gate-refusal','delivery','prerequisites','requirements','owner-response'];
export type SupervisorWake = { root: string; kinds: SupervisorWakeKind[] };
/** enqueue MUST be synchronous and local only. handoff is called only after tick lock release, never awaited.
 * Cancellation is a narrowing signal, not permission to signal an arbitrary PID or implementation group. */
export type SupervisorTickHook = {
  enqueue(root: string, kind: SupervisorWakeKind): void;
  handoff(signal: AbortSignal): void;
};
/** One current host binding per project, with complete original context, fixed roles and trusted provider adapters.
 * admissionHold must freshly consult the EXISTING admission/recovery owner and finite shared resources. In particular,
 * recovery excludes diagnosis; active implementation permits only read-only diagnosis with independently available
 * finite capacity. It must not reserve/charge a second recovery budget or infer permission from a Board projection.
 * No default binding/paid adapter is shipped. This is a source API, not config, an environment selector or a pilot. */
export type SupervisorHost = {
  diagnosis: Omit<WorkerOptions, 'signal' | 'invocationId' | 'fence' | 'current'> & { current(): DiagnosisAuthorization };
  admissionHold(): string | undefined;
  review?(decision: DiagnosisDecision): Omit<ReviewOptions, 'signal'>;
  application?(decision: DiagnosisDecision): GateOptions;
};
export type SupervisorWakeResult = { root: string; state: 'held'; reason: string }
  | { root: string; state: 'completed'; diagnosis: DiagnosisResult; review?: HostOutcome; application?: GateResult };
const held = (root: string, reason: string): SupervisorWakeResult => ({ root, state: 'held', reason });
/** Necessary scheduling policy only; the worker still atomically reserves the existing journal's finite resources. */
export function supervisorScheduleHold(a: DiagnosisAuthorization, control: SupervisorState['control'], cancelled: boolean): string | undefined {
  if (!a.registered || !a.policy.enabled || a.globalAllowed !== true || a.paused || !a.outsideAdmissionLocks
    || a.snapshot.mode !== 'act' || control?.mode !== 'act' || !control.pilot || cancelled)
    return 'Current opt-in/global/pause/control/cancellation fence holds supervisor';
}
/** Enqueues only bounded hints while tick holds its lock. The post-lock handoff owns no model context: each host
 * binding and each worker is fresh. Stable material identity (not hints, timestamps, or refresh output) coalesces work.
 * Restart uses the existing retained diagnosis and unsettled reservations; nothing resets budgets or reclaims owners.
 * One instance must be retained by a trusted scheduler host if it wants live in-process cancellation. A separate CLI
 * without such a handle still reports cancellation pending; process sidecars are NOT kill authority. */
export function supervisorWakeups(bind: (root: string) => SupervisorHost | undefined,
  report: (result: SupervisorWakeResult) => void = () => {}): SupervisorTickHook & {
    cancel(root: string): boolean; settled(): Promise<void>;
  } {
  const pending = new Map<string, Set<SupervisorWakeKind>>();
  const active = new Map<string, { controller: AbortController; check(): void }>();
  const jobs = new Set<Promise<void>>();
  const cancel = (root: string) => { const entry = active.get(root); entry?.controller.abort(); return !!entry; };
  const run = async (wake: SupervisorWake, signal: AbortSignal) => {
    const root = wake.root;
    if (signal.aborted) return held(root, 'Tick cancelled before handoff');
    if (active.has(root)) return held(root, 'Logical project worker already active');
    const host = bind(root);
    if (!host) return held(root, 'No trusted supervisor host/provider/authority transport configured');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const entry = { controller, check: () => {} }; active.set(root, entry);
    try {
      const current = () => {
        const a = host.diagnosis.current();
        if (a.snapshot.project.root !== root) throw Error('Foreign project transport');
        const s = readSupervisor(host.diagnosis.stateDir, a.snapshot.project);
        // Scheduling never interprets refresh, model output or a tracker response as act/pilot authorization.
        const policyHold = supervisorScheduleHold(a, s.control, controller.signal.aborted);
        if (policyHold) throw Error(policyHold);
        const hold = host.admissionHold(); if (hold) throw Error(hold);
        return a;
      };
      const a = current(), basis = diagnosisBasis(a.snapshot), control = supervisorHash(readSupervisor(host.diagnosis.stateDir, a.snapshot.project).control);
      const authorizationHash = (value: DiagnosisAuthorization) => { const { snapshot, ...authorization } = value; return supervisorHash(authorization); };
      const fresh = () => {
        const next = current();
        if (diagnosisBasis(next.snapshot) !== basis || authorizationHash(next) !== authorizationHash(a)
          || supervisorHash(readSupervisor(host.diagnosis.stateDir, next.snapshot.project).control) !== control)
          throw Error('Material/owner control changed during handoff');
        return next;
      };
      entry.check = () => { fresh(); };
      const diagnosis = await diagnoseProject({ ...host.diagnosis, current: fresh, signal: controller.signal,
        invocationId: randomUUID(), fence: randomUUID() });
      const result: Extract<SupervisorWakeResult, { state: 'completed' }> = { root, state: 'completed', diagnosis };
      if (diagnosis.state !== 'proposed' && diagnosis.state !== 'reused') return result;
      // Non-gate decisions remain advice to the EXISTING afterPass broker, never a new repair/retry launcher.
      if (diagnosis.decision.action.kind !== 'gate-change') return result;
      fresh();
      if (!host.review) return held(root, 'Exact independent-review transport unavailable; retained proposal only');
      const review = host.review(diagnosis.decision);
      const exact = () => {
        fresh(); const r = review.current();
        if (r.input.snapshot.project.root !== root || supervisorHash(r.input.proposal) !== supervisorHash(diagnosis.decision.action.kind === 'gate-change' ? diagnosis.decision.action.proposal : null)
          || diagnosisBasis(r.input.snapshot) !== basis || review.stateDir !== host.diagnosis.stateDir
          || r.family !== a.family || supervisorHash(r.policy) !== supervisorHash(a.policy) || supervisorHash(r.shared) !== supervisorHash(a.shared)
          || r.capacity !== a.capacity || !r.registered || r.globalAllowed !== true || r.paused || !r.outsideAdmissionLocks)
          throw Error('Review transport did not retain exact original proposal/context/journal');
        return r;
      };
      result.review = await reviewGateProposal({ ...review, current: exact, signal: controller.signal });
      fresh();
      if (result.review.state !== 'review-approved' || !host.application) return result;
      const application = host.application(diagnosis.decision);
      const authorized = () => {
        const r = exact(), g = application.current();
        if (application.stateDir !== review.stateDir || supervisorHash(g.input) !== supervisorHash(r.input)) throw Error('Application transport changed reviewed originals');
        return g;
      };
      result.application = await applyReviewedGate({ ...application, current: authorized });
      // An artifact is NOT proof. The host must explicitly carry loadExecutionContext({gate}) through normal analysis,
      // separate verification and postAndDeliver. No ambient selector or checkout rewrite is provided here.
      return result;
    } catch (e) { return held(root, String(e)); }
    finally { active.delete(root); signal.removeEventListener('abort', abort); }
  };
  return {
    enqueue(root, kind) {
      if (!root.startsWith('/') || !kinds.includes(kind)) throw Error('Invalid supervisor wake hint');
      if (!pending.has(root) && pending.size >= 1024) throw Error('Supervisor wake bound exceeded');
      const set = pending.get(root) ?? new Set<SupervisorWakeKind>(); set.add(kind); pending.set(root, set);
    },
    handoff(signal) {
      if (signal.aborted) { for (const root of active.keys()) cancel(root); pending.clear(); return; }
      for (const [root, entry] of active) { try { entry.check(); } catch { cancel(root); } }
      const batch = [...pending].map(([root, set]) => ({ root, kinds: [...set] })); pending.clear();
      // Start in a microtask so even a synchronous host collector is never run in the caller's tick/admission scope.
      for (const wake of batch) {
        const job = Promise.resolve().then(() => run(wake, signal)).then(result => { report(result); }).catch(() => { /* reporting cannot affect scheduler cadence */ });
        jobs.add(job); void job.finally(() => jobs.delete(job));
      }
    }, cancel,
    async settled() { await Promise.all([...jobs]); },
  };
}
