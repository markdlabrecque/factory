// Scheduled passes preserve the saved environment and pass no --max, leaving the cap to the project's dispatcher config (#117).
// Scheduler logic against the in-memory FakeSchedule (the production adapter is covered in schedule-linux.test.mts):
// `schedule on|off|status`, install/uninstall/reinstall ordering, the tick's gating on the service manager, its
// project visits and their rotation, the read-only refresh of projects not opted in (#94), `factory clean` after each completed pass (#97), state file, bounded timing history, exit codes and lock, and the unit directives. The service manager is the only global
// state: no test reads or writes a local on/off flag. Disposable HOME and Git repos only.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Fake, FakeSchedule } from '../src/platform/fake.mts';
import { schedulerUnits } from '../src/platform/scheduler-systemd.mts';
import { install } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { schedule } from '../src/commands/schedule.mts';
import { schedulingState, tick, tickExitCode } from '../src/commands/tick.mts';
import { readManifest } from '../src/manifest.mts';
import { readScheduleConfig, setProjectSchedule } from '../src/schedule.mts';
import { appendHistory, markInterrupted, readHistory, readTickState } from '../src/schedule-state.mts';
import { doctor } from '../src/commands/doctor.mts';
import { git, home, repo, systemctlStub } from './schedule-helpers.mts';
function fixture(t: TestContext) {
  const { p } = home(t, 'factory-scheduler-');
  return { p, service: new Fake(p), sched: new FakeSchedule(p), repo: (name: string, o = {}) => repo(p, name, o) };
}
const quiet = (t: TestContext) => { t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); };
const ticks = (m: ReturnType<typeof readManifest>) => m!.entries.filter(e => e.unit?.startsWith('factory-tick')).map(e => e.unit);

test('schedule on installs and enables the timer, off disables then stops, uninstall removes; no local switch exists', async t => {
  quiet(t);
  const { p, service, sched } = fixture(t);
  await assert.rejects(schedule(p, sched, 'on'), /factory install first/);
  assert.deepEqual(sched.calls, [], 'nothing reaches the service manager before install');
  await install(p, service);
  assert.deepEqual(sched.calls, [], 'a fresh install leaves the scheduler off and starts no tick unit');
  await schedule(p, sched, 'on');
  await schedule(p, sched, 'on');
  assert.equal(sched.enabled && sched.timer === 'active', true);
  assert.deepEqual(ticks(readManifest(p)), ['factory-tick.service', 'factory-tick.timer'], 'each unit recorded once, the service before its timer');
  assert.deepEqual(readScheduleConfig(p)!.node, process.execPath);
  for (const f of ['scheduler.json', 'schedule.json']) assert.equal(/enabled/i.test(existsSync(`${p.config}/${f}`) ? readFileSync(`${p.config}/${f}`, 'utf8') : ''), false, `${f} has no enabled flag`);
  sched.calls.length = 0;
  await schedule(p, sched, 'off');
  assert.deepEqual(sched.calls.filter(c => c !== 'status'), ['disable', 'stop'], 'the timer is disabled before the tick service is stopped');
  assert.equal(sched.enabled, false);
  assert.equal(sched.timer, 'inactive');
  await uninstall(p, service, { schedule: sched });
  for (const path of [p.tickService, p.tickTimer, p.manifest]) assert.equal(existsSync(path), false, path);
});

test('schedule on refuses unit files Factory does not own, and a failed enable keeps the ledger and reports the state', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (l: string) => logs.push(l));
  const { p, service, sched } = fixture(t);
  await install(p, service);
  writeFileSync(p.tickTimer, 'not ours');
  await assert.rejects(schedule(p, sched, 'on'), /unowned/);
  assert.deepEqual(sched.calls, []);
  assert.equal(readFileSync(p.tickTimer, 'utf8'), 'not ours');
  const { p: p2, service: s2, sched: sched2 } = fixture(t);
  await install(p2, s2);
  sched2.fail.add('enable');
  await assert.rejects(schedule(p2, sched2, 'on'), (e: Error) => /Simulated enable failure/.test(e.message) && /Scheduler state now: timer disabled\/inactive/.test(e.message) && /ledger is kept/.test(e.message));
  assert.deepEqual(ticks(readManifest(p2)), ['factory-tick.service', 'factory-tick.timer']);
  sched2.fail.clear();
  await schedule(p2, sched2, 'on');
  assert.equal(sched2.enabled, true, 'repeating on retries');
  assert.deepEqual(ticks(readManifest(p2)), ['factory-tick.service', 'factory-tick.timer'], 'retry adds no duplicates');
});

