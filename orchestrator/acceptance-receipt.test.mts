// Pure policy at the approved owned-runner seam; no sandbox or provider effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptanceHash, acceptanceIdentity, type AcceptanceContract, type ApprovalRecord, type ResultEnvelope } from './acceptance-contract.mts';
import { checkAcceptanceReceipt } from './acceptance-receipt.mts';

const contract = JSON.parse(readFileSync(new URL('../docs/acceptance-contract.md', import.meta.url), 'utf8').match(/```json\n([\s\S]*?)\n```/)![1]) as AcceptanceContract;
const identity = acceptanceIdentity(contract);
const approval: ApprovalRecord = { version: 1, id: 'review-17', identity, approvedRevision: 1, reviewer: { kind: 'human', name: 'reviewer@example.invalid' }, decision: 'approve', semanticAdequacy: true, provenance: 'fixture-host-review', reviewedAt: '2026-11-20T16:00:00.000Z' };
const binding = { executionId: 'execution-1', bundleId: 'a'.repeat(64), approvalId: approval.id, approvalDigest: acceptanceHash(approval), sha: 'b'.repeat(40), runtime: 'c'.repeat(64), dependencies: 'd'.repeat(64), image: 'sha256:' + 'e'.repeat(64), config: 'f'.repeat(64), setup: '0'.repeat(64), reset: 'fresh-container-private-tmpfs-v1', ownerId: 'container-1' };
function receipt() {
  const results: ResultEnvelope = { version: 1, phase: 'baseline', identity: { ...identity }, assertions: [
    { assertionId: 'A-summary', status: 'expected-behavioral-fail', failureId: 'summary-unavailable-or-wrong', evidence: ['owned:stdout'] },
    { assertionId: 'A-order', status: 'pass', failureId: null, evidence: ['owned:stdout'] },
  ], evidence: [{ criterionId: 'C-manual', requirement: 'independent documentation review', reference: 'host-review:1' }] };
  return { version: 1 as const, binding: { ...binding }, startedAt: 100, deadline: 200, finishedAt: 150, cleanup: 'confirmed' as const, results };
}
test('exact owned baseline receipt accepts named red, preservation and reviewed manual evidence', () => {
  assert.equal(checkAcceptanceReceipt(contract, { lookup: () => approval }, receipt(), binding, 160).status, 'valid');
});
test('foreign identities, late observations and unconfirmed cleanup never become usable receipts', () => {
  for (const key of Object.keys(binding)) {
    const r = receipt(); Object.assign(r.binding, { [key]: 'foreign' });
    assert.equal(checkAcceptanceReceipt(contract, { lookup: () => approval }, r, binding, 160).status, 'hold', key);
  }
  for (const change of [{ finishedAt: 201 }, { finishedAt: 99 }, { startedAt: NaN }, { deadline: Infinity }, { cleanup: 'unknown' }, { version: 2 }]) {
    const r = { ...receipt(), ...change };
    assert.equal(checkAcceptanceReceipt(contract, { lookup: () => approval }, r, binding, 160).status, 'hold');
  }
  assert.equal(checkAcceptanceReceipt(contract, { lookup: () => approval }, receipt(), binding, 149).status, 'hold');
});
test('receipt boundary preserves exact inventory, transition taxonomy and required manual observation', () => {
  const codeOf = (r: ReturnType<typeof receipt>) => {
    const result = checkAcceptanceReceipt(contract, { lookup: () => approval }, r, binding, 160);
    assert.equal(result.status, 'hold');
    if (result.status !== 'hold') throw Error('Expected held receipt');
    return result.code;
  };
  for (const [status, code] of [
    ['pass', 'already-green'], ['harness-error', 'infrastructure'], ['build-error', 'infrastructure'],
    ['import-error', 'infrastructure'], ['dependency-error', 'infrastructure'], ['timeout', 'infrastructure'],
    ['skipped', 'infrastructure'], ['missing', 'infrastructure'], ['unknown', 'infrastructure'],
    ['inconsistent', 'infrastructure'], ['not-a-status', 'invalid-results'],
  ]) {
    const r = receipt(); Object.assign(r.results.assertions[0], { status, failureId: null });
    assert.equal(codeOf(r), code);
  }
  const wrongRed = receipt(); wrongRed.results.assertions[0].failureId = 'different-behavior';
  assert.equal(codeOf(wrongRed), 'behavior-mismatch');
  const noManual = receipt(); noManual.results.evidence = [];
  assert.equal(codeOf(noManual), 'missing-evidence');
  for (const alter of [
    (r: ReturnType<typeof receipt>) => { r.results.assertions.pop(); },
    (r: ReturnType<typeof receipt>) => { r.results.assertions.push({ ...r.results.assertions[0] }); },
    (r: ReturnType<typeof receipt>) => { r.results.assertions[0].assertionId = 'foreign'; },
    (r: ReturnType<typeof receipt>) => { r.results.identity.contractDigest = '0'.repeat(64); },
    (r: ReturnType<typeof receipt>) => { r.results.phase = 'candidate'; },
  ]) { const r = receipt(); alter(r); assert.equal(codeOf(r), 'invalid-results'); }
});
test('candidate receipt needs original transition identities and exact reviewed evidence for each criterion', () => {
  const candidate = receipt();
  candidate.results.phase = 'candidate';
  candidate.results.assertions[0] = { assertionId: 'A-summary', status: 'pass', failureId: null, evidence: ['owned:candidate'] };
  candidate.results.evidence.push(
    { criterionId: 'C-feature', requirement: 'independent replay transcript', reference: 'host-review:feature' },
    { criterionId: 'C-preserve', requirement: 'independent replay transcript', reference: 'host-review:preservation' },
  );
  const check = (r: typeof candidate) => checkAcceptanceReceipt(contract, { lookup: () => approval }, r, binding, 160, 'candidate');
  assert.equal(check(candidate).status, 'valid');
  const holdCode = (r: typeof candidate) => {
    const result = check(r);
    if (result.status !== 'hold') throw Error('Expected held candidate receipt');
    return result.code;
  };
  for (const missing of ['C-feature', 'C-preserve', 'C-manual']) {
    const r = structuredClone(candidate);
    r.results.evidence = r.results.evidence.filter(e => e.criterionId !== missing);
    assert.equal(holdCode(r), 'missing-evidence', missing);
  }
  const wrongCriterion = structuredClone(candidate);
  wrongCriterion.results.evidence[0].criterionId = 'C-feature';
  assert.equal(holdCode(wrongCriterion), 'invalid-results');
  const duplicated = structuredClone(candidate);
  duplicated.results.evidence.push({ ...duplicated.results.evidence[0] });
  assert.equal(holdCode(duplicated), 'invalid-results');
  for (const key of ['contractDigest', 'fixtureDigest', 'probeDigest'] as const) {
    const r = structuredClone(candidate);
    r.results.identity[key] = '0'.repeat(64);
    assert.equal(holdCode(r), 'invalid-results', key);
  }
});
test('receipt approval is the exact retained approval, not another review of identical acceptance', () => {
  assert.equal(checkAcceptanceReceipt(contract, { lookup: () => ({ ...approval, id: 'review-18' }) }, receipt(), binding, 160).status, 'hold');
  assert.equal(checkAcceptanceReceipt(contract, { lookup: () => ({ ...approval, provenance: 'different-host-review' }) }, receipt(), binding, 160).status, 'hold');
  assert.equal(checkAcceptanceReceipt(contract, { lookup: () => approval }, { ...receipt(), deadline: 400_000 }, binding, 160).status, 'hold');
  assert.equal(checkAcceptanceReceipt(contract, { lookup: () => approval }, { ...receipt(), extra: true }, binding, 160).status, 'hold');
});
