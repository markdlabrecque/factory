// Cheap host-control and restart-cutpoint units. Actual registry reads + existing platform fake; no installed provider/custody claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { paths } from '../src/paths.mts';
import { FakeSchedule } from '../src/platform/fake.mts';
import { readSupervisorHostControls, inspectSupervisorHost, prepareSupervisorHost } from '../src/supervisor-host.mts';
import { emptySupervisor, incidentIdentity, transitionSupervisor } from '../src/supervisor-state.mts';
import { ADVISORY_PROFILE, ADVISORY_PROFILE_ID, SUBSCRIPTION_PROFILE, SUBSCRIPTION_PROFILE_ID, advisoryReservation, diagnosisGrant } from '../src/supervisor-advisory-contract.mts';
import { hostAdvisoryPolicyIdentity } from '../src/supervisor-host-policy.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
const project = {root:'/fixture/project',tracker:{kind:'github' as const,host:'github.com',project:'owner/repo'}};
const h='a'.repeat(64), at='2026-11-17T00:00:00.000Z';
const owner={pid:123,start:'controller'}, worker={pid:124,start:'worker'};
const hold={id:'hold',project,invocationId:'invocation',fence:'fence',owner};
const host={version:1 as const,enabled:true as const,profile:ADVISORY_PROFILE_ID,capacity:1 as const,cumulative:{tokens:10_000_000,cost:100_000_000,calls:10}};
const role={maxTokens:5_000_000,maxCostUsd:50,maxCalls:5,timeoutSeconds:600};
const policy={enabled:true,limits:{maxTokens:10_000_000,maxCostUsd:100,maxCalls:10,diagnosis:role,review:role}};
const controls={registered:true,global:'on' as const,projectControl:'enabled' as const};
function fixture(profile = ADVISORY_PROFILE_ID) {
  const selectedHost = {...host,profile};
  const facts={scope:{kind:'ticket' as const,ticket:7},requirements:h,gate:h,runId:'run',failure:h}, incidentId=incidentIdentity(project,facts);
  const apply=(s:any,e:any)=>transitionSupervisor(s,e,{ownerState:()=> 'alive'});
  const observed=apply(emptySupervisor(project),{id:'observe',at,kind:'observe',facts,snapshotHash:h,reason:'saved failure'});
  const reservation={id:hold.invocationId,incidentId,kind:'diagnosis' as const,owner,fence:hold.fence,at,deadline:'2026-11-17T00:10:00.000Z',reserved:advisoryReservation(profile),actual:null,state:'active' as const,reviewId:null};
  const registration={holdId:hold.id,host:selectedHost,project:policy,at};
  const reserved=apply(observed,{id:'reserve',at,kind:'reserve-advisory',reservation,policy:registration,controls,
    limits:{project:{tokens:10_000_000,cost:100_000_000},shared:{tokens:10_000_000,cost:100_000_000},capacity:1,reviewCalls:5,reviewTimeoutMs:600_000}});
  const grant=diagnosisGrant({version:1,project,ticket:7,runId:'run',attemptId:null,incidentId,basis:h,invocationId:hold.invocationId,fence:hold.fence,holdId:hold.id,
    runtime:h,dependencies:h,profile,policy:hostAdvisoryPolicyIdentity(selectedHost),owner:worker,deadline:reservation.deadline,reserved:reservation.reserved});
  const registered=apply(reserved,{id:'register',at,kind:'register-advisory-worker',reservationId:hold.invocationId,fence:hold.fence,owner,grant});
  const authorized=apply(registered,{id:'send',at,kind:'authorize-advisory-send',reservationId:hold.invocationId,fence:hold.fence,worker,grantId:grant.id,payload:h,policy:registration,controls});
  return {observed,reserved,registered,authorized};
}
test('terminal publication is atomic with final journal fences and never refunds the reservation',()=>{
  const {authorized} = fixture(), key=supervisorHash(hold.invocationId), g=authorized.advisory!.workers[key].grant,
    a=authorized.advisory!.sends[key], incidentId=g.incidentId;
  const ub={version:1,grantId:g.id,authorization:a.receipt,invocationId:g.invocationId,fence:g.fence,profile:g.profile,price:ADVISORY_PROFILE.price,
    rawHash:h,requestId:'req_unit',responseId:'resp_unit',terminalStatus:'completed',serviceTier:'default',cachePolicy:'explicit-unmarked',
    state:'known',reason:'complete',usage:{input:25,cacheRead:0,cacheWrite:0,output:10,reasoning:0,total:35},resources:{tokens:35,cost:220},costKind:'derived-upper-micro-usd'};
  const decision={version:1,incidentId,basisHash:h,classification:'expectation',rationale:'Typed synthetic wait',alternatives:['Inspect originals'],action:{kind:'wait',expectation:'Human instruction'}};
  const db={reservationId:g.invocationId,incidentId,basisHash:h,snapshotHash:h,fence:g.fence,startedAt:at,completedAt:at,inputRef:'/host/input.json',outcome:'proposed',reason:'Typed synthetic wait',stdout:'{}',stderr:'',decision};
  const event:any={kind:'settle-advisory',id:'terminal',at,reservationId:g.invocationId,
    settlement:{grantId:g.id,holdId:g.holdId,invocationId:g.invocationId,fence:g.fence,authorization:a.receipt,usage:{id:supervisorHash(ub),...ub},process:h,cleanup:h,at,disposition:'local-human-required'},
    diagnostic:{id:supervisorHash(db),...db},request:{version:1,id:'human',project,scope:{kind:'ticket',ticket:7},incidentId,proposalId:supervisorHash(db),reason:'authority-uncertain',question:'What next?',nextAction:'Inspect original evidence; no automatic execution',evidence:['/host/input.json'],stop:'required',delivery:{state:'pending',attempts:0}}};
  for(const fence of ['none','stop','denial','superseded','late','malformed']) {
    const state=structuredClone(authorized), e=structuredClone(event);
    if(fence==='stop') state.control={mode:'stopped',actor:'human',at,pilot:false};
    if(fence==='denial') {state.incidents[incidentId].denied=true;state.incidents[incidentId].incident.state='human-required';}
    if(fence==='superseded') state.incidents[incidentId].superseded=true;
    if(fence==='late') {e.at=g.deadline;e.settlement.at=e.at;e.diagnostic.completedAt=e.at;}
    if(fence==='malformed') Object.assign(e.diagnostic,{outcome:'malformed',decision:null,reason:'Invalid typed output'});
    const {id,...body}=e.diagnostic;e.diagnostic.id=supervisorHash(body);
    const after=transitionSupervisor(state,e,{ownerState:()=> 'alive'});
    assert.equal(after.advisory!.settlements![key].disposition,fence==='none'?'retained-advice':'local-human-required',fence);
    assert.equal(after.reservations[key].state,'finished');
    assert.deepEqual(after.charged,state.charged,'full reserved charge retained');
    if(fence!=='none') {
      assert.equal(Object.values(after.humans).length,1,'human request and accounting commit together');
      assert.equal(Object.values(after.diagnostics!)[0].decision,null,'no fake proposed output');
    }
    assert.deepEqual(transitionSupervisor(after,e,{ownerState:()=> 'unknown'}),after,'event replay cannot resend or recharge');
  }
});

