// Bounded, read-only supervisor projections and original-context collection. Observations never grant launch authority.
import { existsSync } from 'node:fs';
import type { Snapshot, Source, Material, ProjectIdentity, Scope } from '../../orchestrator/supervisor-contract.mts';
import type { TicketContextSource } from '../../orchestrator/ticket-context.mts';
import type { RunState } from '../../board/board.mts';
import type { Assessment } from '../../board/assessment.mts';
import type { Manifest } from '../../orchestrator/graph.mts';
import type { AdmissionClaim } from '../../board/admission.mts';
import type { RecoverySummary } from './commands/recovery.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { sourceHash, supervisorHash, validateSnapshot, validateProject, validateScope } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
const { freezeTicketInput } = await import(flat ? './ticket-input.mts' : '../../orchestrator/ticket-input.mts');
const { validDelivery } = await import(flat ? './delivery.mts' : '../../board/delivery.mts');
const { overlap } = await import(flat ? './graph.mts' : '../../orchestrator/graph.mts');
export const FACT_LIMITS = Object.freeze({ tickets: 128, items: 128, excerpt: 512 });
export type Observation<T> = { source: string; kind: 'live' | 'saved'; observedAt: string | null; sha256: string | null } &
  ({ status: 'known'; value: T } | { status: 'missing' | 'unknown'; reason: string });
