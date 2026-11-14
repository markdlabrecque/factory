// #137: recovery review includes nested runtime/parser assets in its complete-workflow fixture.
// Recovery workflow fixtures include assessment.mts and journal.mts, mandatory board imports in the reviewed copy.
// Recovery launcher tests (#60, #74): an attempt's UUID and exact container name are fixed and recorded (recovery state,
// run record, host-owned attempt record) before the detached repair process starts; it resumes the recorded branch and
// holds the claim; a finished attempt is recorded from its attempt record; a crashed one is settled as interrupted only
// after its exact container is confirmed gone, never touching another container (even one mounting the same worktree);
// a cleanup-pending attempt keeps its intended outcome; a death during delivery is never replayed; a ticket stops after
// two attempts; the recovery claim in the admission record outlives the worker until settled (#75); a pre-upgrade run is
// adopted into an ownership receipt; a remote-only branch is fetched exactly, and ambiguous or mismatched refs refused. Disposable Git repo, run-state folder and recovery record; a sleeping process stands in for the repair
// process and a fake docker (exact-name inspect and rm -f only; anything else throws). No tracker, agent or real Docker.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAdmission } from '../../board/admission.mts';
import { claimRun, readRuns } from '../../board/board.mts';
import { projectId, readReceipt, receiptFile, recordIntent } from '../../orchestrator/ownership.mts';
import { containerFor, readAttemptRecord, writeAttemptRecord } from '../../orchestrator/recovery.mts';
import type { AttemptRecord, Docker } from '../../orchestrator/recovery.mts';
import { paths } from '../src/paths.mts';
import { recordReview, WORKFLOW } from '../src/recovery-review.mts';
import { launchRecovery, settleRecovery } from '../src/recovery-run.mts';
import type { Spawner } from '../src/recovery-run.mts';
import { beginAttempt, observePass, readRecovery } from '../src/recovery-state.mts';

const at = (m: number) => new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString();

const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

