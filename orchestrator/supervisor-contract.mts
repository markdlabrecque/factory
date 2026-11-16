// Import-safe supervisor records and fail-closed review policy. No persistence, agent invocation or host authority.
import { createHash } from 'node:crypto';

export const SUPERVISOR_VERSION = 1;
export type Scope = { kind: 'ticket'; ticket: number } | { kind: 'project' };
export type ProjectIdentity = { root: string; tracker: { kind: 'github' | 'gitlab'; host: string; project: string } };
export type SourceRole = 'child' | 'parent' | 'human-planning' | 'guidelines' | 'factory-rules' | 'gate' | 'failure' | 'prior-decisions';
/** Original bytes, not supervisor summaries. Absence and truncation are deliberately representable but never approvable. */
export type Source = { role: SourceRole; locator: string; status: 'complete' | 'missing' | 'truncated' | 'not-applicable'; text: string; sha256: string };
export type Material = { runId: string; base: string; baseline: string; tip: string; runtime: string; dependencies: string; policy: string; settings: string; ticketInput: string; admissionGeneration: string };
export interface Snapshot {
  version: 1; project: ProjectIdentity; scope: Scope; observedAt: string; mode: 'observe' | 'act' | 'stopped';
  material: Material; sources: Source[];
  /** These separate ordered inputs are not interchangeable. Rules cannot be overridden by guidelines. */
  projectGuidelines: string[]; factoryConstraints: string[];
}
export interface Incident {
  version: 1; id: string; project: ProjectIdentity; scope: Scope; snapshotHash: string;
  state: 'open' | 'diagnosing' | 'review-pending' | 'human-required' | 'resolved'; reason: string; diagnosisCalls: number;
}
export const PROJECT_GATE_CATEGORIES = ['verification-command-substitution', 'additive-instruction-correction'] as const;
export type GateChange = {
  category: typeof PROJECT_GATE_CATEGORIES[number] | 'factory-policy'; path: string; before: string; after: string;
  /** No global or permanent waivers: proposed effect belongs to exactly this ticket/run and expires. */
  owner: { ticket: number; runId: string }; expiresAt: string;
};
export interface Proposal {
  version: 1; id: string; incidentId: string; snapshotHash: string; project: ProjectIdentity; scope: Scope;
  change: GateChange; rationale: string; alternatives: string[]; risks: string[];
}
export interface ReviewInput { version: 1; snapshot: Snapshot; proposal: Proposal }
export interface IndependentReview {
  version: 1; id: string; inputHash: string; proposalId: string; invocationId: string; reviewer: string;
  model: string; startedAt: string; completedAt: string; disposition: 'approve' | 'deny' | 'inconclusive'; reason: string;
}
export interface Intent {
  version: 1; id: string; project: ProjectIdentity; scope: Scope; incidentId: string; proposalId: string;
  inputHash: string; reviewId: string; runId: string; fence: string; expiresAt: string;
  state: 'proposed' | 'authorized' | 'applied' | 'refused' | 'cancelled';
}
/** Host-owned pending outbox, not delivered notification. proposalId binds an exact gate proposal or retained
 * proposal-only diagnosis diagnostic; neither grants action authority. Persist before notification. */
export interface HumanRequest {
  version: 1; id: string; project: ProjectIdentity; scope: Scope; incidentId: string; proposalId: string;
  reason: 'review-denied' | 'factory-wide' | 'missing-primitive' | 'authority-uncertain';
  question: string; evidence: string[]; nextAction: string;
  delivery: { state: 'pending'; attempts: number } | { state: 'notified'; attempts: number; channel: string; receipt: string; notifiedAt: string };
  stop: 'required';
}
export type HostOutcome = { version: 1; state: 'held'; reason: string }
  | { version: 1; state: 'review-approved'; reviewId: string; inputHash: string }
  | { version: 1; state: 'human-required'; reason: HumanRequest['reason']; scope: Scope };

