// Cheapest-tier review context/parser matrices: originals and exact host identity, no external effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewFixture, AT } from '../cli/test/supervisor-fixture.mts';
import { reviewContext, reviewContextHold, parseGateReview } from './gate-review.mts';
import { supervisorHash, proposalIdentity } from './supervisor-contract.mts';
const identity={invocationId:'fresh',reviewer:'independent',model:'fixed-large',policy:'a'.repeat(64)};
function output(input:any) {return {version:1,inputHash:supervisorHash(input),proposalId:input.proposal.id,...identity,disposition:'approve',reason:'Equivalent command, scoped originals and risks considered'};}
test('full frozen original review context, not supervisor transcript or summaries',()=>{
  const {input}=reviewFixture();const context=reviewContext(input,identity);
  assert.deepEqual(context.input,input); assert.equal(context.input.snapshot.sources.find(x=>x.role==='human-planning')!.text,'original human-planning');
  assert.equal(reviewContextHold(input),undefined);
  assert.equal(parseGateReview(JSON.stringify(output(input)),input,identity,AT,AT).disposition,'approve');
  for(const role of ['child','parent','human-planning','guidelines','factory-rules','gate','failure','prior-decisions']) {
    for(const status of ['missing','truncated']) {
      const {input:changed}=reviewFixture();const source=changed.snapshot.sources.find(x=>x.role===role)!;
      source.status=status as any;if(status==='missing'){source.text='';source.sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';}
      changed.proposal.snapshotHash=supervisorHash(changed.snapshot);const {id,...body}=changed.proposal;changed.proposal.id=proposalIdentity(body);
      assert.ok(reviewContextHold(changed));assert.throws(()=>parseGateReview(JSON.stringify(output(changed)),changed,identity,AT,AT),/Incomplete/);
      assert.equal(parseGateReview(JSON.stringify({...output(changed),disposition:'deny'}),changed,identity,AT,AT).disposition,'deny');
    }
  }
});
test('strict JSON and exact proposal/context/invocation/reviewer/model/policy binding',()=>{
  const {input}=reviewFixture();const good=output(input);
  for(const field of ['inputHash','proposalId','invocationId','reviewer','model','policy','version','disposition'])
    assert.throws(()=>parseGateReview(JSON.stringify({...good,[field]:'foreign'}),input,identity,AT,AT),field);
  for(const raw of ['{}','```json\n'+JSON.stringify(good)+'\n```',JSON.stringify({...good,extra:true}),JSON.stringify({...good,reason:''}),JSON.stringify(good)+' trailing','x'.repeat(16385)])
    assert.throws(()=>parseGateReview(raw,input,identity,AT,AT));
  for(const field of Object.keys(input.snapshot.material)) {
    const changed=structuredClone(input);(changed.snapshot.material as any)[field]=field==='tip'?'c'.repeat(40):'c'.repeat(64);
    changed.proposal.snapshotHash=supervisorHash(changed.snapshot);const {id,...body}=changed.proposal;changed.proposal.id=proposalIdentity(body);
    assert.throws(()=>parseGateReview(JSON.stringify(good),changed,identity,AT,AT),field);
  }
});
