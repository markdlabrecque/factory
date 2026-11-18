// Offline unit tests for untrusted reports and the continuation decision; the runner fixture proves the handoff.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { continuationRefusal, outcomeFile, readImplementationOutcome, waitForContinuation } from './implementation-outcome.mts';

const claim = { status: 'incomplete', reason: 'initial exploration', nextAction: 'make focused change' } as const;
test('implementation report must be bounded, a regular file and bound to this execution and turn', t => {
  const dir = mkdtempSync(join(tmpdir(), 'implementation-outcome-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, outcomeFile('initial'));
  const row = { ...claim, executionId: 'current', turn: 'initial', version: 1 };
  const read = () => readImplementationOutcome(dir, 'current', 'initial');
  assert.deepEqual(read(), { status: 'missing' });
  for (const input of ['{', ' '.repeat(4097), ...[
    { executionId: 'old' }, { turn: 'continuation' }, { version: 2 }, { status: 'done' }, { reason: '' }, { nextAction: 42 }, { blocker: true },
  ].map(change => JSON.stringify({ ...row, ...change }))]) {
    writeFileSync(path, input);
    assert.deepEqual(read(), { status: 'invalid' }, input.slice(0, 200));
  }
  writeFileSync(path, JSON.stringify({ ...row, reason: 'token=fixture-secret' }));
  assert.deepEqual(read(), { ...claim, reason: '[credential redacted]' });
  assert.deepEqual(readImplementationOutcome(dir, 'current', 'continuation'), { status: 'missing' });
  rmSync(path);
  const target = join(dir, 'other'); writeFileSync(target, JSON.stringify(row)); symlinkSync(target, path);
  assert.deepEqual(read(), { status: 'invalid' });
});

test('only a known, eligible first turn can spend remaining time on a continuation', () => {
  type Facts = Parameters<typeof continuationRefusal>[0];
  const eligible: Facts = { outcome: claim, worktree: 'clean', dependencyReport: false, zeroCommits: true,
    replyCaptured: true, canResume: true, cancelled: false, remainingMs: 1000 };
  assert.equal(continuationRefusal(eligible), undefined);
  for (const refusal of [
    { outcome: { status: 'missing' } }, { outcome: { status: 'invalid' } },
    { outcome: { ...claim, status: 'implemented' } }, { outcome: { ...claim, status: 'blocked' } },
    { worktree: 'dirty' }, { worktree: 'unknown' }, { zeroCommits: false }, { dependencyReport: true },
    { replyCaptured: false }, { canResume: false }, { cancelled: true }, { remainingMs: 0 }, { remainingMs: NaN },
  ] satisfies Partial<Facts>[]) assert.match(continuationRefusal({ ...eligible, ...refusal })!, /^continuation refused:/);
});

test('cancellation stops the host wait even when the SDK is stuck outside its agent command', async () => {
  const controller = new AbortController();
  const result = waitForContinuation(new Promise(() => {}), controller.signal);
  controller.abort(Error('shared implementation time expired'));
  await assert.rejects(result, /shared implementation time expired/);
});
