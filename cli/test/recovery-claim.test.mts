// Recovery claim tests (#57, admission record since #75): a repair attempt takes a shared-capacity slot, the ticket and
// its whole project together with its attempt charge, in one admission record replacement, or nothing; a dispatcher claim
// cannot take a ticket or project a recovery claim holds, which outlives its worker until released; a crash between the
// claim and applying its charge is replayed without charging twice or refunding; a normal admission breaks a pending jam
// confirmation through the project's activity generation. Disposable state folder; sleeping children stand in for live
// run processes, and a child that exits mid-claim stands in for a crash; an exited child nobody reaped (a zombie) is a dead
// owner (#64). Nothing launches.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admissionFile, generationOf, keyFor, ownerOf, ownerState, readAdmission, releaseClaim, withAdmission, withAdmissionLock } from '../../board/admission.mts';
import { claimRun, readRuns } from '../../board/board.mts';
import { paths } from '../src/paths.mts';
import { claimRecovery, replayAdmitted } from '../src/recovery-claim.mts';
import { attemptProblem, finishAttempt, observePass, readRecovery } from '../src/recovery-state.mts';

const root = '/work/project';
const at = (m: number) => new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString();
const ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
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
const reason = (x: unknown) => (x as { reason: string }).reason;

test('a refused claim changes neither the board, the admission record nor the recovery record', t => {
  const { p, dir, pid } = fixture(t);
  // The stopped ticket the attempt would repair, and the cap filled by other projects' runs.
  stopped(dir, '7', { branch: '7-fix', evidenceDir: '/ev/7' });
  assert.equal(run(dir, '7')!.stage, 'stopped');
  for (const iid of ['1', '2', '3']) claimRun({ dir, project: 'other', iid, pid, cap: 9 });
  const before = readAdmission(dir);
  const full = claimRecovery(p, { root, tracker: 'proj', ticket: 7, pid, at: at(10), dir, id: ID(1) });
  assert.deepEqual(full, { ok: false, reason: 'no capacity: 3 run(s) in flight, cap 3' });
  assert.equal(used(p, 7), 0, 'no budget spent');
  assert.equal(run(dir, '7')!.stage, 'stopped');
  assert.deepEqual(readAdmission(dir), before, 'nothing admitted');

  // With room, the project's own checks still refuse: a ticket outside the confirmed jam.
  assert.match(reason(claimRecovery(p, { root, tracker: 'proj', ticket: 9, pid, at: at(10), dir, cap: 9, id: ID(1) })), /not part of the confirmed jam/);
  assert.equal(run(dir, '9'), undefined);

  // A ticket with a dispatched launch in flight is owned by it.
  claimRun({ dir, project: 'proj', iid: '8', pid, cap: 9 });
  assert.match(reason(claimRecovery(p, { root, tracker: 'proj', ticket: 8, pid, at: at(10), dir, cap: 9, id: ID(1) })), /already has a run in flight/);
  assert.equal(used(p, 8), 0);
});