export type Authorization = { global: 'on' | 'off' | 'unknown'; project: 'enabled' | 'paused' | 'unknown' };
export type RuntimeFacts = { id: string; dependencies: string; mode: 'factory' | 'project' };
export interface FactInputs {
  project: ProjectIdentity; scope: Scope; at: string;
  selected: Observation<number[]>; runs: Observation<RunState[]>;
  claims: Observation<{ claim: AdmissionClaim; owner: 'alive' | 'dead' | 'unknown' }[]>;
  recovery: Observation<RecoverySummary>; authorization: Observation<Authorization>; runtime: Observation<RuntimeFacts>;
  assessments: Observation<Assessment[]>; graph: Observation<Manifest[]>;
  readiness: Observation<{ status: string; observedAt?: string }>;
}
/** Only bounded display text. Never use redacted text as complete review input. */
export function safeExcerpt(text: string, limit = FACT_LIMITS.excerpt): string {
  return text.replace(/-----BEGIN [^-]*(?:PRIVATE KEY|SECRET)[^-]*-----[\s\S]*?(?:-----END [^-]+-----|$)/gi, '[REDACTED]')
    .replace(/\b(?:https?:\/\/)[^\s<>"']+/gi, value => safeReference(value) ?? '[REDACTED URL]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/\b(?:authorization|password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\n]+/gi, '[REDACTED]')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, Math.max(0, Math.min(limit, FACT_LIMITS.excerpt)));
}
/** References are opaque locators, never followed by projection. Drop URL credentials/query/fragment. */
export function safeReference(value: string | undefined): string | null {
  if (!value || value.length > 2048 || /[\x00-\x20\x7f]/.test(value) || /(?:gh[pousr]_|github_pat_|sk-|AKIA[A-Z0-9]{16}|(?:password|token|api[_-]?key)=)/i.test(value)) return null;
  if (/^https?:/i.test(value)) {
    try { const u = new URL(value); if (u.protocol !== 'https:') return null; u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.href; } catch { return null; }
  }
  return /^(?:\/|[A-Za-z0-9_.-])/.test(value) && !value.includes('://') && !/(?:secret|\.env|credential|op:)/i.test(value) ? value.slice(0, 1024) : null;
}
export function observed<T>(source: string, kind: 'live' | 'saved', observedAt: string, value: T): Observation<T> {
  if (!Number.isFinite(Date.parse(observedAt))) throw Error('Invalid source time');
  // Host status readers use optional undefined fields; normalize to their persisted JSON representation.
  const jsonValue = JSON.parse(JSON.stringify(value)) as T;
  return { source, kind, observedAt, sha256: supervisorHash(jsonValue), status: 'known', value: jsonValue };
}
export function unavailable<T>(source: string, status: 'missing' | 'unknown', reason: string): Observation<T> {
  return { source, kind: 'saved', observedAt: null, sha256: null, status, reason: safeExcerpt(reason) };
}
const val = <T>(o: Observation<T>): T | undefined => o.status === 'known' ? o.value : undefined;
const time = (value: string | undefined): string | null => value && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
export type WorkClass = 'confirmed-merged' | 'unknown' | 'active' | 'temporary-wait' | 'delivery-wait' | 'gate-dispute' | 'incomplete' | 'exhausted' | 'human-hold';
export function projectSupervisorFacts(input: FactInputs) {
  const f = { ...input };
  for (const key of ['selected','runs','claims','assessments','graph'] as const) {
    const observation = f[key];
    if (observation.status === 'known' && (observation.value.length > FACT_LIMITS.items || key !== 'selected' && observation.value.some((item: any) => (key === 'claims' ? item.claim.project : item.project) !== f.project.tracker.project)))
      (f as any)[key] = unavailable(observation.source, 'unknown', 'Source exceeds bounded projection limit or belongs to another project.');
  }
  validateProject(f.project); validateScope(f.scope);
  if (!Number.isFinite(Date.parse(f.at))) throw Error('Invalid observation time');
  const observations = ['selected','runs','claims','recovery','authorization','runtime','assessments','graph','readiness'] as const;
  const sources = observations.map(key => { const { value, ...meta } = { value: undefined, ...f[key] }; return { name: key, ...meta, source: safeReference(meta.source), ...('reason' in meta ? { reason: safeExcerpt(meta.reason) } : {}) }; });
  const runs = val(f.runs) ?? [], assessments = val(f.assessments) ?? [], graph = val(f.graph) ?? [], claims = val(f.claims) ?? [];
  const recovery = val(f.recovery), auth = val(f.authorization);
  const ids = [...new Set([...(val(f.selected) ?? []), ...runs.map(r => Number(r.iid)), ...assessments.map(a => Number(a.iid)), ...claims.map(c => Number(c.claim.iid)), ...graph.map(g => g.iid), ...(recovery?.budgets.map(b => b.ticket) ?? [])])]
    .filter(id => Number.isSafeInteger(id) && id > 0 && (f.scope.kind === 'project' || f.scope.ticket === id)).sort((a,b) => a-b);
  const work = ids.slice(0, FACT_LIMITS.tickets).map(ticket => {
    const run = runs.find(r => Number(r.iid) === ticket), assessment = assessments.find(a => Number(a.iid) === ticket), manifest = graph.find(g => g.iid === ticket);
    const owners = claims.filter(c => Number(c.claim.iid) === ticket);
    const delivery = run?.delivery && validDelivery(run.delivery) && run.delivery.ticket === String(ticket) && run.delivery.executionId === run.executionId && run.delivery.project === run.project ? run.delivery : undefined;
    const merged = !!run && (!!run.mergedAt && Number.isFinite(Date.parse(run.mergedAt)) || delivery?.state === 'merged');
    const budget = recovery?.budgets.find(b => b.ticket === ticket), followup = recovery?.followups[ticket];
    let classification: WorkClass = 'incomplete';
    if (merged) classification = 'confirmed-merged';
    else if (f.runs.status !== 'known' || f.claims.status !== 'known' || owners.some(c => c.owner === 'unknown') || run?.delivery && !delivery) classification = 'unknown';
    else if (owners.some(c => c.owner === 'alive')) classification = 'active';
    // A PR/CI handoff is not a stopped-work recovery jam, even if the repair budget is empty.
    else if (delivery?.state === 'ci-waiting' || run?.mr && !delivery) classification = 'delivery-wait';
    else if (delivery?.state === 'operator-required') classification = 'human-hold';
    else if (run?.queueReasons?.some(r => /gate|verif|proof/.test(r.code))) classification = 'gate-dispute';
    else if (budget?.remaining === 0) classification = 'exhausted';
    else if (followup?.state === 'operator-required' || followup?.state === 'paused') classification = 'human-hold';
    else if (run?.stage === 'waiting' || run?.stage === 'ci' || followup?.state === 'waiting') classification = 'temporary-wait';
    else if (run && !['stopped','done','queued'].includes(run.stage)) classification = 'unknown'; // stage alone cannot establish a live owner
    const dependencies = assessment?.dependencies?.slice(0, FACT_LIMITS.items).map(d => ({ ticket: d.iid, state: d.state }));
    const conflicts = manifest ? graph.filter(g => g.iid !== ticket && overlap((g.actualFootprint ?? g.footprint).slice(0, FACT_LIMITS.items), (manifest.actualFootprint ?? manifest.footprint).slice(0, FACT_LIMITS.items)).length > 0).map(g => g.iid).slice(0, FACT_LIMITS.items) : null;
    return { ticket, selected: val(f.selected)?.includes(ticket) ?? null, stage: run?.stage ?? null, classification,
      confirmedProgress: merged ? { kind: 'host-confirmed-merge', at: time(delivery?.mergedAt ?? run?.mergedAt), sha: delivery?.sha ?? null } : null,
      owners: owners.slice(0, FACT_LIMITS.items).map(c => ({ kind: c.claim.kind, certainty: c.owner, at: time(c.claim.at) })),
      branch: safeReference(run?.branch), evidence: safeReference(run?.evidenceDir), pr: safeReference(delivery?.url ?? run?.mr),
      savedProof: run?.verification ? { id: safeReference(run.verification.id), tip: safeReference(run.verification.tip) } : null,
      sourceTime: time(run?.updatedAt),
      stages: run?.stageHistory?.slice(-FACT_LIMITS.items).map(s => ({ stage: s.stage, at: time(s.at) })) ?? [],
      attempts: recovery?.attempts.filter(a => a.ticket === ticket).slice(-10).map(a => ({ result: a.result, startedAt: time(a.startedAt), log: safeReference(a.log), report: safeReference(a.report) })) ?? [],
      delivery: delivery ? { state: delivery.state, reason: delivery.reasonCode, at: time(delivery.observedAt), sha: delivery.sha } : null,
      assessment: assessment ? { selected: assessment.facts?.selected ?? null, checkedAt: time(assessment.facts?.checkedAt), hash: safeReference(assessment.facts?.hash), analysisState: assessment.analysisState ?? 'unknown' } : null,
      dependencies: dependencies ?? null, conflicts,
      graph: manifest ? { analyzedAt: time(manifest.analyzedAt), hash: safeReference(manifest.hash), base: safeReference(manifest.base), baseSha: safeReference(manifest.baseSha) } : null,
      budget: budget ? { used: budget.used, remaining: budget.remaining } : null,
      preparation: recovery?.preparation && (recovery.preparation.ticket === ticket || recovery.preparation.scope === 'project') ? { state: recovery.preparation.state, code: recovery.preparation.code, at: time(recovery.preparation.at) } : null,
      followup: followup ? { state: followup.state, at: time(followup.changedAt), reason: safeExcerpt(followup.reason) } : null,
      nextPermissibleActions: [classification === 'confirmed-merged' ? 'Inspect retained merge evidence.' : classification === 'unknown' ? 'Obtain missing authoritative observations; preserve work and ownership.' : classification === 'delivery-wait' ? 'Observe normal delivery checks/reviews; do not start repair.' : 'Inspect original evidence; normal host gates and operator holds still apply.'],
    };
  });
  return { version: 1 as const, project: f.project, scope: f.scope, observedAt: f.at, authority: 'observation-only' as const,
    authorization: { global: auth?.global ?? 'unknown', project: auth?.project ?? 'unknown' },
    runtime: val(f.runtime) ? { id: safeReference(val(f.runtime)!.id), dependencies: safeReference(val(f.runtime)!.dependencies), mode: val(f.runtime)!.mode } : null,
    readiness: val(f.readiness) ? { status: safeExcerpt(val(f.readiness)!.status), observedAt: time(val(f.readiness)!.observedAt) } : null,
    recovery: recovery ? { active: recovery.active, inactiveReason: recovery.inactiveReason ? safeExcerpt(recovery.inactiveReason) : null, episode: recovery.episode ? { tickets: recovery.episode.tickets.slice(0, FACT_LIMITS.items), confirmedAt: time(recovery.episode.confirmedAt) } : null } : null,
    sources, work, omittedTickets: Math.max(0, ids.length - work.length),
    holds: [...sources.filter(s => s.status !== 'known').map(s => `${s.name}:${s.status}`), ...(auth?.global !== 'on' || auth?.project !== 'enabled' ? ['authorization-held'] : [])],
    launchAuthorized: false as const };
}
/** Explicit agent-context path only: host-owned exhaustive ticket/parent/comments collector, never a status read.
 * No persisted writes and no tracker mutations. Original bytes remain separate from display excerpts. */
export function collectSupervisorTicketInput(source: TicketContextSource, ticket: number) {
  const input = freezeTicketInput(source, ticket);
  const { child, parent } = input.context;
  const make = (role: Source['role'], locator: string, text: string, status: Source['status'] = 'complete'): Source => ({ role, locator, text, status, sha256: sourceHash(text) });
  const human = [child, ...(parent ? [parent] : [])].flatMap(t => t.notes.filter(n => !n.system));
  const sources: Source[] = [make('child', child.url, JSON.stringify(child)),
    parent ? make('parent', parent.url, JSON.stringify(parent)) : make('parent', `${child.url}#parent`, '', 'not-applicable'),
    human.length ? make('human-planning', `${child.url}#original-human-comments`, JSON.stringify(human)) : make('human-planning', `${child.url}#original-human-comments`, '', 'not-applicable')];
  // Do not silently summarize a 4 MiB ticket-input bundle into the smaller review contract.
  if (sources.some(s => s.text.length > 262144) || sources.reduce((n,s) => n + Buffer.byteLength(s.text), 0) > 2 * 1024 * 1024)
    throw Error('Supervisor original context exceeds review bounds; retained ticket sources require an authorized collection design.');
  return { input, sources };
}
/** Build the shared review snapshot only from exact original sources. Missing material stays a hold, not invented hashes.
 * Callers must supply every required source role, including original human planning and prior decisions. */
export function supervisorReviewSnapshot(input: { project: ProjectIdentity; scope: Scope; observedAt: string; material: Material; sources: Source[]; projectGuidelines: string[]; factoryConstraints: string[] }): Snapshot {
  return validateSnapshot({ ...input, version: 1, mode: 'observe' });
}
export { sourceHash };
