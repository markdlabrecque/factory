// Cheapest policy refusals plus one disposable Git/filesystem/reviewer/analysis/verifier boundary; no live agents or tracker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyReviewedGate, gateApplyHold, gateInstructionSource, gateScopeHold } from '../src/supervisor-gate-apply.mts';
import type { GateAuthorization, GateOptions, GateConsumption } from '../src/supervisor-gate-apply.mts';
import { reviewGateProposal } from '../src/supervisor-review.mts';
import type { ReviewBoundary } from '../src/supervisor-review.mts';
import { commitSupervisor, emptySupervisor, incidentIdentity, readSupervisor, transitionSupervisor } from '../src/supervisor-state.mts';
import { proposalIdentity, sourceHash, supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { modelForRole } from '../../orchestrator/model-policy.mts';
import { recordIntent, canonicalWorktree } from '../../orchestrator/ownership.mts';
import { loadExecutionContext } from '../../orchestrator/context.mts';
import { prerequisiteHold, runVerifier, postAndDeliver } from '../../orchestrator/handoff.mts';
import type { Host } from '../../orchestrator/handoff.mts';
import { createProof, readProof } from '../../orchestrator/verification.mts';
import { fixtureProvenance, writeVerification } from '../../orchestrator/fixtures/verification.mts';
import { collectSupervisorTicketInput } from '../src/supervisor-facts.mts';
import { factoryToml } from './config-fixture.mts';
import { bindExecution } from './execution-fixture.mts';
import { reviewFixture, AT } from './supervisor-fixture.mts';
const before='Use `npm run needs-network` to produce command evidence.\n';
const after='Use `node --test unit.test.mjs` for the equivalent offline command evidence.\n';
function approval() {
  const {authorization,input}=reviewFixture();
  const a:GateAuthorization={...authorization,input,proposer:'diagnosis',notification:{mode:'act',authorized:false},pilotAuthorized:true,fence:input.snapshot.material.admissionGeneration,
    workspace:'/fixture/project/.factory/worktrees/236-fix',branch:'236-fix',exclusive:true,runtimeRoot:'/fixture/runtime'};
  let s=emptySupervisor(input.snapshot.project);const owner={pid:123,start:'original-owner'};
  const event=(e:any)=>{s=transitionSupervisor(s,{id:`event-${s.revision}`,at:AT,...e},{ownerState:()=> 'alive'});};
  event({kind:'control',mode:'act',actor:'offline-unit-operator',pilot:true});
  event({kind:'observe',facts:authorization.facts,snapshotHash:supervisorHash(input.snapshot),reason:'Gate failure'});
  event({kind:'proposal',proposal:input.proposal});
  event({kind:'reserve',limits:{project:{tokens:1000,cost:1000},shared:{tokens:2000,cost:2000},capacity:1,reviewCalls:10,reviewTimeoutMs:30000},reservation:{id:'review-call',incidentId:input.proposal.incidentId,kind:'review',owner,fence:'review-fence',at:AT,deadline:'2026-11-17T12:00:30.000Z',reserved:{tokens:100,cost:100},actual:null,state:'active',reviewId:null}});
  event({kind:'review-complete',review:{version:1,id:'review',inputHash:supervisorHash(input),proposalId:input.proposal.id,invocationId:'review-call',reviewer:'independent',model:modelForRole(a.family,'gateReview').model,startedAt:AT,completedAt:AT,disposition:'approve',reason:'Exact equivalent offline evidence'},
    reservationId:'review-call',fence:'review-fence',owner,actual:{tokens:20,cost:20},processConfirmed:true,request:null,provenance:{inputRef:'/host/input.json',policy:input.snapshot.material.policy,proposer:a.proposer}});
  return {a,s};
}
test('unit refusal matrix: only exact current independent host completion and current scoped action authorization are admissible',()=>{
  const valid=approval();assert.equal(gateApplyHold(valid.a,valid.s,AT),undefined);
  const cases:{name:string;change:(a:GateAuthorization,s:typeof valid.s)=>void}[]=[
    {name:'no durable operator authorization',change:(_,s)=>{delete s.control;}},
    {name:'durable observe overrides stale callback',change:(_,s)=>{s.control!.mode='observe';}},
    {name:'durable stop overrides stale callback',change:(_,s)=>{s.control!.mode='stopped';}},
    {name:'absent durable pilot',change:(_,s)=>{s.control!.pilot=false;}},
    {name:'absent approval',change:(_,s)=>{s.reviews={};s.reviewCompletions={};}},
    {name:'legacy audit-only approval',change:(_,s)=>{s.reviewCompletions={};}},
    {name:'denied',change:(_,s)=>{s.incidents[valid.a.input.proposal.incidentId].denied=true;}},
    {name:'inconclusive',change:(_,s)=>{Object.values(s.reviews)[0].disposition='inconclusive';}},
    {name:'stale input',change:a=>{a.input.snapshot.material.ticketInput='c'.repeat(64);}},
    {name:'changed proposal',change:a=>{a.input.proposal.change.after='weaken evidence';}},
    {name:'project mismatch',change:(_,s)=>{s.project.root='/another/project';}},
    {name:'paused',change:a=>{a.paused=true;}},
    {name:'unknown pilot',change:a=>{a.pilotAuthorized=undefined as any;}},
    {name:'observe',change:a=>{a.input.snapshot.mode='observe';}},
    {name:'global off',change:a=>{a.globalAllowed=false;}},
    {name:'lost fence',change:a=>{a.fence='late-owner';}},
    {name:'unknown ownership',change:a=>{a.exclusive=false;}},
    {name:'expired',change:a=>{a.input.proposal.change.expiresAt=AT;}},
    {name:'unsafe path',change:a=>{a.input.proposal.change.path='../runtime/prompt.verify.md';}},
    {name:'unsupported effect',change:a=>{a.input.proposal.change.category='unknown' as any;}},
    {name:'Factory-wide',change:a=>{a.input.proposal.change.category='factory-policy';}},
    {name:'superseded',change:(_,s)=>{s.incidents[valid.a.input.proposal.incidentId].superseded=true;}},
    {name:'unknown accounting',change:(_,s)=>{Object.values(s.reservations)[0].actual=null;}},
  ];
  for(const c of cases){const a=structuredClone(valid.a),s=structuredClone(valid.s);c.change(a,s);assert.ok(gateApplyHold(a,s,AT),c.name);}
});

test('disposable public source path: exact approved local guidance, immutable intent artifact, crash observation, dirty preservation and NEW analysis/independent proof',async()=>{
  const home=mkdtempSync(join(tmpdir(),'factory-gate-apply-')),savedEnv={...process.env},savedCwd=process.cwd();
  const git=(root:string,...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    const make=async(name:string,change?: (input:ReturnType<typeof reviewFixture>['input'])=>void)=>{
      const root=join(home,name),stateDir=join(home,`${name}-state`);mkdirSync(join(root,'.factory'),{recursive:true});mkdirSync(stateDir,{mode:0o700});
      writeFileSync(join(root,'.factory/factory.toml'),factoryToml('owner/repo')+`\n[instructions]\nverification = ["VERIFY.md", "OTHER.md"]\n[supervisor]\nenabled = true\nmax_tokens = 10000\nmax_cost_usd = 2\nmax_calls = 10\n[supervisor.diagnosis]\nmax_tokens = 10000\nmax_cost_usd = 2\nmax_calls = 10\ntimeout_seconds = 30\n[supervisor.review]\nmax_tokens = 10000\nmax_cost_usd = 2\nmax_calls = 10\ntimeout_seconds = 30\n`);
      writeFileSync(join(root,'VERIFY.md'),before);writeFileSync(join(root,'OTHER.md'),'Independent verification remains mandatory.\n');writeFileSync(join(root,'product.txt'),'baseline\n');
      writeFileSync(join(root,'unit.test.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('local acceptance evidence',()=>assert.equal(readFileSync('product.txt','utf8'),'baseline\\n'));\n");
      git(root,'init','-b','develop');git(root,'config','user.email','fixture@example.test');git(root,'config','user.name','Fixture');git(root,'config','core.hooksPath',join(home,'no-hooks'));git(root,'add','.');git(root,'commit','-qm','fixture baseline');
      const branch='236-fix',workspace=canonicalWorktree(root,branch);git(root,'worktree','add','-b',branch,workspace);
      const baseline=git(root,'rev-parse','HEAD');
      const runtime=bindExecution(root,{...savedEnv,SANDCASTLE_STATE_DIR:stateDir},{overlays:false});
      const baseContext=await loadExecutionContext({env:runtime.env,cwd:root,moduleRoot:runtime.directory});
      const {authorization,input}=reviewFixture(root),m=input.snapshot.material;
      const ticket={iid:236,title:'Verify corrected command',description:'Model tier: mid\nRequire equivalent offline evidence.',state:'open',labels:[]};
      const collected=collectSupervisorTicketInput({identity:input.snapshot.project.tracker,ticket:()=>({value:{...ticket,url:'https://github.com/owner/repo/issues/236'},bytes:200}),parentOf:()=>({value:null,bytes:4}),notes:()=>({value:{notes:[],nextPage:null},bytes:2})},236),frozen=collected.input;
      input.snapshot.sources=[...input.snapshot.sources.filter(s=>!['child','parent','human-planning'].includes(s.role)),...collected.sources];
      Object.assign(m,{baseline,tip:baseline,ticketInput:frozen.hash,runtime:runtime.id,dependencies:runtime.manifest.dependencies,policy:baseContext.policyIdentity,settings:sourceHash(JSON.stringify(baseContext.identity.settings))});
      input.proposal.change.path='VERIFY.md';input.proposal.change.before=before;input.proposal.change.after=after;
      for(const path of ['VERIFY.md','OTHER.md'])input.snapshot.sources.push({role:path==='VERIFY.md'?'gate':'guidelines',locator:join(root,path),status:'complete',text:readFileSync(join(root,path),'utf8'),sha256:sourceHash(readFileSync(join(root,path),'utf8'))});
      change?.(input);
      input.proposal.incidentId=incidentIdentity(input.snapshot.project,authorization.facts);input.proposal.snapshotHash=supervisorHash(input.snapshot);
      const {id,...body}=input.proposal;input.proposal.id=proposalIdentity(body);
      const a:GateAuthorization={...authorization,input,policy:baseContext.config.supervisor,proposer:'independent-diagnosis',notification:{mode:'act',authorized:false},pilotAuthorized:true,fence:m.admissionGeneration,workspace,branch,exclusive:true,runtimeRoot:runtime.directory};
      const commit=(e:any)=>{const s=readSupervisor(stateDir,input.snapshot.project);return commitSupervisor(stateDir,s.project,s.revision,{at:AT,...e});};
      commit({id:'operator-act',kind:'control',mode:'act',actor:'offline-fixture-operator',pilot:true});
      commit({id:'observe',kind:'observe',facts:authorization.facts,snapshotHash:supervisorHash(input.snapshot),reason:'Equivalent offline evidence needed'});commit({id:'proposal',kind:'proposal',proposal:input.proposal});
      recordIntent(stateDir,{root,tracker:input.snapshot.project.tracker,ticket:'236',branch,base:'develop',runId:m.runId,branchToCreate:false,worktreeToCreate:false,at:AT,branchSha:baseline,worktreeAt:AT,implementationBaseSha:baseline});
      let reviews=0;
      const boundary:ReviewBoundary={model:modelForRole(a.family,'gateReview').model,reservation:{tokens:100,cost:100},pricingKnown:true,accountingKnown:true,enforceable:true,
        start(_command,argv,options){reviews++;assert.ok(argv.includes('--no-tools'));assert.ok(argv.includes('--no-session'));
          const envelope=JSON.parse(options.input.slice(options.input.lastIndexOf('\n\n{')+2));assert.deepEqual(envelope.input,input);
          const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),pid:99999}) as unknown as ChildProcess;
          queueMicrotask(()=>{child.stdout!.emit('data',Buffer.from(JSON.stringify({version:1,inputHash:envelope.inputHash,proposalId:envelope.proposalId,...envelope.identity,disposition:'approve',reason:'Exact equivalent offline command; original constraints remain unchanged'})));child.emit('exit',0);child.emit('close',0);});return child;},async terminate(){return true;},usage(){return {tokens:20,cost:20};}};
      const options:GateOptions={stateDir,current:()=>structuredClone(a),now:()=>Date.parse(AT)};
      assert.equal((await reviewGateProposal({...options,boundary,timer:()=>()=>{}})).state,input.proposal.change.category==='factory-policy'?'human-required':'review-approved');
      return {root,stateDir,a,options,runtime,baseContext,workspace,baseline,ticket,frozen,reviews:()=>reviews,commit};
    };
    const f=await make('success'),p=f.a.input.proposal;
    writeFileSync(join(f.root,'dirty-root.txt'),'host saved work');writeFileSync(join(f.workspace,'dirty.txt'),'saved ticket edits');
    git(f.root,'branch','999-other-run');const other=git(f.root,'rev-parse','999-other-run');
    const statusRoot=git(f.root,'status','--porcelain'),statusWork=git(f.workspace,'status','--porcelain'),index=readFileSync(join(f.root,'.git/index'));
    const oldEvidence=join(home,'old-fail');mkdirSync(oldEvidence);writeFileSync(join(oldEvidence,'verdict.md'),'VERDICT: FAIL\nHistorical failure must not change');writeVerification(oldEvidence,'FAIL');const oldBytes=readFileSync(join(oldEvidence,'verification.json'));
    const oldIdentity={project:'owner/repo',ticket:'236',executionId:p.change.owner.runId,branch:f.a.branch,base:'develop',baseline:f.baseline,tip:f.baseline,requirementsHash:f.a.input.snapshot.material.ticketInput};
    const oldProof=createProof(f.stateDir,oldEvidence,oldIdentity,{...fixtureProvenance,settings:{execution:f.baseContext.identity}});
    const oldPassEvidence=join(home,'old-pass');mkdirSync(oldPassEvidence);writeFileSync(join(oldPassEvidence,'verdict.md'),'VERDICT: PASS\nOld context');writeVerification(oldPassEvidence);
    const oldPass=createProof(f.stateDir,oldPassEvidence,oldIdentity,{...fixtureProvenance,settings:{execution:f.baseContext.identity}});
    const charged=structuredClone(readSupervisor(f.stateDir,p.project).charged);
    const out=await applyReviewedGate(f.options);assert.equal(out.state,'applied',JSON.stringify(out));if(out.state!=='applied')return;
    assert.equal(f.reviews(),1);assert.equal((await applyReviewedGate(f.options)).state,'observed-applied');assert.equal(f.reviews(),1);
    assert.equal(readFileSync(join(f.root,'VERIFY.md'),'utf8'),before);assert.equal(readFileSync(join(f.workspace,'VERIFY.md'),'utf8'),before);
    assert.equal(git(f.root,'status','--porcelain'),statusRoot);assert.equal(git(f.workspace,'status','--porcelain'),statusWork);assert.deepEqual(readFileSync(join(f.root,'.git/index')),index);assert.equal(git(f.root,'rev-parse','999-other-run'),other);
    assert.ok(gateScopeHold(f.stateDir,p.project,236,p.change.owner.runId));assert.equal(gateScopeHold(f.stateDir,p.project,999,'other'),undefined);
    assert.throws(()=>f.baseContext.assertScope(236,p.change.owner.runId),/Scoped gate/);
    const forbidden=()=>{throw Error('stale proof must not publish/push/deliver');};
    const staleHost:Host={setStage(){},readRuns:()=>[],live:()=>false,git:forbidden,gitStatus:forbidden,tracker:{postVerification:forbidden,openMrBranches:forbidden,deliver:forbidden}};
    const staleDelivery=await postAndDeliver({iid:'236',project:'owner/repo',identity:oldIdentity,proofId:oldPass.id,state:f.stateDir,recheck:()=>{f.baseContext.assertScope(236,p.change.owner.runId);return undefined;},branch:f.a.branch,base:'develop',baseSha:f.baseline,tip:f.baseline,title:'Old same-SHA proof',evidenceHost:oldPassEvidence,origin:{kind:'implemented'},ciWaitMinutes:1,noCiMinutes:1,autoMerge:false},staleHost);
    assert.equal(staleDelivery.ok,false);assert.match((staleDelivery as {reason:string}).reason,/fresh analysis|Scoped gate/);
    assert.deepEqual(readSupervisor(f.stateDir,p.project).charged,charged);
    const gate:GateConsumption={options:f.options,applicationId:out.applicationId,ticket:236,runId:p.change.owner.runId};
    const corrected=await loadExecutionContext({env:f.runtime.env,cwd:f.root,moduleRoot:f.runtime.directory,gate});
    assert.ok(corrected.additive.verification.text.includes(after.trim()));assert.notEqual(corrected.policyIdentity,f.baseContext.policyIdentity);
    corrected.assertScope(236,p.change.owner.runId);
    const amendedOldProof=await postAndDeliver({iid:'236',project:'owner/repo',identity:oldIdentity,proofId:oldPass.id,state:f.stateDir,
      recheck:()=>{corrected.assertCurrent();corrected.assertScope(236,p.change.owner.runId);return undefined;},branch:f.a.branch,base:'develop',baseSha:f.baseline,tip:f.baseline,title:'Old proof with valid amended context',evidenceHost:oldPassEvidence,origin:{kind:'implemented'},ciWaitMinutes:1,noCiMinutes:1,autoMerge:false},staleHost);
    assert.equal(amendedOldProof.ok,false);assert.match((amendedOldProof as {reason:string}).reason,/proof lacks exact amended execution identity/);
    assert.throws(()=>corrected.assertScope(999,p.change.owner.runId),/scope/);assert.throws(()=>corrected.assertScope(236,'other-run'),/scope/);
    assert.throws(()=>gateInstructionSource({...gate,ticket:999}),/scope/);
    // A changed candidate revokes the frozen context. Saved dirty work is left in place and committed only by this fixture's simulated normal worker.
    git(f.workspace,'add','dirty.txt');git(f.workspace,'commit','-qm','fixture worker candidate');const tip=git(f.workspace,'rev-parse','HEAD');assert.throws(()=>corrected.assertCurrent(),/candidate/);
    const current=await loadExecutionContext({env:f.runtime.env,cwd:f.root,moduleRoot:f.runtime.directory,gate});assert.notEqual(current.policyIdentity,corrected.policyIdentity);
    assert.throws(()=>readProof(f.stateDir,{...oldIdentity,tip},oldProof.id),/tip/);
    // Real public analysis consumer, with a fixture-owned tool-free Pi command boundary; no provider is contacted.
    const bin=join(home,'bin');mkdirSync(bin);const captured=join(home,'analysis-input.txt');
    writeFileSync(join(bin,'pi'),`#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(captured)},fs.readFileSync(0));console.log(JSON.stringify({provides:['offline correction evidence'],requires:[],footprint:['VERIFY.md']}));\n`);chmodSync(join(bin,'pi'),0o755);
    Object.assign(process.env,f.runtime.env,{PATH:bin+':'+savedEnv.PATH});process.chdir(f.root);
    const {analyse}=await import(pathToFileURL(join(f.runtime.directory,'analyze.mts')).href);
    const {ticket,frozen}=f;
    const args={project:'owner/repo',base:'develop',worktree:{path:f.workspace,sha:tip},ticket,input:frozen,notes:[],catalogue:[ticket],manifests:new Map(),keepImplementerBlockers:false,executionContext:current,runId:p.change.owner.runId};
    assert.throws(()=>analyse({...args,executionContext:f.baseContext}),/Scoped gate/);
    assert.throws(()=>analyse({...args,input:{...frozen,hash:'c'.repeat(64)}}),/exact reviewed ticket/);
    assert.throws(()=>analyse({...args,worktree:{path:f.root,sha:tip}}),/owned candidate/);
    const manifest=analyse(args);assert.equal(manifest.policyIdentity,current.policyIdentity);assert.equal(manifest.baseSha,tip);assert.ok(readFileSync(captured,'utf8').includes('Require equivalent offline evidence.'));assert.ok(readFileSync(captured,'utf8').includes(after.trim()));
    assert.ok(prerequisiteHold(236,{manifest:{...manifest,policyIdentity:f.baseContext.policyIdentity},hash:frozen.hash,policyIdentity:current.policyIdentity,dependency:()=> 'satisfied',active:()=>undefined}));
    const evidence=join(home,'fresh-verifier');mkdirSync(evidence);let verifierRan=false;
    const sandbox={worktreePath:f.workspace,async exec(cmd:string){return {stdout:cmd==='git rev-parse HEAD'?tip:cmd==='git status --porcelain'?'':cmd.startsWith('command -v playwright ')?'browser preflight OK\n':''};},async run(spec:any){verifierRan=true;assert.equal(spec.name,'verifier');assert.ok(spec.promptArgs.ADDITIVE_INSTRUCTIONS.includes(after.trim()));writeFileSync(join(evidence,'verdict.md'),'VERDICT: PASS\nIndependent offline verification');writeVerification(evidence);const result=spawnSync(process.execPath,['--test','unit.test.mjs'],{cwd:f.workspace,encoding:'utf8',env:{...savedEnv,NODE_TEST_CONTEXT:undefined}});assert.equal(result.status,0,result.stderr);writeFileSync(join(evidence,'check.txt'),result.stdout);return {commits:[]};}};
    const verifier={iid:'236',evidenceHost:evidence,agent:{role:'independent-verifier'},promptArgs:{TICKET:frozen.text,ADDITIVE_INSTRUCTIONS:current.additive.verification.text},tip,execution:{context:current,runId:p.change.owner.runId,manifest,requirementsHash:frozen.hash,input:frozen}};
    assert.match((await runVerifier(sandbox,{setStage(){}},{...verifier,execution:{...verifier.execution,manifest:{...manifest,policyIdentity:f.baseContext.policyIdentity}}}))!,/fresh exact-candidate/);assert.equal(verifierRan,false);
    assert.match((await runVerifier(sandbox,{setStage(){}},{...verifier,promptArgs:{...verifier.promptArgs,ADDITIVE_INSTRUCTIONS:before}}))!,/exact reviewed input/);assert.equal(verifierRan,false);
    assert.match((await runVerifier(sandbox,{setStage(){}},{...verifier,execution:{...verifier.execution,requirementsHash:'c'.repeat(64),manifest:{...manifest,hash:'c'.repeat(64)}}}))!,/exact reviewed input/);assert.equal(verifierRan,false);
    assert.match((await runVerifier(sandbox,{setStage(){}},{...verifier,evidenceHost:oldEvidence}))!,/fresh evidence/);assert.deepEqual(readFileSync(join(oldEvidence,'verification.json')),oldBytes);
    assert.equal(await runVerifier(sandbox,{setStage(){}},verifier),undefined);assert.equal(verifierRan,true);current.assertCurrent();current.assertScope(236,p.change.owner.runId);
    const identity={...oldIdentity,tip,requirementsHash:frozen.hash},proof=createProof(f.stateDir,evidence,identity,{...fixtureProvenance,settings:{execution:current.identity}});
    assert.equal(readProof(f.stateDir,identity,proof.id).proof.report.verdict,'PASS');assert.notEqual(proof.id,oldProof.id);assert.equal(readProof(f.stateDir,oldIdentity,oldProof.id).proof.report.verdict,'FAIL');
    let delivered='';const host:Host={setStage(){},readRuns:()=>[],live:()=>false,git:()=>tip,gitStatus:()=>({status:0,stdout:''}),tracker:{postVerification(){},openMrBranches:()=>new Set(),async deliver(d){delivered=d.sha;return {url:'https://example.test/offline-pr',merged:false};}}};
    const delivery={iid:'236',project:'owner/repo',identity,proofId:proof.id,state:f.stateDir,recheck:()=>{current.assertCurrent();current.assertScope(236,p.change.owner.runId);return undefined;},branch:f.a.branch,base:'develop',baseSha:f.baseline,tip,title:'Correction',evidenceHost:evidence,origin:{kind:'repaired' as const,attempt:1},ciWaitMinutes:1,noCiMinutes:1,autoMerge:false};
    assert.equal((await postAndDeliver(delivery,host)).verdict,'PASS');assert.equal(delivered,tip);
    // Real current source changes invalidate consumption even when a caller repeats its old authorization snapshot.
    writeFileSync(join(f.root,'OTHER.md'),'Changed applicable guideline\n');assert.throws(()=>current.assertCurrent(),/guideline/);writeFileSync(join(f.root,'OTHER.md'),'Independent verification remains mandatory.\n');
    f.a.paused=true;assert.throws(()=>current.assertCurrent(),/authorization/);f.a.paused=false;
    assert.deepEqual(readFileSync(join(oldEvidence,'verification.json')),oldBytes);
    f.commit({id:'operator-stop-after-proof',kind:'control',mode:'stopped',actor:'offline-fixture-operator',pilot:false});
    assert.throws(()=>current.assertCurrent(),/held/);assert.equal((await applyReviewedGate(f.options)).state,'held');
    assert.equal((await postAndDeliver(delivery,staleHost)).ok,false);
    // Crash after artifact fsync but before journal completion: dead-owner observation, no second publication.
    const crash=await make('crash'),module=new URL('../src/supervisor-gate-apply.mts',import.meta.url).href;
    const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.fsyncSync;let artifact=false;
      const open=fs.openSync;fs.openSync=(p,...args)=>{const fd=open(p,...args);if(String(p).endsWith('/source.md'))artifact=true;return fd;};fs.fsyncSync=(fd)=>{original(fd);if(artifact)process.exit(73);};syncBuiltinESMExports();
      const {applyReviewedGate}=await import(${JSON.stringify(module)});console.log(await applyReviewedGate({stateDir:${JSON.stringify(crash.stateDir)},current:()=>(${JSON.stringify(crash.a)}),now:()=>Date.parse(${JSON.stringify(AT)})}));`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:savedEnv});assert.equal(child.status,73,child.stderr+child.stdout);
    const intent=Object.values(readSupervisor(crash.stateDir,crash.a.input.snapshot.project).intents)[0];assert.equal(intent.outcome,'pending');
    const artifact=join(crash.stateDir,'supervisor',supervisorHash(crash.root),'applications',supervisorHash(intent.intent.id),'source.md'),mtime=statSync(artifact).mtimeMs;
    const observed=await applyReviewedGate(crash.options);assert.equal(observed.state,'observed-applied',JSON.stringify(observed));assert.equal(statSync(artifact).mtimeMs,mtime);assert.equal(readFileSync(artifact,'utf8'),after);
    assert.equal((await applyReviewedGate(crash.options)).state,'observed-applied');assert.equal(statSync(artifact).mtimeMs,mtime);
    // An unknown/partial artifact is never repaired or replayed; all saved work stays intact.
    writeFileSync(artifact,'partial');assert.equal((await applyReviewedGate(crash.options)).state,'held');assert.equal(readFileSync(artifact,'utf8'),'partial');
    assert.equal(readFileSync(join(crash.workspace,'VERIFY.md'),'utf8'),before);
    const partial=await make('partial');
    const partialScript=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync,write=fs.writeSync;let artifactFd;
      fs.openSync=(p,...args)=>{const fd=open(p,...args);if(String(p).endsWith('/source.md'))artifactFd=fd;return fd;};
      fs.writeSync=(fd,data,...args)=>{if(fd===artifactFd){write(fd,String(data).slice(0,7));process.exit(74);}return write(fd,data,...args);};syncBuiltinESMExports();
      const {applyReviewedGate}=await import(${JSON.stringify(module)});await applyReviewedGate({stateDir:${JSON.stringify(partial.stateDir)},current:()=>(${JSON.stringify(partial.a)}),now:()=>Date.parse(${JSON.stringify(AT)})});`;
    const partialChild=spawnSync(process.execPath,['--input-type=module','-e',partialScript],{encoding:'utf8',env:savedEnv});assert.equal(partialChild.status,74,partialChild.stderr);
    const partialIntent=Object.values(readSupervisor(partial.stateDir,partial.a.input.snapshot.project).intents)[0];assert.equal(partialIntent.outcome,'pending');
    const partialArtifact=join(partial.stateDir,'supervisor',supervisorHash(partial.root),'applications',supervisorHash(partialIntent.intent.id),'source.md');
    const partialBytes=readFileSync(partialArtifact);assert.equal((await applyReviewedGate(partial.options)).state,'held');
    assert.equal(Object.values(readSupervisor(partial.stateDir,partial.a.input.snapshot.project).intents)[0].outcome,'unknown');
    assert.equal((await applyReviewedGate(partial.options)).state,'held');assert.deepEqual(readFileSync(partialArtifact),partialBytes);assert.equal(readFileSync(join(partial.workspace,'VERIFY.md'),'utf8'),before);
    const unsupported=await make('unsupported',input=>{input.proposal.change.path='product.txt';input.proposal.change.before='baseline\n';input.proposal.change.after='Do not verify\n';});
    let notices=0;unsupported.a.notification={mode:'act',authorized:true,operatorIssue:236};
    const unsupportedResult=await applyReviewedGate({...unsupported.options,notifications:{list:()=>[],create(project,target,body){notices++;const saved=readSupervisor(unsupported.stateDir,project);assert.equal(Object.values(saved.humans)[0].stop,'required');return {id:'1',url:`https://github.com/owner/repo/issues/${target}#issuecomment-1`,body};}}});
    assert.equal(unsupportedResult.state,'human-required');assert.equal(notices,1);assert.equal(Object.values(readSupervisor(unsupported.stateDir,unsupported.a.input.snapshot.project).humans)[0].delivery.state,'notified');assert.deepEqual(readSupervisor(unsupported.stateDir,unsupported.a.input.snapshot.project).intents,{});assert.equal(readFileSync(join(unsupported.workspace,'product.txt'),'utf8'),'baseline\n');
    const wide=await make('factory-wide',input=>{input.proposal.change.category='factory-policy';});
    assert.equal((await applyReviewedGate(wide.options)).state,'human-required');assert.equal(wide.reviews(),0);assert.equal(Object.values(readSupervisor(wide.stateDir,wide.a.input.snapshot.project).humans)[0].scope.kind,'project');assert.deepEqual(readSupervisor(wide.stateDir,wide.a.input.snapshot.project).intents,{});
  } finally {process.chdir(savedCwd);for(const key of Object.keys(process.env))if(!Object.hasOwn(savedEnv,key))delete process.env[key];Object.assign(process.env,savedEnv);rmSync(home,{recursive:true,force:true});}
});
