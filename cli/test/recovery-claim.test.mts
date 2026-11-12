// Recovery claim tests (#57): a repair attempt takes a shared-capacity slot, the ticket and its project's recovery slot
// together or not at all, and a dispatcher claim cannot take a ticket a recovery attempt owns. Disposable state folder;
// a sleeping child stands in for live run processes. Nothing launches.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimRun, readRuns } from '../../board/board.mts';
import { paths } from '../src/paths.mts';
import { claimRecovery } from '../src/recovery-claim.mts';
import { finishAttempt, observePass, readRecovery } from '../src/recovery-state.mts';

const root = '/work/project';
const at = (m: number) => new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString();
function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-claim-')));
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  t.after(() => { sleeper.kill(); rmSync(home, { recursive: true, force: true }); });
  const p = paths(home);
  const dir = join(home, 'runs');
  observePass(p, root, { pass: 'a', at: at(0), jam: [7, 8] });
  observePass(p, root, { pass: 'b', at: at(5), jam: [7, 8] });
  return { p, dir, pid: sleeper.pid!, sleeper };
}
// A run record whose process exited without finishing.
const stopped = (dir: string, iid: string, extra = {}) =>
  claimRun({ dir, project: 'proj', iid, pid: 2 ** 22 + 4321, cap: 99, patch: { stage: 'stopped', note: 'exited', starting: undefined, ...extra } });
const run = (dir: string, iid: string) => readRuns(dir).find(r => r.project === 'proj' && r.iid === iid);
const used = (p: ReturnType<typeof paths>, t: number) => readRecovery(p, root).budgets[t]?.used ?? 0;

test('a refused claim changes neither the board nor the recovery record', t => {
  const { p, dir, pid } = fixture(t);
  // The stopped ticket the attempt would repair, and the cap filled by other projects' runs.
  stopped(dir, '7', { branch: '7-fix', evidenceDir: '/ev/7' });
  assert.equal(run(dir, '7')!.stage, 'stopped');
  for (const iid of ['1', '2', '3']) claimRun({ dir, project: 'other', iid, pid, cap: 9 });
  const full = claimRecovery(p, { root, tracker: 'proj', ticket: 7, pid, at: at(10), dir });
  assert.deepEqual(full, { ok: false, reason: 'no capacity: 3 run(s) in flight, cap 3' });
  assert.equal(used(p, 7), 0, 'no budget spent');
  assert.equal(run(dir, '7')!.stage, 'stopped');

  // With room, the project's own checks still refuse: a ticket outside the confirmed jam.
  const roomy = claimRecovery(p, { root, tracker: 'proj', ticket: 9, pid, at: at(10), dir, cap: 9 });
  assert.equal(roomy.ok, false);
  assert.match((roomy as { reason: string }).reason, /not part of the confirmed jam/);
  assert.equal(run(dir, '9'), undefined);

  // A ticket with a dispatched launch in flight is owned by it.
  claimRun({ dir, project: 'proj', iid: '8', pid, cap: 9 });
  assert.match((claimRecovery(p, { root, tracker: 'proj', ticket: 8, pid, at: at(10), dir, cap: 9 }) as { reason: string }).reason, /already has a run in flight/);
  assert.equal(used(p, 8), 0);
});

test('an accepted claim owns capacity, the ticket and the project together, and survives its claimant dying', async t => {
  const { p, dir, pid, sleeper } = fixture(t);
  stopped(dir, '7', { branch: '7-fix', evidenceDir: '/ev/7' });
  stopped(dir, '8');
  const c = claimRecovery(p, { root, tracker: 'proj', ticket: 7, pid, at: at(10), dir });
  assert.equal(c.ok, true);
  const a = (c as { attempt: { seq: number; branch?: string } }).attempt;
  assert.equal(a.branch, '7-fix', 'the recorded branch is the attempt\'s');
  const r = run(dir, '7')!;
  assert.deepEqual([r.stage, r.starting, r.pid, r.branch, r.evidenceDir, r.recovery?.attempt, r.recovery?.from?.stage],
    ['setup', undefined, pid, '7-fix', '/ev/7', a.seq, 'stopped']);

  // The project's one recovery slot is taken: another jammed ticket waits, and nothing is written for it.
  assert.match((claimRecovery(p, { root, tracker: 'proj', ticket: 8, pid, at: at(11), dir }) as { reason: string }).reason, /still running/);
  assert.equal(run(dir, '8')!.stage, 'stopped');
  // A dispatcher cannot launch the ticket the attempt owns, and the attempt counts against the shared cap.
  assert.equal(claimRun({ dir, project: 'proj', iid: '7', pid, cap: 9 }).ok, false);
  assert.equal(claimRun({ dir, project: 'other', iid: '1', pid, cap: 1 }).ok, false);

  // A claimant that dies leaves a stopped record with its evidence, not a vanished one.
  sleeper.kill();
  await once(sleeper, 'exit');
  assert.deepEqual([run(dir, '7')!.stage, run(dir, '7')!.evidenceDir], ['stopped', '/ev/7']);
  finishAttempt(p, root, a.seq, { at: at(20), result: 'interrupted' });
});
