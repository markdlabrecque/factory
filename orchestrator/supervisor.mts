// Pure bounded diagnosis context and proposal validation. Model output is advice, never review, admission or action authority.
import { supervisorHash, validateSnapshot, validateProposal } from './supervisor-contract.mts';
import type { Snapshot, Proposal } from './supervisor-contract.mts';

export const DIAGNOSIS_OUTPUT_BYTES = 192 * 1024;
export const MEMORY_LIMIT = 8;
export type DiagnosisAction = { kind: 'wait' | 'observe'; expectation: string }
  | { kind: 'request-repair'; ticket: number; runId: string; expectation: string }
  | { kind: 'gate-change'; proposal: Proposal }
  | { kind: 'follow-up-draft'; title: string; body: string }
  | { kind: 'escalate'; question: string; nextAction: string; factoryWide: boolean };
export type DiagnosisDecision = {
  version: 1; incidentId: string; basisHash: string;
  classification: 'problem' | 'evidence-mechanism' | 'expectation'; rationale: string;
  alternatives: string[]; action: DiagnosisAction;
};
export type DiagnosisMemory = { id: string; basisHash: string; outcome: string; rationale: string; reference: string };
export type DiagnosisContext = { version: 1; snapshot: Snapshot; incidentId: string; memory: DiagnosisMemory[]; omittedMemory: number };
export type Diagnostic = {
  id: string; reservationId: string; incidentId: string; basisHash: string; snapshotHash: string; fence: string;
  startedAt: string; completedAt: string; inputRef: string;
  outcome: 'proposed' | 'malformed' | 'stale' | 'cancelled' | 'timeout' | 'process-failed' | 'exhausted';
  reason: string; stdout: string; stderr: string; decision: DiagnosisDecision | null;
};
const demand = (x: unknown, message: string) => { if (!x) throw Error(`Supervisor diagnosis held: ${message}`); };
const text = (x: any, max = 4000) => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !x.includes('\0');
const hash = (x: any) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const exact = (x: any, keys: string[]) => demand(x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join() === [...keys].sort().join(), 'unknown/missing fields');
export function diagnosisBasis(snapshot: Snapshot): string {
  validateSnapshot(snapshot);
  // Observation time is not new evidence. Every original byte, policy and authorization mode remains material.
  const { observedAt, ...material } = snapshot;
  return supervisorHash(material);
}
export function diagnosisContext(snapshot: Snapshot, incidentId: string, prior: DiagnosisMemory[]): DiagnosisContext {
  validateSnapshot(snapshot); demand(hash(incidentId), 'incident identity required');
  demand(prior.length <= 10000, 'memory index exceeds bounded collection');
  const memory = prior.slice(-MEMORY_LIMIT);
  for (const m of memory) {
    exact(m, ['id','basisHash','outcome','rationale','reference']);
    demand(hash(m.id) && hash(m.basisHash) && text(m.outcome, 40) && text(m.rationale) && text(m.reference, 2048), 'invalid retained memory');
  }
  // Retained summaries supplement, never replace, the full original snapshot sources.
  return structuredClone({ version: 1, snapshot, incidentId, memory, omittedMemory: prior.length - memory.length });
}
function validateDecisionShape(x: any): DiagnosisDecision {
  exact(x, ['version','incidentId','basisHash','classification','rationale','alternatives','action']);
  demand(x.version === 1 && hash(x.incidentId) && hash(x.basisHash), 'invalid decision identity');
  demand(['problem','evidence-mechanism','expectation'].includes(x.classification) && text(x.rationale), 'classification/rationale required');
  demand(Array.isArray(x.alternatives) && x.alternatives.length > 0 && x.alternatives.length <= 16 && x.alternatives.every((s: any) => text(s)), 'bounded lawful alternatives required');
  const a = x.action;
  switch (a?.kind) {
    case 'wait': case 'observe': exact(a, ['kind','expectation']); demand(text(a.expectation), 'waiting expectation required'); break;
    case 'request-repair':
      exact(a, ['kind','ticket','runId','expectation']);
      demand(Number.isSafeInteger(a.ticket) && a.ticket > 0 && text(a.runId, 200) && text(a.expectation), 'repair identity required'); break;
    case 'gate-change': {
      exact(a, ['kind','proposal']); const p = validateProposal(a.proposal);
      demand(p.incidentId === x.incidentId && p.change.category !== 'factory-policy', 'gate proposal mismatch or protected policy'); break;
    }
    case 'follow-up-draft': exact(a, ['kind','title','body']); demand(text(a.title, 200) && text(a.body, 16000), 'bounded draft required'); break;
    case 'escalate': exact(a, ['kind','question','nextAction','factoryWide']); demand(text(a.question) && text(a.nextAction) && typeof a.factoryWide === 'boolean', 'actionable escalation required'); break;
    default: throw Error('Supervisor diagnosis held: unsupported action (no approval/apply/delivery)');
  }
  return x;
}
export function validateDiagnosisDecision(x: any, snapshot: Snapshot, incidentId: string): DiagnosisDecision {
  validateDecisionShape(x);
  demand(x.incidentId === incidentId && x.basisHash === diagnosisBasis(snapshot), 'stale/foreign basis');
  const a = x.action;
  if (a.kind === 'request-repair') demand(snapshot.scope.kind === 'ticket' && a.ticket === snapshot.scope.ticket && a.runId === snapshot.material.runId, 'repair scope mismatch');
  if (a.kind === 'gate-change') {
    const p = a.proposal;
    demand(p.snapshotHash === supervisorHash(snapshot) && supervisorHash(p.project) === supervisorHash(snapshot.project)
      && supervisorHash(p.scope) === supervisorHash(snapshot.scope) && p.change.owner.runId === snapshot.material.runId
      && p.change.expiresAt > snapshot.observedAt, 'gate proposal mismatch');
  }
  return x;
}
export function parseDiagnosis(output: string, snapshot: Snapshot, incidentId: string): DiagnosisDecision {
  demand(Buffer.byteLength(output) <= DIAGNOSIS_OUTPUT_BYTES, 'output overflow');
  // No markdown/code-fence extraction, partial JSON, prose forgiveness or approval parser.
  return validateDiagnosisDecision(JSON.parse(output), snapshot, incidentId);
}
export function validateDiagnostic(x: any): Diagnostic {
  exact(x, ['id','reservationId','incidentId','basisHash','snapshotHash','fence','startedAt','completedAt','inputRef','outcome','reason','stdout','stderr','decision']);
  demand(hash(x.id) && text(x.reservationId) && hash(x.incidentId) && hash(x.basisHash) && hash(x.snapshotHash) && text(x.fence) && text(x.inputRef, 2048), 'diagnostic identity required');
  for (const t of [x.startedAt, x.completedAt]) demand(typeof t === 'string' && Number.isFinite(Date.parse(t)) && new Date(t).toISOString() === t, 'invalid diagnostic time');
  demand(x.completedAt >= x.startedAt && text(x.reason) && ['proposed','malformed','stale','cancelled','timeout','process-failed','exhausted'].includes(x.outcome), 'invalid diagnostic outcome');
  demand(typeof x.stdout === 'string' && Buffer.byteLength(x.stdout) <= DIAGNOSIS_OUTPUT_BYTES && typeof x.stderr === 'string' && Buffer.byteLength(x.stderr) <= 8192, 'diagnostic output overflow');
  demand(x.outcome === 'proposed' ? x.decision !== null : x.decision === null, 'failure cannot be a proposal');
  if (x.decision !== null) { validateDecisionShape(x.decision); demand(x.decision.incidentId === x.incidentId && x.decision.basisHash === x.basisHash, 'decision binding mismatch'); }
  const { id, ...body } = x; demand(id === supervisorHash(body), 'diagnostic hash mismatch'); return x;
}
