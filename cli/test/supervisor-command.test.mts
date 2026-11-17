// Local CLI controls and explicit diagnosis parser/projection/facade units; disposable state, no tracker/provider/agent execution.
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { factoryToml } from './config-fixture.mts';
import { reviewFixture, AT } from './supervisor-fixture.mts';
import { readSupervisor, commitSupervisor, supervisorFile } from '../src/supervisor-state.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { supervisorCommand, parseSupervisorControl, supervisorActRefusal, supervisorProjection, SUPERVISOR_PAGE_SIZE, parseSupervisorDiagnosis, supervisorDiagnose, supervisorDiagnosisProjection, withSupervisorCancellation, retainedRecommendation, retainedAccounting, retainedAdmission } from '../src/commands/supervisor.mts';
import { supervisorFixture } from './supervisor-fixture.mts';
import { emptySupervisor } from '../src/supervisor-state.mts';
import { existsSync } from 'node:fs';
import { keyFor } from '../../board/board.mts';
import { ownerOf } from '../../board/admission.mts';

test('local signals abort only the owner and await its result before signal exit', async () => {
  for (const [signal,code] of [['SIGINT',130],['SIGTERM',143]] as const) {
    const signals=new EventEmitter();let settle!:(n:number)=>void,aborted=false,returned=false;
    const running=withSupervisorCancellation(async owner=>{
      owner.addEventListener('abort',()=>{aborted=true;});
      return await new Promise<number>(resolve=>{settle=resolve;});
    },signals as any).then(exit=>{returned=true;return exit;});
    signals.emit(signal);assert.equal(aborted,true);assert.equal(returned,false);
    settle(2);assert.equal(await running,code);
    assert.equal(signals.listenerCount('SIGINT'),0);assert.equal(signals.listenerCount('SIGTERM'),0);
  }
});

test('diagnosis accepts only an explicit ticket/project and projects no arbitrary worker output', () => {
  assert.equal(parseSupervisorDiagnosis(['7'],{project:'registered',json:true}),7);
  for (const args of [[],['0'],['01'],['#7'],['-1'],['1e2'],['9007199254740992'],['7','8']]) assert.throws(()=>parseSupervisorDiagnosis(args,{project:'registered'}));
  for (const options of [{},{project:''},{project:'registered',pilot:true},{project:'registered',offset:'0'},{project:'registered',model:'arbitrary'},{project:'registered',actor:'operator'}]) assert.throws(()=>parseSupervisorDiagnosis(['7'],options));
  const s=emptySupervisor(reviewFixture('/fixture/project').input.snapshot.project);
  const view=supervisorDiagnosisProjection(s,7,'invocation',{state:'held',reason:'raw stdout prompt token=ghp_never_display'},'run-current');
  assert.equal(view.runId,'run-current'); assert.equal(view.authority,'advice-only'); assert.equal(view.accounting.known,null);
  assert.doesNotMatch(JSON.stringify(view),/raw stdout|ghp_never_display/);
});

test('diagnosis source handler uses genuine held host and component facade only for exit/output permutations', async () => {
  const home=realpathSync(mkdtempSync(join(tmpdir(),'factory-supervisor-diagnose-'))),p=paths(home),root=join(home,'project');
  try {
    mkdirSync(join(root,'.factory'),{recursive:true});writeFileSync(join(root,'.factory/factory.toml'),factoryToml('owner/repo',{kind:'github'}));
    assert.equal(spawnSync('git',['init','-q'],{cwd:root,timeout:15000}).status,0);addProject(p,root);
    const output:string[]=[],backend={status:async()=>{throw Error('backend must not be called before no-run selection');}};
    const services={backend,output:(text:string)=>output.push(text),apiKey:'synthetic-non-secret-key'};
    assert.equal(await supervisorDiagnose(p,['7'],{project:root,json:true},services as any),1);
    assert.match(JSON.parse(output.at(-1)!).reason,/saved execution/);assert.equal(existsSync(supervisorFile(p.state)),false);
    mkdirSync(p.state,{recursive:true});writeFileSync(join(p.state,`${keyFor('7','owner/repo')}.json`),JSON.stringify({project:'owner/repo',iid:'7',stage:'failed',executionId:'current-execution'}));
    let calls=0;
    assert.equal(await supervisorDiagnose(p,['7'],{project:root,json:true},{...services,backend:{status:async()=>{calls++;throw Error('synthetic backend unavailable');}}} as any),1);
    assert.equal(calls,1);assert.equal(existsSync(supervisorFile(p.state)),false);
    for (const [state,code] of [['held',1],['human-required',2],['proposed',0],['reused',0]] as const) {
      let invoked=false;
      const prepare=async (options:any)=>{assert.equal(options.ticket,7);assert.equal(options.project.root,root);assert.equal(options.rollout,undefined);return {invoke:async(key:string,signal:AbortSignal)=>{invoked=true;assert.equal(key,'synthetic-non-secret-key');assert.equal(signal,abort.signal);return {state,reason:'raw provider stderr token=hidden',diagnosticId:'synthetic',decision:{classification:'expectation',rationale:'Wait for exact evidence',alternatives:['Inspect originals'],action:{kind:'wait',expectation:'Exact evidence'}}};}};};
      const abort=new AbortController();
      assert.equal(await supervisorDiagnose(p,['7'],{project:root,json:true},{...services,prepare,signal:abort.signal} as any),code);
      assert.equal(invoked,true);const view=JSON.parse(output.at(-1)!);assert.equal(view.state,state);assert.equal(view.runId,'current-execution');assert.doesNotMatch(output.at(-1)!,/provider stderr|token=hidden|synthetic-non-secret-key/);
    }
  } finally {rmSync(home,{recursive:true,force:true});}
});