test('subscription terminal overrun stays known, cumulatively increases charge without refund and atomically requires a human',()=>{
  for(const output of [10,4097,2_000_000]) {
    const {authorized}=fixture(SUBSCRIPTION_PROFILE_ID), key=supervisorHash(hold.invocationId), g=authorized.advisory!.workers[key].grant, a=authorized.advisory!.sends[key];
    const total=25+output;
    const ub={version:1,grantId:g.id,authorization:a.receipt,invocationId:g.invocationId,fence:g.fence,profile:g.profile,price:SUBSCRIPTION_PROFILE.price,
      rawHash:h,requestId:'req_unit',responseId:'resp_unit',terminalStatus:'completed',serviceTier:'default',cachePolicy:'provider-managed',state:'known',reason:'complete',
      usage:{input:25,cacheRead:0,cacheWrite:0,output,reasoning:8,total},resources:{tokens:total,cost:0},costKind:'subscription-api-invoice-not-applicable'};
    const decision={version:1,incidentId:g.incidentId,basisHash:h,classification:'expectation',rationale:'Synthetic wait',alternatives:['Inspect originals'],action:{kind:'wait',expectation:'Human instruction'}};
    const db={reservationId:g.invocationId,incidentId:g.incidentId,basisHash:h,snapshotHash:h,fence:g.fence,startedAt:at,completedAt:at,inputRef:'/host/input.json',outcome:'proposed',reason:'Synthetic wait',stdout:'{}',stderr:'',decision};
    const event:any={kind:'settle-advisory',id:'terminal',at,reservationId:g.invocationId,diagnostic:{id:supervisorHash(db),...db},
      request:{version:1,id:'human',project,scope:{kind:'ticket',ticket:7},incidentId:g.incidentId,proposalId:supervisorHash(db),reason:'authority-uncertain',question:'Inspect subscription target overrun?',nextAction:'Inspect known counters; preserve charge',evidence:['/host/input.json'],stop:'required',delivery:{state:'pending',attempts:0}},
      settlement:{grantId:g.id,holdId:g.holdId,invocationId:g.invocationId,fence:g.fence,authorization:a.receipt,usage:{id:supervisorHash(ub),...ub},process:h,cleanup:h,at,disposition:'local-human-required'}};
    const after=transitionSupervisor(authorized,event,{ownerState:()=> 'alive'});
    assert.deepEqual(after.reservations[key].actual,{tokens:total,cost:0});
    assert.deepEqual(after.charged.diagnosis,{tokens:Math.max(g.reserved.tokens,total),cost:0});
    assert.equal(after.advisory!.settlements![key].disposition,output>4096?'local-human-required':'retained-advice');
    if(output>4096) assert.equal(after.incidents[g.incidentId].incident.state,'human-required');
    assert.deepEqual(transitionSupervisor(after,event,{ownerState:()=> 'unknown'}),after);
    const foreign=structuredClone(authorized);foreign.advisory!.policies[key].host.profile=ADVISORY_PROFILE_ID;
    assert.throws(()=>transitionSupervisor(foreign,event,{ownerState:()=> 'alive'}),/orphan advisory policy|foreign worker grant/);
  }
});

