// Real submit/ownership reads, local Git and shared claim ledger; only tracker transport, image/gate and delivery authority are doubles.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {mkdirSync,readFileSync,readdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {withAdmission,writeBaselineReservations,ownerOf,readAdmission} from '../../board/admission.mts';
import {home} from './schedule-helpers.mts';
import {install} from './runtime-fixture.mts';
import {installBatchFixture} from '../../orchestrator/fixtures/batch-review.mts';
import {Fake,FakeSchedule} from '../src/platform/fake.mts';
import {factoryToml} from './config-fixture.mts';
import {addProject} from '../src/projects.mts';
import {advanceBatch,submitBatch} from '../src/batch.mts';
import {dispatchBatch} from '../src/batch-dispatch.mts';
import {freezeTicketInput} from '../../orchestrator/ticket-input.mts';
import {commandContextSource} from '../../orchestrator/ticket-context-source.mts';
import {claimRun,keyFor,readRuns} from '../../board/board.mts';
import {batchLinks,gitlabBlockerIds} from '../../orchestrator/batch-links.mts';
import {nativeGithub} from '../../orchestrator/selection-tracker.github.mts';
import {nativeGitlab} from '../../orchestrator/selection-tracker.gitlab.mts';
import {dependencyState} from '../../orchestrator/dependencies.mts';
import {loadTomlConfig} from '../../orchestrator/project-config.mts';
import {declaredBlockers,prerequisiteHold,recordedGraph,unavailableDelivery,type DeliveryObserver} from '../../orchestrator/batch-selection.mts';

test('batch claim leaves an unrelated dead starting reservation byte-for-byte intact',t=>{
  const {p}=home(t);mkdirSync(p.state,{recursive:true});const file=join(p.state,'outside--9.json');
  const bytes=JSON.stringify({iid:'9',project:'outside',stage:'setup',starting:true,pid:2147483647});writeFileSync(file,bytes);
  const claim=()=>claimRun({dir:p.state,project:'org/repo',iid:'11',cap:1,pid:process.pid,patch:{batchMember:{id:'batch',repositoryId:'repo',footprint:['*']}}});
  for(const pid of [process.pid,0]) {writeFileSync(file,JSON.stringify({...JSON.parse(bytes),pid}));assert.equal(claim().ok,false);}
  writeFileSync(file,bytes);
  withAdmission(p.state,tx=>{tx.state.claims['outside--9']={project:'outside',iid:'9',token:'live',owner:{pid:process.pid},kind:'normal',at:'now'};tx.commit()});
  assert.equal(claim().ok,false);withAdmission(p.state,tx=>{delete tx.state.claims['outside--9'];tx.commit()});
  withAdmission(p.state,()=>writeBaselineReservations(p.state,[{executionId:'cleanup',ownerId:'o',generation:'g',project:{root:join(p.home,'outside'),tracker:{kind:'github',host:'fixture',project:'outside'}},iid:'9',engine:'e',name:'n',intentDigest:'i',tokenDigest:'t',deadline:1}]));
  assert.equal(claim().ok,false,'a dead controller cannot free a cleanup reservation');withAdmission(p.state,()=>writeBaselineReservations(p.state,[]));
  assert.equal(claim().ok,true);assert.equal(readFileSync(file,'utf8'),bytes);
});

test('native blocker reads exhaust pages, skip reverse/non-blocking GitLab links and never localize foreign IDs',()=>{
  {
    const repo={kind:'github' as const,project:'org/r',host:'h'};
    const page=Array.from({length:100},(_,i)=>({number:i+1,html_url:`https://h/org/r/issues/${i+1}`}));
    assert.deepEqual(batchLinks(111,repo,path=>path.endsWith('page=1')?page:[]),page.map((_,i)=>i+1));
    for(const bad of [null,[{}],[{...page[0],html_url:'https://h/other/issues/1',project_id:55}]])assert.throws(()=>batchLinks(111,repo,()=>bad));
    assert.throws(()=>batchLinks(111,repo,path=>path.endsWith('page=1')?page:null));
  }
  const incoming={iid:1,project_id:5,link_type:'is_blocked_by',state:'opened'};
  const links=[incoming,{...incoming,iid:2,state:'closed'},{link_type:'blocks'},{link_type:'relates_to'}];
  assert.deepEqual(gitlabBlockerIds(links,5,1),[1,2]);
  for(const count of [null,undefined,0,2]) assert.throws(()=>gitlabBlockerIds(links,5,count),/blocker inventory/i);
  for(const patch of [{state:null},{project_id:55},{link_type:'unknown'}]) assert.throws(()=>gitlabBlockerIds([{...incoming,...patch}],5,1));
  assert.throws(()=>gitlabBlockerIds([incoming,incoming],5,2));
  assert.deepEqual(declaredBlockers('**Depends on:** #1 (description), #2'),[1,2]);
  assert.throws(()=>declaredBlockers('Blocked by: org/other#2'));
});

