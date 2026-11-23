// Real submit/ownership reads, local Git and shared claim ledger; only tracker transport, image/gate and delivery authority are doubles.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {home} from './schedule-helpers.mts';
import {install} from './runtime-fixture.mts';
import {Fake,FakeSchedule} from '../src/platform/fake.mts';
import {factoryToml} from './config-fixture.mts';
import {addProject} from '../src/projects.mts';
import {advanceBatch,submitBatch} from '../src/batch.mts';
import {dispatchBatch} from '../src/batch-dispatch.mts';
import {claimRun,readRuns} from '../../board/board.mts';
import {batchLinks} from '../../orchestrator/batch-links.mts';
import {declaredBlockers,prerequisiteHold,recordedGraph,unavailableDelivery,type DeliveryObserver} from '../../orchestrator/batch-selection.mts';

test('batch claim leaves an unrelated dead starting reservation byte-for-byte intact',t=>{
  const {p}=home(t);mkdirSync(p.state,{recursive:true});const file=join(p.state,'outside--9.json');
  const bytes=JSON.stringify({iid:'9',project:'outside',stage:'setup',starting:true,pid:2147483647});writeFileSync(file,bytes);
  const claim=claimRun({dir:p.state,project:'org/repo',iid:'11',cap:2,pid:process.pid,patch:{batchMember:{id:'batch',repositoryId:'repo',footprint:['*']}}});
  assert.equal(claim.ok,true);assert.equal(readFileSync(file,'utf8'),bytes);
});

test('native blocker reads exhaust pages, skip reverse/non-blocking GitLab links and never localize foreign IDs',()=>{
  for(const kind of ['gitlab','github'] as const){
    const repo={kind,project:'org/r',host:'h',projectId:5};
    const page=Array.from({length:100},(_,i)=>kind==='github'?{number:i+1,html_url:`https://h/org/r/issues/${i+1}`}:{iid:i+1,project_id:5,link_type:'is_blocked_by'});
    assert.deepEqual(batchLinks(111,repo,path=>path.endsWith('page=1')?page:kind==='gitlab'?[{link_type:'blocks'},{link_type:'relates_to'}]:[]),page.map((_,i)=>i+1));
    for(const bad of [null,[{}],[{...page[0],html_url:'https://h/other/issues/1',project_id:55}]])assert.throws(()=>batchLinks(111,repo,()=>bad));
    assert.throws(()=>batchLinks(111,repo,path=>path.endsWith('page=1')?page:null));
  }
  assert.deepEqual(declaredBlockers('**Depends on:** #1 (description), #2'),[1,2]);
  assert.throws(()=>declaredBlockers('Blocked by: org/other#2'));
});

test('recorded providers and implementer blockers are never expanded; unsafe or stale graph facts do not narrow reservations',()=>{
  const m={iid:11,project:'p',hash:'h',baseSha:'head',footprint:['code/'],requires:[{providedBy:44}],implementerBlockers:[{iid:55}]} as any;
  assert.deepEqual(recordedGraph(m,'p',11,'h','head'),{blockers:[44,55],footprint:['code/']});
  assert.deepEqual(recordedGraph(m,'p',11,'h','moved').footprint,['*']);
  for(const patch of [{hash:'changed'},{project:'other'},{requires:[{providedBy:null}]},{implementerBlockers:[{iid:null}]}]) assert.throws(()=>recordedGraph({...m,...patch},'p',11,'h','head'));
});

test('a landed observation must match the exact owned head, member, stable repository and destination',()=>{
  const b={id:'a',repositoryId:'r',destinationRef:'d',expectedHead:'1'.repeat(40),members:[1,2]};
  const landed={state:'landed' as const,batch:'a',repositoryId:'r',destination:'d',observedHead:b.expectedHead,iid:1,commit:'2'.repeat(40)};
  const check=(o:DeliveryObserver)=>prerequisiteHold(b,[1],o,()=>assert.fail('must not use tracker closure for members'));
  assert.equal(check(()=>landed),undefined);assert.match(check(unavailableDelivery)!,/unavailable/);
  for(const patch of [{batch:'b'},{repositoryId:'other'},{destination:'other'},{observedHead:'2'.repeat(40)},{iid:2},{commit:''}]) assert.match(check(()=>({...landed,...patch}))!,/mismatch/);
});

