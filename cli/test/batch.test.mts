// Copied CLI and actual Git server ref transactions; only fixture tracker and SSH transports are reachable.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { home } from './schedule-helpers.mts';
import { factoryToml } from './config-fixture.mts';
import { install } from './runtime-fixture.mts';
import { Fake, FakeSchedule } from '../src/platform/fake.mts';
import { addProject, mutate } from '../src/projects.mts';
import { batchMembers } from '../src/batch-tracker.mts';

test('membership is an explicit set of canonical positive local IDs', () => {
  assert.deepEqual(batchMembers(['7','3']),[7,3]);
  for (const bad of [[],['1','1'],['03'],['owner/other#1'],['0'],['9007199254740992']]) assert.throws(() => batchMembers(bad));
});

test('copied batch CLI preserves selection, remote ownership and confirmed head across restart', async t => {
  const {p} = home(t,'factory-batch-'), root = join(p.home,'project'), server = join(p.home,'remote.git'), bin = join(p.home,'bin');
  mkdirSync(join(root,'.factory'),{recursive:true}); mkdirSync(bin);
  for (const [name,path] of [['node',process.execPath],['git','/usr/bin/git']]) symlinkSync(path,join(bin,name));
  const script = (name:string,text:string) => writeFileSync(join(bin,name),text,{mode:0o755});
  script('ssh',`#!/bin/sh\ncase "$2" in "git-upload-pack 'org/repo.git'") exec /usr/bin/git upload-pack "$SERVER";; "git-receive-pack 'org/repo.git'") exec /usr/bin/git receive-pack "$SERVER";; *) exit 92;; esac\n`);
  script('gh-axi',`#!${process.execPath}\nconst a=process.argv.slice(2); if(a.slice(0,4).join(' ')!=='api POST graphql --field'||a[5]!=='--jq')process.exit(91);const n=Number(/issue\\(number:(\\d+)\\)/.exec(a[4])[1]);const issue=[2,3,4,5].includes(n)?{number:n,state:'OPEN',subIssues:{totalCount:n===4?1:0}}:null;const {execFileSync}=require('node:child_process');process.stdout.write(execFileSync('/usr/bin/jq',['-r',a[6]],{input:JSON.stringify({data:{repository:{nameWithOwner:n===5?'org/other':'org/repo',issue}}})}));`);
  const env = {HOME:p.home,FACTORY_HOME:p.home,PATH:bin,SERVER:server,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_SSH:join(bin,'ssh'),GIT_SSH_VARIANT:'simple',GIT_ALLOW_PROTOCOL:'file:ssh'};
  const git = (cwd:string,...args:string[]) => execFileSync('/usr/bin/git',['-c','user.name=Fixture','-c','user.email=f@example.test','-C',cwd,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(root,'init','-b','main'); git(root,'commit','--allow-empty','-m','original'); const source = git(root,'rev-parse','HEAD');
  git(root,'init','--bare','-b','main',server); git(root,'remote','add','origin','git@fixture.test:org/repo.git'); git(root,'push','origin','HEAD:main');
  git(root,'commit','--allow-empty','-m','develop'); const dev = git(root,'rev-parse','HEAD'); git(root,'push','origin','HEAD:develop');
  writeFileSync(join(root,'.factory/factory.toml'),factoryToml('org/repo',{host:'fixture.test'})); addProject(p,root);
  await install(p,new Fake(p),{schedule:new FakeSchedule(p)});
  const cli = (a:string[],extra={}) => spawnSync(process.execPath,[p.bin,'batch',...a],{env:{...env,...extra},encoding:'utf8',timeout:20000});
  const refs = () => git(server,'show-ref'); const before = refs();
  for (const ids of [[],['2','2'],['2','100'],['5'],['4'],['org/other#2']]) {
    assert.notEqual(cli(['submit','project',...ids]).status,0); assert.equal(refs(),before); assert.equal(existsSync(join(p.state,'batches')),false);
  }
  const result = cli(['submit','project','2','3']); assert.equal(result.status,0,result.stderr); const b = JSON.parse(result.stdout);
  assert.deepEqual(b.members,[2,3]); assert.equal(b.sourceSha,source); assert.equal(b.expectedHead,source); assert.equal(git(server,'rev-parse',b.destinationRef),source);
  git(root,'push','origin','HEAD:main');
  const resume = () => cli(['resume','project',b.id]); assert.deepEqual(JSON.parse(resume().stdout),b);
  const lookup = spawnSync(process.execPath,['--input-type=module','-e',`import {readOwnedBatch} from ${JSON.stringify(join(p.app,'cli/src/batch.mts'))}; console.log(JSON.stringify(readOwnedBatch(${JSON.stringify({projects:p.projects,state:p.state})},'project',${JSON.stringify(b.id)})))`],{env,encoding:'utf8'});
  assert.equal(lookup.status,0,lookup.stderr); assert.deepEqual(JSON.parse(lookup.stdout),b);
  const other = join(p.home,'other'); git(root,'clone',server,other); git(other,'remote','set-url','origin','git@fixture.test:org/repo.git'); mkdirSync(join(other,'.factory')); writeFileSync(join(other,'.factory/factory.toml'),factoryToml('org/repo',{host:'fixture.test'})); addProject(p,other);
  assert.notEqual(cli(['resume','other',b.id]).status,0);
  const advance = (old:string,next:string) => spawnSync(process.execPath,['--input-type=module','-e',`import {advanceBatch} from ${JSON.stringify(join(p.app,'cli/src/batch.mts'))}; import {paths} from ${JSON.stringify(join(p.app,'cli/src/paths.mts'))}; console.log(JSON.stringify(advanceBatch(paths(),'project',${JSON.stringify(b.id)},${JSON.stringify(old)},${JSON.stringify(next)})))`],{env,encoding:'utf8'});
  const advanced = advance(source,dev); assert.equal(advanced.status,0,advanced.stderr); assert.equal(JSON.parse(resume().stdout).expectedHead,dev); assert.notEqual(advance(source,dev).status,0);
  const record = join(p.state,'batches',b.id,'batch.json'), bytes = readFileSync(record,'utf8');
  renameSync(record,record+'.held'); assert.notEqual(resume().status,0); assert.equal(existsSync(record),false); assert.equal(git(server,'rev-parse',b.destinationRef),dev); renameSync(record+'.held',record);
  git(server,'update-ref',b.destinationRef,source); assert.notEqual(resume().status,0); assert.equal(readFileSync(record,'utf8'),bytes); assert.equal(git(server,'rev-parse',b.destinationRef),source);
  git(server,'update-ref','-d',b.destinationRef); assert.notEqual(resume().status,0); assert.equal(readFileSync(record,'utf8'),bytes);
  mutate(p,r => {r.projects.find(v=>v.root===root)!.schedule={enabled:false,branch:'develop',since:'fixture'};return true;});
  // Interrupt the controller after the real push writes its porcelain directly to the attempt receipt.
  const wrapper = join(p.home,'intercept'); mkdirSync(wrapper);
  writeFileSync(join(wrapper,'git'),`#!${process.execPath}\nconst a=process.argv.slice(2),p=a.indexOf('push');if(p>=0&&process.env.COLLIDE){let ref=a.at(-1).split(':')[1];require('node:child_process').execFileSync('/usr/bin/git',['-C',process.env.SERVER,'update-ref',ref,a.at(-1).split(':')[0]]);}const r=require('node:child_process').spawnSync('/usr/bin/git',a,{stdio:'inherit'});if(p>=0&&!process.env.COLLIDE)process.kill(process.ppid,'SIGKILL');process.exit(r.status??1);`,{mode:0o755});
  const ids = () => readdirSync(join(p.state,'batches')); const interrupted = cli(['submit','project','3'],{PATH:`${wrapper}:${bin}`}); assert.equal(interrupted.signal,'SIGKILL');
  const id = ids().find(v=>v!==b.id)!; assert.match(interrupted.stderr,new RegExp(id)); const recovered = cli(['resume','project',id]); assert.equal(recovered.status,0,recovered.stderr); assert.equal(JSON.parse(recovered.stdout).baseRef,'refs/heads/develop');
  // Same-SHA collision racing the absence check returns "up to date", never a host creation receipt.
  const collision = cli(['submit','project','2'],{PATH:`${wrapper}:${bin}`,COLLIDE:'1'}); assert.notEqual(collision.status,0);
  const collided = ids().find(v=>v!==b.id&&v!==id)!; assert.equal(git(server,'rev-parse',`refs/heads/factory/batch/${collided}`),dev); assert.notEqual(cli(['resume','project',collided]).status,0);
  assert.equal(git(server,'rev-parse',`refs/heads/factory/batch/${collided}`),dev);
  assert.notEqual(cli(['resume','project','eeeeeeee-1111-4444-8888-000000000000']).status,0); assert.equal(ids().length,3);
  writeFileSync(join(root,'.factory/factory.toml'),factoryToml('org/repo',{kind:'gitlab',host:'fixture.test',projectId:42}));
  assert.notEqual(cli(['resume','project',id]).status,0,'changed tracker identity');
  script('glab',`#!${process.execPath}\nconst a=process.argv.slice(2);if(a.slice(0,5).join(' ')!=='api graphql --hostname fixture.test -f')process.exit(93);const iid=/iids:\\[\"(\\d+)\"\\]/.exec(a[5])[1];const children={nodes:iid==='4'?[{workItemType:{name:'Task'}}]:[],pageInfo:{hasNextPage:iid==='5'}};console.log(JSON.stringify({data:{project:{id:'gid://gitlab/Project/'+(iid==='6'?'101':'42'),fullPath:'org/repo',workItems:{nodes:[{iid,state:'OPEN',workItemType:{name:iid==='2'?'Task':'Issue'},widgets:[{__typename:'WorkItemWidgetHierarchy',children}]}]}}}}));`);
  const prior=refs(); for (const invalid of ['4','5','6']) { assert.notEqual(cli(['submit','project',invalid]).status,0); assert.equal(refs(),prior); }
  const task=cli(['submit','project','2']); assert.equal(task.status,0,task.stderr); assert.deepEqual(JSON.parse(task.stdout).members,[2]);
});
