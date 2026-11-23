// Explicit host dispatch only: reload owned membership, inspect recorded prerequisites, atomically claim and run the pinned member gate.
// No legacy dispatcher, prepared acceptance, branch update or tracker mutation is reachable from this pass.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstatSync, readFileSync } from 'node:fs';
import { claimManagedEntry, releaseManagedEntry, withAdmission, writeDurable } from '../../board/admission.mts';
import { claimRun, keyFor, readRuns, writeRecord, PARKED, TERMINAL } from '../../board/board.mts';
import { checkImageCapabilities } from '../../orchestrator/capabilities.mts';
import { commandContextSource } from '../../orchestrator/ticket-context-source.mts';
import { freezeTicketInput } from '../../orchestrator/ticket-input.mts';
import { nativeGithub } from '../../orchestrator/selection-tracker.github.mts';
import { nativeGitlab } from '../../orchestrator/selection-tracker.gitlab.mts';
import { declaredBlockers, memberDelivery, prerequisiteHold, recordedGraph, unavailableDelivery, type DeliveryObserver } from '../../orchestrator/batch-selection.mts';
import { dependencyState } from '../../orchestrator/dependencies.mts';
import { overlap } from '../../orchestrator/graph.mts';
import { projectLaunchReadiness, readinessReason, ticketBranch, ticketWorkspaceProblem } from '../../orchestrator/launch-readiness.mts';
import { excludedAssignees, assigneeReasons } from '../../orchestrator/selection.mts';
import { resolveTicketModel } from '../../orchestrator/models.mts';
import { readOwnedBatch } from './batch.mts';
import { resolveMembers } from './batch-tracker.mts';
import { runStateDir } from './runs.mts';
import { projectWorkflow } from './workflow.mts';
import type { Paths } from './paths.mts';
import type { BatchEvidence, runStandardBatchMember } from '../../orchestrator/batch-review.mts';

