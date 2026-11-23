// Exact gate policy and the admitted host path across fixture-owned Git, tracker, engine and reviewer boundaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { execFile,execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { unlinkSync as fsUnlink, existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { home } from './schedule-helpers.mts';
import { factoryToml } from './config-fixture.mts';
import { keyFor,ownerOf,withAdmission,writeDurable } from '../../board/admission.mts';
import { commandContextSource } from '../../orchestrator/ticket-context-source.mts';
import { freezeTicketInput } from '../../orchestrator/ticket-input.mts';
import { addProject } from '../src/projects.mts';
import { installBatchFixture } from '../../orchestrator/fixtures/batch-review.mts';
import { requireDeliveryEvidence } from '../src/batch-delivery.mts';
import { BATCH_EVIDENCE_VERSION, type AttemptBinding, type BatchEvidence } from '../../orchestrator/batch-review.mts';

test('only exact host tests and two independent approvals on the latest attempt authorize the selected write',()=>{
  const b:AttemptBinding={project:'github://fixture/org/p',batch:'batch',ticket:7,run:'run',attempt:randomUUID(),destination:'refs/heads/factory/batch/batch',expectedHead:'a'.repeat(40),requirementsDigest:'f'.repeat(64),gate:{image:'sha256:'+'2'.repeat(64),configDigest:'3'.repeat(64),argv:['test'],paths:['tests']},candidate:'b'.repeat(40),deltaBase:'a'.repeat(40),deltaTip:'c'.repeat(40)};
  const e:BatchEvidence={version:BATCH_EVIDENCE_VERSION,binding:b,tests:{binding:b,exit:0,stdout:'',stderr:'',argv:b.gate.argv},reviews:(['test','code'] as const).map(role=>({binding:b,role,invocation:randomUUID(),verdict:'approve',reason:'pass'})),status:'approved',reason:'not delivered'};
  const check=(e:BatchEvidence)=>requireDeliveryEvidence(b,{binding:b,evidence:e});check(e);
  for(const change of [(r:any)=>delete r.tests,(r:any)=>r.tests.exit=1,(r:any)=>r.tests.exit=null,(r:any)=>r.tests.argv=['wrong'],(r:any)=>r.reviews.pop(),(r:any)=>r.reviews.shift(),(r:any)=>r.reviews[1].role='test',(r:any)=>r.reviews[1].invocation=r.reviews[0].invocation,(r:any)=>r.reviews[0].verdict='inconclusive',(r:any)=>r.reviews[1].verdict='reject',(r:any)=>r.version='legacy',(r:any)=>r.status='rebuild']){
    const changed=JSON.parse(JSON.stringify(e));change(changed);assert.throws(()=>check(changed));
  }
  for(const key of ['requirementsDigest','gate','run','attempt','candidate','destination','batch','expectedHead','ticket','project','deltaTip','deltaBase']){
    for(const select of [(r:any)=>r.tests,(r:any)=>r.reviews[0],(r:any)=>r.reviews[1]]){const copy=JSON.parse(JSON.stringify(e));select(copy).binding[key]='stale';assert.throws(()=>check(copy))}
    assert.throws(()=>requireDeliveryEvidence({...b,[key]:'stale'},{binding:b,evidence:e}));
  }
  assert.throws(()=>requireDeliveryEvidence(b,null));assert.throws(()=>requireDeliveryEvidence(b,{binding:b,evidence:null}));
});

