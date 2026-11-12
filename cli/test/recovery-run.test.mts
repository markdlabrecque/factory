// Recovery launcher tests (#60): an attempt resumes the recorded branch in a detached repair process that holds the
// claim; a finished attempt is recorded from its result file; a crashed one is settled as interrupted only after its own
// container is confirmed gone, with commits, dirty work and evidence untouched; a ticket stops after two attempts.
// Disposable Git repo, run-state folder and recovery record; a sleeping process stands in for the repair process and a
// fake docker for containers. No tracker, agent or real Docker.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimRun, readRuns } from '../../board/board.mts';
import { writeResult } from '../../orchestrator/recovery.mts';
import type { Docker } from '../../orchestrator/recovery.mts';
import { paths } from '../src/paths.mts';
import { launchRecovery, settleRecovery } from '../src/recovery-run.mts';
import type { Spawner } from '../src/recovery-run.mts';
import { observePass, readRecovery } from '../src/recovery-state.mts';

const at = (m: number) => new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString();

function fixture(t: TestContext, o: { copy?: boolean } = {}) {
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
  git(root, 'worktree', 'add', '-q', worktree, '7-fix-login');
  git(worktree, 'commit', '-q', '--allow-empty', '-m', 'half done');
  writeFileSync(join(worktree, 'wip.txt'), 'uncommitted\n');
  const evidence = join(root, '.sandcastle/evidence/7');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'before-1.png'), 'old evidence');
  if (o.copy !== false) {
    writeFileSync(join(root, '.sandcastle/main.mts'), 'parseArgs({ options: { recover: { type: "string" } } });\n');
    for (const f of ['recovery.mts', 'handoff.mts', 'prompt.recover.md']) writeFileSync(join(root, '.sandcastle', f), '');
  }
  const p = paths(home);
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
  // Containers by name with their mount sources; rm -f removes one unless it is stuck.
  const containers: Record<string, string[]> = {};
  const stuck = new Set<string>();
  const removed: string[] = [];
  const docker: Docker = args => {
    if (args[0] === 'ps') return { status: 0, stdout: Object.keys(containers).join('\n'), stderr: '' };
    if (args[0] === 'rm') { removed.push(args[2]); if (!stuck.has(args[2])) delete containers[args[2]]; return { status: 0, stdout: '', stderr: '' }; }
    const c = containers[args.at(-1)!];
    return c ? { status: 0, stdout: c.join('\n'), stderr: '' } : { status: 1, stdout: '', stderr: 'Error: No such container' };
  };
  const common = { root, tracker: 'proj', dir, docker, spawn: spawner, npx: 'npx' };
  const run = () => readRuns(dir).find(r => r.project === 'proj' && r.iid === '7')!;
  const kill = async (c: ChildProcess) => { c.kill('SIGKILL'); await once(c, 'exit'); };
  return { home, root, p, dir, git, worktree, evidence, launched, containers, stuck, removed, common, run, kill };
}

test('an attempt is refused without the recovery workflow copy, claiming nothing', t => {
  const f = fixture(t, { copy: false });
  const r = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /no recovery workflow \(missing main\.mts, recovery\.mts, handoff\.mts, prompt\.recover\.md\)/);
  assert.equal(f.launched.length, 0);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0, 'no attempt recorded, no budget spent');
  assert.equal(f.run().stage, 'stopped');
});

