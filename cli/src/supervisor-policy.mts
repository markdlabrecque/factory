// Thin host broker for retained diagnosis advice: no model writes, scheduler, gate edits, tracker or delivery authority.
// Repair candidates enter only afterPass's existing preparation/claim-and-charge path; current host and durable operator fences are rechecked there.
import { existsSync } from 'node:fs';
import type { Snapshot, HumanRequest } from '../../orchestrator/supervisor-contract.mts';
import type { RecoveryState } from './recovery-state.mts';
import type { SupervisorState } from './supervisor-state.mts';
import type { DiagnosisDecision } from '../../orchestrator/supervisor.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { supervisorHash } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
const { validateDiagnosisDecision, validateDiagnostic, diagnosisBasis } = await import(flat ? './supervisor.mts' : '../../orchestrator/supervisor.mts');

/** Host observations, not fields accepted from a model. Missing/unknown capability holds. No default activation adapter. */
export type BrokerFacts = {
  snapshot: Snapshot; state: SupervisorState; diagnosticId: string;
  enabled: boolean; registered: boolean; global: 'on' | 'off' | 'unknown'; project: 'enabled' | 'paused' | 'unknown';
  activationAuthorized: boolean; escalationBridgeReady: boolean; fence: string; expiresAt: string;
  /** Existing recovery store, never the bounded status projection. Null or incomplete retained history holds. */
  recovery: RecoveryState | null;
  run: { ticket: number; runId: string; state: 'stopped' | 'active' | 'unknown' | 'merged'; ci: 'none' | 'waiting' | 'failed' | 'unknown' };
};
export type RepairCandidate = {
  id: string; ticket: number; runId: string;
  /** Synchronous current-time check also invoked inside the existing atomic admission owner. */
  authorize(): boolean;
};
export type BrokerOutcome =
  | { state: 'held' | 'refused'; reason: string }
  | { state: 'wait'; expectation: string }
  | { state: 'draft'; id: string; title: string; body: string; approval: 'human-required' }
  | { state: 'human-required'; request: HumanRequest; delivery: 'pending' }
  | { state: 'candidate'; candidate: RepairCandidate };
const same = (a: unknown, b: unknown) => supervisorHash(a) === supervisorHash(b);
function fenceIdentity(f: BrokerFacts): string {
  // Preparation/follow-up writes and observation timestamps are not new authority. Admission still checks the
  // actual preparation under its lock. Binding those display fields here would fence every successful preparation.
  const r = f.recovery;
  return supervisorHash({ ...f, snapshot: diagnosisBasis(f.snapshot), recovery: r && {
    root: r.root, nextSeq: r.nextSeq, attempts: r.attempts, budgets: r.budgets,
    episode: r.episode ? { id: r.episode.id, generation: r.episode.generation ?? null, tickets: r.episode.tickets, confirmedAt: r.episode.confirmedAt ?? null } : null,
  } });
}

/** Explicit pure host decision. Consumers retain host outcomes separately from diagnosis claims. Returning a candidate
 * is NOT admission. No bridge invocation, notification receipt, gate application or automatic follow-up creation occurs. */