function fixture(t: TestContext, o: { copy?: boolean; worktree?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-recover-')));
  const children: ChildProcess[] = [];
  t.after(() => { for (const c of children) c.kill('SIGKILL'); rmSync(home, { recursive: true, force: true }); });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
  const root = join(home, 'site');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(root, 'branch', '7-fix-login');
  // The ticket's Factory worktree, with a commit and uncommitted work the repair must keep.
  const worktree = join(root, '.sandcastle/worktrees/7-fix-login');
  if (o.worktree === false) {
    git(root, 'commit', '-q', '--allow-empty', '-m', 'on main');
    mkdirSync(join(root, '.sandcastle/worktrees'), { recursive: true });
  } else {
    git(root, 'worktree', 'add', '-q', worktree, '7-fix-login');
    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'half done');
    writeFileSync(join(worktree, 'wip.txt'), 'uncommitted\n');
  }
  const evidence = join(root, '.sandcastle/evidence/7');
  mkdirSync(evidence, { recursive: true });
  // The tracker identity the project's ownership receipts are keyed by.
  writeFileSync(join(root, '.sandcastle/config.mts'), 'export const TRACKER = {\n  kind: "github",\n  host: "github.com",\n  project: "proj",\n};\n');
  writeFileSync(join(evidence, 'before-1.png'), 'old evidence');
  if (o.copy !== false) {
    writeFileSync(join(root, '.sandcastle/main.mts'), 'parseArgs({ options: { recover: { type: "string" }, "attempt-record": { type: "string" } } });\n');
    // #137: runtime/parser workflow review includes nested assets.
    for (const f of WORKFLOW.filter(f => f !== 'main.mts')) { mkdirSync(join(root, '.sandcastle', f, '..'), { recursive: true }); writeFileSync(join(root, '.sandcastle', f), ''); }
  }
  const p = paths(home);
  if (o.copy !== false) recordReview(p, root);
  const dir = join(home, 'runs');
  // A stopped run of #7 and a confirmed jam that includes it.
  claimRun({ dir, project: 'proj', iid: '7', pid: 2 ** 22 + 4321, cap: 99,
    patch: { stage: 'stopped', note: 'exited', starting: undefined, branch: '7-fix-login', base: 'main', evidenceDir: evidence } });
  observePass(p, root, { pass: 'a', at: at(0), jam: [7] });
  observePass(p, root, { pass: 'b', at: at(5), jam: [7] });

  const launched: { cmd: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; child: ChildProcess }[] = [];
  const spawner: Spawner = (cmd, args, so) => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    children.push(child);
    launched.push({ cmd, args, cwd: so.cwd, env: so.env, child });
    return child.pid!;
  };
  // Containers by exact name; rm -f removes one unless it is stuck. Listing or filtering is not supported.
  const containers = new Set<string>();
  const stuck = new Set<string>();
  const removed: string[] = [];
  const docker: Docker = args => {
    const name = args.at(-1)!;
    if (args[0] === 'rm' && args[1] === '-f') { removed.push(name); if (!stuck.has(name)) containers.delete(name); return { status: 0, stdout: '', stderr: '' }; }
    if (args[0] === 'container' && args[1] === 'inspect') {
      return containers.has(name) ? { status: 0, stdout: `/${name}`, stderr: '' } : { status: 1, stdout: '', stderr: `Error: No such container: ${name}` };
    }
    throw new Error(`unexpected docker call: ${args.join(' ')}`);
  };
  let n = 0;
  const uuid = () => IDS[n++];
  const common = { root, tracker: 'proj', dir, docker, spawn: spawner, npx: 'npx', uuid };
  const run = () => readRuns(dir).find(r => r.project === 'proj' && r.iid === '7')!;
  const kill = async (c: ChildProcess) => { c.kill('SIGKILL'); await once(c, 'exit'); };
  const record = (i: number) => join(p.recovery, 'attempts', `${IDS[i]}.json`);
  const readRecord = (i: number) => (readAttemptRecord(record(i)) as { record: AttemptRecord }).record;
  /** What main.mts writes as the attempt moves on. */
  const advance = (i: number, patch: Partial<AttemptRecord>) => writeAttemptRecord(record(i), { ...readRecord(i), ...patch });
  return { home, root, p, dir, git, worktree, evidence, launched, containers, stuck, removed, common, run, kill, record, readRecord, advance };
}

test('an attempt is refused without the recovery workflow copy, claiming nothing', t => {
  const f = fixture(t, { copy: false });
  const r = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /no recovery workflow \(missing main\.mts, recovery\.mts, recovery-sandbox\.mts, handoff\.mts, ownership\.mts, admission\.mts, assessment\.mts, journal\.mts, board\.mts, prompt\.recover\.md, prompt\.verify\.md, project-config\.mts, runtime-config\.mts, selection\.mts, vendor\/smol-toml\/index\.js/);
  assert.equal(f.launched.length, 0);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0, 'no attempt recorded, no budget spent');
  assert.equal(f.run().stage, 'stopped');
});

