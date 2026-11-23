// Pure member classification plus copied-host Git, tracker, crash/recovery and no-work boundaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { home } from './schedule-helpers.mts';
import { factoryToml } from './config-fixture.mts';
import { install } from './runtime-fixture.mts';
import { Fake, FakeSchedule } from '../src/platform/fake.mts';
import { addProject, mutate } from '../src/projects.mts';
import { batchMembers, classifyBatchMember } from '../src/batch-tracker.mts';
import { matchesTrackerOrigin } from '../src/batch.mts';

test('tracker origin keeps URI ports distinct from SCP repository paths', () => {
  const host = 'git.example.org:8443', project = 'group/repo';
  assert.ok(matchesTrackerOrigin(`https://${host}/${project}.git`,host,project));
  assert.ok(matchesTrackerOrigin(`git@git.example.org:${project}.git`,'git.example.org',project));
  for (const wrong of [`git@${host}/${project}.git`,`https://git.example.org/${project}.git`,`https://user@${host}/${project}.git`])
    assert.equal(matchesTrackerOrigin(wrong,host,project),false);
});

test('membership is an explicit set of canonical positive local IDs', () => {
  assert.deepEqual(batchMembers(['7','3']),[7,3]);
  for (const bad of [[],['1','1'],['03'],['owner/other#1'],['0'],['9007199254740992']]) assert.throws(() => batchMembers(bad));
});

test('authenticated member responses distinguish invalid tickets from incomplete evidence', () => {
  const project='org/repo', id='repository-id', issue={number:2,state:'OPEN',subIssues:{totalCount:0}};
  const repo={nameWithOwner:project,id,issue};
  const gh=(repository:unknown,errors?:unknown[])=>classifyBatchMember({github:true,project,subtasks:true},2,id,{ok:!errors,body:{data:{repository},errors}});
  assert.equal(gh(repo),'runnable');
  for(const patch of [{nameWithOwner:'org/other'},{issue:null},{issue:{...issue,state:'CLOSED'}},{issue:{...issue,subIssues:{totalCount:1}}}]) assert.equal(gh({...repo,...patch}),'invalid');
  assert.equal(gh({...repo,issue:{...issue,subIssues:null}}),'unavailable');
  assert.equal(gh(repo,[{type:'NOT_FOUND',path:['repository','issue']}]),'invalid');
  assert.equal(gh(repo,[{type:'NOT_FOUND',path:['repository']}]),'unavailable');
  const item={iid:'2',state:'OPEN',workItemType:{name:'Issue'}};
  const lab=(nodes:unknown[],repoId=id)=>classifyBatchMember({github:false,project,subtasks:true},2,id,{ok:true,body:{data:{project:{fullPath:project,id:repoId,workItems:{nodes}}}}});
  const parent=(nodes:unknown[],hasNextPage:boolean)=>({...item,widgets:[{__typename:'WorkItemWidgetHierarchy',children:{nodes,pageInfo:{hasNextPage}}}]});
  assert.equal(lab([parent([],false)]),'runnable');assert.equal(lab([parent([],true)]),'unavailable');
  assert.equal(lab([parent([{workItemType:{name:'Task'}}],false)]),'invalid');assert.equal(lab([item],'foreign'),'invalid');
});

