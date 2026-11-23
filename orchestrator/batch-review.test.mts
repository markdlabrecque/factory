// Public producer tests: real prospective Git trees, fixture-only test/agent processes, independent evidence and durable rework policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { classifyBatchReview, runStandardBatchMember, runBatchAttempt, readBatchEvidence, latestBatchAttempt, type BatchAttemptInput, type ReviewReceipt } from './batch-review.mts';
import { fixtureTicketInput } from './fixtures/ticket-input.mts';
import { installBatchFixture } from './fixtures/batch-review.mts';
import { loadTomlConfig } from './project-config.mts';

function setup(workerStarts=false) {
  const root = mkdtempSync(join(tmpdir(),'batch-review-')), repo = join(root,'repo'); mkdirSync(repo);
  const git = (...args:string[]) => execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=fixture','-c','user.email=test@example.invalid',...args],
    {cwd:repo,env:{PATH:process.env.PATH,HOME:root,GIT_CONFIG_NOSYSTEM:'1'},encoding:'utf8'}).trim();
  const commit = (files:Record<string,string>) => { for (const [p,s] of Object.entries(files)) writeFileSync(join(repo,p),s); git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD'); };
  git('init','-q','-b','main'); mkdirSync(join(repo,'tests'));
  const base = commit({'.gitattributes':'api.cjs binary','api.cjs':'module.exports=0','tests/check.cjs':`require('node:assert/strict').equal(require('../api.cjs'),1);`});
  git('switch','-qc','factory/batch/b1'); const expectedHead = commit({'prerequisite':'integrated'});
  git('switch','-qc','ticket',base); const deltaTip = workerStarts?base:commit({'api.cjs':'module.exports=2;// DIFF_ONLY'});
  const destination = 'refs/heads/factory/batch/b1';
  const input: BatchAttemptInput = {repo,state:join(root,'private'),batch:'b1',run:'run',destination,expectedHead,deltaBase:base,deltaTip,
    testArgv:[process.execPath,'tests/check.cjs'],testPaths:['tests'],observeHead:async()=>({kind:'owned',head:git('rev-parse',destination)}),
    ticket:fixtureTicketInput({tickets:[{iid:7,title:'child',description:'CHILD_REQUIREMENT'},{iid:8,title:'parent',description:'PARENT_REQUIREMENT'}],parents:{7:8}},7)};
  return {input,root,git,commit};
}
const approval = {verdict:'approve',reason:'matches requirements'};