const demand = (value: unknown, reason: string): void => { if (!value) throw Error(`Supervisor contract: ${reason}`); };
const record = (x: any, required: string[]) => {
  demand(x && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x)), 'expected plain record');
  demand(required.every(k => Object.hasOwn(x, k)) && Object.keys(x).every(k => required.includes(k)), 'unknown or missing field');
};
const text = (x: unknown, max = 4000): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !x.includes('\0');
const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const sha = (x: unknown) => typeof x === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(x);
const instant = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const count = (x: unknown, max: number) => Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) <= max;
const list = (x: unknown, max = 128, empty = true): x is string[] => Array.isArray(x) && x.length <= max && (empty || x.length > 0) && x.every(v => text(v));
const version = (x: any) => demand(x.version === 1, 'unknown version');
const relativePath = (x: unknown): x is string => text(x, 1024) && !x.startsWith('/') && !x.includes('\\') && !x.includes(':') && x.split('/').every(p => p && p !== '.' && p !== '..');
/** Stable sorted JSON hashing; bounded validators run before untrusted records reach this helper. */
export function supervisorHash(value: unknown): string {
  const canonical = (v: any): string => {
    if (v === null || ['string', 'boolean'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v)))
      return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    throw Error('Supervisor contract: not JSON data');
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export const sourceHash = (text: string) => createHash('sha256').update(text).digest('hex');
export function validateScope(x: any): Scope {
  record(x, x?.kind === 'ticket' ? ['kind', 'ticket'] : ['kind']);
  demand(x.kind === 'project' || x.kind === 'ticket' && Number.isSafeInteger(x.ticket) && x.ticket > 0, 'invalid scope'); return x;
}
export function validateProject(x: any): ProjectIdentity {
  record(x, ['root', 'tracker']); record(x.tracker, ['kind', 'host', 'project']);
  demand(text(x.root, 1024) && x.root.startsWith('/') && !x.root.includes('\\') && x.root.split('/').slice(1).every((p: string) => p && p !== '.' && p !== '..'), 'noncanonical project root');
  const t = x.tracker;
  demand(['github', 'gitlab'].includes(t.kind) && text(t.host, 253) && /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[1-9][0-9]{0,4})?$/.test(t.host), 'noncanonical tracker');
  demand(text(t.project, 512) && !t.project.endsWith('.git') && t.project.split('/').length >= 2 && t.project.split('/').every((p: string) => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(p)), 'invalid tracker project');
  demand(t.kind !== 'github' || t.project === t.project.toLowerCase() && t.project.split('/').length === 2, 'noncanonical GitHub repository'); return x;
}
export function validateSnapshot(x: any): Snapshot {
  record(x, ['version', 'project', 'scope', 'observedAt', 'mode', 'material', 'sources', 'projectGuidelines', 'factoryConstraints']); version(x);
  validateProject(x.project); validateScope(x.scope);
  demand(instant(x.observedAt) && ['observe', 'act', 'stopped'].includes(x.mode), 'invalid snapshot state/time');
  const m = x.material;
  record(m, ['runId', 'base', 'baseline', 'tip', 'runtime', 'dependencies', 'policy', 'settings', 'ticketInput', 'admissionGeneration']);
  demand(text(m.runId, 200) && text(m.base, 200) && text(m.admissionGeneration, 200) && sha(m.baseline) && sha(m.tip)
    && ['runtime', 'dependencies', 'policy', 'settings', 'ticketInput'].every(k => hash(m[k])), 'invalid material identity');
  demand(list(x.projectGuidelines, 128, false) && list(x.factoryConstraints, 128, false), 'separate explicit guidelines and constraints required');
  demand(Array.isArray(x.sources) && x.sources.length > 0 && x.sources.length <= 128, 'bounded original sources required');
  let bytes = 0; const seen = new Set<string>();
  for (const s of x.sources) {
    record(s, ['role', 'locator', 'status', 'text', 'sha256']);
    demand(['child','parent','human-planning','guidelines','factory-rules','gate','failure','prior-decisions'].includes(s.role) && text(s.locator, 2048), 'invalid source identity');
    demand(['complete','missing','truncated','not-applicable'].includes(s.status) && typeof s.text === 'string' && s.text.length <= 262144 && !s.text.includes('\0') && s.sha256 === sourceHash(s.text), 'invalid source bytes/hash/status');
    demand(s.status !== 'complete' || s.text.trim(), 'empty complete source');
    demand(!['missing','not-applicable'].includes(s.status) || s.text === '', 'absent source has bytes');
    const key = `${s.role}:${s.locator}`; demand(!seen.has(key), 'duplicate source'); seen.add(key); bytes += Buffer.byteLength(s.text);
  }
  demand(bytes <= 2 * 1024 * 1024, 'source bundle exceeds 2 MiB'); return x;
}
export function validateIncident(x: any): Incident {
  record(x, ['version','id','project','scope','snapshotHash','state','reason','diagnosisCalls']); version(x); validateProject(x.project); validateScope(x.scope);
  demand(text(x.id, 200) && hash(x.snapshotHash) && ['open','diagnosing','review-pending','human-required','resolved'].includes(x.state) && text(x.reason) && count(x.diagnosisCalls, 2), 'invalid incident'); return x;
}
export function validateGateChange(x: any): GateChange {
  record(x, ['category','path','before','after','owner','expiresAt']); record(x.owner, ['ticket','runId']);
  demand([...PROJECT_GATE_CATEGORIES, 'factory-policy'].includes(x.category) && relativePath(x.path), 'unsupported gate category/path');
  demand(typeof x.before === 'string' && typeof x.after === 'string' && x.before.length <= 65536 && text(x.after, 65536) && !x.before.includes('\0') && x.before !== x.after, 'invalid exact substitution');
  demand(Number.isSafeInteger(x.owner.ticket) && x.owner.ticket > 0 && text(x.owner.runId, 200) && instant(x.expiresAt), 'invalid effect ownership/expiry'); return x;
}
export function proposalIdentity(x: Omit<Proposal, 'id'>): string { return supervisorHash(x); }
export function validateProposal(x: any): Proposal {
  record(x, ['version','id','incidentId','snapshotHash','project','scope','change','rationale','alternatives','risks']); version(x); validateProject(x.project); validateScope(x.scope); validateGateChange(x.change);
  demand(text(x.incidentId, 200) && hash(x.snapshotHash) && text(x.rationale) && list(x.alternatives, 32, false) && list(x.risks, 32, false), 'invalid proposal context');
  demand(x.change.category === 'factory-policy' || x.scope.kind === 'ticket' && x.scope.ticket === x.change.owner.ticket, 'project-local effect requires one ticket');
  const { id, ...body } = x; demand(hash(id) && id === proposalIdentity(body), 'proposal identity mismatch'); return x;
}
export function validateReviewInput(x: any): ReviewInput {
  record(x, ['version', 'snapshot', 'proposal']); version(x); validateSnapshot(x.snapshot); validateProposal(x.proposal);
  demand(supervisorHash(x.snapshot.project) === supervisorHash(x.proposal.project) && supervisorHash(x.snapshot.scope) === supervisorHash(x.proposal.scope), 'review project/scope mismatch');
  demand(x.proposal.snapshotHash === supervisorHash(x.snapshot) && x.proposal.change.owner.runId === x.snapshot.material.runId, 'review snapshot/run mismatch'); return x;
}
export function validateIndependentReview(x: any): IndependentReview {
  record(x, ['version','id','inputHash','proposalId','invocationId','reviewer','model','startedAt','completedAt','disposition','reason']); version(x);
  demand(['id','invocationId','reviewer','model'].every(k => text(x[k], 200)) && hash(x.inputHash) && hash(x.proposalId)
    && instant(x.startedAt) && instant(x.completedAt) && x.completedAt >= x.startedAt && ['approve','deny','inconclusive'].includes(x.disposition) && text(x.reason), 'invalid independent review'); return x;
}
export function validateIntent(x: any): Intent {
  record(x, ['version','id','project','scope','incidentId','proposalId','inputHash','reviewId','runId','fence','expiresAt','state']); version(x); validateProject(x.project); validateScope(x.scope);
  demand(['id','incidentId','reviewId','runId','fence'].every(k => text(x[k], 200)) && hash(x.proposalId) && hash(x.inputHash) && instant(x.expiresAt)
    && x.scope.kind === 'ticket' && ['proposed','authorized','applied','refused','cancelled'].includes(x.state), 'invalid intent'); return x;
}
export function validateHumanRequest(x: any): HumanRequest {
  record(x, ['version','id','project','scope','incidentId','proposalId','reason','question','evidence','nextAction','delivery','stop']); version(x); validateProject(x.project); validateScope(x.scope);
  demand(text(x.id, 200) && text(x.incidentId, 200) && hash(x.proposalId) && ['review-denied','factory-wide','missing-primitive','authority-uncertain'].includes(x.reason)
    && text(x.question) && list(x.evidence, 128, false) && text(x.nextAction) && x.stop === 'required', 'invalid human request');
  record(x.delivery, x.delivery?.state === 'notified' ? ['state','attempts','channel','receipt','notifiedAt'] : ['state','attempts']);
  demand(count(x.delivery.attempts, 1000000) && (x.delivery.state === 'pending' || x.delivery.state === 'notified' && x.delivery.attempts > 0
    && text(x.delivery.channel, 200) && text(x.delivery.receipt) && instant(x.delivery.notifiedAt)), 'invalid notification receipt');
  demand(x.reason !== 'factory-wide' || x.scope.kind === 'project', 'Factory-wide request must stop project'); return x;
}
export function validateHostOutcome(x: any): HostOutcome {
  record(x, x?.state === 'held' ? ['version','state','reason'] : x?.state === 'review-approved' ? ['version','state','reviewId','inputHash'] : ['version','state','reason','scope']); version(x);
  demand(x.state === 'held' && text(x.reason) || x.state === 'review-approved' && text(x.reviewId, 200) && hash(x.inputHash)
    || x.state === 'human-required' && ['review-denied','factory-wide','missing-primitive','authority-uncertain'].includes(x.reason), 'invalid host outcome');
  if (x.state === 'human-required') { validateScope(x.scope); demand(x.reason !== 'factory-wide' || x.scope.kind === 'project', 'Factory-wide outcome must stop project'); } return x;
}
/** This is review admissibility only, NEVER permission to apply a gate or deliver a change.
 * Host supplies current input hash, provenance, fixed role model and durable denial latch; agent claims are not trusted. */
