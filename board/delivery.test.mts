// #153: delivery admission preserves execution/evidence and fences competing observers without charging repairs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimDelivery, claimRun, finishDelivery, readRuns, writeRecord } from './board.mts';
import { readAdmission, releaseClaim, withAdmission } from './admission.mts';
import { validDelivery } from './delivery.mts';
import type { DeliveryCheckpoint } from './delivery.mts';
const checkpoint: DeliveryCheckpoint = { version: 1, kind: 'github', host: 'github.com', repository: 'owner/repo', number: 1, url: 'https://github.com/owner/repo/pull/1', branch: 'topic', base: 'main', sha: 'a'.repeat(40), proofId: '00000000-0000-0000-0000-000000000001', project: 'owner/repo', ticket: '1', executionId: 'execution', state: 'ci-waiting', reasonCode: 'opened', observedAt: new Date().toISOString() };
test('strict checkpoint rejects unknown state, malformed URL/head and missing identity', () => {
  assert.ok(validDelivery(checkpoint));
  for (const patch of [{ version: 2 }, { state: 'ready' }, { url: 'https://evil.test/owner/repo/pull/1' }, { sha: 'tip' }, { executionId: '' }, { kind: 'gitlab' }, { state: 'merged' }]) assert.equal(validDelivery({ ...checkpoint, ...patch }), false);
});
test('dead or PID-reused delivery owners can be reclaimed without a repair charge', () => {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-dead-')), key = 'owner_repo--1', project = checkpoint.project;
  try {
    writeRecord(dir, key, { iid: '1', project, stage: 'waiting', stageSince: checkpoint.observedAt, startedAt: checkpoint.observedAt, updatedAt: checkpoint.observedAt, pid: process.pid, executionId: 'execution', delivery: checkpoint });
    const first = claimDelivery({ dir, project, iid: '1', pid: process.pid, cap: 1 }); assert.ok(first.ok); if (!first.ok) return;
    withAdmission(dir, tx => { tx.state.claims[key].owner = { pid: process.pid, start: 'a-prior-process-start' }; tx.commit(); });
    const second = claimDelivery({ dir, project, iid: '1', pid: process.pid, cap: 1 }); assert.ok(second.ok); if (!second.ok) return;
    assert.notEqual(second.run.claim, first.run.claim); assert.equal(second.run.executionId, 'execution');
    assert.equal(finishDelivery(dir, project, '1', first.run.claim!, checkpoint, ''), false);
    assert.equal(readAdmission(dir).generations[project], 2); assert.deepEqual(readAdmission(dir).recovery, {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('one delivery owner, shared capacity and recovery exclusion; fenced completion retains evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-claim-'));
  const project = checkpoint.project, key = 'owner_repo--1';
  try {
    writeRecord(dir, key, { iid: '1', project, stage: 'waiting', stageSince: checkpoint.observedAt, startedAt: checkpoint.observedAt, updatedAt: checkpoint.observedAt, pid: process.pid, verdict: 'PASS', executionId: 'execution', evidenceDir: 'retained', delivery: checkpoint });
    const c = claimDelivery({ dir, project, iid: '1', pid: process.pid, cap: 1 });
    assert.ok(c.ok); if (!c.ok) return;
    assert.equal(c.run.executionId, 'execution'); assert.equal(c.run.stage, 'waiting');
    assert.equal(claimDelivery({ dir, project, iid: '1', pid: process.pid, cap: 2 }).ok, false);
    assert.equal(claimRun({ dir, project, iid: '2', pid: process.pid, cap: 1 }).ok, false);
    assert.equal(claimRun({ dir, project, iid: '2', pid: process.pid, cap: 3, kind: 'recovery', attempt: 'repair' }).ok, false);
    assert.equal(readAdmission(dir).generations[project], 1);
    assert.deepEqual(readAdmission(dir).recovery, {});
    assert.equal(finishDelivery(dir, project, '1', 'stale', checkpoint, ''), false);
    assert.equal(releaseClaim(dir, key, 'stale'), false);
    assert.ok(finishDelivery(dir, project, '1', c.run.claim!, { ...checkpoint, state: 'merged', reasonCode: 'merged', mergedAt: checkpoint.observedAt }, 'merged'));
    const r = readRuns(dir, false)[0]; assert.equal(r.stage, 'done'); assert.equal(r.verdict, 'PASS'); assert.equal(r.evidenceDir, 'retained'); assert.equal(r.executionId, 'execution');
    assert.equal(Object.keys(readAdmission(dir).claims).length, 0);
    // A new execution clears only current pointers, not historical evidence.
    const next = claimRun({ dir, project, iid: '1', pid: process.pid, cap: 2 });
    assert.ok(next.ok); if (next.ok) { assert.equal(next.run.delivery, undefined); assert.notEqual(next.run.executionId, 'execution'); assert.equal(next.run.evidenceDir, 'retained'); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