test('a unit file written but not enabled stays ledgered when the second artifact fails, and uninstall removes it', async t => {
  quiet(t);
  const { p, service, sched } = fixture(t);
  await install(p, service);
  sched.fail.add('install-timer');
  await assert.rejects(schedule(p, sched, 'on'), /install-timer/);
  assert.deepEqual(ticks(readManifest(p)), ['factory-tick.service']);
  assert.equal(existsSync(p.tickService), true);
  sched.fail.clear();
  await uninstall(p, service, { schedule: sched });
  assert.equal(existsSync(p.tickService), false);
});

test('project on/off use --project, never touch the timer, and a deleted checkout can be paused', async t => {
  quiet(t);
  const { p, sched, repo } = fixture(t);
  repo('old', { current: false });
  await assert.rejects(schedule(p, sched, 'on', { project: 'old' }), /predates launch reservations/);
  const root = repo('new');
  await schedule(p, sched, 'on', { project: 'new' });
  await schedule(p, sched, 'off', { project: root });
  await schedule(p, sched, 'on', { project: 'new' });
  assert.deepEqual(sched.calls.filter(c => c !== 'status'), [], 'project switches make no service-manager change');
  await assert.rejects(schedule(p, sched, 'on', { project: 'new', json: true }), /--json applies to schedule status/);
  await assert.rejects(schedule(p, sched, 'status', { project: 'nope' }), /No registered project nope/);
  git(root, 'checkout', '-q', '-b', 'other');
  await schedule(p, sched, 'off', { project: 'new' });
});

test('status reports timer enablement, timer activity and tick activity separately; a failed query is unknown', async t => {
  const lines: string[] = [];
  t.mock.method(console, 'log', (l: string) => lines.push(l));
  const { p, service, sched, repo } = fixture(t);
  await install(p, service);
  setProjectSchedule(p, repo('a'), true);
  await schedule(p, sched, 'on');
  const json = async (project?: string) => { lines.length = 0; await schedule(p, sched, 'status', { json: true, project }); return JSON.parse(lines.join('\n')); };
  let s = await json();
  assert.deepEqual([s.scheduler.serviceEnabled, s.scheduler.timerActive, s.scheduler.tickActive, s.scheduler.phase], [true, true, false, 'waiting']);
  assert.deepEqual([s.scheduler.lastTick, s.scheduler.problems, s.projects[0].timings], [null, [], { count: 0, timed: 0, results: {} }]);
  appendHistory(p, [{ kind: 'pass', root: s.projects[0].root, startedAt: new Date().toISOString(), durationMs: 5000, result: 'ok' },
    { kind: 'tick', startedAt: new Date().toISOString(), durationMs: 6000, result: 'done' }]);
  s = await json();
  assert.deepEqual([s.scheduler.lastTick.result, s.scheduler.ticks.maxMs, s.projects[0].timings.medianMs], ['done', 6000, 5000], 'timings come from the history');
  sched.tick = 'active';
  s = await json();
  assert.deepEqual([s.scheduler.timerActive, s.scheduler.tickActive, s.scheduler.phase], [true, true, 'running']);
  sched.tick = 'inactive'; sched.enabled = false;
  s = await json();
  assert.deepEqual([s.scheduler.serviceEnabled, s.scheduler.timerActive, s.scheduler.phase], [false, true, 'off'], 'disabled/active is its own observation, and is not on');
  sched.enabled = true; sched.timer = 'inactive';
  s = await json();
  assert.deepEqual([s.scheduler.serviceEnabled, s.scheduler.timerActive, s.scheduler.phase], [true, false, 'off'], 'enabled/inactive is not on either');
  sched.fail.add('status');
  s = await json();
  assert.equal(s.scheduler.service, 'unknown');
  assert.equal(s.scheduler.phase, 'unknown');
  assert.match(s.scheduler.reason, /Simulated status failure/);
  assert.match(s.projects[0].blocker, /scheduler state unknown/);
  s = await json('a');
  assert.equal(s.projects.length, 1);
});

test('schedulingState: on needs the timer enabled and active; off, unknown and missing never allow work', async t => {
  const { p, sched } = fixture(t);
  assert.deepEqual(await schedulingState(sched), { state: 'off', reason: 'timer not installed' });
  sched.timer = 'inactive';
  assert.equal((await schedulingState(sched)).reason, 'timer disabled');
  sched.timer = 'active';
  assert.equal((await schedulingState(sched)).reason, 'timer is running but disabled');
  sched.enabled = true; sched.timer = 'inactive';
  assert.equal((await schedulingState(sched)).reason, 'timer enabled but not running');
  sched.timer = 'active';
  assert.deepEqual(await schedulingState(sched), { state: 'on' });
  sched.fail.add('status');
  const s = await schedulingState(sched);
  assert.equal(s.state, 'unknown');
  assert.match(s.reason!, /service manager query failed: Simulated status failure/);
  void p;
});