export function reviewOutcome(input: ReviewInput, review: IndependentReview, host: {
  now: string; currentInputHash: string; invocationId: string; proposer: string; reviewer: string; model: string; denied: boolean;
}): HostOutcome {
  try { validateReviewInput(input); validateIndependentReview(review); } catch (e) { return { version: 1, state: 'held', reason: (e as Error).message }; }
  const { snapshot: s, proposal: p } = input;
  if (p.change.category === 'factory-policy') return { version: 1, state: 'human-required', reason: 'factory-wide', scope: { kind: 'project' } };
  if (host.denied === true) return { version: 1, state: 'human-required', reason: 'review-denied', scope: p.scope };
  if (host.denied !== false || !instant(host.now) || !hash(host.currentInputHash) || host.currentInputHash !== supervisorHash(input)
    || review.inputHash !== host.currentInputHash || review.proposalId !== p.id || review.invocationId !== host.invocationId
    || review.reviewer !== host.reviewer || !text(host.proposer, 200) || !text(host.reviewer, 200) || host.proposer === host.reviewer
    || review.model !== host.model || review.startedAt < s.observedAt || review.completedAt > host.now)
    return { version: 1, state: 'held', reason: 'Review provenance or durable denial state unknown/stale' };
  if (review.disposition === 'deny') return { version: 1, state: 'human-required', reason: 'review-denied', scope: p.scope };
  if (s.mode !== 'act' || p.change.expiresAt <= host.now || review.disposition !== 'approve')
    return { version: 1, state: 'held', reason: 'Review incomplete, expired or not in action mode' };
  const roles: SourceRole[] = ['child','parent','human-planning','guidelines','factory-rules','gate','failure','prior-decisions'];
  if (roles.some(role => !s.sources.some(source => source.role === role)) || s.sources.some(source => source.status !== 'complete'
    && !(source.status === 'not-applicable' && ['parent','human-planning','prior-decisions'].includes(source.role))))
    return { version: 1, state: 'held', reason: 'Original context incomplete; summaries cannot replace missing sources' };
  return { version: 1, state: 'review-approved', reviewId: review.id, inputHash: review.inputHash };
}
