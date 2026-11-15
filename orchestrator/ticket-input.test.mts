// Offline frozen-input evidence and typed readiness checks. Sources and every file belong to the fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { freezeTicketInput, saveTicketInput, TicketInputHold } from './ticket-input.mts';
import { readSavedTicketInput } from './ticket-input-evidence.mts';
import type { TicketContextSource } from './ticket-context.mts';

function fixture() {
  let plan = '<details>Agreed parent plan</details>', fail = false;
  const source: TicketContextSource = {
    identity: {kind:'github',host:'github.test',project:'owner/repo'},
    ticket: iid => ({bytes:1,value:{iid,title:`Ticket ${iid}`,description:iid === 7 ? 'Full child specification {{TICKET}}' : 'Full parent body',url:`https://github.test/owner/repo/issues/${iid}`}}),
    parentOf: () => ({bytes:1,value:90}),
    notes: iid => {
      if (iid === 90 && fail) throw Error('secret transport output must not escape');
      return {bytes:1,value:{notes:iid === 90 ? [{id:'1',body:plan,author:'human',system:false,createdAt:'then',updatedAt:'now',url:'https://github.test/comment/1'}] : [],nextPage:null}};
    },
  };
  return {source, edit: () => {plan = 'Changed plan';}, fail: () => {fail = true;}};
}
test('frozen evidence records actual rendered bytes and relevant source identity, untouched by later reads', t => {
  const f = fixture(), input = freezeTicketInput(f.source,7);
  const dir = mkdtempSync(join(tmpdir(),'ticket-input-')); t.after(() => rmSync(dir,{recursive:true,force:true}));
  saveTicketInput(dir,input);
  const text = readFileSync(join(dir,'ticket-context.txt'),'utf8'), manifest = JSON.parse(readFileSync(join(dir,'ticket-sources.json'),'utf8'));
  assert.equal(text,input.text);
  assert.equal(manifest.renderedSha256,createHash('sha256').update(text).digest('hex'));
  assert.equal(manifest.contentHash,input.hash);
  assert.match(text,/Full child specification/); assert.match(text,/Full parent body/); assert.match(text,/Agreed parent plan/);
  assert.ok(manifest.coverage.some((c: any) => c.source === 'parent' && c.operation === 'notes' && c.included === 1));
  f.edit(); assert.notEqual(freezeTicketInput(f.source,7).hash,input.hash);
  assert.equal(readFileSync(join(dir,'ticket-context.txt'),'utf8'),text);
  assert.throws(() => saveTicketInput(dir,input),/EEXIST/,'never rewrite historical input evidence');
});
test('passive evidence projection rejects mismatched hashes, other attempts and symlink/oversize manifests', t => {
  const state = mkdtempSync(join(tmpdir(),'ticket-input-projection-')); t.after(() => rmSync(state,{recursive:true,force:true}));
  const input = freezeTicketInput(fixture().source,7), dir = join(state,'ticket-inputs','owner_repo--7','execution');
  saveTicketInput(dir,input);
  assert.equal(readSavedTicketInput(state,'owner/repo','7','execution',undefined,input.hash).state,'frozen');
  for (const [execution,attempt,hash] of [['other',undefined,input.hash],['execution','attempt',input.hash],['execution',undefined,'a'.repeat(64)]]) {
    assert.equal(readSavedTicketInput(state,'owner/repo','7',execution,attempt,hash).state,'unknown');
  }
  assert.equal(readSavedTicketInput(state,'owner/repo','7','../escape').state,'unknown');
  const file = join(dir,'ticket-sources.json'), outside = join(state,'outside.json');
  writeFileSync(outside,readFileSync(file)); rmSync(file); symlinkSync(outside,file);
  assert.equal(readSavedTicketInput(state,'owner/repo','7','execution').state,'unknown');
  rmSync(file); writeFileSync(file,' '.repeat(8*1024*1024+1));
  assert.equal(readSavedTicketInput(state,'owner/repo','7','execution').state,'unknown');
});

test('parent read failure is a source-specific ticket-only readiness outcome with no partial snapshot or raw error', () => {
  const f = fixture(); f.fail();
  assert.throws(() => freezeTicketInput(f.source,7), e => {
    assert.ok(e instanceof TicketInputHold);
    assert.equal(e.hold.source,'parent'); assert.equal(e.hold.operation,'notes');
    assert.equal(e.check.ticket,'7'); assert.equal(e.check.scope,'ticket-input'); assert.equal(e.check.status,'blocked'); assert.equal(e.check.automaticRecheck,'next-launch');
    assert.ok(!e.message.includes('secret')); return true;
  });
});
