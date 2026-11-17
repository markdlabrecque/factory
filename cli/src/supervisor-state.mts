// Host-owned supervisor journal: atomic CAS transitions, retained incidents/denials and separately charged resources.
// Retains operator fences, diagnosis/review completion, host outbox receipts and exact local resolution audits; never applies gates or resets charges.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Owner } from '../../board/admission.mts';
import type { ProjectIdentity, Scope, Incident, Proposal, IndependentReview, Intent, HumanRequest } from '../../orchestrator/supervisor-contract.mts';
const { ownerState, withAdmissionLock, writeDurable } = await import(existsSync(new URL('./admission.mts', import.meta.url)) ? './admission.mts' : '../../board/admission.mts');
const { supervisorHash, validateProject, validateScope, validateIncident, validateProposal, validateIndependentReview, validateIntent, validateHumanRequest } = await import(existsSync(new URL('./supervisor-contract.mts', import.meta.url)) ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');

import type { Diagnostic } from '../../orchestrator/supervisor.mts';
const { validateDiagnostic } = await import(existsSync(new URL('./supervisor.mts', import.meta.url)) ? './supervisor.mts' : '../../orchestrator/supervisor.mts');

export const HISTORY_LIMIT = 100;
export const DIAGNOSIS_TIMEOUT_MS = 600_000;
export type Facts = { scope: Scope; requirements: string; gate: string; runId: string; failure: string };
export type IncidentMemory = { incident: Incident; facts: Facts; superseded: boolean; denied: boolean };
export type Resources = { tokens: number; cost: number };
export type Reservation = {
  id: string; incidentId: string; kind: 'diagnosis' | 'review'; owner: Owner; fence: string;
  at: string; deadline: string; reserved: Resources; actual: Resources | null;
  state: 'active' | 'finished' | 'ambiguous'; reviewId: string | null;
};
export type IntentMemory = { intent: Intent; owner: Owner; outcome: 'pending' | 'observed-applied' | 'observed-not-applied' | 'unknown'; evidence: string[] };
export type SupervisorState = {
  version: 1; project: ProjectIdentity; revision: number;
  control?: { mode: 'observe' | 'act' | 'stopped'; actor: string; at: string; pilot: boolean };
  incidents: Record<string, IncidentMemory>; proposals: Record<string, Proposal>; reviews: Record<string, IndependentReview>;
  intents: Record<string, IntentMemory>; humans: Record<string, HumanRequest>; reservations: Record<string, Reservation>;
  /** Absent only in pre-diagnosis version-1 journals. Added without discarding any old safety indexes. */
  diagnostics?: Record<string, Diagnostic>;
  reviewCompletions?: Record<string, { inputRef: string; policy: string; proposer: string }>;
  deliveries?: Record<string, { requestId: string; target: number; attemptedAt: string }>;
  resolutions?: Record<string, { requestId: string; proposalId: string; actor: string; reason: string; at: string; nextProposalId: string | null }>;
  // Safety indexes and counters are never truncated with the display history.
  events: Record<string, string>; charged: Record<'diagnosis' | 'review', Resources>;
  history: { event: string; at: string; kind: string }[];
};
type Journal = { version: 1; projects: Record<string, SupervisorState> };
export type Limits = { project: Resources; shared: Resources; capacity: number; reviewCalls: number; reviewTimeoutMs: number };
export type Event = { id: string; at: string } & (
  | { kind: 'control'; mode: 'observe' | 'act' | 'stopped'; actor: string; pilot: boolean }
  | { kind: 'observe'; facts: Facts; snapshotHash: string; reason: string }
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'review'; review: IndependentReview; reservationId: string; fence: string; owner: Owner }
  | { kind: 'human'; request: HumanRequest }
  | { kind: 'review-complete'; review: IndependentReview; reservationId: string; fence: string; owner: Owner; actual: Resources | null; processConfirmed: boolean; request: HumanRequest | null; provenance: { inputRef: string; policy: string; proposer: string } }
  | { kind: 'notify-attempt'; incidentId: string; requestId: string; target: number }
  | { kind: 'notify-ack'; incidentId: string; requestId: string; target: number; channel: string; receipt: string }
  | { kind: 'resolve-human'; incidentId: string; requestId: string; proposalId: string; actor: string; reason: string; nextProposalId: string | null }
  | { kind: 'reserve'; reservation: Reservation; limits: Limits }
  | { kind: 'finish'; reservationId: string; fence: string; owner: Owner; actual: Resources }
  | { kind: 'diagnosis'; diagnostic: Diagnostic; owner: Owner; actual: Resources | null; processConfirmed: boolean; request: HumanRequest | null }
  | { kind: 'reconcile-worker'; reservationId: string }
  | { kind: 'intent'; intent: Intent; owner: Owner }
  | { kind: 'reconcile-intent'; intentId: string; outcome: IntentMemory['outcome']; evidence: string[] }
);
const demand = (x: unknown, message: string): void => { if (!x) throw Error(`Supervisor state held: ${message}`); };
const object = (x: any, fields: string[]) => demand(x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).sort().join() === fields.sort().join(), 'unknown/missing fields');
const text = (x: any) => typeof x === 'string' && x.trim().length > 0 && x.length <= 4000 && !x.includes('\0');
const count = (x: any) => Number.isSafeInteger(x) && x >= 0;
const hash = (x: any) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const time = (x: any) => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const same = (a: unknown, b: unknown) => supervisorHash(a) === supervisorHash(b);
function resources(x: any): void { object(x, ['tokens','cost']); demand(count(x.tokens) && count(x.cost), 'finite integer token/cost units required'); }
function owner(x: any): void { object(x, ['pid','start']); demand(Number.isSafeInteger(x.pid) && x.pid > 0 && text(x.start), 'PID/start identity required'); }
function facts(x: any): void {
  object(x, ['scope','requirements','gate','runId','failure']); validateScope(x.scope);
  demand(hash(x.requirements) && hash(x.gate) && hash(x.failure) && text(x.runId), 'invalid incident facts');
}
export function incidentIdentity(project: ProjectIdentity, input: Facts): string {
  validateProject(project); facts(input); return supervisorHash({ project, facts: input });
}
export const emptySupervisor = (project: ProjectIdentity): SupervisorState => {
  validateProject(project);
  return { version: 1, project, revision: 0, incidents: {}, proposals: {}, reviews: {}, intents: {}, humans: {}, reservations: {}, events: {},
    charged: { diagnosis: { tokens: 0, cost: 0 }, review: { tokens: 0, cost: 0 } }, diagnostics: {}, history: [] };
};
function entries(x: any): [string, any][] {
  demand(x && typeof x === 'object' && !Array.isArray(x), 'expected index');
  const xs = Object.entries(x); demand(xs.every(([k]) => hash(k)), 'invalid index key'); return xs;
}
/** Strict read validation; no recovery/reset from unknown versions, foreign identities or malformed owners. */
export function validateSupervisor(s: any, project: ProjectIdentity): SupervisorState {
  object(s, ['version','project','revision','incidents','proposals','reviews','intents','humans','reservations','events','charged','history', ...['control','diagnostics','deliveries','resolutions','reviewCompletions'].filter(k => Object.hasOwn(s, k))]);
  validateProject(s.project); demand(s.version === 1 && same(s.project, project) && count(s.revision), 'version/project/revision mismatch');
  if (s.control) {
    object(s.control, ['mode','actor','at','pilot']);
    demand(['observe','act','stopped'].includes(s.control.mode) && text(s.control.actor) && time(s.control.at)
      && typeof s.control.pilot === 'boolean' && (s.control.mode !== 'act' || s.control.pilot), 'invalid operator control');
  }
  for (const [id, m] of entries(s.incidents)) {
    object(m, ['incident','facts','superseded','denied']); validateIncident(m.incident); facts(m.facts);
    demand(id === incidentIdentity(project, m.facts) && id === m.incident.id && same(m.incident.project, project) && same(m.incident.scope, m.facts.scope)
      && typeof m.superseded === 'boolean' && typeof m.denied === 'boolean' && (!m.denied || m.incident.state === 'human-required'), 'invalid incident memory');
  }
  for (const [id, p] of entries(s.proposals)) { validateProposal(p); demand(id === p.id && same(p.project, project) && s.incidents[p.incidentId]
      && same(p.scope, s.incidents[p.incidentId].incident.scope) && (p.snapshotHash === s.incidents[p.incidentId].incident.snapshotHash
        || Object.values<Diagnostic>(s.diagnostics ?? {}).some(d => d.outcome === 'proposed' && d.incidentId === p.incidentId && d.snapshotHash === p.snapshotHash
          && d.decision?.action.kind === 'gate-change' && same(d.decision.action.proposal, p))), 'foreign proposal'); }
  for (const [id, r] of entries(s.reviews)) {
    validateIndependentReview(r); const p = s.proposals[r.proposalId];
    demand(id === supervisorHash(r.id) && p && Object.values<any>(s.reservations).some(call => call.kind === 'review'
      && call.id === r.invocationId && call.reviewId === r.id && call.incidentId === p.incidentId)
      && (r.disposition !== 'deny' || s.incidents[p.incidentId].denied), 'orphan review or lost denial');
  }
  for (const [id, d] of entries(s.diagnostics ?? {})) {
    validateDiagnostic(d); const r = s.reservations[supervisorHash(d.reservationId)];
    demand(id === d.id && r?.kind === 'diagnosis' && r.incidentId === d.incidentId && r.fence === d.fence, 'foreign diagnostic');
    if (d.outcome !== 'proposed' || d.decision?.action.kind === 'escalate') demand(s.humans[d.incidentId] && s.incidents[d.incidentId].incident.state === 'human-required', 'lost diagnosis human stop');
    if (d.decision?.action.kind === 'gate-change') demand(s.proposals[d.decision.action.proposal.id] && same(s.proposals[d.decision.action.proposal.id], d.decision.action.proposal), 'lost exact diagnosis proposal');
  }
  for (const [id, h] of entries(s.humans)) { validateHumanRequest(h); demand(id === h.incidentId && s.incidents[id] && same(h.project, project), 'foreign human request'); }
  for (const [id, c] of entries(s.reviewCompletions ?? {})) {
    object(c, ['inputRef','policy','proposer']); const r = s.reviews[id];
    demand(r && text(c.inputRef) && hash(c.policy) && text(c.proposer) && c.proposer !== r.reviewer, 'invalid host review provenance');
    if (r.disposition === 'approve') demand(Object.values<Reservation>(s.reservations).some(call => call.id === r.invocationId && call.state === 'finished' && call.actual !== null), 'approval without settled host completion');
  }
  for (const [id, d] of entries(s.deliveries ?? {})) {
    object(d, ['requestId','target','attemptedAt']);
    demand(s.humans[id]?.id === d.requestId && Number.isSafeInteger(d.target) && d.target > 0 && time(d.attemptedAt), 'foreign delivery attempt');
  }
  for (const [id, r] of entries(s.resolutions ?? {})) {
    object(r, ['requestId','proposalId','actor','reason','at','nextProposalId']);
    demand(s.humans[id]?.id === r.requestId && s.humans[id].proposalId === r.proposalId && text(r.actor) && text(r.reason) && time(r.at)
      && (r.nextProposalId === null || hash(r.nextProposalId) && r.nextProposalId !== r.proposalId), 'invalid local resolution audit');
  }
  for (const [id, m] of entries(s.intents)) {
    object(m, ['intent','owner','outcome','evidence']); validateIntent(m.intent); owner(m.owner);
    demand(id === supervisorHash(m.intent.id) && same(m.intent.project, project) && s.proposals[m.intent.proposalId] && s.incidents[m.intent.incidentId]
      && ['pending','observed-applied','observed-not-applied','unknown'].includes(m.outcome) && Array.isArray(m.evidence) && m.evidence.every(text)
      && m.intent.state === 'proposed', 'invalid inert intent');
  }
  for (const [id, r] of entries(s.reservations)) {
    object(r, ['id','incidentId','kind','owner','fence','at','deadline','reserved','actual','state','reviewId']); owner(r.owner); resources(r.reserved);
    if (r.actual !== null) { resources(r.actual); demand(r.actual.tokens <= r.reserved.tokens && r.actual.cost <= r.reserved.cost, 'accounting overflow'); }
    demand(id === supervisorHash(r.id) && text(r.id) && text(r.fence) && s.incidents[r.incidentId] && ['diagnosis','review'].includes(r.kind)
      && time(r.at) && time(r.deadline) && r.deadline > r.at && (r.kind !== 'diagnosis' || Date.parse(r.deadline) - Date.parse(r.at) <= DIAGNOSIS_TIMEOUT_MS) && ['active','finished','ambiguous'].includes(r.state)
      && (r.state === 'finished' ? r.actual !== null : r.actual === null)
      && (r.reviewId === null || r.kind === 'review' && text(r.reviewId) && s.reviews[supervisorHash(r.reviewId)]?.invocationId === r.id), 'invalid reservation');
  }
  demand(Object.values<any>(s.reservations).filter(r => r.state === 'active').length <= 1, 'multiple project decisions');
  object(s.charged, ['diagnosis','review']); resources(s.charged.diagnosis); resources(s.charged.review);
  for (const kind of ['diagnosis','review']) {
    const rs = Object.values<any>(s.reservations).filter(r => r.kind === kind);
    demand(['tokens','cost'].every(unit => rs.reduce((n, r) => n + r.reserved[unit], 0) === s.charged[kind][unit]), 'lost charge');
  }
  for (const m of Object.values<any>(s.incidents)) demand(m.incident.diagnosisCalls === Object.values<any>(s.reservations).filter(r => r.kind === 'diagnosis' && r.incidentId === m.incident.id).length, 'lost diagnosis counter');
  entries(s.events).forEach(([, v]) => demand(hash(v), 'invalid event digest'));
  demand(Array.isArray(s.history) && s.history.length <= HISTORY_LIMIT, 'invalid history');
  for (const h of s.history) { object(h, ['event','at','kind']); demand(text(h.event) && time(h.at) && text(h.kind) && s.events[supervisorHash(h.event)], 'invalid history event'); }
  return s;
}
const total = (states: SupervisorState[], unit: keyof Resources) => states.reduce((n, s) => n + s.charged.diagnosis[unit] + s.charged.review[unit], 0);
/** Retained records are never cleared; only explicit local resolutions discharge their particular human stop. */
export function supervisorHumanHold(s: SupervisorState): boolean {
  return Object.keys(s.humans).some(id => !s.resolutions?.[id])
    || Object.entries(s.incidents).some(([id,m]) => (m.denied || m.incident.state === 'human-required') && !s.resolutions?.[id]);
}
/** Follow the audited successor chain, not every historical authorization. Abandonment permits no replacement.
 * Diagnosis may collect a new material proposal only when a non-abandoned successor exists; publication/review
 * must additionally match its exact pre-authorized hash. No resolution resurrects its original incident. */
