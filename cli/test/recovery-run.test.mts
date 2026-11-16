// Local observations retain separate execution/attempt identities; recorder failures cannot refund charges or skip cleanup.
import { exportEvents } from '../../board/execution-events.mts';
// #154: only read-only refusals are ticket-local; explicit settlement, preparation faults and post-commit failures never grant a free attempt.
// #153: missing observer/checkpoint/dispatch dependencies refuse repair admission before any charge.
// #149: a copy missing dependency evaluation cannot claim recovery work.
// #150: incomplete proof/delivery workflow copies refuse recovery before claiming work.
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
import { factoryToml } from './config-fixture.mts';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyFor, readAdmission, withAdmission } from '../../board/admission.mts';
import { claimRun, readRuns } from '../../board/board.mts';
import { projectId, readReceipt, receiptFile, recordIntent } from '../../orchestrator/ownership.mts';
import { containerFor, readAttemptRecord, writeAttemptRecord } from '../../orchestrator/recovery.mts';
import type { AttemptRecord, Docker } from '../../orchestrator/recovery.mts';
import { paths } from '../src/paths.mts';
import { afterPass } from '../src/jam-detect.mts';
import { projectFixture, refreshManifest } from './workflow-fixture.mts';
import { recordReview, WORKFLOW } from '../src/recovery-review.mts';
import {preparedFixture, preparedContextSource} from './prepared-fixture.mts';
import { ContextReadError } from '../../orchestrator/ticket-context.mts';
import { readStoredReadiness } from '../../board/readiness.mts';
import { launchRecovery, ownedRecoveryTracker, settleRecovery } from '../src/recovery-run.mts';
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
  const worktree = join(root, '.factory/worktrees/7-fix-login');
  if (o.worktree === false) {
    git(root, 'commit', '-q', '--allow-empty', '-m', 'on main');
    mkdirSync(join(root, '.factory/worktrees'), { recursive: true });
  } else {
    git(root, 'worktree', 'add', '-q', worktree, '7-fix-login');
    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'half done');
    writeFileSync(join(worktree, 'wip.txt'), 'uncommitted\n');
  }
  const evidence = join(root, '.factory/evidence/7');
  mkdirSync(evidence, { recursive: true });
  // The tracker identity the project's ownership receipts are keyed by.
  writeFileSync(join(root, '.factory/factory.toml'), factoryToml('proj'));
  writeFileSync(join(evidence, 'before-1.png'), 'old evidence');
  if (o.copy !== false) {
    mkdirSync(join(root, '.factory-workflow'), { recursive: true });
    writeFileSync(join(root, '.factory-workflow/main.mts'), 'const CONFIG = { image: "fixture-image" }; parseArgs({ options: { recover: { type: "string" }, "attempt-record": { type: "string" } } });\n');
    // #137: runtime/parser workflow review includes nested assets.
    for (const f of WORKFLOW.filter(f => f !== 'main.mts' && !['package.json','package-lock.json'].includes(f))) { mkdirSync(join(root, '.factory-workflow', f, '..'), { recursive: true }); writeFileSync(join(root, '.factory-workflow', f), ''); }
  }
  const p = paths(home);
  if (o.copy !== false) { projectFixture(p, root); recordReview(p, root); }
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
  const preparation=preparedFixture({root,tracker:'proj',dir,ticket:7});
  const common = { root, tracker: 'proj', dir, contextSource: preparedContextSource('proj'), docker, spawn: spawner, npx: 'npx', uuid, preparation,
    capabilities: async () => ({ ok: true as const, imageId: `sha256:${'a'.repeat(64)}`, cached: false }) };
  const run = () => readRuns(dir).find(r => r.project === 'proj' && r.iid === '7')!;
  const kill = async (c: ChildProcess) => { c.kill('SIGKILL'); await once(c, 'exit'); };
  const record = (i: number) => join(p.recovery, 'attempts', `${IDS[i]}.json`);
  const readRecord = (i: number) => (readAttemptRecord(record(i)) as { record: AttemptRecord }).record;
  /** What main.mts writes as the attempt moves on. */
  const advance = (i: number, patch: Partial<AttemptRecord>) => writeAttemptRecord(record(i), { ...readRecord(i), ...patch });
  return { home, root, p, dir, git, worktree, evidence, launched, containers, stuck, removed, common, run, kill, record, readRecord, advance };
}