test('display redacts nested identity and pages retained collections without hiding aggregate holds or changing storage', () => {
  const {input}=reviewFixture('/fixture/ghp_sensitive_checkout'),s=emptySupervisor(input.snapshot.project);
  for(let i=0;i<300;i++) {
    const id=i.toString(16).padStart(64,'0');
    s.humans[id]={version:1,id:`request-${i}`,project:s.project,scope:{kind:'ticket',ticket:236},incidentId:id,proposalId:input.proposal.id,reason:'authority-uncertain',question:'Choose lawful evidence',evidence:[],nextAction:'Inspect originals',delivery:{state:'pending',attempts:0},stop:'required'};
  }
  const facts={project:s.project,work:[]} as unknown as Parameters<typeof supervisorProjection>[1];
  const before=JSON.stringify(s), seen=new Set<string>();
  for (const offset of [0,128,256]) {
    const view=supervisorProjection(s,facts,null,'Held',offset);
    assert.ok(view.humanRequests.length<=SUPERVISOR_PAGE_SIZE); assert.equal(view.pagination.collections.humanRequests.total,300);
    assert.equal(view.hostDecision.humanRequired,true); assert.doesNotMatch(JSON.stringify(view),/ghp_sensitive_checkout/);
    for (const request of view.humanRequests) seen.add(request.id);
  }
  assert.equal(seen.size,300); assert.equal(JSON.stringify(s),before);
});