type GateResult = Pick<BatchEvidence,'status'|'reason'> & {binding:Pick<BatchEvidence['binding'],'attempt'>};
type MemberGate = (...args:Parameters<typeof runStandardBatchMember>)=>Promise<GateResult>;
type GateHost = { image:typeof checkImageCapabilities; load:(root:string)=>Promise<MemberGate> };
const standardGate:GateHost={image:checkImageCapabilities,load:async root=>(await import(pathToFileURL(join(root,'batch-review.mts')).href)).runStandardBatchMember};
export async function dispatchBatch(paths:Paths, project:string, id:string, observe:DeliveryObserver=unavailableDelivery, gate:GateHost=standardGate) {
  const owned=()=>readOwnedBatch(paths,project,id), batch=owned(), dir=runStateDir(paths), store=join(paths.state,'batches',id);
  if(dir!==paths.state) throw Error('Batch dispatch requires the registered host run-state directory');
  const workflow=projectWorkflow(paths,batch.root), config=workflow.config, tracker=config.TRACKER, host=tracker.host??tracker.gitlabHost!;
  if(workflow.mode!=='factory') throw Error('Batch dispatch requires standard workflow');
  const adapter=tracker.kind==='github'?nativeGithub(config):nativeGitlab(config);
  const identity={kind:tracker.kind,host,project:tracker.project}, source=commandContextSource(identity,tracker.projectId);
  const rows=()=>readRuns(dir,false).filter(r=>r.project===tracker.project);
  const row=(iid:number)=>rows().find(r=>r.iid===String(iid));
  const report=(iid:number,status:string,reason:string)=>{
    writeDurable(join(store,`selection-${iid}.json`),JSON.stringify({batch:id,iid,status,reason,nextAction:status==='held'?'Inspect the blocker or admission fence, then repeat this batch pass':status==='waiting'?'Reconcile delivery; approval alone cannot unblock dependants':status==='stopped'?'Inspect the stopped attempt without deleting its evidence':null,at:new Date().toISOString()})+'\n');
    console.log(`#${iid} ${status}: ${reason}`);
  };
  const delivery:DeliveryObserver=(b,iid)=>{
    const result=observe(b,iid), run=row(iid);
    if(result.state!=='landed' && run?.batchMember?.id===id && run.stage==='stopped') return {state:'stopped',reason:`stopped: ${run.note}`};
    return result;
  };
  function collect(iid:number) {
    const b=owned();
    if(!b.members.includes(iid)) throw Error('Ticket is not a saved member');
    const existing=row(iid);
    if(existing || lstatSync(join(dir,keyFor(String(iid),tracker.project)+'.json'),{throwIfNoEntry:false})) throw Error('Existing or unreadable ticket record; reconcile before dispatch');
    resolveMembers(config,[iid],b.repositoryId);
    const t=adapter.ticket(iid,true);
    if(t.iid!==iid || !['open','opened'].includes(t.state??'') || t.labels?.some(l=>[...config.LABELS.exclude,config.LABELS.needsHuman].includes(l))) throw Error('Member closed, excluded or unknown; inspect tracker');
    if(assigneeReasons(t,excludedAssignees(config.selection,adapter.currentUsername)).length) throw Error('Member assigned to an excluded assignee');
    const ticket=freezeTicketInput(source,iid), units=[ticket.context.child,...(ticket.context.parent?[ticket.context.parent]:[])];
    if(resolveTicketModel(ticket.context.child.description,config.AGENT.family).status!=='resolved') throw Error('Resolve ticket model tier before dispatch');
    let manifest;
    try { manifest=JSON.parse(readFileSync(join(dir,'graph',keyFor(String(iid),tracker.project)+'.json'),'utf8')); }
    catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw Error('Recorded ticket graph unavailable; inspect manifest'); }
    if(manifest===null) throw Error('Unreadable ticket graph; inspect manifest');
    const graph=recordedGraph(manifest,tracker.project,iid,ticket.hash,b.expectedHead);
    const blockers=[...graph.blockers,...units.flatMap(u=>[...adapter.blockers(u.iid),...declaredBlockers(u.description),...u.notes.flatMap(n=>declaredBlockers(n.body))])];
    const hold=prerequisiteHold(b,blockers,delivery,n=>dependencyState(n,{ticket:k=>{const t=adapter.ticket(k,true);return t.iid===k?t:undefined},run:row,mergedInto:adapter.mergedInto,base:b.baseRef.slice(11)}));
    if(hold) throw Error(hold);
    const workspace=ticketWorkspaceProblem(batch.root,ticketBranch(iid,ticket.context.child.title));
    if(workspace) throw Error(workspace);
    return {b,ticket,footprint:graph.footprint};
  }
  const entry=claimManagedEntry(dir,{root:batch.root,tracker:identity});
  const jobs:Promise<void>[]=[];
  const settlementErrors:unknown[]=[];
  try {
    const readiness=readinessReason(await projectLaunchReadiness({projectRoot:batch.root,runtimeRoot:workflow.root,runtimeIdentity:workflow.id,runtimeDependencies:workflow.manifest.dependencies,config,stateRoot:dir}));
    if(readiness) {for(const iid of batch.members) report(iid,'held',readiness);throw Error(readiness);}
    let image:string|undefined;
    for(const iid of batch.members) {
      try {
        const current=owned(), prior=row(iid);
        const observation=delivery(current,iid), fact=memberDelivery(current,iid,()=>observation);
        if(fact.state==='satisfied') {report(iid,'delivered','Observed delivery on the owned batch');continue;}
        if(!prior && (observation.state==='waiting' || observation.state==='stopped' || observation.state==='landed')) {report(iid,'held',fact.reason??'Observed prior work; reconcile before dispatch');continue;}
        if(prior?.batchMember?.id===id) {report(iid,prior.stage,`${prior.note ?? 'Existing batch run'}; ${fact.reason ?? 'inspect the existing run'}`);continue;}
        const first=collect(iid);
        if(!config.config.batchTests) throw Error('Configure batch tests before dispatch');
        if(!image) {
          const result=await gate.image({stateDir:dir,image:config.config.image,uid:process.getuid?.()??1000,gid:process.getgid?.()??1000});
          if(!result.ok) throw Error(result.reason);
          image=result.imageId;
        }
        const runGate=await gate.load(workflow.root);
        const {b,ticket,footprint}=collect(iid);
        const now=projectWorkflow(paths,b.root);
        if(first.ticket.hash!==ticket.hash || first.b.expectedHead!==b.expectedHead || now.id!==workflow.id || JSON.stringify(now.config)!==JSON.stringify(config)) throw Error('Ownership, runtime or requirements changed; repeat dispatch');
        const settled=new Set(rows().filter(r=>r.batchMember?.id===id && r.batchMember.gate==='approved' && memberDelivery(b,Number(r.iid),delivery).state==='satisfied').map(r=>r.executionId));
        if(owned().expectedHead!==b.expectedHead) throw Error('Owned batch moved during admission; repeat dispatch');
        const claim=claimRun({dir,project:tracker.project,projectRoot:b.root,iid:String(iid),pid:process.pid,cap:config.dispatch.maxConcurrent,
          patch:{batchMember:{id,repositoryId:b.repositoryId,footprint},starting:false,title:ticket.context.child.title,ticketHash:ticket.hash,stage:'implementing',parentIid:ticket.context.parent?.iid.toString()},
          also:current=>{
            if(current) throw Error('Ticket already has a run; reconcile before dispatch');
            for(const r of rows()) {
              const pending=r.stage==='waiting' && r.batchMember?.gate==='approved' && !settled.has(r.executionId);
              if(!pending && (TERMINAL.includes(r.stage)||PARKED.includes(r.stage)) && (!r.branch || r.mergedAt)) continue;
              const conflicts=overlap(footprint,r.batchMember?.footprint??['*'],config.GRAPH.conflictIgnore);
              if(conflicts.length) throw Error(`Footprint conflict with #${r.iid}: ${conflicts.join(', ')}; retry after its work settles`);
            }
          }});
        if(!claim.ok) throw Error(claim.reason);
        const token=claim.run.claim!;
        jobs.push((async()=>{
          let evidence:GateResult|undefined, reason='Gate unavailable; reconcile the claimed attempt';
          try {
            evidence=await runGate({repo:b.root,state:store,batch:id,destination:b.destinationRef,expectedHead:b.expectedHead,run:token,ticket,observeHead:async()=>({kind:'owned',head:owned().expectedHead})},config,image!,()=>process.env[config.AGENT.family==='openai'?'OPENAI_API_KEY':'CLAUDE_CODE_OAUTH_TOKEN']??'');
            reason=evidence.status==='approved'?'Gate approved; awaiting observed delivery':evidence.reason;
          } catch(e) {reason=(e as Error).message;}
          withAdmission(dir,tx=>{
            const key=keyFor(String(iid),tracker.project), r=row(iid);
            if(tx.state.claims[key]?.token!==token || r?.claim!==token || r.batchMember?.id!==id) throw Error('Batch claim changed; reconcile without replay');
            const stage=evidence?.status==='approved'?'waiting':'stopped';
            writeRecord(dir,key,{...r,stage,claim:undefined,note:reason,updatedAt:new Date().toISOString(),batchMember:{...r.batchMember,attempt:evidence?.binding.attempt,gate:evidence?.status}});
            delete tx.state.claims[key];tx.commit();report(iid,stage,reason);
          });
        })().catch(error=>{settlementErrors.push(error)}));
      } catch(e) {report(iid,'held',(e as Error).message);}
    }
  } finally {
    try { await Promise.all(jobs); } finally { releaseManagedEntry(dir,entry); }
  }
  if(settlementErrors.length) throw settlementErrors[0];
  return 0;
}
