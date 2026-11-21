// Admission seam: actual selected dispatcher and separately owned baseline engine, real disposable Git/state.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './refresh-fixture.mts';
import {readAdmission,readBaselineReservations} from '../board/admission.mts';
import {readStoredReadiness} from '../board/readiness.mts';

test('dispatch requires a separately authorized owned baseline before real implementation claim and launch', t => {
  const f = fixture(t);
  f.data.tickets[0].description='Model tier: mid\nStandalone requirement'; f.save(); f.manifest(7);
  const result=f.pass();
  assert.equal(existsSync(join(f.fake,'launches')),false,'no implementation child before authorized baseline');
  assert.equal(existsSync(join(f.dir,'owner_repo--7.json')),false,'no implementation claim-created run');
  const admission=readAdmission(f.dir);
  assert.deepEqual(admission.claims,{}); assert.deepEqual(admission.generations,{}); assert.deepEqual(admission.recovery,{});
  const stored=readStoredReadiness(f.dir,f.root);
  assert.ok('report' in stored,result.stdout+result.stderr);
  assert.equal(stored.report.checks.find(c=>c.id==='acceptance-baseline-7')?.reason,'Acceptance baseline: preparation-required');
});

test('authentic current authorized owned baseline permits the actual dispatch claim and implementation child', t => {
  const f=fixture(t); f.data.tickets[0].description='Model tier: mid\nStandalone requirement'; f.save(); f.manifest(7);
  f.baseline();
  assert.deepEqual(readBaselineReservations(f.dir),[],'baseline cleanup completed independently');
  assert.deepEqual(readAdmission(f.dir).claims,{},'baseline never takes implementation claim');
  const result=f.pass();
  assert.match(f.bytes(join(f.fake,'launches')),/--issue 7/,result.stdout+result.stderr);
  const run=JSON.parse(readFileSync(join(f.dir,'owner_repo--7.json'),'utf8'));
  assert.ok(run.claim,'actual implementation claim created only after baseline');
  assert.ok(readAdmission(f.dir).generations['owner/repo']>0);
});
