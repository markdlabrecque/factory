// Trusted explicit advisory host: read-only exact reuse precedes paid ownership; genuine current controls/originals feed
// the existing owned worker. Original terminal receipts permit exact idempotent release, never activation or advice execution.
import { existsSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Paths } from './paths.mts';
import type { ScheduleBackend } from './platform/scheduler.mts';
import type { TicketContextSource } from '../../orchestrator/ticket-context.mts';
import type { ProjectIdentity } from '../../orchestrator/supervisor-contract.mts';
import type { SupervisorState, AdvisoryControls } from './supervisor-state.mts';
import { chargedResources, readSupervisor, readSupervisorProjects } from './supervisor-state.mts';
import { diagnoseProject } from './supervisor-worker.mts';
import { readRegistry } from './project-registry.mts';
import { schedulingState } from './scheduling-observation.mts';
import { readHostAdvisoryPolicy, advisoryLimitHold } from './supervisor-host-policy.mts';
import { profileForAuth, type AdvisoryAuth } from './supervisor-advisory-contract.mts';
import { resolvePiLogin } from './supervisor-auth.mts';
import { createSupervisorRuntime } from './supervisor-runtime.mts';
import { readSupervisorRollout, assertRolloutWindow, type RolloutPin } from './supervisor-rollout.mts';
import { canonicalAdmissionProject, claimSupervisorHold, checkSupervisorHold, releaseSupervisorHold } from './supervisor-admission.mts';
import { collectSupervisorInput, readSupervisorOriginal } from './supervisor-input.mts';
import type { HoldKey } from './supervisor-admission.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { supervisorHash } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
const { keyFor } = await import(flat ? './admission.mts' : '../../board/admission.mts');

/** Every call queries the real backend interface and rereads the existing registry. No advisory-specific opt-in bypass. */
export async function readSupervisorHostControls(paths: Paths, root: string, backend: Pick<ScheduleBackend, 'status'>): Promise<AdvisoryControls> {
  const canonical = realpathSync(root);
  if (canonical !== root) throw Error('Supervisor host held: canonical root required');
  const global = await schedulingState(backend);
  // Registry comes after the asynchronous query: never carry a pre-query opt-in observation across an await.
  const projects = readRegistry(paths).projects.filter(p => realpathSync(p.root) === root);
  return { registered: projects.length === 1 && projects[0].root === root, global: global.state,
    projectControl: projects.length !== 1 ? 'unknown' : projects[0].schedule?.enabled === true ? 'enabled' : 'paused' };
}

export type SupervisorHostOptions = {
  paths: Paths; project: ProjectIdentity; ticket: number; invocationId: string;
  auth?: AdvisoryAuth;
  /** Source-only offline resolver seam. Public CLI cannot select a resolver. */
  resolveLogin?: (signal?: AbortSignal) => Promise<string>;
  backend: Pick<ScheduleBackend, 'status'>;
  /** Explicit bounded read-only tracker source. Auth is not discovered by this API. */
  tracker: TicketContextSource;
  /** Component-test-only prerequisite. Public CLI never supplies this; it reads the private operator record instead.
   * Neither source replaces actual runtime compatibility, raw custody or finite spending controls. */
  rollout?: { olderRuntimesQuiesced: true; unmanagedWorkQuiesced: true };
};
/** Rebuild before cache reuse; acquire exact exclusion/pins only before a NEW paid reservation. Failure after acquisition retains ownership.
 * Returned current() always rebuilds originals before cache comparison, outside every admission/journal/runtime lock.
 * Explicit invoke delegates to the existing owned worker; no activation. Only exact terminal receipts permit release. */