test('a repair runs detached on the recorded branch with its identity fixed first, holds the ticket, and is recorded from its attempt record', async t => {
  const f = fixture(t);
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  const r = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  const [l] = f.launched;
  assert.deepEqual([l.cmd, ...l.args], ['npx', 'tsx', '.sandcastle/main.mts', '--issue', '7', '--base', 'main', '--recover', '1', '--attempt-record', f.record(0)]);
  assert.equal(l.cwd, f.root);
  assert.equal(l.env.SANDCASTLE_STATE_DIR, f.dir);
  // Identity recorded before the process started: recovery state, run record and host-owned attempt record agree.
  const attempt = readRecovery(f.p, f.root).attempts[0];
  assert.deepEqual([attempt.id, attempt.container, attempt.record], [IDS[0], containerFor(IDS[0]), f.record(0)]);
  const ar = f.readRecord(0);
  assert.deepEqual([ar.phase, ar.seq, ar.iid, ar.branch, ar.base, ar.startSha, ar.worktree, ar.container],
    ['claimed', 1, '7', '7-fix-login', 'main', tip, f.worktree, containerFor(IDS[0])]);
  assert.equal(ar.evidence, join(f.evidence, 'recovery', IDS[0]));
  assert.ok(!ar.gitDir.startsWith(ar.evidence) && !f.record(0).startsWith(f.root), 'record and private Git are outside the writable evidence');
  // The claim now belongs to the repair process, so it outlives the launcher.
  const rec = f.run();
  assert.equal(rec.pid, l.child.pid);
  assert.deepEqual(rec.recovery && [rec.recovery.attempt, rec.recovery.id], [1, IDS[0]]);
  assert.equal(rec.branch, '7-fix-login');
  assert.match(readFileSync(join(f.root, '.sandcastle/logs/recover-7.log'), 'utf8'), /recovery attempt 1 on #7 \(7-fix-login\)/);

  assert.equal(settleRecovery(f.p, { ...f.common, at: at(11) }).state, 'running');
  assert.match((launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11) }) as { reason: string }).reason, /attempt 1 on #7 is still running/);
  assert.equal(f.launched.length, 1);

  // main.mts (runRecoveryAttempt) delivered the repaired branch, recorded it and exited.
  mkdirSync(ar.evidence, { recursive: true });
  writeFileSync(join(ar.evidence, 'recovery-report.md'), 'cause: stale fixture\n');
  f.advance(0, { phase: 'finished', outcome: 'delivered', reason: 'verified and delivered: https://example.test/pr/9' });
  const file = join(f.dir, 'proj--7.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), stage: 'done', verdict: 'PASS', mr: 'https://example.test/pr/9' }));
  await f.kill(l.child);
  const s = settleRecovery(f.p, { ...f.common, at: at(30) });
  assert.equal(s.state, 'settled');
  const a = (s as { attempt: { result: string; report?: string; reason?: string; finishedAt?: string } }).attempt;
  assert.equal(a.result, 'delivered');
  assert.equal(a.report, join(ar.evidence, 'recovery-report.md'));
  assert.equal(a.finishedAt, at(30));
  assert.equal(f.run().stage, 'done');
  assert.deepEqual(f.removed, [containerFor(IDS[0])].slice(0, f.removed.length), 'only its own container was ever named');
  assert.equal(settleRecovery(f.p, { ...f.common }).state, 'none');
});