for (const change of ['failure', 'changed']) test(`recovery ${change} after image readiness publishes a ticket-only input hold before charge`, async t => {
  const f = fixture(t), source = f.common.contextSource;
  const held = await launchRecovery(f.p, { ...f.common, ticket: 7, capabilities: async () => {
    if (change === 'failure') source.notes = () => { throw new ContextReadError('read-failed'); };
    else { const original = source.ticket; source.ticket = (iid, budget) => { const read = original(iid, budget); return { ...read, value: { ...read.value, description: 'Changed after preparation' } }; }; }
    return { ok: true, imageId: `sha256:${'a'.repeat(64)}`, cached: false };
  } });
  assert.equal(held.ok, false); if (held.ok || held.kind !== 'project-stopped') throw Error(JSON.stringify(held));
  assert.equal(held.code, 'ticket-input'); assert.equal(held.scope, 'ticket');
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0); assert.equal(f.launched.length, 0);
  const saved = readStoredReadiness(f.dir, realpathSync(f.root)); assert.equal(saved.state, 'current'); assert.ok(saved.report);
  assert.ok(saved.report.checks.filter(c => c.scope === 'project').every(c => c.status === 'ready'));
  const check = saved.report.checks.find(c => c.scope === 'ticket-input'); assert.equal(check?.ticket, '7'); assert.equal(check?.status, 'blocked');
  assert.equal(check?.operation, change === 'failure' ? 'child notes' : 'compare-context-hash');
  assert.equal((await launchRecovery(f.p, { ...f.common, ticket: 7, contextSource: preparedContextSource('proj') })).ok, true);
});

test('host holds spend no recovery attempt, catch a late race and do not block exact-owned cleanup', async t => {
  const f = fixture(t), logs = join(f.root, '.factory/logs');
  symlinkSync(f.evidence, logs);
  const before = readRecovery(f.p, f.root); const admission = readAdmission(f.dir);
  const held = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(held.ok, false); if (!held.ok) assert.equal(held.code, 'host-readiness');
  assert.deepEqual(readRecovery(f.p, f.root), before); assert.deepEqual(readAdmission(f.dir), admission);
  assert.equal(f.launched.length, 0); rmSync(logs);
  const raced = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11), capabilities: async () => {
    rmSync(logs, { recursive: true }); symlinkSync(f.evidence, logs);
    return { ok: true, imageId: `sha256:${'a'.repeat(64)}`, cached: false };
  } });
  assert.equal(raced.ok, false); if (!raced.ok) assert.equal(raced.code, 'host-readiness');
  assert.deepEqual(readRecovery(f.p, f.root), before); assert.equal(f.launched.length, 0);
  rmSync(logs); assert.equal((await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(12) })).ok, true);
  const mine = readRecovery(f.p, f.root).attempts[0].container!; f.containers.add(mine);
  rmSync(logs, { recursive: true }); symlinkSync(f.evidence, logs);
  await f.kill(f.launched[0].child);
  assert.equal(settleRecovery(f.p, { ...f.common, at: at(13) }).state, 'settled');
  assert.deepEqual(f.removed, [mine]); assert.equal(readRecovery(f.p, f.root).budgets['7'].used, 1);
  assert.equal(readFileSync(join(f.worktree, 'wip.txt'), 'utf8'), 'uncommitted\n');
});

test('mixed layout holds new launches but retains exact saved-container settlement', async t => {
  const f = fixture(t);
  assert.equal((await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) })).ok, true);
  const attempt = readRecovery(f.p, f.root).attempts[0], mine = attempt.container!;
  f.containers.add(mine);
  mkdirSync(join(f.root, '.sandcastle'));
  writeFileSync(join(f.root, '.sandcastle/saved.txt'), 'historical work');
  const before = readFileSync(join(f.worktree, 'wip.txt'));
  assert.equal(ownedRecoveryTracker(f.p, f.root), f.common.tracker);
  const held = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11) });
  assert.equal(held.ok, false); if (!held.ok) assert.match(held.reason, /mixed-layout/);
  await f.kill(f.launched[0].child);
  assert.equal(settleRecovery(f.p, { ...f.common, at: at(12) }).state, 'settled');
  assert.deepEqual(f.removed, [mine]);
  assert.deepEqual(readFileSync(join(f.worktree, 'wip.txt')), before);
  assert.equal(readFileSync(join(f.root, '.sandcastle/saved.txt'), 'utf8'), 'historical work');
  assert.equal(readRecovery(f.p, f.root).budgets['7'].used, 1);
});

