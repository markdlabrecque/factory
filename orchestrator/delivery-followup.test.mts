// #153: synthetic host proof, ownership and tracker boundaries; no agents, containers or live services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RUNTIME_ASSETS } from '../cli/src/runtime-assets.mts';
import { pathToFileURL } from 'node:url';
import { createProof, sha256 } from './verification.mts';
import { claimDelivery, finishDelivery, readRuns, writeRecord } from '../board/board.mts';
const runtime = mkdtempSync(join(tmpdir(), 'followup-runtime-'));
for (const f of ['delivery-followup.mts', 'verification.mts']) copyFileSync(new URL(f, import.meta.url), join(runtime, f));
copyFileSync(new URL('../board/delivery.mts', import.meta.url), join(runtime, 'delivery.mts'));
const { observeWaitingDelivery, RetryableDeliveryRead } = await import(pathToFileURL(join(runtime, 'delivery-followup.mts')).href);
process.on('exit', () => rmSync(runtime, { recursive: true, force: true }));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'followup-')), state = join(root, 'state'), evidence = join(root, 'evidence'), workflow = join(root, 'workflow');
  mkdirSync(evidence); mkdirSync(workflow);
  writeFileSync(join(evidence, 'output.txt'), 'verified behavior');
  writeFileSync(join(evidence, 'verdict.md'), 'VERDICT: PASS\n');
  writeFileSync(join(evidence, 'verification.json'), JSON.stringify({ version:1, verdict:'PASS', changeKind:'feature', evidenceKind:'command', interactive:false, criteria:[{requirement:'works',result:'pass',evidence:['output.txt']}], artifacts:[{path:'output.txt',kind:'command-output',phase:'check'}], limitations:[] }));
  const identity = { project:'owner/repo',ticket:'1',executionId:'execution',branch:'topic',base:'main',baseline:'b'.repeat(40),tip:'a'.repeat(40),requirementsHash:'c'.repeat(16) };
  const code = Object.fromEntries(RUNTIME_ASSETS.map(({destination:n}) => { mkdirSync(dirname(join(workflow,n)),{recursive:true}); writeFileSync(join(workflow,n),n); return [n,sha256(n)]; }));
  const settings = { merge:{auto:true}, image:'test', execution:{runtime:{id:'a'.repeat(64),dependencies:'b'.repeat(64)},settings:{AGENT:{family:'openai'}},templates:{'prompt.verify.md':'c'.repeat(64)},additive:{}} };
  const frozen = createProof(state,evidence,identity,{imageId:`sha256:${'d'.repeat(64)}`,nodeVersion:'v22',code,settings});
  const at = new Date().toISOString();
  writeRecord(state,'owner_repo--1',{iid:'1',project:identity.project,executionId:identity.executionId,branch:identity.branch,base:identity.base,implementationBaseSha:identity.baseline,verification:{id:frozen.id,tip:identity.tip,requirementsHash:identity.requirementsHash},verdict:'PASS',stage:'waiting',stageSince:at,startedAt:at,updatedAt:at,pid:process.pid,delivery:{version:1,kind:'github',host:'github.com',repository:identity.project,project:identity.project,ticket:'1',executionId:identity.executionId,proofId:frozen.id,number:1,url:'https://github.com/owner/repo/pull/1',branch:'topic',base:'main',sha:identity.tip,state:'ci-waiting',reasonCode:'opened',observedAt:at}});
  const read = () => readRuns(state,false)[0];
  let observations = 0, merges = 0, refusal: string | undefined;
  const host = { state,workflow,settings,inventory:code,
    claim: r => claimDelivery({dir:state,project:r.project,iid:r.iid,pid:process.pid,cap:3}),
    finish: (r,token,d,note) => finishDelivery(state,r.project,r.iid,token,d,note),
    authorize: () => refusal,
    merge: async (_d, authorize) => {
      observations++;
      if(observations===1) return {state:'ci-waiting',reasonCode:'checks-pending',reason:'pending'};
      const why = authorize(); if(why) return {state:'operator-required',reasonCode:'authorization',reason:why};
      merges++; return {state:'merged',reasonCode:'merged',reason:'merged',mergedAt:at};
    },
  };
  return {root,read,host,frozen,workflow,setRefusal:(s:string)=>{refusal=s;},counts:()=>({observations,merges})};
}
test('one observation per pass then green merge once; original verification survives', async () => {
  const f=fixture(); try {
    await observeWaitingDelivery(f.read(),f.host); assert.deepEqual(f.counts(),{observations:1,merges:0}); assert.equal(f.read().delivery?.state,'ci-waiting');
    await observeWaitingDelivery(f.read(),f.host); assert.deepEqual(f.counts(),{observations:2,merges:1}); assert.equal(f.read().stage,'done'); assert.equal(f.read().verification?.id,f.frozen.id);
    await observeWaitingDelivery(f.read(),f.host); assert.deepEqual(f.counts(),{observations:2,merges:1});
  } finally {rmSync(f.root,{recursive:true,force:true});}
});
test('changed requirements, artifacts, workflow, settings or head stop before tracker observation', async () => {
  for(const change of ['requirements','artifact','workflow','settings','head','inventory','runtime','family','template-hash','additive-hash']) {
    const f=fixture(); try {
      if(change==='requirements'||change==='head') f.setRefusal(`${change} changed`);
      if(change==='artifact') { chmodSync(join(f.frozen.root,'output.txt'),0o600); writeFileSync(join(f.frozen.root,'output.txt'),'changed'); }
      if(change==='workflow') writeFileSync(join(f.workflow,'main.mts'),'changed');
      if(change==='settings') f.host.settings.image='changed';
      if(change==='inventory') delete f.host.inventory['context.mts'];
      if(change==='runtime') f.host.settings.execution.runtime.id='different-runtime';
      if(change==='family') f.host.settings.execution.settings.AGENT.family='anthropic';
      if(change==='template-hash') f.host.settings.execution.templates['prompt.verify.md']='changed';
      if(change==='additive-hash') f.host.settings.execution.additive['instructions.md']='changed';
      await observeWaitingDelivery(f.read(),f.host); assert.equal(f.read().delivery?.state,'operator-required',change); assert.deepEqual(f.counts(),{observations:0,merges:0});
    } finally {rmSync(f.root,{recursive:true,force:true});}
  }
});
test('failed current tracker reads stay retryable, while a pause during CI prevents merge', async () => {
  for (const phase of ['read', 'pause']) {
    const f = fixture(); try {
      if (phase === 'read') f.host.authorize = () => { throw new RetryableDeliveryRead('tracker unavailable'); };
      else f.host.merge = async (_d, authorize) => {
        f.setRefusal('scheduler paused during CI observation');
        return { state: 'operator-required', reasonCode: 'authorization', reason: authorize()! };
      };
      await observeWaitingDelivery(f.read(), f.host);
      assert.equal(f.read().delivery?.state, phase === 'read' ? 'ci-waiting' : 'operator-required');
      assert.equal(f.counts().merges, 0);
    } finally { rmSync(f.root, {recursive:true,force:true}); }
  }
});
test('legacy records are not adopted; tracker read failures stay retryable on same identity', async () => {
  const f=fixture(); try {
    assert.match(await observeWaitingDelivery({...f.read(),delivery:undefined},f.host),/Not a host-recorded/);
    f.host.merge=async()=>{throw Error('transport down');};
    await observeWaitingDelivery(f.read(),f.host); assert.equal(f.read().delivery?.state,'ci-waiting'); assert.equal(f.read().delivery?.reasonCode,'transport-unknown'); assert.equal(f.read().delivery?.number,1);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});
