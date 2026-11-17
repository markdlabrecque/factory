// Passive supervisor inspection, audited fences/resolution and explicit named-ticket advisory diagnosis.
// Only diagnose composes the trusted host; no activation, scheduling, action or cross-process PID cancellation.
import { userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readSupervisor, commitSupervisor, supervisorHumanHold } from '../supervisor-state.mts';
import type { SupervisorState, Reservation } from '../supervisor-state.mts';
import { readSupervisorFacts } from '../supervisor-facts-host.mts';
import { safeExcerpt, safeReference } from '../supervisor-facts.mts';
import { supervisorHash } from '../../../orchestrator/supervisor-contract.mts';
import type { Diagnostic, DiagnosisDecision } from '../../../orchestrator/supervisor.mts';
import { readAdmission, admissionFile, ownerState } from '../../../board/admission.mts';
import { loadTomlConfig } from '../../../orchestrator/project-config.mts';
import type { SupervisorPolicy } from '../../../orchestrator/supervisor-policy.mts';
import { realpathSync, lstatSync } from 'node:fs';
import type { Paths } from '../paths.mts';
import { resolveProject, runStateDir, findRun } from '../runs.mts';
import { tomlIdentity } from '../../../orchestrator/project-config.mts';
import { resolveSupervisorRequest } from '../supervisor-escalation.mts';
import { prepareSupervisorHost } from '../supervisor-host.mts';
import { commandContextSource } from '../../../orchestrator/ticket-context-source.mts';
import type { DiagnosisResult } from '../supervisor-worker.mts';
import type { ScheduleBackend } from '../platform/scheduler.mts';
export function supervisorResolve(p: Paths, action: string | undefined, extra: string[], o: {
  project?: string; incident?: string; request?: string; proposal?: string; reason?: string; revised?: string; abandon?: boolean; confirm?: boolean;
}): number {
  if (action !== 'resolve' || extra.length) throw Error('Expected factory supervisor resolve with exact --incident --request --proposal --reason and --confirm');
  if (!o.confirm || !o.incident || !o.request || !o.proposal || !o.reason || (!!o.revised === !!o.abandon)) throw Error('Resolution requires --confirm, exact incident/request/proposal, reason and exactly one of --abandon or --revised <new-proposal-hash>');
  const ctx=resolveProject(p,{project:o.project});
  const identity=tomlIdentity(ctx.scaffold);
  // Do not accept a user-supplied actor or environment USER; the invoking host OS identity owns this control.
  const user=userInfo();
  const state=resolveSupervisorRequest({stateDir:runStateDir(p),project:{root:realpathSync(ctx.root),tracker:identity},incidentId:o.incident,requestId:o.request,
    proposalId:o.proposal,actor:`uid:${user.uid}:${user.username}`,reason:o.reason,nextProposalId:o.revised??null});
  console.log(`Recorded exact local resolution at revision ${state.revision}. Original denial/work/charges retained; no approval, action or automatic resume.`);
  return 0;
}