export function supervisorRevisionHold(s: SupervisorState, proposalId?: string): boolean {
  const rs = Object.values(s.resolutions ?? {});
  const leaves = rs.filter(r => !rs.some(next => next.proposalId === r.nextProposalId));
  return leaves.some(r => r.nextProposalId === null || proposalId !== undefined && r.nextProposalId !== proposalId);
}
/** Pure, copy-on-write transition. The host supplies process observations; no time or process probing in policy. */
export function transitionSupervisor(state: SupervisorState, event: Event, environment: {
  ownerState: (o: Owner) => 'alive' | 'dead' | 'unknown'; projects?: SupervisorState[];
}): SupervisorState {
  validateSupervisor(state, state.project); demand(text(event.id) && time(event.at), 'event identity/time required');
  const key = supervisorHash(event.id), digest = supervisorHash(event);
  if (state.events[key]) { demand(state.events[key] === digest, 'event id reused with different bytes'); return state; }
  // An observation/stop fence must remain writable even when an old worker's ownership is unknown.
  for (const projectState of event.kind === 'control' ? [] : [state, ...(environment.projects ?? [])]) {
    for (const r of Object.values(projectState.reservations)) if (r.state === 'active') demand(environment.ownerState(r.owner) !== 'unknown', 'unknown worker owner holds journal');
    for (const m of Object.values(projectState.intents)) if (m.outcome === 'pending') demand(environment.ownerState(m.owner) !== 'unknown', 'unknown intent owner holds journal');
  }
  const s = structuredClone(state);
  const liveOwner = (o: Owner) => { owner(o); demand(environment.ownerState(o) === 'alive', 'owner is dead or unknown'); };
  const current = (id: string) => { const m = s.incidents[id]; demand(m && !m.superseded && !m.denied && m.incident.state !== 'human-required' && !s.humans[id]
    && !Object.keys(s.humans).some(key => !s.resolutions?.[key])
    && !Object.entries(s.incidents).some(([key,x]) => (x.denied || x.incident.state === 'human-required') && !s.resolutions?.[key]), 'incident superseded or human-held'); return m; };
  const owned = (id: string, fence: string, o: Owner) => {
    const r = s.reservations[supervisorHash(id)]; liveOwner(o);
    demand(r && r.state === 'active' && r.fence === fence && same(r.owner, o) && event.at >= r.at && event.at < r.deadline, 'stale reservation/fence'); return r;
  };
  const putHuman = (h: HumanRequest) => {
    validateHumanRequest(h); const m = s.incidents[h.incidentId];
    demand(m && same(h.project, s.project) && (same(h.scope, m.incident.scope) || h.scope.kind === 'project')
      && (s.proposals[h.proposalId]?.incidentId === h.incidentId || s.diagnostics?.[h.proposalId]?.incidentId === h.incidentId), 'human request binding mismatch');
    demand(h.delivery.state === 'pending' && h.delivery.attempts === 0, 'requests begin pending before notification');
    if (!s.humans[h.incidentId]) s.humans[h.incidentId] = h;
    m.incident.state = 'human-required';
  };
  switch (event.kind) {
    case 'control': {
      demand(['observe','act','stopped'].includes(event.mode) && text(event.actor) && typeof event.pilot === 'boolean', 'invalid control');
      demand(event.mode !== 'act' || event.pilot, 'explicit one-project pilot required');
      s.control = { mode: event.mode, actor: event.actor, at: event.at, pilot: event.pilot };
      break;
    }
    case 'observe': {
      const id = incidentIdentity(s.project, event.facts); demand(hash(event.snapshotHash) && text(event.reason), 'invalid observation');
      if (!s.incidents[id]) {
        for (const m of Object.values(s.incidents)) if (same(m.incident.scope, event.facts.scope)) m.superseded = true;
        s.incidents[id] = { incident: { version: 1, id, project: s.project, scope: event.facts.scope, snapshotHash: event.snapshotHash, state: 'open', reason: event.reason, diagnosisCalls: 0 }, facts: event.facts, superseded: false, denied: false };
      } // Returning to old facts never resurrects a superseded incident or changes its decisions/budget.
      break;
    }
    case 'proposal': {
      const p = validateProposal(event.proposal); const m = current(p.incidentId);
      demand(same(p.project, s.project) && same(p.scope, m.incident.scope) && p.snapshotHash === m.incident.snapshotHash, 'proposal binding mismatch');
      demand(!supervisorRevisionHold(s, p.id), 'operator permitted only the exact revised proposal');
      demand(!s.proposals[p.id] || same(s.proposals[p.id], p), 'proposal changed'); s.proposals[p.id] = p;
      if (p.change.category === 'factory-policy') m.incident.state = 'human-required';
      break;
    }
    case 'reserve': {
      demand(s.control?.mode !== 'stopped' && (event.reservation.kind !== 'review' || !s.control || s.control.mode === 'act'), 'operator mode fences new workers');
      const r = event.reservation; const m = current(r.incidentId); const l = event.limits;
      object(l, ['project','shared','capacity','reviewCalls','reviewTimeoutMs']); resources(l.project); resources(l.shared); resources(r.reserved); liveOwner(r.owner);
      demand(count(l.capacity) && l.capacity > 0 && count(l.reviewCalls) && l.reviewCalls > 0 && count(l.reviewTimeoutMs) && l.reviewTimeoutMs > 0, 'enforceable finite limits required');
      demand(text(r.id) && text(r.fence) && !s.reservations[supervisorHash(r.id)] && r.state === 'active' && r.actual === null && r.reviewId === null && r.at === event.at && time(r.deadline), 'invalid new reservation');
      const elapsed = Date.parse(r.deadline) - Date.parse(r.at);
      demand(['diagnosis','review'].includes(r.kind) && elapsed > 0 && elapsed <= (r.kind === 'diagnosis' ? DIAGNOSIS_TIMEOUT_MS : l.reviewTimeoutMs), 'call deadline exceeded');
      demand(r.reserved.tokens > 0 && r.reserved.cost > 0, 'unknown/zero paid reservation');
      demand(!Object.values(s.reservations).some(x => x.state === 'active' || x.state === 'ambiguous'), 'project decision unsettled');
      const peers = (environment.projects ?? [state]).filter(x => !same(x.project, state.project));
      peers.forEach(x => validateSupervisor(x, x.project)); const all = [...peers, state];
      demand(all.reduce((n, p) => n + Object.values(p.reservations).filter(x => x.state !== 'finished').length, 0) < l.capacity, 'shared capacity exhausted');
      for (const unit of ['tokens','cost'] as const) demand(Number.isSafeInteger(total(all, unit) + r.reserved[unit]) && total([s], unit) + r.reserved[unit] <= l.project[unit]
        && total(all, unit) + r.reserved[unit] <= l.shared[unit], 'project/shared budget exhausted');
      const calls = Object.values(s.reservations).filter(x => x.incidentId === r.incidentId && x.kind === r.kind).length;
      demand(calls < (r.kind === 'diagnosis' ? 2 : l.reviewCalls), 'incident call budget exhausted');
      s.reservations[supervisorHash(r.id)] = r;
      if (r.kind === 'diagnosis') m.incident.diagnosisCalls++;
      for (const unit of ['tokens','cost'] as const) s.charged[r.kind][unit] += r.reserved[unit];
      break;
    }
    case 'finish': {
      const r = owned(event.reservationId, event.fence, event.owner); resources(event.actual);
      demand(event.actual.tokens <= r.reserved.tokens && event.actual.cost <= r.reserved.cost, 'actual exceeds reserved ceiling');
      r.actual = event.actual; r.state = 'finished'; break; // No refund, including failed calls.
    }
    case 'diagnosis': {
      const d = validateDiagnostic(event.diagnostic), r = s.reservations[supervisorHash(d.reservationId)];
      liveOwner(event.owner);
      demand(r?.kind === 'diagnosis' && r.state === 'active' && r.fence === d.fence && same(r.owner, event.owner)
        && r.incidentId === d.incidentId && d.startedAt === r.at && d.completedAt === event.at, 'stale diagnostic owner/fence');
      const m = s.incidents[r.incidentId];
      demand(d.outcome !== 'proposed' || event.processConfirmed && event.actual !== null && event.at < r.deadline
        && !m.superseded && !m.denied && m.incident.state !== 'human-required' && !supervisorHumanHold(s) && !supervisorRevisionHold(s), 'late/unknown diagnosis cannot succeed');
      s.diagnostics ??= {}; demand(!Object.values(s.diagnostics).some(x => x.reservationId === r.id), 'diagnosis already recorded');
      s.diagnostics[d.id] = d;
      if (d.decision?.action.kind === 'gate-change') {
        const p = validateProposal(d.decision.action.proposal);
        demand(p.incidentId === d.incidentId && p.snapshotHash === d.snapshotHash && same(p.project, s.project)
          && same(p.scope, m.incident.scope) && p.change.owner.runId === m.facts.runId, 'diagnosis proposal binding mismatch');
        demand(!supervisorRevisionHold(s, p.id), 'diagnosis differs from exact operator-permitted revision');
        demand(!s.proposals[p.id] || same(s.proposals[p.id], p), 'proposal changed'); s.proposals[p.id] = p;
      }
      const needsHuman = d.outcome !== 'proposed' || d.decision?.action.kind === 'escalate';
      demand(needsHuman ? event.request !== null && event.request.proposalId === d.id && event.request.incidentId === d.incidentId : event.request === null, 'diagnosis and required human stop must publish atomically');
      if (event.request) putHuman(event.request);
      if (event.actual !== null && event.processConfirmed) {
        resources(event.actual); demand(event.actual.tokens <= r.reserved.tokens && event.actual.cost <= r.reserved.cost, 'accounting overflow');
        r.actual = event.actual; r.state = 'finished';
      } else r.state = 'ambiguous'; // Unknown usage/cleanup retains full charge and capacity; never replay.
      break;
    }
    case 'reconcile-worker': {
      const r = s.reservations[supervisorHash(event.reservationId)]; demand(r && r.state === 'active', 'no active reservation');
      demand(environment.ownerState(r.owner) === 'dead', 'unknown/live owner holds reconciliation');
      r.state = 'ambiguous'; break; // No retry/replay or capacity release without future authoritative settlement.
    }
    case 'review': {
      const review = validateIndependentReview(event.review); const p = s.proposals[review.proposalId]; demand(p, 'unknown proposal');
      const r = owned(event.reservationId, event.fence, event.owner); const m = s.incidents[p.incidentId];
      // Fenced results belong to the original incident even after supersession/another hold. Stale approval grants nothing.
      demand(r.kind === 'review' && r.incidentId === p.incidentId && review.invocationId === r.id && r.reviewId === null
        && review.startedAt >= r.at && review.completedAt <= event.at, 'review reservation mismatch or already consumed');
      const id = supervisorHash(review.id); demand(!s.reviews[id], 'review already recorded'); s.reviews[id] = review; r.reviewId = review.id;
      if (review.disposition === 'deny') { m.denied = true; m.incident.state = 'human-required'; }
      break; // Audit only, not provenance verification or approval/application authority.
    }
    case 'review-complete': {
      const review = validateIndependentReview(event.review), p = s.proposals[review.proposalId];
      const r = s.reservations[supervisorHash(event.reservationId)]; liveOwner(event.owner);
      demand(p && r?.kind === 'review' && r.state === 'active' && r.reviewId === null && r.fence === event.fence && same(r.owner, event.owner)
        && r.id === review.invocationId && r.incidentId === p.incidentId && review.startedAt === r.at && review.completedAt === event.at, 'review completion fence mismatch');
      if (review.disposition === 'approve') {
        current(p.incidentId);
        demand(event.processConfirmed && event.actual !== null && event.at < r.deadline && event.request === null, 'late/unknown approval');
      } else demand(event.request !== null && event.request.proposalId === p.id && event.request.incidentId === p.incidentId, 'review and human stop must commit atomically');
      const id = supervisorHash(review.id); demand(!s.reviews[id], 'review already retained'); s.reviews[id] = review; r.reviewId = review.id;
      if (review.disposition === 'deny') { s.incidents[p.incidentId].denied = true; s.incidents[p.incidentId].incident.state = 'human-required'; }
      s.reviewCompletions ??= {}; s.reviewCompletions[id] = event.provenance;
      if (event.request) putHuman(event.request);
      if (event.actual !== null && event.processConfirmed) {
        resources(event.actual); demand(event.actual.tokens <= r.reserved.tokens && event.actual.cost <= r.reserved.cost, 'review accounting overflow');
        r.actual = event.actual; r.state = 'finished';
      } else r.state = 'ambiguous';
      break;
    }
    case 'notify-attempt': {
      const h = s.humans[event.incidentId];
      demand(h?.id === event.requestId && !s.resolutions?.[event.incidentId] && h.delivery.state === 'pending'
        && !s.deliveries?.[event.incidentId] && Number.isSafeInteger(event.target) && event.target > 0
        && (h.scope.kind !== 'ticket' || event.target === h.scope.ticket), 'notification already attempted or foreign');
      s.deliveries ??= {}; s.deliveries[event.incidentId] = { requestId: h.id, target: event.target, attemptedAt: event.at };
      h.delivery.attempts++; break;
    }
    case 'notify-ack': {
      const h = s.humans[event.incidentId], d = s.deliveries?.[event.incidentId];
      demand(h?.id === event.requestId && d?.requestId === h.id && d.target === event.target && h.delivery.state === 'pending'
        && text(event.channel) && text(event.receipt), 'foreign notification acknowledgement');
      h.delivery = { state: 'notified', attempts: h.delivery.attempts, channel: event.channel, receipt: event.receipt, notifiedAt: event.at }; break;
    }
    case 'resolve-human': {
      const h = s.humans[event.incidentId];
      demand(h?.id === event.requestId && h.proposalId === event.proposalId && !s.resolutions?.[event.incidentId] && text(event.actor) && text(event.reason)
        && (event.nextProposalId === null || hash(event.nextProposalId) && event.nextProposalId !== h.proposalId
          && !Object.values(s.resolutions ?? {}).some(r => r.proposalId === event.nextProposalId)), 'resolution must identify exact held request/proposal without a cycle');
      demand(!Object.values(s.reservations).some(r => r.state !== 'finished'), 'unsettled accounting/process ownership still holds resolution');
      s.resolutions ??= {}; s.resolutions[event.incidentId] = { requestId: h.id, proposalId: h.proposalId, actor: event.actor, reason: event.reason, at: event.at, nextProposalId: event.nextProposalId };
      // Preserve denial, request, original incident and every charge. Only a different incident/exact revised proposal may proceed.
      break;
    }
    case 'human': {
      putHuman(event.request); break;
    }
    case 'intent': {
      const i = validateIntent(event.intent); const m = current(i.incidentId); liveOwner(event.owner);
      demand(i.state === 'proposed' && same(i.project, s.project) && same(i.scope, m.incident.scope) && s.proposals[i.proposalId]?.incidentId === i.incidentId && s.proposals[i.proposalId].change.owner.runId === i.runId, 'only inert proposed intents may be recorded');
      const id = supervisorHash(i.id); demand(!s.intents[id], 'intent already exists; never replay effects');
      s.intents[id] = { intent: i, owner: event.owner, outcome: 'pending', evidence: [] }; break;
    }
    case 'reconcile-intent': {
      const m = s.intents[supervisorHash(event.intentId)]; demand(m && ['pending','unknown'].includes(m.outcome), 'intent already reconciled');
      demand(environment.ownerState(m.owner) === 'dead', 'unknown/live intent owner holds');
      demand(['observed-applied','observed-not-applied','unknown'].includes(event.outcome) && Array.isArray(event.evidence) && event.evidence.length > 0 && event.evidence.length <= 128 && event.evidence.every(text), 'observation evidence required');
      m.outcome = event.outcome; m.evidence = event.evidence; break; // Observation never executes, authorizes or replays an effect.
    }
    default: throw Error('Supervisor state held: unknown event');
  }
  s.events[key] = digest; s.history = [...s.history, { event: event.id, at: event.at, kind: event.kind }].slice(-HISTORY_LIMIT);
  s.revision++; validateSupervisor(s, s.project); return s;
}
export const supervisorFile = (stateDir: string) => join(stateDir, 'supervisor', 'state.json');
function readJournal(stateDir: string): Journal {
  let j: any;
  try { j = JSON.parse(readFileSync(supervisorFile(stateDir), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, projects: {} }; throw Error('Supervisor state held: unreadable/corrupt journal; not overwritten'); }
  object(j, ['version','projects']); demand(j.version === 1, 'unknown journal version');
  for (const [key, s] of entries(j.projects)) { validateSupervisor(s, s.project); demand(key === supervisorHash(s.project.root), 'foreign root key'); }
  return j;
}
export function readSupervisor(stateDir: string, project: ProjectIdentity): SupervisorState {
  validateProject(project); const s = readJournal(stateDir).projects[supervisorHash(project.root)];
  return s ? validateSupervisor(s, project) : emptySupervisor(project);
}
/** One host-wide short lock + one atomic durable journal replacement includes shared capacity and project CAS.
 * stateDir MUST be host-owned, outside project/agent mounts, as for admission/recovery. No async effects inside locks. */
export function commitSupervisor(stateDir: string, project: ProjectIdentity, expectedRevision: number, event: Event): SupervisorState {
  validateProject(project);
  return withAdmissionLock(join(stateDir, 'supervisor'), () => {
    const j = readJournal(stateDir), key = supervisorHash(project.root);
    const before = j.projects[key] ? validateSupervisor(j.projects[key], project) : emptySupervisor(project);
    demand(before.revision === expectedRevision, 'revision CAS failed');
    const after = transitionSupervisor(before, event, { ownerState, projects: Object.values(j.projects) });
    if (after !== before) { j.projects[key] = after; writeDurable(supervisorFile(stateDir), JSON.stringify(j) + '\n'); }
    return after;
  }, -1);
}
