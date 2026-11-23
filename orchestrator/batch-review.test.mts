// Public producer tests: real prospective Git trees, fixture-only test/agent processes, independent evidence and durable rework policy.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { classifyBatchReview, runStandardBatchMember, runBatchAttempt, readBatchEvidence, latestBatchAttempt, type BatchAttemptInput, type ReviewReceipt } from './batch-review.mts';
import { fixtureTicketInput } from './fixtures/ticket-input.mts';
import { installBatchFixture } from './fixtures/batch-review.mts';
import { applyProposal, implementationSources, requestedContext } from './batch-candidate.mts';
import { observeTestProcess, standardBatchSandbox, TEST_DRIVER } from './batch-sandbox.mts';
import { loadTomlConfig } from './project-config.mts';

function temporary(t:TestContext,prefix:string){const root=mkdtempSync(join(tmpdir(),prefix));t.after(()=>rmSync(root,{recursive:true,force:true}));return root}
function setup(t:TestContext,workerStarts=false) {
  const root = temporary(t,'batch-review-'), repo = join(root,'repo'); mkdirSync(repo);
  const git = (...args:string[]) => execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=fixture','-c','user.email=test@example.invalid',...args],
    {cwd:repo,env:{PATH:process.env.PATH,HOME:root,GIT_CONFIG_NOSYSTEM:'1'},encoding:'utf8'}).trim();
  const commit = (files:Record<string,string>) => { for (const [p,s] of Object.entries(files)) writeFileSync(join(repo,p),s); git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD'); };
  git('init','-q','-b','main'); mkdirSync(join(repo,'tests'));
  const base = commit({'.gitattributes':'api.cjs binary','api.cjs':'module.exports=0','tests/check.cjs':`const assert=require('node:assert/strict');assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.equal(require('../api.cjs'),1);`});
  git('switch','-qc','factory/batch/b1'); const expectedHead = commit({'prerequisite':'integrated'});
  git('switch','-qc','ticket',base); const deltaTip = workerStarts?base:commit({'api.cjs':'module.exports=2;// DIFF_ONLY'});
  const destination = 'refs/heads/factory/batch/b1';
  const input: BatchAttemptInput = {repo,image:'sha256:'+'a'.repeat(64),configDigest:'f'.repeat(64),state:join(root,'private'),batch:'b1',run:'run',destination,expectedHead,deltaBase:base,deltaTip,
    testArgv:[process.execPath,'tests/check.cjs'],testPaths:['tests'],observeHead:async()=>({kind:'owned',head:git('rev-parse',destination)}),
    ticket:fixtureTicketInput({tickets:[{iid:7,title:'child',description:'CHILD_REQUIREMENT'},{iid:8,title:'parent',description:'PARENT_REQUIREMENT'}],parents:{7:8}},7)};
  return {input,root,git,commit};
}
const approval = {verdict:'approve',reason:'matches requirements'};

