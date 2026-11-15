// Disposable local Git and active private-file probes only. No tracker, Docker, credentials or agent calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { factoryToml } from '../cli/test/config-fixture.mts';
import { loadTomlConfig } from './project-config.mts';
import { projectLaunchReadiness, ticketWorkspaceProblem, ticketBranch, recordTicketLaunch, recordTicketInput } from './launch-readiness.mts';
import { readReadiness, beginReadiness } from '../board/readiness.mts';
import { structuredContextSource } from './ticket-context-source.mts';
import { freezeTicketInput, TicketInputHold } from './ticket-input.mts';
function fixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'host-readiness-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'project'), runtime = join(home, 'runtime'), state = join(home, 'state');
  mkdirSync(join(root, '.sandcastle'), { recursive: true }); mkdirSync(runtime); mkdirSync(state);
  writeFileSync(join(root, '.sandcastle/factory.toml'), factoryToml('owner/repo'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-b', 'main'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const input = () => ({ projectRoot: root, runtimeRoot: runtime, runtimeIdentity: 'fixture-runtime', runtimeDependencies: 'fixture-dependencies', config: loadTomlConfig(join(root, '.sandcastle')), stateRoot: state, base: 'main' });
  return { home, root, runtime, state, git, input };
}
test('fresh project observations permit dirty checkout and unrelated linked worktree; ticket conflicts stay local', async t => {
  const f = fixture(t); writeFileSync(join(f.root, 'dirty'), 'preserve');
  f.git('worktree', 'add', '-b', 'other', join(f.home, 'other'));
  const report = await projectLaunchReadiness(f.input()); assert.equal(report.status, 'ready');
  const branch = ticketBranch(7, 'Fix login'); assert.equal(ticketWorkspaceProblem(f.root, branch), undefined);
  f.git('branch', branch);
  const conflict = ticketWorkspaceProblem(f.root, branch); assert.match(conflict!, /Branch already exists/);
  assert.equal(ticketWorkspaceProblem(f.root, ticketBranch(8, 'Unrelated')), undefined);
  recordTicketLaunch(f.state, report, 7, conflict); recordTicketLaunch(f.state, report, 8);
  const saved = readReadiness(f.state, report.identity); assert.equal(saved.state, 'current');
  if ('report' in saved) assert.deepEqual(saved.report.checks.filter(c => c.id.startsWith('ticket:')).map(c => [c.id, c.ticket, c.status]), [['ticket:7', '7', 'blocked'], ['ticket:8', '8', 'ready']]);
  assert.equal(readFileSync(join(f.root, 'dirty'), 'utf8'), 'preserve');
});
test('late path replacement and branch creation are detected; next fresh pass recovers without repairing or deleting', async t => {
  const f = fixture(t); assert.equal((await projectLaunchReadiness(f.input())).status, 'ready');
  const worktrees = join(f.root, '.sandcastle/worktrees'); rmSync(worktrees, { recursive: true }); symlinkSync(f.runtime, worktrees);
  assert.match(ticketWorkspaceProblem(f.root, '7-fix')!, /Unsafe worktree parent/);
  assert.equal((await projectLaunchReadiness(f.input())).status, 'blocked');
  assert.deepEqual(readdirSync(f.runtime), []);
  rmSync(worktrees); assert.equal((await projectLaunchReadiness(f.input())).status, 'ready');
  assert.equal(ticketWorkspaceProblem(f.root, '7-fix'), undefined); f.git('branch', '7-fix');
  assert.match(ticketWorkspaceProblem(f.root, '7-fix')!, /Branch already exists/);
});
test('missing configured instruction and report publication failure hold directly; no saved success is reused', async t => {
  const f = fixture(t); const first = await projectLaunchReadiness(f.input()); assert.equal(first.status, 'ready');
  writeFileSync(join(f.root, '.sandcastle/factory.toml'), factoryToml('owner/repo') + '\n[instructions]\ncommon = ["missing.md"]\n');
  assert.equal((await projectLaunchReadiness(f.input())).status, 'blocked');
  writeFileSync(join(f.root, '.sandcastle/factory.toml'), factoryToml('owner/repo'));
  rmSync(join(f.state, 'readiness'), { recursive: true }); writeFileSync(join(f.state, 'readiness'), 'collision');
  assert.equal((await projectLaunchReadiness(f.input())).status, 'blocked');
  assert.equal(readFileSync(join(f.state, 'readiness'), 'utf8'), 'collision');
});
test('ticket source failures are freshly collected, attributed and do not replace a newer report generation', async t => {
  const f = fixture(t); const report = await projectLaunchReadiness(f.input()); let unavailable = false;
  const source = structuredContextSource({ kind: 'github', host: 'github.example', project: 'owner/repo' }, ({ args }) => {
    if (unavailable && args[1].includes('/comments?')) throw Error('fixture source unavailable');
    return JSON.stringify(args[1] === 'graphql' ? { data: { repository: { issue: { parent: null } } } } : args[1].includes('/comments?') ? [] : { number: 7, title: 'Fix', body: 'Complete specification' });
  });
  assert.ok(freezeTicketInput(source, 7).hash);
  unavailable = true;
  let problem: TicketInputHold | undefined;
  try { freezeTicketInput(source, 7); } catch (error) { assert.ok(error instanceof TicketInputHold); problem = error; }
  assert.ok(problem); assert.equal(problem.check.operation, 'child notes');
  recordTicketInput(f.state, report, problem);
  const next = await projectLaunchReadiness(f.input());
  assert.ok(next.checks.some(c => c.ticket === '7' && c.scope === 'ticket-input'));
  // A ticket failure is not a failed project filesystem gate.
  const { readinessReason } = await import('./launch-readiness.mts'); assert.equal(readinessReason(next), undefined);
  unavailable = false; assert.ok(freezeTicketInput(source, 7).hash);
  beginReadiness(f.state, report.identity, { invocationId: 'newer', ownerId: 'fixture' });
  assert.throws(() => recordTicketLaunch(f.state, report, 7), /superseded/);
  assert.equal(readReadiness(f.state, report.identity).state, 'pending');
});

test('stale missing worktree registration is not adopted or pruned', async t => {
  const f = fixture(t); await projectLaunchReadiness(f.input());
  const branch = '7-fix', path = join(f.root, '.sandcastle/worktrees', branch);
  f.git('worktree', 'add', '-b', branch, path); rmSync(path, { recursive: true });
  const before = f.git('worktree', 'list', '--porcelain');
  assert.match(ticketWorkspaceProblem(f.root, branch)!, /registration conflicts/);
  assert.equal(f.git('worktree', 'list', '--porcelain'), before);
});
