// Offline policy matrices and one disposable process/outbox boundary. No real Pi, tracker, credentials, services or sleeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewGateProposal } from '../src/supervisor-review.mts';
import type { ReviewAuthorization, ReviewBoundary, ReviewOptions } from '../src/supervisor-review.mts';
import { deliverSupervisorRequest, trackerNotificationAdapter, requestMarker, resolveSupervisorRequest } from '../src/supervisor-escalation.mts';
import type { CommentReceipt, NotificationAdapter } from '../src/supervisor-escalation.mts';
import { readSupervisor, commitSupervisor, incidentIdentity, supervisorHumanHold, supervisorRevisionHold, supervisorFile } from '../src/supervisor-state.mts';
import { supervisorHash, proposalIdentity } from '../../orchestrator/supervisor-contract.mts';
import { diagnoseProject } from '../src/supervisor-worker.mts';
import { modelForRole } from '../../orchestrator/model-policy.mts';
import { reviewFixture, AT } from './supervisor-fixture.mts';
import { exportEvents, supervisorOutcomeMetrics } from '../../board/execution-events.mts';
function setup(home:string,name:string, mutate?: (a:ReturnType<typeof reviewFixture>['authorization'], input:ReturnType<typeof reviewFixture>['input'])=>void) {
  const {authorization,input}=reviewFixture(join(home,`project-${name}`)),stateDir=join(home,`state-${name}`);
  mutate?.(authorization,input);
  input.proposal.incidentId=incidentIdentity(input.snapshot.project,authorization.facts);input.proposal.snapshotHash=supervisorHash(input.snapshot);
  const {id,...body}=input.proposal;input.proposal.id=proposalIdentity(body);
  const a:ReviewAuthorization={...authorization,input,proposer:'diagnosis-controller',notification:{mode:'act',authorized:true}};
  const commit=(event:any)=>{const s=readSupervisor(stateDir,input.snapshot.project);return commitSupervisor(stateDir,s.project,s.revision,event);};
  commit({id:'observe',at:AT,kind:'observe',facts:authorization.facts,snapshotHash:supervisorHash(input.snapshot),reason:'Original failure'});
  commit({id:'proposal',at:AT,kind:'proposal',proposal:input.proposal});
  let wake=()=>{}, child:ChildProcess, launches=0, behavior=(x:any)=>complete(JSON.stringify(decision(x))),accounting:{tokens:number;cost:number}|null={tokens:20,cost:20},gone=true;
  const envelopes:any[]=[];
  const decision=(x:any)=>({version:1,inputHash:x.inputHash,proposalId:x.proposalId,...x.identity,disposition:'approve',reason:'Full original evidence supports exact equivalent expectation'});
  function complete(raw:string,code=0){child.stdout!.emit('data',Buffer.from(raw));child.emit('exit',code);child.emit('close',code);}
  const b:ReviewBoundary={model:modelForRole(a.family,'gateReview').model,reservation:{tokens:100,cost:100},enforceable:true,pricingKnown:true,accountingKnown:true,
    start(command,argv,options){launches++;assert.equal(command,'pi');assert.equal(Object.values(readSupervisor(stateDir,input.snapshot.project).reservations).filter(r=>r.state==='active').length,1);
      assert.equal(argv[argv.indexOf('--model')+1],modelForRole(a.family,'gateReview').model);
      for(const flag of ['--no-session','--no-tools','--no-extensions','--no-skills','--no-context-files'])assert.ok(argv.includes(flag));
      for(const forbidden of ['--tools','--resume','--continue','FlagAHuman'])assert.ok(!argv.includes(forbidden));
      assert.deepEqual(readdirSync(options.cwd),[]);assert.equal(options.env.HOME,options.cwd);assert.equal(options.env.PI_CODING_AGENT_DIR,options.cwd);
      assert.deepEqual(Object.keys(options.env).sort(),['HOME','PATH','PI_CODING_AGENT_DIR']);
      const x=JSON.parse(options.input.slice(options.input.lastIndexOf('\n\n{')+2));envelopes.push(x);
      assert.deepEqual(x.input,a.input);assert.equal(x.input.snapshot.sources.find((s:any)=>s.role==='human-planning').text,'original human-planning');
      assert.notEqual(x.identity.reviewer,a.proposer);
      child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),pid:99999}) as unknown as ChildProcess;
      queueMicrotask(()=>behavior(x));return child;},async terminate(){return gone;},usage(){return accounting;}};
  const comments:CommentReceipt[]=[];let posts=0;
  const adapter:NotificationAdapter={list:()=>comments,create(p,target,body){posts++;assert.equal(Object.values(readSupervisor(stateDir,p).humans)[0].stop,'required');
    assert.ok(readSupervisor(stateDir,p).deliveries?.[input.proposal.incidentId]);
    const c={id:'17',body,url:`https://${p.tracker.host}/${p.tracker.project}/issues/${target}#issuecomment-17`};comments.push(c);return c;}};
  const options:ReviewOptions={stateDir,current:()=>structuredClone(a),boundary:b,notifications:adapter,now:()=>Date.parse(AT),timer(f){wake=f;return()=>{};}};
  return {a,input,b,options,stateDir,adapter,comments,commit,decision,complete,envelopes,state:()=>readSupervisor(stateDir,input.snapshot.project),
    behavior:(f:typeof behavior)=>{behavior=f;},timeout:()=>wake(),usage:(x:typeof accounting)=>{accounting=x;},cleanup:(x:boolean)=>{gone=x;},launches:()=>launches,posts:()=>posts,
    deliver:()=>deliverSupervisorRequest({stateDir,project:input.snapshot.project,incidentId:input.proposal.incidentId,current:()=>a.notification,adapter,now:()=>Date.parse(AT)})};
}
test('fresh review and durable denial/outbox boundary, failure retention, no shopping or mutation/reset',async()=>{
  const home=mkdtempSync(join(tmpdir(),'factory-review-'));
  try {
    const approved=setup(home,'approved');assert.equal((await reviewGateProposal(approved.options)).state,'review-approved');
    const saved=approved.state();assert.equal((await reviewGateProposal(approved.options)).state,'review-approved');assert.equal(approved.launches(),1);assert.deepEqual(approved.state().charged,saved.charged);assert.equal(approved.posts(),0);
    const anth=setup(home,'anthropic');anth.a.family='anthropic';anth.b.model=modelForRole('anthropic','gateReview').model;
    const extension=join(home,'fixture-provider.ts');writeFileSync(extension,'// offline only, never loaded');
    assert.equal((await reviewGateProposal({...anth.options,subscriptionExtension:extension})).state,'review-approved');
    const denied=setup(home,'denied');denied.behavior(x=>denied.complete(JSON.stringify({...denied.decision(x),disposition:'deny',reason:'Proposed expectation would weaken required evidence'})));
    assert.equal((await reviewGateProposal(denied.options)).state,'human-required');const stopped=denied.state(),h=Object.values(stopped.humans)[0];
    assert.equal(h.delivery.state,'notified');assert.equal(stopped.incidents[h.incidentId].denied,true);assert.equal(denied.posts(),1);
    const observed = exportEvents(denied.stateDir).events;
    const completion = observed.find(e => e.to === 'review-complete')!;
    assert.equal(completion.supervisor!.outcome,'refused'); assert.equal(completion.supervisor!.proposalId,denied.input.proposal.id);
    assert.deepEqual(completion.supervisor!.usage,{tokens:20,cost:20}); assert.equal(completion.supervisor!.role,'review');
    assert.equal(supervisorOutcomeMetrics(observed,[]).incidents[0].timeToConfirmedProgressMs,null);
    assert.deepEqual(stopped.intents,{});assert.deepEqual(stopped.proposals,{[denied.input.proposal.id]:denied.input.proposal});
    assert.equal((await reviewGateProposal(denied.options)).state,'human-required');assert.equal(denied.launches(),1);assert.equal(denied.posts(),1);assert.deepEqual(denied.state().charged,stopped.charged);
    // A response lost after the actual injected comment creation remains pending and can only reconcile the marker.
    const lost=setup(home,'lost');const create=lost.adapter.create;lost.adapter.create=(...args)=>{create(...args);throw Error('response lost after accepted POST');};
    lost.behavior(x=>lost.complete(JSON.stringify({...lost.decision(x),disposition:'deny'})));
    assert.equal((await reviewGateProposal(lost.options)).state,'human-required');assert.equal(Object.values(lost.state().humans)[0].delivery.state,'pending');
    assert.equal(lost.deliver().state,'notified');assert.equal(lost.posts(),1);assert.equal((await reviewGateProposal(lost.options)).state,'human-required');assert.equal(lost.launches(),1);
    const failed=setup(home,'failed-notify');failed.adapter.create=()=>{throw Error('uncertain network');};failed.behavior(x=>failed.complete(JSON.stringify({...failed.decision(x),disposition:'deny'})));
    await reviewGateProposal(failed.options);const pending=failed.state();assert.equal(failed.deliver().state,'pending');assert.equal(Object.values(failed.state().humans)[0].delivery.attempts,1);
    assert.deepEqual(failed.state().charged,pending.charged);assert.equal(failed.launches(),1);
    const unauthorized=setup(home,'no-write');unauthorized.a.notification.authorized=false;
    unauthorized.behavior(x=>unauthorized.complete(JSON.stringify({...unauthorized.decision(x),disposition:'deny'})));await reviewGateProposal(unauthorized.options);
    unauthorized.adapter.create=()=>{throw Error('forbidden tracker write');};unauthorized.adapter.list=()=>{throw Error('forbidden tracker read');};
    assert.equal(unauthorized.deliver().state,'pending');assert.equal(unauthorized.posts(),0);assert.equal(Object.keys(unauthorized.state().deliveries??{}).length,0);
    unauthorized.a.notification={mode:'observe',authorized:true};assert.equal(unauthorized.deliver().state,'pending');assert.equal(Object.keys(unauthorized.state().deliveries??{}).length,0);
    // No fabricated human approval from notification, tracker text, restart or mode changes.
    failed.a.input.snapshot.mode='observe';await reviewGateProposal(failed.options);failed.a.input.snapshot.mode='act';await reviewGateProposal(failed.options);assert.equal(failed.launches(),1);
    assert.equal(Object.values(failed.state().humans)[0].stop,'required');
    const project=setup(home,'project',(a,input)=>{input.proposal.change.category='factory-policy';input.proposal.scope={kind:'project'};input.snapshot.scope={kind:'project'};a.facts.scope={kind:'project'};});
    assert.equal((await reviewGateProposal(project.options)).state,'human-required');assert.equal(project.posts(),0);assert.equal(project.launches(),0);
    assert.equal(Object.values(project.state().humans)[0].scope.kind,'project');
    project.a.notification.operatorIssue=99;
    project.adapter.create=(p,target,body)=>{assert.equal(target,99);return{id:'8',body,url:`https://${p.tracker.host}/${p.tracker.project}/issues/99#issuecomment-8`};};
    assert.equal(project.deliver().state,'notified');
    const incomplete=setup(home,'missing',(_a,input)=>{input.snapshot.sources.find(s=>s.role==='gate')!.status='truncated';});
    assert.equal((await reviewGateProposal(incomplete.options)).state,'human-required');assert.equal(incomplete.launches(),0);assert.equal(incomplete.posts(),1);
    // Explicit audited resolution cannot clear original denial or approve the denied proposal; no refunds.
    assert.throws(()=>resolveSupervisorRequest({stateDir:denied.stateDir,project:h.project,incidentId:h.incidentId,requestId:'foreign',proposalId:h.proposalId,actor:'uid:1:operator',reason:'Inspect originals',nextProposalId:null,now:()=>Date.parse(AT)}));
    const resolved=resolveSupervisorRequest({stateDir:denied.stateDir,project:h.project,incidentId:h.incidentId,requestId:h.id,proposalId:h.proposalId,actor:'uid:1:operator',reason:'Abandon unsafe proposal',nextProposalId:null,now:()=>Date.parse(AT)});
    assert.equal(supervisorOutcomeMetrics(exportEvents(denied.stateDir).events,[]).observedInterventions,1);
    assert.equal(resolved.incidents[h.incidentId].denied,true);assert.deepEqual(resolved.charged,stopped.charged);assert.equal((await reviewGateProposal(denied.options)).state,'human-required');assert.equal(denied.launches(),1);
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('durable observe/stop fences stale-act review and notification callers without spending or POST', async () => {
  const home=mkdtempSync(join(tmpdir(),'factory-review-controls-'));
  try {
    for (const mode of ['observe','stopped'] as const) {
      const f=setup(home,mode);
      f.commit({kind:'human',id:'pending-human',at:AT,request:{version:1,id:'pending',project:f.input.snapshot.project,scope:f.input.proposal.scope,incidentId:f.input.proposal.incidentId,proposalId:f.input.proposal.id,
        reason:'authority-uncertain',question:'Inspect originals',evidence:['fixture:gate'],nextAction:'Resolve exact request',delivery:{state:'pending',attempts:0},stop:'required'}});
      f.commit({kind:'control',id:'operator-control',at:AT,mode,actor:'uid:fixture',pilot:false});
      const before=readFileSync(supervisorFile(f.stateDir),'utf8');
      assert.equal((await reviewGateProposal(f.options)).state,'held');
      assert.equal(f.deliver().state,'pending'); assert.equal(f.launches(),0); assert.equal(f.posts(),0);
      assert.equal(readFileSync(supervisorFile(f.stateDir),'utf8'),before);
      const fresh=setup(home,`${mode}-no-human`);
      fresh.commit({kind:'control',id:'operator-control',at:AT,mode,actor:'uid:fixture',pilot:false});
      assert.equal((await reviewGateProposal(fresh.options)).state,'held');assert.equal(fresh.launches(),0);
      assert.deepEqual(fresh.state().charged.review,{tokens:0,cost:0});
    }
    const intentOnly=setup(home,'intent-not-authorization');
    intentOnly.commit({kind:'control',id:'operator-act',at:AT,mode:'act',actor:'uid:fixture',pilot:true});
    intentOnly.a.input.snapshot.mode='observe';
    assert.equal((await reviewGateProposal(intentOnly.options)).state,'held');assert.equal(intentOnly.launches(),0);
  } finally {rmSync(home,{recursive:true,force:true});}
});

test('review failure/authority/accounting matrices fail closed with bounded human stop',async()=>{
  const home=mkdtempSync(join(tmpdir(),'factory-review-matrix-'));
  try {
    for(const kind of ['malformed','identity','timeout','cancel','stale','overflow','exit','cleanup','accounting','budget','primitive','model','pricing','context','observe','notification-off'] as const){
      const f=setup(home,kind),abort=new AbortController();
      f.behavior(x=>{if(kind==='timeout')f.timeout();else if(kind==='cancel')abort.abort();else if(kind==='malformed')f.complete('{}');else if(kind==='identity')f.complete(JSON.stringify({...f.decision(x),reviewer:'supervisor'}));
        else if(kind==='overflow')f.complete('x'.repeat(16385));else {if(kind==='stale')f.a.paused=true;if(kind==='cleanup')f.cleanup(false);if(kind==='accounting')f.usage(null);f.complete(JSON.stringify({...f.decision(x),disposition:kind==='notification-off'?'deny':'approve'}),kind==='exit'?1:0);}});
      if(kind==='budget')f.b.reservation.tokens=20000;if(kind==='primitive')f.b.enforceable=false;if(kind==='model')f.b.model='wrong-model';if(kind==='pricing')f.b.pricingKnown=false;if(kind==='observe')f.input.snapshot.mode='observe';
      if(kind==='notification-off')f.a.notification.authorized=false;
      if(kind==='context'){const s=f.input.snapshot.sources.find(x=>x.role==='gate')!;s.status='truncated';f.input.proposal.snapshotHash=supervisorHash(f.input.snapshot);const{id,...body}=f.input.proposal;f.input.proposal.id=proposalIdentity(body);
        // Cannot replace retained exact source identity without a new host incident.
      }
      const result=await reviewGateProposal({...f.options,signal:abort.signal});
      assert.notEqual(result.state,'review-approved',kind);
      if(!['observe','context'].includes(kind)) {assert.equal(result.state,'human-required',kind);assert.equal(Object.keys(f.state().humans).length,1);assert.equal(Object.values(f.state().humans)[0].stop,'required');}
      if(['cleanup','accounting'].includes(kind)) {
        assert.equal(Object.values(f.state().reservations)[0].state,'ambiguous');
        assert.equal(exportEvents(f.stateDir).events.find(e => e.to === 'review-complete')!.supervisor!.usage,null);
      }
      if(['budget','primitive','model','pricing','context','observe'].includes(kind))assert.equal(f.launches(),0);
      if(kind==='notification-off')assert.equal(f.posts(),0);
      const prior=f.state().charged;await reviewGateProposal(f.options);assert.deepEqual(f.state().charged,prior,kind);assert.deepEqual(f.state().intents,{});
    }
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('actual new local processes use frozen stdin and isolated cwd/home with no prior reviewer session',async()=>{
  const home=mkdtempSync(join(tmpdir(),'factory-review-process-'));const pids:number[]=[],identities:string[]=[];
  try{
    for(const name of ['first','second']){
      const f=setup(home,name);
      f.b.start=(cmd,argv,o)=>{
        assert.equal(cmd,'pi');assert.ok(argv.includes('--no-session'));assert.ok(argv.includes('--no-tools'));
        const x=JSON.parse(o.input.slice(o.input.lastIndexOf('\n\n{')+2));identities.push(x.identity.reviewer);
        const child=spawn(process.execPath,['-e',`const fs=require('fs');if(fs.readdirSync(process.cwd()).length)process.exit(9);let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const x=JSON.parse(input.slice(input.lastIndexOf('\\n\\n{')+2));process.stdout.write(JSON.stringify({version:1,inputHash:x.inputHash,proposalId:x.proposalId,...x.identity,disposition:'deny',reason:'Original risk requires operator decision'}));});`,'--',...argv],{cwd:o.cwd,env:o.env,stdio:['pipe','pipe','pipe']});
        pids.push(child.pid!);child.stdin.end(o.input);return child;
      };
      f.b.terminate=async()=>true;
      assert.equal((await reviewGateProposal(f.options)).state,'human-required');assert.equal(f.posts(),1);
      const r=Object.values(f.state().reviews)[0];assert.equal(r.disposition,'deny');
      const dir=join(f.stateDir,'supervisor',supervisorHash(f.input.snapshot.project.root),supervisorHash(r.invocationId));
      assert.equal(JSON.parse(readFileSync(join(dir,'process.json'),'utf8')).pid,pids.at(-1));
      assert.equal(JSON.parse(readFileSync(join(dir,'input.json'),'utf8')).input.snapshot.sources.length,8);
    }
    assert.notEqual(pids[0],pids[1]);assert.notEqual(identities[0],identities[1]);
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('actual tracker API command construction accepts only successful exact comment receipts',()=>{
  const {input}=reviewFixture(),project=input.snapshot.project,requests:any[]=[];
  const run:any=(command:string,args:string[],options:any)=>{requests.push({command,args,options});const posted=options.input?JSON.parse(options.input).body:'managed';
    const data={id:7,body:posted,html_url:'https://github.com/owner/repo/issues/236#issuecomment-7'};
    return{status:0,stdout:command==='gh-axi'?`api_response:\n  body: ${Buffer.from(JSON.stringify(options.input?data:[data])).toString('base64')}\n  truncated: false\n`:JSON.stringify(options.input?data:[data])};};
  const adapter=trackerNotificationAdapter(run);assert.equal(adapter.create(project,236,'managed').id,'7');assert.equal(adapter.list(project,236).length,1);
  assert.equal(requests[0].command,'gh-axi');assert.ok(requests[0].args.includes('--input'));assert.ok(requests[0].args.includes('@base64'));assert.ok(requests[0].args.includes('--full'));
  const gitlab={...project,tracker:{kind:'gitlab' as const,host:'git.example.test',project:'group/sub/repo'}};
  assert.equal(adapter.create(gitlab,8,'managed').url,'https://git.example.test/group/sub/repo/-/issues/8#note_7');assert.equal(requests.at(-1).command,'glab');assert.ok(requests.at(-1).args.includes('projects/group%2Fsub%2Frepo/issues/8/notes'));
  for(const response of [{status:1,stdout:'{}'},{status:0,stdout:'{}'},{status:0,stdout:'api_response:\n  body: broken\n  truncated: true\n'}])assert.throws(()=>trackerNotificationAdapter((()=>response)as any).create(project,236,'managed'));
});
test('legacy audit-only approvals and changed retained originals never become reusable authority',async()=>{
  const home=mkdtempSync(join(tmpdir(),'factory-review-legacy-'));
  try {
    const f=setup(home,'legacy');assert.equal((await reviewGateProposal(f.options)).state,'review-approved');
    const s=f.state();delete s.reviewCompletions;
    const reservation=Object.values(s.reservations)[0];reservation.state='active';reservation.actual=null;
    writeFileSync(supervisorFile(f.stateDir),JSON.stringify({version:1,projects:{[supervisorHash(s.project.root)]:s}}));
    assert.equal((await reviewGateProposal({...f.options,boundary:undefined})).state,'held');assert.equal(f.launches(),1);
    const x=setup(home,'originals');await reviewGateProposal(x.options);const audit=Object.values(x.state().reviewCompletions!)[0];
    const retained=JSON.parse(readFileSync(audit.inputRef,'utf8'));retained.input.snapshot.material.tip='d'.repeat(40);writeFileSync(audit.inputRef,JSON.stringify(retained));
    assert.equal((await reviewGateProposal(x.options)).state,'held');assert.equal(x.launches(),1);
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('audited A to B to C revision chain permits only exact successor, fresh diagnosis/review and never refunds',async()=>{
  const home=mkdtempSync(join(tmpdir(),'factory-review-revision-'));
  try {
    const f=setup(home,'chain');f.behavior(x=>f.complete(JSON.stringify({...f.decision(x),disposition:'deny'})));
    await reviewGateProposal(f.options);
    let diagnosisCharges=0;
    for(const letter of ['c','d']){
      const h=Object.values(f.state().humans).find(h=>!f.state().resolutions?.[h.incidentId])!;
      const next=structuredClone(f.a.input);next.snapshot.material.tip=letter.repeat(40);next.proposal.change.after+=letter;
      const facts={...f.state().incidents[h.incidentId].facts,failure:letter.repeat(64)};
      next.proposal.incidentId=incidentIdentity(h.project,facts);next.proposal.snapshotHash=supervisorHash(next.snapshot);const{id,...body}=next.proposal;next.proposal.id=proposalIdentity(body);
      const charges=f.state().charged;
      resolveSupervisorRequest({stateDir:f.stateDir,project:h.project,incidentId:h.incidentId,requestId:h.id,proposalId:h.proposalId,actor:'uid:1:operator',reason:'Permit exact material successor only',nextProposalId:next.proposal.id,now:()=>Date.parse(AT)});
      assert.equal(supervisorHumanHold(f.state()),false);assert.equal(supervisorRevisionHold(f.state(),next.proposal.id),false);assert.equal(supervisorRevisionHold(f.state(),'f'.repeat(64)),true);
      assert.deepEqual(f.state().charged,charges);
      let child:ChildProcess;
      const auth={...reviewFixture(h.project.root).authorization,snapshot:next.snapshot,facts};
      const boundary={model:modelForRole('openai','supervisor').model,reservation:{tokens:100,cost:100},pricingKnown:true,accountingKnown:true,enforceable:true,
        start(_cmd:any,_argv:any,o:any){const x=JSON.parse(o.input.slice(o.input.lastIndexOf('\n\n{')+2));
          child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),pid:98989})as unknown as ChildProcess;
          queueMicrotask(()=>{child.stdout!.emit('data',Buffer.from(JSON.stringify({version:1,incidentId:x.incidentId,basisHash:x.basisHash,classification:'expectation',rationale:'Exact owner-authorized revised evidence mechanism',alternatives:['Preserve original'],action:{kind:'gate-change',proposal:next.proposal}})));child.emit('exit',0);child.emit('close',0);});return child;},async terminate(){return true;},usage(){return{tokens:10,cost:10};}};
      const diagnosed=await diagnoseProject({stateDir:f.stateDir,current:()=>auth,boundary,invocationId:`revision-diagnosis-${letter}`,fence:`revision-fence-${letter}`,now:()=>Date.parse(AT),timer:()=>()=>{}});
      assert.equal(diagnosed.state,'proposed');diagnosisCharges+=100;
      f.a.input=next;
      assert.equal((await reviewGateProposal(f.options)).state,'human-required');assert.equal(Object.values(f.state().humans).filter(h=>!f.state().resolutions?.[h.incidentId]).length,1);
      assert.equal(f.state().charged.diagnosis.tokens,diagnosisCharges);assert.equal(f.state().charged.review.tokens,diagnosisCharges+100);
    }
    assert.equal(f.launches(),3);assert.equal(Object.values(f.state().incidents).filter(m=>m.denied).length,3);
  }finally{rmSync(home,{recursive:true,force:true});}
});
