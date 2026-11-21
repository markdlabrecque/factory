// Trusted host preparation explicitly executes separately reserved baselines. Active admission authenticates
// retained producer evidence against current originals. Normal verification requires separately authorized owned
// exact-candidate replay; passive views consume checks only. Recovery candidate composition remains separate.
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acceptanceHash } from './acceptance-contract.mts';
import { readAcceptanceBundle } from './acceptance-custody.mts';
import { readPreparedAcceptance } from './acceptance-admission.mts';
import { frozenTicketIdentity, freezeTicketInput } from './ticket-input.mts';
import { reserveAcceptanceBaseline, startAcceptanceBaseline, cancelAcceptanceBaseline, readAcceptanceBaseline, readBaselineSpec, immutableBaselineFile, privateDirectory, type BaselineRequest, type BaselineHandle } from './acceptance-runner.mts';
import type { ReadinessCheck } from './readiness-schema.mts';

export type BaselineHoldReason = 'preparation-required' | 'changed-input' | 'authorization-unavailable' | 'cancelled' | 'cleanup-pending' | 'review-required' | 'behavior-mismatch' | 'infrastructure';
export class AcceptanceBaselineHold extends Error {
  readonly reason: BaselineHoldReason;
  baseline?: {sha:string;bindingDigest:string};
  constructor(reason: BaselineHoldReason) {
    super(`Acceptance baseline hold: ${reason}. Trusted host preparer must inspect retained execution and current inputs; preserve work and charges, with no automatic retry or reclassification.`);
    this.reason = reason;
  }
}
/** Private host protocol, never a tracker/config/readiness grant. All inputs are bounded descriptor reads. */
function privateRecord(root: string, name: string): any {
  privateDirectory(root);
  const path = join(root, name), before = lstatSync(path);
  if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || before.mode & 0o077 || before.size > 65536) throw Error('Unsafe host baseline record');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd), bytes = Buffer.alloc(65537), n = readSync(fd, bytes, 0, bytes.length, 0), after = fstatSync(fd), named = lstatSync(path);
    if (st.dev !== before.dev || st.ino !== before.ino || !st.isFile() || st.nlink !== 1 || st.size !== n || n > 65536 || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs || named.dev !== st.dev || named.ino !== st.ino) throw Error('Changed host baseline record');
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes.subarray(0,n)));
  } finally { closeSync(fd); }
}
const same = (a: unknown, b: unknown) => acceptanceHash(a) === acceptanceHash(b);
/** Host installs this plan and an exact execution-authorization-<intentDigest>.json independently.
 * The plan's policy/config pins supplement (not replace) the runner's bounds-only config digest. */
