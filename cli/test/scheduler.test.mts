// Scheduler slice (#33): `factory schedule on|off` with the fake service manager, the tick's project visits and
// lock, and the systemd unit directives that give the cadence. Disposable HOME and Git repos only; no host units.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { Fake } from '../src/platform/fake.mts';
import { schedulerUnits } from '../src/platform/systemd.mts';
import { install } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { schedule } from '../src/commands/schedule.mts';
import { readManifest } from '../src/manifest.mts';
import { addProject } from '../src/projects.mts';
import { readScheduler, setProjectSchedule, setScheduler } from '../src/schedule.mts';
import { tick } from '../src/tick.mts';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'ignore' });
function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-scheduler-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const p = paths(home);
  const repo = (name: string, current = true) => {
    const root = join(home, 'work', name);
    mkdirSync(join(root, '.sandcastle'), { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
    writeFileSync(join(root, '.sandcastle/dispatch.sh'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(root, '.sandcastle/dispatch.mts'), current ? 'reserveRun(iid, pid);\n' : 'spawn();\n');
    writeFileSync(join(root, '.sandcastle/board.mts'), current ? 'export function reserveRun() {}\n' : '');
    addProject(p, realpathSync(root));
    return realpathSync(root);
  };
  return { p, service: new Fake(p), repo };
}
const quiet = (t: TestContext) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };

test('schedule on installs and starts the tick timer, off pauses it, uninstall removes it', async t => {
  quiet(t);
  const { p, service } = fixture(t);
  await assert.rejects(schedule(p, service, 'on', undefined), /factory install first/);
  assert.equal(readScheduler(p).enabled, false);
  await install(p, service);
  await schedule(p, service, 'on', undefined);
  await schedule(p, service, 'on', undefined);
  assert.equal(readScheduler(p).enabled, true);
  assert.equal(service.timer, 'active');
  const units = readManifest(p)!.entries.filter(e => e.unit?.startsWith('factory-tick')).map(e => e.unit);
  assert.deepEqual(units, ['factory-tick.service', 'factory-tick.timer'], 'each unit recorded once, the service before its timer');
  await schedule(p, service, 'off', undefined);
  assert.equal(readScheduler(p).enabled, false);
  assert.equal(service.timer, 'inactive');
  await uninstall(p, service);
  for (const path of [p.tickService, p.tickTimer, p.manifest]) assert.equal(existsSync(path), false, path);
});

test('schedule on refuses unit files Factory does not own', async t => {
  quiet(t);
  const { p, service } = fixture(t);
  await install(p, service);
  writeFileSync(p.tickTimer, 'not ours');
  await assert.rejects(schedule(p, service, 'on', undefined), /unowned/);
  assert.equal(readScheduler(p).enabled, false);
});

test('project opt-in refuses a dispatcher copy without launch reservations', async t => {
  quiet(t);
  const { p, service, repo } = fixture(t);
  repo('old', false);
  await assert.rejects(schedule(p, service, 'on', 'old'), /predates launch reservations/);
  const root = repo('new');
  await schedule(p, service, 'on', root);
  await schedule(p, service, 'off', 'new');
  await schedule(p, service, 'on', 'new');
});

test('a tick visits ready projects in turn, logs why others are skipped, and honours a pause mid-tick', async t => {
  const { p, repo } = fixture(t);
  const [a, b, c] = ['a', 'b', 'c', 'd'].map(n => repo(n));
  const lines: string[] = [];
  const pass = async () => 0;
  assert.equal((await tick(p, { pass, log: l => lines.push(l) })).result, 'off');
  setScheduler(p, true);
  for (const root of [a, b, c]) setProjectSchedule(p, root, true);
  git(b, 'checkout', '-q', '-b', 'other');
  const visited: string[] = [];
  const r = await tick(p, { log: l => lines.push(l), pass: async project => {
    visited.push(project.name);
    if (project.name === 'a') setProjectSchedule(p, c, false);
    return 0;
  } });
  assert.deepEqual(visited, ['a']);
  assert.deepEqual(r.skipped, { b: 'checkout is on other, scheduled branch is main', c: 'project paused', d: 'project not opted in' });
  assert.equal(existsSync(p.tickLock), false, 'the lock is released');
  assert.ok(lines.includes('pass a: exit 0 after 0s'));
});

test('one tick per user: a live tick holds the lock; a dead holder is taken over', async t => {
  const { p, repo } = fixture(t);
  setScheduler(p, true);
  setProjectSchedule(p, repo('a'), true);
  mkdirSync(p.state, { recursive: true });
  writeFileSync(p.tickLock, String(process.pid));
  assert.equal((await tick(p, { pass: async () => 0, log: () => {} })).result, 'busy');
  assert.ok(existsSync(p.tickLock), 'the live holder keeps its lock');
  writeFileSync(p.tickLock, '999999999');
  assert.deepEqual((await tick(p, { pass: async () => 0, log: () => {} })).passes, ['a']);
});

test('an interrupted tick stops its pass and visits no more projects', async t => {
  const { p, repo } = fixture(t);
  setScheduler(p, true);
  for (const n of ['a', 'b']) setProjectSchedule(p, repo(n), true);
  const abort = new AbortController();
  const r = await tick(p, { signal: abort.signal, log: () => {}, pass: (_x, _s, signal) => new Promise(done => {
    signal.addEventListener('abort', () => done(143));
    abort.abort();
  }) });
  assert.equal(r.result, 'interrupted');
  assert.deepEqual(r.passes, ['a']);
});

test('systemd units: first tick after a minute, then 5 minutes after each finishes; no timeout; runs survive', () => {
  const u = schedulerUnits({ node: '/usr/bin/node', factory: '/h/.local/share/factory/app/cli/bin/factory.mts', path: '/usr/bin:/bin', home: '/h' });
  assert.match(u['factory-tick.timer'], /^OnActiveSec=1min$/m);
  assert.match(u['factory-tick.timer'], /^OnUnitInactiveSec=5min$/m);
  assert.match(u['factory-tick.service'], /^Type=oneshot$/m);
  assert.match(u['factory-tick.service'], /^TimeoutStartSec=infinity$/m);
  assert.match(u['factory-tick.service'], /^KillMode=process$/m);
  assert.match(u['factory-tick.service'], /^ExecStart="\/usr\/bin\/node" "\/h\/.local\/share\/factory\/app\/cli\/bin\/factory.mts" schedule tick$/m);
  assert.doesNotMatch(u['factory-tick.service'], /@[A-Z]+@/);
});