test('all retained categories share bounded non-authorizing advice without raw bodies, patches or terminal controls', () => {
  const {input}=reviewFixture(),s=emptySupervisor(input.snapshot.project);
  const hostile='\u001b[31m<img onerror=x> token=ghp_never_public\n'+'z'.repeat(900);
  const actions=[{kind:'wait',expectation:hostile},{kind:'observe',expectation:hostile},
    {kind:'request-repair',ticket:236,runId:'run-current',expectation:hostile},
    {kind:'gate-change',proposal:{...input.proposal,change:{...input.proposal.change,before:'PRIVATE_GATE_BEFORE',after:'PRIVATE_GATE_AFTER'}}},
    {kind:'follow-up-draft',title:hostile,body:'PRIVATE_DRAFT_BODY'},
    {kind:'escalate',question:hostile,nextAction:hostile,factoryWide:true}];
  for (const action of actions) {
    const decision={version:1,incidentId:input.proposal.incidentId,basisHash:'a'.repeat(64),classification:'problem',rationale:hostile,alternatives:[hostile],action} as any;
    const id='b'.repeat(64);s.diagnostics={[id]:{id,reservationId:'call',incidentId:decision.incidentId,basisHash:decision.basisHash,snapshotHash:'c'.repeat(64),fence:'f',startedAt:AT,completedAt:AT,inputRef:'fixture:input',outcome:'proposed',reason:'Retained',stdout:'PRIVATE_STDOUT',stderr:'PRIVATE_STDERR',decision}};
    const terminal=supervisorDiagnosisProjection(s,236,'call',{state:'proposed',diagnosticId:id,decision} as any);
    const passive=supervisorProjection(s,{project:s.project,work:[]} as any,null,null);
    assert.deepEqual(passive.diagnostics[0].recommendation,terminal.recommendation);
    assert.equal(terminal.recommendation!.authority,'advice-only');
    assert.equal(terminal.recommendation!.nextStep.kind,action.kind);
    assert.ok(terminal.recommendation!.rationale.length<=512);
    assert.doesNotMatch(JSON.stringify([terminal,passive]),/PRIVATE_|ghp_never_public|\\u001b|\[31m/);
  }
  assert.equal(retainedRecommendation(null),null);
  assert.equal(retainedAccounting(s,undefined).known,null);
  const r={id:'legacy',actual:{tokens:1,cost:2},reserved:{tokens:10,cost:20}} as any;
  assert.equal(retainedAccounting(s,r).provenance,'legacy-component-reported');
  assert.equal(retainedAccounting(s,r).providerInvoice,false);
  // Projection permutation only: genuine receipt validation/custody remains in the host settlement tests.
  s.advisory={policies:{},workers:{},sends:{},settlements:{[supervisorHash(r.id)]:{} as any}};
  assert.equal(retainedAccounting(s,r).provenance,'provider-usage-derived');
  assert.equal(retainedAccounting(s,r).providerInvoice,false);
  assert.equal(retainedAccounting(s,{...r,actual:null}).actual,null);
  assert.equal(retainedAccounting(s,{...r,actual:null}).provenance,'unknown');
});

test('passive admission reports orphan exclusions before any journal and does not prune dead or unknown owners', () => {
  const dir=mkdtempSync(join(tmpdir(),'retained-exclusions-'));
  try {
    const project=reviewFixture().input.snapshot.project;
    mkdirSync(join(dir,'admission'),{recursive:true});
    const state={version:2,entries:{},claims:{},generations:{},recovery:{},supervisorHolds:Object.fromEntries(Array.from({length:260},(_,i)=>{const id=`hold-${String(i).padStart(3,'0')}`;return [id,{id,project,owner:{pid:2147483647,start:'unknown'},invocationId:`call-${i}`,fence:'fence',pending:[],settled:[]}];}))};
    const file=join(dir,'admission','state.json');writeFileSync(file,JSON.stringify(state));
    const before=readFileSync(file,'utf8');
    const pages=[0,128,256].map(offset=>retainedAdmission(dir,project,offset));
    assert.deepEqual(pages.map(p=>p.total),[260,260,260]);
    assert.equal(pages.reduce((n,p)=>n+p.holds.length,0),260);
    assert.equal(pages[0].after,132);assert.equal(pages[0].holds[0].ownership,'dead');
    assert.equal(readFileSync(file,'utf8'),before);assert.equal(existsSync(supervisorFile(dir)),false);
    writeFileSync(file,'corrupt');assert.equal(retainedAdmission(dir,project).state,'unknown');assert.equal(readFileSync(file,'utf8'),'corrupt');
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('strict operator parser and finite policy gates never turn mode into activation', () => {
  for (const [action, extra] of [['status',[]],['explain',[]],['stop',[]],['mode',['observe']],['mode',['act']]] as [string,string[]][]) assert.ok(parseSupervisorControl(action,extra,{}));
  for (const [action, extra, options] of [['mode',['unknown'],{}],['stop',['all'],{}],['status',[],{pilot:true}],['mode',['observe'],{confirm:true}],['mode',['act'],{json:true}],['status',[],{offset:'-1'}],['status',[],{offset:'NaN'}],['stop',[],{offset:'0'}]] as any[]) assert.throws(() => parseSupervisorControl(action,extra,options));
  const policy = supervisorFixture().policy;
  assert.match(supervisorActRefusal(policy,{},[])!, /pilot/);
  assert.match(supervisorActRefusal({enabled:false},{pilot:true,confirm:true},[])!, /limits/);
  for (const n of [NaN,Infinity,0,-1]) {
    const invalid=structuredClone(policy); invalid.limits!.review.maxCostUsd=n;
    assert.match(supervisorActRefusal(invalid,{pilot:true,confirm:true},[])!, /budget/);
  }
  assert.match(supervisorActRefusal(policy,{pilot:true,confirm:true},['Unknown workflow authority'])!, /workflow/);
  assert.equal(supervisorActRefusal(policy,{pilot:true,confirm:true},[]),null);
});

test('inspection never creates a journal; controls retain holds/charges and stop exposes unavailable cancellation', async () => {
  const home=realpathSync(mkdtempSync(join(tmpdir(),'factory-supervisor-inspection-'))),p=paths(home),root=join(home,'project');
  try {
    mkdirSync(join(root,'.factory'),{recursive:true}); writeFileSync(join(root,'.factory/factory.toml'),factoryToml('owner/repo',{kind:'github'}));
    assert.equal(spawnSync('git',['init','-q'],{cwd:root}).status,0); addProject(p,root);
    const output:string[]=[]; const services={now:()=>Date.parse(AT),output:(s:string)=>output.push(s)};
    for (const command of ['status','explain']) {
      assert.equal(await supervisorCommand(p,command,[],{project:root,json:true},services),0);
      const result=JSON.parse(output.at(-1)!); assert.equal(result.version,1); assert.equal(result.mode,'observe');
      assert.equal(result.hostDecision.actionAuthorized,false); assert.deepEqual(result.owners,[]); assert.equal(existsSync(supervisorFile(p.state)),false);
    }
    await assert.rejects(supervisorCommand(p,'mode',['act'],{project:root,pilot:true,confirm:true},services),/limits/);
    assert.equal(existsSync(supervisorFile(p.state)),false);
    const {authorization,input}=reviewFixture(root),project=input.snapshot.project;
    const commit=(event:any)=>{const s=readSupervisor(p.state,project);return commitSupervisor(p.state,project,s.revision,event);};
    commit({id:'observe',at:AT,kind:'observe',facts:authorization.facts,snapshotHash:supervisorHash(input.snapshot),reason:'Original'});
    commit({id:'proposal',at:AT,kind:'proposal',proposal:input.proposal});
    commit({id:'reserve',at:AT,kind:'reserve',reservation:{id:'owned-diagnosis',incidentId:input.proposal.incidentId,kind:'diagnosis',owner:ownerOf(process.pid),fence:'owned-fence',at:AT,deadline:'2026-11-17T12:01:00.000Z',reserved:{tokens:10,cost:10},actual:null,state:'active',reviewId:null},
      limits:{project:{tokens:100,cost:100},shared:{tokens:100,cost:100},capacity:1,reviewCalls:1,reviewTimeoutMs:60000}});
    const request={version:1,id:'request',project,scope:input.proposal.scope,incidentId:input.proposal.incidentId,proposalId:input.proposal.id,reason:'authority-uncertain',
      question:'token=ghp_do_not_display',evidence:['https://user:password@example.com/evidence?token=hidden'],nextAction:'Inspect original evidence',delivery:{state:'pending',attempts:0},stop:'required'};
    commit({id:'human',at:AT,kind:'human',request});
    const before=readSupervisor(p.state,project);
    writeFileSync(join(root,'.factory/factory.toml'),factoryToml('owner/repo',{kind:'github'})+`
[supervisor]
enabled = true
max_tokens = 1000
max_cost_usd = 1
max_calls = 10
[supervisor.diagnosis]
max_tokens = 100
max_cost_usd = 0.1
max_calls = 2
timeout_seconds = 30
[supervisor.review]
max_tokens = 100
max_cost_usd = 0.1
max_calls = 2
timeout_seconds = 30
`);
    await assert.rejects(supervisorCommand(p,'mode',['act'],{project:root,pilot:true,confirm:true},services),/activation unavailable/);
    assert.equal(await supervisorCommand(p,'mode',['act'],{project:root,pilot:true,confirm:true},{...services,prerequisites:()=>[]}),0);
    assert.equal(readSupervisor(p.state,project).control!.pilot,true);
    assert.equal(await supervisorCommand(p,'mode',['observe'],{project:root},services),0);
    assert.equal(await supervisorCommand(p,'stop',[],{project:root},services),1);
    let cancelled: string[]=[];
    assert.equal(await supervisorCommand(p,'stop',[],{project:root},{...services,cancelOwned:async reservations=>{cancelled=reservations.map(r=>r.id);return true;}}),0);
    assert.deepEqual(cancelled,['owned-diagnosis']);
    const after=readSupervisor(p.state,project); assert.equal(after.control!.mode,'stopped'); assert.deepEqual(after.humans,before.humans); assert.deepEqual(after.charged,before.charged); assert.deepEqual(after.incidents,before.incidents);
    const bytes=readFileSync(supervisorFile(p.state),'utf8');
    await supervisorCommand(p,'explain',[],{project:root,json:true},services);
    assert.equal(readFileSync(supervisorFile(p.state),'utf8'),bytes); assert.doesNotMatch(output.at(-1)!,/ghp_do_not_display|user:password|token=hidden/);
    assert.equal(JSON.parse(output.at(-1)!).hostDecision.humanRequired,true);
    writeFileSync(join(root,'.factory/factory.toml'),readFileSync(join(root,'.factory/factory.toml'),'utf8')+'\n[workflow]\nmode = "project"\ndirectory = ".factory-workflow"\n');
    await assert.rejects(supervisorCommand(p,'mode',['act'],{project:root,pilot:true,confirm:true},{...services,prerequisites:()=>[]}),/workflow/);
    assert.equal(readFileSync(supervisorFile(p.state),'utf8'),bytes);
  } finally {rmSync(home,{recursive:true,force:true});}
});
test('supervisor resolve requires explicit exact local command and records OS actor without granting approval',()=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'factory-supervisor-control-'))),p=paths(home),root=join(home,'project');
  try {
    mkdirSync(join(root,'.factory'),{recursive:true});writeFileSync(join(root,'.factory/factory.toml'),factoryToml('owner/repo',{kind:'github'}));
    const git=spawnSync('git',['init','-q'],{cwd:root});assert.equal(git.status,0);addProject(p,root);
    const {authorization,input}=reviewFixture(root),project=input.snapshot.project;
    const commit=(event:any)=>{const s=readSupervisor(p.state,project);return commitSupervisor(p.state,project,s.revision,event);};
    commit({id:'observe',at:AT,kind:'observe',facts:authorization.facts,snapshotHash:supervisorHash(input.snapshot),reason:'Original dispute'});
    commit({id:'proposal',at:AT,kind:'proposal',proposal:input.proposal});
    const request={version:1 as const,id:'exact-request',project,scope:input.proposal.scope,incidentId:input.proposal.incidentId,proposalId:input.proposal.id,reason:'authority-uncertain' as const,
      question:'Choose lawful next evidence mechanism',evidence:['fixture:gate'],nextAction:'Inspect originals and resolve explicitly',delivery:{state:'pending' as const,attempts:0},stop:'required' as const};
    commit({id:'human',at:AT,kind:'human',request});
    const cli=fileURLToPath(new URL('../bin/factory.mts',import.meta.url));
    const argv=['supervisor','resolve','--project',root,'--incident',request.incidentId,'--request',request.id,'--proposal',request.proposalId,'--reason','Abandon unsafe correction','--abandon'];
    const exec=(args:string[])=>spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...process.env,FACTORY_HOME:home,SANDCASTLE_STATE_DIR:p.state,OPENAI_API_KEY:'synthetic-non-secret-key',USER:'not-the-authenticated-actor'},encoding:'utf8',timeout:15000});
    const before=readFileSync(supervisorFile(p.state),'utf8');
    for (const suffix of [['7'],['0','--project',root],['7','--project',root,'--pilot'],['7','--project',root,'--model','arbitrary']]) assert.equal(exec(['supervisor','diagnose',...suffix]).status,1);
    const diagnosis=exec(['supervisor','diagnose','7','--project',root,'--json']);assert.equal(diagnosis.status,1,diagnosis.stderr);assert.equal(JSON.parse(diagnosis.stdout).state,'held');
    const inspected=exec(['supervisor','status','--json','--project',root]);assert.equal(inspected.status,0,inspected.stderr);assert.equal(JSON.parse(inspected.stdout).mode,'observe');
    assert.equal(exec(['supervisor','status','--abandon','--project',root]).status,1);
    assert.equal(exec(['supervisor','mode','act','--pilot','--confirm','--project',root]).status,1);
    assert.equal(readFileSync(supervisorFile(p.state),'utf8'),before);
    assert.equal(exec(argv).status,1);assert.equal(readFileSync(supervisorFile(p.state),'utf8'),before);
    const result=exec([...argv,'--confirm']);assert.equal(result.status,0,result.stderr);
    const s=readSupervisor(p.state,project),resolution=s.resolutions![request.incidentId];
    assert.equal(resolution.actor,`uid:${userInfo().uid}:${userInfo().username}`);assert.equal(resolution.nextProposalId,null);assert.equal(s.humans[request.incidentId].delivery.state,'pending');
    assert.deepEqual(s.reviews,{});assert.deepEqual(s.intents,{});assert.deepEqual(s.charged.review,{tokens:0,cost:0});assert.equal(exec([...argv,'--confirm']).status,1);
  }finally{rmSync(home,{recursive:true,force:true});}
});