test('launcher admission, direct patches and settlement emit once with stable separate identities', async t => {
  const f = fixture(t);
  const executionId = f.run().executionId;
  const result = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) }); assert.equal(result.ok, true);
  f.advance(0, { phase: 'setup', updatedAt: at(11) });
  f.advance(0, { phase: 'setup', updatedAt: at(12) });
  await f.kill(f.launched[0].child);
  assert.equal(settleRecovery(f.p, { ...f.common, at: at(13) }).state, 'settled');
  assert.equal(settleRecovery(f.p, { ...f.common, at: at(14) }).state, 'none');
  const report = exportEvents(f.dir); assert.deepEqual(report.diagnostics, []);
  assert.equal(report.events.filter(e => e.eventKind === 'execution-admitted').length, 1);
  assert.equal(report.events.filter(e => e.eventKind === 'recovery-admitted').length, 1);
  assert.equal(report.events.filter(e => e.eventKind === 'recovery-settled').length, 1);
  assert.equal(report.events.filter(e => e.eventKind === 'recovery-phase-changed' && e.to === 'setup').length, 1);
  assert.ok(report.events.filter(e => e.recoveryAttemptId).every(e => e.recoveryAttemptId === IDS[0] && e.executionId === executionId));
});

test('recorder failure after charge and during settlement cannot renew budgets, release early or skip cleanup', async t => {
  const f = fixture(t);
  rmSync(join(f.dir, 'telemetry'), { recursive: true }); writeFileSync(join(f.dir, 'telemetry'), 'failure injection');
  t.mock.method(console, 'warn', () => {});
  assert.equal((await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) })).ok, true);
  assert.equal(readRecovery(f.p, f.root).budgets['7'].used, 1);
  const mine = containerFor(IDS[0]); f.containers.add(mine); f.stuck.add(mine);
  f.advance(0, { phase: 'cleanup-pending', intended: 'failed', updatedAt: at(11) });
  await f.kill(f.launched[0].child);
  assert.equal(settleRecovery(f.p, { ...f.common, at: at(12) }).state, 'unconfirmed');
  assert.equal(readAdmission(f.dir).claims['proj--7'].attempt, IDS[0]);
  f.stuck.clear(); assert.equal(settleRecovery(f.p, { ...f.common, at: at(13) }).state, 'settled');
  assert.equal(readAdmission(f.dir).claims['proj--7'], undefined);
  assert.equal(readRecovery(f.p, f.root).budgets['7'].used, 1);
  assert.ok(!f.containers.has(mine)); assert.equal(readFileSync(join(f.evidence, 'before-1.png'), 'utf8'), 'old evidence');
});

test('an attempt is refused without the recovery workflow copy, claiming nothing', async t => {
  const f = fixture(t, { copy: false });
  const r = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /runtime descriptor|runtime.json/);
  assert.equal(f.launched.length, 0);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0, 'no attempt recorded, no budget spent');
  assert.equal(f.run().stage, 'stopped');
});

test('a repair runs detached on the recorded branch with its identity fixed first, holds the ticket, and is recorded from its attempt record', async t => {
  const f = fixture(t);
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  const r = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  const [l] = f.launched;
  assert.deepEqual([l.cmd, ...l.args], [process.execPath, join(f.root, '.factory-workflow/node_modules/tsx/dist/cli.mjs'), join(f.root, '.factory-workflow/main.mts'), '--issue', '7', '--base', 'main', '--recover', '1', '--attempt-record', f.record(0)]);
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
  assert.match(readFileSync(join(f.root, '.factory/logs/recover-7.log'), 'utf8'), /recovery attempt 1 on #7 \(7-fix-login\)/);

  assert.equal(settleRecovery(f.p, { ...f.common, at: at(11) }).state, 'running');
  assert.match((await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11) }) as { reason: string }).reason, /attempt 1 on #7 is still running/);
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
  await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
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
  assert.match((await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(12) }) as { reason: string }).reason, /not confirmed gone/);
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
  const second = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(14) });
  assert.equal(second.ok, true, (second as { reason?: string }).reason);
  assert.equal((second as { attempt: { seq: number } }).attempt.seq, 2);
  f.advance(1, { phase: 'cleanup-pending', intended: 'timed-out', reason: 'repair agent stopped after 15 minutes; container not confirmed gone' });
  await f.kill(f.launched[1].child);
  // The recovery claim outlives the worker in the admission record until settled: ticket, slot and project stay held.
  assert.equal(f.run().stage, 'stopped');
  assert.equal(readAdmission(f.dir).claims['proj--7']?.attempt, IDS[1], 'held while unsettled');
  assert.equal(claimRun({ dir: f.dir, project: 'other', iid: '1', pid: process.pid, cap: 1 }).ok, false, 'its capacity slot');
  assert.match((claimRun({ dir: f.dir, project: 'proj', iid: '9', pid: process.pid, cap: 9 }) as { reason: string }).reason, /held by recovery on #7/);
  // Settlement is separate from the launcher's read-only validation boundary.
  assert.equal(settleRecovery(f.p, { ...f.common, at: at(39) }).state, 'settled');
  const third = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(40) });
  assert.equal(third.ok, false);
  assert.match((third as { reason: string }).reason, /used its 2 recovery attempts/);
  assert.deepEqual(readRecovery(f.p, f.root).attempts.map(x => x.result), ['interrupted', 'timed-out']);
  assert.equal(f.launched.length, 2);
  assert.equal(readAdmission(f.dir).claims['proj--7'], undefined, 'settling after the container is confirmed gone releases the claim');
});