test('admitted implementation revises code and tests from host feedback; exact independent approvals rebuild after a batch advance', async t=>{
  const {input,root,git}=setup(true), records=join(root,'turns.jsonl');writeFileSync(records,'');
  const dest='refs/heads/factory/batch/b1', firstHead=git('rev-parse',dest), main=git('rev-parse','main');
  const advanced=git('commit-tree',git('rev-parse',`${main}^{tree}`),'-p',firstHead,'-m','owned advance');
  const project='github://github.com/owner/repo', seen:{role:string,prompt:string,id:string}[]=[];
  const turns=()=>readFileSync(records,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  const implementation=`
    const git=(...a)=>require('node:child_process').execFileSync('git',a,{encoding:'utf8'}).trim();
    const file=${JSON.stringify(records)}, prior=fs.readFileSync(file,'utf8').trim().split('\\n').filter(Boolean).length;
    const feedback=JSON.parse(prompt.split('Host test argv and prior feedback:\\n').at(-1)).feedback;
    if(prior===0)assert.equal(feedback,null);
    else if(prior===1)assert.match(feedback.tests.stderr,/WRONG_RESULT/);
    else {assert.equal(prior,2);assert.equal(feedback.reviews.find(x=>x.role==='test').reason,'cover revision two');}
    const start=git('rev-parse','HEAD'),api='module.exports='+prior+';// IMPLEMENTATION_ONLY';
    const check="console.log(require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());require('node:assert/strict').equal(require('../api.cjs'),"+(prior||99)+",'WRONG_RESULT');";
    fs.writeFileSync('api.cjs',api);fs.writeFileSync('tests/check.cjs',check);git('add','.');git('commit','-qm','fixture implementer revision');
    fs.appendFileSync(file,JSON.stringify({prompt,feedback,start,api,check,tip:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),entries:fs.readFileSync(${JSON.stringify(join(root,'agent-entries.jsonl'))},'utf8')})+'\\n');`;
  const fixture=await installBatchFixture(root,input.testArgv,(role,prompt)=>{
    const id=latestBatchAttempt(input.state,project,'b1',7)!.binding.attempt;seen.push({role,prompt,id});
    const round=new Set(seen.map(x=>x.id)).size;
    if(round===2 && role==='code') git('update-ref',dest,advanced,firstHead);
    return round===1 && role==='test'?{verdict:'reject',reason:'cover revision two'}:approval;
  },implementation);
  const path=process.env.PATH;process.env.PATH=fixture.bin+':'+path;t.after(()=>{process.env.PATH=path;fixture.close()});
  const config=readFileSync(new URL('./factory.personal.toml',import.meta.url),'utf8').replace('[ci]',`[ci]\nbatch_test_argv = ${JSON.stringify(input.testArgv)}\nbatch_test_paths = ["tests"]`);
  writeFileSync(join(root,'factory.toml'),config);
  const {deltaTip,deltaBase,testArgv,testPaths,...member}=input;
  const pass=await runStandardBatchMember(member,loadTomlConfig(root),'sha256:'+'a'.repeat(64),()=> 'fixture-only');
  const history=turns();assert.equal(history.length,3);assert.match(history[0].prompt,/CHILD_REQUIREMENT/);assert.match(history[0].prompt,/PARENT_REQUIREMENT/);
  assert.doesNotMatch(history[1].entries,/reviewer/,'no reviewer process entry before failed-test repair');
  assert.equal(fixture.entries().filter(x=>x.entry==='reviewer').length,6);assert.equal(new Set(fixture.entries().map(x=>x.pid)).size,9);
  const ids=[history[1].feedback.attempt,...new Set(seen.map(x=>x.id))];assert.equal(ids.length,4);
  let priorTip=firstHead;const receipts=ids.map(id=>readBatchEvidence(input.state,id)!);
  assert.deepEqual(receipts.map(r=>r.status),['implementation','rework','rebuild','approved']);
  const sessions=new Set<string>();
  for(const [i,r] of receipts.entries()) {
    const turn=history[Math.min(i,2)],b=r.binding,head=i===3?advanced:firstHead;
    assert.deepEqual([b.project,b.batch,b.ticket,b.run,b.destination,b.expectedHead,b.deltaBase,b.requirementsDigest],
      [project,'b1',7,'run',dest,head,firstHead,input.ticket.hash]);
    assert.equal(b.deltaTip,turn.tip);assert.equal(git('rev-parse',`${b.deltaTip}^{tree}`),turn.tree);
    if(i<3){assert.equal(turn.start,priorTip);assert.equal(git('rev-parse',`${b.deltaTip}^`),priorTip);priorTip=b.deltaTip}else assert.equal(b.deltaTip,priorTip);
    assert.equal(git('rev-parse',`${b.candidate}^`),head);assert.notEqual(b.candidate,b.deltaTip);
    assert.equal(r.tests.stdout.trim(),b.candidate);assert.deepEqual(r.tests.binding,b);
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
  }
  assert.deepEqual(receipts[2].reviews.map(x=>x.verdict),['approve','approve']);assert.equal(pass.binding.candidate,receipts[3].binding.candidate);
  assert.equal(git('rev-parse',dest),advanced);assert.equal(git('rev-parse','main'),main);
});

test('durable budget charges rejected rounds, not batch movement, and survives new run IDs', async()=>{
  const {input,commit} = setup(); let sequence=0, moving=true;
  const observe = input.observeHead; input.observeHead=async()=>moving && ++sequence%2===0 ? {kind:'owned',head:'e'.repeat(40)} : observe();
  const sessions = new Set<string>(), tested: string[]=[];
  const sandbox = {test:async(sha:string)=>{tested.push(sha);return {exit:0,stdout:'',stderr:''}},review:async(role:string,id:string)=>{
    assert(!sessions.has(id));sessions.add(id);return {exit:0,stdout:JSON.stringify(role==='test'?{verdict:'reject',reason:'omission'}:approval),stderr:''};}};
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

test('unknown movement invalidates both approvals; unrepresentable Git material cannot start reviewers',async()=>{
  const {input,commit,git}=setup(); let reviews=0;
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

test('interrupted or overlapping work holds the same ticket; malformed role output is not an approval',async()=>{
  const {input}=setup();
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

test('failed tests, missing role, reused session and inconclusive verdicts cannot approve',()=>{
  const receipt=(role:'test'|'code',invocation:string,verdict:ReviewReceipt['verdict']='approve')=>({role,invocation,verdict});
  const t=receipt('test','a'),c=receipt('code','b');
  for(const reviews of [[t],[c],[t,t],[t,receipt('code','a')],[t,receipt('code','b','inconclusive')]]) assert.equal(classifyBatchReview(true,reviews,0).status,'held');
  assert.equal(classifyBatchReview(false,[t,c],0).status,'implementation');
});
