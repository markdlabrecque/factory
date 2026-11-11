// Scheduler storage: project opt-in defaults off and saves the checked-out branch (which must be on origin), the blocker
// names why a project would not get a scheduled pass, and the launch configuration holds PATH and Node only, never a
// global on/off flag (the service manager owns that). Disposable HOME and Git repos only.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject, readRegistry, removeProject } from '../src/projects.mts';
import { copyProblem, optInProblem, readScheduleConfig, scheduleBlocker, setProjectSchedule, writeScheduleConfig } from '../src/schedule.mts';
import type { Scheduling } from '../src/schedule.mts';
import { chmodSync, existsSync, statSync } from 'node:fs';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'ignore' });
function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-sched-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'work/app');
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  const origin = join(home, 'origin.git');
  mkdirSync(origin);
  git(origin, 'init', '-q', '--bare');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  return { p: paths(home), root: realpathSync(root) };
}
const project = (p: ReturnType<typeof paths>, root: string) => readRegistry(p).projects.find(x => x.root === root)!;

const on: Scheduling = { state: 'on' };

test('launch configuration holds PATH and Node only, atomically with mode 0600; a malformed file is never replaced', t => {
  const { p } = fixture(t);
  assert.equal(readScheduleConfig(p), null, 'missing means nothing saved, not that the timer is off');
  const c = writeScheduleConfig(p, { path: '/usr/bin:/bin', node: process.execPath });
  assert.deepEqual(c, { version: 1, path: '/usr/bin:/bin', node: process.execPath });
  assert.deepEqual(JSON.parse(readFileSync(p.scheduleConfig, 'utf8')), c, 'no enabled or desiredEnabled member');
  assert.equal(statSync(p.scheduleConfig).mode & 0o777, 0o600);
  assert.throws(() => writeScheduleConfig(p, { path: '/usr/bin', node: 'node' }), /absolute/);
  assert.throws(() => writeScheduleConfig(p, { path: '', node: process.execPath }), /PATH is empty/);
  writeFileSync(p.scheduleConfig, '{"version":2}');
  assert.throws(() => readScheduleConfig(p), /Unsupported schedule configuration/);
  assert.throws(() => writeScheduleConfig(p, { path: '/usr/bin', node: process.execPath }), /Unsupported schedule configuration/);
  assert.equal(readFileSync(p.scheduleConfig, 'utf8'), '{"version":2}');
});

test('a leftover global switch from earlier builds is ignored in both directions', t => {
  const { p } = fixture(t);
  mkdirSync(p.config, { recursive: true });
  writeFileSync(`${p.config}/scheduler.json`, '{"version":1,"enabled":true,"since":null}');
  writeFileSync(p.scheduleConfig, JSON.stringify({ version: 1, enabled: false, desiredEnabled: true, path: '/usr/bin', node: process.execPath }));
  assert.deepEqual(readScheduleConfig(p), { version: 1, path: '/usr/bin', node: process.execPath }, 'switch members are dropped, not consulted');
  assert.equal(scheduleBlocker({ state: 'off', reason: 'timer disabled' }, { name: 'x', root: '/x', schedule: { enabled: true, branch: 'main', since: '' } }, true, 'main'), 'scheduler is off (timer disabled)');
});

test('new projects are off; opt-in saves the checked-out branch; pause keeps it; re-adding never revives it', t => {
  const { p, root } = fixture(t);
  addProject(p, root);
  assert.equal(scheduleBlocker(on, project(p, root), true, 'main'), 'project not opted in');
  assert.equal(setProjectSchedule(p, root, false), null, 'switching off a never-opted-in project stores nothing');
  assert.equal(project(p, root).schedule, undefined);

  assert.deepEqual({ ...setProjectSchedule(p, root, true), since: '' }, { enabled: true, branch: 'main', since: '' });
  assert.equal(scheduleBlocker(on, project(p, root), true, 'main'), null);
  git(root, 'checkout', '-q', '-b', 'feature');
  git(root, 'push', '-q', 'origin', 'feature');
  assert.equal(project(p, root).schedule!.branch, 'main', 'the saved branch does not follow the checkout');
  assert.equal(scheduleBlocker(on, project(p, root), true, 'feature'), 'checkout is on feature, scheduled branch is main');

  setProjectSchedule(p, root, false);
  assert.deepEqual([project(p, root).schedule!.enabled, project(p, root).schedule!.branch], [false, 'main']);
  assert.equal(scheduleBlocker(on, project(p, root), true, 'main'), 'project paused');
  setProjectSchedule(p, root, true);
  assert.equal(project(p, root).schedule!.branch, 'feature', 'opting in again saves the branch checked out now');

  assert.equal(scheduleBlocker({ state: 'off' }, project(p, root), true, 'feature'), 'scheduler is off', 'the service manager being off overrides the project');
  assert.equal(scheduleBlocker({ state: 'unknown', reason: 'no systemctl' }, project(p, root), true, 'feature'), 'scheduler state unknown (no systemctl)', 'a failed query blocks, never allows');

  removeProject(p, root); addProject(p, root);
  assert.equal(project(p, root).schedule, undefined, 'a re-added project starts off');
});

test('opt-in refuses unregistered projects and detached HEADs without writing', t => {
  const { p, root } = fixture(t);
  assert.throws(() => setProjectSchedule(p, root, true), /Not registered/);
  addProject(p, root);
  git(root, 'checkout', '-q', '--detach');
  const before = readFileSync(p.projects, 'utf8');
  assert.throws(() => setProjectSchedule(p, root, true), /detached HEAD/);
  assert.equal(readFileSync(p.projects, 'utf8'), before);
});

test('opt-in needs an origin that has the branch, an executable dispatch.sh and a current dispatcher copy', t => {
  const { p, root } = fixture(t);
  addProject(p, root);
  git(root, 'checkout', '-q', '-b', 'local-only');
  const before = readFileSync(p.projects, 'utf8');
  assert.throws(() => setProjectSchedule(p, root, true), /branch local-only is not on origin/);
  assert.equal(readFileSync(p.projects, 'utf8'), before, 'a refused opt-in writes nothing');
  git(root, 'push', '-q', 'origin', 'local-only');
  assert.equal(optInProblem(root, 'local-only'), null);
  git(root, 'remote', 'remove', 'origin');
  assert.match(optInProblem(root, 'main')!, /no `origin` remote/);

  mkdirSync(join(root, '.sandcastle'));
  writeFileSync(join(root, '.sandcastle/dispatch.sh'), '#!/bin/sh\n', { mode: 0o644 });
  writeFileSync(join(root, '.sandcastle/dispatch.mts'), 'reserveRun(a, b);');
  writeFileSync(join(root, '.sandcastle/board.mts'), 'export function reserveRun() {}');
  assert.match(copyProblem(root)!, /not executable/);
  chmodSync(join(root, '.sandcastle/dispatch.sh'), 0o755);
  assert.equal(copyProblem(root), null);
  writeFileSync(join(root, '.sandcastle/dispatch.mts'), 'spawn();');
  assert.match(copyProblem(root)!, /predates launch reservations/);
  rmSync(join(root, '.sandcastle/dispatch.sh'));
  assert.match(copyProblem(root)!, /no \.sandcastle\/dispatch\.sh/);
  assert.equal(existsSync(p.scheduleConfig), false);
});