/** Strict named-current-run surface, deliberately independent of mode/resolve options. */
export function parseSupervisorDiagnosis(extra: string[], o: Record<string, unknown>): number {
  if (Object.entries(o).some(([k,v]) => v !== undefined && !['project','json'].includes(k))
    || typeof o.project !== 'string' || !o.project.trim() || extra.length !== 1 || !/^[1-9][0-9]*$/.test(extra[0])
    || !Number.isSafeInteger(Number(extra[0]))) throw Error('Expected factory supervisor diagnose <ticket> --project <name|path> [--json]');
  return Number(extra[0]);
}
/** One bounded advice contract for diagnose, passive CLI and Board. Never expose full drafts or gate patches. */
export function retainedRecommendation(decision: DiagnosisDecision | null | undefined) {
  if (!decision) return null;
  const a = decision.action;
  const nextStep = a.kind === 'wait' || a.kind === 'observe' ? { kind: a.kind, expectation: safeExcerpt(a.expectation) }
    : a.kind === 'request-repair' ? { kind: a.kind, ticket: a.ticket, runId: safeExcerpt(a.runId), expectation: safeExcerpt(a.expectation) }
    : a.kind === 'gate-change' ? { kind: a.kind, proposalId: a.proposal.id, category: a.proposal.change.category, path: safeReference(a.proposal.change.path), summary: 'Inspect exact retained proposal locally; full patch is private.' }
    : a.kind === 'follow-up-draft' ? { kind: a.kind, title: safeExcerpt(a.title), summary: 'Local draft only; full body is private. No ticket created.' }
    : { kind: a.kind, question: safeExcerpt(a.question), nextAction: safeExcerpt(a.nextAction), factoryWide: a.factoryWide };
  return { authority: 'advice-only', classification: decision.classification, rationale: safeExcerpt(decision.rationale),
    alternatives: decision.alternatives.slice(0,16).map(a => safeExcerpt(a)), nextStep,
    meaning: 'Retained, not current authority or automatically usable. Any future execution requires all original gates and fresh ownership/material checks.' };
}
/** Actual is a resource estimate, not an invoice. Legacy component reports never prove provider settlement. */
export function retainedAccounting(s: SupervisorState, r: Reservation | undefined) {
  const settlement = r ? s.advisory?.settlements?.[supervisorHash(r.id)] : undefined;
  return { costUnit: 'micro-usd', reserved: r?.reserved ?? null, actual: r?.actual ?? null,
    known: r ? r.actual !== null : null, provenance: !r || r.actual === null ? 'unknown' : settlement ? 'provider-usage-derived' : 'legacy-component-reported',
    providerInvoice: false, refunds: false, meaning: 'Reserved charge is retained; known resource usage and derived charge are not a provider invoice or refund.' };
}
/** Redacted terminal result: retain only selected identities, accounting and bounded advice, never worker bodies. */
export function supervisorDiagnosisProjection(s: SupervisorState, ticket: number, invocationId: string, result: DiagnosisResult, runId: string | null = null) {
  const diagnostic = 'diagnosticId' in result ? s.diagnostics?.[result.diagnosticId] ?? Object.values(s.diagnostics ?? {}).find(d => d.id === result.diagnosticId) : undefined;
  const reservation = Object.values(s.reservations).find(r => r.id === (diagnostic?.reservationId ?? invocationId));
  const incident = diagnostic ? s.incidents[diagnostic.incidentId] : undefined;
  return {version:1,authority:'advice-only',state:result.state,
    project:{root:safeReference(s.project.root),tracker:{kind:s.project.tracker.kind,host:safeExcerpt(s.project.tracker.host),project:safeExcerpt(s.project.tracker.project)}},
    ticket,runId:incident ? safeExcerpt(incident.facts.runId) : runId ? safeExcerpt(runId) : null,invocationId:safeExcerpt(invocationId),
    incidentId:diagnostic?.incidentId ?? null,diagnosticId:diagnostic?.id ?? null,
    reason:result.state === 'held' ? (result.reason.includes('quiescence has not been established')
      ? 'Independent older-runtime and unmanaged-work quiescence evidence is unavailable; no exclusion was acquired.'
      : result.reason === 'Bounded explicit OpenAI API-key handoff required for a new diagnosis'
      ? result.reason : 'Diagnosis held by current selection, authorization, ownership or provider prerequisites; inspect local originals.')
      : result.state === 'human-required' ? 'Retained human decision required; inspect exact diagnostic and accounting before any further work.' : 'Retained advice; not execution authority',
    recommendation:retainedRecommendation(diagnostic?.decision ?? ('decision' in result ? result.decision : null)),
    basis:diagnostic ? {basisHash:diagnostic.basisHash,snapshotHash:diagnostic.snapshotHash} : null,
    accounting:{...retainedAccounting(s,reservation),cumulativeCharged:s.charged},
    evidence:diagnostic ? [safeReference(diagnostic.inputRef)] : [],
    cancellation:{pending:!!reservation && reservation.state !== 'finished',meaning:'Owned cancellation may remain pending; no immediate termination or raw PID kill is claimed.'}};
}
/** Signals request cancellation, never process.exit/kill; await the owner's bounded terminal result. */
export async function withSupervisorCancellation(invoke: (signal: AbortSignal)=>Promise<number>, signals: Pick<NodeJS.Process,'on'|'off'> = process): Promise<number> {
  const abort=new AbortController(); let signalExit=0;
  const interrupt=()=>{signalExit ||= 130;abort.abort();}, terminate=()=>{signalExit ||= 143;abort.abort();};
  signals.on('SIGINT',interrupt);signals.on('SIGTERM',terminate);
  try { const code=await invoke(abort.signal);return signalExit || code; }
  catch (e) { if (signalExit) return signalExit; throw e; }
  finally {signals.off('SIGINT',interrupt);signals.off('SIGTERM',terminate);}
}
export type DiagnosisCommandServices = {
  backend: Pick<ScheduleBackend,'status'>;
  output?: (text:string)=>void;
  /** Component fixture only; never a public flag or installed capability assertion. */
  prepare?: typeof prepareSupervisorHost;
  signal?: AbortSignal;
  apiKey?: string;
};
export async function supervisorDiagnose(p: Paths, extra: string[], o: SupervisorOptions, services: DiagnosisCommandServices): Promise<number> {
  const ticket = parseSupervisorDiagnosis(extra,o), output=services.output ?? console.log, invocationId=randomUUID();
  p={...p,state:runStateDir(p)};
  let project: SupervisorState['project'] | undefined, runId: string | null = null;
  try {
    const ctx=resolveProject(p,{project:o.project});
    project={root:realpathSync(ctx.root),tracker:tomlIdentity(ctx.scaffold)};
    runId=findRun(p,ctx,String(ticket)).run?.executionId ?? null;
    if (!runId) throw Error('Supervisor host held: exact current saved execution required');
    const host=await (services.prepare ?? prepareSupervisorHost)({paths:p,project,ticket,invocationId,backend:services.backend,tracker:commandContextSource(project.tracker)});
    const result=await host.invoke(services.apiKey ?? '',services.signal);
    const state=readSupervisor(runStateDir(p),project);
    output(JSON.stringify(supervisorDiagnosisProjection(state,ticket,invocationId,result,runId),null,o.json ? undefined : 2));
    return result.state === 'human-required' ? 2 : ['proposed','reused'].includes(result.state) ? 0 : 1;
  } catch (e) {
    // Never echo arbitrary exception bodies (tracker/provider errors may contain credentials or raw output).
    const reason=e instanceof Error && /^(Supervisor host held:|Advisory held:)/.test(e.message) ? safeExcerpt(e.message) : 'Diagnosis held: project, saved run, controls, policy or supported runtime unavailable; inspect local originals.';
    let state: SupervisorState | null = null;
    try { if (project) state=readSupervisor(runStateDir(p),project); } catch { /* invalid journals are never repaired */ }
    output(JSON.stringify(state ? {...supervisorDiagnosisProjection(state,ticket,invocationId,{state:'held',reason},runId),reason} : {version:1,authority:'advice-only',state:'held',ticket,invocationId,runId:null,reason}));
    return 1;
  }
}

