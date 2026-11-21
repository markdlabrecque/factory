// Trusted host preparation explicitly executes separately reserved baselines. Active admission authenticates
// retained producer evidence against independently recollected current inputs; passive views consume checks only.
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { acceptanceHash } from './acceptance-contract.mts';
import { readPreparedAcceptance } from './acceptance-admission.mts';
import { frozenTicketIdentity, freezeTicketInput } from './ticket-input.mts';
import { reserveAcceptanceBaseline, startAcceptanceBaseline, cancelAcceptanceBaseline, readAcceptanceBaseline, readBaselineSpec, immutableBaselineFile, privateDirectory, type BaselineRequest, type BaselineHandle } from './acceptance-runner.mts';
import type { ReadinessCheck } from './readiness-schema.mts';

export type BaselineHoldReason = 'preparation-required' | 'changed-input' | 'authorization-unavailable' | 'cancelled' | 'cleanup-pending' | 'review-required' | 'behavior-mismatch' | 'infrastructure';
export class AcceptanceBaselineHold extends Error {
  readonly reason: BaselineHoldReason;
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
async function current(iid: number, base: string) {
  const {context, effectiveConfig, TRACKER} = await import('./runtime-config.mts');
  const tracker = await import('./tracker.mts');
  context.assertCurrent();
  const state = context.sharedState, root = join(state, 'acceptance');
  const input = freezeTicketInput(tracker.contextSource, iid);
  const bundle = readPreparedAcceptance(state, [context.projectRoot, context.runtimeRoot], input);
  let plan: BaselinePreparationPlan;
  try { plan = privateRecord(root, `baseline-plan-${input.hash}.json`); }
  catch { throw new AcceptanceBaselineHold('preparation-required'); }
  const sha = execFileSync('git', ['--no-replace-objects','rev-parse','--verify',`origin/${base}^{commit}`], {cwd:context.projectRoot,encoding:'utf8',timeout:10000}).trim();
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
export async function requireAcceptanceBaselineForTicket(iid: number, base: string): Promise<void> {
  const before = await current(iid,base);
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
  const after = await current(iid,base);
  if (!same(before.binding,after.binding) || !same(reference,privateRecord(before.root,`baseline-current-${before.input.hash}.json`))) throw new AcceptanceBaselineHold('changed-input');
  try {
    if (!same(grant,privateRecord(before.root,`execution-authorization-${acceptanceHash(spec.intent)}.json`)) || grant.expiresAt < Date.now()) throw Error('Revoked grant');
  } catch { throw new AcceptanceBaselineHold('authorization-unavailable'); }
  if (existsSync(join(h.directory,'cancel.json'))) throw new AcceptanceBaselineHold('cancelled');
}

export function acceptanceBaselineCheck(iid: number, hold?: AcceptanceBaselineHold, observedAt = new Date().toISOString()): ReadinessCheck {
  return {id:`acceptance-baseline-${iid}`,ticket:String(iid),scope:'ticket-input',phase:'active',observedAt,status:hold?'blocked':'ready',required:true,
    operation:'validate-current-acceptance-baseline',path:'host-private acceptance baseline',reason:hold?`Acceptance baseline: ${hold.reason}`:'Authenticated owned baseline matches current complete input and host execution authorization',
    nextActor:hold?'operator':'none',nextAction:hold?'Trusted host preparer/reviewer: inspect exact retained baseline, current plan and authorization; prepare explicitly if missing. Preserve work, budgets and cleanup ownership; never retry or reclassify automatically.':'Observation only; revalidate current evidence before claim and adoption',automaticRecheck:'next-launch'};
}