export async function prepareSupervisorHost(o: SupervisorHostOptions) {
  o = {...o,paths:structuredClone(o.paths),project:structuredClone(o.project),rollout:structuredClone(o.rollout)};
  const project = canonicalAdmissionProject(o.project), p = structuredClone(o.paths), profile = profileForAuth(o.auth);
  if (supervisorHash(project) !== supervisorHash(o.project) || !Number.isSafeInteger(o.ticket) || o.ticket <= 0
    || !/^[A-Za-z0-9_-]{1,200}$/.test(o.invocationId)) throw Error('Supervisor host held: exact project/ticket/invocation required');
  const assertControls = async () => {
    const controls = await readSupervisorHostControls(p,project.root,o.backend);
    if (!controls.registered || controls.global !== 'on' || controls.projectControl !== 'enabled')
      throw Error(`Supervisor host held: registration=${controls.registered}, global=${controls.global}, project=${controls.projectControl}`);
    return controls;
  };
  await assertControls();
  // Missing/unsafe host policy is refused before claiming ownership. No directory/policy provisioning here.
  if (readHostAdvisoryPolicy(p.config,[project.root]).policy.profile !== profile)
    throw Error('Supervisor host held: explicit auth selection differs from host profile');
  const runKey = keyFor(String(o.ticket),project.tracker.project);
  const saved = JSON.parse(readSupervisorOriginal(join(p.state,`${runKey}.json`)));
  if (saved.project !== project.tracker.project || saved.iid !== String(o.ticket) || typeof saved.executionId !== 'string')
    throw Error('Supervisor host held: exact current saved run required');
  // Resolve the complete selected runtime without importing arbitrary selected code. Runtime creation below pins it.
  const { resolveWorkflow } = await import(flat ? './workflow.mts' : '../../orchestrator/workflow.mts');
  const workflow = resolveWorkflow(project.root,p.runtimeDescriptor,undefined,p.state);
  // Read-only collection/reuse precedes paid ownership: a cache hit creates no hold or pin.
  const fence = randomUUID();
  let hold: ReturnType<typeof claimSupervisorHold> | undefined, released = false;
  const runtime = await createSupervisorRuntime({paths:p,projectRoot:project.root,stateDir:p.state,invocationId:o.invocationId,fence,deferLease:true,profile});
  let rolloutPin: RolloutPin | undefined;
  const readRollout = () => readSupervisorRollout(p.config,{project,host:runtime.identity.host,
    hostDependencies:runtime.identity.hostDependencies,selected:runtime.identity.selected,dependencies:runtime.identity.dependencies},
    [project.root,workflow.env.FACTORY_HOST_RUNTIME_ROOT,runtime.context.runtimeRoot]);
  const acquire = async () => {
    if (hold) throw Error('Supervisor host held: invocation already attempted paid acquisition');
    if (!o.rollout) rolloutPin = readRollout();
    const timeout = runtime.context.config.supervisor.limits!.diagnosis.timeoutSeconds * 1000;
    if (rolloutPin) assertRolloutWindow(rolloutPin,registrationAt!,timeout);
    hold = claimSupervisorHold(p.state,{project,invocationId:o.invocationId,fence,runtimeRoot:workflow.root,
      savedRun:{key:runKey,executionId:saved.executionId},rollout:o.rollout ?? {olderRuntimesQuiesced:true,unmanagedWorkQuiesced:true}});
    runtime.acquire();
  };
  const selectedTracker = runtime.context.config.TRACKER;
  if (runtime.context.projectRoot !== project.root || supervisorHash({kind:selectedTracker.kind,host:selectedTracker.gitlabHost ?? selectedTracker.host!,project:selectedTracker.project}) !== supervisorHash(project.tracker))
    throw Error('Supervisor host held: selected project/tracker changed');
  const output = join(p.state,'supervisor','originals',supervisorHash(project),supervisorHash(o.invocationId));
  mkdirSync(output,{recursive:true,mode:0o700});
  let registrationAt: string | undefined;
  const current = async () => {
    runtime.assertCurrent(); runtime.context.assertCurrent({strictOriginals:true});
    const controls = await assertControls();
    if (rolloutPin && supervisorHash(readRollout()) !== supervisorHash(rolloutPin))
      throw Error('Supervisor host held: rollout attestation changed during invocation');
    const host = readHostAdvisoryPolicy(p.config,[project.root,runtime.context.runtimeRoot]);
    if (host.policy.profile !== profile) throw Error('Supervisor host held: auth profile changed');
    if (hold && !released && !checkSupervisorHold(p.state,hold)) throw Error('Supervisor host held: exact exclusion changed');
    // Unique collection timestamp only names the private freeze; it never changes the material basis.
    const collectionOutput = join(output,randomUUID());
    mkdirSync(collectionOutput,{mode:0o700});
    const input = collectSupervisorInput({context:runtime.context,registry:p.projects,ticket:o.ticket,
      observedAt:new Date().toISOString(),output:collectionOutput,tracker:o.tracker,expectedOwnHold:released ? undefined : hold});
    if (input.snapshot.material.runId !== saved.executionId) throw Error('Supervisor host held: saved execution changed');
    const state = readSupervisor(p.state,project), policy = runtime.context.config.supervisor;
    const all = readSupervisorProjects(p.state);
    const own = state.reservations[supervisorHash(o.invocationId)];
    if (own && (!hold || own.id !== hold.invocationId || own.fence !== hold.fence || own.owner.pid !== hold.owner.pid || own.owner.start !== hold.owner.start))
      throw Error('Supervisor host held: foreign own reservation');
    // NEW-call preflight subtracts only this exact already-reserved active call, then adds it back. No refund/reset;
    // cumulative totals remain inclusive everywhere durable, and other active/ambiguous work still excludes it.
    const ownActive = own?.state === 'active';
    const used = (states: SupervisorState[], role?: 'diagnosis') => {
      const rs = states.flatMap(s => Object.values(s.reservations).filter(r => !(ownActive && s.project.root === project.root && r.id === own.id))).filter(r => !role || r.kind === role);
      return {tokens:rs.reduce((n,r)=>n+chargedResources(r).tokens,0),cost:rs.reduce((n,r)=>n+chargedResources(r).cost,0),calls:rs.length};
    };
    const mode = state.control?.mode ?? input.snapshot.mode;
    // Capacity/budget checks here are advisory preflight only; reserve-advisory MUST repeat them under journal lock.
    const reason = advisoryLimitHold({host:host.policy,project:policy,hostUsed:used(all),projectUsed:used([state]),roleUsed:used([state],'diagnosis'),
      active:all.flatMap(s=>Object.values(s.reservations)).filter(r=>r.state!=='finished').length - (ownActive ? 1 : 0),
      incidentCalls:Object.values(state.reservations).filter(r=>r.kind==='diagnosis' && state.incidents[r.incidentId]?.facts.runId===saved.executionId).length - (ownActive ? 1 : 0),
      ...controls,mode});
    runtime.assertCurrent(); runtime.context.assertCurrent({strictOriginals:true});
    if (hold && !released && !checkSupervisorHold(p.state,hold)) throw Error('Supervisor host held: exact exclusion changed during collection');
    if (rolloutPin && supervisorHash(readRollout()) !== supervisorHash(rolloutPin))
      throw Error('Supervisor host held: rollout attestation expired or changed during collection');
    return {input,controls,host,policy,mode,preflightHold:reason ?? null};
  };
  // Return no send permission, no auth value and no implicit cleanup on failure. The exact IDs remain inspectable.
  const initial = await current();
  registrationAt = new Date().toISOString();
  const authorization = async () => {
    const c = await current();
    return {snapshot:{...c.input.snapshot,mode:c.mode},facts:c.input.facts,family:runtime.context.config.AGENT.family,
      policy:c.policy,registered:c.controls.registered,globalAllowed:c.controls.global==='on',paused:c.controls.projectControl!=='enabled',
      outsideAdmissionLocks:true,shared:{tokens:c.host.policy.cumulative.tokens,cost:c.host.policy.cumulative.cost},capacity:c.host.policy.capacity,
      advisory:{policy:{holdId:hold?.id ?? 'unacquired',host:c.host.policy,project:c.policy,at:registrationAt!,...(rolloutPin ? {rollout:rolloutPin} : {})},controls:c.controls,
        runtime:runtime.identity.selected,dependencies:runtime.identity.dependencies,attemptId:saved.recovery?.id ?? null,preflightHold:c.preflightHold}};
  };
  return Object.freeze({project,get hold() { return hold ? structuredClone(hold) : undefined; },runtime,current,initial,
    /** Explicit invocation only. No credential discovery, scheduling, review or recovery. */
    invoke: async (apiKey: string, signal?: AbortSignal) => {
      registrationAt = new Date().toISOString();
      const result = await diagnoseProject({stateDir:p.state,current:authorization,boundary:runtime.boundary,
        invocationId:o.invocationId,fence,apiKey:o.auth === 'pi-login' ? undefined : apiKey,signal,beforeReserve:acquire,
        resolveCredential:o.auth === 'pi-login' ? (o.resolveLogin ?? resolvePiLogin) : undefined});
      if (hold && readSupervisor(p.state,project).advisory?.settlements?.[supervisorHash(o.invocationId)]) {
        try {
          await runtime.release();
          const closure = releaseSupervisorHold(p.state,hold);
          released = closure.released;
          return {...result,closure};
        } catch (e) { return {...result,closure:{released:false,reason:`Original terminal evidence held: ${String(e)}`}}; }
      }
      return result;
    }});
}