test('a death during delivery is settled without replaying it; an attempt without a container identity is never guessed at', async t => {
  const f = fixture(t);
  await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
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

test('a missing Factory worktree for the recorded branch is added without any reset', async t => {
  const f = fixture(t, { worktree: false });
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  const r = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  assert.equal(f.git(f.worktree, 'rev-parse', 'HEAD'), tip);
  assert.equal(f.git(f.root, 'rev-parse', 'main') !== tip, true, 'main untouched');
  assert.equal(f.readRecord(0).worktree, f.worktree);
});

const receiptOf = (f: { dir: string; root: string }) =>
  readReceipt(receiptFile(f.dir, projectId(f.root, { kind: 'github', host: 'github.com', project: 'proj' }), '7'));

test('a pre-upgrade run is adopted into an ownership receipt, and a missing worktree is recorded before it is added', async t => {
  const f = fixture(t, { worktree: false });
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  assert.equal(receiptOf(f), null, 'no receipt before the upgrade');
  // A worktree outside the canonical path is refused for a pre-upgrade run, touching nothing.
  const odd = join(f.root, '.factory/worktrees/elsewhere');
  f.git(f.root, 'worktree', 'add', '-q', odd, '7-fix-login');
  assert.match((await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(9) }) as { reason: string }).reason, /not its canonical Factory worktree/);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0);
  f.git(f.root, 'worktree', 'remove', odd);

  const r = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  const rc = receiptOf(f)!;
  assert.deepEqual([rc.ticket, rc.branch, rc.base, rc.branchSha, rc.runId, rc.projectRoot, rc.worktreePath, rc.creationIntent.branch, rc.creationIntent.worktree, !!rc.worktreeAt],
    ['7', '7-fix-login', 'main', tip, IDS[1], f.root, f.worktree, false, true, true]);
  assert.equal(rc.gitCommonDir, realpathSync(join(f.root, '.git')));
  assert.equal(statSync(receiptFile(f.dir, rc.projectId, '7')).mode & 0o777, 0o600);
});

test('a remote-only recorded branch is fetched exactly and created without force; ambiguous or mismatched refs are refused', async t => {
  const f = fixture(t, { worktree: false });
  const origin = join(f.home, 'origin.git');
  f.git(f.home, 'init', '-q', '--bare', '-b', 'main', origin);
  f.git(f.root, 'remote', 'add', 'origin', origin);
  f.git(f.root, 'push', '-q', 'origin', 'main', '7-fix-login');
  const tip = f.git(f.root, 'rev-parse', '7-fix-login');
  f.git(f.root, 'branch', '-D', '7-fix-login');
  // Ambiguous: origin advertises another ref ending in the same name.
  f.git(f.root, 'push', '-q', 'origin', `${tip}:refs/heads/x/refs/heads/7-fix-login`);
  const amb = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.match((amb as { reason: string }).reason, /several matching refs/);
  assert.equal(f.git(f.root, 'branch', '--list', '7-fix-login'), '', 'no local branch created');
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0, 'nothing claimed');
  f.git(f.root, 'push', '-q', 'origin', '--delete', 'x/refs/heads/7-fix-login');

  // Fetched and created at exactly origin's commit, under a receipt that said so first.
  const r = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11) });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  assert.equal(f.git(f.root, 'rev-parse', '7-fix-login'), tip);
  assert.equal(f.git(f.worktree, 'rev-parse', 'HEAD'), tip);
  assert.equal(receiptOf(f)!.branchSha, tip);
});