export function brokerSupervisor(current: () => BrokerFacts, now: () => number = Date.now): BrokerOutcome {
  try { return decide(current, now); }
  catch (e) { return { state: 'held', reason: `Unknown host broker facts: ${String(e)}` }; }
}
function decide(current: () => BrokerFacts, now: () => number): BrokerOutcome {
  let f: BrokerFacts, decision: DiagnosisDecision;
  try {
    f = structuredClone(current());
    const s = f.state, d = s.diagnostics?.[f.diagnosticId];
    if (!same(s.project, f.snapshot.project)) return { state: 'refused', reason: 'Foreign journal project' };
    if (!d || d.outcome !== 'proposed' || !d.decision) return { state: 'held', reason: 'No retained successful diagnosis' };
    validateDiagnostic(d);
    decision = validateDiagnosisDecision(d.decision, f.snapshot, d.incidentId);
    if (Object.values(s.reservations).some(r => r.state !== 'finished')) return { state: 'held', reason: 'Unsettled supervisor worker ownership' };
    const incident = s.incidents[d.incidentId];
    if (!incident || incident.superseded || Object.values(s.incidents).some(m => typeof m.denied !== 'boolean' || typeof m.superseded !== 'boolean' || m.denied || m.incident.state === 'human-required') || Object.keys(s.humans).length)
      return { state: 'held', reason: 'Durable human/denial/unknown incident hold' };
    if (s.control && s.control.mode !== 'act' || f.enabled !== true || f.registered !== true || f.snapshot.mode !== 'act' || f.global !== 'on' || f.project !== 'enabled')
      return { state: 'held', reason: 'Current mode/project/scheduler authorization holds supervisor effects' };
    if (!f.fence || !Number.isFinite(now()) || !Number.isFinite(Date.parse(f.expiresAt)) || Date.parse(f.expiresAt) <= now())
      return { state: 'held', reason: 'Current host fence expired or unknown' };
  } catch (e) { return { state: 'held', reason: String(e) }; }
  const action = decision.action;
  const id = supervisorHash({ project: f.snapshot.project, diagnosticId: f.diagnosticId, decision });
  if (action.kind === 'gate-change') return { state: 'refused', reason: 'Only the independently reviewed apply module may consider gate amendments' };
  if (action.kind === 'wait' || action.kind === 'observe') return { state: 'wait', expectation: action.expectation };
  if (action.kind === 'follow-up-draft') return { state: 'draft', id, title: action.title, body: action.body, approval: 'human-required' };
  if (action.kind === 'escalate') return { state: 'human-required', delivery: 'pending', request: {
    version: 1, id, project: f.snapshot.project, scope: action.factoryWide ? { kind: 'project' } : f.snapshot.scope, incidentId: decision.incidentId, proposalId: f.diagnosticId,
    reason: action.factoryWide ? 'factory-wide' : 'authority-uncertain', question: action.question, nextAction: action.nextAction,
    evidence: [f.state.diagnostics![f.diagnosticId].inputRef], stop: 'required', delivery: { state: 'pending', attempts: 0 },
  } };
  if (f.run.ci === 'waiting') return { state: 'wait', expectation: 'Continue existing CI follow-through; no new repair or model budget' };
  if (f.run.ci === 'unknown' || f.run.state === 'unknown') return { state: 'held', reason: 'Unknown current run/CI ownership' };
  if (f.run.state !== 'stopped' || f.run.runId !== action.runId || f.run.ticket !== action.ticket)
    return { state: 'refused', reason: 'Repair requires the exact current stopped host run, not an open PR' };
  const recovery = f.recovery;
  if (!recovery || recovery.root !== f.snapshot.project.root || !Number.isSafeInteger(recovery.nextSeq) || recovery.nextSeq < 1
      || recovery.attempts.length !== recovery.nextSeq - 1 || recovery.attempts.some((a, i) => a.seq !== i + 1))
    return { state: 'held', reason: 'Unknown or incomplete existing recovery accounting; bounded history cannot prove no prior charge' };
  // Existing attempt timestamps predate asynchronous admission and are not an admission fence. Without a retained
  // atomic recovery baseline in the diagnosis contract, conservatively hold ANY prior charge for this ticket.
  // Existing automatic recovery may still use its remaining budget; this broker cannot infer a fresh retry right.
  const prior = recovery.attempts.find(a => a.ticket === action.ticket);
  if ((recovery.budgets[String(action.ticket)]?.used ?? 0) !== 0) return { state: 'held', reason: 'Existing ticket recovery budget has been charged or is unknown' };
  if (prior) return { state: 'held', reason: `Existing recovery ${prior.id ?? 'unknown'} has charged this ticket; no supervisor replay or inferred retry authority` };
  if (f.activationAuthorized !== true || f.escalationBridgeReady !== true) return { state: 'held', reason: 'Action activation/host escalation bridge unavailable; pending, never delivered or authorized by local state' };
  // Bind the callback to these exact inputs. It can only narrow authority after asynchronous preparation/readiness.
  const identity = fenceIdentity(f);
  return { state: 'candidate', candidate: { id, ticket: action.ticket, runId: action.runId, authorize: () => {
    try {
      const fresh = current();
      if (!Number.isFinite(now()) || fenceIdentity(fresh) !== identity || Date.parse(fresh.expiresAt) <= now()) return false;
      return (!fresh.state.control || fresh.state.control.mode === 'act') && fresh.enabled && fresh.registered && fresh.snapshot.mode === 'act' && fresh.global === 'on' && fresh.project === 'enabled'
        && fresh.activationAuthorized && fresh.escalationBridgeReady;
    } catch { return false; }
  } } };
}

/** Host launch observation, never a model claim or a new recovery truth store. Persist via the caller's audit boundary. */
export type BrokerAdmissionOutcome = { candidateId: string; state: 'admitted' | 'held' | 'refused'; attemptId?: string; reason: string };
