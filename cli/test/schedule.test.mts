// Scheduler switches: the global switch and project opt-in default off, opt-in saves the checked-out branch,
// and the blocker names why a project would not get a scheduled pass. Disposable HOME and Git repos only.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject, readRegistry, removeProject } from '../src/projects.mts';
import { readScheduler, scheduleBlocker, setProjectSchedule, setScheduler } from '../src/schedule.mts';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'ignore' });
function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-sched-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'work/app');
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  return { p: paths(home), root: realpathSync(root) };
}
const project = (p: ReturnType<typeof paths>, root: string) => readRegistry(p).projects.find(x => x.root === root)!;

test('global switch defaults off, persists, and an unsupported file is reported and never replaced', t => {
  const { p } = fixture(t);
  assert.equal(readScheduler(p).enabled, false);
  assert.equal(setScheduler(p, true), true);
  assert.equal(setScheduler(p, true), false, 'unchanged switch is not rewritten');
  assert.equal(readScheduler(p).enabled, true);
  setScheduler(p, false);
  assert.equal(readScheduler(p).enabled, false);
  writeFileSync(p.scheduler, '{"version":2}');
  assert.throws(() => setScheduler(p, true), /Unsupported scheduler switch/);
  assert.equal(readFileSync(p.scheduler, 'utf8'), '{"version":2}');
});

test('new projects are off; opt-in saves the checked-out branch; pause keeps it; re-adding never revives it', t => {
  const { p, root } = fixture(t);
  setScheduler(p, true);
  addProject(p, root);
  assert.equal(scheduleBlocker(readScheduler(p), project(p, root), true, 'main'), 'project not opted in');
  assert.equal(setProjectSchedule(p, root, false), null, 'switching off a never-opted-in project stores nothing');
  assert.equal(project(p, root).schedule, undefined);

  assert.deepEqual({ ...setProjectSchedule(p, root, true), since: '' }, { enabled: true, branch: 'main', since: '' });
  assert.equal(scheduleBlocker(readScheduler(p), project(p, root), true, 'main'), null);
  git(root, 'checkout', '-q', '-b', 'feature');
  assert.equal(project(p, root).schedule!.branch, 'main', 'the saved branch does not follow the checkout');
  assert.equal(scheduleBlocker(readScheduler(p), project(p, root), true, 'feature'), 'checkout is on feature, scheduled branch is main');

  setProjectSchedule(p, root, false);
  assert.deepEqual([project(p, root).schedule!.enabled, project(p, root).schedule!.branch], [false, 'main']);
  assert.equal(scheduleBlocker(readScheduler(p), project(p, root), true, 'main'), 'project paused');
  setProjectSchedule(p, root, true);
  assert.equal(project(p, root).schedule!.branch, 'feature', 'opting in again saves the branch checked out now');

  setScheduler(p, false);
  assert.equal(scheduleBlocker(readScheduler(p), project(p, root), true, 'feature'), 'scheduler is off', 'global switch overrides the project');

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