async function armed(t: TestContext, names = ['a', 'b', 'c', 'd']) {
  const f = fixture(t);
  f.sched.timer = 'active'; f.sched.enabled = true;
  const roots = names.map(n => f.repo(n));
  const { writeScheduleConfig } = await import('../src/schedule.mts');
  writeScheduleConfig(f.p, { path: '/usr/bin:/bin', node: process.execPath });
  return { ...f, roots };
}

test('a tick visits ready projects in turn, logs why others are skipped, records each in state.json and honours a pause mid-tick', async t => {
  const { p, sched, roots: [a, b, c, d] } = await armed(t);
  const lines: string[] = [];
  const idle = new FakeSchedule(p);
  assert.equal((await tick(p, { backend: idle, pass: async () => 0, log: l => lines.push(l) })).result, 'off', 'no timer installed: nothing runs');
  for (const root of [a, b, c]) setProjectSchedule(p, root, true);
  git(b, 'checkout', '-q', '-b', 'other');
  const visited: string[] = [];
  const r = await tick(p, { backend: sched, log: l => lines.push(l), refresh: async () => 0, pass: async (ctx, args, o) => {
    visited.push(ctx.name);
    o.onSpawn(4242);
    assert.deepEqual(readTickState(p).projects[ctx.root].result, 'running', 'running is saved before the pass finishes');
    assert.equal(readTickState(p).projects[ctx.root].pid, 4242, 'the pid is saved at spawn');
    if (ctx.name === 'a') setProjectSchedule(p, c, false);
    return 0;
  } });
  assert.deepEqual(visited, ['a']);
  assert.deepEqual(r.skipped, { b: 'checkout is on other, scheduled branch is main', c: 'project paused' });
  assert.deepEqual(r.refreshed, { d: 'ok' }, 'the project never opted in is refreshed, the paused one is not');
  assert.equal(r.result, 'done');
  assert.equal(existsSync(p.tickLock), false, 'the lock is released');
  assert.ok(lines.some(l => /^pass a: exit 0 after \d+s$/.test(l)));
  const s = readTickState(p);
  assert.equal(s.projects[a].result, 'ok');
  assert.equal(s.projects[a].exitCode, 0);
  assert.ok(s.projects[a].durationMs! >= 0 && s.projects[a].finishedAt);
  assert.equal(s.projects[c].result, 'skipped');
  assert.equal(s.projects[d].reason, 'project not opted in; read-only refresh ok');
  assert.equal(s.currentRoot, undefined);
  assert.ok(s.startedAt && s.finishedAt && s.durationMs !== undefined && s.pid === undefined);
});

