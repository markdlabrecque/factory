// `factory status` tests: board service state, only the chosen project's runs with their stage (a dead process
// reads as stopped), the --json shape, and a service manager that can't be reached. Scheduler health and timings (#37):
// the manager's answer, the project's switch and blocker, last pass and timing summaries from the history, problems for
// an unreadable manager, a malformed file and an overdue tick.
// Disposable HOME, Git repo and run-state folder; fake service and schedule backends (the CLI test puts the systemctl
// stub first on PATH), no tracker or Docker.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { Fake } from '../src/platform/fake.mts';
import { FakeSchedule } from '../src/platform/fake.mts';
import { status } from '../src/commands/status.mts';
import { setProjectSchedule, readScheduleConfig, writeScheduleConfig } from '../src/schedule.mts';
import { appendHistory, writeTickState } from '../src/schedule-state.mts';
import { summarize } from '../src/scheduler-health.mts';
import { home, repo, systemctlStub } from './schedule-helpers.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-status-')));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  delete process.env.SANDCASTLE_STATE_DIR;
  t.after(() => { rmSync(home, { recursive: true, force: true }); if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const p = paths(home);
  const root = join(home, 'site');
  mkdirSync(join(root, '.sandcastle'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.sandcastle/config.mts'), 'export const TRACKER = {\n  project: "me/site",\n};\n');
  addProject(p, realpathSync(root));
  mkdirSync(p.state, { recursive: true });
  const record = (project: string, iid: number, stage: string, extra: object = {}) => {
    const at = new Date(Date.now() - iid * 60_000).toISOString();
    writeFileSync(join(p.state, `${project.replace('/', '_')}--${iid}.json`),
      JSON.stringify({ iid: String(iid), project, stage, stageSince: at, startedAt: at, updatedAt: at, pid: process.pid, ...extra }));
  };
  const lines: string[] = [];
  t.mock.method(console, 'log', (s: string) => lines.push(s));
  return { home, p, root, record, out: () => lines.join('\n') };
}

test('shows the board service and each of the project\'s runs with its stage', async t => {
  const { p, root, record, out } = fixture(t);
  record('me/site', 3, 'implementing', { title: 'Add search', branch: '3-add-search' });
  record('me/site', 4, 'verifying', { pid: 2 ** 22 + 12345 });
  record('me/site', 5, 'done', { verdict: 'PASS', mr: 'https://example.com/pr/5' });
  record('other/repo', 6, 'queued');
  const fake = new Fake(p);
  fake.state = 'active';
  await status(p, fake, { cwd: root });
  const text = out();
  assert.match(text, /^Board: active {2}http:\/\/127\.0\.0\.1:4444/);
  assert.match(text, /#3 +implementing +3m +Add search +\[3-add-search\]/);
  assert.match(text, /#4 +stopped .*exited without finishing \(last stage: verifying\)/);
  assert.match(text, /#5 +done .*verdict PASS +https:\/\/example\.com\/pr\/5/);
  assert.doesNotMatch(text, /#6/);
});

test('--json gives the project, board and runs; an unreachable service manager reads as unknown', async t => {
  const { p, root, record, out } = fixture(t);
  record('me/site', 2, 'queued', { note: 'waits for #1' });
  await status(p, { status: async () => { throw new Error('Failed to connect to bus'); } }, { cwd: root, json: true });
  const data = JSON.parse(out());
  assert.equal(data.version, 1);
  assert.deepEqual(data.project, { name: 'site', root: realpathSync(root), tracker: 'me/site' });
  assert.deepEqual(data.board, { service: 'unknown (Failed to connect to bus)', url: 'http://127.0.0.1:4444' });
  assert.deepEqual(data.runs.map((r: any) => [r.iid, r.stage, r.note, r.key]), [['2', 'queued', 'waits for #1', 'me_site--2']]);
});

test('the CLI takes --project and --json, and rejects a positional argument', t => {
  const { home, p } = fixture(t);
  const stub = systemctlStub(t, p);
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, '../bin/factory.mts'), 'status', ...args],
    { cwd: home, encoding: 'utf8', env: { ...process.env, ...stub.env, FACTORY_HOME: home } });
  assert.match(cli('7', '--project', 'site').stderr, /Unexpected arguments/);
  assert.match(cli().stderr, /is not a registered project/);
  const ok = cli('--project', 'site', '--json');
  assert.equal(ok.status, 0, ok.stderr);
  const data = JSON.parse(ok.stdout);
  assert.equal(data.project.name, 'site');
  if (process.platform === 'linux') {
    assert.equal(data.scheduler.state, 'off', 'the stub reports no timer, which is off');
    assert.deepEqual(data.schedule.blocker, 'scheduler is off (timer not installed)');
    assert.deepEqual(stub.rejected(), [], 'status sends only the read-only queries the stub accepts');
  }
});

function scheduled(t: TestContext) {
  const { p } = home(t, 'factory-status-sched-');
  const root = repo(p, 'site');
  setProjectSchedule(p, root, true);
  writeScheduleConfig(p, { path: '/usr/bin', node: process.execPath });
  const sched = new FakeSchedule(p);
  Object.assign(sched, { timer: 'active', enabled: true, tick: 'inactive' });
  const lines: string[] = [];
  t.mock.method(console, 'log', (s: string) => lines.push(s));
  const run = async (o: { json?: boolean; now?: number } = {}) => { lines.length = 0; await status(p, new Fake(p), { cwd: root, schedule: sched, ...o }); return lines.join('\n'); };
  return { p, root, sched, run };
}
const at = (min: number) => new Date(Date.UTC(2026, 10, 11, 12, min)).toISOString();
const NOW = Date.parse(at(60));

test('shows scheduler health, the project\'s switch, last pass and timings from the history', async t => {
  const { p, root, run } = scheduled(t);
  appendHistory(p, [
    { kind: 'pass', tick: at(0), root, name: 'site', startedAt: at(0), finishedAt: at(2), durationMs: 120_000, result: 'ok', exitCode: 0 },
    { kind: 'pass', tick: at(10), root: '/other', startedAt: at(10), finishedAt: at(40), durationMs: 1_800_000, result: 'ok', exitCode: 0 },
    { kind: 'pass', tick: at(20), root, startedAt: at(20), result: 'interrupted', reason: 'scheduler turned off' },
    { kind: 'pass', tick: at(30), root, startedAt: at(30), finishedAt: at(36), durationMs: 360_000, result: 'error', exitCode: 2 },
    { kind: 'pass', tick: at(50), root, startedAt: at(50), finishedAt: at(54), durationMs: 240_000, result: 'ok', exitCode: 0 },
    { kind: 'tick', startedAt: at(50), finishedAt: at(55), durationMs: 300_000, result: 'done' },
  ]);
  writeTickState(p, { version: 1, startedAt: at(50), finishedAt: at(55), durationMs: 300_000,
    projects: { [root]: { attemptedAt: at(50), finishedAt: at(54), durationMs: 240_000, result: 'ok', exitCode: 0 } } });
  const text = await run({ now: NOW });
  assert.match(text, /^Scheduler: on, waiting for the next tick$/m);
  assert.match(text, /Last tick: done 5m ago, took 5m00s/);
  assert.match(text, /^Schedule: on \(main\), ready$/m);
  assert.match(text, /Last pass: ok \(exit 0\) 6m ago, took 4m00s/);
  assert.match(text, /Pass timings: 4 passes, 3 timed: last 4m00s, median 4m00s, p90 6m00s, max 6m00s; 2 ok, 1 interrupted, 1 error/);
  assert.doesNotMatch(text, /30m00s/, 'another project\'s passes are not counted');
  assert.ok(text.indexOf(at(50)) < text.indexOf(at(30)), 'recent passes newest first');
  assert.doesNotMatch(text, /Problem:/);
  const data = JSON.parse(await run({ json: true, now: NOW }));
  assert.deepEqual([data.scheduler.state, data.scheduler.phase, data.scheduler.enabled, data.scheduler.timer, data.scheduler.tick], ['on', 'waiting', true, 'active', 'inactive']);
  assert.equal(data.scheduler.lastTick.result, 'done');
  assert.deepEqual(data.schedule.timings, { count: 4, timed: 3, lastMs: 240_000, medianMs: 240_000, p90Ms: 360_000, maxMs: 360_000, results: { ok: 2, interrupted: 1, error: 1 } });
  assert.deepEqual([data.schedule.switch, data.schedule.branch, data.schedule.blocker, data.schedule.last.result], ['on', 'main', null, 'ok']);
  assert.equal(data.schedule.recent.length, 4);
});

test('an unreadable manager is unknown and blocks work; malformed files and an overdue tick are problems, not errors', async t => {
  const { p, sched, run } = scheduled(t);
  writeTickState(p, { version: 1, startedAt: at(0), finishedAt: at(5), projects: {} });
  let text = await run({ now: NOW });
  assert.match(text, /Problem: no tick has started or finished for 55m/);
  sched.tick = 'active';
  assert.doesNotMatch(await run({ now: NOW }), /no tick has started/, 'a long-running tick is not overdue');
  sched.enabled = false;
  text = await run({ now: NOW });
  assert.match(text, /^Scheduler: off \(timer is running but disabled\), a tick is running$/m);
  assert.match(text, /Problem: the timer is running but not enabled/);
  assert.match(text, /^Schedule: on \(main\), scheduler is off/m);
  sched.fail.add('status');
  writeFileSync(`${p.schedulerState}/history.json`, '{nope');
  const data = JSON.parse(await run({ json: true, now: NOW }));
  assert.equal(data.scheduler.state, 'unknown');
  assert.equal(data.scheduler.enabled, null);
  assert.match(data.schedule.blocker, /^scheduler state unknown/);
  assert.ok(data.scheduler.problems.some((x: string) => /can't be read .*Simulated status failure.*blocked/.test(x)));
  assert.ok(data.scheduler.problems.some((x: string) => /Scheduler history is not valid JSON/.test(x)));
  assert.equal(readScheduleConfig(p)!.path, '/usr/bin', 'status changes nothing');
});

test('timing summaries use nearest-rank percentiles and count untimed results', () => {
  const s = summarize([10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(durationMs => ({ durationMs, result: 'ok' })).concat([{ result: 'interrupted' } as any]));
  assert.deepEqual(s, { count: 11, timed: 10, lastMs: 100, medianMs: 50, p90Ms: 90, maxMs: 100, results: { ok: 10, interrupted: 1 } });
  assert.deepEqual(summarize([]), { count: 0, timed: 0, results: {} });
});
