// Host-only stopped-work preparation. Import-safe core; the CLI adapter acquires managed admission before tracker/model work.
// No assessments, run verdicts, saved implementation, ownership receipts or recovery budgets are written here.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freezeTicketInput, TicketInputHold, type FrozenTicketInput } from './ticket-input.mts';
import type { Manifest, Note } from './graph.mts';
import type { Ticket } from './tracker.mts';
import { digest, held } from './recovery-analysis-contract.mts';
import type { Preparation } from './recovery-analysis-contract.mts';
import type { DependencyResult } from './dependencies.mts';

export type Inputs = { ticket: Ticket; input: FrozenTicketInput; notes: Note[]; catalogue: Ticket[]; knownProviders: Ticket[]; baseSha: string; base?: string;
  model: string; provider: string; prompt: string; schema: string; providerDescriptions: unknown; blockers: Manifest['implementerBlockers']; eligibility?: string; policyIdentity?: string };
/** Include normalized requirements plus the exact catalogue/provider/prompt/model inputs seen by the analyst. */
export function recoveryAnalysisKey(i: Inputs): string {
  const tickets = (ts: Ticket[]) => [...ts].sort((a,b) => a.iid-b.iid).map(t => [t.iid,t.title,t.description,t.parent,t.state]);
  return digest(JSON.stringify([2,i.ticket.iid,i.input.hash,i.base,i.baseSha,tickets(i.catalogue),tickets(i.knownProviders),
    i.policyIdentity,i.model,i.provider,i.prompt,i.schema,i.providerDescriptions,i.blockers ?? [],i.eligibility ?? '']));
}
export interface PreparationDeps {
  project: string; root: string; base: string; ticket: number;
  read(): Inputs; manifest(): Manifest | undefined; manifestDigest(): string;
  analyse(i: Inputs): Manifest;
  publish(m: Manifest, expected: string): boolean;
  dependency(iid: number): DependencyResult;
  /** Called after synchronous read-only analyst settles. Never force-remove dirty work. */
  cleanup(): string | undefined;
}
function prerequisite(m: Manifest, d: PreparationDeps): Preparation | undefined {
  const rs = [...m.requires.map(r => ({ iid:r.providedBy, what:r.what })), ...(m.implementerBlockers ?? [])];
  for (const r of rs) {
    if (r.iid == null) return held('unknown-dependency', `Unlinked or human prerequisite: ${r.what}`);
    let state: DependencyResult;
    try { state = d.dependency(r.iid); } catch (e) { return held('unknown-dependency', `Dependency #${r.iid}: ${(e as Error).message}`, 'project'); }
    if (state.state !== 'satisfied') return held(state.state === 'unknown' ? 'unknown-dependency' : 'unmet-dependency', `Dependency #${r.iid}: ${state.reason ?? r.what}`, state.state === 'unknown' ? 'project' : 'ticket');
  }
}
function prepareCore(d: PreparationDeps): Preparation {
  try {
    const originalDigest = d.manifestDigest(), previous = d.manifest();
    if (!previous && originalDigest !== digest('')) return held('stale','Saved execution manifest is unreadable; preserve it for operator review','project');
    if (previous && (previous.iid !== d.ticket || previous.project !== d.project)) return held('ownership','Saved manifest target identity mismatch','project');
    const input = d.read();
    if (input.eligibility) return held('eligibility',input.eligibility);
    const key = recoveryAnalysisKey(input);
    let next = previous;
    if (next?.recoveryAnalysisKey !== key || next.base !== d.base || next.baseSha !== input.baseSha || next.hash !== input.input.hash) {
      try { next = { ...d.analyse(input), recoveryAnalysisKey:key,
        ...(previous?.actualFootprint ? {actualFootprint:previous.actualFootprint} : {}),
        ...(previous?.implementerBlockers ? {implementerBlockers:previous.implementerBlockers} : {}) }; }
      catch (e) { return held(/timeout|timed out|ETIMEDOUT/i.test(String(e)) ? 'timeout' : 'analysis-failed',String(e)); }
    }
    const cleanupProblem = d.cleanup();
    if (cleanupProblem) return held('ownership',cleanupProblem,'project');
    const fresh = d.read();
    if (recoveryAnalysisKey(fresh) !== key) return held('changed','Execution analysis inputs changed during preparation; retry next pass');
    if (!next) return held('stale','No execution analysis');
    const hold = prerequisite(next,d); if (hold) return hold;
    // Re-read after prerequisite I/O as well. This is not an atomic remote tracker transaction.
    if (recoveryAnalysisKey(d.read()) !== key) return held('changed','Inputs changed during prerequisite validation');
    let published = d.manifestDigest() === originalDigest;
    if (published && next !== previous) {
      try { published = d.publish(next,originalDigest); }
      catch (e) { return held(/locked by process/.test(String(e)) ? 'changed' : 'ownership',
        `Execution manifest publication deferred: ${e}`, /locked by process/.test(String(e)) ? 'ticket' : 'project'); }
    }
    if (!published) {
      const winner = d.manifest();
      if (winner?.recoveryAnalysisKey !== key || winner.base !== d.base || winner.iid !== d.ticket || winner.project !== d.project || winner.baseSha !== input.baseSha || winner.hash !== next.hash)
        return held('changed','Another execution manifest writer won publication; retry next pass');
      const winnerHold = prerequisite(winner,d); if (winnerHold) return winnerHold;
    }
    return {version:1,state:'ready',code:'ready',scope:'ticket',reason:'Current execution analysis and prerequisites validated',
      project:d.project,root:resolve(d.root),ticket:d.ticket,base:d.base,requirementsHash:next.hash,baseSha:input.baseSha,
      analysisKey:key,manifestDigest:d.manifestDigest()};
  } catch (e) { return e instanceof TicketInputHold ? held('ticket-input', e.message, 'ticket') : held('config',String(e),'project'); }
}
/** Cleanup uncertainty overrides readiness, including a dirty invocation-owned analysis worktree. */
export function prepareRecoveryAnalysis(d: PreparationDeps): Preparation {
  let cleaned=false, problem:string|undefined;
  const cleanup = () => {
    if (!cleaned) {
      cleaned=true;
      try { problem=d.cleanup(); } catch (e) { problem=`Analysis workspace cleanup unconfirmed: ${e}`; }
    }
    return problem;
  };
  const result = prepareCore({...d,cleanup});
  cleanup();
  return problem ? held('ownership',problem,'project') : result;
}
async function main(): Promise<Preparation> {
  const [ticketText, base] = process.argv.slice(2), ticket = Number(ticketText), root = process.cwd();
  if (!Number.isSafeInteger(ticket) || ticket <= 0 || !base || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base) || base.includes('..'))
    return held('config','Expected numeric ticket and recorded base','project');
  const runtime = await import('./runtime-config.mts');
  const { retainRuntime } = await import('./context.mts');
  const { claimManagedEntry, releaseManagedEntry } = await import('./admission.mts');
  const rt = runtime.TRACKER, entry = claimManagedEntry(runtime.context.sharedState, { root: runtime.context.projectRoot,
    tracker: { kind: rt.kind, host: rt.gitlabHost ?? rt.host!, project: rt.project } });
  let entryCleanupConfirmed = true;
  try {
  const lease = await retainRuntime(runtime.context);
  const tracker = await import('./tracker.mts');
  const store = await import('./manifests.mts');
  const { analyse, analysisWorktree, ANALYSIS_SCHEMA } = await import('./analyze.mts');
  const { dependencyState } = await import('./dependencies.mts');
  const { readRuns, stateDir } = await import('./board.mts');
  const project = runtime.TRACKER.project;
  const { projectLaunchReadiness, readinessReason, recordTicketInput } = await import('./launch-readiness.mts');
  const hostReport = await projectLaunchReadiness({ projectRoot: root, runtimeRoot: runtime.context.runtimeRoot, runtimeIdentity: runtime.context.manifest.id, runtimeDependencies: runtime.context.manifest.dependencies, config: runtime.effectiveConfig, stateRoot: stateDir(), base });
  const hostHold = readinessReason(hostReport);
  if (hostHold) return held('config', hostHold, 'project');
  const git = (args: string[], cwd = root) => execFileSync('git',args,{cwd,encoding:'utf8',timeout:20_000,killSignal:'SIGKILL',stdio:['ignore','pipe','pipe']}).trim();
  let workspace: {path:string;sha:string} | undefined;
  // Tracker calls have individual deadlines and the parent process owns the total preparation deadline.
  const read = (): Inputs => {
    runtime.context.assertCurrent();
    tracker.setDeliveryDeadline(Date.now()+20_000);
    let input: FrozenTicketInput;
    try { input = freezeTicketInput(tracker.contextSource, ticket); }
    catch (error) { if (error instanceof TicketInputHold) recordTicketInput(stateDir(), hostReport, error); throw error; }
    recordTicketInput(stateDir(), hostReport, input);
    const t = { ...tracker.ticket(ticket), title: input.context.child.title, description: input.context.child.description }, parent = input.context.parent?.iid;
    if (parent !== undefined) { const p = input.context.parent!; t.parent = {iid:p.iid,title:p.title,description:p.description}; }
    const notes = input.context.child.notes, catalogue = tracker.workCatalogue(runtime.SUBTASKS.enabled).tickets;
    const previous = store.readManifest(project,ticket);
    const ids = new Set([...(previous?.requires ?? []).map(r => r.providedBy), ...(previous?.implementerBlockers ?? []).map(r => r.iid)]);
    const knownProviders: Ticket[] = [];
    for (const id of ids) if (id != null && !catalogue.some(t => t.iid === id)) knownProviders.push(tracker.ticket(id));
    git(['fetch','origin',`refs/heads/${base}:refs/remotes/origin/${base}`]);
    const baseSha = git(['rev-parse',`refs/remotes/origin/${base}`]);
    return {ticket:t,input,notes,catalogue,knownProviders,base,baseSha,policyIdentity:runtime.context.policyIdentity,model:runtime.GRAPH.model,provider:runtime.AGENT.provider,
      prompt:runtime.context.templates['prompt.analyze.md'],schema:JSON.stringify(ANALYSIS_SCHEMA),
      providerDescriptions:catalogue.filter(t => t.iid !== ticket).map(t => [t.iid,store.readManifest(project,t.iid)?.provides ?? []]).sort((a,b) => Number(a[0])-Number(b[0])),blockers:previous?.implementerBlockers,
      eligibility:!['open','opened'].includes(t.state ?? '') ? 'Ticket is closed or eligibility unknown' :
        (t.labels ?? []).some(l => l === runtime.LABELS.needsHuman || runtime.LABELS.exclude.includes(l)) ? 'Ticket is excluded or needs human review' : undefined};
  };
  return prepareRecoveryAnalysis({project,root,base,ticket,read,manifest:() => store.readManifest(project,ticket),manifestDigest:() => store.manifestDigest(project,ticket),
    analyse:i => {
      workspace = {path:resolve(stateDir(),'worktrees',`recovery-${randomUUID()}`),sha:i.baseSha};
      console.error(`Invocation-owned analysis workspace: ${workspace.path}; preserve if this process does not finish cleanup`);
      entryCleanupConfirmed = false;
      lease.pendingCleanup();
      workspace = analysisWorktree(project,base,workspace.path);
      return analyse({project,base,worktree:workspace,ticket:i.ticket,input:i.input,
      notes:i.notes,catalogue:i.catalogue,manifests:store.readManifests(project),knownProviders:i.knownProviders,keepImplementerBlockers:true}); },
    publish:store.publishManifest,
    dependency:iid => { tracker.setDeliveryDeadline(Date.now()+20_000); return dependencyState(iid,{ticket:tracker.ticket,mergedInto:tracker.mergedInto,base,
      run:id => readRuns(stateDir(),false).find(r => r.project === project && Number(r.iid) === id)}); },
    cleanup:() => { if (!workspace) return; if (git(['status','--porcelain','--untracked-files=all'],workspace.path)) return `Analysis workspace is not clean; preserved at ${workspace.path}`;
      git(['worktree','remove',workspace.path]); entryCleanupConfirmed = true; lease.confirmedCleanup(); },
  });
  } finally { if (entryCleanupConfirmed) releaseManagedEntry(runtime.context.sharedState, entry); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // The helper owns stdout exclusively. Runtime diagnostics go to stderr, never into the JSON protocol.
  console.log = (...args) => console.error(...args);
  main().catch(e => held('config',String(e),'project')).then(r => process.stdout.write(JSON.stringify(r)+'\n'));
}