test('a project never opted in gets a read-only refresh each tick, never a pass; its failure does not fail the tick (#94)', async t => {
  const { p, sched, roots: [a, b, c, d] } = await armed(t);
  setProjectSchedule(p, a, true);
  setProjectSchedule(p, d, true); setProjectSchedule(p, d, false);
  git(c, 'checkout', '-q', '--detach');
  const calls: { name: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const passes: string[] = [];
  const lines: string[] = [];
  const r = await tick(p, { backend: sched, log: l => lines.push(l), pass: async ctx => { passes.push(ctx.name); return 0; },
    refresh: async (ctx, args, o) => { calls.push({ name: ctx.name, args, env: o.env }); o.onSpawn(4343); assert.equal(readTickState(p).projects[ctx.root].pid, 4343); return 2; } });
  assert.deepEqual(passes, ['a']);
  assert.deepEqual(calls.map(x => [x.name, x.args]), [['b', ['--refresh-only', '--base', 'main']]], 'c (detached HEAD) and d (paused) get no refresh');
  assert.equal(calls[0].env.SANDCASTLE_STATE_DIR, p.state);
  assert.equal(calls[0].env.PATH, '/usr/bin:/bin');
  assert.equal(calls[0].env.FACTORY_SCHEDULED, undefined, 'a refresh is not a scheduled pass');
  assert.deepEqual(r.refreshed, { b: 'exit 2' });
  assert.deepEqual(r.skipped, { c: 'project not opted in; no refresh: detached HEAD', d: 'project paused' });
  assert.equal(r.result, 'done', 'a failed refresh is reported, not a failed tick');
  assert.ok(lines.includes('refresh b (main): start'));
  const s = readTickState(p);
  assert.deepEqual([s.projects[b].result, s.projects[b].reason, s.projects[b].exitCode, s.projects[b].pid], ['skipped', 'project not opted in; read-only refresh failed: exit 2', 2, undefined]);
  assert.deepEqual(readHistory(p).filter(e => e.kind === 'pass').map(e => (e as any).name), ['a'], 'a refresh is not pass history');
  // Cancelling during a refresh interrupts the tick like a pass, and starts nothing after it.
  const abort = new AbortController();
  const after: string[] = [];
  setProjectSchedule(p, a, false);
  const x = await tick(p, { backend: sched, signal: abort.signal, log: () => {}, pass: async ctx => { after.push(ctx.name); return 0; },
    refresh: async ctx => { after.push(ctx.name); abort.abort(); return 143; } });
  assert.equal(x.result, 'interrupted');
  assert.deepEqual(after, ['b']);
});

test('a failing pass makes the tick fail, and the next project still runs; the timer is never touched', async t => {
  const { p, sched, roots: [a, b] } = await armed(t, ['a', 'b']);
  for (const root of [a, b]) setProjectSchedule(p, root, true);
  sched.calls.length = 0;
  const r = await tick(p, { backend: sched, log: () => {}, pass: async ctx => ctx.name === 'a' ? 3 : 0 });
  assert.equal(r.result, 'failed');
  assert.equal(tickExitCode(r), 1);
  assert.deepEqual(r.passes, ['a', 'b']);
  assert.deepEqual(r.errors, { a: 'exit 3' });
  const s = readTickState(p);
  assert.deepEqual([s.projects[a].result, s.projects[a].exitCode, s.projects[b].result], ['error', 3, 'ok']);
  assert.deepEqual(sched.calls.filter(c => c !== 'status'), [], 'a failed pass does not disable or stop the timer');
  const thrown = await tick(p, { backend: sched, log: () => {}, pass: async () => { throw new Error('spawn EACCES'); } });
  assert.equal(thrown.result, 'failed');
  assert.match(readTickState(p).projects[a].reason!, /spawn EACCES/);
});

test('the scheduled pass gets no --max, FACTORY_SCHEDULED=1, the saved PATH and Factory state, whatever the caller set', async t => {
  const { p, sched, roots: [a] } = await armed(t, ['a']);
  setProjectSchedule(p, a, true);
  const saved = process.env.SANDCASTLE_STATE_DIR;
  process.env.SANDCASTLE_STATE_DIR = '/somewhere/else';
  t.after(() => { if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  let seen: any;
  await tick(p, { backend: sched, log: () => {}, pass: async (ctx, args, o) => { seen = { cwd: ctx.root, args, env: o.env, group: o.group }; return 0; } });
  assert.deepEqual(seen.args, []);
  assert.equal(seen.cwd, a);
  assert.equal(seen.group, true, 'the pass leads its own process group');
  assert.deepEqual([seen.env.PATH, seen.env.SANDCASTLE_STATE_DIR, seen.env.FACTORY_SCHEDULED], ['/usr/bin:/bin', p.state, '1']);
});

test('the tick asks the service manager before the lock, after it and before every project; off or unknown stops further work', async t => {
  const { p, sched, roots: [a, b] } = await armed(t, ['a', 'b']);
  for (const root of [a, b]) setProjectSchedule(p, root, true);
  const lines: string[] = [];
  const visited: string[] = [];
  sched.calls.length = 0;
  const r = await tick(p, { backend: sched, log: l => lines.push(l), pass: async ctx => { visited.push(ctx.name); await sched.disable(); return 0; } });
  assert.deepEqual(visited, ['a'], 'timer disabled during the first pass: the second project never starts');
  assert.equal(r.result, 'off');
  assert.equal(tickExitCode(r), 0);
  assert.ok(lines.some(l => /no longer on|scheduler is off/.test(l)));
  assert.equal(sched.calls.filter(c => c === 'status').length >= 4, true);
  sched.timer = 'active'; sched.enabled = true;
  sched.fail.add('status');
  const u = await tick(p, { backend: sched, log: l => lines.push(l), pass: async () => { throw new Error('must not run'); } });
  assert.equal(u.result, 'unknown');
  assert.equal(tickExitCode(u), 1, 'unknown fails closed with a failure exit');
  assert.ok(lines.some(l => /scheduler state unknown \(service manager query failed/.test(l)));
  assert.equal(existsSync(p.tickLock), false, 'no lock taken when the manager cannot be read');
});

test('a missing or malformed launch configuration, registry or state fails the tick without a pass', async t => {
  const { p, sched, roots: [a] } = await armed(t, ['a']);
  setProjectSchedule(p, a, true);
  const never = async () => { throw new Error('must not run'); };
  writeFileSync(p.scheduleConfig, '{"version":9}');
  await assert.rejects(tick(p, { backend: sched, log: () => {}, pass: never }), /Unsupported schedule configuration/);
  assert.equal(existsSync(p.tickLock), false, 'the lock is released after a failure');
  const { rmSync } = await import('node:fs');
  rmSync(p.scheduleConfig);
  await assert.rejects(tick(p, { backend: sched, log: () => {}, pass: never }), /No launch configuration/);
  const { writeScheduleConfig } = await import('../src/schedule.mts');
  writeScheduleConfig(p, { path: '/usr/bin', node: process.execPath });
  mkdirSync(p.schedulerState, { recursive: true });
  writeFileSync(`${p.schedulerState}/state.json`, '{"version":1,"projects":{"/x":{"result":"bogus"}}}');
  await assert.rejects(tick(p, { backend: sched, log: () => {}, pass: never }), /Unsupported scheduler state/);
  assert.match(readFileSync(`${p.schedulerState}/state.json`, 'utf8'), /bogus/, 'the bad file is left alone');
});

test('one tick per user: a live tick holds the lock; a dead holder is taken over and its unfinished pass is marked interrupted', async t => {
  const { p, sched, roots: [a] } = await armed(t, ['a']);
  setProjectSchedule(p, a, true);
  mkdirSync(p.schedulerState, { recursive: true });
  const mine = { version: 1, token: 'other', tick: { pid: process.pid, startTicks: null } };
  writeFileSync(p.tickLock, JSON.stringify(mine));
  assert.equal((await tick(p, { backend: sched, pass: async () => 0, log: () => {} })).result, 'busy');
  assert.deepEqual(JSON.parse(readFileSync(p.tickLock, 'utf8')), mine, 'the live holder keeps its lock');
  writeFileSync(p.tickLock, JSON.stringify({ ...mine, tick: { pid: 999999999, startTicks: null } }));
  writeFileSync(`${p.schedulerState}/state.json`, JSON.stringify({ version: 1, startedAt: '2026-01-01T00:00:00.000Z', pid: 999999999, currentRoot: a,
    projects: { [a]: { attemptedAt: '2026-01-01T00:00:01.000Z', pid: 77, result: 'running' } } }));
  const lines: string[] = [];
  assert.deepEqual((await tick(p, { backend: sched, pass: async () => 0, log: l => lines.push(l) })).passes, ['a']);
  assert.ok(lines.includes('recovered state from an interrupted tick'));
  writeFileSync(p.tickLock, '');
  await assert.rejects(tick(p, { backend: sched, pass: async () => 0, log: () => {} }), /lock .* is unreadable/);
  assert.equal(readFileSync(p.tickLock, 'utf8'), '', 'an unreadable lock is not removed');
});

test('an interrupted state file keeps the finish time and duration unknown', async t => {
  const { p, sched, roots: [a] } = await armed(t, ['a']);
  setProjectSchedule(p, a, true);
  mkdirSync(p.schedulerState, { recursive: true });
  writeFileSync(p.tickLock, JSON.stringify({ version: 1, token: 'dead', tick: { pid: 999999999, startTicks: null } }));
  writeFileSync(`${p.schedulerState}/state.json`, JSON.stringify({ version: 1, startedAt: '2026-01-01T00:00:00.000Z', pid: 999999999, currentRoot: a,
    projects: { [a]: { attemptedAt: '2026-01-01T00:00:01.000Z', pid: 77, result: 'running' } } }));
  let during: any;
  await tick(p, { backend: sched, log: () => {}, pass: async ctx => { during = readTickState(p).projects[ctx.root]; return 0; } });
  assert.equal(during.result, 'running', 'the new pass replaces the old entry');
  const { markInterrupted } = await import('../src/schedule-state.mts');
  writeFileSync(`${p.schedulerState}/state.json`, JSON.stringify({ version: 1, startedAt: '2026-01-01T00:00:00.000Z', pid: 5, currentRoot: a,
    projects: { [a]: { attemptedAt: '2026-01-01T00:00:01.000Z', pid: 77, result: 'running' } } }));
  assert.equal(markInterrupted(p, 'boom'), true);
  const x = readTickState(p).projects[a];
  assert.deepEqual([x.result, x.reason, x.finishedAt, x.durationMs, x.exitCode], ['interrupted', 'boom', undefined, undefined, undefined]);
  assert.equal(readTickState(p).currentRoot, undefined);
  assert.equal(markInterrupted(p, 'again'), false);
});

test('an aborted tick cancels its pass, records it interrupted, starts no later project and exits 143', async t => {
  const { p, sched, roots: [a, b] } = await armed(t, ['a', 'b']);
  for (const root of [a, b]) setProjectSchedule(p, root, true);
  const abort = new AbortController();
  const visited: string[] = [];
  // The fake pass is a real short-lived process group so the tick's cancellation has something to signal.
  const { spawn } = await import('node:child_process');
  const r = await tick(p, { backend: sched, signal: abort.signal, log: () => {}, cancel: { graceMs: 2000, confirmMs: 2000 }, pass: (ctx, args, o) => {
    visited.push(ctx.name);
    const child = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    o.onSpawn(child.pid!);
    setTimeout(() => abort.abort(), 50);
    return new Promise(done => child.on('exit', (code, sig) => done(code ?? (sig ? 143 : 1))));
  } });
  assert.equal(r.result, 'interrupted');
  assert.equal(tickExitCode(r), 143);
  assert.deepEqual(visited, ['a']);
  const s = readTickState(p);
  assert.deepEqual([s.projects[a].result, s.projects[a].reason], ['interrupted', 'cancelled']);
  assert.equal(s.projects[b], undefined, 'the later project was never attempted');
  assert.equal(existsSync(p.tickLock), false);
  const h = readHistory(p);
  assert.deepEqual(h.map(x => [x.kind, x.result, x.reason]), [['pass', 'interrupted', 'cancelled'], ['tick', 'interrupted', 'cancelled']],
    'the cancelled pass and tick are flushed to the history; the later project has no entry');
  assert.ok(h.every(x => x.finishedAt && x.durationMs! >= 0), 'available timing is kept for a cancellation the tick saw through');
});

test('timing history: each pass and tick is recorded with start, end, monotonic duration and result', async t => {
  const { p, sched, roots: [a, b] } = await armed(t, ['a', 'b']);
  for (const root of [a, b]) setProjectSchedule(p, root, true);
  let clock = 1_000;
  const now = () => new Date(Date.UTC(2026, 0, 1) + clock);
  await tick(p, { backend: sched, log: () => {}, now, mono: () => clock, pass: async (ctx, args, o) => { o.onSpawn(4242); clock += ctx.name === 'a' ? 7_000 : 2_000; return ctx.name === 'a' ? 3 : 0; } });
  const [pa, pb, tk] = readHistory(p);
  assert.deepEqual(pa, { kind: 'pass', tick: '2026-01-01T00:00:01.000Z', root: a, name: 'a', startedAt: '2026-01-01T00:00:01.000Z', finishedAt: '2026-01-01T00:00:08.000Z',
    durationMs: 7000, pid: 4242, result: 'error', exitCode: 3, reason: 'exit 3' });
  assert.deepEqual([pb.result, pb.durationMs, pb.startedAt], ['ok', 2000, '2026-01-01T00:00:08.000Z']);
  assert.deepEqual(tk, { kind: 'tick', startedAt: '2026-01-01T00:00:01.000Z', finishedAt: '2026-01-01T00:00:10.000Z', durationMs: 9000, pid: process.pid, result: 'failed' });
  setProjectSchedule(p, a, false); setProjectSchedule(p, b, false);
  await tick(p, { backend: sched, log: () => {}, now, mono: () => clock, pass: async () => 0 });
  assert.deepEqual(readHistory(p).slice(3).map(x => [x.kind, x.result]), [['tick', 'done']], 'skipped projects are not history');
});

test('timing history is bounded, a malformed file is left alone without stopping the tick, and a dead tick is recorded interrupted', async t => {
  const { p, sched, roots: [a] } = await armed(t, ['a']);
  setProjectSchedule(p, a, true);
  const entry = (i: number) => ({ kind: 'tick' as const, startedAt: new Date(i * 1000).toISOString(), result: 'done' as const });
  appendHistory(p, [1, 2, 3, 4].map(entry), 3);
  appendHistory(p, [entry(5)], 3);
  assert.deepEqual(readHistory(p).map(x => x.startedAt), [2, 3, 4, 5].slice(1).map(i => new Date(i * 1000).toISOString()), 'the oldest entries are dropped');
  const file = `${p.schedulerState}/history.json`;
  writeFileSync(file, '{"version":1,"entries":[{"kind":"tick"}]}');
  const lines: string[] = [];
  const r = await tick(p, { backend: sched, log: l => lines.push(l), pass: async () => 0 });
  assert.equal(r.result, 'done', 'history is observation only and never blocks scheduled work');
  assert.ok(lines.some(l => /timing history not recorded: Unsupported scheduler history/.test(l)));
  assert.equal(readFileSync(file, 'utf8'), '{"version":1,"entries":[{"kind":"tick"}]}', 'the bad file is not overwritten');
  rmSync(file);
  writeFileSync(`${p.schedulerState}/state.json`, JSON.stringify({ version: 1, startedAt: '2026-01-01T00:00:00.000Z', pid: 5, currentRoot: a,
    projects: { [a]: { attemptedAt: '2026-01-01T00:00:01.000Z', pid: 77, result: 'running' } } }));
  markInterrupted(p, 'cancelled');
  assert.deepEqual(readHistory(p), [
    { kind: 'pass', tick: '2026-01-01T00:00:00.000Z', root: a, startedAt: '2026-01-01T00:00:01.000Z', pid: 77, result: 'interrupted', reason: 'cancelled' },
    { kind: 'tick', startedAt: '2026-01-01T00:00:00.000Z', pid: 5, result: 'interrupted', reason: 'cancelled' }], 'no finish or duration is invented');
  markInterrupted(p, 'again');
  assert.equal(readHistory(p).length, 2, 'recovery records a dead tick once');
});

test('systemd units: first tick after a minute, then 5 minutes after each finishes; no start timeout; KillMode=process; journal', () => {
  const u = schedulerUnits({ node: '/usr/bin/node', app: '/h/.local/share/factory/app', state: '/h/.local/state/factory', path: '/usr/bin:/bin' }, '/h');
  assert.match(u['factory-tick.timer'], /^OnActiveSec=1min$/m);
  assert.match(u['factory-tick.timer'], /^OnUnitInactiveSec=5min$/m);
  assert.match(u['factory-tick.timer'], /^Persistent=false$/m);
  assert.doesNotMatch(u['factory-tick.timer'], /OnBootSec|RandomizedDelay|OnCalendar/);
  assert.match(u['factory-tick.service'], /^Type=oneshot$/m);
  assert.match(u['factory-tick.service'], /^TimeoutStartSec=infinity$/m);
  assert.match(u['factory-tick.service'], /^TimeoutStopSec=2min$/m);
  assert.match(u['factory-tick.service'], /^KillMode=process$/m);
  assert.match(u['factory-tick.service'], /^StandardOutput=journal$/m);
  assert.match(u['factory-tick.service'], /^ExecStart="\/usr\/bin\/node" "\/h\/.local\/share\/factory\/app\/cli\/bin\/factory.mts" tick$/m);
  assert.match(u['factory-tick.service'], /^Environment="SANDCASTLE_STATE_DIR=\/h\/.local\/state\/factory"$/m);
  assert.doesNotMatch(u['factory-tick.service'], /@[A-Z]+@|EnvironmentFile|\/bin\/sh|bash -|--max|schedule tick/);
});

test('doctor reads the manager: on passes, enabled-but-stopped fails, running-but-disabled warns, unreadable fails, off and not installed are information', async t => {
  const out: string[] = [];
  t.mock.method(console, 'log', (l: string) => out.push(l));
  t.mock.method(console, 'warn', () => {});
  const { p, service, sched } = fixture(t);
  // Only the stub directory is on PATH, so no host service manager, loginctl or docker can be reached.
  const stub = systemctlStub(t, p);
  const check = async () => {
    out.length = 0;
    await stub.using(async () => { process.env.PATH = stub.bin; await doctor(p, sched); });
    return out.find(l => /Scheduler/.test(l)) ?? '';
  };
  const savedPath = process.env.PATH;
  t.after(() => { process.env.PATH = savedPath; });
  await install(p, service);
  assert.match(await check(), /INFO Scheduler not installed/);
  await schedule(p, sched, 'on');
  assert.equal(await check(), 'PASS Scheduler');
  sched.timer = 'inactive';
  assert.match(await check(), /FAIL Scheduler: the timer is enabled but inactive\. Run factory schedule on/);
  sched.timer = 'active'; sched.enabled = false;
  assert.match(await check(), /WARN Scheduler: the timer is running but not enabled/);
  sched.timer = 'inactive';
  assert.match(await check(), /INFO Scheduler off/);
  sched.fail.add('status');
  assert.match(await check(), /FAIL Scheduler: the service manager can't be read .*Simulated status failure.*scheduled work is blocked/);
  assert.deepEqual(stub.rejected(), []);
});

test('each tick starts at the next opted-in project in rotation, also after a cancelled tick; paused and unregistered projects take no turn', async t => {
  const { p, sched, roots: [a, b, c, d] } = await armed(t);
  for (const root of [a, b, d]) setProjectSchedule(p, root, true);
  const run = async (o: Partial<Parameters<typeof tick>[1]> = {}) => {
    const visited: string[] = [];
    const r = await tick(p, { backend: sched, log: () => {}, pass: async ctx => { visited.push(ctx.name); return 0; }, refresh: async () => 0, ...o });
    return { r, visited, next: readTickState(p).nextRoot };
  };
  assert.deepEqual((await run()).visited, ['a', 'b', 'd']);
  assert.equal(readTickState(p).nextRoot, b);
  const second = await run();
  assert.deepEqual(second.visited, ['b', 'd', 'a']);
  assert.equal(second.next, d, 'c is not opted in, so it never takes a turn');
  assert.deepEqual([second.r.skipped, second.r.refreshed], [{}, { c: 'ok' }], 'every project is still visited: c is refreshed, not given a turn');
  // A cancelled tick still uses up its turn, and starts nothing after the cancellation.
  const abort = new AbortController();
  const visited: string[] = [];
  const cancelled = await tick(p, { backend: sched, signal: abort.signal, log: () => {}, pass: async ctx => { visited.push(ctx.name); abort.abort(); return 0; } });
  assert.equal(cancelled.result, 'interrupted');
  assert.deepEqual(visited, ['d'], 'no later project after cancellation');
  assert.equal(readTickState(p).nextRoot, a);
  // The next project is paused before its turn: the turn passes to the one after it.
  setProjectSchedule(p, a, false);
  const fourth = await run();
  assert.deepEqual(fourth.visited, ['b', 'd']);
  assert.equal(fourth.next, d);
  // A saved nextRoot that is no longer registered starts again from the top.
  const { removeProject } = await import('../src/projects.mts');
  removeProject(p, d);
  assert.deepEqual((await run()).visited, ['b']);
  assert.equal(readTickState(p).nextRoot, b, 'a single project keeps the turn');
});

test('each completed pass hands its own jam report to jam confirmation; a failed or cancelled one is not counted (#61)', async t => {
  const { p, sched, roots: [a] } = await armed(t, ['a']);
  setProjectSchedule(p, a, true);
  const { readRecovery } = await import('../src/recovery-state.mts');
  mkdirSync(p.state, { recursive: true });
  writeFileSync(`${p.state}/a_a--7.json`, JSON.stringify({ iid: '7', project: 'a/a', stage: 'stopped', startedAt: new Date().toISOString(), branch: '7-x' }));
  const reports: string[] = [];
  const pass = (code: number, after?: () => Promise<void>) => async (_ctx: unknown, _args: string[], o: { env: NodeJS.ProcessEnv }) => {
    const file = o.env.FACTORY_JAM_REPORT!;
    reports.push(file);
    writeFileSync(file, JSON.stringify({ version: 1, pass: o.env.FACTORY_PASS_ID, project: 'a/a', at: new Date().toISOString(), tickets: [7], observed: [] }));
    await after?.();
    return code;
  };
  const lines: string[] = [];
  await tick(p, { backend: sched, log: l => lines.push(l), pass: pass(0) as any });
  await tick(p, { backend: sched, log: () => {}, pass: pass(1) as any });
  assert.equal(readRecovery(p, a).episode?.passes.length, 1, 'the failed pass is not counted');
  assert.ok(lines.some(l => /recovery a: jam on #7 seen \(1 of 2 passes\)/.test(l)));
  await tick(p, { backend: sched, log: l => lines.push(l), pass: pass(0) as any });
  assert.ok(readRecovery(p, a).episode?.confirmedAt, 'two completed passes confirm the jam');
  assert.ok(lines.some(l => /recovery a: jam on #7 confirmed; not repairing: .*no recovery workflow/.test(l)), 'inactive until the copy is upgraded');
  assert.equal(new Set(reports).size, 3, 'every pass has its own report file');
  assert.ok(reports.every(r => !existsSync(r)), 'report files are removed after the pass');
  let called = false;
  const abort = new AbortController();
  await tick(p, { backend: sched, signal: abort.signal, log: () => {}, recovery: async () => { called = true; }, pass: pass(0, async () => abort.abort()) as any });
  assert.equal(called, false, 'a cancelled pass is not handed on');
});

test('each completed pass is followed by factory clean for its project; a failed pass, a refresh or a failing clean is not (#97)', async t => {
  const { p, sched, roots: [a, b] } = await armed(t, ['a', 'b']);
  setProjectSchedule(p, a, true);
  mkdirSync(p.state, { recursive: true });
  const merged = (iid: number) => {
    const name = `${iid}-x`, wt = `${a}/.sandcastle/worktrees/${name}`;
    git(a, 'worktree', 'add', '-q', '-b', name, wt, 'main');
    writeFileSync(`${p.state}/a_a--${iid}.json`, JSON.stringify({ iid: String(iid), project: 'a/a', stage: 'done', mergedAt: '2026-11-12T00:00:00Z',
      startedAt: new Date().toISOString(), pid: process.pid, base: 'main', branch: name }));
    return { name, wt };
  };
  const has = (branch: string) => execFileSync('git', ['branch', '--list', branch], { cwd: a, encoding: 'utf8' }).trim() !== '';
  const first = merged(7);
  const failed = await tick(p, { backend: sched, log: () => {}, refresh: async () => 0, pass: async () => 1 });
  assert.equal(failed.result, 'failed');
  assert.equal(has(first.name), true, 'a failed pass gets no cleanup');
  const lines: string[] = [];
  const r = await tick(p, { backend: sched, log: l => lines.push(l), refresh: async () => 0, pass: async () => 0, recovery: async () => {} });
  assert.equal(r.result, 'done');
  assert.equal(has(first.name), false, 'the merged branch is removed after the completed pass');
  assert.equal(existsSync(first.wt), false, 'with its Factory worktree');
  assert.ok(lines.includes(`clean a: removed #7: ${first.name} and worktree ${first.wt}`), lines.join('\n'));
  assert.equal(r.refreshed.b, 'ok');
  assert.equal(lines.some(l => l.startsWith('clean b')), false, 'a read-only refresh gets no cleanup');
  const second = merged(8);
  const broken = await tick(p, { backend: sched, log: l => lines.push(l), refresh: async () => 0, pass: async () => 0, recovery: async () => {},
    clean: () => { throw new Error('boom'); } });
  assert.equal(broken.result, 'done', 'a failing clean never fails the tick');
  assert.ok(lines.includes('clean a: failed: boom'));
  assert.equal(has(second.name), true);
});