/** Explicit restart closure from ORIGINAL identities only. No acquisition, resend, grant repair or refund.
 * The runtime release verifies original usage/process/cleanup and fresh ESRCH before its exact CAS.
 * Admission closure follows outside that lock and cannot remove a foreign successor. */
export async function reconcileSupervisorHost(paths: Paths, hold: HoldKey, lease: import('./runtime-ownership.mts').AdvisoryRuntimeLease) {
  const inspection = inspectSupervisorHost(readSupervisor(paths.state,hold.project),hold);
  if (inspection.state !== 'settled') return {released:false,reason:inspection.nextAction};
  const b = lease.binding;
  if (b.stateDir !== paths.state || b.invocationId !== hold.invocationId || b.fence !== hold.fence
    || supervisorHash(b.project) !== supervisorHash(hold.project))
    return {released:false,reason:'Foreign original runtime binding; preserve ownership and investigate'};
  const { releaseAdvisoryRuntimeLease } = await import('./runtime-ownership.mts');
  try { await releaseAdvisoryRuntimeLease(paths,lease); }
  catch (e) { return {released:false,reason:`Original runtime/terminal evidence held: ${String(e)}`}; }
  return releaseSupervisorHold(paths.state,hold);
}

export type HostCutpoint = 'exclusion-only' | 'reserved' | 'registered' | 'authorized' | 'settled' | 'inconsistent';
export type HostInspection = { state: HostCutpoint; invocationId: string; holdId: string; nextAction: string; resend: false; charged: {tokens:number;cost:number} | null };
/** Read-only durable cutpoint projection. Absence never reconstructs a grant, asserts no-send or permits release.
 * Settlement is inspectable here, but actual release APIs still validate original receipts and fresh whole-group ESRCH. */
