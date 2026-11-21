// Host-only baseline/candidate producer: exact grants, separate durable capacity, detached ownership,
// private exact inputs and authenticated receipts. Candidate admission composes only with its exact owned workflow.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { acceptanceHash, type AcceptanceContract } from './acceptance-contract.mts';
import { readAcceptanceBundle, type AcceptanceBundlePointer } from './acceptance-custody.mts';
import { checkAcceptanceReceipt, type AcceptanceReceipt } from './acceptance-receipt.mts';
import type { AdmissionIdentity, AdmissionState, BaselineReservation } from '../board/admission.mts';
const flat = existsSync(new URL('./admission.mts', import.meta.url));
const admission = await import(flat ? './admission.mts' : '../board/admission.mts');
const { readRuns, TERMINAL, PARKED } = await import(flat ? './board.mts' : '../board/board.mts');
const { validateRuntimeBundle } = await import(flat ? './runtime-bundle.mts' : '../cli/src/runtime-bundle.mts');
export interface BaselineRequest {
  stateDir: string; ownedRoot: string; custodyRoot: string; agentMounts: string[]; source: string;
  project: AdmissionIdentity; iid: string; pointer: AcceptanceBundlePointer; sha: string; runtimeRoot: string;
  /** Trusted local engine transport; never derive from tracker, project environment or probe argv. */
  engine: { command: string; args: string[] };
  image: string; setup: string[][];
  reset: { kind: 'project-local-synthetic-v1'; recipe: string };
  bounds: { totalMs: number; outputBytes: number; memoryMiB: number; cpus: number; pids: number; diskMiB: number };
  cap: number;
  candidate?: { key: string; executionId: string; claim: string; entry: string; custody: import('./payload-custody.mts').PayloadPointer; baseline: string; bindingDigest: string };
}
export interface ExecutionAuthorization { id: string; intentDigest: string; expiresAt: number;
  /** Independently reviewed host-retained non-transition evidence; NEVER obtained from sandbox strings. */
  evidence?: { criterionId: string; requirement: string; reference: string }[];
}
/** Host-authenticated execution authorization is independent of custody review AND readiness. */
export interface TrustedExecutionAuthorization { lookup(intent: Readonly<unknown>): unknown }
export interface BaselineHandle { executionId: string; ownerId: string; generation: string; token: string; directory: string; stateDir: string }
export const baselineHash = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
export function privateDirectory(p: string): void {
  if (!isAbsolute(p) || resolve(p) !== p || realpathSync(p) !== p) throw Error('Baseline private directory must be canonical');
  let cursor = p;
  for (;;) { const s = lstatSync(cursor); if (!s.isDirectory() || s.isSymbolicLink()) throw Error('Unsafe baseline ancestor'); if (cursor === dirname(cursor)) break; cursor = dirname(cursor); }
  const s = lstatSync(p); if (s.uid !== process.getuid?.() || (s.mode & 0o077)) throw Error('Baseline directory must be private host-owned');
}
export function immutableBaselineFile(path: string, text: string | Buffer): void {
  const fd = openSync(path, 'wx', 0o400); try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  admission.syncDirectory(dirname(path));
}
const overlap = (a: string, b: string) => { const r = relative(a,b); return !r || r !== '..' && !r.startsWith('../') && !isAbsolute(r); };
export function exactBaseline(r: BaselineReservation | undefined, h: BaselineHandle): boolean {
  return !!r && r.executionId === h.executionId && r.ownerId === h.ownerId && r.generation === h.generation && r.tokenDigest === baselineHash(h.token);
}
export function readBaselineSpec(h: BaselineHandle): any {
  privateDirectory(h.directory);
  const s = JSON.parse(readFileSync(join(h.directory,'spec.json'),'utf8'));
  if (acceptanceHash(s.handle) !== acceptanceHash(h)) throw Error('Foreign baseline handle');
  return s;
}
/** Candidate work may coexist ONLY with its own live normal claim/entry and closed implementer payload.
 * It still consumes a separate capacity slot; all foreign/uncertain work remains conflicting. */