test('a remote-only branch that no longer contains the receipt\'s commit is refused', async t => {
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
  const r = await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(10) });
  assert.match((r as { reason: string }).reason, /does not contain/);
  assert.equal(f.git(f.root, 'branch', '--list', '7-fix-login'), '');
  assert.equal(receiptOf(f)!.branchSha, recorded, 'the recorded commit survives the refusal');
  assert.match((await launchRecovery(f.p, { ...f.common, ticket: 7, at: at(11) }) as { reason: string }).reason, /does not contain/, 'and keeps refusing');
});

test('known-bad image is an environment hold with zero charges; a fixed image admits exactly one pinned attempt', async t => {
  const f = fixture(t); let probes = 0;
  const before = f.git(f.worktree, 'status', '--porcelain');
  const r = await launchRecovery(f.p, { ...f.common, ticket: 7, capabilities: async () => {
    probes++; return { ok: false, scope: 'environment', retryable: true, reason: 'Image readiness hold: Chromium missing' };
  } });
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.scope, 'environment');
  assert.equal(probes, 1); assert.equal(f.launched.length, 0);
  assert.equal(readRecovery(f.p, f.root).budgets[7], undefined);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0);
  assert.equal(f.git(f.worktree, 'status', '--porcelain'), before);
  const good = await launchRecovery(f.p, { ...f.common, ticket: 7 });
  assert.equal(good.ok, true);
  assert.equal(readRecovery(f.p, f.root).budgets[7].used, 1);
  assert.equal(f.launched[0].env.FACTORY_READY_IMAGE, `sha256:${'a'.repeat(64)}`);
});

test('paused/off/cancelled recovery probes nothing; a pause during readiness still charges nothing', async t => {
  const f = fixture(t); let probes = 0;
  const capabilities = async () => { probes++; return f.common.capabilities(); };
  assert.equal((await launchRecovery(f.p, { ...f.common, ticket: 7, capabilities, mayLaunch: async () => false })).ok, false);
  const cancel = new AbortController(); cancel.abort();
  assert.equal((await launchRecovery(f.p, { ...f.common, ticket: 7, capabilities, signal: cancel.signal })).ok, false);
  assert.equal(probes, 0);
  let enabled = true;
  assert.equal((await launchRecovery(f.p, { ...f.common, ticket: 7, mayLaunch: async () => enabled,
    capabilities: async () => { probes++; enabled = false; return f.common.capabilities(); } })).ok, false);
  assert.equal(probes, 1); assert.equal(f.launched.length, 0);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0);
});

test('missing TOML is held without executing legacy configuration or charging', async t => {
  const f = fixture(t); let probes = 0;
  rmSync(join(f.root, '.factory/factory.toml'));
  writeFileSync(join(f.root, '.factory-workflow/main.mts'), 'const CONFIG = { image: getSecretImage() }; parseArgs({ options: { recover: { type: "string" }, "attempt-record": { type: "string" } } });');
  refreshManifest(f.root);
  assert.throws(() => recordReview(f.p, f.root), /factory.toml/);
  const r = await launchRecovery(f.p, { ...f.common, ticket: 7, capabilities: async () => { probes++; return f.common.capabilities(); } });
  assert.equal(r.ok, false); if (!r.ok) { assert.equal(r.scope, 'project'); assert.match(r.reason, /factory.toml/); }
  assert.equal(probes, 0); assert.equal(readRecovery(f.p, f.root).attempts.length, 0);
});

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, f.name);
      if (f.isDirectory()) walk(path);
      else if (f.isFile()) out[path.slice(root.length)] = readFileSync(path).toString('base64');
    }
  };
  walk(root);
  return out;
}