export function inspectSupervisorHost(state: SupervisorState, hold: HoldKey): HostInspection {
  const key = supervisorHash(hold.invocationId), r = state.reservations[key], p = state.advisory?.policies[key],
    g = state.advisory?.workers[key]?.grant, a = state.advisory?.sends[key], terminal = state.advisory?.settlements?.[key];
  let cut: HostCutpoint = 'exclusion-only';
  if (r) cut = 'reserved';
  if (g) cut = 'registered';
  if (a) cut = 'authorized';
  if (terminal) cut = 'settled';
  if (!hold.owner.start || supervisorHash(state.project) !== supervisorHash(hold.project) || p && !r
    || r && (r.fence !== hold.fence || r.id !== hold.invocationId || r.owner.pid !== hold.owner.pid || r.owner.start !== hold.owner.start || !p || p.holdId !== hold.id)
    || g && (!r || g.holdId !== hold.id || g.fence !== hold.fence || g.invocationId !== hold.invocationId
      || g.incidentId !== r.incidentId || supervisorHash(g.project) !== supervisorHash(hold.project))
    || a && (!g || a.grantId !== g.id || a.fence !== hold.fence)
    || terminal && (!a || !g || terminal.grantId !== g.id || terminal.holdId !== hold.id || terminal.fence !== hold.fence
      || terminal.authorization !== a.receipt || r?.state !== 'finished')) cut = 'inconsistent';
  const actions: Record<HostCutpoint,string> = {
    'exclusion-only':'Inspect exact acquisition/controller evidence. No reservation is not proof of no worker; retain exclusion. Do not reconstruct permission.',
    reserved:'Inspect reservation and process metadata. Retain full charge and exclusion; absent process metadata does not prove no-send.',
    registered:'Inspect registered worker, handoff and exact process receipts. Retain ownership even without visible authorization; never resend.',
    authorized:'One-use authorization consumed. Inspect raw terminal provider usage and whole-group cleanup; unknown remote acceptance stays fully charged and excluded.',
    settled:'Validate original immutable usage/process/cleanup receipts and fresh whole-group absence through exact release APIs; never refund or resend.',
    inconsistent:'Conflicting or foreign durable ownership. Preserve every record and obtain human investigation; do not repair, release or reconstruct grants.',
  };
  return {state:cut,invocationId:hold.invocationId,holdId:hold.id,nextAction:actions[cut],resend:false,charged:r?structuredClone(r.reserved):null};
}