export function assertCandidateOwner(r: BaselineRequest, state: AdmissionState): void {
  const c = r.candidate;
  if (!c) throw Error('Candidate workflow identity missing');
  const run = readRuns(r.stateDir,false).find(run=>run.key===c.key);
  const claim = state.claims[c.key], entry = state.entries[c.entry];
  const same = (a: unknown,b: unknown)=>acceptanceHash(a)===acceptanceHash(b);
  const custody = readPayloadCustody(r.stateDir,c.custody);
  const b = custody.binding;
  if (!run || run.executionId!==c.executionId || run.claim!==c.claim || run.payloadCustody?.nonce!==c.custody.nonce
    || run.implementationBaseSha!==c.baseline || run.acceptanceBaseline?.bindingDigest!==c.bindingDigest
    || !claim || claim.token!==c.claim || claim.kind!=='normal' || claim.project!==r.project.tracker.project || claim.iid!==r.iid
    || !entry || !same(entry.project,r.project) || !same(entry.owner,claim.owner) || admission.ownerState(claim.owner)!=='alive'
    || !b || b.executionId!==c.executionId || b.claim!==c.claim || b.entry!==c.entry || b.key!==c.key || b.ticket!==r.iid
    || b.baseline!==c.baseline || !same(b.project,r.project) || !same(b.owner,claim.owner)
    || custody.sealed || !custody.payloads.size || [...custody.payloads.values()].some(p=>!p.container||!p.absent)) throw Error('Candidate workflow ownership/cleanup changed');
}
const { readPayloadCustody } = await import('./payload-custody.mts');
export function reserveAcceptanceBaseline(input: BaselineRequest, authorization: TrustedExecutionAuthorization, now = Date.now()): BaselineHandle {
  const r = structuredClone(input);
  privateDirectory(r.ownedRoot);
  if (process.platform !== 'linux' || !process.getuid?.() || /[,\n\r:]/.test(r.ownedRoot)) throw Error('Baseline requires non-root Linux owner and unambiguous private mount path');
  for (const p of [r.stateDir,r.custodyRoot,r.source,r.runtimeRoot,...r.agentMounts]) {
    if (realpathSync(p) !== p || overlap(p,r.ownedRoot) || overlap(r.ownedRoot,p)) throw Error('Baseline owner overlaps exposed/source state');
  }
  if (!admission.validAdmissionIdentity(r.project) || r.project.root !== realpathSync(r.source) || !r.iid
    || !/^[a-f0-9]{40}$/.test(r.sha) || !/^[a-zA-Z0-9._/:-]+@sha256:[a-f0-9]{64}$/.test(r.image)
    || !isAbsolute(r.engine.command) || !Array.isArray(r.engine.args) || !r.engine.args.every(x=>typeof x==='string')
    || !Number.isSafeInteger(r.cap) || r.cap < 1 || !Number.isSafeInteger(now) || now < 0
    || r.reset?.kind !== 'project-local-synthetic-v1' || !r.reset.recipe?.trim()
    || !Array.isArray(r.setup) || r.setup.length > 32 || !r.setup.every(a=>Array.isArray(a)&&a.length>0&&a.length<=64&&a.every(x=>typeof x==='string'&&x.length<=4096)&&a[0])) throw Error('Unsupported baseline identity/reset/transport');
  const maxima = { totalMs:300000,outputBytes:2097152,memoryMiB:8192,cpus:8,pids:512,diskMiB:2048 };
  if (Object.keys(r.bounds).sort().join() !== Object.keys(maxima).sort().join() || Object.entries(maxima).some(([k,max])=>!Number.isSafeInteger(r.bounds[k as keyof typeof maxima])||r.bounds[k as keyof typeof maxima]<=0||r.bounds[k as keyof typeof maxima]>max)) throw Error('Unsupported baseline bounds');
  const bundle = readAcceptanceBundle(r.custodyRoot,r.agentMounts,r.pointer);
  if (r.bounds.diskMiB<64 || bundle.contract.probes.some(p=>r.bounds.memoryMiB>p.bounds.memoryMiB||r.bounds.cpus>p.bounds.cpus)) throw Error('Sandbox bounds exceed reviewed probe resources or cannot provide bounded state');
  const runtime = validateRuntimeBundle(r.runtimeRoot);
  for (const name of ['acceptance-runner.mts','acceptance-worker.mts','acceptance-sandbox.mjs','acceptance-receipt.mts']) {
    if (readFileSync(join(r.runtimeRoot,name),'utf8') !== readFileSync(new URL(`./${name}`,import.meta.url),'utf8')) throw Error('Selected runtime lacks current baseline producer');
  }
  const intent = { version:1, request:r, runtime:runtime.id, dependencies:runtime.dependencies, approval:bundle.manifest.approvalDigest, setup:acceptanceHash(r.setup), reset:acceptanceHash(r.reset) };
  const digest = acceptanceHash(intent), grant: any = authorization.lookup(Object.freeze(structuredClone(intent)));
  if (!grant || !['expiresAt,id,intentDigest','evidence,expiresAt,id,intentDigest'].includes(Object.keys(grant).sort().join()) || typeof grant.id!=='string' || !grant.id || grant.intentDigest!==digest || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt < now+r.bounds.totalMs) throw Error('Exact trusted execution authorization unavailable');
  if (grant.evidence !== undefined && (!Array.isArray(grant.evidence) || grant.evidence.length>256 || grant.evidence.some((e:any)=>!e||Object.keys(e).sort().join()!=='criterionId,reference,requirement'||['criterionId','reference','requirement'].some(k=>typeof e[k]!=='string'||!e[k]||e[k].length>4096)))) throw Error('Trusted evidence malformed');
  const handle: BaselineHandle = { executionId:randomUUID(),ownerId:randomUUID(),generation:randomUUID(),token:randomUUID(),directory:'',stateDir:r.stateDir };
  handle.directory = join(r.ownedRoot,handle.executionId);
  const reservation: BaselineReservation = { executionId:handle.executionId,ownerId:handle.ownerId,generation:handle.generation,tokenDigest:baselineHash(handle.token),project:r.project,iid:r.iid,engine:acceptanceHash(r.engine),name:`factory-baseline-${handle.executionId}`,intentDigest:digest,deadline:now+r.bounds.totalMs };
  admission.withAdmission(r.stateDir,tx=>{
    const baselines=admission.readBaselineReservations(r.stateDir);
    if (r.candidate) {
      assertCandidateOwner(r,tx.state);
      if (acceptanceHash(tx.state.claims[r.candidate.key].owner)!==acceptanceHash(admission.ownerOf(process.pid))) throw Error('Candidate reserver is not workflow owner');
    }
    if (admission.supervisorExclusion(tx.state,r.project.tracker.project,r.project.root) || Object.values(tx.state.entries).some(e=>admission.admissionConflict(e.project,r.project) && e.id!==r.candidate?.entry)) throw Error('Baseline project held by managed/supervisor work');
    const runs=readRuns(r.stateDir,false).filter(run=>![...TERMINAL,...PARKED].includes(run.stage));
    const claims=Object.entries(tx.state.claims).filter(([,c])=>admission.claimLive(c));
    if (baselines.some(b=>admission.admissionConflict(b.project,r.project)) || claims.some(([k,c])=>c.project===r.project.tracker.project && k!==r.candidate?.key) || runs.some(run=>run.project===r.project.tracker.project && run.key!==r.candidate?.key)) throw Error('Baseline project held by work/cleanup');
    if (new Set([...claims.map(([k])=>k),...runs.map(run=>run.key)]).size+baselines.length>=r.cap) throw Error('Baseline capacity held');
    // Reserve FIRST. Any crash or filesystem failure from here retains capacity; no rollback by PID/age.
    admission.writeBaselineReservations(r.stateDir,[...baselines,reservation]);
    mkdirSync(handle.directory,{mode:0o700}); admission.syncDirectory(r.ownedRoot);
    immutableBaselineFile(join(handle.directory,'producer.key'),randomUUID()+randomUUID());
    immutableBaselineFile(join(handle.directory,'spec.json'),JSON.stringify({handle,intent,grant,reservation,startedAt:now,approval:bundle.approval,contract:bundle.contract}));
  });
  return structuredClone(handle);
}
/** The worker owns creation through cleanup; it is detached from the initiating controller/session.
 * Failure to start remains a durable hold, never an automatic release/retry. */