test('admitted implementation revises code and tests from host feedback; exact independent approvals rebuild after a batch advance', async t=>{
  const {input,root,git,commit}=setup(t,true), records=join(root,'turns.jsonl');writeFileSync(records,'');
  const dest='refs/heads/factory/batch/b1', firstHead=git('rev-parse',dest), main=git('rev-parse','main');
  const advance=(parent:string,msg:string)=>git('commit-tree',git('rev-parse',`${parent}^{tree}`),'-p',parent,'-m',msg);
  const resumedHead=advance(firstHead,'before first test');
  let revisedHead:string, advanced:string;
  const advanceTree=(parent:string,content:string)=>{
    git('switch','--detach','-q',parent);const head=commit({'batch-only':content});git('switch','-q','ticket');
    git('update-ref',dest,head,parent);return head;
  };
  const project='github://github.com/owner/repo', seen:{role:string,prompt:string,id:string}[]=[];
  const turns=()=>readFileSync(records,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  const implementation=`
    const file=${JSON.stringify(records)}, prior=fs.readFileSync(file,'utf8').trim().split('\\n').filter(Boolean).length;
    const {start,feedback,files}=JSON.parse(prompt.split('Host proposal input:\\n').at(-1));assert(files.some(f=>f.path==='api.cjs'));assert(files.some(f=>f.path==='tests/check.cjs'));
    if(prior===0)assert.equal(feedback,null);
    else if(prior===1){assert.equal(feedback.tests.exit,255);assert.match(feedback.tests.stderr,/WRONG_RESULT/);}
    else {assert.equal(prior,2);assert.equal(feedback.reviews.find(x=>x.role==='test').reason,'cover revision two');}
    const api='module.exports='+prior+';// IMPLEMENTATION_ONLY';
    const check="process.on('uncaughtException',err=>{console.error(err);process.exitCode=255});console.log(require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());require('node:assert/strict').equal(require('../api.cjs'),"+(prior||99)+",'WRONG_RESULT');console.log(require('node:fs').readFileSync('batch-only','utf8'));";
    console.log(JSON.stringify({edits:[{path:'api.cjs',content:api},{path:'tests/check.cjs',content:check}]}));
    fs.appendFileSync(file,JSON.stringify({prompt,feedback,start,api,check,entries:fs.readFileSync(${JSON.stringify(join(root,'agent-entries.jsonl'))},'utf8')})+'\\n');`;
  const fixture=await installBatchFixture(root,input.testArgv,(role,prompt)=>{
    const id=latestBatchAttempt(input.state,project,'b1',7)!.binding.attempt;seen.push({role,prompt,id});
    const round=new Set(seen.map(x=>x.id)).size;
    if(round===2 && role==='code') advanced=advanceTree(revisedHead,'during reviews');
    if(round===3 && role==='test' && !prompt.startsWith('Final context stage:'))return {context:['api.cjs'],assessment:'initial assessment '+id};
    return round===1 && role==='test'?{verdict:'reject',reason:'cover revision two'}:approval;
  },implementation);
  const path=process.env.PATH;process.env.PATH=fixture.bin+':'+path;t.after(()=>{process.env.PATH=path;fixture.close()});
  const config=readFileSync(new URL('./factory.personal.toml',import.meta.url),'utf8').replace('[ci]',`[ci]\nbatch_test_argv = ${JSON.stringify(input.testArgv)}\nbatch_test_paths = ["tests"]`);
  writeFileSync(join(root,'factory.toml'),config);
  const {deltaTip,deltaBase,testArgv,testPaths,...member}=input;
  const firstHost=execFileSync(process.execPath,[fileURLToPath(new URL('./fixtures/batch-member-checkpoint.mts',import.meta.url))],{
    input:JSON.stringify({member,configRoot:root,records,advanced:resumedHead}),encoding:'utf8',timeout:12000,env:{PATH:process.env.PATH,HOME:root,TMPDIR:root}});
  assert.match(firstHost,/owned batch head/);assert.equal(git('rev-parse',dest),resumedHead);
  let moved=false;
  member.observeHead=async()=>{
    // The ref advances immediately after this owned sample. Sampling once more outside the gate is insufficient.
    if(turns().length===2 && !moved){moved=true;const sampled=git('rev-parse',dest);revisedHead=advanceTree(resumedHead,'after implementation');return {kind:'owned',head:sampled}}
    return {kind:'owned',head:git('rev-parse',dest)};
  };
  const run=()=>runStandardBatchMember(member,loadTomlConfig(root),'sha256:'+'a'.repeat(64),()=> 'fixture-only');
  assert.equal(latestBatchAttempt(input.state,project,'b1',7),null);
  assert.deepEqual(fixture.entries().map(x=>x.entry),['implementer']);
  const pass=await run();
  const history=turns();assert.equal(history.length,3);assert.match(history[0].prompt,/CHILD_REQUIREMENT/);assert.match(history[0].prompt,/PARENT_REQUIREMENT/);
  assert.doesNotMatch(history[1].entries,/reviewer/,'no reviewer process entry before failed-test repair');
  assert.equal(fixture.entries().filter(x=>x.entry==='reviewer').length,7);assert.equal(new Set(fixture.entries().map(x=>x.pid)).size,10);
  const homes=fixture.entries().map(e=>e.home);assert.equal(new Set(homes).size,homes.length-1);assert(homes.every(home=>!existsSync(home)));
  const ids=[history[1].feedback.attempt,...new Set(seen.map(x=>x.id))];assert.equal(ids.length,4);
  let priorTip=firstHead;const receipts=ids.map(id=>readBatchEvidence(input.state,id)!);
  assert.deepEqual(receipts.map(r=>r.status),['implementation','rework','rebuild','approved']);
  const sessions=new Set<string>();
  for(const [i,r] of receipts.entries()) {
    const turn=history[Math.min(i,2)],b=r.binding,head=[resumedHead,revisedHead,revisedHead,advanced][i];
    assert.deepEqual([b.project,b.batch,b.ticket,b.run,b.destination,b.expectedHead,b.deltaBase,b.requirementsDigest],
      [project,'b1',7,'run',dest,head,firstHead,input.ticket.hash]);
    assert.deepEqual(git('diff','--name-only',`${b.deltaTip}^`,b.deltaTip).split('\n'),['api.cjs','tests/check.cjs']);
    assert.equal(git('show',`${b.deltaTip}:api.cjs`),turn.api);assert.equal(git('show',`${b.deltaTip}:tests/check.cjs`),turn.check);
    if(i<3){assert.equal(turn.start,priorTip);assert.equal(git('rev-parse',`${b.deltaTip}^`),priorTip);priorTip=b.deltaTip}else assert.equal(b.deltaTip,priorTip);
    assert.equal(git('rev-parse',`${b.candidate}^`),head);assert.notEqual(b.candidate,b.deltaTip);
    assert.deepEqual(r.tests.stdout.trim().split('\n'),i?[b.candidate,i===3?'during reviews':'after implementation']:[b.candidate]);
    assert.equal(git('ls-tree',b.deltaTip,'batch-only'),'');assert.deepEqual(r.tests.binding,b);
    if(!i){assert.notEqual(r.tests.exit,0);assert.deepEqual(r.reviews,[]);continue}
    assert.equal(r.tests.exit,0);assert.deepEqual(r.reviews.map(x=>x.role),['test','code']);
    for(const v of r.reviews){assert.deepEqual(v.binding,b);assert(!sessions.has(v.invocation));sessions.add(v.invocation)}
    const code=seen.find(x=>x.id===b.attempt&&x.role==='code')!.prompt, tests=seen.find(x=>x.id===b.attempt&&x.role==='test')!.prompt;
    const material=(s:string)=>JSON.parse(s.slice(s.indexOf('\n{')+1));
    const side=(sha:string,path:string)=>({mode:'100644',oid:git('rev-parse',`${sha}:${path}`),content:git('show',`${sha}:${path}`)});
    const files=['api.cjs','tests/check.cjs'];assert.deepEqual(git('diff','--name-only',head,b.candidate).split('\n'),files);
    assert.deepEqual(material(code),{requirements:input.ticket.text,diff:files.map(path=>({path,before:side(head,path),after:side(b.candidate,path)}))});
    assert.equal(side(b.candidate,'api.cjs').content,turn.api);assert.equal(side(b.candidate,'tests/check.cjs').content,turn.check);
    assert.deepEqual(material(tests),{requirements:input.ticket.text,tests:[{path:'tests/check.cjs',content:turn.check}]});
    assert.match(tests,/tautolog/i);assert.match(tests,/wrong behavior/i);assert.match(tests,/material omissions/i);assert.doesNotMatch(tests,/IMPLEMENTATION_ONLY/);
    assert.doesNotMatch(tests+code,/cover revision two/);
    if(i===3){
      const staged=seen.filter(x=>x.id===b.attempt&&x.role==='test');assert.equal(staged.length,2);
      assert.deepEqual(material(staged[1].prompt),{candidate:b.candidate,implementationContext:[{path:'api.cjs',oid:side(b.candidate,'api.cjs').oid,content:turn.api}]});
      assert.notEqual(readFileSync(join(input.repo,'api.cjs'),'utf8'),turn.api);
      const review=r.reviews.find(v=>v.role==='test')!;assert.equal(review.reason,'initial assessment '+b.attempt);assert.equal(review.followup?.assessment,review.reason);assert.deepEqual(review.followup?.paths,['api.cjs']);assert.equal(review.followup!.invocation,review.invocation,'same private deciding session');
    }
  }
  assert.deepEqual(receipts[2].reviews.map(x=>x.verdict),['approve','approve']);assert.equal(pass.binding.candidate,receipts[3].binding.candidate);
  assert.equal(git('rev-parse',dest),advanced);assert.equal(git('rev-parse','main'),main);
});

test('assembled standard member runs its implementer and both role verdicts with each configured family',async t=>{
  const store=temporary(t,'batch-runtime-');
  const {directory}=prepareRuntimeBundle({sourceRoot:fileURLToPath(new URL('../',import.meta.url)),runtimeStore:store,install:installPackages});
  const load=(name:string)=>import(pathToFileURL(join(directory,name)).href);
  const {runStandardBatchMember}=await load('batch-review.mts'), {loadTomlConfig}=await load('project-config.mts');
  for(const [family,implementation,review] of [['openai','openai/gpt-6.1-terra','openai/gpt-6.1-sol'],
    ['anthropic','pi-claude-subscription/claude-sonnet-5-5','pi-claude-subscription/claude-opus-5-5']]){
    await t.test(family,async t=>{
      const {input,root}=setup(t,true),{testArgv,testPaths,deltaTip,deltaBase,...member}=input;
      const extension=join(root,'fixture-extension.ts');writeFileSync(extension,'');
      const fixture=await installBatchFixture(root,testArgv,role=>({verdict:'approve',reason:role+' fixture verdict'}),`
        console.log(JSON.stringify({edits:[{path:'api.cjs',content:'module.exports=1'}]}));`);
      const path=process.env.PATH,prev=process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION;
      process.env.PATH=fixture.bin+':'+path;process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION=extension;
      t.after(()=>{fixture.close();process.env.PATH=path;if(prev===undefined)delete process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION;else process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION=prev});
      writeFileSync(join(root,'factory.toml'),readFileSync(new URL('./factory.personal.toml',import.meta.url),'utf8')
        .replace('family = "openai"',`family = "${family}"`).replace('[ci]',`[ci]\nbatch_test_argv = ${JSON.stringify(testArgv)}\nbatch_test_paths = ["tests"]`));
      const receipt=await runStandardBatchMember(member,loadTomlConfig(root),'sha256:'+'a'.repeat(64),()=> 'fixture-only');
      assert.deepEqual(receipt.binding.gate,{argv:testArgv,paths:testPaths,image:'sha256:'+'a'.repeat(64),configDigest:receipt.binding.gate.configDigest});assert.match(receipt.binding.gate.configDigest,/^[0-9a-f]{64}$/);
      assert.equal(receipt.status,'approved');assert.equal(receipt.tests.exit,0);
      assert.deepEqual(receipt.reviews.map(v=>[v.role,v.verdict,v.reason]),[['test','approve','test fixture verdict'],['code','approve','code fixture verdict']]);
      const config=loadTomlConfig(root),image='sha256:'+'a'.repeat(64);
      const resume=(cfg=config,img=image)=>runStandardBatchMember(member,cfg,img,()=>{throw Error('unexpected provider call')});
      assert.deepEqual(await resume(),receipt);
      for(const changed of [{argv:['different'],paths:testPaths},{argv:testArgv,paths:['api.cjs']}]){
        await assert.rejects(resume({...config,config:{...config.config,batchTests:changed}}),/gate inputs/i);
      }
      await assert.rejects(resume(config,'sha256:'+'b'.repeat(64)),/gate inputs/i);await assert.rejects(resume(config,'unpinned'),/gate inputs/i);
      await assert.rejects(resume({...config,AGENT:{family:family==='openai'?'anthropic':'openai'}}),/gate inputs/i);
      const ext=family==='anthropic';assert.deepEqual(fixture.entries().map(({entry,model,extension})=>[entry,model,extension]),[
        ['implementer',implementation,ext?extension:null],
        ...Array(2).fill(['reviewer',review,ext?extension:null])]);
    });
  }
});

test('loss of the initial private assessment cannot start a replacement deciding session',async t=>{
  const {input,root}=setup(t);
  const fixture=await installBatchFixture(root,input.testArgv,(role)=>{
    if(role==='code')return approval;
    const home=fixture.entries().find(e=>existsSync(join(e.home,'history'))).home;
    rmSync(join(home,'history','fixture-session.jsonl'));
    return {assessment:'initial assessment',context:['api.cjs']};
  });
  const path=process.env.PATH;process.env.PATH=fixture.bin+':'+path;t.after(()=>{process.env.PATH=path;fixture.close()});
  const sandbox=standardBatchSandbox(input.image,'openai/fixture',()=> 'fixture-only');
  const result=await runBatchAttempt(input,{...sandbox,test:async()=>({exit:0,stdout:'',stderr:''})});
  assert.equal(result.status,'held');assert.deepEqual(result.reviews.map(r=>r.verdict),['inconclusive','approve']);
  const entries=fixture.entries();assert.equal(entries.length,2);assert.equal(new Set(entries.map(e=>e.home)).size,2);assert(entries.every(e=>!existsSync(e.home)));
});

test('tool-less proposals change only ordinary Git blobs on the exact parent; invalid proposals and unrepresentable source hold',t=>{
  const {input,git,commit}=setup(t),start=input.deltaTip;
  const apply=(edits:unknown[])=>applyProposal(input.repo,start,JSON.stringify({edits}));
  const tip=apply([{path:'api.cjs',content:null},{path:'src/new',content:'new bytes\n'}]);
  assert.equal(git('rev-parse',`${tip}^`),start);assert.equal(git('ls-tree',tip,'api.cjs'),'');assert.equal(git('show',`${tip}:src/new`),'new bytes');
  for(const edits of [[{path:'.git/config',content:'x'}],[{path:'../outside',content:'x'}],[{path:'a',content:'x'},{path:'a',content:'y'}],[]])assert.throws(()=>apply(edits));
  assert.equal(git('rev-parse','HEAD'),start);assert.throws(()=>implementationSources(input.repo,commit({'binary':'before\0after'})),/Unrepresentable/);
});

test('durable budget charges rejected rounds, not batch movement, and survives new run IDs', async t=>{
  const {input,commit} = setup(t); let sequence=0, moving=true;
  const observe = input.observeHead; input.observeHead=async()=>moving && ++sequence===3 ? {kind:'owned',head:'e'.repeat(40)} : observe();
  const sessions = new Set<string>(), tested: string[]=[];
  const sandbox = {test:async(sha:string)=>{tested.push(sha);return {exit:0,stdout:'',stderr:''}},review:async(role:string,id:string)=>{
    assert(!sessions.has(id));sessions.add(id);return {exit:0,stdout:JSON.stringify(role==='test'?{assessment:'missing coverage context',context:['missing']}:{verdict:'reject',reason:'code defect'}),stderr:''};}};
  assert.equal((await runBatchAttempt(input,sandbox)).status,'rebuild'); moving=false;
  for (const [i,want] of ['rework','rework'].entries()) {
    input.run=`resume-${i}`; input.deltaTip=commit({'round':String(i)});
    const r=await runBatchAttempt(input,sandbox); assert.equal(r.status,want); assert.deepEqual(readBatchEvidence(input.state,r.binding.attempt),r);
    if (i===0) await assert.rejects(runBatchAttempt(input,sandbox),/requires rework/);
  }
  const fresh=()=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./fixtures/batch-budget-child.mts',import.meta.url))],{input:JSON.stringify(input),encoding:'utf8',timeout:10000}));
  input.run='restart';input.deltaTip=commit({'round':'third'});
  const final=fresh();assert.equal(final.result.status,'stopped');assert.equal(final.processes,3);assert.equal(final.result.binding.deltaTip,input.deltaTip);
  input.run='restart-again';input.deltaTip=commit({'round':'last'});const exhausted=fresh();assert.match(exhausted.error,/exhausted/);assert.equal(exhausted.processes,0);
  assert.equal(new Set(tested).size,3);assert.equal(sessions.size,6);
});

test('owned advance or uncertain ownership during a passing test prevents either reviewer starting',async t=>{
  const {input,git}=setup(t);
  for(const kind of ['owned','unknown'] as const){
    const original=input.expectedHead;let owner:'owned'|'unknown'='owned',starts=0;
    input.observeHead=async()=>({kind:owner,head:git('rev-parse',input.destination)});
    const next=git('commit-tree',git('rev-parse',`${original}^{tree}`),'-p',original,'-m','advance');
    const result=await runBatchAttempt(input,{test:async()=>{owner=kind;git('update-ref',input.destination,next,original);return {exit:0,stdout:'passed',stderr:''}},
      review:async()=>{starts++;return {exit:0,stdout:JSON.stringify(approval),stderr:''}}});
    assert.equal(result.status,kind==='owned'?'rebuild':'held');assert.equal(starts,0);assert.deepEqual(result.reviews,[]);input.expectedHead=next;
  }
});

test('unknown movement invalidates both approvals; unrepresentable Git material cannot start reviewers',async t=>{
  const {input,commit,git}=setup(t); let reviews=0;
  const foreign=git('commit-tree',git('rev-parse',`${input.expectedHead}^{tree}`),'-p',input.expectedHead,'-m','foreign advance');
  const sandbox={test:async()=>({exit:0,stdout:'',stderr:''}),review:async()=>{
    if(++reviews===2)git('update-ref',input.destination,foreign,input.expectedHead);
    return {exit:0,stdout:JSON.stringify(approval),stderr:''}}};
  const initial=input.deltaTip;
  for(const content of ['binary\0content','x'.repeat(1024*1024+1)]) {
    input.deltaTip=commit({'api.cjs':content});const result=await runBatchAttempt(input,sandbox);
    assert.equal(result.status,'held');assert.deepEqual(result.reviews,[]);
  }
  assert.equal(reviews,0);input.deltaTip=initial;
  input.observeHead=async()=>{const head=git('rev-parse',input.destination);return {kind:head===input.expectedHead?'owned':'unknown',head}};
  const unknown=await runBatchAttempt(input,sandbox);assert.deepEqual(unknown.reviews.map(v=>v.verdict),['approve','approve']);
  assert.equal(unknown.status,'held');assert.equal(git('rev-parse',input.destination),foreign);
});

test('interrupted or overlapping work holds the same ticket; malformed role output is not an approval',async t=>{
  const {input}=setup(t);
  const started=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
  const process = runBatchAttempt(input,{test:async()=>{started.resolve();await finish.promise;return {exit:0,stdout:'',stderr:''}},
    review:async role=>({exit:0,stdout:role==='test'?'approve':JSON.stringify(approval),stderr:''})});
  await started.promise;
  try {
    const pending=latestBatchAttempt(input.state,'github://github.com/owner/repo',input.batch,7)!;
    assert.equal(pending.evidence,null); assert.equal(readBatchEvidence(input.state,pending.binding.attempt),null);
    await assert.rejects(runBatchAttempt({...input,run:'successor'},{} as never),/unresolved/);
  } finally {finish.resolve()}
  const result=await process; assert.equal(result.status,'held'); assert.deepEqual(result.reviews.map(r=>r.verdict),['inconclusive','approve']);
});

test('bounded tails follow actual test completion; absent, signalled, timed out or unconfirmed processes cannot masquerade as assertions',async t=>{
  const run=(cmd:string,args:string[],ms=10000)=>observeTestProcess(cmd,args,Buffer.alloc(0),ms);
  const driver=(...args:string[])=>run(process.execPath,['-e',TEST_DRIVER,'--',...args]);
  for(const status of [0,17,124,255]){
    const r=await driver(process.execPath,'-e',`const fs=require('fs');for(const fd of [1,2]){for(let i=0;i<256;i++)fs.writeSync(fd,Buffer.alloc(8192,120));fs.writeSync(fd,'TAIL')}process.exit(${status})`);
    assert.equal(r.exit,status);for(const tail of [r.stdout,r.stderr]){assert(tail.endsWith('TAIL'));assert(Buffer.byteLength(tail)<=32768)}
  }
  for(const r of [await driver('/nonexistent-fixture-command'),await run(process.execPath,['-e','process.exit(124)']),await run(process.execPath,['-e',"process.kill(process.pid,'SIGTERM')"]),await driver(process.execPath,'-e',"process.kill(process.pid,'SIGKILL')"),
    await run(process.execPath,['-e','process.exit(0)']),await run(process.execPath,['-e','setInterval(()=>{},1000)'],100)])assert.equal(r.exit,null);
  const {input}=setup(t);const evidence=await runBatchAttempt(input,{test:async()=>({exit:null,stdout:'',stderr:'transport unavailable'}),review:async()=>{throw Error('unexpected')}});
  assert.equal(evidence.status,'held');assert.deepEqual(evidence.reviews,[]);
});

test('invalid or repeated context requests hold without substituting the other role’s approval',async t=>{
  const {input,commit}=setup(t);
  const tooLarge=commit({'first':'x'.repeat(32769),'second':'x'.repeat(32768)});
  for(const paths of [['first','second'],['api.cjs','api.cjs'],['a','b','c','d','e']])assert.throws(()=>requestedContext(input.repo,tooLarge,paths,performance.now()+5000));
  assert.throws(()=>requestedContext(input.repo,tooLarge,['api.cjs'],performance.now()-1),/deadline/);
  for(const paths of [['../api.cjs'],['missing'],['api.cjs']]){
    let calls=0;const result=await runBatchAttempt(input,{test:async()=>({exit:0,stdout:'',stderr:''}),review:async role=>{
      return {exit:0,stdout:JSON.stringify(approval),stderr:''}},withTestSession:async(_id,review)=>review(async()=>{calls++;return {exit:0,stdout:JSON.stringify({context:paths,assessment:'need more evidence'}),stderr:''}})});
    assert.equal(result.status,'held');assert.equal(calls,paths[0]==='api.cjs'?2:1);assert.equal(result.reviews.find(r=>r.role==='test')?.verdict,'inconclusive');
  }
});

test('failed tests, missing role, reused session and inconclusive verdicts cannot approve',()=>{
  const receipt=(role:'test'|'code',invocation:string,verdict:ReviewReceipt['verdict']='approve')=>({role,invocation,verdict});
  const t=receipt('test','a'),c=receipt('code','b');
  for(const reviews of [[t],[c],[t,t],[t,receipt('code','a')],[t,receipt('code','b','inconclusive')]]) assert.equal(classifyBatchReview(true,reviews,0).status,'held');
  assert.equal(classifyBatchReview(false,[t,c],0).status,'implementation');
  const codeReject=receipt('code','b','reject');assert.equal(classifyBatchReview(true,[t,codeReject],0).status,'rework');
  assert.equal(classifyBatchReview(true,[t,codeReject],2).status,'stopped');
});