test('an accepted claim owns capacity, the ticket and the project together with its charge, and outlives its claimant', async t => {
  const { p, dir, pid, sleeper } = fixture(t);
  stopped(dir, '7', { branch: '7-fix', evidenceDir: '/ev/7' });
  stopped(dir, '8');
  const c = claimRecovery(p, { root, tracker: 'proj', ticket: 7, pid, at: at(10), dir, id: ID(1) });
  assert.equal(c.ok, true, reason(c));
  const a = (c as { attempt: { seq: number; branch?: string; id?: string } }).attempt;
  assert.deepEqual([a.branch, a.id], ['7-fix', ID(1)], "the recorded branch and UUID are the attempt's");
  const r = run(dir, '7')!;
  assert.deepEqual([r.stage, r.starting, r.pid, r.branch, r.evidenceDir, r.recovery?.attempt, r.recovery?.from?.stage],
    ['setup', undefined, pid, '7-fix', '/ev/7', a.seq, 'stopped']);
  const adm = readAdmission(dir);
  const claim = adm.claims[keyFor('7', 'proj')];
  assert.deepEqual([claim.kind, claim.attempt, claim.owner.pid, claim.token], ['recovery', ID(1), pid, r.claim]);
  assert.deepEqual(adm.recovery.proj, { admitted: 1, pending: [] }, 'charged once, and applied');
  assert.equal(used(p, 7), 1);
  assert.equal(statSync(admissionFile(dir)).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'admission')).mode & 0o777, 0o700);

  // The project's one recovery slot is taken: another jammed ticket waits, and nothing is written for it.
  assert.match(reason(claimRecovery(p, { root, tracker: 'proj', ticket: 8, pid, at: at(11), dir, id: ID(2) })), /still running|held by recovery/);
  assert.equal(run(dir, '8')!.stage, 'stopped');
  // A dispatcher cannot launch the ticket the attempt owns, and the attempt counts against the shared cap.
  assert.equal(claimRun({ dir, project: 'proj', iid: '7', pid, cap: 9 }).ok, false);
  assert.equal(claimRun({ dir, project: 'other', iid: '1', pid, cap: 1 }).ok, false);
  // The attempt holds its project: another ticket's normal launch there is refused, one elsewhere is not.
  assert.match(reason(claimRun({ dir, project: 'proj', iid: '9', pid, cap: 9 })), /held by recovery on #7/);
  assert.equal(claimRun({ dir, project: 'other', iid: '1', pid, cap: 9 }).ok, true);

  // A claimant that dies leaves the record stopped, and its claim still holds ticket, slot and project.
  sleeper.kill();
  await once(sleeper, 'exit');
  assert.deepEqual([run(dir, '7')!.stage, run(dir, '7')!.evidenceDir], ['stopped', '/ev/7']);
  assert.equal(claimRun({ dir, project: 'proj', iid: '7', pid: process.pid, cap: 9 }).ok, false, 'its ticket');
  assert.equal(claimRun({ dir, project: 'proj', iid: '8', pid: process.pid, cap: 9 }).ok, false, 'its project');
  assert.equal(claimRun({ dir, project: 'third', iid: '1', pid: process.pid, cap: 1 }).ok, false, 'its capacity slot');
  // Only an explicit release (settleRecovery, after the container is confirmed gone) lets go.
  finishAttempt(p, root, a.seq, { at: at(20), result: 'interrupted' });
  assert.equal(releaseClaim(dir, keyFor('7', 'proj'), 'not-the-token', 'recovery'), false, 'token-fenced');
  assert.equal(releaseClaim(dir, keyFor('7', 'proj'), claim.token, 'normal'), false, 'a normal release never ends a recovery claim');
  assert.equal(releaseClaim(dir, keyFor('7', 'proj'), claim.token, 'recovery'), true);
  assert.equal(claimRun({ dir, project: 'proj', iid: '8', pid: process.pid, cap: 9 }).ok, true);
});

test('a recovery claim yields to a normal run already in flight in its project', t => {
  const { p, dir, pid } = fixture(t);
  stopped(dir, '7', { branch: '7-fix' });
  assert.equal(claimRun({ dir, project: 'proj', iid: '9', pid, cap: 9 }).ok, true);
  assert.match(reason(claimRecovery(p, { root, tracker: 'proj', ticket: 7, pid, at: at(10), dir, id: ID(1) })), /in flight/);
  assert.equal(run(dir, '7')!.stage, 'stopped');
});

