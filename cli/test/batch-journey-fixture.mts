// Copied CLI, installed standard runtime and real disposable Git; only tracker, Pi and container commands are fixture-owned.
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installBatchFixture } from '../../orchestrator/fixtures/batch-review.mts';
import { home } from './schedule-helpers.mts';
import { install } from './runtime-fixture.mts';
import { Fake, FakeSchedule } from '../src/platform/fake.mts';
import { addProject } from '../src/projects.mts';
import { factoryToml } from './config-fixture.mts';

export async function batchJourney(t:TestContext) {
  const {p}=home(t,'hj-'), root=join(p.home,'project'), server=join(p.home,'origin.git'), bin=join(p.home,'bin'), facts=join(p.home,'issues');
  mkdirSync(join(root,'.factory'),{recursive:true});mkdirSync(bin);
  writeFileSync(facts,JSON.stringify({1:[],2:[],3:[],4:[],5:[],6:[],7:['ready-for-agent'],8:[]}));
  const attempts:number[]=[], reviews=new Map<string,{base:string;roles:string[]}>();
  let advance:((head:string)=>void)|undefined, staleCandidate:string|undefined, replacedHead:string|undefined, next:string|undefined;
  const argv=['node','check.cjs'], agents=await installBatchFixture(p.home,argv,(role,prompt,context)=>{
    const n=Number(/Make EDIT_(\d+)/.exec(prompt)?.[1]);assert(n);if(role==='code')attempts.push(n);
    const pins=JSON.parse(prompt.slice(prompt.indexOf('\n{')+1)), review=reviews.get(pins.candidate)??{base:pins.base,roles:[]};
    assert.equal(pins.base,review.base);review.roles.push(role);reviews.set(pins.candidate,review);
    if(role==='test'){assert.equal(pins.tests.stdout.trim(),pins.candidate);assert.match(JSON.stringify(context),/member-/);}
    else {
      assert.equal(pins.tests,undefined);assert.match(String(context),new RegExp(`member-${n}\\b`));
      if(n===1&&advance){const move=advance;advance=undefined;staleCandidate=pins.candidate;move(pins.base);}
    }
    return {verdict:n===3?'reject':'approve',reason:n===3?'Requirement still missing':'Meets the requirement'};
  },`const n=/Make EDIT_(\\d+)/.exec(prompt)[1],{feedback}=JSON.parse(prompt.split('Host proposal input:\\n').at(-1));console.log(JSON.stringify({edits:[{path:'member-'+n,content:feedback?.attempt??'initial'}]}));`);t.after(agents.close);
  const stub=(name:string,script:string)=>writeFileSync(join(bin,name),script,{mode:0o700});
  stub('ssh',`#!/bin/sh\n[ "$1" = git@fixture.invalid ] || exit 92\ncase "$2" in "git-upload-pack 'org/project.git'") exec /usr/bin/git upload-pack "$SERVER";; "git-receive-pack 'org/project.git'") exec /usr/bin/git receive-pack "$SERVER";; *) exit 93;; esac`);
  stub('gh',`#!${process.execPath}\n`+readFileSync(new URL('./fixtures/batch-journey-tracker.cjs',import.meta.url),'utf8'));
  stub('docker',`#!/bin/sh\ncase "$1:$2:$*" in create:*|start:*|rm:*|container:inspect:*factory-batch-*|container:ls:*factory-batch-*|container:ls:*id=*) exec /usr/bin/env -i PATH="$PATH" '${agents.bin}/docker' "$@";; container:inspect:*) case "$3" in ${'b'.repeat(64)}|factory-preflight-*) ;; *) exec /usr/bin/env -i PATH="$PATH" '${agents.bin}/docker' "$@";; esac;; esac\ncase "$1:$4" in image:'{{.Id}}') echo sha256:${'a'.repeat(64)};; *) exec '${process.execPath}' --input-type=module -e 'import {capabilityDocker} from "${new URL('../../orchestrator/fixtures/capability-docker.mjs',import.meta.url).href}";const r=capabilityDocker(process.argv.slice(1),${JSON.stringify(bin)});if(r===undefined)process.exit(94);console.log(r)' -- "$@";; esac`);
  symlinkSync('/usr/bin/git',join(bin,'git'));symlinkSync(process.execPath,join(bin,'node'));
  const env={HOME:p.home,FACTORY_HOME:p.home,SANDCASTLE_STATE_DIR:p.state,PATH:`${bin}:${agents.bin}`,ISSUES:facts,SERVER:server,GIT_SSH:join(bin,'ssh'),GIT_SSH_VARIANT:'simple',GIT_ALLOW_PROTOCOL:'ssh:file',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',OPENAI_API_KEY:'fixture-only'};
  const git=(dir:string,...args:string[])=>execFileSync('/usr/bin/git',['-C',dir,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=f@invalid',...args],{env,encoding:'utf8',stdio:'pipe'}).trim();
  git(root,'init','-b','main');writeFileSync(join(root,'check.cjs'),`const fs=require('node:fs');require('node:assert/strict').ok(fs.readdirSync('.').some(p=>/^member-/.test(p)));console.log(require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());`);writeFileSync(join(root,'large.txt'),'LARGE_IRRELEVANT '.repeat(70_000));git(root,'add','check.cjs','large.txt');git(root,'commit','-m','base');const base=git(root,'rev-parse','HEAD');git(root,'init','--bare','-b','main',server);git(root,'remote','add','origin','git@fixture.invalid:org/project.git');git(root,'push','origin','main');
  writeFileSync(join(root,'.factory/factory.toml'),factoryToml('org/project',{host:'fixture.invalid'})+'\n[ci]\nbatch_test_argv=["node","check.cjs"]\nbatch_test_paths=["check.cjs"]\n');addProject(p,root);
  await install(p,new Fake(p),{schedule:new FakeSchedule(p)});
  const cli=async(args:string[],extra={})=>JSON.parse((await promisify(execFile)(process.execPath,[p.bin,'batch',...args],{env:{...env,...extra},cwd:root,timeout:150000})).stdout);
  const ids=[2,1,4,3,5,6], first=await cli(['submit','project',...ids.map(String)]);assert.equal(first.status,'held',JSON.stringify(first));assert.match(first.outcomes.find(o=>o.iid===1).reason,/#8/);
  advance=head=>{
    // Exercise the same owned-branch update API with disposable Git and fixture tracker reads.
    replacedHead=head;
    next=git(root,'commit-tree',git(root,'rev-parse',head+'^{tree}'),'-p',head,'-m','fixture-owned advance during review');
    const module=new URL('../src/batch.mts',import.meta.url).href, paths={state:p.state,projects:p.projects};
    execFileSync(process.execPath,['--input-type=module','-e',`import {advanceBatch} from ${JSON.stringify(module)};advanceBatch(...${JSON.stringify([paths,'project',first.id,head,next])})`],{env,timeout:15_000});
  };
  const result=await cli(['resume','project',first.id],{UNBLOCK:'1'});assert.equal(result.status,'handed-off',JSON.stringify(result));
  assert.deepEqual(result.members,ids);assert.deepEqual(result.outcomes.map(o=>[o.iid,o.status,o.gate,o.git,o.tracker]),[[2,'merged','approved','landed','complete'],[1,'merged','approved','landed','complete'],[4,'held','not-observed','not-started','not-started'],[3,'stopped','stopped','not-started','not-started'],[5,'merged','approved','landed','complete'],[6,'stopped','approved','landed','incomplete']],JSON.stringify(result.outcomes));
  assert.match(result.outcomes[2].reason,/#3/);assert.match(result.outcomes[3].reason,/exhaust/i);assert.match(result.outcomes[5].reason,/tracker/i);
  assert.equal(result.observedHead,git(server,'rev-parse',result.destinationRef));assert.equal(git(server,'rev-parse','main'),base);
  assert.deepEqual(git(server,'ls-tree','--name-only',result.observedHead).split('\n'),['check.cjs','large.txt','member-1','member-2','member-5','member-6']);
  assert.ok(staleCandidate&&replacedHead&&next);assert.equal(reviews.get(staleCandidate)?.base,replacedHead);
  assert.deepEqual(reviews.get(staleCandidate)!.roles.sort(),['code','test']);
  assert.notEqual(result.outcomes[1].candidate,staleCandidate);
  assert.equal(git(server,'rev-parse',result.outcomes[1].candidate+'^'),next);
  assert.equal(git(server,'rev-parse',result.outcomes[0].candidate+'^'),result.outcomes[1].candidate);assert.equal(attempts.filter(n=>n===3).length,3);assert(!existsSync(join(p.state,'org_project--7.json')));assert(!existsSync(join(p.state,'org_project--4.json')));
  assert.deepEqual(JSON.parse(readFileSync(facts,'utf8')),{1:['merged'],2:['merged'],3:[],4:[],5:['merged'],6:[],7:['ready-for-agent'],8:[]});
  for(const {candidate} of result.outcomes.filter(o=>o.git==='landed')) {
    const seen=reviews.get(candidate)!;assert.equal(seen.base,git(server,'rev-parse',candidate+'^'));assert.deepEqual(seen.roles.sort(),['code','test']);
  }
  assert.deepEqual(git(server,'rev-list',base+'..'+result.observedHead).split('\n').sort(),[next,...result.outcomes.filter(o=>o.git==='landed').map(o=>o.candidate)].sort());
  const entries=agents.entries(), handoff=join(p.state,'batches',first.id,'handoff.json'), stamp=statSync(handoff,{bigint:true});
  git(server,'update-ref',result.destinationRef,base,result.observedHead);writeFileSync(facts,'human changed tracker');
  for(let n=0;n<2;n++)assert.deepEqual(await cli(['resume','project',first.id]),result);
  assert.equal(statSync(handoff,{bigint:true}).ctimeNs,stamp.ctimeNs);assert.deepEqual(agents.entries(),entries);assert.equal(git(server,'rev-parse',result.destinationRef),base);assert.equal(git(server,'rev-parse','main'),base);assert.equal(readFileSync(facts,'utf8'),'human changed tracker');
}