export type SupervisorOptions = { project?: string; json?: boolean; pilot?: boolean; confirm?: boolean; offset?: string };
export const SUPERVISOR_PAGE_SIZE = 128;
export function parseSupervisorControl(action: string | undefined, extra: string[], o: SupervisorOptions) {
  if (o.offset !== undefined && (!['status','explain'].includes(action ?? '') || !/^(0|[1-9]\d*)$/.test(o.offset) || !Number.isSafeInteger(Number(o.offset)))) throw Error('--offset requires a nonnegative safe integer and status or explain');
  if (action === 'mode' && extra.length === 1 && ['observe','act'].includes(extra[0])) {
    if (o.json || (extra[0] !== 'act' && (o.pilot || o.confirm))) throw Error('Use --pilot --confirm only with mode act; --json only with status/explain');
    return extra[0] as 'observe' | 'act';
  }
  if (['status','explain','stop'].includes(action ?? '') && !extra.length && !o.pilot && !o.confirm && (action !== 'stop' || !o.json)) return action as 'status' | 'explain' | 'stop';
  throw Error('Expected supervisor status|explain [--json], mode observe, mode act --pilot --confirm, or stop --project <name|path>');
}
/** Necessary policy gates only. Production has no demonstrated all-in provider/authority adapter and refuses activation. */
export function supervisorActRefusal(policy: SupervisorPolicy, o: SupervisorOptions, prerequisites: string[]): string | null {
  if (!o.pilot || !o.confirm) return 'Explicit one-project pilot opt-in required: mode act --pilot --confirm. This does not enable scheduling or unpause the project.';
  const l = policy?.limits;
  if (!policy?.enabled || !l) return 'Configure enabled supervisor policy and explicit finite project/diagnosis/review limits first.';
  for (const caps of [l, l.diagnosis, l.review]) {
    if (!caps || ![caps.maxTokens,caps.maxCostUsd,caps.maxCalls].every(n => Number.isFinite(n) && n > 0)
      || !Number.isSafeInteger(caps.maxTokens) || !Number.isSafeInteger(caps.maxCalls)) return 'Invalid or unknown finite supervisor budgets; correct project policy before opting in.';
  }
  if (![l.diagnosis,l.review].every(c => Number.isFinite(c.timeoutSeconds) && c.timeoutSeconds > 0 && c.timeoutSeconds <= 600)) return 'Configure bounded diagnosis/review timeouts (at most 600 seconds).';
  return prerequisites.length ? prerequisites.join(' ') : null;
}
/** Deliberately select display fields: never expose original prompts, substitutions, raw stdout/stderr or arbitrary journal bodies. */
export function supervisorProjection(s: SupervisorState, facts: ReturnType<typeof readSupervisorFacts>, policy: SupervisorPolicy | null, refusal: string | null, offset = 0, admission: ReturnType<typeof retainedAdmission> = {state:'unknown',holds:[],total:null}) {
  const omitted: Record<string, { total: number; before: number; after: number }> = {};
  const page = <T>(name: string, index: Record<string,T>, priority: (v: T) => boolean = () => false): T[] => {
    const entries = Object.entries(index).sort(([ak,a],[bk,b]) => Number(priority(b))-Number(priority(a)) || ak.localeCompare(bk));
    omitted[name] = {total: entries.length, before: Math.min(offset,entries.length), after: Math.max(0,entries.length-offset-SUPERVISOR_PAGE_SIZE)};
    return entries.slice(offset,offset+SUPERVISOR_PAGE_SIZE).map(([,v])=>v);
  };
  const workers = page('workers', s.reservations, r => r.state !== 'finished').map(r => ({ id: safeExcerpt(r.id), kind: r.kind, owner: { pid: r.owner.pid, start: safeExcerpt(r.owner.start) }, state: r.state,
    deadline: r.deadline, reserved: r.reserved, actual: r.actual, accounting: retainedAccounting(s,r), ownership: ownerState(r.owner) }));
  const latest = Object.values(s.diagnostics ?? {}).reduce<Diagnostic | undefined>((last,d) => !last || d.completedAt > last.completedAt || d.completedAt === last.completedAt && d.id > last.id ? d : last, undefined);
  const humanHold = supervisorHumanHold(s);
  const identity = { root: safeReference(s.project.root), tracker: { ...s.project.tracker, host: safeExcerpt(s.project.tracker.host), project: safeExcerpt(s.project.tracker.project) } };
  return { version: 1 as const, authority: 'observation-only' as const, project: identity,
    journal: { state: s.revision === 0 ? 'none' : 'retained', meaning: s.revision === 0 ? 'No retained journal for this project; admission exclusions are separate and may still hold.' : 'Validated retained observation, not current execution authority.' },
    admission,
    revision: s.revision, mode: s.control?.mode ?? 'observe', operator: s.control ? { actor: safeExcerpt(s.control.actor), at: s.control.at, pilot: s.control.pilot } : null,
    owners: workers, incidents: page('incidents', s.incidents, m => m.denied || m.incident.state === 'human-required').map(m => ({ id: m.incident.id, scope: m.incident.scope, state: m.incident.state,
      reason: safeExcerpt(m.incident.reason), denied: m.denied, superseded: m.superseded, diagnosisCalls: m.incident.diagnosisCalls, snapshotHash: m.incident.snapshotHash, evidenceBasis: { ...m.facts, runId: safeExcerpt(m.facts.runId) } })),
    proposals: page('proposals', s.proposals).map(p => ({ id: p.id, incidentId: p.incidentId, snapshotHash: p.snapshotHash, scope: p.scope, category: p.change.category, expiresAt: p.change.expiresAt,
      change: { path: safeReference(p.change.path), patch: 'Private: inspect exact retained originals locally.', owner: { ticket: p.change.owner.ticket, runId: safeExcerpt(p.change.owner.runId) } },
      rationale: safeExcerpt(p.rationale), alternatives: p.alternatives.map(a => safeExcerpt(a)), risks: p.risks.map(r => safeExcerpt(r)),
      display: 'Redacted bounded display only. Exact proposal ID binds retained originals; inspect originals locally before deciding, never authorize from display text.' })),
    proposedNextAction: latest?.decision ? { kind: latest.decision.action.kind, diagnosticId: latest.id, input: safeReference(latest.inputRef), recommendation: retainedRecommendation(latest.decision) } : null,
    diagnostics: page('diagnostics', s.diagnostics ?? {}).map(d => ({ id:d.id, incidentId:d.incidentId, invocationId:safeExcerpt(d.reservationId),
      runId:s.incidents[d.incidentId] ? safeExcerpt(s.incidents[d.incidentId].facts.runId) : null, basisHash:d.basisHash, snapshotHash:d.snapshotHash,
      input:safeReference(d.inputRef), outcome:d.outcome, reason:safeExcerpt(d.reason), completedAt:d.completedAt,
      recommendation:retainedRecommendation(d.decision), accounting:retainedAccounting(s,Object.values(s.reservations).find(r=>r.id===d.reservationId)) })),
    hostDecision: { humanRequired: humanHold, actionAuthorized: false, latestDiagnosis: latest ? { id: latest.id, outcome: latest.outcome, reason: safeExcerpt(latest.reason), completedAt: latest.completedAt } : null, refusal: refusal ? safeExcerpt(refusal) : 'Mode is not execution authority; fresh host admission and proof remain required.' },
    humanRequests: page('humanRequests', s.humans, h => !s.resolutions?.[h.incidentId]).map(h => ({ id: safeExcerpt(h.id), incidentId: h.incidentId, proposalId: h.proposalId, scope: h.scope,
      reason: safeExcerpt(h.reason), question: safeExcerpt(h.question), nextAction: safeExcerpt(h.nextAction), evidence: h.evidence.map(e => safeReference(e)),
      delivery: { state: h.delivery.state, attempts: h.delivery.attempts, receipt: h.delivery.state === 'notified' ? safeReference(h.delivery.receipt) : null, receiptId: h.delivery.state === 'notified' ? /#(?:issuecomment-|note_)([1-9][0-9]*)$/.exec(h.delivery.receipt)?.[1] ?? null : null, meaning: 'Delivery is not approval.' }, resolution: s.resolutions?.[h.incidentId] ? { at: s.resolutions[h.incidentId].at, nextProposalId: s.resolutions[h.incidentId].nextProposalId } : null })),
    reviews: page('reviews', s.reviews).map(r => ({ id: safeExcerpt(r.id), proposalId: r.proposalId, inputHash: r.inputHash, originalInput: safeReference(s.reviewCompletions?.[supervisorHash(r.id)]?.inputRef), completedAt: r.completedAt, disposition: r.disposition, reason: safeExcerpt(r.reason),
      hostCompletion: !!s.reviewCompletions?.[supervisorHash(r.id)], meaning: 'Reviewer decision only; not execution, verifier PASS or completion.' })),
    budgets: { costUnit: 'micro-usd', configured: policy?.limits ?? null, cumulativeCharged: s.charged, reservations: workers.map(({owner,...r}) => r), refunds: false },
    execution: page('execution', s.intents, m => m.outcome === 'pending' || m.outcome === 'unknown').map(m => ({ id: safeExcerpt(m.intent.id), proposalId: m.intent.proposalId, outcome: m.outcome, meaning: 'Retained observation, not completion authority.' })),
    telemetry: { projectKey: supervisorHash(s.project), coverage: 'observed-only', costUnit: 'micro-usd',
      roles: Object.fromEntries((['diagnosis','review'] as const).map(kind => { const reservations = Object.values(s.reservations).filter(r => r.kind === kind);
        const known = reservations.filter(r => r.actual !== null);
        return [kind, { charged: s.charged[kind], knownUsage: known.length ? known.reduce((sum,r) => ({ tokens: sum.tokens + r.actual!.tokens, cost: sum.cost + r.actual!.cost }), { tokens: 0, cost: 0 }) : null,
          unknownUsageReservations: reservations.filter(r => r.actual === null).length, accounting: !reservations.length ? 'none' : reservations.some(r => r.actual === null) ? 'unknown' : 'known' }]; })),
      interventions: Object.keys(s.resolutions ?? {}).length, meaning: 'Explicit audited resolutions only. Requests and delivery receipts are not human resolutions or progress.' },
    confirmedProgress: facts.work.filter(w => w.confirmedProgress).map(w => ({ ticket: w.ticket, ...w.confirmedProgress })),
    nextObservation: humanHold ? 'Inspect exact human request and originals; use audited resolve for abandonment or an exact material successor, never approve-all.' : 'Read current host observations; no automatic model, review, repair or tracker refresh is started.',
    cancellation: { pendingTotal: Object.values(s.reservations).filter(r => r.state !== 'finished').length, pending: workers.filter(w => w.state !== 'finished').map(w => w.id), limitation: 'Stop fences new supervisor work. Existing admitted operations retain ownership; no safe cross-process cancellation adapter is shipped. Active workers remain bounded by their deadline/owned termination boundary; inspect accounting and cleanup before resumption.' },
    pagination: { offset, limit: SUPERVISOR_PAGE_SIZE, collections: omitted, nextAction: 'Use status/explain --offset <next offset> for further entries; compare revision between pages. Holds/owners sort first; pagination never removes journal records.' },
    facts: { ...facts, project: identity } };
}
/** Passive compatible admission decode: no lock, pruning, migration writes, reconciliation or release, including dead owners. */
export function retainedAdmission(stateDir: string, project: SupervisorState['project'], offset = 0) {
  try {
    const stat=lstatSync(admissionFile(stateDir));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2*1024*1024) throw Error('Unsafe admission observation');
    const state = readAdmission(stateDir);
    const holds = Object.values(state.supervisorHolds).filter(h => supervisorHash(h.project) === supervisorHash(project)).sort((a,b)=>a.id.localeCompare(b.id));
    return { state:'observed', total:holds.length, holds:holds.slice(offset,offset+SUPERVISOR_PAGE_SIZE).map(h => ({ id:safeExcerpt(h.id), invocationId:safeExcerpt(h.invocationId),
      owner:{pid:h.owner.pid,start:safeExcerpt(h.owner.start)}, ownership:ownerState(h.owner), pending:h.pending.length, settled:h.settled.length,
      meaning:'Retained project exclusion, not finished even if its process is dead. Exact settlement required.' })),
      before:Math.min(offset,holds.length),after:Math.max(0,holds.length-offset-SUPERVISOR_PAGE_SIZE) };
  } catch { return { state:'unknown', total:null, holds:[] }; }
}
export type SupervisorServices = {
  now?: () => number;
  /** Trusted host capability refusals, never agent/tracker input. Empty is useful only in offline control fixtures. */
  prerequisites?: () => string[];
  /** A host implementation may cancel only these exact reservation-owned diagnosis/review groups via their worker AbortSignal/terminate boundary. */
  cancelOwned?: (reservations: Reservation[]) => Promise<boolean>;
  output?: (text: string) => void;
};
export async function supervisorCommand(p: Paths, action: string | undefined, extra: string[], o: SupervisorOptions, services: SupervisorServices = {}): Promise<number> {
  const command = parseSupervisorControl(action, extra, o), output = services.output ?? console.log;
  let ctx, project, s: SupervisorState;
  try {
    ctx = resolveProject(p, { project: o.project });
    project = { root: realpathSync(ctx.root), tracker: tomlIdentity(ctx.scaffold) };
    s = readSupervisor(runStateDir(p), project);
  } catch { throw Error('Supervisor project/journal unavailable or invalid. Check --project registration, tracker identity and host journal permissions/schema; no state was repaired.'); }
  let policy: SupervisorPolicy | null = null, workflow: string | null = null;
  try { const config = loadTomlConfig(ctx.scaffold); policy = config.supervisor; workflow = config.workflow.mode; } catch { /* unknown config is displayable, never activation authority */ }
  const prerequisites = [...(workflow === 'factory' ? [] : ['Unknown or opaque project workflow has no supported supervisor authority contract; use a separately evidenced supported workflow.']), ...(services.prerequisites?.() ?? [
    'Action activation unavailable: no committed CLI host adapter supplies finite global limits/capacity, supported workflow/action authority, authorized notification target and provider-enforceable all-in token/cost accounting. Establish these prerequisites before a separately authorized pilot; mode alone cannot supply them.',
  ])];
  if (command === 'status' || command === 'explain') {
    const facts = readSupervisorFacts(p, ctx, { project, scope: { kind: 'project' }, now: () => new Date((services.now ?? Date.now)()).toISOString() });
    const projection = supervisorProjection(s, facts, policy, supervisorActRefusal(policy!, { pilot: true, confirm: true }, prerequisites), Number(o.offset ?? 0), retainedAdmission(runStateDir(p),project,Number(o.offset ?? 0)));
    output(o.json ? JSON.stringify(projection) : JSON.stringify(projection, null, 2));
    return 0;
  }
  if (command === 'act') {
    const refusal = supervisorActRefusal(policy!, o, prerequisites);
    if (refusal) throw Error(refusal);
  }
  const user = userInfo();
  s = commitSupervisor(runStateDir(p), project, s.revision, { kind: 'control', id: `operator:${randomUUID()}`, at: new Date((services.now ?? Date.now)()).toISOString(),
    mode: command === 'stop' ? 'stopped' : command, actor: `uid:${user.uid}:${user.username}`, pilot: command === 'act' });
  const active = Object.values(s.reservations).filter(r => r.state !== 'finished');
  if (command === 'stop' && active.length) {
    let confirmed = false;
    try { confirmed = await services.cancelOwned?.(active) === true; } catch { /* durable fence remains */ }
    if (!confirmed) { output('Supervisor stopped for new work; owned worker cancellation/accounting is pending. No safe cross-process cancellation adapter is available. Inspect retained reservation/process evidence and use its owning worker termination boundary; implementation runs were not signalled.'); return 1; }
  }
  output(`Supervisor ${s.control!.mode}; original denial, human holds, work and cumulative charges retained. No scheduling, unpause, approval or action launched.`);
  return 0;
}