test('every host control read uses existing backend state and current registry opt-in without mutation',async t=>{
  const home=mkdtempSync(join(tmpdir(),'factory-host-controls-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const p=paths(home), root=join(home,'project');mkdirSync(root);mkdirSync(p.config,{recursive:true,mode:0o700});
  const backend=new FakeSchedule(p);backend.enabled=true;backend.timer='active';
  const registry=(schedule?:any,roots=[root])=>writeFileSync(p.projects,JSON.stringify({version:1,projects:roots.map((root,i)=>({name:String(i),root,...(schedule?{schedule}:{})}))}));
  const enabled={enabled:true,branch:'main',since:at};
  registry();assert.deepEqual(await readSupervisorHostControls(p,root,backend),{registered:true,global:'on',projectControl:'paused'},'never opted-in is held');
  registry(enabled);assert.deepEqual(await readSupervisorHostControls(p,root,backend),controls);
  backend.enabled=false;assert.equal((await readSupervisorHostControls(p,root,backend)).global,'off');
  backend.enabled=true;backend.timer='inactive';assert.equal((await readSupervisorHostControls(p,root,backend)).global,'off');
  backend.timer='active';registry({...enabled,enabled:false});assert.equal((await readSupervisorHostControls(p,root,backend)).projectControl,'paused');
  registry(enabled,[]);assert.equal((await readSupervisorHostControls(p,root,backend)).registered,false);
  registry(enabled,[root,root]);assert.deepEqual(await readSupervisorHostControls(p,root,backend),{registered:false,global:'on',projectControl:'unknown'});
  const alias=join(home,'alias');symlinkSync(root,alias);registry(enabled,[alias]);assert.equal((await readSupervisorHostControls(p,root,backend)).registered,false);
  registry(enabled);backend.fail.add('status');assert.equal((await readSupervisorHostControls(p,root,backend)).global,'unknown');
  assert(backend.calls.every(c=>c==='status'),'read-only; no enable/install/disable calls');
});
test('host preparation refuses genuine off, unregistered and absent host policy before runtime/exclusion',async t=>{
  const home=mkdtempSync(join(tmpdir(),'factory-host-preflight-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const p=paths(home),root=join(home,'project');mkdirSync(root);mkdirSync(p.config,{recursive:true,mode:0o700});
  const backend=new FakeSchedule(p),tracker={identity:project.tracker} as any;
  const options={paths:p,project:{...project,root},ticket:7,invocationId:'invocation',backend,tracker,rollout:{olderRuntimesQuiesced:true as const,unmanagedWorkQuiesced:true as const}};
  await assert.rejects(prepareSupervisorHost(options),/registration=false, global=off/);
  backend.enabled=true;backend.timer='active';
  writeFileSync(p.projects,JSON.stringify({version:1,projects:[{name:'project',root,schedule:{enabled:true,branch:'main',since:at}}]}));
  await assert.rejects(prepareSupervisorHost(options),/ENOENT/,'missing policy never enables advisory or creates a default');
  assert(backend.calls.every(c=>c==='status'));
});
test('restart cutpoint matrix is inspectable, retains full charge and never reconstructs send or no-send',()=>{
  const f=fixture();
  for(const [state,expected] of [[f.observed,'exclusion-only'],[f.reserved,'reserved'],[f.registered,'registered'],[f.authorized,'authorized']] as const){
    const before=JSON.stringify(state),v=inspectSupervisorHost(state,hold);
    assert.equal(v.state,expected);assert.equal(v.resend,false);assert(v.nextAction.length>60);
    assert.deepEqual(v.charged,expected==='exclusion-only'?null:advisoryReservation());
    assert.equal(JSON.stringify(state),before,'inspection cannot mutate journals, permission, history or charges');
    assert.deepEqual(inspectSupervisorHost(structuredClone(state),hold),v,'restart is deterministic and observational');
  }
  for(const patch of [{fence:'successor'},{id:'foreign'},{owner:{pid:999,start:'successor'}},{project:{...project,root:'/foreign'}}])
    assert.equal(inspectSupervisorHost(f.authorized,{...hold,...patch}).state,'inconsistent');
  const stopped=transitionSupervisor(f.authorized,{id:'stop',at,kind:'control',mode:'stopped',actor:'human',pilot:false},{ownerState:()=> 'alive'});
  assert.equal(inspectSupervisorHost(stopped,hold).state,'authorized','stop is not remote cancellation or a refund');
  assert.equal(stopped.charged.diagnosis.cost,5808792);
  assert.equal(Object.keys(stopped.advisory!.sends).length,1);
  assert.equal(stopped.advisory!.sends[supervisorHash(hold.invocationId)].grantId,f.authorized.advisory!.workers[supervisorHash(hold.invocationId)].grant.id);
});
