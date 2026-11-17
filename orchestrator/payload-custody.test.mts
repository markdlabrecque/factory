// Cheap synthetic event permutations prove fail-closed custody cutpoints; actual producer wiring lives in the flat-main fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beginPayloadCustody, custodyState, readPayloadCustody, type CustodyEvent, type PayloadBinding } from './payload-custody.mts';
import { ownerOf } from '../board/admission.mts';
const claim = randomUUID(), id = randomUUID(), second = randomUUID();
const binding: PayloadBinding = {project:{root:'/synthetic',tracker:{kind:'github',host:'github.com',project:'owner/repo'}},
  key:'owner_repo--7',ticket:'7',executionId:claim,claim,runtime:{id:'a'.repeat(64),dependencies:'b'.repeat(64)},
  entry:randomUUID(),lease:randomUUID(),owner:ownerOf(process.pid),baseline:'c'.repeat(40),ticketHash:'d'.repeat(64)};
const events: CustodyEvent[] = [{kind:'open',binding},{kind:'pending',id},{kind:'registered',id,container:'exact-one'},
  {kind:'absent',id,container:'exact-one'},{kind:'sealed'}];
for (const [name,length,sealed] of [['before custody',0,false],['before creation',1,false],['ambiguous create',2,false],
  ['registered/live',3,false],['close observed but handoff still open',4,false],['entire scope closed',5,true]] as const) {
  test(`custody cutpoint: ${name}`, () => {
    const c = custodyState(events.slice(0,length));
    assert.equal(c.sealed,sealed);
    if (length > 0 && length < 4) assert.throws(() => custodyState([...events.slice(0,length),{kind:'sealed'}]),/Unsettled/);
  });
}
test('all payloads/stages must close; no successor creation may reuse a sealed nonce', () => {
  const multi: CustodyEvent[] = [...events.slice(0,4),{kind:'pending',id:second}];
  assert.throws(() => custodyState([...multi,{kind:'sealed'}]),/Unsettled/);
  multi.push({kind:'registered',id:second,container:'exact-two'});
  assert.throws(() => custodyState([...multi,{kind:'sealed'}]),/Unsettled/);
  multi.push({kind:'absent',id:second,container:'exact-two'},{kind:'sealed'});
  assert.equal(custodyState(multi).sealed,true);
  assert.throws(() => custodyState([...events,{kind:'pending',id:randomUUID()}]),/already sealed/);
  assert.throws(() => custodyState([...events.slice(0,3),{kind:'absent',id,container:'wrong'}]),/Invalid exact/);
  assert.throws(() => custodyState([...events.slice(0,2),{kind:'absent',id,container:'exact-one'}]),/Invalid exact/);
  assert.throws(() => custodyState([{kind:'open',binding:{...binding,claim:randomUUID()}}]),/Invalid payload binding/);
});
test('real private filesystem journals keep interrupted creation unknown and immutable; new attempts use new nonces', t => {
  const state = mkdtempSync(join(tmpdir(),'payload-custody-')); t.after(() => rmSync(state,{recursive:true,force:true}));
  const c = beginPayloadCustody(state,binding), pending = c.pendingCreation();
  const dir = join(state,'payload-custody',c.pointer.nonce), first = readFileSync(join(dir,'000000.json'));
  assert.equal(readPayloadCustody(state,c.pointer).payloads.get(pending)?.container,undefined);
  assert.throws(() => c.finish(),/Unsettled/);
  c.register(pending,{sandboxId:'returned-exact'});
  assert.throws(() => c.finish(),/Unsettled/);
  assert.deepEqual(readFileSync(join(dir,'000000.json')),first);
  assert.deepEqual(readdirSync(dir).sort(),['000000.json','000001.json','000002.json']);
  const nextClaim = randomUUID(), next = beginPayloadCustody(state,{...binding,claim:nextClaim,executionId:nextClaim});
  assert.notEqual(next.pointer.nonce,c.pointer.nonce);
  assert.equal(readPayloadCustody(state,next.pointer).sealed,false);
  writeFileSync(join(dir,'000004.json'),'{}');
  assert.throws(() => readPayloadCustody(state,c.pointer),/Incomplete/);
});
