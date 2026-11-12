// Recovery state tests (#55): confirming a jam on two completed passes, the per-ticket attempt budget and what renews it,
// reset, and fail-closed handling of a malformed or concurrently locked record. Disposable HOME only; nothing launches.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { ATTEMPT_LIMIT, LOG_LIMIT, attemptProblem, beginAttempt, finishAttempt, observePass, readRecovery, recoveryFile,
  remainingAttempts, renewBudget, resetRecovery } from '../src/recovery-state.mts';

const root = '/work/project';
function fixture(t: TestContext) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'factory-recovery-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return paths(dir);
}
const at = (m: number) => new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString();

test('a jam is confirmed only on two consecutive completed passes, each counted once', t => {
  const p = fixture(t);
  assert.equal(observePass(p, root, { pass: 'a', at: at(0), jam: [7] })!.confirmedAt, undefined);
  assert.equal(observePass(p, root, { pass: 'a', at: at(1), jam: [7] })!.confirmedAt, undefined, 'the same pass twice is one pass');
  assert.match(attemptProblem(readRecovery(p, root), 7)!, /No confirmed jam/);
  // A pass with a different jam starts a new episode; a clear pass ends it.
  observePass(p, root, { pass: 'b', at: at(5), jam: [7, 9] });
  observePass(p, root, { pass: 'c', at: at(10), jam: null });
  observePass(p, root, { pass: 'd', at: at(15), jam: [9, 7, 7] });
  const e = observePass(p, root, { pass: 'e', at: at(20), jam: [7, 9] })!;
  assert.deepEqual([e.tickets, e.confirmedAt, e.passes.map(x => x.pass)], [[7, 9], at(20), ['d', 'e']]);
  const s = readRecovery(p, root);
  assert.deepEqual(s.episodes.map(x => x.end), ['changed', 'cleared']);
  assert.equal(statSync(recoveryFile(p, root)).mode & 0o777, 0o600);
});

test('two attempts per ticket; a new episode does not renew the budget, verified progress, a requirement change or reset does', t => {
  const p = fixture(t);
  observePass(p, root, { pass: 'a', at: at(0), jam: [7] });
  observePass(p, root, { pass: 'b', at: at(5), jam: [7] });
  const first = beginAttempt(p, root, { ticket: 7, at: at(6), branch: '7-fix' });
  assert.throws(() => beginAttempt(p, root, { ticket: 7, at: at(7) }), /still running/);
  assert.throws(() => resetRecovery(p, root, { at: at(7) }), /reset refused/);
  finishAttempt(p, root, first.seq, { at: at(8), result: 'timed-out', reason: '15 minutes' });
  assert.throws(() => finishAttempt(p, root, first.seq, { at: at(9), result: 'failed' }), /not running/);
  // The jam clears and returns: confirmation starts over, the budget does not.
  observePass(p, root, { pass: 'c', at: at(10), jam: null });
  observePass(p, root, { pass: 'd', at: at(15), jam: [7] });
  observePass(p, root, { pass: 'e', at: at(20), jam: [7] });
  finishAttempt(p, root, beginAttempt(p, root, { ticket: 7, at: at(21) }).seq, { at: at(22), result: 'failed' });
  assert.match(attemptProblem(readRecovery(p, root), 7)!, /used its 2 recovery attempts/);
  assert.throws(() => beginAttempt(p, root, { ticket: 7, at: at(23) }), /used its 2/);

  renewBudget(p, root, { ticket: 7, at: at(24), kind: 'requirement-change', detail: 'label model:opus added' });
  assert.equal(remainingAttempts(readRecovery(p, root), 7), ATTEMPT_LIMIT);
  finishAttempt(p, root, beginAttempt(p, root, { ticket: 7, at: at(25) }).seq, { at: at(26), result: 'blocked' });

  resetRecovery(p, root, { at: at(30), detail: 'by hand' });
  const s = readRecovery(p, root);
  assert.equal(s.episode, undefined, 'reset needs fresh confirmation and launches nothing');
  assert.equal(remainingAttempts(s, 7), ATTEMPT_LIMIT);
  assert.deepEqual(s.attempts.map(a => [a.seq, a.result]), [[1, 'timed-out'], [2, 'failed'], [3, 'blocked']], 'history is kept');
  assert.deepEqual(s.renewals.map(r => r.kind), ['requirement-change', 'reset']);
});

test('history is bounded; malformed or locked records fail closed and are never overwritten', t => {
  const p = fixture(t);
  for (let i = 0; i < LOG_LIMIT + 5; i++) observePass(p, root, { pass: `p${i}`, at: at(i), jam: [i % 2 ? 1 : 2] });
  assert.equal(readRecovery(p, root).episodes.length, LOG_LIMIT);
  const file = recoveryFile(p, root);
  writeFileSync(`${file}.lock`, '');
  assert.throws(() => observePass(p, root, { pass: 'x', at: at(200), jam: [1] }), /Another factory command/);
  rmSync(`${file}.lock`);
  for (const bad of ['{', JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), root: '/elsewhere' })]) {
    writeFileSync(file, bad);
    assert.throws(() => beginAttempt(p, root, { ticket: 1, at: at(201) }), /recovery state/i);
    assert.equal(readFileSync(file, 'utf8'), bad);
  }
});
