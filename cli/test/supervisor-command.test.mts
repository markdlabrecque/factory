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
    const before=readFileSync(supervisorFile(p.state),'utf8');assert.equal(exec(argv).status,1);assert.equal(readFileSync(supervisorFile(p.state),'utf8'),before);
    const result=exec([...argv,'--confirm']);assert.equal(result.status,0,result.stderr);
    const s=readSupervisor(p.state,project),resolution=s.resolutions![request.incidentId];
    assert.equal(resolution.actor,`uid:${userInfo().uid}:${userInfo().username}`);assert.equal(resolution.nextProposalId,null);assert.equal(s.humans[request.incidentId].delivery.state,'pending');
    assert.deepEqual(s.reviews,{});assert.deepEqual(s.intents,{});assert.deepEqual(s.charged.review,{tokens:0,cost:0});assert.equal(exec([...argv,'--confirm']).status,1);
  }finally{rmSync(home,{recursive:true,force:true});}
});