test('copied batch ownership boundary selects only validated members and owns only confirmed writes to its named remote', async t => {
  const {p} = home(t,'factory-batch-');
  const root = join(p.home,'project'), server = join(p.home,'remote.git'), otherServer = join(p.home,'other.git');
  const bin = join(p.home,'bin'), effects = join(p.home,'forbidden'), transports = join(p.home,'transports'), reads = join(p.home,'tracker-reads');
  const url = 'git@fixture.test:org/repo.git', otherURL = 'git@fixture.test:org/other.git';
  const ghId='R_fixtureOriginal', glId='gid://gitlab/Project/42', ghIdentity=join(p.home,'gh-repository'), glIdentity=join(p.home,'gl-repository');
  writeFileSync(ghIdentity,ghId); writeFileSync(glIdentity,glId);
  mkdirSync(join(root,'.factory'),{recursive:true}); mkdirSync(bin); symlinkSync(process.execPath,join(bin,'node'));
  const stub = (name:string,body:string) => writeFileSync(join(bin,name),`#!${process.execPath}\n${body}`,{mode:0o755});
  const recorder = `const fs=require('node:fs');const log=(f,s)=>fs.appendFileSync(f,s+'\\n');const a=process.argv.slice(2);`;
  for (const name of ['pi','sandcastle','docker','claude','systemctl','launchctl','npm']) stub(name,`${recorder}log(process.env.EFFECTS,${JSON.stringify(name)});process.exit(90);`);
  const preload=join(p.home,'claim-monitor.cjs');
  // A claim that is acquired and released in the same CLI call is still observable. Batch-private locks use a different path.
  writeFileSync(preload,`const fs=require('node:fs'), dir=process.env.SANDCASTLE_STATE_DIR+'/admission';const mkdir=fs.mkdirSync;
    fs.mkdirSync=function(p,...args){if(p===dir){fs.appendFileSync(process.env.EFFECTS,'claim boundary\\n');throw Error('fixture claim denied')}return mkdir(p,...args)};
    const fault=process.env.RECEIPT_FAULT,open=fs.openSync,sync=fs.fsyncSync;let marker;
    fs.openSync=function(p,flags,...args){if(fault&&flags==='wx'&&p.endsWith('.push')){
      if(fault==='before-marker')process.kill(process.pid,'SIGKILL');
      if(fault==='collision'){const prior=open(p,'wx',0o600);fs.writeSync(prior,'prior attempt');fs.closeSync(prior);}
      const fd=open(p,flags,...args);marker=p;return fd;
    }return open(p,flags,...args)};
    fs.fsyncSync=function(fd){if(marker&&fs.fstatSync(fd).isDirectory()){
      marker=undefined;if(fault==='fsync')throw Error('fixture marker sync failure');
      sync(fd);if(fault==='crash')process.kill(process.pid,'SIGKILL');
      if(fault==='enoent')process.env.PATH='/absent-fixture-executable-directory';
      if(fault==='eacces')process.env.PATH=process.env.DENIED_BIN;return;
    }return sync(fd)};
    require('node:module').syncBuiltinESMExports();`);
  stub('ssh',`${recorder}const m=/^(git-upload-pack|git-receive-pack) '(org\\/(?:repo|other)\\.git)'$/.exec(a[1]);
    if(a.length!==2||a[0]!=='git@fixture.test'||!m)process.exit(92);
    const remote=m[2]==='org/repo.git'?process.env.SERVER:process.env.OTHER_SERVER;
    process.exit(require('node:child_process').spawnSync('/usr/bin/git',[m[1].slice(4),remote],{stdio:'inherit'}).status??1);`);
  stub('gh',`${recorder}if(a.slice(0,5).join(' ')!=='api graphql --hostname fixture.test -f'||a.length!==6){log(process.env.EFFECTS,'unexpected gh');process.exit(91)}
    const m=/issue\\(number:(\\d+)\\)/.exec(a[5]),n=m?Number(m[1]):null;if(m)log(process.env.READS,n);
    const id=a[5].includes('{id nameWithOwner')?fs.readFileSync(process.env.GH_ID,'utf8')||undefined:undefined;
    const issue=[2,3].includes(n)?{number:n,state:'OPEN',subIssues:{totalCount:0}}:null;
    const viewer=a[5].includes('viewer {id}')&&!process.env.ANON?{id:'fixture-user'}:null;
    console.log(JSON.stringify({data:{viewer,repository:{id,nameWithOwner:'org/repo',...(m?{issue}:{})}}}));`);
  stub('glab',`${recorder}if(!['fixture.test','fixture.test:8443'].some(h=>a.slice(0,5).join(' ')==='api graphql --hostname '+h+' -f')||a.length!==6){log(process.env.EFFECTS,'unexpected glab');process.exit(93)}
    const m=/iids:\\["(\\d+)"\\]/.exec(a[5]),iid=m?.[1];if(m)log(process.env.READS,iid);
    const id=a[5].includes('{id fullPath')?fs.readFileSync(process.env.GL_ID,'utf8')||undefined:undefined;
    const currentUser=a[5].includes('currentUser {id}')&&!process.env.ANON?{id:'gid://gitlab/User/1'}:null;
    const children={nodes:[],pageInfo:{hasNextPage:iid==='5'}};
    console.log(JSON.stringify({data:{currentUser,project:{id,fullPath:'org/repo',workItems:{nodes:[{iid,state:'OPEN',workItemType:{name:iid==='2'?'Task':'Issue'},widgets:[{__typename:'WorkItemWidgetHierarchy',children}]}]}}}}));`);
  // Never allow an anonymous transport target in the host under test. The real SSH boundary can only serve our two bare repos.
  stub('git',`${recorder}const cp=require('node:child_process'),op=a.find(x=>['fetch','push','ls-remote'].includes(x));
    if(op){const target=a[a.indexOf('--')+1];log(process.env.TRANSPORTS,op+' '+target);if(target!=='origin')process.exit(94)}
    if(op==='fetch'&&process.env.REFUSE_FETCH)process.exit(1);
    if(op==='push'&&process.env.COMPETING_SHA){const ref=a.at(-1).split(':')[1];cp.execFileSync('/usr/bin/git',['-C',process.env.SERVER,'update-ref',ref,process.env.COMPETING_SHA])}
    if(op==='ls-remote'&&a.at(-1).startsWith('refs/heads/factory/batch/')&&process.env.INTERRUPT_RESERVED){process.kill(process.ppid,'SIGKILL');process.exit(0)}
    if(op&&process.env.PORT_TRANSPORT){const remote=cp.execFileSync('/usr/bin/git',['-C',process.env.ROOT,'remote','get-url','origin'],{encoding:'utf8'}).trim();if(remote!=='https://fixture.test:8443/org/repo.git')process.exit(95);a[a.indexOf('--')+1]=process.env.SERVER}
    if(a.includes('merge-base')&&process.env.CHANGE_DURING_ANCESTRY&&fs.existsSync(process.env.BATCH_LOCK))fs.writeFileSync(process.env.GH_ID,'R_replacement');
    const result=cp.spawnSync('/usr/bin/git',a,{stdio:'inherit'});if(op==='push'&&process.env.INTERRUPT&&result.status===0)process.kill(process.ppid,'SIGKILL');process.exit(result.status??1);`);
  const deniedBin=join(p.home,'noexec');mkdirSync(deniedBin);writeFileSync(join(deniedBin,'git'),'not executable',{mode:0o600});
  const env = {DENIED_BIN:deniedBin,HOME:p.home,FACTORY_HOME:p.home,PATH:bin,GH_ID:ghIdentity,GL_ID:glIdentity,ROOT:root,SERVER:server,OTHER_SERVER:otherServer,EFFECTS:effects,TRANSPORTS:transports,READS:reads,
    SANDCASTLE_STATE_DIR:p.state,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_SSH:join(bin,'ssh'),GIT_SSH_VARIANT:'simple',GIT_ALLOW_PROTOCOL:'file:ssh'};
  const git = (cwd:string,...args:string[]) => execFileSync('/usr/bin/git',['-c','user.name=Fixture','-c','user.email=f@example.test','-C',cwd,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(root,'init','-b','main'); git(root,'commit','--allow-empty','-m','original'); const source = git(root,'rev-parse','HEAD');
  git(root,'init','--bare','-b','main',server); git(root,'remote','add','origin',url); git(root,'remote','set-url','--push','origin',url);
  const optionLog=join(p.home,'received-options');
  git(server,'config','receive.advertisePushOptions','true');
  writeFileSync(join(server,'hooks/pre-receive'),`#!${process.execPath}\nconst count=process.env.GIT_PUSH_OPTION_COUNT;require('node:fs').appendFileSync(${JSON.stringify(optionLog)},JSON.stringify([count,...Array.from({length:Number(count)},(_,i)=>process.env['GIT_PUSH_OPTION_'+i])])+'\\n');`,{mode:0o755});
  const received=()=>JSON.parse(readFileSync(optionLog,'utf8').trimEnd().split('\n').at(-1)!);
  git(root,'config','--add','push.pushOption','fixture-one');git(root,'config','--add','push.pushOption','fixture-two');
  git(root,'push','origin','HEAD:main');assert.deepEqual(received(),['2','fixture-one','fixture-two']);
  git(root,'commit','--allow-empty','-m','develop'); const dev = git(root,'rev-parse','HEAD'); git(root,'push','origin','HEAD:develop');
  git(root,'tag','unrelated',source); git(root,'push','origin','refs/tags/unrelated');
  git(root,'clone','--bare',server,otherServer); git(root,'commit','--allow-empty','-m','main advanced'); const moved=git(root,'rev-parse','HEAD'); assert.notEqual(dev,moved);
  const toml=join(root,'.factory/factory.toml'), githubConfig=factoryToml('org/repo',{host:'fixture.test'}); writeFileSync(toml,githubConfig); addProject(p,root);
  await install(p,new Fake(p),{schedule:new FakeSchedule(p)});
  const node = (args:string[], extra={}) => spawnSync(process.execPath,['--require',preload,...args],{env:{...env,...extra},encoding:'utf8',timeout:30000});
  // Exercise the ownership boundary alone: command orchestration intentionally acquires claims after this returns.
  const cli = ([action,project,...args]:string[],extra={}) => node(['--input-type=module','-e',`
    import {paths} from ${JSON.stringify(join(p.app,'cli/src/paths.mts'))};
    import {submitBatch,resumeBatch} from ${JSON.stringify(join(p.app,'cli/src/batch.mts'))};
    const p=paths(process.env.FACTORY_HOME), project=${JSON.stringify(project)}, args=${JSON.stringify(args)};
    console.log(JSON.stringify(${action==='submit'?'submitBatch(p,project,args,id=>console.error("Reserved batch "+id))':'resumeBatch(p,project,args[0])'}));`],extra);
  type Result = ReturnType<typeof cli>;
  function refused(result:Result, reason?:RegExp) {
    assert.ifError(result.error); assert.equal(result.signal,null); assert.equal(result.status,1,result.stderr); if(reason) assert.match(result.stderr,reason);
  }
  function success(result:Result) { assert.equal(result.status,0,result.stderr); return JSON.parse(result.stdout); }
  const host = (fn:string,args:unknown[], extra={}) => node(['--input-type=module','-e',`import {${fn}} from ${JSON.stringify(join(p.app,'cli/src/batch.mts'))}; console.log(JSON.stringify(${fn}(...${JSON.stringify([{projects:p.projects,state:p.state},'project',...args])})));`],extra);
  const refMap = (repo:string) => Object.fromEntries(git(repo,'for-each-ref','--format=%(refname) %(objectname)').split('\n').map(l=>l.split(' ')));
  const decoy=refMap(otherServer);
  const verifyRefs=(expected:Record<string,string>) => {assert.deepEqual(refMap(server),expected);assert.deepEqual(refMap(otherServer),decoy);};
  const initial=refMap(server), batchDir=join(p.state,'batches');
  const text=(f:string) => existsSync(f)?readFileSync(f,'utf8'):'';
  const noWork=()=>{ assert.equal(text(effects),''); assert.equal(existsSync(join(p.state,'admission')),false); };
  function invalid(ids:string[],reason:RegExp){refused(cli(['submit','project',...ids]),reason);verifyRefs(initial);noWork();assert.equal(existsSync(batchDir),false);}
  invalid(['2','2'],/positive project-local/);
  invalid(['2','100'],/missing or not a runnable member/); // a later invalid member prevents all effects
  const selectedBefore=text(reads);
  git(root,'config','--add','remote.origin.fetch','+refs/heads/*:refs/heads/*');
  invalid(['2'],/origin fetch tracking/);assert.equal(text(reads),selectedBefore);assert.equal(text(transports),'');
  git(root,'config','--unset','--fixed-value','remote.origin.fetch','+refs/heads/*:refs/heads/*');
  writeFileSync(ghIdentity,''); invalid(['2'],/authenticated repository identity/); writeFileSync(ghIdentity,ghId);
  renameSync(join(bin,'gh'),join(bin,'gh.off')); invalid(['2'],/Tracker lookup unavailable/); renameSync(join(bin,'gh.off'),join(bin,'gh'));
  git(root,'remote','set-url','--push','origin',otherURL); invalid(['2'],/matching origin fetch\/push/); git(root,'remote','set-url','--push','origin',url);
  // Existing symlink ancestor above a missing leaf: refusal before tracker, fetch, or mkdir anywhere in the resolved target.
  const aliasHome=join(p.home,'alias-home'), inert=join(p.home,'inert'); mkdirSync(inert); mkdirSync(join(aliasHome,'.config/factory'),{recursive:true});
  writeFileSync(join(aliasHome,'.config/factory/projects.json'),readFileSync(p.projects)); symlinkSync(inert,join(aliasHome,'.local'));
  const checkout=()=>[git(root,'status','--porcelain','--untracked-files=all'),refMap(root),text(toml)], originalCheckout=checkout(), oldReads=text(reads);
  refused(cli(['submit','project','2'],{FACTORY_HOME:aliasHome}),/state requires canonical directories/);
  const inside=join(root,'forbidden-state');
  refused(node(['--input-type=module','-e',`import {submitBatch} from ${JSON.stringify(join(p.app,'cli/src/batch.mts'))}; submitBatch(${JSON.stringify({projects:p.projects,state:inside})},'project',['2'])`]),/outside the project checkout/);
  assert.equal(existsSync(inside),false);
  assert.deepEqual(readdirSync(inert),[]); assert.deepEqual(checkout(),originalCheckout); assert.equal(text(reads),oldReads); assert.equal(text(transports),''); verifyRefs(initial);noWork();

  const b=success(cli(['submit','project','2','3'])); assert.equal(b.version,2);assert.equal(b.repositoryId,ghId);assert.deepEqual(b.members,[2,3]); assert.equal(b.baseRef,'refs/heads/main');assert.equal(b.sourceSha,source);assert.equal(b.expectedHead,source);
  verifyRefs({...initial,[b.destinationRef]:source});assert.deepEqual(received(),['0']);noWork();
  git(root,'push','origin',`${moved}:main`); const resume=(id:string,project='project')=>cli(['resume',project,id]);
  assert.deepEqual(success(resume(b.id)),b); assert.deepEqual(success(host('readOwnedBatch',[b.id])),b);
  const record=(id:string)=>join(batchDir,id,'batch.json');
  const pushes=()=>text(transports).split('\n').filter(line=>line.startsWith('push ')).length;
  function savedTree(dir:string):unknown {
    if (!existsSync(dir)) return null;
    return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>{
      const path=join(dir,e.name); return [e.name,e.isDirectory()?savedTree(path):readFileSync(path).toString('base64')];
    });
  }
  function preserved(id:string,action:()=>Result){
    const dir=dirname(record(id)), bytes=savedTree(dir), before=refMap(server), attempts=pushes(), selected=text(reads);
    refused(action());assert.deepEqual(savedTree(dir),bytes);assert.equal(pushes(),attempts);assert.equal(text(reads),selected);verifyRefs(before);noWork();
  }
  const other=join(p.home,'other');git(root,'clone',otherServer,other);git(other,'remote','set-url','origin',otherURL);mkdirSync(join(other,'.factory'));writeFileSync(join(other,'.factory/factory.toml'),factoryToml('org/other',{host:'fixture.test'}));addProject(p,other);
  preserved(b.id,()=>resume(b.id,'other'));
  git(root,'remote','set-url','origin',otherURL);git(root,'remote','set-url','--push','origin',otherURL);writeFileSync(toml,factoryToml('org/other',{host:'fixture.test'}));
  preserved(b.id,()=>resume(b.id));git(root,'remote','set-url','origin',url);git(root,'remote','set-url','--push','origin',url);writeFileSync(toml,githubConfig);
  const advance=(old:string,next:string,extra={})=>host('advanceBatch',[b.id,old,next],extra);
  const attempts=pushes(),crashed=advance(source,dev,{RECEIPT_FAULT:'before-marker'});
  assert.equal(crashed.signal,'SIGKILL');const intent=JSON.parse(text(record(b.id)));
  assert.equal(intent.phase,'advancing');assert.equal(existsSync(join(dirname(record(b.id)),intent.pending.attempt+'.push')),false);
  preserved(b.id,()=>host('readOwnedBatch',[b.id]));
  git(server,'update-ref',b.destinationRef,dev);preserved(b.id,()=>resume(b.id));git(server,'update-ref',b.destinationRef,source);
  assert.deepEqual(success(resume(b.id)),b);assert.deepEqual(success(host('readOwnedBatch',[b.id])),b);assert.equal(pushes(),attempts);
  for(const fault of ['fsync','enoent','eacces','collision']) {
    const before=refMap(server), count=pushes();refused(advance(source,dev,{RECEIPT_FAULT:fault}),fault==='fsync'?/fixture marker sync failure/:fault==='collision'?/EEXIST/:/push executable/);
    assert.deepEqual(success(resume(b.id)),b);assert.equal(pushes(),count);verifyRefs(before);
    if(fault==='collision')assert.ok(readdirSync(dirname(record(b.id))).some(f=>f.endsWith('.push')&&text(join(dirname(record(b.id)),f))==='prior attempt'));
  }
  const prior=refMap(server), tracking=b.destinationRef.replace('refs/heads/','refs/remotes/origin/');
  git(root,'branch','operator-work',moved);
  const local=refMap(root), beforeUnsafe=pushes();
  git(root,'config','remote.origin.fetch',`+${b.destinationRef}:refs/heads/operator-work`);
  const unsafe=advance(source,dev);assert.deepEqual(refMap(root),local);verifyRefs(prior);refused(unsafe);assert.equal(pushes(),beforeUnsafe);
  git(root,'config','remote.origin.fetch','+refs/heads/*:refs/remotes/origin/*');
  git(root,'symbolic-ref',tracking,'refs/heads/operator-work');const aliased=refMap(root);
  refused(advance(source,dev),/tracking ref/);assert.deepEqual(refMap(root),aliased);verifyRefs(prior);assert.equal(pushes(),beforeUnsafe);
  git(root,'symbolic-ref','--delete',tracking);git(root,'update-ref',tracking,source);
  assert.equal(success(advance(source,dev)).expectedHead,dev);assert.deepEqual(refMap(root),{...local,[tracking]:dev});verifyRefs({...prior,[b.destinationRef]:dev});assert.deepEqual(received(),['0']);assert.equal(success(resume(b.id)).expectedHead,dev);
  preserved(b.id,()=>advance(source,dev));
  preserved(b.id,()=>advance(dev,source)); // correct expected-old, but a rewind is not a fast-forward
  const replacement=join(p.home,'replacement.git'); git(root,'clone','--bare',server,replacement);
  const identical=refMap(replacement); assert.deepEqual(identical,refMap(server));
  writeFileSync(ghIdentity,'R_fixtureReplacement');const transport={SERVER:replacement};
  preserved(b.id,()=>host('readOwnedBatch',[b.id],transport));preserved(b.id,()=>cli(['resume','project',b.id],transport));
  preserved(b.id,()=>advance(dev,moved,transport));assert.deepEqual(refMap(replacement),identical);
  writeFileSync(ghIdentity,ghId);preserved(b.id,()=>host('readOwnedBatch',[b.id],{ANON:'1'}));
  preserved(b.id,()=>advance(dev,moved,{CHANGE_DURING_ANCESTRY:'1',BATCH_LOCK:join(dirname(record(b.id)),'admission/lock')}));
  assert.equal(text(ghIdentity),'R_replacement');writeFileSync(ghIdentity,ghId);
  const saved=text(record(b.id)), legacy=JSON.parse(saved); delete legacy.repositoryId; legacy.version=1;
  writeFileSync(record(b.id),JSON.stringify(legacy));preserved(b.id,()=>resume(b.id));writeFileSync(record(b.id),saved);
  renameSync(record(b.id),record(b.id)+'.held');preserved(b.id,()=>resume(b.id));assert.equal(existsSync(record(b.id)),false);renameSync(record(b.id)+'.held',record(b.id));
  git(server,'update-ref',b.destinationRef,source);preserved(b.id,()=>host('readOwnedBatch',[b.id]));preserved(b.id,()=>resume(b.id));git(server,'update-ref','-d',b.destinationRef);preserved(b.id,()=>resume(b.id));git(server,'update-ref',b.destinationRef,dev);
  // A different writer fast-forwards to the exact proposed commit after the host's check. Up-to-date is not a host write.
  const beforeRace=refMap(server);refused(advance(dev,moved,{COMPETING_SHA:moved}));verifyRefs({...beforeRace,[b.destinationRef]:moved});
  assert.equal(JSON.parse(text(record(b.id))).expectedHead,dev);preserved(b.id,()=>resume(b.id));
  mutate(p,r=>{r.projects.find(row=>row.root===root)!.schedule={enabled:false,branch:'develop',since:'fixture'};return true;});
  const beforeCreate=refMap(server);assert.notEqual(beforeCreate['refs/heads/main'],beforeCreate['refs/heads/develop']);
  const interrupted=cli(['submit','project','3'],{INTERRUPT:'1'});assert.equal(interrupted.signal,'SIGKILL');
  const reserved=(r:Result)=>{const match=/Reserved batch ([0-9a-f-]{36})/.exec(r.stderr);assert.ok(match,r.stderr);return match[1]};
  const id=reserved(interrupted);preserved(id,()=>host('readOwnedBatch',[id]));const owned=success(resume(id));assert.equal(owned.baseRef,'refs/heads/develop');assert.equal(owned.sourceSha,dev);assert.equal(owned.expectedHead,dev);verifyRefs({...beforeCreate,[owned.destinationRef]:dev});
  const lost=host('advanceBatch',[id,dev,moved],{RECEIPT_FAULT:'crash'});assert.equal(lost.signal,'SIGKILL');
  verifyRefs({...beforeCreate,[owned.destinationRef]:dev});preserved(id,()=>resume(id));preserved(id,()=>host('advanceBatch',[id,dev,moved]));
  for(const existing of [dev,moved]){
    const before=refMap(server), collision=cli(['submit','project','2'],{COMPETING_SHA:existing});refused(collision);const colliding=reserved(collision);
    verifyRefs({...before,[`refs/heads/factory/batch/${colliding}`]:existing});preserved(colliding,()=>resume(colliding));
  }
  // The durable reservation exists, but no creation receipt or branch exists. Move the configured base *before* resume.
  const tree=git(server,'rev-parse',dev+'^{tree}');
  const pinned=git(server,'commit-tree',tree,'-p',dev,'-m','server-only develop');git(server,'update-ref','refs/heads/develop',pinned);
  const beforeReservation=refMap(server), attempted=pushes();
  const stopped=cli(['submit','project','3'],{INTERRUPT_RESERVED:'1'});assert.equal(stopped.signal,'SIGKILL');
  const emptyId=reserved(stopped);assert.deepEqual(readdirSync(dirname(record(emptyId))),['batch.json']);assert.equal(JSON.parse(text(record(emptyId))).sourceSha,pinned);assert.equal(pushes(),attempted);verifyRefs(beforeReservation);
  preserved(emptyId,()=>host('readOwnedBatch',[emptyId]));
  const retryIds=['fsync','enoent'].map(fault=>{
    const count=pushes(),failed=cli(['submit','project','3'],{RECEIPT_FAULT:fault});refused(failed,fault==='fsync'?/fixture marker sync failure/:/push executable did not launch: ENOENT/);assert.equal(pushes(),count);verifyRefs(beforeReservation);return reserved(failed);
  });
  const collision=cli(['submit','project','3'],{RECEIPT_FAULT:'collision'});refused(collision,/EEXIST/);
  const foreign=reserved(collision), marker=JSON.parse(text(record(foreign))).pending.attempt+'.push';
  assert.equal(text(join(dirname(record(foreign)),marker)),'prior attempt');preserved(foreign,()=>resume(foreign));
  const crash=cli(['submit','project','3'],{RECEIPT_FAULT:'crash'});assert.equal(crash.signal,'SIGKILL');
  const ambiguous=reserved(crash);verifyRefs(beforeReservation);preserved(ambiguous,()=>resume(ambiguous));
  git(server,'update-ref',`refs/heads/factory/batch/${ambiguous}`,pinned);preserved(ambiguous,()=>resume(ambiguous));
  const later=git(server,'commit-tree',tree,'-p',pinned,'-m','server-only successor');git(server,'update-ref','refs/heads/develop',later);
  assert.equal(git(root,'cat-file','-t',pinned),'commit');assert.equal(git(root,'for-each-ref','--contains',pinned),'');
  git(root,'prune','--expire=now');assert.throws(()=>git(root,'cat-file','-t',pinned));
  const staleLocal=refMap(root);
  const intentBytes=text(record(emptyId)),priorPushes=pushes(),beforeFetch=refMap(server);
  refused(cli(['resume','project',emptyId],{REFUSE_FETCH:'1'}),/Git fetch failed/);
  assert.equal(text(record(emptyId)),intentBytes);assert.equal(existsSync(join(dirname(record(emptyId)),JSON.parse(intentBytes).pending.attempt+'.push')),false);
  assert.equal(pushes(),priorPushes);verifyRefs(beforeFetch);assert.deepEqual(refMap(root),staleLocal);
  const beforeResume=refMap(server), ticketReads=text(reads), fromReservation=success(resume(emptyId));
  assert.equal(text(reads),ticketReads);assert.equal(fromReservation.id,emptyId);assert.equal(fromReservation.sourceSha,pinned);assert.equal(fromReservation.expectedHead,pinned);
  assert.deepEqual(refMap(root),{...staleLocal,[`refs/remotes/origin/factory/batch/${emptyId}`]:pinned});
  verifyRefs({...beforeResume,[`refs/heads/factory/batch/${emptyId}`]:pinned});assert.notEqual(later,pinned);
  for(const retry of retryIds){const before=refMap(server),created=success(resume(retry));assert.equal(created.id,retry);assert.equal(created.expectedHead,pinned);assert.equal(created.sourceSha,pinned);verifyRefs({...before,[created.destinationRef]:pinned});}
  const missing='eeeeeeee-1111-4444-8888-000000000000';preserved(missing,()=>resume(missing));assert.equal(existsSync(dirname(record(missing))),false);
  writeFileSync(toml,factoryToml('org/repo',{kind:'gitlab',host:'fixture.test',projectId:42}));preserved(id,()=>resume(id));
  const beforeLab=refMap(server), dirs=readdirSync(batchDir);
  refused(cli(['submit','project','5']),/Tracker lookup unavailable/);verifyRefs(beforeLab);assert.deepEqual(readdirSync(batchDir),dirs);noWork();
  // Exercise actual configured HTTPS authority parsing; only the fixture transport maps it to the bare repository.
  const https='https://fixture.test:8443/org/repo.git', port={PORT_TRANSPORT:'1'};
  git(root,'remote','set-url','origin',https);git(root,'remote','set-url','--push','origin',https);
  writeFileSync(toml,factoryToml('org/repo',{kind:'gitlab',host:'fixture.test:8443',projectId:42}));
  const task=success(cli(['submit','project','2'],port));assert.deepEqual(task.members,[2]);assert.equal(task.repositoryId,glId);verifyRefs({...beforeLab,[task.destinationRef]:later});noWork();
  assert.deepEqual(success(host('readOwnedBatch',[task.id],port)),task);
  writeFileSync(glIdentity,'gid://gitlab/Project/101');preserved(task.id,()=>cli(['resume','project',task.id],port));
  assert.deepEqual(new Set(text(transports).trim().split('\n')),new Set(['fetch origin','push origin','ls-remote origin']));
});