test('a crashed attempt waits for its exact container to be confirmed gone, keeps the work, and the ticket stops after two attempts', async t => {
  const f = fixture(t);
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  // The repair process dies right after creating its container, before recording anything more; other containers,
  // including a Sandcastle container mounting the same worktree, are not this attempt's.
  const mine = containerFor(IDS[0]);
  f.containers.add(mine);
  f.containers.add('sandcastle-same-worktree');
  f.containers.add(containerFor(IDS[2]));
  f.stuck.add(mine);
  f.advance(0, { phase: 'setup' });
  await f.kill(f.launched[0].child);

  const held = settleRecovery(f.p, { ...f.common, at: at(12) });
  assert.equal(held.state, 'unconfirmed');
  assert.match((held as { reason: string }).reason, /still present after docker rm -f/);
  assert.equal(readRecovery(f.p, f.root).attempts[0].result, 'running', 'unconfirmed: the attempt stays running');
  assert.equal(readAdmission(f.dir).claims['proj--7']?.attempt, IDS[0], 'and its claim still holds after the worker died');
  assert.match((launchRecovery(f.p, { ...f.common, ticket: 7, at: at(12) }) as { reason: string }).reason, /not confirmed gone/);
  assert.equal(f.launched.length, 1, 'no new attempt over an unconfirmed container');

  f.stuck.clear();
  const s = settleRecovery(f.p, { ...f.common, at: at(13) });
  assert.equal(s.state, 'settled');
  const a = (s as { attempt: { result: string; reason?: string } }).attempt;
  assert.equal(a.result, 'interrupted');
  assert.match(a.reason!, /exited during setup.*work preserved on 7-fix-login/);
  assert.deepEqual([...new Set(f.removed)], [mine], 'no other container is ever removed');
  assert.ok(f.containers.has('sandcastle-same-worktree') && f.containers.has(containerFor(IDS[2])));
  assert.equal(f.readRecord(0).outcome, 'interrupted');
  assert.equal(f.run().stage, 'stopped');
  assert.match(f.run().note!, /recovery attempt 1 interrupted/);
  // Commits, dirty work and earlier evidence are untouched.
  assert.equal(f.git(f.root, 'rev-parse', '7-fix-login'), tip);
  assert.equal(readFileSync(join(f.worktree, 'wip.txt'), 'utf8'), 'uncommitted\n');
  assert.ok(existsSync(join(f.evidence, 'before-1.png')));

  // The second attempt timed out but could not confirm its cleanup; once its container is gone it settles as timed-out.
  const second = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(14) });
  assert.equal(second.ok, true, (second as { reason?: string }).reason);
  assert.equal((second as { attempt: { seq: number } }).attempt.seq, 2);
  f.advance(1, { phase: 'cleanup-pending', intended: 'timed-out', reason: 'repair agent stopped after 15 minutes; container not confirmed gone' });
  await f.kill(f.launched[1].child);
  // The recovery claim outlives the worker in the admission record until settled: ticket, slot and project stay held.
  assert.equal(f.run().stage, 'stopped');
  assert.equal(readAdmission(f.dir).claims['proj--7']?.attempt, IDS[1], 'held while unsettled');
  assert.equal(claimRun({ dir: f.dir, project: 'other', iid: '1', pid: process.pid, cap: 1 }).ok, false, 'its capacity slot');
  assert.match((claimRun({ dir: f.dir, project: 'proj', iid: '9', pid: process.pid, cap: 9 }) as { reason: string }).reason, /held by recovery on #7/);
  const third = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(40) });
  assert.equal(third.ok, false);
  assert.match((third as { reason: string }).reason, /used its 2 recovery attempts/);
  assert.deepEqual(readRecovery(f.p, f.root).attempts.map(x => x.result), ['interrupted', 'timed-out']);
  assert.equal(f.launched.length, 2);
  assert.equal(readAdmission(f.dir).claims['proj--7'], undefined, 'settling after the container is confirmed gone releases the claim');
});

test('a death during delivery is settled without replaying it; an attempt without a container identity is never guessed at', async t => {
  const f = fixture(t);
  launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  f.advance(0, { phase: 'delivering', tip: 'b'.repeat(40) });
  await f.kill(f.launched[0].child);
  const s = settleRecovery(f.p, { ...f.common, at: at(11) });
  assert.equal((s as { attempt: { result: string } }).attempt.result, 'interrupted');
  assert.match((s as { attempt: { reason: string } }).attempt.reason, /delivery outcome is unknown and is not replayed/);

  // A pre-#74 attempt (no recorded container) stays running rather than removing anything.
  const g = fixture(t);
  beginAttempt(g.p, g.root, { ticket: 7, at: at(20), branch: '7-fix-login' });
  g.containers.add('sandcastle-legacy');
  const held = settleRecovery(g.p, { ...g.common, at: at(21) });
  assert.equal(held.state, 'unconfirmed');
  assert.match((held as { reason: string }).reason, /no recorded container identity/);
  assert.deepEqual(g.removed, []);
});

test('a missing Factory worktree for the recorded branch is added without any reset', t => {
  const f = fixture(t, { worktree: false });
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  const r = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  assert.equal(f.git(f.worktree, 'rev-parse', 'HEAD'), tip);
  assert.equal(f.git(f.root, 'rev-parse', 'main') !== tip, true, 'main untouched');
  assert.equal(f.readRecord(0).worktree, f.worktree);
});

const receiptOf = (f: { dir: string; root: string }) =>
  readReceipt(receiptFile(f.dir, projectId(f.root, { kind: 'github', host: 'github.com', project: 'proj' }), '7'));

