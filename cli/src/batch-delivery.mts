// Admitted host composition. Only a re-read of current host evidence can start an exact advance;
// interrupted publication and tracker completion are observed by receipt, never retried by guessing.
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual as same } from 'node:util';
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { durableDirectory, keyFor, ownerState, readAdmission, withAdmissionLock, writeDurable } from '../../board/admission.mts';
import { readBoundedText } from '../../orchestrator/ownership.mts';
import { commandContextSource } from '../../orchestrator/ticket-context-source.mts';
import { freezeTicketInput } from '../../orchestrator/ticket-input.mts';
import { BATCH_EVIDENCE_VERSION, latestBatchAttempt, runStandardBatchMember, standardChecks, type AttemptBinding, type BatchEvidence } from '../../orchestrator/batch-review.mts';
import { advanceBatch, confirmedBatchAdvance, batchMemberLocation, observedBatchAdvance, readOwnedBatch } from './batch.mts';
import { resolveMembers } from './batch-tracker.mts';
import { batchCompletion } from './batch-completion.mts';
import type { Paths } from './paths.mts';

type HostPaths=Pick<Paths,'projects'|'state'>;
type Member={project:string;batch:string;ticket:number};
type DeliveryKey=Member & {run:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha=/^[a-f0-9]{40}$/;
export function requireDeliveryEvidence(expected:AttemptBinding, latest:ReturnType<typeof latestBatchAttempt>) {
  const e=latest?.evidence;
  if (!e || !same(latest.binding,expected) || !same(e.binding,expected) || e.version!==BATCH_EVIDENCE_VERSION || e.status!=='approved' || !uuid.test(expected.attempt) || !sha.test(expected.candidate) || expected.candidate===expected.expectedHead ||
      !same(e.tests?.binding,expected) || e.tests.exit!==0 || !same(e.tests.argv,expected.gate.argv) || !Array.isArray(e.reviews) || e.reviews.length!==2 ||
      !(['test','code'] as const).every(role=>e.reviews.some(r=>r.role===role && !r.contextHold && r.verdict==='approve' && typeof r.reason==='string' && r.reason.trim() && typeof r.invocation==='string' && uuid.test(r.invocation) && (!r.followup || r.role==='test' && r.followup.invocation===r.invocation) && same(r.binding,expected))) || e.reviews[0].invocation===e.reviews[1].invocation)
    throw Error('Missing current exact test pass and independent role approvals');
}
export type BatchDeliveryOutcome={version:1;key:DeliveryKey;binding:AttemptBinding;completion:{child:boolean;done:string;ready:string[]}|null;gate:'approved'|'stopped';git:'not-started'|'attempted'|'refused'|'unknown'|'landed';tracker:'not-started'|'attempted'|'incomplete'|'complete';reason:string};
function local(p:HostPaths,key:Member) {
  const m=batchMemberLocation(p,key.project,key.batch,key.ticket),dir=join(m.dir,`member-${key.ticket}`);
  const stat=lstatSync(dir,{throwIfNoEntry:false});
  if(stat && (realpathSync(dir)!==dir || !stat.isDirectory() || stat.uid!==process.getuid?.() || (stat.mode & 0o077))) throw Error('Unsafe host member directory');
  return {...m,dir,state:m.dir,file:join(dir,'delivery.json')};
}
function readPublication(m:ReturnType<typeof local>,key:Member):BatchDeliveryOutcome|null {
  if(!lstatSync(m.file,{throwIfNoEntry:false}))return null;
  const stat=lstatSync(m.file);
  if(!stat.isFile() || stat.nlink!==1 || stat.uid!==process.getuid?.() || (stat.mode&0o077))throw Error('Unsafe host delivery record');
  const r=JSON.parse(readBoundedText(m.file,1<<20,'batch delivery outcome'));
  if(r?.version!==1 || r.key?.project!==key.project || r.key.batch!==key.batch || r.key.ticket!==key.ticket || r.binding?.ticket!==key.ticket || r.binding.batch!==key.batch || r.binding.run!==r.key.run || r.binding.destination!==m.identity.destinationRef || !uuid.test(r.binding.attempt) || !sha.test(r.binding.candidate) || !sha.test(r.binding.expectedHead) || r.gate!=='approved' || !['not-started','attempted','refused','unknown','landed'].includes(r.git) || !['not-started','attempted','incomplete','complete'].includes(r.tracker) || r.tracker!=='not-started' && r.git!=='landed')throw Error('Invalid host delivery record');
  if(r.git!=='not-started' && (typeof r.completion?.child!=='boolean' || typeof r.completion.done!=='string' || !Array.isArray(r.completion.ready) || !r.completion.ready.every((l:unknown)=>typeof l==='string')))throw Error('Missing original tracker completion plan');
  return r;
}
// SQLite is the durable gate journal. A terminal rebuild supersedes earlier PRE-publication approval,
// even when the producer died immediately after committing its result. Never overwrite an actual effect.
function load(m:ReturnType<typeof local>,key:Member):BatchDeliveryOutcome|null {
  const record=readPublication(m,key);
  if(record && record.git!=='not-started')return record;
  const t=m.config.TRACKER;
  const latest=lstatSync(join(m.state,'batch-review.sqlite'),{throwIfNoEntry:false}) && latestBatchAttempt(m.state,`${t.kind}://${t.host??t.gitlabHost}/${t.project}`,key.batch,key.ticket);
  if(latest?.evidence && !same(latest.evidence.binding,latest.binding))throw Error('Latest batch gate binding is inconsistent');
  if(latest?.evidence?.status==='stopped')return {version:1,key:{...key,run:latest.binding.run},binding:latest.binding,completion:null,gate:'stopped',git:'not-started',tracker:'not-started',reason:latest.evidence.reason};
  return record;
}
/** Passive historical outcome for dispatch/handoff. Only landed + complete is clean delivery. */
export function readBatchDelivery(p:HostPaths,key:Member){return load(local(p,key),key)}
/** A journal observation alone carries no publication authority. */
export function readBatchGate(p:HostPaths,key:Member) {
  const m=local(p,key),t=m.config.TRACKER;
  return lstatSync(join(m.state,'batch-review.sqlite'),{throwIfNoEntry:false}) ? latestBatchAttempt(m.state,`${t.kind}://${t.host??t.gitlabHost}/${t.project}`,key.batch,key.ticket):null;
}
type Scope={id:string;repositoryId:string;destinationRef:string;expectedHead:string;members:number[]};
/** Passive dispatch observer. Reconfirm the current owned tip AND inclusion of the observed landed commit. */
export function batchDeliveryObserver(p:HostPaths,project:string) {
  return (scope:Scope,ticket:number)=>{
    try {
      const key={project,batch:scope.id,ticket}, m=local(p,key), r=load(m,key), current=readOwnedBatch(p,project,scope.id);
      if(!scope.members.includes(ticket) || scope.repositoryId!==current.repositoryId || scope.destinationRef!==current.destinationRef || scope.expectedHead!==current.expectedHead)throw Error('Stale delivery scope');
      if(!r){
        const t=m.config.TRACKER, attempt=lstatSync(join(m.state,'batch-review.sqlite'),{throwIfNoEntry:false}) && latestBatchAttempt(m.state,`${t.kind}://${t.host??t.gitlabHost}/${t.project}`,scope.id,ticket);
        if(!attempt)return {state:'unstarted' as const,reason:'No recorded member gate or delivery'};
        return {state:attempt.evidence?.status==='stopped'?'stopped' as const:'waiting' as const,reason:attempt.evidence?.reason??'Unresolved host gate attempt'};
      }
      if(r.gate==='stopped')return {state:'stopped' as const,reason:r.reason};
      if(r.git!=='landed' || r.tracker!=='complete')return {state:'waiting' as const,reason:r.reason};
      execFileSync('git',['--no-replace-objects','-C',current.root,'merge-base','--is-ancestor',r.binding.candidate,current.expectedHead],{timeout:10000,stdio:'ignore'});
      return {state:'landed' as const,batch:current.id,repositoryId:current.repositoryId,destination:current.destinationRef,observedHead:current.expectedHead,iid:ticket,commit:r.binding.candidate};
    }catch{return {state:'unknown' as const,reason:'Current ownership, member outcome or landed commit inclusion is unknown'}}
  };
}
// Selectors identify a run; only its still-live host claim and recorded original authorize new effects.
function requireMemberClaim(p:HostPaths,key:DeliveryKey,m:ReturnType<typeof local>,requirements:string) {
  const project=m.config.TRACKER.project,iid=String(key.ticket),recordKey=keyFor(iid,project);
  const claim=readAdmission(p.state).claims[recordKey];
  const row=JSON.parse(readBoundedText(join(p.state,recordKey+'.json'),1<<20,'admitted batch member'));
  if(claim?.token!==key.run || claim.kind!=='normal' || claim.project!==project || claim.iid!==iid || ownerState(claim.owner)!=='alive' || row.claim!==key.run || row.executionId!==key.run || row.pid!==claim.owner.pid || row.project!==project || row.iid!==iid || row.batchMember?.id!==key.batch || row.batchMember.repositoryId!==m.identity.repositoryId || row.ticketHash!==requirements)throw Error('Original batch member claim or requirements no longer current');
}
function inputs(m:ReturnType<typeof local>,ticket:number) {
  const t=m.config.TRACKER, source=commandContextSource({kind:t.kind,host:t.host??t.gitlabHost!,project:t.project},t.projectId,process.env,m.identity.repositoryId);
  const image=execFileSync('docker',['image','inspect','--format','{{.Id}}',m.config.config.image],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim();
  // Sample effective requirements after external image inspection, not before it.
  const frozen=freezeTicketInput(source,ticket);
  return {ticket:frozen,image,gate:standardChecks({ticket:frozen},m.config,image),project:`${t.kind}://${source.identity.host}/${t.project}`};
}
function deliver(p:HostPaths,key:DeliveryKey, candidate?:AttemptBinding):BatchDeliveryOutcome|'rebuild' {
  const {project,batch,ticket}=key,m=local(p,key);
  return withAdmissionLock(m.dir,()=>{
    let r=load(m,key);
    function save(record:BatchDeliveryOutcome){writeDurable(m.file,JSON.stringify(record)+'\n');return record}
    const owned=()=>readOwnedBatch(p,project,batch);
    function validate(b:AttemptBinding,landed=false) {
      const current=local(p,key), head=owned().expectedHead;
      if(!landed){
        resolveMembers(current.config,[ticket],current.identity.repositoryId);
        const parents=execFileSync('git',['--no-replace-objects','-C',current.root,'rev-list','--parents','-n1',b.candidate,'--'],{encoding:'utf8',timeout:10000}).trim();
        if(parents!==`${b.candidate} ${b.expectedHead}`)throw Error('Not the prospective single-parent commit');
      }
      const i=inputs(current,ticket);
      const expected={...b,project:i.project,batch,ticket,run:key.run,destination:current.identity.destinationRef,expectedHead:landed?b.expectedHead:head,requirementsDigest:i.ticket.hash,gate:i.gate};
      requireDeliveryEvidence(expected,latestBatchAttempt(m.state,i.project,batch,ticket));
      if(!same(expected,b) || !same(current.config,local(p,key).config)) throw Error('Changed batch delivery inputs');
      requireMemberClaim(p,key,current,b.requirementsDigest);
      return {child:Boolean(i.ticket.context.parent),done:current.config.LABELS.done,ready:current.config.LABELS.ready};
    }
    if(r?.gate==='stopped')return r;
    // Lock order: member -> (Git only: batch) -> global admission. The last lock is also
    // used for claim replacement/release. Never acquire a member/batch lock from this callback.
    function publish(b:AttemptBinding,write:()=>void){
      withAdmissionLock(p.state,()=>{requireMemberClaim(p,key,m,b.requirementsDigest);write()});
    }
    if(r && r.key.run!==key.run)throw Error('Delivery belongs to another host run');
    if(candidate && (!r || r.git==='not-started' && r.binding.attempt!==candidate.attempt)) {
      // Record what the host gate approved even if authority was revoked before publication.
      const t=m.config.TRACKER, scope=`${t.kind}://${t.host??t.gitlabHost}/${t.project}`;
      requireDeliveryEvidence({...candidate,project:scope,batch,ticket,run:key.run,destination:m.identity.destinationRef},latestBatchAttempt(m.state,scope,batch,ticket));
      r=save({version:1,key,binding:candidate,completion:null,gate:'approved',git:'not-started',tracker:'not-started',reason:'Exact gate approved; no publication observed'});
    }
    if(!r)throw Error('No gate or delivery to reconcile');
    const b=r.binding;
    if(r.git==='not-started'){
      try {
        if(owned().expectedHead!==b.expectedHead){
          save({...r,reason:'Owned head advanced; a rebuilt candidate, passing tests and two fresh approvals are required'});
          return 'rebuild';
        }
        const settled=advanceBatch(p,project,batch,b.expectedHead,b.candidate,b.attempt,()=>{
          const completion=validate(b);
          return write=>publish(b,()=>{
            r=save({...r!,completion,git:'attempted',reason:'Git advance intent; receipt/readback required'});
            write();
          });
        });
        if(settled.expectedHead!==b.candidate)throw Error('Unexpected settled batch head');
        r=save({...r!,git:'landed',reason:'Exact advance confirmed; tracker not confirmed'});
      } catch(e){
        if(r.git==='not-started'){
          try {if(owned().expectedHead!==b.expectedHead)return 'rebuild'} catch { /* unknown movement is never a rebuild */ }
          return save({...r,reason:`Publication held: ${(e as Error).message.split('\n')[0]}`});
        }
      }
    }
    if(r.git!=='landed'){
      let git:'landed'|'refused'|'unknown'='unknown';
      try {git=confirmedBatchAdvance(p,project,batch,ticket,b.expectedHead,b.candidate,b.attempt)?'landed':observedBatchAdvance(p,project,batch,b.expectedHead,b.candidate,b.attempt)} catch { /* Ownership/transport inconclusive: no retry. */ }
      r=save({...r,git,reason:git==='landed'?'Exact advance confirmed; tracker not confirmed':git==='refused'?'Git refused the advance; inspect permissions/protection or movement':'No conclusive host receipt and Git readback; do not retry'});
      if(git!=='landed')return r;
    }
    if(r.tracker==='complete')return r;
    try {
      // Re-observe Git authority before tracker work. No replay when an earlier tracker call may have executed.
      if(observedBatchAdvance(p,project,batch,b.expectedHead,b.candidate,b.attempt)!=='landed')throw Error('Cannot reconfirm landed receipt');
      const current=local(p,key), plan=r.completion!, tracker=batchCompletion(current.config,ticket,plan);
      const observed=tracker.observe();
      if(!observed.complete && r.tracker==='not-started'){
        // Only a new write needs current gate authority; reconciliation reads the originally intended state.
        if(!same(validate(b,true),plan))throw Error('Tracker completion inputs changed');
        publish(b,()=>{
          r=save({...r!,tracker:'attempted',reason:'Tracker update intent; readback required'});
          try { tracker.update(observed.remove); } catch { /* Read actual tracker state; never blindly replay. */ }
        });
        if(!tracker.observe().complete)throw Error('Tracker completion not observed after update');
      } else if(!observed.complete)throw Error('Tracker remains incomplete after previous intent');
      return save({...r,tracker:'complete',reason:'Exact Git landing and tracker completion observed'});
    } catch(e){return save({...r,tracker:r.tracker==='not-started'?'not-started':'incomplete',reason:`Git landed; ${(e as Error).message.split('\n')[0]}`})}
  });
}
/** Join a producer invoked by dispatch under the same claim. The supplied IDs select, not authorize, a host attempt. */
export async function deliverReviewedBatchMember(p:HostPaths,key:DeliveryKey,selected:Pick<AttemptBinding,'attempt'|'candidate'>,credential:()=>string,gate=runStandardBatchMember){
  const m=local(p,key), t=m.config.TRACKER;
  const row=latestBatchAttempt(m.state,`${t.kind}://${t.host??t.gitlabHost}/${t.project}`,key.batch,key.ticket);
  if(!row || row.binding.attempt!==selected.attempt || row.binding.candidate!==selected.candidate || row.binding.run!==key.run)throw Error('Not the selected current host attempt');
  requireDeliveryEvidence(row.binding,row);
  durableDirectory(m.dir);
  const outcome=deliver(p,key,row.binding);
  return outcome==='rebuild'?runAndDeliverBatchMember(p,key,credential,gate):outcome;
}
/** Caller holds the exclusive admission claim for the recorded run throughout. No ref, proof or SHA is accepted. */
export async function runAndDeliverBatchMember(p:HostPaths,key:DeliveryKey,credential:()=>string,gate=runStandardBatchMember):Promise<BatchDeliveryOutcome|BatchEvidence> {
  const {project,batch,ticket,run}=key;
  for(let round=0;round<4;round++) {
    const m=local(p,key);durableDirectory(m.dir);
    if(load(m,key)) {const saved=deliver(p,key);if(saved!=='rebuild')return saved}
    const owned=()=>readOwnedBatch(p,project,batch), identity=owned(), current=inputs(m,ticket);
    requireMemberClaim(p,key,m,current.ticket.hash);
    const result=await gate({repo:m.root,state:m.state,batch,destination:identity.destinationRef,expectedHead:identity.expectedHead,run,ticket:current.ticket,
      observeHead:async()=>({kind:'owned',head:owned().expectedHead})},m.config,current.image,credential);
    if(result.status!=='approved')return result;
    const observed=deliver(p,key,result.binding);
    if(observed!=='rebuild')return observed;
  }
  throw Error('Owned batch head did not stabilize; retain gate history');
}