test('a crash between the claim and applying its charge is replayed once: never charged twice, never refunded', t => {
  const { p, dir, pid } = fixture(t);
  stopped(dir, '7', { branch: '7-fix' });
  // A claimant process that dies right after the admission record's one replacement (claim + charge).
  const code = `
    const { paths } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../src/paths.mts')).href)});
    const { claimRecovery } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../src/recovery-claim.mts')).href)});
    claimRecovery(paths(${JSON.stringify(p.home)}), { root: ${JSON.stringify(root)}, tracker: 'proj', ticket: 7, pid: ${pid}, at: ${JSON.stringify(at(10))},
      dir: ${JSON.stringify(dir)}, id: ${JSON.stringify(ID(1))}, container: 'factory-recovery-${ID(1)}', afterCommit: () => process.exit(9) });`;
  const crash = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(crash.status, 9, crash.stderr);
  // Committed: the claim and its pending charge. Not yet applied: no attempt, no budget spent, the run record untouched.
  const adm = readAdmission(dir);
  assert.equal(adm.claims[keyFor('7', 'proj')].attempt, ID(1));
  assert.deepEqual(adm.recovery.proj.pending.map(a => a.id), [ID(1)]);
  assert.equal(used(p, 7), 0);
  assert.equal(readRecovery(p, root).attempts.length, 0);
  assert.equal(run(dir, '7')!.stage, 'stopped');

  // The dead claimant's lock is taken over; the next claim replays the charge first, then refuses (an attempt runs).
  assert.match(reason(claimRecovery(p, { root, tracker: 'proj', ticket: 8, pid, at: at(11), dir, id: ID(2) })), /still running|held by recovery/);
  const s = readRecovery(p, root);
  assert.deepEqual(s.attempts.map(a => [a.id, a.result, a.container]), [[ID(1), 'running', `factory-recovery-${ID(1)}`]]);
  assert.equal(used(p, 7), 1, 'charged exactly once');
  assert.deepEqual(readAdmission(dir).recovery.proj, { admitted: 1, pending: [] });
  // Replaying again changes nothing.
  withAdmission(dir, tx => replayAdmitted(p, tx, root, 'proj'));
  assert.equal(used(p, 7), 1);
  assert.equal(readRecovery(p, root).attempts.length, 1);
  assert.ok(readAdmission(dir).claims[keyFor('7', 'proj')], 'and the claim is never refunded by a crash');
});

test('a normal admission breaks a pending jam confirmation through the project activity generation', t => {
  const { p, dir, pid } = fixture(t);
  const gen = () => generationOf(readAdmission(dir), 'proj');
  const g0 = gen();
  observePass(p, root, { pass: 'c', at: at(10), jam: [5], generation: g0 });
  // A normal run is admitted in the project between the two passes (it has finished since).
  const dead = 2 ** 22 + 4321;
  assert.equal(claimRun({ dir, project: 'proj', iid: '6', pid: dead, cap: 9, patch: { stage: 'done', starting: undefined } }).ok, true);
  assert.equal(gen(), g0 + 1);
  assert.equal(claimRun({ dir, project: 'other', iid: '6', pid, cap: 9 }).ok, true);
  assert.equal(gen(), g0 + 1, "another project's admission does not count");
  const e = observePass(p, root, { pass: 'd', at: at(15), jam: [5], generation: gen() });
  assert.equal(e!.confirmedAt, undefined, 'confirmation starts over');
  assert.equal(e!.passes.length, 1);
  const c = observePass(p, root, { pass: 'e', at: at(20), jam: [5], generation: gen() });
  assert.equal(c!.confirmedAt, at(20));
  // A normal admission after confirmation makes the confirmed jam stale for an attempt.
  assert.equal(attemptProblem(readRecovery(p, root), 5, gen()), null);
  assert.equal(claimRun({ dir, project: 'proj', iid: '4', pid: dead, cap: 9, patch: { stage: 'stopped', starting: undefined } }).ok, true);
  assert.match(reason(claimRecovery(p, { root, tracker: 'proj', ticket: 5, pid, at: at(25), dir, cap: 9, id: ID(1) })), /Normal work was admitted/);
});