test('a repair runs detached on the recorded branch, holds the ticket while it lives, and is recorded from its result', async t => {
  const f = fixture(t);
  const r = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  const [l] = f.launched;
  assert.deepEqual([l.cmd, ...l.args], ['npx', 'tsx', '.sandcastle/main.mts', '--issue', '7', '--base', 'main', '--recover', '1']);
  assert.equal(l.cwd, f.root);
  assert.equal(l.env.SANDCASTLE_STATE_DIR, f.dir);
  // The claim now belongs to the repair process, so it outlives the launcher.
  const rec = f.run();
  assert.equal(rec.pid, l.child.pid);
  assert.equal(rec.recovery?.attempt, 1);
  assert.equal(rec.branch, '7-fix-login');
  assert.equal(rec.stage, 'setup');
  assert.match(readFileSync(join(f.root, '.sandcastle/logs/recover-7.log'), 'utf8'), /recovery attempt 1 on #7 \(7-fix-login\)/);

  assert.equal(settleRecovery(f.p, { ...f.common, at: at(11) }).state, 'running');
  assert.match((launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11) }) as { reason: string }).reason, /attempt 1 on #7 is still running/);
  assert.equal(f.launched.length, 1);

  // main.mts delivered the repaired branch and wrote its result, then exited.
  writeFileSync(join(f.evidence, 'recovery-report.md'), 'cause: stale fixture\n');
  writeResult(f.evidence, 1, 'repaired', 'verified and delivered: https://example.test/pr/9');
  const file = join(f.dir, 'proj--7.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), stage: 'done', verdict: 'PASS', mr: 'https://example.test/pr/9' }));
  await f.kill(l.child);
  const s = settleRecovery(f.p, { ...f.common, at: at(30) });
  assert.equal(s.state, 'settled');
  const a = (s as { attempt: { result: string; report?: string; reason?: string; finishedAt?: string } }).attempt;
  assert.equal(a.result, 'repaired');
  assert.equal(a.report, join(f.evidence, 'recovery-report.md'));
  assert.equal(a.finishedAt, at(30));
  assert.equal(f.run().stage, 'done');
  assert.equal(settleRecovery(f.p, { ...f.common }).state, 'none');
});

test('a crashed attempt waits for its container to be confirmed gone, keeps the work, and the ticket stops after two attempts', async t => {
  const f = fixture(t);
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  // The repair process dies outright, leaving its container (and an unrelated one) behind.
  f.containers['sandcastle-mine'] = [f.worktree, join(f.root, '.sandcastle/evidence')];
  f.containers['sandcastle-other'] = [join(f.root, '.sandcastle/worktrees/8-other')];
  f.stuck.add('sandcastle-mine');
  await f.kill(f.launched[0].child);

  const held = settleRecovery(f.p, { ...f.common, at: at(12) });
  assert.equal(held.state, 'unconfirmed');
  assert.match((held as { reason: string }).reason, /sandcastle-mine still present/);
  assert.equal(readRecovery(f.p, f.root).attempts[0].result, 'running', 'unconfirmed: the attempt stays running');
  assert.match((launchRecovery(f.p, { ...f.common, ticket: 7, at: at(12) }) as { reason: string }).reason, /not confirmed gone/);
  assert.equal(f.launched.length, 1, 'no new attempt over an unconfirmed container');

  f.stuck.clear();
  const s = settleRecovery(f.p, { ...f.common, at: at(13) });
  assert.equal(s.state, 'settled');
  const a = (s as { attempt: { result: string; reason?: string } }).attempt;
  assert.equal(a.result, 'interrupted');
  assert.match(a.reason!, /exited without finishing.*work preserved on 7-fix-login/);
  assert.ok(!f.removed.includes('sandcastle-other'), "another ticket's container is never removed");
  assert.ok('sandcastle-other' in f.containers);
  assert.equal(f.run().stage, 'stopped');
  assert.match(f.run().note!, /recovery attempt 1 interrupted/);
  // Commits, dirty work and earlier evidence are untouched.
  assert.equal(f.git(f.root, 'rev-parse', '7-fix-login'), tip);
  assert.equal(readFileSync(join(f.worktree, 'wip.txt'), 'utf8'), 'uncommitted\n');
  assert.ok(existsSync(join(f.evidence, 'before-1.png')));

  // The second attempt ends with a timeout; the budget is then spent until progress, a requirement change or a reset.
  const second = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(14) });
  assert.equal(second.ok, true, (second as { reason?: string }).reason);
  assert.equal((second as { attempt: { seq: number } }).attempt.seq, 2);
  writeResult(f.evidence, 2, 'timed-out', 'repair agent stopped after 15 minutes; work preserved on 7-fix-login');
  await f.kill(f.launched[1].child);
  const third = launchRecovery(f.p, { ...f.common, ticket: 7, at: at(40) });
  assert.equal(third.ok, false);
  assert.match((third as { reason: string }).reason, /used its 2 recovery attempts/);
  assert.deepEqual(readRecovery(f.p, f.root).attempts.map(x => x.result), ['interrupted', 'timed-out']);
  assert.equal(f.launched.length, 2);
});