test('a pre-upgrade run is adopted into an ownership receipt, and a missing worktree is recorded before it is added', t => {
  const f = fixture(t, { worktree: false });
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  assert.equal(receiptOf(f), null, 'no receipt before the upgrade');
  // A worktree outside the canonical path is refused for a pre-upgrade run, touching nothing.
  const odd = join(f.root, '.sandcastle/worktrees/elsewhere');
  f.git(f.root, 'worktree', 'add', '-q', odd, '7-fix-login');
  assert.match((launchRecovery(f.p, { ...f.common, ticket: 7, at: at(9) }) as { reason: string }).reason, /not its canonical Factory worktree/);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0);
  f.git(f.root, 'worktree', 'remove', odd);

  const r = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  const rc = receiptOf(f)!;
  assert.deepEqual([rc.ticket, rc.branch, rc.base, rc.branchSha, rc.runId, rc.projectRoot, rc.worktreePath, rc.creationIntent.branch, rc.creationIntent.worktree, !!rc.worktreeAt],
    ['7', '7-fix-login', 'main', tip, IDS[1], f.root, f.worktree, false, true, true]);
  assert.equal(rc.gitCommonDir, realpathSync(join(f.root, '.git')));
  assert.equal(statSync(receiptFile(f.dir, rc.projectId, '7')).mode & 0o777, 0o600);
});

test('a remote-only recorded branch is fetched exactly and created without force; ambiguous or mismatched refs are refused', t => {
  const f = fixture(t, { worktree: false });
  const origin = join(f.home, 'origin.git');
  f.git(f.home, 'init', '-q', '--bare', '-b', 'main', origin);
  f.git(f.root, 'remote', 'add', 'origin', origin);
  f.git(f.root, 'push', '-q', 'origin', 'main', '7-fix-login');
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  f.git(f.root, 'branch', '-D', '7-fix-login');
  // Ambiguous: origin advertises another ref ending in the same name.
  f.git(f.root, 'push', '-q', 'origin', `${tip}:refs/heads/x/refs/heads/7-fix-login`);
  const amb = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.match((amb as { reason: string }).reason, /several matching refs/);
  assert.equal(f.git(f.root, 'branch', '--list', '7-fix-login'), '', 'no local branch created');
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0, 'nothing claimed');
  f.git(f.root, 'push', '-q', 'origin', '--delete', 'x/refs/heads/7-fix-login');

  // Fetched and created at exactly origin's commit, under a receipt that said so first.
  const r = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  assert.equal(f.git(f.root, 'rev-parse', '7-fix-login'), tip);
  assert.equal(f.git(f.worktree, 'rev-parse', 'HEAD'), tip);
  assert.equal(receiptOf(f)!.branchSha, tip);
});

test('a remote-only branch that no longer contains the receipt\'s commit is refused', t => {
  const f = fixture(t, { worktree: false });
  const origin = join(f.home, 'origin.git');
  f.git(f.home, 'init', '-q', '--bare', '-b', 'main', origin);
  f.git(f.root, 'remote', 'add', 'origin', origin);
  const recorded = f.git(f.root, 'rev-parse', '7-fix-login');
  recordIntent(f.dir, { root: f.root, tracker: { kind: 'github', host: 'github.com', project: 'proj' }, ticket: '7', branch: '7-fix-login', base: 'main',
    runId: 'r', branchToCreate: true, worktreeToCreate: false, branchSha: recorded });
  // Someone replaced the branch on origin with unrelated history.
  f.git(f.root, 'checkout', '-q', '--orphan', 'other');
  f.git(f.root, 'commit', '-q', '--allow-empty', '-m', 'unrelated');
  f.git(f.root, 'push', '-q', 'origin', 'other:refs/heads/7-fix-login');
  f.git(f.root, 'checkout', '-q', 'main');
  f.git(f.root, 'branch', '-D', '7-fix-login');
  const r = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.match((r as { reason: string }).reason, /does not contain/);
  assert.equal(f.git(f.root, 'branch', '--list', '7-fix-login'), '');
  assert.equal(receiptOf(f)!.branchSha, recorded, 'the recorded commit survives the refusal');
  assert.match((launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11) }) as { reason: string }).reason, /does not contain/, 'and keeps refusing');
});
