// One local CLI control boundary: disposable registry/TOML/journal, OS actor, no tracker or agent execution.
import { test } from 'node:test';
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
import { supervisorCommand, parseSupervisorControl, supervisorActRefusal, supervisorProjection, SUPERVISOR_PAGE_SIZE } from '../src/commands/supervisor.mts';
import { supervisorFixture } from './supervisor-fixture.mts';
import { emptySupervisor } from '../src/supervisor-state.mts';
import { existsSync } from 'node:fs';
import { ownerOf } from '../../board/admission.mts';

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
    const exec=(args:string[])=>spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...process.env,FACTORY_HOME:home,SANDCASTLE_STATE_DIR:p.state,USER:'not-the-authenticated-actor'},encoding:'utf8'});
    const before=readFileSync(supervisorFile(p.state),'utf8');
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