for (const problem of ['branch-missing', 'branch-invalid', 'base-missing', 'base-invalid', 'branches-ambiguous', 'evidence-mismatch', 'worktree-not-owned'] as const) {
  test(`${problem} is a typed, byte-for-byte read-only refusal`, async t => {
    const f = fixture(t, { worktree: false });
    const file = join(f.dir, 'proj--7.json');
    const r = JSON.parse(readFileSync(file, 'utf8'));
    if (problem === 'branch-missing') f.git(f.root, 'branch', '-D', '7-fix-login');
    if (problem === 'branch-invalid') r.branch = 'foreign';
    if (problem === 'base-missing') delete r.base;
    if (problem === 'base-invalid') r.base = 'missing-base';
    if (problem === 'branches-ambiguous') f.git(f.root, 'branch', '7-another');
    if (problem === 'evidence-mismatch') r.evidenceDir = f.home;
    if (problem === 'worktree-not-owned') f.git(f.root, 'worktree', 'add', '-q', join(f.home, 'someone-elses'), '7-fix-login');
    writeFileSync(file, JSON.stringify(r));
    const before = snapshot(f.home);
    const result = await launchRecovery(f.p, { ...f.common, ticket: 7 });
    assert.equal(result.kind, 'ticket-refused');
    if (result.kind !== 'ticket-refused') assert.fail(JSON.stringify(result));
    assert.equal(result.admitted, false);
    assert.equal(result.code, problem);
    assert.deepEqual(snapshot(f.home), before, 'Git refs, receipts, evidence, run and recovery stores are unchanged');
    assert.equal(f.launched.length, 0);
  });
}

for (const problem of ['malformed-run', 'unreadable-run', 'malformed-receipt', 'identity', 'workflow', 'git-error', 'capacity'] as const) {
  test(`${problem} is a read-only project stop even when a ticket branch is missing`, async t => {
    const f = fixture(t, { worktree: false });
    f.git(f.root, 'branch', '-D', '7-fix-login');
    if (problem === 'malformed-run') writeFileSync(join(f.dir, 'broken.json'), '{');
    if (problem === 'unreadable-run') mkdirSync(join(f.dir, 'broken.json'));
    if (problem === 'malformed-receipt') {
      const path = receiptFile(f.dir, projectId(f.root, { kind: 'github', host: 'github.com', project: 'proj' }), '7');
      mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, '{');
    }
    if (problem === 'identity') writeFileSync(join(f.root, '.factory/factory.toml'), 'version = 2\n');
    if (problem === 'workflow') writeFileSync(join(f.root, '.factory-workflow/recovery.mts'), 'changed');
    if (problem === 'git-error') writeFileSync(join(f.root, '.git/config'), 'not a valid Git config\n');
    if (problem === 'capacity') claimRun({ dir: f.dir, project: 'elsewhere', iid: '8', pid: process.pid, cap: 99 });
    const before = snapshot(f.home);
    const r = await launchRecovery(f.p, { ...f.common, ticket: 7, cap: problem === 'capacity' ? 1 : 3 });
    assert.equal(r.kind, 'project-stopped', JSON.stringify(r));
    assert.equal(r.admitted, false);
    assert.deepEqual(snapshot(f.home), before);
    assert.equal(f.launched.length, 0);
  });
}

test('intent/adoption and fetch failures stop before charge, not as ticket refusals', async t => {
  const f = fixture(t, { worktree: false });
  // A file blocks receipt directory creation. Reading the absent receipt is harmless; writing intent fails.
  writeFileSync(join(f.dir, 'ownership'), 'not a directory');
  const before = snapshot(f.home);
  const r = await launchRecovery(f.p, { ...f.common, ticket: 7 });
  assert.equal(r.kind, 'project-stopped');
  assert.equal(r.admitted, false);
  assert.deepEqual(snapshot(f.home), before);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0);

  const g = fixture(t, { worktree: false });
  g.git(g.root, 'update-ref', 'refs/remotes/origin/7-fix-login', g.git(g.root, 'rev-parse', '7-fix-login'));
  g.git(g.root, 'branch', '-D', '7-fix-login');
  g.git(g.root, 'remote', 'add', 'origin', join(g.home, 'nonexistent-offline-origin'));
  const failedFetch = await launchRecovery(g.p, { ...g.common, ticket: 7 });
  assert.equal(failedFetch.kind, 'project-stopped');
  assert.equal(failedFetch.admitted, false);
  assert.ok(receiptOf(g), 'ownership intent survives failed preparation');
  assert.equal(readRecovery(g.p, g.root).attempts.length, 0);
  assert.equal(g.git(g.root, 'branch', '--list', '7-fix-login'), '');
});

