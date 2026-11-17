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
import { ADVISORY_PROFILE_ID, advisoryReservation, diagnosisGrant } from '../src/supervisor-advisory-contract.mts';
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
function fixture() {
  const facts={scope:{kind:'ticket' as const,ticket:7},requirements:h,gate:h,runId:'run',failure:h}, incidentId=incidentIdentity(project,facts);
  const apply=(s:any,e:any)=>transitionSupervisor(s,e,{ownerState:()=> 'alive'});
  const observed=apply(emptySupervisor(project),{id:'observe',at,kind:'observe',facts,snapshotHash:h,reason:'saved failure'});
  const reservation={id:hold.invocationId,incidentId,kind:'diagnosis' as const,owner,fence:hold.fence,at,deadline:'2026-11-17T00:10:00.000Z',reserved:advisoryReservation(),actual:null,state:'active' as const,reviewId:null};
  const registration={holdId:hold.id,host,project:policy,at};
  const reserved=apply(observed,{id:'reserve',at,kind:'reserve-advisory',reservation,policy:registration,controls,
    limits:{project:{tokens:10_000_000,cost:100_000_000},shared:{tokens:10_000_000,cost:100_000_000},capacity:1,reviewCalls:5,reviewTimeoutMs:600_000}});
  const grant=diagnosisGrant({version:1,project,ticket:7,runId:'run',attemptId:null,incidentId,basis:h,invocationId:hold.invocationId,fence:hold.fence,holdId:hold.id,
    runtime:h,dependencies:h,profile:ADVISORY_PROFILE_ID,policy:hostAdvisoryPolicyIdentity(host),owner:worker,deadline:reservation.deadline,reserved:reservation.reserved});
  const registered=apply(reserved,{id:'register',at,kind:'register-advisory-worker',reservationId:hold.invocationId,fence:hold.fence,owner,grant});
  const authorized=apply(registered,{id:'send',at,kind:'authorize-advisory-send',reservationId:hold.invocationId,fence:hold.fence,worker,grantId:grant.id,payload:h,policy:registration,controls});
  return {observed,reserved,registered,authorized};
}
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