test('recorded providers and implementer blockers are never expanded; unsafe or stale graph facts do not narrow reservations',()=>{
  const m={iid:11,project:'p',hash:'h',baseSha:'head',base:'main',analyzedAt:new Date().toISOString(),catalogueIids:[],blockerHashes:{},provides:[],policyIdentity:'current',footprint:['code/'],requires:[{providedBy:44,what:'file',evidence:'ticket',confidence:1}],implementerBlockers:[{iid:55,what:'file',evidence:'ticket'}]};
  for(const bad of [false,0,'',null,[],{}, {...m,footprint:false},{...m,implementerBlockers:null},{...m,blockerHashes:[]}]) assert.throws(()=>recordedGraph(bad as any,'p',11,'h','head','current'),/graph/i);
  assert.deepEqual(recordedGraph(m,'p',11,'h','head','current'),{blockers:[44,55],footprint:['code/']});
  assert.deepEqual(recordedGraph(m,'p',11,'h','moved','current').footprint,['*']);
  for(const policyIdentity of [undefined,'old']) assert.deepEqual(recordedGraph({...m,policyIdentity},'p',11,'h','head','current'),{blockers:[44,55],footprint:['*']});
  for(const patch of [{hash:'changed'},{project:'other'},{requires:[{providedBy:null}]},{implementerBlockers:[{iid:null}]}]) assert.throws(()=>recordedGraph({...m,...patch},'p',11,'h','head','current'));
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
    const desc=n=>n===12?'Depends on: #11':n===16?'Blocked by: #12':n===22?'Depends on: #77':n===92?'Depends on: #78':n===90?'Parent requirements': 'Implement '+n;
    if(s.startsWith('api graphql --hostname')){const n=Number(/issue\\(number:(\\d+)/.exec(s)?.[1]);out({data:{viewer:{id:'V'},repository:{id:'R',nameWithOwner:'org/repo',issue:{number:n,state:'OPEN',subIssues:{totalCount:0}}}}})}
    else if(s.startsWith('api graphql')){const n=Number(/issue\\(number: (\\d+)/.exec(s)?.[1]);out({data:{repository:{id:'R',nameWithOwner:'org/repo',issue:{parent:n===11||n===26?{number:n===11?90:92,...(s.includes('parent { number repository { id nameWithOwner }')?{repository:{id:'R',nameWithOwner:'org/repo'}}:{})}:n===23?{number:79,repository:{id:'foreign',nameWithOwner:'org/other'}}:n===24?{number:79}:null}}}})}
    else if(s.startsWith('issue view')){const n=Number(a[2]);out({number:n,title:'ticket'+n,body:desc(n),state:n===77&&process.env.RESOLVED_EXTERNAL?'CLOSED':'OPEN',labels:n===99?[{name:'ready-for-agent'}]:[]})}
    else if(a[0]==='api' && a[1].includes('/dependencies/blocked_by?')){const n=Number(a[1].split('/')[4]);if(n===14)process.exit(1);out(n===13?[{number:77,html_url:'https://fixture.test/org/repo/issues/77'}]:[])}
    else if(a[0]==='api' && a[1].includes('/comments?'))out([]);
    else if(a[0]==='api' && /issues\\/\\d+$/.test(a[1])){const n=Number(a[1].split('/').at(-1));out({number:n,title:'ticket'+n,body:desc(n),issue_dependencies_summary:{total_blocked_by:n===13?1:0}})}
    else if(a[0]==='pr' && a[1]==='list' && a.includes('--head') && a[a.indexOf('--head')+1]==='provider' && a[a.indexOf('--base')+1]==='recorded')out([{number:7,state:'MERGED',baseRefName:process.env.ACTUAL_MERGE_BASE,headRefName:'provider',isCrossRepository:false}]);
    else process.exit(88);`);
  stub('glab',`const a=process.argv.slice(2),s=a.join(' ');require('node:fs').appendFileSync(${JSON.stringify(calls)},s+'\\n');const out=v=>console.log(JSON.stringify(v));
    const desc=n=>n===12?'Depends on: #11':n===16?'Blocked by: #12':n===22?'Depends on: #77':n===92?'Depends on: #78':n===90?'Parent requirements':'Implement '+n;
    if(a[1]==='graphql'){const iid=/iids:\\s*\\["(\\d+)"/.exec(s)?.[1]??'0',name=['11','26','27','28'].includes(iid)?'Task':'Issue';out({data:{currentUser:{id:'U'},project:{id:'gid://gitlab/Project/42',fullPath:'org/repo',workItems:{nodes:[{iid,state:'OPEN',workItemType:{name},widgets:[{__typename:'WorkItemWidgetLinkedItems',...(s.includes('... on WorkItemWidgetLinkedItems {blockedByCount}')?{blockedByCount:iid==='23'?null:iid==='13'||iid==='24'?1:0}:{})},{__typename:'WorkItemWidgetHierarchy',parent:name==='Task'?{iid:iid==='11'?'90':iid==='26'?'92':'79',...(s.includes('parent { iid project { id fullPath }')?{project:iid==='28'?null:{id:iid==='27'?'gid://gitlab/Project/43':'gid://gitlab/Project/42',fullPath:iid==='27'?'org/other':'org/repo'}}:{})}:null,children:{pageInfo:{hasNextPage:false},nodes:[]}}]}]}}}})}
    else if(a[1].endsWith('/links')){const n=Number(a[1].split('/')[3]);if(n===14)process.exit(1);out(n===13?[{iid:77,project_id:42,link_type:'is_blocked_by',state:'opened'}]:[])}
    else if(a[1].includes('/notes?'))out([]);
    else if(a[1].startsWith('projects/42/merge_requests?state=merged&source_branch=provider&target_branch=recorded&'))out([{iid:7,state:'merged',source_project_id:42,target_project_id:42,source_branch:'provider',target_branch:process.env.ACTUAL_MERGE_BASE}]);
    else if(/^projects\\/42\\/issues\\/\\d+$/.test(a[1])){const n=Number(a[1].split('/').at(-1));if(n===22&&process.env.HIDE_SUBMITTED)process.exit(1);out({iid:n,project_id:42,title:'ticket'+n,description:desc(n),state:n===77&&process.env.RESOLVED_EXTERNAL?'closed':'opened',labels:n===99?['ready-for-agent']:[]})}
    else process.exit(89);`);
  const git=(...args:string[])=>execFileSync('/usr/bin/git',['-C',root,'-c','user.name=fixture','-c','user.email=f@example.org',...args],{stdio:'pipe'});
  git('init','-b','main');git('commit','--allow-empty','-m','base');git('init','--bare','-b','main',server);git('remote','add','origin','git@fixture.test:org/repo.git');git('push','origin','main');
  writeFileSync(join(root,'.factory/factory.toml'),factoryToml('org/repo',{kind,host:'fixture.test'})+'\n[ci]\nbatch_test_argv=["true"]\nbatch_test_paths=["tests"]\n[dispatch]\nmax_concurrent=2\n');addProject(p,root);
  await install(p,new Fake(p),{schedule:new FakeSchedule(p)});
  await t.test('an open external provider needs its recorded source AND recorded merge destination',()=>{
    const adapter=(kind==='github'?nativeGithub:nativeGitlab)(loadTomlConfig(join(root,'.factory')));
    const state=()=>dependencyState(77,{ticket:i=>adapter.ticket(i,true),run:()=>({branch:'provider',base:'recorded'}),base:'other',mergedInto:adapter.mergedInto}).state;
    set('ACTUAL_MERGE_BASE','other');assert.equal(state(),'unsatisfied');process.env.ACTUAL_MERGE_BASE='recorded';assert.equal(state(),'satisfied');
  });
  // Run the installed CLI with only fixture executables. The fake Pi records the shared token held during its turn and stops there.
  const turns=join(bin,'claimed-turns'), dockerFixture=new URL('../../orchestrator/fixtures/capability-docker.mjs',import.meta.url).href;
  const checkout=await installBatchFixture(p.home,['true'],()=>{throw Error('Unexpected review')});t.after(checkout.close);
  stub('docker',`import(${JSON.stringify(dockerFixture)}).then(m=>{const a=process.argv.slice(2);const s=m.capabilityDocker(a,${JSON.stringify(bin)});
    if(s!==undefined)console.log(s);else process.exitCode=require('node:child_process').spawnSync(${JSON.stringify(join(checkout.bin,'docker'))},a,{stdio:'inherit',env:{PATH:process.env.PATH}}).status??94;})`);
  stub('pi',`const fs=require('node:fs');const dir=${JSON.stringify(p.state)};for(const file of fs.readdirSync(dir).filter(f=>/^org_repo--[0-9]+\\.json$/.test(f))){const r=JSON.parse(fs.readFileSync(dir+'/'+file));if(r.claim)fs.appendFileSync(${JSON.stringify(turns)},JSON.stringify([r.iid,r.claim])+'\\n')}process.stdin.resume();process.exitCode=1;`);
  const malformed=kind==='github'?['{','0','""','null','[]','{"requires":false}']:[];
  const badIds=malformed.map((_,i)=>String(40+i));
  const installed=submitBatch(p,'project',['23','24',...(kind==='gitlab'?['27','28']:[]),...badIds,'25','26','21','22']);
  const graphDir=join(p.state,'graph');mkdirSync(graphDir,{recursive:true});
  writeFileSync(join(graphDir,keyFor('25','org/repo')+'.json'),'false');
  malformed.forEach((bytes,i)=>writeFileSync(join(graphDir,keyFor(badIds[i],'org/repo')+'.json'),bytes));
  const cmd=(command:string,extra={})=>execFileSync(process.execPath,[p.bin,command,'--project','project','--batch',installed.id],{encoding:'utf8',env:{...process.env,OPENAI_API_KEY:'fixture-only',...extra}});
  const ledger=()=>readRuns(p.state,false).filter(r=>r.batchMember?.id===installed.id).map(r=>[r.iid,r.executionId]).sort();
  if(kind==='gitlab') {
    assert.match(cmd('dispatch',{HIDE_SUBMITTED:'1'}),/#21 held: .*blocker inventory.*#22/i);
    assert.deepEqual(ledger(),[],'zero open blockers cannot disprove a hidden, closed member edge');
  }
  const firstPass=cmd('dispatch');assert.match(firstPass,/#22 held: Waiting on #77/);
  for(const iid of [23,24]) assert.match(firstPass,new RegExp(`#${iid} held: .*${kind==='gitlab'?'blocker inventory':'parent'}`,'i'));
  for(const n of ['25',...badIds]) {
    const hold=JSON.parse(readFileSync(join(p.state,'batches',installed.id,`selection-${n}.json`),'utf8'));
    assert.equal(hold.status,'held');assert.match(hold.reason,/graph/i);assert.match(hold.nextAction,/inspect/i);
  }
  assert.match(firstPass,/#25 held: .*graph/i);assert.match(firstPass,/#26 held: Waiting on #78/,'dependency comes only from the parent');
  if(kind==='gitlab') for(const n of [27,28]) assert.match(firstPass,new RegExp(`#${n} held: .*parent`,'i'));
  assert.doesNotMatch(readFileSync(calls,'utf8'),/issues\/79\b|issue view 79\b/,'foreign/unknown parent must not resolve the local decoy');
  assert.deepEqual(ledger().map(r=>r[0]),['21']);const firstToken=ledger()[0][1];
  cmd('tick',{RESOLVED_EXTERNAL:'1'});const final=ledger();assert.deepEqual(final.map(r=>r[0]),['21','22']);assert.equal(final[0][1],firstToken);assert.notEqual(final[1][1],firstToken);
  assert.deepEqual(readFileSync(turns,'utf8').trim().split('\n').map(s=>JSON.parse(s)),final);
  const b=submitBatch(p,'project',['11','12','13','14','15','16']);
  const source=commandContextSource({kind,host:'fixture.test',project:'org/repo'},42,process.env,b.repositoryId);
  const policy=readRuns(p.state,false).find(r=>r.iid==='21')!.batchMember!.policyIdentity;
  for(const [iid,path] of [[11,'only-one-path'],[12,'old-path'],[15,'newly-touched']] as const) {
    const hash=freezeTicketInput(source,iid).hash;
    writeFileSync(join(graphDir,keyFor(String(iid),'org/repo')+'.json'),JSON.stringify({iid,project:'org/repo',hash,base:'main',analyzedAt:new Date().toISOString(),provides:[],catalogueIids:[],blockerHashes:{},baseSha:b.expectedHead,policyIdentity:iid===12?'old':policy,footprint:[path],requires:[]}));
  }
  writeFileSync(join(root,'newly-touched'),'candidate 11');git('add','newly-touched');git('commit','-m','fixture candidate 11');const candidate=git('rev-parse','HEAD').toString().trim();
  const launches:number[]=[];
  const obs:DeliveryObserver=(scope,iid)=>scope.id===b.id && iid===11 && scope.expectedHead===candidate?{state:'landed',iid,batch:scope.id,repositoryId:scope.repositoryId,destination:scope.destinationRef,observedHead:scope.expectedHead,commit:candidate}:unavailableDelivery(scope,iid);
  const pass=()=>dispatchBatch(p,'project',b.id,obs,{image:async()=>({ok:true,imageId:'sha256:'+'1'.repeat(64),cached:false}),load:async()=>async input=>{
    const iid=input.ticket.context.child.iid;launches.push(iid);
    const run=readRuns(p.state,false).find(r=>r.iid===String(iid)&&r.claim===input.run);assert.match(run?.batchMember?.policyIdentity??'',/^[a-f0-9]{64}$/);
    if(iid===11) {assert.match(input.ticket.text,/Parent requirements/);assert.deepEqual(run?.batchMember?.footprint,['only-one-path'],'the prediction underestimated the edit');}
    if(iid===15) assert.deepEqual(run?.batchMember?.footprint,['newly-touched'],'missing gate scope must supersede even a narrow prediction');
    return {status:iid===12?'stopped':'approved',reason:'fixture gate',binding:{attempt:'fixture',...(iid===11?{expectedHead:input.expectedHead,candidate,run:input.run,ticket:iid,batch:b.id,project:`${kind}://fixture.test/org/repo`,destination:b.destinationRef,requirementsDigest:input.ticket.hash}:{})}};
  }});
  const hold=(n:number)=>JSON.parse(readFileSync(join(p.state,'batches',b.id,`selection-${n}.json`),'utf8')).reason;
  await pass();assert.deepEqual(launches,[11]);assert.match(hold(12),/delivery observation unavailable/);assert.match(hold(13),/#77.*not submitted/);assert.match(hold(14),/blocker|blocked_by|links/i);assert.match(hold(15),/Footprint.*newly-touched/);assert.deepEqual(readRuns(p.state,false).find(r=>r.iid==='11')!.batchMember!.footprint,['newly-touched']);
  const saturate=(n:number)=>claimRun({dir:p.state,project:`other${n}`,iid:'1',pid:process.pid,cap:2});
  assert.equal(saturate(1).ok,true);assert.equal(saturate(2).ok,true);
  assert.equal(advanceBatch(p,'project',b.id,b.expectedHead,candidate).expectedHead,candidate);
  assert.equal(git('ls-remote','--refs','origin',b.destinationRef).toString().trim(),`${candidate}\t${b.destinationRef}`);
  await pass();assert.match(hold(12),/capacity/);assert.deepEqual(launches,[11]);
  // Free only the fixture claims by using the real normal parked transition instead of editing admission state.
  const board=await import('../../board/board.mts');for(const n of [1,2]){board.setProject(`other${n}`);board.holdClaim(readRuns(p.state,false).find(r=>r.project===`other${n}`)!.claim);board.setStage('1',{stage:'waiting'})}board.holdClaim(undefined);
  // The first batch's landed prerequisite still has its approval card. Its observer may release that footprint, not transfer write authority.
  const other=submitBatch(p,'project',['31']);
  const runOther=(observer:DeliveryObserver)=>dispatchBatch(p,'project',other.id,observer,{image:async()=>({ok:true,imageId:'sha256:'+'1'.repeat(64),cached:true}),load:async()=>async()=>({status:'stopped',reason:'fixture',binding:{attempt:'another'}})});
  await runOther(unavailableDelivery);assert.ok(!readRuns(p.state,false).some(r=>r.iid==='31'));
  await runOther(obs);assert.equal(readRuns(p.state,false).find(r=>r.iid==='31')?.batchMember?.id,other.id);
  const m15=join(graphDir,keyFor('15','org/repo')+'.json');
  writeFileSync(m15,JSON.stringify({...JSON.parse(readFileSync(m15,'utf8')),baseSha:candidate}));
  await pass();assert.deepEqual(launches,[11,12,15]);assert.match(hold(16),/#12.*stopped/);
  assert.deepEqual(readRuns(p.state,false).filter(r=>r.project==='org/repo').map(r=>r.iid).sort(),['11','12','15','21','22','31']);
  for(const cmd of ['dispatch','tick']) {
    const out=execFileSync(process.execPath,[p.bin,cmd,'--project','project','--batch',b.id],{encoding:'utf8',stdio:'pipe'});
    assert.match(out,/#11 waiting: Gate approved; awaiting observed delivery/);assert.match(out,/#13 held: Waiting on #77/);
    assert.match(hold(16),/#12.*stopped/);
    assert.deepEqual(readRuns(p.state,false).filter(r=>r.project==='org/repo').map(r=>r.iid).sort(),['11','12','15','21','22','31']);
  }
  const lastGate=readRuns(p.state,false).find(r=>r.iid==='15')!.batchMember!;assert.equal(lastGate.gate,'approved');assert.deepEqual(lastGate.footprint,['*'],'missing candidate scope remains reserved');
  await t.test('managed-entry refusal refreshes only idle member observations',async()=>{
    const state=(n:number)=>join(p.state,'batches',b.id,`selection-${n}.json`),owner=ownerOf(process.pid);
    const identity={root,tracker:{kind,host:'fixture.test',project:'org/repo'}};
    const admissionBefore=readAdmission(p.state),before=readRuns(p.state,false),terminal=readFileSync(state(12),'utf8');
    withAdmission(p.state,tx=>{tx.state.supervisorHolds.fixture={id:'fixture',project:identity,owner,invocationId:'inv',fence:'f',pending:[],settled:[]};tx.commit()});
    await assert.rejects(pass,/supervisor/i);assert.match(hold(13),/supervisor/i);assert.equal(readFileSync(state(12),'utf8'),terminal);
    withAdmission(p.state,tx=>{delete tx.state.supervisorHolds.fixture;writeBaselineReservations(p.state,[{executionId:'baseline',ownerId:'o',generation:'g',project:identity,iid:'99',engine:'e',name:'name',intentDigest:'i',tokenDigest:'t',deadline:1}]);tx.commit()});
    await assert.rejects(pass,/cleanup/i);assert.match(hold(13),/cleanup/i);
    withAdmission(p.state,tx=>{tx.state.entries.active={id:'active',owner,project:identity};tx.commit()});
    const active='{"status":"held","reason":"active pass owns this observation"}';writeFileSync(state(13),active);
    await assert.rejects(pass,/cleanup/i);assert.equal(readFileSync(state(13),'utf8'),active);
    const audit=join(p.state,'batches',b.id);
    const receipts=readdirSync(audit).filter(f=>f.startsWith('entry-refused-')).map(f=>JSON.parse(readFileSync(join(audit,f),'utf8')));
    assert.equal(receipts.length,3);assert.equal(receipts.filter(r=>/cleanup/i.test(r.reason)).length,2);
    for(const receipt of receipts){assert.deepEqual(receipt.members,b.members);assert.equal(receipt.batch,b.id);assert.equal(receipt.status,'admission-held');}
    const after=readAdmission(p.state);assert.deepEqual(after.claims,admissionBefore.claims);assert.deepEqual(after.generations,admissionBefore.generations);
    assert.deepEqual(readRuns(p.state,false),before);assert.equal(readFileSync(state(12),'utf8'),terminal);
  });
  const requests=readFileSync(calls,'utf8');assert.match(requests,kind==='github'?/issue view 77 /:/projects\/42\/issues\/77 /);assert.doesNotMatch(requests,/issue list|issue view 99 |issue\(number:99\)|issues\/99/);
});