for (const change of ['done', 'generation', 'review', 'capacity'] as const) {
  test(`admission rechecks ${change} changed after initial read-only checks`, async t => {
    const f = fixture(t);
    const r = await launchRecovery(f.p, { ...f.common, ticket: 7, cap: 1, uuid: () => {
      if (change === 'done') {
        const file = join(f.dir, 'proj--7.json');
        writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), stage: 'done' }));
      }
      if (change === 'generation') withAdmission(f.dir, tx => { tx.state.generations.proj++; tx.commit(); });
      if (change === 'review') writeFileSync(join(f.root, '.factory-workflow/recovery.mts'), 'changed after validation');
      if (change === 'capacity') claimRun({ dir: f.dir, project: 'elsewhere', iid: '8', pid: process.pid, cap: 99 });
      return IDS[0];
    } });
    assert.equal(r.kind, 'project-stopped', JSON.stringify(r));
    assert.equal(r.admitted, false);
    assert.equal(readRecovery(f.p, f.root).attempts.length, 0);
    assert.equal(f.launched.length, 0);
    assert.equal(readFileSync(join(f.worktree, 'wip.txt'), 'utf8'), 'uncommitted\n');
  });
}

for (const phase of ['spawn', 'record', 'after-commit'] as const) {
  test(`${phase} failure remains admitted-failed with the real attempt and exactly one charge`, async t => {
    const f = fixture(t);
    if (phase === 'record') { mkdirSync(join(f.p.recovery, 'attempts'), { recursive: true }); mkdirSync(f.record(0)); }
    const r = await launchRecovery(f.p, { ...f.common, ticket: 7,
      ...(phase === 'spawn' ? { spawn: () => { throw new Error('injected spawn failure'); } } : {}),
      ...(phase === 'after-commit' ? { afterCommit: () => { throw new Error('injected crash after commit'); } } : {}),
    });
    assert.equal(r.kind, 'admitted-failed', JSON.stringify(r));
    if (r.kind !== 'admitted-failed') assert.fail(JSON.stringify(r));
    assert.equal(r.admitted, true);
    assert.equal(r.attempt.id, IDS[0]);
    assert.equal(r.attempt.seq, 1);
    assert.equal(readRecovery(f.p, f.root).attempts.length, 1);
    assert.equal(readRecovery(f.p, f.root).budgets['7'].used, 1);
    assert.equal(readAdmission(f.dir).recovery.proj.admitted, 1);
    assert.equal(readAdmission(f.dir).recovery.proj.pending.length, 0);
    assert.equal(f.launched.length, 0);
    assert.equal(readFileSync(join(f.worktree, 'wip.txt'), 'utf8'), 'uncommitted\n');
    assert.equal(readFileSync(join(f.evidence, 'before-1.png'), 'utf8'), 'old evidence');
  });
}

test('real afterPass skips three missing branches, then admits one; subsequent passes cannot admit twice', async t => {
  const f = fixture(t);
  for (const ticket of [1, 2, 3]) writeFileSync(join(f.dir, `${keyFor(String(ticket), 'proj')}.json`),
    JSON.stringify({ ...f.run(), iid: String(ticket), branch: `${ticket}-missing`, evidenceDir: undefined }));
  const report = join(f.home, 'pass.json');
  const lines: string[] = [];
  const pass = async (id: string) => {
    writeFileSync(report, JSON.stringify({ version: 1, pass: id, project: 'proj', at: at(15), tickets: [7, 3, 2, 1], observed: [] }));
    await afterPass(f.p, { root: f.root, tracker: 'proj', name: 'site', pass: id, report, dir: f.dir,
      log: l => lines.push(l), mayLaunch: async () => true,
      prepare:async (_p,o)=>preparedFixture(o),
      settle: (p, o) => settleRecovery(p, { ...o, docker: f.common.docker }),
      launch: (p, o) => launchRecovery(p, { ...f.common, ...o, uuid: () => IDS[0] }),
    });
  };
  await pass('confirm-1');
  await pass('confirm-2');
  assert.equal(lines.filter(l => l.includes('ticket-refused branch-missing')).length, 3);
  assert.equal(f.launched.length, 1, lines.join('\n'));
  assert.deepEqual(readRecovery(f.p, f.root).attempts.map(a => a.ticket), [7]);
  await Promise.all([pass('concurrent-a'), pass('concurrent-b')]);
  assert.equal(f.launched.length, 1);
  assert.equal(readAdmission(f.dir).recovery.proj.admitted, 1);
});