test('a stale run cannot overwrite a newer claim: board writes and the exit handler are token-fenced', async t => {
  const { dir } = fixture(t);
  const board = pathToFileURL(join(import.meta.dirname, '../../board/board.mts')).href;
  // A dispatched run: the claim is made, then the run adopts it and keeps writing (its heartbeat) until told to stop.
  const first = claimRun({ dir, project: 'proj', iid: '7', pid: process.pid, cap: 9 });
  assert.equal(first.ok, true);
  const code = `
    const b = await import(${JSON.stringify(board)});
    b.setProject('proj');
    process.stdout.write('adopted ' + b.adoptClaim('7') + '\\n');
    process.stdin.once('data', () => { b.setStage('7', { note: 'stale heartbeat' }); b.setStage('7', { stage: 'stopped', note: 'exit handler' }); process.exit(0); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env: { ...process.env, SANDCASTLE_STATE_DIR: dir }, stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  const [line] = await once(child.stdout!, 'data');
  assert.equal(String(line).trim(), `adopted ${(first as { run: { claim: string } }).run.claim}`);
  assert.equal(readAdmission(dir).claims[keyFor('7', 'proj')].owner.pid, child.pid, 'the claim now belongs to the run');
  // The old claim is given up for dead (its record stopped, its claim released) and a newer one claims the ticket.
  releaseClaim(dir, keyFor('7', 'proj'), (first as { run: { claim: string } }).run.claim);
  writeFileSync(join(dir, 'proj--7.json'), JSON.stringify({ ...run(dir, '7'), stage: 'stopped' }));
  const second = claimRun({ dir, project: 'proj', iid: '7', pid: process.pid, cap: 9, patch: { note: 'newer' } });
  assert.equal(second.ok, true, reason(second));
  child.stdin!.write('go\n');
  await once(child, 'exit');
  const r = run(dir, '7')!;
  assert.deepEqual([r.claim, r.note, r.stage], [(second as { run: { claim: string } }).run.claim, 'newer', 'setup'], 'the newer claim\'s record is untouched');
  assert.ok(readAdmission(dir).claims[keyFor('7', 'proj')], 'and its claim was not released by the stale run');
});

test('claims race across processes: exactly one claimant wins a ticket', async t => {
  const { dir } = fixture(t);
  const board = pathToFileURL(join(import.meta.dirname, '../../board/board.mts')).href;
  const code = `const b = await import(${JSON.stringify(board)}); const c = b.claimRun({ dir: ${JSON.stringify(dir)}, project: 'proj', iid: '7', pid: process.ppid, cap: 9 }); process.stdout.write(c.ok ? 'won' : 'lost');`;
  const kids = Array.from({ length: 6 }, () => spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] }));
  const outs = await Promise.all(kids.map(async k => { let s = ''; k.stdout!.on('data', d => { s += d; }); await once(k, 'exit'); return s; }));
  assert.deepEqual(outs.filter(o => o === 'won').length, 1, outs.join(','));
  assert.equal(Object.keys(readAdmission(dir).claims).length, 1);
});

test('the admission lock is never taken over by age or a live pid alone; corrupt or unknown records fail closed', t => {
  const { dir, pid } = fixture(t);
  const lock = join(dir, 'admission', 'lock');
  mkdirSync(join(dir, 'admission'), { recursive: true });
  // A live holder, however old its lock: waited for, then refused.
  writeFileSync(lock, JSON.stringify(ownerOf(pid)));
  utimesSync(lock, new Date(0), new Date(0));
  assert.throws(() => withAdmissionLock(dir, () => 'got it', 200), /locked by process/);
  // The same pid with another start identity is a reused pid: its holder is gone, so the lock is taken over.
  writeFileSync(lock, JSON.stringify({ pid, start: 'linux:1' }));
  assert.equal(withAdmissionLock(dir, () => 'got it', 200), 'got it');
  assert.equal(existsSync(lock), false, 'released');
  // An unreadable lock is never taken over by age.
  writeFileSync(lock, '');
  utimesSync(lock, new Date(0), new Date(0));
  assert.throws(() => withAdmissionLock(dir, () => 'got it', 200), /never taken over by age/);
  rmSync(lock);

  for (const bad of ['{not json', JSON.stringify({ version: 2, claims: {}, generations: {}, recovery: {} })]) {
    writeFileSync(admissionFile(dir), bad);
    assert.throws(() => claimRun({ dir, project: 'proj', iid: '7', pid, cap: 9 }), /admission record/i);
    assert.equal(readFileSync(admissionFile(dir), 'utf8'), bad, 'never overwritten');
    assert.equal(run(dir, '7'), undefined, 'nothing claimed');
  }
});

test('an owner that exited but was never reaped (a zombie) is dead, so a crashed repair can be settled (#64)', { skip: process.platform !== 'linux' && 'needs /proc' }, async t => {
  // `sleep 0` exits at once; its parent becomes `sleep 5`, which never waits for it, so it stays a zombie.
  const parent = spawn('sh', ['-c', 'sleep 0 & echo $!; exec sleep 5'], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => parent.kill('SIGKILL'));
  const [chunk] = await once(parent.stdout!, 'data');
  const pid = Number(String(chunk).trim());
  const fields = () => readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  const state = () => fields()[0];
  for (let i = 0; i < 200 && state() !== 'Z'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(state(), 'Z');
  assert.equal(ownerState({ pid, start: `linux:${fields()[19]}` }), 'dead', 'even with its own start identity');
  assert.equal(ownerState(ownerOf(process.pid)), 'alive');
});