async function journey(t:TestContext,kind:'github'|'gitlab') {
  const {p}=home(t,'exact-batch-'),root=join(p.home,'project'),server=join(p.home,'origin.git'),bin=join(p.home,'bin');
  mkdirSync(join(root,'.factory'),{recursive:true});mkdirSync(bin);
  const facts=join(p.home,'issue'),updates=join(p.home,'updates'),pushes=join(p.home,'pushes');
  const reset=(overrides={})=>writeFileSync(facts,JSON.stringify({parent:'Parent requirements',done:false,deny:false,...overrides}));reset();
  const lines=(f:string)=>existsSync(f)?readFileSync(f,'utf8').trim().split('\n').filter(Boolean):[];
  const args=['node','check.cjs'], rejectMarker=join(p.home,'reject-rebuild'), image=join(p.home,'image-id');let invalidate=false;
  writeFileSync(image,'sha256:'+'a'.repeat(64)+'\n');
  const agents=await installBatchFixture(p.home,args,()=>{if(invalidate)reset({parent:'Edited parent'});return existsSync(rejectMarker)?{verdict:'reject',reason:'Rebuilt candidate still deficient'}:{verdict:'approve',reason:'Exact candidate passed'}},`const {feedback}=JSON.parse(prompt.split('Host proposal input:\\n').at(-1));console.log(JSON.stringify({edits:[{path:'api.cjs',content:'module.exports=1;// '+(feedback?.attempt??'initial')}]}))`);t.after(agents.close);
  const stub=(name:string,text:string)=>writeFileSync(join(bin,name),text,{mode:0o700});
  stub(kind==='github'?'gh':'glab',`#!${process.execPath}\n`+readFileSync(new URL('./fixtures/batch-delivery-tracker.cjs',import.meta.url),'utf8'));
  stub(kind==='github'?'glab':'gh','#!/bin/sh\nexit 97');
  stub('ssh',`#!/bin/sh\n[ "$1" = git@fixture.invalid ] || exit 92\ncase "$2" in "git-upload-pack 'org/project.git'") exec /usr/bin/git upload-pack "$SERVER";; "git-receive-pack 'org/project.git'") exec /usr/bin/git receive-pack "$SERVER";; *) exit 93;; esac`);
  stub('docker',`#!/bin/sh\nif [ "$*" = 'image inspect --format {{.Id}} fixture' ]; then /usr/bin/cat '${image}'; exit; fi\nexec /usr/bin/env -i PATH="$PATH" '${join(agents.bin,'docker')}' "$@"`);
  stub('git',`#!/bin/sh\ncase " $* " in *' push --porcelain '*) echo "$*" >> "$PUSHES"; if [ "$INTERRUPT" = lose ]; then /usr/bin/git "$@" >/dev/null; exit 1; fi; /usr/bin/git "$@"; result=$?; if [ "$INTERRUPT" = after ] && [ "$result" = 0 ]; then kill -9 "$PPID"; fi; exit "$result";; esac\nexec /usr/bin/git "$@"`);
  const env={HOME:p.home,PATH:`${bin}:${agents.bin}:/usr/bin:/bin`,GIT_SSH:join(bin,'ssh'),GIT_SSH_VARIANT:'simple',GIT_ALLOW_PROTOCOL:'ssh:file',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',KIND:kind,FACTS:facts,UPDATES:updates,SERVER:server,PUSHES:pushes};
  const git=(dir:string,...a:string[])=>execFileSync('/usr/bin/git',['-C',dir,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=local@invalid',...a],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']}).trim();
  git(root,'init','-b','main');writeFileSync(join(root,'api.cjs'),'module.exports=0');writeFileSync(join(root,'check.cjs'),"require('node:assert/strict').equal(require('./api.cjs'),1);console.log(require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim())");
  git(root,'add','*.cjs');git(root,'commit','-m','fixture');const original=git(root,'rev-parse','HEAD');git(root,'init','--bare','-b','main',server);git(root,'remote','add','origin','git@fixture.invalid:org/project.git');git(root,'push','origin','main');
  writeFileSync(join(root,'.factory/factory.toml'),factoryToml('org/project',{kind,host:'fixture.invalid'})+'\n[ci]\nbatch_test_argv=["node","check.cjs"]\nbatch_test_paths=["check.cjs"]\n');addProject(p,root);
  const batchUrl=new URL('../src/batch.mts',import.meta.url).href, deliveryUrl=new URL('../src/batch-delivery.mts',import.meta.url).href;
  const probeLog=join(p.home,'revocations'), contender=join(p.home,'revoke.mjs');
  writeFileSync(contender,`import {withAdmissionLock,admissionFile,readAdmission,keyFor} from '${new URL('../../board/admission.mts',import.meta.url).href}';import {appendFileSync} from 'node:fs';
    const state=${JSON.stringify(p.state)},phase=process.argv[2];try{withAdmissionLock(state,write=>{const s=readAdmission(state);delete s.claims[keyFor('7','org/project')];write(admissionFile(state),JSON.stringify(s));},0);appendFileSync(${JSON.stringify(probeLog)},'released:'+phase+'\\n');}catch(e){if(!e.message.includes('locked by process'))throw e;appendFileSync(${JSON.stringify(probeLog)},'blocked:'+phase+'\\n');}`);
  const injection=join(p.home,'after-approval.cjs');
  writeFileSync(injection,`const fs=require('node:fs'),rename=fs.renameSync;let fired=false;
    const cp=require('node:child_process'),exec=cp.execFileSync,spawn=cp.spawnSync;
    const revoke=phase=>exec(process.execPath,[${JSON.stringify(contender)},phase]);
    cp.spawnSync=function(cmd,args,...rest){if(process.env.CONTEND && cmd==='git' && args.includes('--porcelain'))revoke('git');return spawn(cmd,args,...rest)};
    cp.execFileSync=function(cmd,args,...rest){if(process.env.CONTEND && ['gh','glab'].includes(cmd) && (args[0]==='issue'||args.includes('PUT')))revoke('tracker');return exec(cmd,args,...rest)};
    // Release wins immediately BEFORE the publisher takes the real admission lock, after gate checks.
    const sqlite=require('node:sqlite'),DB=sqlite.DatabaseSync;
    sqlite.DatabaseSync=class extends DB{constructor(file,...args){if(process.env.PREEMPT && file===${JSON.stringify(join(p.state,'admission','mutex.sqlite'))} && !fired){fired=true;revoke('before-'+process.env.PREEMPT)}super(file,...args)}};
    fs.renameSync=function(from,to){rename(from,to);
      if(process.env.LOSE_TRACKER && to.endsWith('/batch.json')){const b=JSON.parse(fs.readFileSync(to));if(b.phase==='ready' && b.expectedHead!==b.sourceSha){const f=JSON.parse(fs.readFileSync(process.env.FACTS));fs.writeFileSync(process.env.FACTS,JSON.stringify({...f,offline:true}));if(process.env.LOSE_TRACKER==='crash')process.kill(process.pid,'SIGKILL');}}
      if(to.endsWith('/delivery.json') && process.env.INTERRUPT==='landed' && JSON.parse(fs.readFileSync(to)).git==='landed')process.kill(process.pid,'SIGKILL');if(!fired && to.endsWith('/delivery.json') && process.env.MOVE && JSON.parse(fs.readFileSync(to)).git==='not-started'){
      fired=true;const b=JSON.parse(fs.readFileSync(to)).binding, cp=require('node:child_process');
      if(process.env.MOVE.startsWith('scope-')){const f=JSON.parse(fs.readFileSync(process.env.FACTS));fs.writeFileSync(process.env.FACTS,JSON.stringify({...f,scope:process.env.MOVE.slice(6)}));}
      else if(process.env.MOVE==='image')fs.writeFileSync(${JSON.stringify(image)},'sha256:'+'b'.repeat(64)+'\\n');
      else if(process.env.MOVE==='foreign')cp.execFileSync('/usr/bin/git',['-C',process.env.SERVER,'update-ref',b.destination,process.env.NEXT,b.expectedHead]);
      else {if(process.env.MOVE==='stop')fs.writeFileSync(${JSON.stringify(rejectMarker)},'reject');cp.execFileSync(process.execPath,['--input-type=module','-e','import {advanceBatch} from '+JSON.stringify(${JSON.stringify(batchUrl)})+'; advanceBatch(...'+JSON.stringify([${JSON.stringify({projects:p.projects,state:p.state})},'project',b.batch,b.expectedHead,process.env.NEXT])+')']);}
    }};require('node:module').syncBuiltinESMExports();`);
  const call=async(module:string,fn:string,a:unknown[],suffix='',extra={})=>{const script=`import {${fn}} from ${JSON.stringify(module)};const value=await ${fn}(...${JSON.stringify(a)}${suffix});console.log(JSON.stringify(value));`;
    const {stdout}=await promisify(execFile)(process.execPath,['--require',injection,'--input-type=module','-e',script],{env:{...env,...extra},timeout:60000});return JSON.parse(stdout)};
  const paths={state:p.state,projects:p.projects};
  const tokens=new Map<string,string>(),repoIds=new Map<string,string>();let active='';
  const submit=async()=>{const batch=await call(batchUrl,'submitBatch',[paths,'project',['7']]);repoIds.set(batch.id,batch.repositoryId);return batch};
  function admitted(id:string){
    if(active!==id){
      const project='org/project',iid='7',name=keyFor(iid,project),run=randomUUID();tokens.set(id,run);active=id;
      const ticket=freezeTicketInput(commandContextSource({kind,host:'fixture.invalid',project},42,env),7);
      withAdmission(p.state,tx=>{tx.state.claims[name]={kind:'normal',iid,project,token:run,at:new Date().toISOString(),owner:ownerOf(process.pid)};tx.commit();writeDurable(join(p.state,name+'.json'),JSON.stringify({iid,project,executionId:run,claim:run,pid:process.pid,ticketHash:ticket.hash,batchMember:{id,repositoryId:repoIds.get(id)}}))});
    }
    return {project:'project',batch:id,ticket:7,run:tokens.get(id)!};
  }
  const execute=(id:string,extra={})=>call(deliveryUrl,'runAndDeliverBatchMember',[paths,admitted(id)],",()=> 'fixture-only'",extra);
  const saved=(id:string)=>call(deliveryUrl,'readBatchDelivery',[paths,{project:'project',batch:id,ticket:7}]);
  const observe=async(scope:object)=>{const script=`import {batchDeliveryObserver} from '${deliveryUrl}';console.log(JSON.stringify(batchDeliveryObserver(${JSON.stringify(paths)},'project')(${JSON.stringify(scope)},7)))`;return JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{env})).stdout)};
  const sibling=await submit(),batch=await submit(),ref=(name:string)=>git(server,'rev-parse',name),oldWrites=lines(pushes).length;
  if(kind==='github'){
    // Dispatch may already have invoked the real producer under its claim; join that exact host attempt.
    const originalRun=admitted(batch.id);const orch=new URL('../../orchestrator/',import.meta.url).href;
    const script=`import {runStandardBatchMember} from '${orch}batch-review.mts';import {freezeTicketInput} from '${orch}ticket-input.mts';import {commandContextSource} from '${orch}ticket-context-source.mts';import {loadTomlConfig} from '${orch}project-config.mts';import {readOwnedBatch} from '${batchUrl}';const b=${JSON.stringify(batch)},p=${JSON.stringify(paths)},config=loadTomlConfig(${JSON.stringify(join(root,'.factory'))},{strictOriginals:true});const result=await runStandardBatchMember({repo:b.root,state:p.state+'/batches/'+b.id,batch:b.id,run:${JSON.stringify(originalRun.run)},destination:b.destinationRef,expectedHead:b.expectedHead,ticket:freezeTicketInput(commandContextSource({kind:'github',host:'fixture.invalid',project:'org/project'}),7),observeHead:async()=>({kind:'owned',head:readOwnedBatch(p,'project',b.id).expectedHead})},config,'sha256:'+'a'.repeat(64),()=> 'fixture-only');console.log(JSON.stringify(result.binding));`;
    const binding=JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{env,timeout:60000})).stdout);
    const joinGate=(selected:object,extra={})=>call(deliveryUrl,'deliverReviewedBatchMember',[paths,originalRun,selected],",()=> 'fixture-only'",extra);
    await assert.rejects(joinGate({attempt:randomUUID(),candidate:binding.candidate}),/selected current host attempt/);
    await assert.rejects(joinGate({attempt:binding.attempt,candidate:original}),/selected current host attempt/);assert.equal(lines(pushes).length,oldWrites);
    await assert.rejects(joinGate(binding,{INTERRUPT:'after',CONTEND:'yes'}),(err:any)=>err.signal==='SIGKILL');
    const interrupted=await saved(batch.id);assert.equal(interrupted.git,'attempted');assert.equal(interrupted.tracker,'not-started');assert.equal(lines(updates).length,0);assert.equal(ref(batch.destinationRef),interrupted.binding.candidate);
    const held=await execute(batch.id,{FAIL_OBSERVE:'yes'});assert.equal(held.git,'landed');assert.equal(held.tracker,'not-started');assert.equal(lines(updates).length,0);assert.equal((await observe({...batch,expectedHead:binding.candidate})).state,'waiting');
  }else reset({deny:true});
  let out=await execute(batch.id,{CONTEND:'yes'});assert.equal(out.git,'landed',out.tests?.stderr??out.reason);assert.equal(out.gate,'approved');
  assert.equal(ref(batch.destinationRef),out.binding.candidate);assert.equal(ref('main'),original);assert.equal(ref(sibling.destinationRef),original);assert.equal(git(server,'rev-parse',out.binding.candidate+'^'),original);
  if(kind==='gitlab'){
    assert.equal(out.tracker,'incomplete');reset();out=await execute(batch.id);assert.equal(out.tracker,'incomplete');assert.equal(lines(updates).length,1,'no blind tracker retry');reset({done:true,parent:'Changed after landing'});out=await execute(batch.id);
  }
  assert.equal(out.tracker,'complete',out.reason);assert.deepEqual(await saved(batch.id),out);
  assert.deepEqual(lines(probeLog),['blocked:git','blocked:tracker']);
  assert.equal((await observe(batch)).state,'unknown','stale scope is not delivery evidence');assert.deepEqual(await observe({...batch,expectedHead:out.binding.candidate}),{state:'landed',batch:batch.id,repositoryId:batch.repositoryId,destination:batch.destinationRef,observedHead:out.binding.candidate,iid:7,commit:out.binding.candidate});assert.deepEqual(await execute(batch.id),out);assert.equal(lines(updates).length,1);assert.equal(lines(pushes).length,oldWrites+1);assert.equal(agents.entries().length,3);
  if(kind==='gitlab'){
    for(const hold of ['parent','claim']){
      reset();const interrupted=await submit();await assert.rejects(execute(interrupted.id,{INTERRUPT:'landed'}),(err:any)=>err.signal==='SIGKILL');
      const checkpoint=await saved(interrupted.id);assert.equal(checkpoint.git,'landed');assert.equal(checkpoint.tracker,'not-started');assert.equal(ref(interrupted.destinationRef),checkpoint.binding.candidate);
      if(hold==='parent')reset({parent:'Changed after confirmed push'});
      const reconciled=await execute(interrupted.id,hold==='claim'?{PREEMPT:'tracker'}:{});assert.equal(reconciled.git,'landed');assert.equal(reconciled.tracker,'not-started');assert.match(reconciled.reason,hold==='parent'?/Missing current exact/:/claim/);assert.equal(ref(interrupted.destinationRef),reconciled.binding.candidate);assert.equal(lines(updates).length,1);
    }
    const unchangedWrites=lines(pushes).length;reset();invalidate=true;const held=await execute(sibling.id);assert.equal(held.git,'not-started');assert.match(held.reason,/Missing current exact|Changed batch/);assert.deepEqual(await saved(sibling.id),held);assert.equal(ref(sibling.destinationRef),original);assert.equal(lines(pushes).length,unchangedWrites);assert.equal(lines(updates).length,1);
  }else{
    reset();const moved=await submit(),lost=await submit(),unknown=await submit(),conflict=await submit(),revoked=await submit();
    writeFileSync(join(root,'batch-only'),'host change');git(root,'add','batch-only');git(root,'commit','-m','host advance');const next=git(root,'rev-parse','HEAD');
    const rebuilt=await execute(moved.id,{MOVE:'owned',NEXT:next});assert.equal(rebuilt.tracker,'complete',rebuilt.reason);assert.equal(rebuilt.binding.expectedHead,next);assert.equal(git(server,'rev-parse',rebuilt.binding.candidate+'^'),next);assert.equal(ref(moved.destinationRef),rebuilt.binding.candidate);assert.equal(agents.entries().length,8,'one implementation, two pairs of reviewers on moved batch');
    const db=new DatabaseSync(join(p.state,'batches',moved.id,'batch-review.sqlite'),{readOnly:true});let history:BatchEvidence[];try{history=db.prepare('SELECT result FROM attempts ORDER BY rowid').all().map(r=>JSON.parse(String(r.result)))}finally{db.close()}
    assert.equal(history.length,2);assert.notEqual(history[0].binding.candidate,history[1].binding.candidate);assert.deepEqual(history.map(r=>[r.status,r.tests.exit,r.tests.stdout.trim(),r.reviews.map(v=>v.verdict)]),history.map(r=>['approved',0,r.binding.candidate,['approve','approve']]));assert.equal(new Set(history.flatMap(r=>r.reviews.map(v=>v.invocation))).size,4);
    let before=lines(pushes).length,count=lines(updates).length;const missing=await execute(lost.id,{INTERRUPT:'lose'});assert.equal(ref(lost.destinationRef),missing.binding.candidate);assert.equal(missing.git,'unknown');assert.equal((await execute(lost.id)).git,'unknown');assert.equal(lines(pushes).length,before+1);assert.equal(lines(updates).length,count);
    before=lines(pushes).length;const drift=await execute(unknown.id,{MOVE:'foreign',NEXT:next});assert.equal(drift.git,'not-started');assert.equal(ref(unknown.destinationRef),next);assert.equal(lines(pushes).length,before);
    writeFileSync(join(root,'api.cjs'),'module.exports=99');git(root,'add','api.cjs');git(root,'commit','-m','competing implementation');const competing=git(root,'rev-parse','HEAD');await assert.rejects(execute(conflict.id,{MOVE:'owned',NEXT:competing}),/merge-tree|conflict/i);assert.equal(ref(conflict.destinationRef),competing);assert.equal(lines(updates).length,count);assert.equal(lines(pushes).length,before+1);
    before=lines(pushes).length;const stale=await execute(revoked.id,{PREEMPT:'git'});assert.equal(stale.git,'not-started');assert.match(stale.reason,/claim/);assert.equal(ref(revoked.destinationRef),original);assert.equal((await execute(revoked.id)).git,'not-started');assert.equal(lines(pushes).length,before);
    const changed=await submit(), exhausted=await submit(), prior=lines(pushes).length;
    const badGate=await execute(changed.id,{MOVE:'image'});assert.equal(badGate.gate,'approved');assert.equal(badGate.binding.gate.image,'sha256:'+'a'.repeat(64));assert.equal(badGate.git,'not-started');assert.match(badGate.reason,/Missing current exact/);assert.equal(ref(changed.destinationRef),original);assert.equal(lines(pushes).length,prior);assert.equal(lines(updates).length,count);writeFileSync(image,'sha256:'+'a'.repeat(64)+'\n');
    const stopped=await execute(exhausted.id,{MOVE:'stop',NEXT:next});assert.equal(stopped.status,'stopped');const latest=await saved(exhausted.id);assert.equal(latest.gate,'stopped');assert.deepEqual(latest.binding,stopped.binding);assert.equal((await observe({...exhausted,expectedHead:next})).state,'stopped');assert.deepEqual(await execute(exhausted.id),latest);assert.equal(ref(exhausted.destinationRef),next);assert.equal(lines(pushes).length,prior+1);assert.equal(lines(updates).length,count);
    // Clear the fixture reviewer response, not any host-owned gate/attempt state.
    fsUnlink(rejectMarker);
    before=lines(pushes).length;writeFileSync(join(server,'hooks/pre-receive'),'#!/bin/sh\nexit 1\n',{mode:0o700});
    const denied=await execute(sibling.id);assert.equal(denied.git,'refused',denied.reason);assert.equal(denied.tracker,'not-started');assert.equal(ref(sibling.destinationRef),original);assert.equal((await execute(sibling.id)).git,'refused');assert.equal(lines(pushes).length,before+1);assert.equal(lines(updates).length,count);assert.equal(ref('main'),original);assert.equal(ref(batch.destinationRef),out.binding.candidate);
  }
  invalidate=false;if(kind==='github')fsUnlink(join(server,'hooks/pre-receive'));
  for(const scope of ['foreign','missing'])await t.test(`${scope} parent identity cannot name the same-number local decoy`,async()=>{
    reset({parentIid:8});const b=await submit(),before=lines(pushes).length,changes=lines(updates).length;
    const result=await execute(b.id,{MOVE:'scope-'+scope});assert.equal(result.gate,'approved');assert.equal(result.git,'not-started');assert.equal(result.tracker,'not-started');
    assert.equal(ref(b.destinationRef),original);assert.equal(lines(pushes).length,before);assert.equal(lines(updates).length,changes);
  });
  if(kind==='github')await t.test('positive Git settlement survives immediate tracker loss and remains included on a later owned descendant',async()=>{
    reset();const b=await submit(),before=lines(pushes).length,changes=lines(updates).length;
    const result=await execute(b.id,{LOSE_TRACKER:'1'});assert.equal(ref(b.destinationRef),result.binding.candidate);assert.equal(result.git,'landed');assert.equal(result.tracker,'not-started');assert.deepEqual(await saved(b.id),result);assert.equal(lines(updates).length,changes);
    reset();const done=await execute(b.id);assert.equal(done.tracker,'complete');assert.equal(lines(pushes).length,before+1);assert.equal(lines(updates).length,changes+1);
    const commit=done.binding.candidate, descendant=git(root,'commit-tree',commit+'^{tree}','-p',commit,'-m','later owned advance');const current=await call(batchUrl,'advanceBatch',[paths,'project',b.id,commit,descendant]);
    assert.equal(ref(b.destinationRef),descendant);assert.deepEqual(await observe(current),{state:'landed',batch:b.id,repositoryId:b.repositoryId,destination:b.destinationRef,observedHead:descendant,iid:7,commit});
  });
  if(kind==='github')await t.test('settled receipt survives process death before the member journal is updated',async()=>{
    reset();const b=await submit(),before=lines(pushes).length,changes=lines(updates).length;
    await assert.rejects(execute(b.id,{LOSE_TRACKER:'crash'}),(err:any)=>err.signal==='SIGKILL');assert.equal((await saved(b.id)).git,'attempted');
    const result=await execute(b.id);assert.equal(result.git,'landed');assert.equal(result.tracker,'not-started');assert.equal(ref(b.destinationRef),result.binding.candidate);assert.equal(lines(pushes).length,before+1);assert.equal(lines(updates).length,changes);
  });
  await t.test('acknowledged update without issue state change is incomplete and never replayed',async()=>{
    reset({ackOnly:true});const b=await submit(),before=lines(pushes).length,changes=lines(updates).length;
    const result=await execute(b.id);assert.equal(result.git,'landed');assert.equal(result.tracker,'incomplete');assert.equal((await observe({...b,expectedHead:ref(b.destinationRef)})).state,'waiting');assert.equal((await execute(b.id)).tracker,'incomplete');assert.equal(lines(pushes).length,before+1);assert.equal(lines(updates).length,changes+1);
  });
}
for(const kind of ['github','gitlab'] as const)test(`${kind}: admitted delivery observes exact Git and tracker outcomes without replay`,t=>journey(t,kind));
