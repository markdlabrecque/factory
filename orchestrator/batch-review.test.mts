// Public producer tests: real prospective Git trees, fixture-only test/agent processes, independent evidence and durable rework policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyBatchReview, runStandardBatchAttempt, runBatchAttempt, readBatchEvidence, latestBatchAttempt, type BatchAttemptInput, type ReviewReceipt } from './batch-review.mts';
import { fixtureTicketInput } from './fixtures/ticket-input.mts';
import { installBatchFixture } from './fixtures/batch-review.mts';
import { loadTomlConfig } from './project-config.mts';

function setup() {
  const root = mkdtempSync(join(tmpdir(),'batch-review-')), repo = join(root,'repo'); mkdirSync(repo);
  const git = (...args:string[]) => execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=fixture','-c','user.email=test@example.invalid',...args],
    {cwd:repo,env:{PATH:process.env.PATH,HOME:root,GIT_CONFIG_NOSYSTEM:'1'},encoding:'utf8'}).trim();
  const commit = (files:Record<string,string>) => { for (const [p,s] of Object.entries(files)) writeFileSync(join(repo,p),s); git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD'); };
  git('init','-q','-b','main'); mkdirSync(join(repo,'tests'));
  const base = commit({'api.cjs':'module.exports=0','tests/check.cjs':`require('node:assert/strict').equal(require('../api.cjs'),1);`});
  git('switch','-qc','factory/batch/b1'); const expectedHead = commit({'prerequisite':'integrated'});
  git('switch','-qc','ticket',base); const deltaTip = commit({'api.cjs':'module.exports=2;// DIFF_ONLY'});
  const destination = 'refs/heads/factory/batch/b1';
  const input: BatchAttemptInput = {repo,state:join(root,'private'),batch:'b1',run:'run',destination,expectedHead,deltaBase:base,deltaTip,
    testArgv:[process.execPath,'tests/check.cjs'],testPaths:['tests'],observeHead:async()=>({kind:'owned',head:git('rev-parse',destination)}),
    ticket:fixtureTicketInput({tickets:[{iid:7,title:'child',description:'CHILD_REQUIREMENT'},{iid:8,title:'parent',description:'PARENT_REQUIREMENT'}],parents:{7:8}},7)};
  return {input,root,git,commit};
}
const approval = {verdict:'approve',reason:'matches requirements'};

test('only a tested prospective tree reaches two separate concurrent review processes', async t=>{
  const {input,root,git,commit} = setup(); const prompts = new Map<string,string>();
  const fixture = await installBatchFixture(root,input.testArgv,(role,prompt)=>{prompts.set(role,prompt);return approval});
  const path = process.env.PATH; process.env.PATH = fixture.bin + ':' + path;
  t.after(()=>{process.env.PATH=path;fixture.close()});
  const config = readFileSync(new URL('./factory.personal.toml',import.meta.url),'utf8').replace('[ci]',`[ci]\nbatch_test_argv = ${JSON.stringify(input.testArgv)}\nbatch_test_paths = ["tests"]`);
  writeFileSync(join(root,'factory.toml'),config);
  const run = () => runStandardBatchAttempt(input,loadTomlConfig(root),'sha256:'+'a'.repeat(64),()=> 'fixture-only');
  const failed = await run();
  assert.equal(failed.status,'implementation'); assert.notEqual(failed.tests.exit,0); assert.equal(prompts.size,0); assert.deepEqual(failed.reviews,[]);
  input.deltaTip = commit({'api.cjs':'module.exports=3;// DIFF_ONLY','tests/check.cjs':`require('node:assert/strict').equal(require('../api.cjs'),3);require('node:assert/strict').equal(require('fs').readFileSync('prerequisite','utf8'),'integrated');console.log(require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}));`});
  const pass = await run(), b = pass.binding;
  assert.equal(pass.status,'approved',JSON.stringify(pass)); assert.equal(pass.tests.stdout.trim(),b.candidate);
  assert.equal(git('rev-parse',`${b.candidate}^`),input.expectedHead); assert.equal(git('rev-parse',input.destination),input.expectedHead);
  assert.notEqual(b.candidate,input.deltaTip); assert.equal(b.requirementsDigest,input.ticket.hash);
  assert.match(prompts.get('test')!,/PARENT_REQUIREMENT/); assert.match(prompts.get('test')!,/CHILD_REQUIREMENT/);
  assert.match(prompts.get('test')!,/assert\/strict/); assert.doesNotMatch(prompts.get('test')!,/DIFF_ONLY/); assert.match(prompts.get('code')!,/DIFF_ONLY/);
  assert.deepEqual(pass.reviews.map(r=>r.role),['test','code']); assert.notEqual(pass.reviews[0].invocation,pass.reviews[1].invocation);
  for (const receipt of [pass.tests,...pass.reviews]) assert.deepEqual(receipt.binding,b);
  assert.deepEqual(readBatchEvidence(input.state,b.attempt),pass);
  assert.deepEqual(latestBatchAttempt(input.state,b.project,b.batch,b.ticket),{binding:b,evidence:pass});
});

test('durable budget charges rejected rounds, not batch movement, and survives new run IDs', async()=>{
  const {input,commit} = setup(); let sequence=0, moving=true;
  const observe = input.observeHead; input.observeHead=async()=>moving && ++sequence%2===0 ? {kind:'owned',head:'e'.repeat(40)} : observe();
  const sessions = new Set<string>(), tested: string[]=[];
  const sandbox = {test:async(sha:string)=>{tested.push(sha);return {exit:0,stdout:'',stderr:''}},review:async(role:string,id:string)=>{
    assert(!sessions.has(id));sessions.add(id);return {exit:0,stdout:JSON.stringify(role==='test'?{verdict:'reject',reason:'omission'}:approval),stderr:''};}};
  assert.equal((await runBatchAttempt(input,sandbox)).status,'rebuild'); moving=false;
  for (const [i,want] of ['rework','rework','stopped'].entries()) {
    input.run=`resume-${i}`; input.deltaTip=commit({'round':String(i)});
    const r=await runBatchAttempt(input,sandbox); assert.equal(r.status,want); assert.deepEqual(readBatchEvidence(input.state,r.binding.attempt),r);
    if (i===0) await assert.rejects(runBatchAttempt(input,sandbox),/requires rework/);
  }
  input.run='restart';input.deltaTip=commit({'round':'last'});
  await assert.rejects(runBatchAttempt(input,sandbox),/exhausted/); assert.equal(new Set(tested).size,4);assert.equal(sessions.size,8);
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
