// #153: synthetic host proof, ownership and tracker boundaries; no agents, containers or live services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RUNTIME_ASSETS } from '../cli/src/runtime-assets.mts';
import { pathToFileURL } from 'node:url';
import { createProof, sha256 } from './verification.mts';
import { claimDelivery, finishDelivery, readRuns, writeRecord } from '../board/board.mts';
const runtime = mkdtempSync(join(tmpdir(), 'followup-runtime-'));
for (const { source, destination } of RUNTIME_ASSETS.filter(asset => asset.destination.endsWith('.mts'))) {
  copyFileSync(new URL(`../${source}`, import.meta.url), join(runtime, destination));
}
const { observeWaitingDelivery } = await import(pathToFileURL(join(runtime, 'delivery-followup.mts')).href);
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
// Positive continuation and freshness/transport cases use authentic version-2 proof in
// verification-entrypoint-proof.test.mts, not historical PASS repackaged as modern authority.
test('a same-SHA historical PASS requires explicit migration even with a valid CI checkpoint', async () => {
  const f=fixture(); try {
    const run=f.read(), base='factory/batch/example';
    assert.match(await observeWaitingDelivery({...run,base,delivery:{...run.delivery,base}},f.host),/batch delivery/i);
    assert.deepEqual(f.read(),run);assert.deepEqual(f.counts(),{observations:0,merges:0});
    assert.match(await observeWaitingDelivery({...f.read(),delivery:undefined},f.host),/Not a host-recorded/);
    assert.match(await observeWaitingDelivery(f.read(),f.host),/legacy proof.*fresh verification/i);
    assert.equal(f.read().delivery?.state,'operator-required');
    assert.equal(f.read().delivery?.number,1);
    assert.deepEqual(f.counts(),{observations:0,merges:0});
  } finally {rmSync(f.root,{recursive:true,force:true});}
});