export function startAcceptanceBaseline(h: BaselineHandle, waitForSettlement = false): { pid: number; finished: Promise<number | null> } {
  const s=readBaselineSpec(h);
  const fd=openSync(join(h.directory,'worker.started'),'wx',0o400); closeSync(fd); admission.syncDirectory(h.directory);
  const child=spawn(process.execPath,[join(s.intent.request.runtimeRoot,'acceptance-worker.mts'),h.directory],{detached:true,stdio:'ignore',env:{PATH:'/usr/bin:/bin',HOME:h.directory,LANG:'C.UTF-8'}});
  const finished=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if (!waitForSettlement) child.unref(); return {pid:child.pid!,finished};
}
/** Exact authenticated cancellation is durable. No foreign/stale token can cancel or settle a successor. */
export function cancelAcceptanceBaseline(h: BaselineHandle): boolean {
  return admission.withAdmission(h.stateDir,()=>{
    const r=admission.readBaselineReservations(h.stateDir).find(r=>r.executionId===h.executionId);
    if (!exactBaseline(r,h)) return false;
    readBaselineSpec(h);
    if (!existsSync(join(h.directory,'cancel.json'))) immutableBaselineFile(join(h.directory,'cancel.json'),JSON.stringify({ownerId:h.ownerId,generation:h.generation}));
    return true;
  });
}
/** Read only the producer seal retained outside all sandbox mounts. Arbitrary receipt JSON is not authority. */
export function readAcceptanceBaseline(h: BaselineHandle, now=Date.now(), phase: 'baseline' | 'candidate' = 'baseline'): { receipt: AcceptanceReceipt; policy: ReturnType<typeof checkAcceptanceReceipt> } {
  const s=readBaselineSpec(h);
  if ((s.intent.request.candidate ? 'candidate' : 'baseline') !== phase) throw Error('Acceptance producer purpose mismatch');
  const sealed=readFileSync(join(h.directory,'receipt.json'),'utf8'), seal=JSON.parse(sealed);
  const retained=JSON.parse(readFileSync(join(admission.admissionDir(h.stateDir),`baseline-${h.executionId}.sealed`),'utf8'));
  if (!exactBaseline(retained,h) || retained.directory!==h.directory || retained.receiptDigest!==baselineHash(sealed) || retained.specDigest!==baselineHash(readFileSync(join(h.directory,'spec.json')))) throw Error('Unauthenticated baseline producer publication');
  const key=readFileSync(join(h.directory,'producer.key'));
  const expected=createHmac('sha256',key).update(JSON.stringify({receipt:seal.receipt,provenance:seal.provenance})).digest('hex');
  if (typeof seal.mac!=='string'||seal.mac.length!==64||!timingSafeEqual(Buffer.from(seal.mac),Buffer.from(expected))) throw Error('Unauthenticated baseline receipt');
  if (seal.provenance?.outputDigest && baselineHash(readFileSync(join(h.directory,'sandbox-output.json')))!==seal.provenance.outputDigest) throw Error('Retained sandbox output changed');
  if (seal.provenance?.intentDigest!==s.reservation.intentDigest || seal.provenance?.generation!==h.generation || seal.provenance?.authorizationId!==s.grant.id) throw Error('Foreign producer provenance');
  if (admission.readBaselineReservations(h.stateDir).some(r=>r.executionId===h.executionId)) throw Error('Baseline cleanup still held');
  const binding={executionId:h.executionId,bundleId:s.intent.request.pointer.id,approvalId:s.approval.id,approvalDigest:s.intent.approval,sha:s.intent.request.sha,runtime:s.intent.runtime,dependencies:s.intent.dependencies,image:s.intent.request.image,config:acceptanceHash(s.intent.request.bounds),setup:s.intent.setup,reset:s.intent.reset,ownerId:h.ownerId};
  return {receipt:seal.receipt,policy:checkAcceptanceReceipt(s.contract as AcceptanceContract,{lookup:()=>s.approval},seal.receipt,binding,now,phase)};
}