export interface BaselinePreparationPlan { version: 1; request: BaselineRequest; policyIdentity: string; configDigest: string }
export interface BaselineAdmissionIdentity { version: 1; bindingDigest: string; sha: string }
export interface OriginalBaseline { sha: string; admission: BaselineAdmissionIdentity }
async function current(iid: number, base: string, originalSha?: string) {
  const {context, effectiveConfig, TRACKER} = await import('./runtime-config.mts');
  const tracker = await import('./tracker.mts');
  context.assertCurrent();
  const state = context.sharedState, root = join(state, 'acceptance');
  const input = freezeTicketInput(tracker.contextSource, iid);
  const bundle = readPreparedAcceptance(state, [context.projectRoot, context.runtimeRoot], input);
  let plan: BaselinePreparationPlan;
  try { plan = privateRecord(root, `baseline-plan-${input.hash}.json`); }
  catch { throw new AcceptanceBaselineHold('preparation-required'); }
  if (originalSha !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(originalSha)) throw new AcceptanceBaselineHold('changed-input');
  const revision = originalSha ?? `origin/${base}`;
  const sha = execFileSync('git', ['--no-replace-objects','rev-parse','--verify',`${revision}^{commit}`], {cwd:context.projectRoot,encoding:'utf8',timeout:10000}).trim();
  if (originalSha !== undefined && sha !== originalSha) throw new AcceptanceBaselineHold('changed-input');
  const configDigest = acceptanceHash(readFileSync(context.projectPath('.factory/factory.toml'),'utf8'));
  if (!plan || typeof plan !== 'object') throw new AcceptanceBaselineHold('preparation-required');
  const r = plan.request;
  const project = {root:context.projectRoot,tracker:{kind:TRACKER.kind,host:TRACKER.gitlabHost ?? TRACKER.host!,project:TRACKER.project}};
  if (!plan || Object.keys(plan).sort().join() !== 'configDigest,policyIdentity,request,version' || plan.version !== 1
    || plan.policyIdentity !== context.policyIdentity || plan.configDigest !== configDigest || !r
    || r.stateDir !== state || r.custodyRoot !== root || r.source !== context.projectRoot || r.runtimeRoot !== context.runtimeRoot
    || r.iid !== String(iid) || !same(r.project,project) || !same(r.pointer,bundle.pointer) || r.sha !== sha
    || r.cap !== effectiveConfig.dispatch.maxConcurrent
    || !r.agentMounts.includes(context.projectRoot) || !r.agentMounts.includes(context.runtimeRoot)) throw new AcceptanceBaselineHold('changed-input');
  // Image inspection is read-only. A mutable tag or a trusted plan alone cannot establish the current image.
  let image: any;
  try { image = JSON.parse(execFileSync('docker',['image','inspect',effectiveConfig.config.image],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore']})); }
  catch { throw new AcceptanceBaselineHold('infrastructure'); }
  if (!Array.isArray(image) || image.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(image[0]?.Id) || !r.image.endsWith(`@${image[0].Id}`)) throw new AcceptanceBaselineHold('changed-input');
  const binding = {ticket:frozenTicketIdentity(bundle.ticket),bundle:bundle.pointer,approvalDigest:bundle.manifest.approvalDigest,sha,
    runtime:context.manifest.id,dependencies:context.manifest.dependencies,policyIdentity:context.policyIdentity,configDigest,planDigest:acceptanceHash(plan)};
  context.assertCurrent();
  // Tracker/image/Git are external I/O boundaries. Recollect static originals and host plan
  // after those reads, rather than letting the last image inspection revoke an earlier snapshot.
  try {
    const finalInput = freezeTicketInput(tracker.contextSource,iid);
    const finalBundle = readPreparedAcceptance(state,[context.projectRoot,context.runtimeRoot],finalInput);
    const finalSha = execFileSync('git',['--no-replace-objects','rev-parse','--verify',`${revision}^{commit}`],{cwd:context.projectRoot,encoding:'utf8',timeout:10000}).trim();
    if (!same(frozenTicketIdentity(finalBundle.ticket),binding.ticket) || !same(finalBundle.pointer,binding.bundle)
      || finalBundle.manifest.approvalDigest !== binding.approvalDigest || finalSha !== sha
      || !same(plan,privateRecord(root,`baseline-plan-${input.hash}.json`))) throw Error('Revoked current preparation');
    context.assertCurrent();
  } catch { throw new AcceptanceBaselineHold('changed-input'); }
  return {root,input:bundle.ticket,request:r,binding};
}

/** Explicit trusted-host local ingress, NOT called by dispatch, direct launch or any passive reader.
 * Host must provision the exact independent execution grant before this call. No default/autogrant exists.
 * A pending reference is durable before start; failure/cancel retains the exact handle for inspection. */
export async function prepareAcceptanceBaselineForTicket(iid: number, base: string, signal?: AbortSignal): Promise<BaselineHandle> {
  const before = await current(iid,base);
  if (signal?.aborted) throw new AcceptanceBaselineHold('cancelled');
  const h = reserveAcceptanceBaseline(before.request, {lookup: intent => {
    try { return privateRecord(before.root, `execution-authorization-${acceptanceHash(intent)}.json`); } catch { return undefined; }
  }});
  immutableBaselineFile(join(before.root,`baseline-current-${before.input.hash}.json`),JSON.stringify({version:1,handle:h,binding:before.binding}));
  const cancel = () => { cancelAcceptanceBaseline(h); };
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    const reserved = await current(iid,base);
    if (!same(before.binding,reserved.binding)) { cancel(); throw new AcceptanceBaselineHold('changed-input'); }
    if (signal?.aborted) { cancel(); throw new AcceptanceBaselineHold('cancelled'); }
    await startAcceptanceBaseline(h).finished;
    await requireAcceptanceBaselineForTicket(iid,base);
    return h;
  } catch (error) {
    cancel();
    throw error;
  } finally { signal?.removeEventListener('abort',cancel); }
}

/** Active read: the runner authenticates historical request binding; this consumer additionally
 * resolves CURRENT ticket/full bundle/approval/SHA/runtime/dependencies/full config and host reset plan. */
export async function requireAcceptanceBaselineForTicket(iid: number, base: string, original?: OriginalBaseline): Promise<BaselineAdmissionIdentity> {
  if (original && (original.admission?.version !== 1 || !/^[a-f0-9]{64}$/.test(original.admission.bindingDigest))) throw new AcceptanceBaselineHold('preparation-required');
  const before = await current(iid,base,original?.sha);
  const identity: BaselineAdmissionIdentity = {version:1,bindingDigest:acceptanceHash(before.binding),sha:before.binding.sha};
  try {
  if (original && !same(original.admission,identity)) throw new AcceptanceBaselineHold('changed-input');
  let reference: any;
  try { reference = privateRecord(before.root,`baseline-current-${before.input.hash}.json`); }
  catch { throw new AcceptanceBaselineHold('preparation-required'); }
  if (!reference || Object.keys(reference).sort().join() !== 'binding,handle,version' || reference.version !== 1 || !same(reference.binding,before.binding)) throw new AcceptanceBaselineHold('changed-input');
  const h = reference.handle as BaselineHandle;
  let spec: any;
  try {
    if (!h || h.stateDir !== before.request.stateDir || h.directory !== join(before.request.ownedRoot,h.executionId)) throw Error('Foreign handle');
    spec = readBaselineSpec(h);
    if (!same(spec.intent.request,before.request)) throw Error('Historical request changed');
  } catch { throw new AcceptanceBaselineHold('changed-input'); }
  if (existsSync(join(h.directory,'cancel.json'))) throw new AcceptanceBaselineHold('cancelled');
  let grant: any;
  try { grant = privateRecord(before.root,`execution-authorization-${acceptanceHash(spec.intent)}.json`); }
  catch { throw new AcceptanceBaselineHold('authorization-unavailable'); }
  if (!same(grant,spec.grant) || grant.expiresAt < Date.now()) throw new AcceptanceBaselineHold('authorization-unavailable');
  let observed: ReturnType<typeof readAcceptanceBaseline>;
  try { observed = readAcceptanceBaseline(h); }
  catch { throw new AcceptanceBaselineHold('cleanup-pending'); }
  if (observed.policy.status !== 'valid') {
    const code = observed.policy.code;
    throw new AcceptanceBaselineHold(code === 'already-green' ? 'review-required' : code === 'behavior-mismatch' ? 'behavior-mismatch' : 'infrastructure');
  }
  const after = await current(iid,base,original?.sha);
  if (!same(before.binding,after.binding) || !same(reference,privateRecord(before.root,`baseline-current-${before.input.hash}.json`))) throw new AcceptanceBaselineHold('changed-input');
  try {
    if (!same(grant,privateRecord(before.root,`execution-authorization-${acceptanceHash(spec.intent)}.json`)) || grant.expiresAt < Date.now()) throw Error('Revoked grant');
  } catch { throw new AcceptanceBaselineHold('authorization-unavailable'); }
  if (existsSync(join(h.directory,'cancel.json'))) throw new AcceptanceBaselineHold('cancelled');
  return identity;
  } catch(error) {
    if(error instanceof AcceptanceBaselineHold)error.baseline={sha:identity.sha,bindingDigest:identity.bindingDigest};
    throw error;
  }
}

// Selected-runtime host ingress is an active authentication read, never a preparation/grant writer.
// The host supplies only original saved-run identities; actual authority remains the private producer records.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode,iid,base,sha,bindingDigest] = process.argv.slice(2);
  if(mode !== '--require-recovery' || !/^[1-9]\d*$/.test(iid ?? '') || !base) throw new AcceptanceBaselineHold('preparation-required');
  const result=await requireAcceptanceBaselineForTicket(Number(iid),base,{sha,admission:{version:1,bindingDigest,sha}});
  process.stdout.write(JSON.stringify(result));
}

export interface CandidateReplay {
  version: 1; baseline: BaselineHandle; candidate: BaselineHandle;
  binding: Record<string, any>;
}
/** Build an inert exact intent for independent host authorization. This does not approve, reserve or execute. */
export async function candidateRequestForTicket(iid: number, base: string, original: OriginalBaseline, tip: string, workflow: NonNullable<BaselineRequest['candidate']>) {
  await requireAcceptanceBaselineForTicket(iid,base,original);
  const before=await current(iid,base,original.sha);
  if (!/^[a-f0-9]{40}$/.test(tip) || tip===original.sha || workflow.baseline!==original.sha || workflow.bindingDigest!==original.admission.bindingDigest) throw Error('Acceptance candidate hold: exact candidate/original mismatch');
  return {...before.request,sha:tip,candidate:structuredClone(workflow)};
}
/** Authenticate BOTH independently produced executions, retained grant, raw output and original custody.
 * No arbitrary receipt/report JSON or candidate-owned path can replace a producer publication. */
export function authenticateCandidateReplay(replay: CandidateReplay, expected: {baseline:string;tip:string;executionId:string;ticket:string}, now=Date.now()) {
  if (!replay || replay.version!==1 || replay.baseline.executionId===replay.candidate.executionId || replay.baseline.ownerId===replay.candidate.ownerId) throw Error('Acceptance candidate hold: independent execution missing');
  const b=readBaselineSpec(replay.baseline), c=readBaselineSpec(replay.candidate), r=c.intent.request as BaselineRequest;
  const w=r.candidate;
  const baselineRequest=structuredClone(r); delete baselineRequest.candidate; baselineRequest.sha=expected.baseline;
  if (!w || w.executionId!==expected.executionId || r.iid!==expected.ticket || r.sha!==expected.tip || w.baseline!==expected.baseline
    || b.intent.request.sha!==expected.baseline || !same(b.intent.request,baselineRequest)
    || !same(replay.binding.bundle,r.pointer) || replay.binding.sha!==expected.baseline || acceptanceHash(replay.binding)!==w.bindingDigest
    || replay.binding.runtime!==c.intent.runtime || replay.binding.dependencies!==c.intent.dependencies
    || b.intent.approval!==c.intent.approval) throw Error('Acceptance candidate hold: chain identity mismatch');
  for (const [h,s,phase] of [[replay.baseline,b,'baseline'],[replay.candidate,c,'candidate']] as const) {
    if (h.directory!==join(s.intent.request.ownedRoot,h.executionId) || h.stateDir!==r.stateDir || existsSync(join(h.directory,'cancel.json'))
      || !same(privateRecord(r.custodyRoot,`execution-authorization-${acceptanceHash(s.intent)}.json`),s.grant) || s.grant.expiresAt<now) throw Error('Acceptance candidate hold: authorization revoked/expired');
    const observed=readAcceptanceBaseline(h,now,phase);
    if(observed.policy.status!=='valid') throw Error(`Acceptance candidate hold: ${phase} ${observed.policy.code}`);
  }
  // Rehash the originals, not just the previously sealed receipt's declared bundle ID.
  const bundle=readAcceptanceBundle(r.custodyRoot,r.agentMounts,r.pointer);
  if(bundle.manifest.approvalDigest!==c.intent.approval) throw Error('Acceptance candidate hold: original approval changed');
  return replay;
}
/** Normal workflow ingress: no automatic grant, retry, inherited sandbox or second lifecycle. */
export async function replayAcceptanceCandidateForTicket(iid:number,base:string,original:OriginalBaseline,tip:string,workflow:NonNullable<BaselineRequest['candidate']>,signal?:AbortSignal):Promise<CandidateReplay> {
  try {
    const request=await candidateRequestForTicket(iid,base,original,tip,workflow);
    if(signal?.aborted) throw Error('cancelled');
    const before=await current(iid,base,original.sha);
    const reference=privateRecord(before.root,`baseline-current-${before.input.hash}.json`);
    const handle=reserveAcceptanceBaseline(request,{lookup:intent=>{
      try{return privateRecord(before.root,`execution-authorization-${acceptanceHash(intent)}.json`);}catch{return undefined;}
    }});
    // Preserve the exact pending handle before the detached worker can create anything.
    immutableBaselineFile(join(before.root,`candidate-${handle.executionId}.json`),JSON.stringify({version:1,handle,binding:before.binding}));
    const cancel=()=>{cancelAcceptanceBaseline(handle);};
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      if(signal?.aborted){cancel();throw Error('cancelled');}
      await startAcceptanceBaseline(handle,true).finished;
      await requireAcceptanceBaselineForTicket(iid,base,original);
      const replay={version:1 as const,baseline:reference.handle,candidate:handle,binding:before.binding};
      return authenticateCandidateReplay(replay,{baseline:original.sha,tip,executionId:workflow.executionId,ticket:String(iid)});
    } catch(error){cancel();throw error;} finally{signal?.removeEventListener('abort',cancel);}
  } catch(error){throw Error(`Acceptance candidate hold: ${(error as Error).message}`);}
}

export function acceptanceBaselineCheck(iid: number, hold?: AcceptanceBaselineHold, observedAt = new Date().toISOString(), baseline?: {sha:string;bindingDigest:string}): ReadinessCheck {
  const identity=hold?.baseline ?? baseline;
  return {baseline:{sha:identity?.sha ?? null,bindingDigest:identity?.bindingDigest ?? null},id:`acceptance-baseline-${iid}`,ticket:String(iid),scope:'ticket-input',phase:'active',observedAt,status:hold?'blocked':'ready',required:true,
    operation:'validate-current-acceptance-baseline',path:'host-private acceptance baseline',reason:hold?`Acceptance baseline: ${hold.reason}`:'Authenticated owned baseline matches current complete input and host execution authorization',
    nextActor:hold?'operator':'none',nextAction:hold?'Trusted host preparer/reviewer: inspect exact retained baseline, current plan and authorization; prepare explicitly if missing. Preserve work, budgets and cleanup ownership; never retry or reclassify automatically.':'Observation only; revalidate current evidence before claim and adoption',automaticRecheck:'next-launch'};
}
