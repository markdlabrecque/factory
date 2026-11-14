// Structural verification tests use synthetic artifacts, never a browser or tracker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateEvidence, createProof, readProof, assertProofStoreOutsideMounts } from './verification.mts';
const report = () => ({ version: 1, verdict: 'PASS', changeKind: 'feature', evidenceKind: 'command', interactive: false,
  criteria: [{ requirement: 'Works', result: 'pass', evidence: ['check.txt'] }], artifacts: [{ path: 'check.txt', kind: 'command-output', phase: 'check' }], limitations: ['Synthetic only.'] });
function fixture(r: any = report(), verdict = `VERDICT: ${r.verdict}\nDetails`) {
  const dir = mkdtempSync(join(tmpdir(), 'verification-'));
  writeFileSync(join(dir, 'verification.json'), JSON.stringify(r));
  writeFileSync(join(dir, 'verdict.md'), verdict);
  writeFileSync(join(dir, 'check.txt'), 'assertions passed\n');
  return dir;
}
test('exact verdict and report agreement; no legacy or prefix authorization', () => {
  for (const v of ['VERDICT: PASSING', 'VERDICT: PASS prose', ' VERDICT: PASS', 'VERDICT: FAIL'])
    assert.throws(() => validateEvidence(fixture(report(), v)));
  assert.equal(validateEvidence(fixture(report(), 'VERDICT: PASS\r\nDetails')).report.verdict, 'PASS');
});
test('strict schema, criterion references and bounds', () => {
  for (const change of [(r: any) => r.extra = true, (r: any) => r.criteria = [], (r: any) => r.criteria[0].evidence = [],
    (r: any) => r.criteria[0].evidence = ['missing'], (r: any) => r.artifacts.push(r.artifacts[0]),
    (r: any) => r.criteria = Array(201).fill(r.criteria[0]), (r: any) => r.interactive = 'false']) {
    const r = report(); change(r); assert.throws(() => validateEvidence(fixture(r)));
  }
  const r = report(); r.verdict = 'FAIL'; r.criteria[0] = { requirement: 'Works', result: 'fail', evidence: [], reason: 'Observed failure' } as any;
  assert.equal(validateEvidence(fixture(r)).report.verdict, 'FAIL');
});
test('reject unsafe, missing, empty, and reserved artifacts', () => {
  for (const path of ['../escape', '/etc/passwd', 'missing', 'verdict.md', 'verification.json', 'browser-preflight.log']) {
    const r = report(); r.artifacts[0].path = path; r.criteria[0].evidence = [path];
    assert.throws(() => validateEvidence(fixture(r)));
  }
  const dir = fixture(); writeFileSync(join(dir, 'check.txt'), ''); assert.throws(() => validateEvidence(dir));
  const linked = fixture(); symlinkSync('check.txt', join(linked, 'link.txt'));
  const r = report(); r.artifacts[0].path = 'link.txt'; r.criteria[0].evidence = ['link.txt'];
  writeFileSync(join(linked, 'verification.json'), JSON.stringify(r)); assert.throws(() => validateEvidence(linked));
});
test('browser and bugfix minimums cannot be replaced by command output', () => {
  for (const key of ['changeKind', 'evidenceKind']) {
    const r = report(); (r as any)[key] = key === 'changeKind' ? 'bugfix' : 'browser';
    assert.throws(() => validateEvidence(fixture(r)));
  }
});
test('browser bugfix needs both images and interactive video; bounds apply to non-PASS too', () => {
  const r: any = report(); r.evidenceKind = 'browser'; r.changeKind = 'bugfix'; r.interactive = true;
  r.artifacts = [{path:'before.png',kind:'image',phase:'before'}, {path:'after.png',kind:'image',phase:'after'}, {path:'after.webm',kind:'video',phase:'after'}];
  r.criteria[0].evidence = ['after.png'];
  const dir = fixture(r);
  for (const a of r.artifacts) writeFileSync(join(dir, a.path), 'synthetic');
  assert.equal(validateEvidence(dir).report.verdict, 'PASS');
  const large = fixture(); writeFileSync(join(large, 'verification.json'), ' '.repeat(1024 * 1024 + 1));
  assert.throws(() => validateEvidence(large), /1 MiB/);
  r.artifacts = Array(129).fill(r.artifacts[0]);
  assert.throws(() => validateEvidence(fixture(r)), /128/);
});

test('frozen proofs survive subsequent attempts and detect tampering', () => {
  const dir = fixture(), state = mkdtempSync(join(tmpdir(), 'proof-state-'));
  const identity = { project: 'o/r', ticket: '7', executionId: 'execution', branch: '7-fix', base: 'main', baseline: 'a'.repeat(40), tip: 'b'.repeat(40), requirementsHash: 'c'.repeat(64) };
  const p = createProof(state, dir, identity, { imageId: 'sha256:' + 'd'.repeat(64), nodeVersion: 'v22', code: {}, settings: {} });
  const p2 = createProof(state, dir, identity, { imageId: 'sha256:' + 'd'.repeat(64), nodeVersion: 'v22', code: {}, settings: {} });
  assert.notEqual(p2.id, p.id);
  assert.ok(!p.root.startsWith(dir + '/'));
  assert.throws(() => assertProofStoreOutsideMounts(join(dir, 'state'), [dir]), /overlaps/);
  symlinkSync(dir, join(state, 'mounted-alias'), 'dir');
  assert.throws(() => assertProofStoreOutsideMounts(join(state, 'mounted-alias/state'), [dir]), /overlaps/);
  writeFileSync(join(dir, 'check.txt'), 'changed');
  assert.equal(readProof(state, identity, p.id).proof.tip, identity.tip);
  chmodSync(join(p.root, 'check.txt'), 0o600);
  writeFileSync(join(p.root, 'check.txt'), 'tampered');
  assert.throws(() => readProof(state, identity, p.id), /integrity/);
});