for(const kind of ['github','gitlab'] as const) test(`${kind}: fixed batch dispatch and continuation claim only eligible members; approvals, missing facts, conflicts and stopped prerequisites hold`,async t=>{
  const {p}=home(t,'batch-dispatch-'),root=join(p.home,'project'),server=join(p.home,'remote'),bin=join(p.home,'bin');
  mkdirSync(join(root,'.factory'),{recursive:true});mkdirSync(bin);symlinkSync('/usr/bin/git',join(bin,'git'));
  const stub=(name:string,body:string)=>writeFileSync(join(bin,name),`#!${process.execPath}\n${body}`,{mode:0o755});
  const env={HOME:p.home,FACTORY_HOME:p.home,PATH:bin,SANDCASTLE_STATE_DIR:p.state,GIT_SSH:join(bin,'ssh'),GIT_SSH_VARIANT:'simple',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  for(const [k,v] of Object.entries(env)) set(k,v);
  const before=process.cwd();process.chdir(root);t.after(()=>process.chdir(before));
  function set(k:string,v:string){const old=process.env[k];process.env[k]=v;t.after(()=>{if(old===undefined)delete process.env[k];else process.env[k]=old})}
  stub('ssh',`const a=process.argv.slice(2);if(a.length!==2||a[0]!=='git@fixture.test'||!/^git-(upload|receive)-pack 'org\\/repo\\.git'$/.test(a[1]))process.exit(80);process.exit(require('node:child_process').spawnSync('/usr/bin/git',[a[1].split(' ')[0].slice(4),${JSON.stringify(server)}],{stdio:'inherit'}).status??1);`);
  const calls=join(bin,'calls');
  stub('gh',`const a=process.argv.slice(2),s=a.join(' ');require('node:fs').appendFileSync(${JSON.stringify(calls)},s+'\\n');const out=v=>console.log(JSON.stringify(v));
    const desc=n=>n===12?'Depends on: #11':n===16?'Blocked by: #12':n===90?'Parent requirements': 'Implement '+n;
    if(s.startsWith('api graphql --hostname')){const n=Number(/issue\\(number:(\\d+)/.exec(s)?.[1]);out({data:{viewer:{id:'V'},repository:{id:'R',nameWithOwner:'org/repo',issue:{number:n,state:'OPEN',subIssues:{totalCount:0}}}}})}
    else if(s.startsWith('api graphql')){const n=Number(/issue\\(number: (\\d+)/.exec(s)?.[1]);out({data:{repository:{issue:{parent:n===11?{number:90}:null}}}})}
    else if(s.startsWith('issue view')){const n=Number(a[2]);out({number:n,title:'ticket'+n,body:desc(n),state:'OPEN',labels:n===99?[{name:'ready-for-agent'}]:[]})}
    else if(a[0]==='api' && a[1].includes('/dependencies/blocked_by?')){const n=Number(a[1].split('/')[4]);if(n===14)process.exit(1);out(n===13?[{number:77,html_url:'https://fixture.test/org/repo/issues/77'}]:[])}
    else if(a[0]==='api' && a[1].includes('/comments?'))out([]);
    else if(a[0]==='api' && /issues\\/\\d+$/.test(a[1])){const n=Number(a[1].split('/').at(-1));out({number:n,title:'ticket'+n,body:desc(n),issue_dependencies_summary:{total_blocked_by:n===13?1:0}})}
    else process.exit(88);`);
  stub('glab',`const a=process.argv.slice(2),s=a.join(' ');require('node:fs').appendFileSync(${JSON.stringify(calls)},s+'\\n');const out=v=>console.log(JSON.stringify(v));
    const desc=n=>n===12?'Depends on: #11':n===16?'Blocked by: #12':n===90?'Parent requirements':'Implement '+n;
    if(a[1]==='graphql'){const iid=/iids:\\s*\\["(\\d+)"/.exec(s)?.[1]??'0',name=iid==='11'?'Task':'Issue';out({data:{currentUser:{id:'U'},project:{id:'gid://gitlab/Project/42',fullPath:'org/repo',workItems:{nodes:[{iid,state:'OPEN',workItemType:{name},widgets:[{__typename:'WorkItemWidgetHierarchy',parent:iid==='11'?{iid:'90'}:null,children:{pageInfo:{hasNextPage:false},nodes:[]}}]}]}}}})}
    else if(a[1].includes('/links?')){const n=Number(a[1].split('/')[3]);if(n===14)process.exit(1);out(n===13?[{iid:77,project_id:42,link_type:'is_blocked_by'}]:[])}
    else if(a[1].includes('/notes?'))out([]);
    else if(/^projects\\/42\\/issues\\/\\d+$/.test(a[1])){const n=Number(a[1].split('/').at(-1));out({iid:n,project_id:42,title:'ticket'+n,description:desc(n),state:'opened',labels:n===99?['ready-for-agent']:[]})}
    else process.exit(89);`);
  const git=(...args:string[])=>execFileSync('/usr/bin/git',['-C',root,'-c','user.name=fixture','-c','user.email=f@example.org',...args],{stdio:'pipe'});
  git('init','-b','main');git('commit','--allow-empty','-m','base');git('init','--bare','-b','main',server);git('remote','add','origin','git@fixture.test:org/repo.git');git('push','origin','main');
  writeFileSync(join(root,'.factory/factory.toml'),factoryToml('org/repo',{kind,host:'fixture.test'})+'\n[ci]\nbatch_test_argv=["true"]\nbatch_test_paths=["tests"]\n[dispatch]\nmax_concurrent=2\n');addProject(p,root);
  await install(p,new Fake(p),{schedule:new FakeSchedule(p)});
  const b=submitBatch(p,'project',['11','12','13','14','15','16']);
  git('commit','--allow-empty','-m','fixture candidate 11');const candidate=git('rev-parse','HEAD').toString().trim();
  const launches:number[]=[];
  const obs:DeliveryObserver=(scope,iid)=>iid===11 && scope.expectedHead===candidate?{state:'landed',iid,batch:scope.id,repositoryId:scope.repositoryId,destination:scope.destinationRef,observedHead:scope.expectedHead,commit:candidate}:unavailableDelivery(scope,iid);
  const pass=()=>dispatchBatch(p,'project',b.id,obs,{image:async()=>({ok:true,imageId:'sha256:'+'1'.repeat(64),cached:false}),load:async()=>async input=>{
    const iid=input.ticket.context.child.iid;launches.push(iid);
    assert.ok(readRuns(p.state,false).some(r=>r.iid===String(iid)&&r.claim===input.run));
    if(iid===11) assert.match(input.ticket.text,/Parent requirements/);
    return {status:iid===12?'stopped':'approved',reason:'fixture gate',binding:{attempt:'fixture'}};
  }});
  const hold=(n:number)=>JSON.parse(readFileSync(join(p.state,'batches',b.id,`selection-${n}.json`),'utf8')).reason;
  await pass();assert.deepEqual(launches,[11]);assert.match(hold(12),/delivery observation unavailable/);assert.match(hold(13),/#77.*not submitted/);assert.match(hold(14),/blocker|blocked_by|links/i);assert.match(hold(15),/Footprint/);
  const saturate=(n:number)=>claimRun({dir:p.state,project:`other${n}`,iid:'1',pid:process.pid,cap:2});
  assert.equal(saturate(1).ok,true);assert.equal(saturate(2).ok,true);
  assert.equal(advanceBatch(p,'project',b.id,b.expectedHead,candidate).expectedHead,candidate);
  assert.equal(git('ls-remote','--refs','origin',b.destinationRef).toString().trim(),`${candidate}\t${b.destinationRef}`);
  await pass();assert.match(hold(12),/capacity/);assert.deepEqual(launches,[11]);
  // Free only the fixture claims by using the real normal parked transition instead of editing admission state.
  const board=await import('../../board/board.mts');for(const n of [1,2]){board.setProject(`other${n}`);board.holdClaim(readRuns(p.state,false).find(r=>r.project===`other${n}`)!.claim);board.setStage('1',{stage:'waiting'})}board.holdClaim(undefined);
  await pass();assert.deepEqual(launches,[11,12,15]);assert.match(hold(16),/#12.*stopped/);
  assert.deepEqual(readRuns(p.state,false).filter(r=>r.project==='org/repo').map(r=>r.iid).sort(),['11','12','15']);
  for(const cmd of ['dispatch','tick']) {
    const out=execFileSync(process.execPath,[p.bin,cmd,'--project','project','--batch',b.id],{encoding:'utf8',stdio:'pipe'});
    assert.match(out,/#11 waiting: Gate approved; awaiting observed delivery/);assert.match(out,/#13 held: Waiting on #77/);
    assert.match(hold(16),/#12.*stopped/);
    assert.deepEqual(readRuns(p.state,false).filter(r=>r.project==='org/repo').map(r=>r.iid).sort(),['11','12','15']);
  }
  const requests=readFileSync(calls,'utf8');assert.match(requests,kind==='github'?/issue view 77 /:/projects\/42\/issues\/77 /);assert.doesNotMatch(requests,/issue list|issue view 99 |issue\(number:99\)|issues\/99/);
});
