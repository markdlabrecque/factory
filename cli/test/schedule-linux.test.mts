// The Linux scheduler slice (#33) across the stubbed systemd boundary. Factory's real CLI (cli/bin/factory.mts run as a
// subprocess), its production adapter (platform/scheduler-systemd.mts) and its generated units run against
// stubs/systemctl, a stateful, failure-injecting stand-in that records exact argv, models unit file / enabled / active
// states (timer enablement apart from tick-service activity) and rejects calls Factory should not make. It is a command
// stub, not systemd: these tests prove WHAT Factory asks of the manager and in what order, and Factory's own process
// handling on synthetic process trees. They do not prove that systemd fires or rearms timers, stores the journal, or
// delivers signals the way the unit's directives say; that is trusted. Where a test sends the tick SIGTERM itself, it is
// standing in for what `systemctl stop` is documented to do under KillMode=process, and says so.
// Synthetic dispatchers hold a pass open with nested non-detached children (a shell, an "analysis" process with its own
// child) and one detached "ticket run" in its own process group. Everything lives under a temporary HOME; no host service,
// tracker, Docker or credential is touched, and every spawned process is killed at the end of its test.
// The end-to-end CLI test also has a project never opted in whose synthetic dispatch.mts records the read-only refresh a tick gives it (#94).
import { test as nodeTest } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Fake, FakeSchedule } from '../src/platform/fake.mts';
import { SystemdSchedule, schedulerUnits } from '../src/platform/scheduler-systemd.mts';
import { install } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { stopScheduling } from '../src/commands/schedule.mts';
import { tick } from '../src/commands/tick.mts';
import { readManifest, validate } from '../src/manifest.mts';
import { readRegistry } from '../src/projects.mts';
import { readHistory, readTickState } from '../src/schedule-state.mts';
import { cancelTick } from '../src/tick-cancel.mts';
import { acquireTickLock, groupAlive, groupOf, readLock, sameProcess } from '../src/tick-lock.mts';
import { writeScheduleConfig } from '../src/schedule.mts';
import { HELD, QUICK, factoryBin, held, heldScript, home, repo, systemctlStub } from './schedule-helpers.mts';

// A regression must fail a test, not hang the run waiting for a tick that never ends.
const test = (name: string, fn: (t: TestContext) => Promise<void> | void) => nodeTest(name, { timeout: 60_000 }, fn);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => T | undefined | false, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}
const up = (pid: number) => sameProcess({ pid, startTicks: null });
const lines = (stub: ReturnType<typeof systemctlStub>) => stub.lines().filter(l => !l.startsWith('show '));

/** Runs the real CLI to completion. */
function cli(world: World, args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise(done => {
    const c = spawn(process.execPath, [factoryBin, ...args], { env: { ...process.env, FACTORY_HOME: world.p.home, ...world.stub.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    c.on('exit', code => done({ code, out, err }));
  });
}
/** Starts `factory tick` the way the service does: a controlled environment, the stub for the manager, no shell profile. */
function startTick(world: World, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [factoryBin, 'tick'], { env: { PATH: world.stub.env.PATH, HOME: world.p.home, FACTORY_HOME: world.p.home, STUB_DIR: world.stub.env.STUB_DIR, STUB_UNIT_DIR: world.stub.env.STUB_UNIT_DIR, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', d => out += d); child.stderr!.on('data', d => out += d);
  const exited = new Promise<number | null>(done => child.on('exit', code => done(code)));
  world.cleanup.push(() => { try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ } });
  return { child, exited, output: () => out };
}

type World = ReturnType<typeof world>;
function world(t: TestContext) {
  const { p } = home(t, 'factory-linux-');
  const stub = systemctlStub(t, p);
  const cleanup: (() => void)[] = [];
  t.after(() => {
    for (const fn of cleanup) fn();
    // Whatever a synthetic dispatcher left behind (such as its detached ticket run) is found by its cwd under this test's HOME.
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try { if (readlinkSync(`/proc/${name}/cwd`).startsWith(p.home)) process.kill(Number(name), 'SIGKILL'); } catch { /* gone, or not ours */ }
    }
  });
  const w = { p, stub, cleanup };
  return w;
}
/** A project whose dispatcher is the held process tree; registered and opted in. */
async function heldProject(w: World, name: string, extra: Record<string, string> = {}) {
  const root = repo(w.p, name, { script: '#!/bin/sh\n' });
  writeFileSync(join(root, '.sandcastle/dispatch.sh'), heldScript(root), { mode: 0o755 });
  const r = await cli(w, ['schedule', 'on', '--project', name], extra);
  assert.equal(r.code, 0, r.err);
  w.cleanup.push(() => { try { process.kill(held(root).ticket, 'SIGKILL'); } catch { /* not started or gone */ } });
  return root;
}
const quickProject = async (w: World, name: string) => {
  const root = repo(w.p, name, { script: QUICK });
  assert.equal((await cli(w, ['schedule', 'on', '--project', name])).code, 0);
  return root;
};
async function installed(w: World) {
  const r = await cli(w, ['install', '--link']);
  assert.equal(r.code, 0, r.err);
}
async function armed(w: World) {
  await installed(w);
  const r = await cli(w, ['schedule', 'on']);
  assert.equal(r.code, 0, r.err);
}

// ---- 1. The production adapter's contract with the manager -------------------------------------------------------

test('adapter: on writes the service then the timer, reloads, and only then enables the timer with --now; the service is never enabled', async t => {
  const w = world(t);
  const spec = { node: '/usr/bin/node', app: w.p.app, state: w.p.state, path: '/usr/bin:/bin' };
  const backend = new SystemdSchedule(w.p);
  const recorded: string[] = [];
  await w.stub.using(async () => {
    await backend.install(spec, e => { recorded.push(e.unit!); assert.equal(existsSync(e.path), true, 'each unit is on disk when it is ledgered'); });
    assert.deepEqual(w.stub.lines(), ['daemon-reload'], 'install writes artifacts and never starts or enables them');
    assert.equal(w.stub.unit('factory-tick.timer').enabled, false);
    await backend.enable();
  });
  assert.deepEqual(recorded, ['factory-tick.service', 'factory-tick.timer']);
  assert.deepEqual(w.stub.lines(), ['daemon-reload', 'enable --now factory-tick.timer']);
  assert.deepEqual([w.stub.unit('factory-tick.timer').enabled, w.stub.unit('factory-tick.timer').active], [true, true]);
  assert.equal(w.stub.unit('factory-tick.service').enabled, false);
  assert.deepEqual(w.stub.rejected(), []);
});

test('adapter: status reads enablement and activity of the timer and the tick service separately; failures and odd output throw', async t => {
  const w = world(t);
  const backend = new SystemdSchedule(w.p);
  const spec = { node: '/usr/bin/node', app: w.p.app, state: w.p.state, path: '/usr/bin' };
  await w.stub.using(async () => {
    assert.deepEqual(await backend.status(), { timer: 'missing', enabled: false, tick: 'missing' });
    await backend.install(spec, () => {});
    assert.deepEqual(await backend.status(), { timer: 'inactive', enabled: false, tick: 'inactive' }, 'installed but not enabled');
    w.stub.set('factory-tick.timer', { enabled: true });
    assert.deepEqual(await backend.status(), { timer: 'inactive', enabled: true, tick: 'inactive' }, 'enabled/inactive');
    w.stub.set('factory-tick.timer', { enabled: false, active: true });
    assert.deepEqual(await backend.status(), { timer: 'active', enabled: false, tick: 'inactive' }, 'disabled/active (a plain disable)');
    w.stub.set('factory-tick.timer', { enabled: true, active: true, lastTrigger: 'Tue 2026-11-10 10:00:00 UTC' });
    w.stub.set('factory-tick.service', { forcedActiveState: 'activating' });
    assert.deepEqual(await backend.status(), { timer: 'active', enabled: true, tick: 'active', lastTick: 'Tue 2026-11-10 10:00:00 UTC' }, 'a tick running does not change the timer');
    w.stub.set('factory-tick.service', { forcedActiveState: 'failed' });
    assert.equal((await backend.status()).tick, 'inactive', 'a failed tick is inactive; the timer is unaffected');
    w.stub.fail('--user show factory-tick.service --property=LoadState,ActiveState');
    await assert.rejects(backend.status(), /injected failure/);
    w.stub.clearFail();
    writeFileSync(join(w.stub.bin, 'systemctl'), '#!/bin/sh\necho gibberish\n');
    await assert.rejects(backend.status(), /systemctl show gave no/);
  });
});

test('adapter: disable disables and stops the timer first, then stops the tick service; either failure throws and nothing later runs', async t => {
  const w = world(t);
  const backend = new SystemdSchedule(w.p);
  const spec = { node: '/usr/bin/node', app: w.p.app, state: w.p.state, path: '/usr/bin' };
  await w.stub.using(async () => {
    await backend.disable();
    assert.deepEqual(lines(w.stub), [], 'nothing installed: no mutating call');
    await backend.install(spec, () => {});
    await backend.enable();
    w.stub.set('factory-tick.service', { active: true });
    const before = w.stub.calls().length;
    await backend.disable();
    assert.deepEqual(w.stub.calls().slice(before).filter(c => c[0] !== 'show'), [['disable', '--now', 'factory-tick.timer'], ['stop', 'factory-tick.service']]);
    assert.deepEqual([w.stub.unit('factory-tick.timer').enabled, w.stub.unit('factory-tick.timer').active, w.stub.unit('factory-tick.service').active], [false, false, false]);
    await backend.disable();
    await backend.enable();
    w.stub.fail('--user disable --now factory-tick.timer');
    const n = w.stub.calls().length;
    await assert.rejects(backend.disable(), /injected failure/);
    assert.equal(w.stub.calls().slice(n).some(c => c[0] === 'stop'), false, 'the service is not stopped when the timer could not be disabled');
    w.stub.clearFail();
    w.stub.fail('--user stop factory-tick.service');
    await assert.rejects(backend.disable(), /injected failure/);
    assert.equal(w.stub.unit('factory-tick.timer').enabled, false, 'the timer was already disabled when the stop failed');
  });
  assert.deepEqual(w.stub.rejected(), []);
});

test('adapter: remove deletes exactly the named unit, only scheduler units are accepted, and a missing unit file is fine', async t => {
  const w = world(t);
  const backend = new SystemdSchedule(w.p);
  await w.stub.using(async () => {
    await backend.install({ node: '/usr/bin/node', app: w.p.app, state: w.p.state, path: '/usr/bin' }, () => {});
    await assert.rejects(backend.remove({ kind: 'systemd', unit: 'factory-board.service', path: w.p.systemd }), /Not a scheduler unit/);
    await backend.remove({ kind: 'systemd', unit: 'factory-tick.timer', path: w.p.tickTimer });
    assert.equal(existsSync(w.p.tickTimer), false);
    assert.equal(existsSync(w.p.tickService), true, 'the other unit is untouched');
    await backend.remove({ kind: 'systemd', unit: 'factory-tick.timer', path: w.p.tickTimer });
    await backend.remove({ kind: 'systemd', unit: 'factory-tick.service', path: w.p.tickService });
  });
  assert.deepEqual(w.stub.rejected(), []);
});

test('units: quoting survives spaces, quotes, percent and dollar; no shell, no profile, no finite start timeout', () => {
  const odd = '/ho me/it\'s "q" 100% $HOME/app';
  const u = schedulerUnits({ node: '/opt/no de/bin/node', app: odd, state: '/s t/50%', path: '/a b:/c"d:/e$f' }, '/h o/%u');
  const exec = u['factory-tick.service'].match(/^ExecStart=(.*)$/m)![1];
  assert.equal(exec, `"/opt/no de/bin/node" "/ho me/it's \\"q\\" 100%% $$HOME/app/cli/bin/factory.mts" tick`);
  assert.match(u['factory-tick.service'], /^Environment="PATH=\/a b:\/c\\"d:\/e\$f"$/m, 'Environment= keeps $ literal');
  assert.match(u['factory-tick.service'], /^Environment="FACTORY_HOME=\/h o\/%%u"$/m, 'a literal % is doubled so it is not a specifier');
  assert.match(u['factory-tick.service'], /^Environment="SANDCASTLE_STATE_DIR=\/s t\/50%%"$/m);
  assert.doesNotMatch(u['factory-tick.service'], /EnvironmentFile|\.profile|bashrc|\/bin\/sh|bash/);
  assert.match(u['factory-tick.service'], /^TimeoutStartSec=infinity$/m);
  assert.doesNotMatch(u['factory-tick.service'], /^\[Install\]/m, 'only the timer is enabled');
  assert.match(u['factory-tick.timer'], /^WantedBy=timers\.target$/m);
});

test('ledger: only exact scheduler paths validate, lookalikes and swapped paths are refused', t => {
  const { p } = home(t);
  mkdirSync(p.systemd.replace(/[^/]+$/, ''), { recursive: true });
  validate(p, { kind: 'systemd', unit: 'factory-tick.timer', path: p.tickTimer });
  validate(p, { kind: 'systemd', unit: 'factory-tick.service', path: p.tickService });
  for (const bad of [{ unit: 'factory-tick.timer', path: p.tickService }, { unit: 'factory-tick.service', path: p.tickTimer }, { unit: 'factory-tickx.timer', path: p.tickTimer },
    { unit: 'factory-evil.service', path: p.tickService.replace('factory-tick', 'factory-evil') }, { unit: '__proto__', path: p.tickTimer }])
    assert.throws(() => validate(p, { kind: 'systemd', ...bad }), /Unsafe manifest entry|Unexpected unit/, JSON.stringify(bad));
});

// ---- 2. The real CLI, enable to uninstall ------------------------------------------------------------------------

test('cli: install -> project on -> global on -> tick -> status -> off -> uninstall, with the exact calls, env and args', async t => {
  const w = world(t);
  const root = repo(w.p, 'alpha', { script: QUICK });
  const other = repo(w.p, 'beta', { script: QUICK });
  // beta is never opted in: each tick runs its dispatch.mts --refresh-only (#94), which records what it got.
  writeFileSync(join(other, '.sandcastle/dispatch.mts'), "import { writeFileSync } from 'node:fs';\n" +
    "writeFileSync('.sandcastle/refresh.json', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), state: process.env.SANDCASTLE_STATE_DIR, scheduled: process.env.FACTORY_SCHEDULED ?? null, jam: process.env.FACTORY_JAM_REPORT ?? null }));\n");
  const unrelated = join(w.p.home, '.config/systemd/user/unrelated.service');
  mkdirSync(join(w.p.home, '.config/systemd/user'), { recursive: true });
  writeFileSync(unrelated, '[Service]\nExecStart=/bin/true\n');

  assert.equal((await cli(w, ['install', '--link'])).code, 0);
  assert.equal(existsSync(w.p.tickService) || existsSync(w.p.tickTimer), false, 'a fresh install writes no tick units');
  assert.equal(lines(w.stub).some(l => l.includes('factory-tick')), false, 'and makes no call about them');
  assert.equal(existsSync(w.p.scheduleConfig), false);

  let r = await cli(w, ['schedule', 'on', '--project', 'alpha']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Scheduled alpha on branch main/);
  assert.match(r.out, /scheduler is off \(timer not installed\), so nothing runs yet/);
  assert.equal(lines(w.stub).some(l => l.includes('factory-tick')), false, 'project opt-in starts nothing');
  assert.deepEqual(readRegistry(w.p).projects.map(x => [x.name, x.schedule?.enabled]), [['alpha', true], ['beta', undefined]]);

  const calls0 = w.stub.calls().length;
  const cwd = process.cwd();
  r = await cli(w, ['schedule', 'on']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(w.stub.calls().slice(calls0).filter(c => c[0] !== 'show').map(c => c.join(' ')), ['daemon-reload', 'enable --now factory-tick.timer']);
  assert.match(r.out, /Scheduled projects: alpha\n/, 'global on opted in nobody new');
  assert.equal(readRegistry(w.p).projects.find(x => x.root === other)!.schedule, undefined);
  assert.equal(process.cwd(), cwd);
  const config = JSON.parse(readFileSync(w.p.scheduleConfig, 'utf8'));
  assert.deepEqual(Object.keys(config).sort(), ['node', 'path', 'version']);
  assert.equal(config.node, process.execPath);
  assert.equal(statSync(w.p.scheduleConfig).mode & 0o777, 0o600);
  const manifest = readManifest(w.p)!;
  assert.deepEqual(manifest.entries.filter(e => e.unit?.startsWith('factory-tick')).map(e => e.unit), ['factory-tick.service', 'factory-tick.timer']);
  const service = readFileSync(w.p.tickService, 'utf8');
  assert.match(service, new RegExp(`^ExecStart="${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" ".*/cli/bin/factory\\.mts" tick$`, 'm'));
  assert.ok(service.includes(`Environment="PATH=${config.path}"`));

  // The tick, started as the service does, with a caller override that must lose.
  const t1 = startTick(w, { PATH: config.path.replace(/^/, `${w.stub.bin}:`), SANDCASTLE_STATE_DIR: '/not/here' });
  assert.equal(await t1.exited, 0, t1.output());
  const ran = readFileSync(join(root, '.sandcastle/quick.args'), 'utf8').trim();
  assert.equal(ran, '--max 3');
  assert.equal(readFileSync(join(root, '.sandcastle/quick.cwd'), 'utf8').trim(), root);
  assert.equal(existsSync(join(other, '.sandcastle/ran')), false, 'a project that was not opted in is not run');
  assert.match(t1.output(), /refresh beta \(main\): start/);
  assert.match(t1.output(), /refresh beta: exit 0/);
  assert.deepEqual(JSON.parse(readFileSync(join(other, '.sandcastle/refresh.json'), 'utf8')),
    { args: ['--refresh-only', '--base', 'main'], cwd: other, state: w.p.state, scheduled: null, jam: null }, 'a read-only refresh, not a pass, against shared state');
  assert.match(t1.output(), /1 passes, 1 refreshed, 0 skipped, 0 failed/);
  assert.equal(readTickState(w.p).projects[other].reason, 'project not opted in; read-only refresh ok');
  assert.match(t1.output(), /pass alpha: exit 0/);
  const st = readTickState(w.p);
  assert.deepEqual([st.projects[root].result, st.projects[root].exitCode, typeof st.projects[root].pid], ['ok', 0, 'number']);

  r = await cli(w, ['schedule', 'status', '--json']);
  const status = JSON.parse(r.out);
  assert.deepEqual([status.scheduler.service, status.scheduler.serviceEnabled, status.scheduler.timerActive, status.scheduler.tickActive, status.scheduler.phase], ['active', true, true, false, 'waiting']);
  assert.equal(status.projects.find((x: any) => x.name === 'alpha').last.result, 'ok');
  r = await cli(w, ['schedule', 'status']);
  assert.match(r.out, /Scheduler: on/);
  assert.match(r.out, /alpha {2}on \(main\) {2}ready {2}last pass ok \(exit 0\)/);

  const calls1 = w.stub.calls().length;
  r = await cli(w, ['schedule', 'off']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(w.stub.calls().slice(calls1).filter(c => c[0] !== 'show').map(c => c.join(' ')), ['disable --now factory-tick.timer', 'stop factory-tick.service']);
  assert.match(r.out, /No tick was running/);
  rmSync(join(root, '.sandcastle/ran'), { force: true });
  const t2 = startTick(w);
  assert.equal(await t2.exited, 0);
  assert.match(t2.output(), /tick skipped: scheduler is off \(timer disabled\)/);
  assert.equal(existsSync(join(root, '.sandcastle/ran')), false, 'no work after off');

  const calls2 = w.stub.calls().length;
  r = await cli(w, ['uninstall', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.equal(w.stub.calls().length, calls2, 'dry-run makes no service-manager call');
  assert.equal(existsSync(w.p.tickTimer), true);
  r = await cli(w, ['uninstall']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(w.stub.calls().slice(calls2).filter(c => c[0] !== 'show').map(c => c.join(' ')), [
    'disable --now factory-tick.timer', 'stop factory-tick.service',                       // scheduling is stopped first
    'stop factory-tick.timer', 'disable factory-tick.timer', 'daemon-reload',               // then each ledgered unit goes, the timer first
    'stop factory-tick.service', 'disable factory-tick.service', 'daemon-reload',
    'stop factory-board.service', 'disable factory-board.service', 'daemon-reload'], 'exact calls and order');
  for (const path of [w.p.tickService, w.p.tickTimer, w.p.manifest, w.p.systemd]) assert.equal(existsSync(path), false, path);
  for (const keep of [unrelated, w.p.projects, w.p.scheduleConfig, join(root, '.sandcastle/dispatch.sh')]) assert.equal(existsSync(keep), true, `${keep} is kept`);
  assert.deepEqual(w.stub.rejected(), [], 'the stub rejected nothing: every call had a shape Factory is meant to send');
});

test('cli: argument contract; positional project, --json outside status, internal tick flags and bad actions are rejected', async t => {
  const w = world(t);
  const run = async (...a: string[]) => cli(w, a);
  assert.match((await run('schedule', 'on', 'alpha')).err, /Unexpected arguments \(name a project with --project\)/);
  assert.match((await run('schedule', 'on', '--json')).err, /--json applies to schedule status/);
  assert.match((await run('schedule')).err, /Usage: factory schedule on\|off\|status/);
  assert.match((await run('schedule', 'pause')).err, /Usage: factory schedule/);
  assert.match((await run('tick', '--project', 'x')).err, /Unknown option/);
  assert.match((await run('tick', 'extra')).err, /Unexpected arguments/);
  assert.match((await run('schedule', 'status', '--project', 'ghost')).err, /No registered project ghost/);
  assert.equal(w.stub.rejected().length, 0);
});

test('cli: opt-in refusals (no origin, local-only branch, non-executable script, old copy, detached HEAD) change nothing', async t => {
  const w = world(t);
  const noOrigin = repo(w.p, 'noorigin', { push: false });
  const local = repo(w.p, 'local');
  const exec644 = repo(w.p, 'x644');
  const old = repo(w.p, 'old', { current: false });
  const detached = repo(w.p, 'detached');
  const { execFileSync } = await import('node:child_process');
  const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.x', ...a], { cwd, stdio: 'ignore' });
  g(local, 'checkout', '-q', '-b', 'only-here');
  chmodSync(join(exec644, '.sandcastle/dispatch.sh'), 0o644);
  g(detached, 'checkout', '-q', '--detach');
  const before = readFileSync(w.p.projects, 'utf8');
  const expect: Record<string, RegExp> = { noorigin: /no `origin` remote/, local: /branch only-here is not on origin/, x644: /not executable/, old: /predates launch reservations/, detached: /detached HEAD/ };
  for (const [name, re] of Object.entries(expect)) { const r = await cli(w, ['schedule', 'on', '--project', name]); assert.notEqual(r.code, 0, name); assert.match(r.err, re, name); }
  assert.equal(readFileSync(w.p.projects, 'utf8'), before, 'no refusal wrote the registry');
  assert.deepEqual(w.stub.lines(), []);
  void noOrigin;
  // Project off works for a deleted checkout and keeps the saved branch.
  const good = repo(w.p, 'good');
  assert.equal((await cli(w, ['schedule', 'on', '--project', 'good'])).code, 0);
  rmSync(good, { recursive: true, force: true });
  const off = await cli(w, ['schedule', 'off', '--project', good]);
  assert.equal(off.code, 0, off.err);
  assert.deepEqual(readRegistry(w.p).projects.find(x => x.root === good)!.schedule!.enabled, false);
  assert.equal(readRegistry(w.p).projects.find(x => x.root === good)!.schedule!.branch, 'main');
});

test('cli: a branch change skips the project without touching the checkout; a failed pass fails the tick but never the timer', async t => {
  const w = world(t);
  const root = repo(w.p, 'alpha', { script: QUICK });
  await armed(w);
  assert.equal((await cli(w, ['schedule', 'on', '--project', 'alpha'])).code, 0);
  const { execFileSync } = await import('node:child_process');
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.x', ...a], { cwd: root, encoding: 'utf8' });
  g('checkout', '-q', '-b', 'feature');
  const head = g('rev-parse', 'HEAD'), status = g('status', '--porcelain'), stashes = g('stash', 'list');
  const t1 = startTick(w);
  assert.equal(await t1.exited, 0);
  assert.match(t1.output(), /skip alpha: checkout is on feature, scheduled branch is main/);
  assert.equal(existsSync(join(root, '.sandcastle/ran')), false);
  assert.deepEqual([g('rev-parse', 'HEAD'), g('status', '--porcelain'), g('stash', 'list'), g('branch', '--show-current').trim()], [head, status, stashes, 'feature']);
  g('checkout', '-q', 'main');
  const before = w.stub.calls().length;
  const t2 = startTick(w, { QUICK_EXIT: '3' });
  assert.equal(await t2.exited, 1, 'a failed project pass makes the tick exit nonzero');
  assert.match(t2.output(), /pass alpha: exit 3/);
  assert.deepEqual(w.stub.calls().slice(before).filter(c => c[0] !== 'show'), [], 'the tick never changes the timer');
  assert.equal(w.stub.unit('factory-tick.timer').enabled && w.stub.unit('factory-tick.timer').active, true);
  assert.equal(readTickState(w.p).projects[root].result, 'error');
});

// ---- 3. Cancellation on synthetic process trees ----------------------------------------------------------------

test('off cancels a held pass, its nested shell and analysis children, keeps the detached ticket run, and starts no later project', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  const b = await quickProject(w, 'beta');
  await armed(w);
  const tk = startTick(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  await waitFor('nested children', () => [pids.shell, pids.analysis, pids.ticket].every(up));
  assert.equal(readTickState(w.p).projects[a].pid, pids.dispatcher, 'the pass pid is saved at spawn');
  assert.equal(readLock(w.p)!.pass!.pid, pids.dispatcher, 'and recorded in the lock as the owned group');
  // The synthetic tree: dispatcher, shell and analysis share the pass group; the ticket run leads its own.
  assert.deepEqual([groupOf(pids.dispatcher), groupOf(pids.shell), groupOf(pids.analysis)], [pids.dispatcher, pids.dispatcher, pids.dispatcher]);
  assert.equal(groupOf(pids.ticket), pids.ticket, 'the detached ticket run is in its own group');
  assert.notEqual(groupOf(tk.child.pid!), pids.dispatcher, 'the tick is not in the pass group');
  assert.equal(groupAlive(pids.dispatcher), true);
  const tickPid = tk.child.pid!;
  const off = await cli(w, ['schedule', 'off']);
  assert.equal(off.code, 0, off.err);
  assert.match(off.out, /The active tick was stopped\. Its pass for alpha was cancelled and recorded as interrupted\./);
  assert.doesNotMatch(off.out, /No tick was running/);
  assert.equal(await tk.exited, 143, tk.output());
  assert.equal(up(tickPid), false);
  for (const name of ['dispatcher', 'shell', 'analysis'] as const) assert.equal(up(pids[name]), false, `${name} is gone`);
  assert.equal(groupAlive(pids.dispatcher), false, 'the whole owned group is gone, including the analysis child');
  assert.equal(up(pids.ticket), true, 'the independently detached ticket run keeps going');
  assert.equal(existsSync(join(b, '.sandcastle/ran')), false, 'no later project started');
  const order = lines(w.stub).filter(l => /disable --now|stop factory-tick.service/.test(l));
  assert.deepEqual(order, ['disable --now factory-tick.timer', 'stop factory-tick.service'], 'timer off before the tick service stop');
  const st = readTickState(w.p);
  assert.deepEqual([st.projects[a].result, st.projects[a].reason], ['interrupted', 'cancelled']);
  assert.equal(st.projects[b], undefined);
  assert.equal(st.currentRoot, undefined);
  assert.equal(existsSync(w.p.tickLock), false, 'the lock is released once cancellation is confirmed');
  assert.match(tk.output(), /tick interrupted/);
  assert.equal(w.stub.rejected().length, 0);
});

test('SIGTERM to the tick alone (what systemctl stop is documented to send under KillMode=process) cancels the pass tree the same way', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  await waitFor('nested children', () => [pids.shell, pids.analysis, pids.ticket].every(up));
  process.kill(tk.child.pid!, 'SIGTERM');
  assert.equal(await tk.exited, 143);
  assert.equal(groupAlive(pids.dispatcher), false);
  assert.equal(up(pids.ticket), true);
  assert.equal(readTickState(w.p).projects[a].result, 'interrupted');
  assert.equal(existsSync(w.p.tickLock), false);
});

test('cancellation grace is for cancellation only: a pass that outlives it normally is never signalled; an ignored SIGTERM is escalated to SIGKILL on the owned group only', async t => {
  const w = world(t);
  const root = repo(w.p, 'stubborn', { script: '#!/bin/sh\n' });
  writeFileSync(join(root, '.sandcastle/dispatch.sh'), heldScript(root), { mode: 0o755 });
  writeFileSync(join(root, '.sandcastle/ignore-term'), '');
  assert.equal((await cli(w, ['schedule', 'on', '--project', 'stubborn'])).code, 0);
  w.cleanup.push(() => { try { process.kill(held(root).ticket, 'SIGKILL'); } catch { /* gone */ } });
  writeScheduleConfig(w.p, { path: process.env.PATH!, node: process.execPath });
  const backend = new FakeSchedule(w.p);
  backend.timer = 'active'; backend.enabled = true;
  // (a) No timeout: with a 100 ms grace the held pass runs for a full second and is left alone.
  const abort = new AbortController();
  const done = tick(w.p, { backend, signal: abort.signal, log: () => {}, cancel: { graceMs: 100, confirmMs: 100 } });
  const pids = await waitFor('the held dispatcher', () => existsSync(join(root, '.sandcastle/held.json')) && held(root));
  await sleep(1000);
  assert.equal(up(pids.dispatcher), true, 'a normally running pass is never timed out');
  assert.equal(readTickState(w.p).projects[root].result, 'running');
  // (b) Cancel: the dispatcher ignores SIGTERM, so the group is killed after the grace, and only that group.
  const t0 = Date.now();
  abort.abort();
  const r = await done;
  assert.equal(r.result, 'interrupted');
  assert.ok(Date.now() - t0 >= 90, 'SIGKILL waited for the grace period');
  assert.equal(groupAlive(pids.dispatcher), false);
  assert.equal(up(pids.ticket), true, 'escalation never reaches the detached ticket run');
  assert.deepEqual([readTickState(w.p).projects[root].result, existsSync(w.p.tickLock)], ['interrupted', false]);
});

test('cancellation that cannot be confirmed fails, keeps the lock, state, units and app, and a retry still finds what to cancel', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  const kill = () => { /* a signal that never arrives */ };
  const service = new Fake(w.p);
  const backend = new SystemdSchedule(w.p);
  const manifestBefore = readFileSync(w.p.manifest, 'utf8');
  await w.stub.using(async () => {
    await assert.rejects(uninstall(w.p, service, { schedule: backend, cancel: { kill, graceMs: 100, confirmMs: 100 } }), /did not exit after SIGKILL/);
  });
  assert.equal(up(tk.child.pid!), true);
  assert.equal(up(pids.dispatcher), true);
  assert.equal(readFileSync(w.p.manifest, 'utf8'), manifestBefore, 'the ledger is untouched');
  for (const path of [w.p.tickService, w.p.tickTimer, w.p.app, w.p.scheduleConfig, w.p.tickLock]) assert.equal(existsSync(path), true, `${path} is kept`);
  assert.equal(readLock(w.p)!.pass!.pid, pids.dispatcher);
  const disabled = lines(w.stub).filter(l => /disable --now|stop factory-tick/.test(l));
  assert.equal(disabled[0], 'disable --now factory-tick.timer', 'future activation was stopped before the failed cancellation');
  // Retry with working signals.
  await w.stub.using(async () => { await uninstall(w.p, service, { schedule: backend, cancel: { graceMs: 3000 } }); });
  assert.equal(await tk.exited, 143);
  assert.equal(groupAlive(pids.dispatcher), false);
  assert.equal(up(pids.ticket), true, 'uninstall preserved the detached ticket run');
  for (const path of [w.p.tickService, w.p.tickTimer, w.p.manifest, w.p.app]) assert.equal(existsSync(path), false, `${path} is removed only after cancellation was confirmed`);
  assert.equal(existsSync(w.p.projects), true);
});

test('a stop failure or a disable failure aborts before any signal: the active tick is left running and nothing is deleted', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  for (const failing of ['--user stop factory-tick.service', '--user disable --now factory-tick.timer']) {
    w.stub.fail(failing);
    const r = await cli(w, ['schedule', 'off']);
    assert.notEqual(r.code, 0, failing);
    assert.match(r.err, /injected failure/);
    assert.equal(up(tk.child.pid!), true, `the tick is untouched after: ${failing}`);
    assert.equal(up(pids.dispatcher), true);
    const u = await cli(w, ['uninstall']);
    assert.notEqual(u.code, 0);
    for (const path of [w.p.tickService, w.p.tickTimer, w.p.manifest, w.p.app]) assert.equal(existsSync(path), true, path);
    w.stub.clearFail();
  }
  const r = await cli(w, ['schedule', 'off']);
  assert.equal(r.code, 0, r.err);
  assert.equal(await tk.exited, 143);
  assert.equal(up(pids.dispatcher), false);
});

test('a tick killed outright leaves its pass group alive and recorded: no new pass starts over it, and off cancels it and marks it interrupted', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  process.kill(tk.child.pid!, 'SIGKILL'); // systemd's TimeoutStopSec kill of the main process, or an OOM kill
  await tk.exited;
  assert.equal(groupAlive(pids.dispatcher), true, 'the orphaned pass is still running');
  assert.equal(readTickState(w.p).projects[a].result, 'running', 'its state is still honest: running');
  const t2 = startTick(w);
  assert.equal(await t2.exited, 0);
  assert.match(t2.output(), /a dispatcher pass from a dead tick is still running \(pid \d+/);
  const off = await cli(w, ['schedule', 'off']);
  assert.equal(off.code, 0, off.err);
  assert.equal(groupAlive(pids.dispatcher), false);
  assert.equal(up(pids.ticket), true);
  const st = readTickState(w.p).projects[a];
  assert.deepEqual([st.result, st.reason, st.finishedAt, st.durationMs], ['interrupted', 'cancelled', undefined, undefined], 'no finish time or duration is invented');
  assert.equal(existsSync(w.p.tickLock), false);
});

test('off orders the steps: the timer is stopped while the tick is still alive, and the tick is gone when off returns', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  const backend = new FakeSchedule(w.p);
  backend.timer = 'active'; backend.enabled = true; backend.tick = 'active';
  const seen: string[] = [];
  backend.onStop = () => { seen.push(`timer ${backend.enabled ? 'enabled' : 'disabled'}, tick ${up(tk.child.pid!) ? 'alive' : 'gone'}`); };
  await stopScheduling(backend, w.p, { graceMs: 3000 });
  assert.deepEqual(backend.calls, ['status', 'disable', 'stop'], 'one read of the manager, then disable, then the service stop');
  assert.deepEqual(seen, ['timer disabled, tick alive'], 'future activation is off before the active tick is cancelled');
  assert.equal(up(tk.child.pid!), false, 'cancellation is confirmed before stopScheduling returns');
  await tk.exited;
});

test('no tick after off: a timer race may start one tick, which sees the disabled timer and does no work', async t => {
  const w = world(t);
  const root = await quickProject(w, 'alpha');
  await armed(w);
  assert.equal((await cli(w, ['schedule', 'off'])).code, 0);
  w.stub.set('factory-tick.service', { forcedActiveState: 'activating' }); // the race: a tick the timer had just triggered
  const t1 = startTick(w);
  assert.equal(await t1.exited, 0);
  assert.match(t1.output(), /tick skipped: scheduler is off \(timer disabled\)/);
  assert.equal(existsSync(join(root, '.sandcastle/ran')), false);
  assert.equal(readLock(w.p), null, 'the racing tick never took the lock');
  w.stub.fail('--user show factory-tick.timer --property=LoadState,ActiveState,UnitFileState,LastTriggerUSec');
  const t2 = startTick(w);
  assert.equal(await t2.exited, 1, 'a manager that cannot be read fails closed');
  assert.match(t2.output(), /scheduler state unknown/);
  assert.equal(existsSync(join(root, '.sandcastle/ran')), false);
});

test('dry-run uninstall signals and changes nothing, even with a tick running', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  const before = w.stub.calls().length;
  const r = await cli(w, ['uninstall', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Would stop the scheduler/);
  assert.equal(w.stub.calls().length, before);
  assert.equal(up(tk.child.pid!), true);
  assert.equal(up(pids.dispatcher), true);
  assert.equal(existsSync(w.p.tickTimer), true);
  process.kill(tk.child.pid!, 'SIGTERM');
  await tk.exited;
});

test('reinstall stops scheduling and cancels the active tick before replacing files, leaves the timer disabled and keeps project opt-ins', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  const source = join(w.p.home, 'src');
  for (const d of ['cli', 'board', 'orchestrator', 'skills']) mkdirSync(join(source, d), { recursive: true });
  const logs: string[] = [];
  t.mock.method(console, 'log', (l: string) => logs.push(l));
  t.mock.method(console, 'warn', () => {});
  const service = new Fake(w.p);
  const backend = new SystemdSchedule(w.p);
  const before = w.stub.calls().length;
  await w.stub.using(async () => { await install(w.p, service, { source, schedule: backend, cancel: { graceMs: 3000 } }); });
  const after = w.stub.calls().slice(before).filter(c => c[0] !== 'show').map(c => c.join(' '));
  assert.equal(after[0], 'disable --now factory-tick.timer', 'activation is stopped first');
  assert.equal(after[1], 'stop factory-tick.service');
  assert.equal(after.includes('enable --now factory-tick.timer'), false, 'reinstall never enables the timer');
  assert.deepEqual([w.stub.unit('factory-tick.timer').enabled, w.stub.unit('factory-tick.timer').active], [false, false]);
  assert.equal(await tk.exited, 143);
  assert.equal(groupAlive(pids.dispatcher), false);
  assert.equal(up(pids.ticket), true);
  assert.equal(readRegistry(w.p).projects[0].schedule!.enabled, true, 'project opt-in survives, and does not start anything');
  assert.deepEqual(readManifest(w.p)!.entries.filter(e => e.unit?.startsWith('factory-tick')).map(e => e.unit), ['factory-tick.service', 'factory-tick.timer']);
  assert.ok(readFileSync(w.p.tickTimer, 'utf8').includes('OnUnitInactiveSec=5min'), 'owned scheduler units were refreshed');
  assert.ok(logs.some(l => /Resume it with: factory schedule on/.test(l)));
  // A failed cancellation stops the reinstall before anything is replaced.
  await w.stub.using(async () => { await backend.enable(); });
  w.stub.fail('--user stop factory-tick.service');
  const appBefore = existsSync(w.p.app);
  await w.stub.using(async () => { await assert.rejects(install(w.p, service, { source, schedule: backend }), /injected failure/); });
  assert.equal(existsSync(w.p.app), appBefore);
});

test('tick lock: one owner, a reused pid is not the owner, an unreadable lock blocks, concurrent reclaimers admit one', async t => {
  const { p } = home(t);
  const first = acquireTickLock(p);
  assert.ok(!('busy' in first));
  assert.match((acquireTickLock(p) as { busy: string }).busy, /another tick is running/);
  const info = readLock(p)!;
  assert.equal(info.tick.pid, process.pid);
  if (info.tick.startTicks !== null) {
    // Same pid, different start time: a recycled pid, so the lock is stale and reclaimed.
    writeFileSync(p.tickLock, JSON.stringify({ ...info, tick: { pid: process.pid, startTicks: info.tick.startTicks + 1 } }));
    const second = acquireTickLock(p);
    assert.ok(!('busy' in second), 'a pid with a different start time is not the recorded tick');
    second.release();
  } else first.release();
  assert.equal(existsSync(p.tickLock), false);
  // Two reclaimers of one dead lock: at most one proceeds, the other is refused or busy.
  mkdirSync(p.schedulerState, { recursive: true });
  writeFileSync(p.tickLock, JSON.stringify({ version: 1, token: 'dead', tick: { pid: 999999999, startTicks: null } }));
  const results = [acquireTickLock(p), (() => { try { return acquireTickLock(p); } catch (e) { return { busy: String(e) }; } })()];
  assert.equal(results.filter(r => !('busy' in r)).length, 1, 'only one reclaimer holds the lock');
  assert.equal(existsSync(`${p.tickLock}.reclaim`), false, 'the reclaim guard is released');
  (results.find(r => !('busy' in r)) as { release(): void }).release();
  writeFileSync(`${p.tickLock}.reclaim`, '');
  writeFileSync(p.tickLock, JSON.stringify({ version: 1, token: 'dead', tick: { pid: 999999999, startTicks: null } }));
  assert.throws(() => acquireTickLock(p), /reclaiming the scheduler lock/);
});

test('cancelTick is a no-op with no lock, refuses to signal our own group, and only signals the recorded tick and pass', async t => {
  const { p } = home(t);
  assert.deepEqual(await cancelTick(p), { active: false, escalated: false });
  mkdirSync(p.schedulerState, { recursive: true });
  const signals: [number, string][] = [];
  const kill = (pid: number, s: NodeJS.Signals) => { signals.push([pid, s]); };
  const lock = acquireTickLock(p);
  assert.ok(!('busy' in lock));
  await assert.rejects(cancelTick(p, { kill }), /Refusing to cancel the current process/);
  lock.recordPass(p.home, 1);
  assert.deepEqual(signals, [], 'nothing was signalled');
  lock.release();
  // A recorded pass group of 1 (init) or of our own group must never be signalled.
  const dead = { version: 1, token: 'x', tick: { pid: 999999999, startTicks: null }, pass: { pid: 1, startTicks: null, root: p.home } };
  writeFileSync(p.tickLock, JSON.stringify(dead));
  await assert.rejects(cancelTick(p, { kill, graceMs: 50, confirmMs: 50 }), /Refusing to signal process group 1/);
  assert.deepEqual(signals, []);
});

// ---- 4. Reporting what off stopped ------------------------------------------------------------------------------

test('off reports a tick the service stop cancelled, even though no lock is left, and never claims "no tick was running" then', async t => {
  const w = world(t);
  await quickProject(w, 'alpha');
  await armed(w);
  // The manager says a tick is running; Factory holds no lock (the tick already released it, or is not Factory's to find).
  w.stub.set('factory-tick.service', { forcedActiveState: 'active' });
  const r = await cli(w, ['schedule', 'off']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /The active tick was stopped\./);
  assert.doesNotMatch(r.out, /No tick was running/);
  assert.equal(lines(w.stub).filter(l => /stop factory-tick.service/.test(l)).length, 1);
  // Nothing running: the plain message.
  const again = await cli(w, ['schedule', 'off']);
  assert.match(again.out, /No tick was running\./);
});

test('off reports the cancelled project when systemd\'s stop (stood in for by SIGTERM to the tick) ends the tick and releases its lock', async t => {
  const w = world(t);
  const a = await heldProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  const backend = new FakeSchedule(w.p);
  backend.timer = 'active'; backend.enabled = true; backend.tick = 'active';
  // `systemctl stop factory-tick.service` is documented to SIGTERM the tick (KillMode=process) and wait for it to exit.
  backend.onStop = async () => { process.kill(tk.child.pid!, 'SIGTERM'); await tk.exited; };
  const report = await stopScheduling(backend, w.p, { graceMs: 3000 });
  assert.deepEqual([report.tickActive, report.cancelled, report.interrupted], [true, false, ['alpha']], 'Factory itself had nothing left to cancel');
  assert.equal(readLock(w.p), null);
  assert.equal(groupAlive(pids.dispatcher), false);
  assert.equal(up(pids.ticket), true);
  const { describeStop } = await import('../src/commands/schedule.mts');
  assert.equal(describeStop(report), 'The active tick was stopped. Its pass for alpha was cancelled and recorded as interrupted.');
});

test('off does not call a pass cancelled when it finished on its own while the stop was taking effect', async t => {
  const { p } = home(t);
  const root = repo(p, 'alpha');
  const state = (result: string, extra = {}) => JSON.stringify({ version: 1, startedAt: '2026-01-01T00:00:00.000Z', pid: 99, currentRoot: root,
    projects: { [root]: { attemptedAt: '2026-01-01T00:00:01.000Z', pid: 98, result, ...extra } } });
  mkdirSync(p.schedulerState, { recursive: true });
  writeFileSync(`${p.schedulerState}/state.json`, state('running'));
  const backend = new FakeSchedule(p);
  backend.timer = 'active'; backend.enabled = true; backend.tick = 'active';
  // The tick finished the pass normally after Factory's read and before the stop reached it.
  backend.onStop = () => { writeFileSync(`${p.schedulerState}/state.json`, state('ok', { finishedAt: '2026-01-01T00:00:05.000Z', durationMs: 4000, exitCode: 0 })); };
  const { describeStop } = await import('../src/commands/schedule.mts');
  const report = await stopScheduling(backend, p);
  assert.deepEqual([report.interrupted, report.finished], [[], ['alpha']]);
  const text = describeStop(report);
  assert.equal(text, 'The active tick was stopped. The pass for alpha had already finished on its own.');
  assert.doesNotMatch(text, /cancelled|interrupted/);
  // And when it really was cancelled, the entry says interrupted and the message names it.
  writeFileSync(`${p.schedulerState}/state.json`, state('running'));
  backend.tick = 'active';
  backend.onStop = () => { writeFileSync(`${p.schedulerState}/state.json`, state('interrupted', { reason: 'cancelled' })); };
  const r2 = await stopScheduling(backend, p);
  assert.deepEqual([r2.interrupted, r2.finished], [['alpha'], []]);
  assert.match(describeStop(r2), /Its pass for alpha was cancelled and recorded as interrupted\./);
});

test('off says the state is unknown, not that no tick ran, when the manager cannot be read before the stop', async t => {
  const out: string[] = [];
  t.mock.method(console, 'log', (l: string) => out.push(l));
  const { p } = home(t);
  const backend = new FakeSchedule(p);
  backend.timer = 'active'; backend.enabled = true;
  backend.fail.add('status');
  const { schedule } = await import('../src/commands/schedule.mts');
  await schedule(p, backend, 'off');
  assert.match(out.join('\n'), /could not be read before stopping \(Simulated status failure\), so Factory can't say whether a tick was running/);
  assert.doesNotMatch(out.join('\n'), /No tick was running/);
  assert.deepEqual(backend.calls.filter(c => c !== 'status'), ['disable', 'stop'], 'the stop itself still runs');
});

// ---- 5. A pass that exits and leaves members of its group running -----------------------------------------------------

const LEFTOVER = `import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const stubborn = existsSync(dir + 'stubborn');
// A non-detached child that outlives the dispatcher, in the dispatcher's group, and a detached ticket run in its own.
const leftover = stubborn ? spawn('sh', ['-c', 'trap "" TERM; while :; do sleep 1; done'], { stdio: 'ignore' }) : spawn('sleep', ['300'], { stdio: 'ignore' });
leftover.unref();
const ticket = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
ticket.unref();
writeFileSync(dir + 'left.json', JSON.stringify({ dispatcher: process.pid, leftover: leftover.pid, ticket: ticket.pid }));
process.exit(0);
`;
const left = (root: string): Record<'dispatcher' | 'leftover' | 'ticket', number> => JSON.parse(readFileSync(join(root, '.sandcastle/left.json'), 'utf8'));
async function leftoverProject(w: World, name: string, stubborn = false) {
  const root = repo(w.p, name, { script: '#!/bin/sh\n' });
  writeFileSync(join(root, '.sandcastle/leftover.mjs'), LEFTOVER);
  writeFileSync(join(root, '.sandcastle/dispatch.sh'), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/leftover.mjs" "$@"\n`, { mode: 0o755 });
  if (stubborn) writeFileSync(join(root, '.sandcastle/stubborn'), '');
  assert.equal((await cli(w, ['schedule', 'on', '--project', name])).code, 0);
  return root;
}

test('a pass that exits leaving a non-detached child has that group terminated and says so; the detached ticket run survives', async t => {
  const w = world(t);
  const root = await leftoverProject(w, 'alpha');
  await armed(w);
  const tk = startTick(w);
  assert.equal(await tk.exited, 0, tk.output());
  const ids = left(root);
  assert.equal(up(ids.leftover), false, 'the leftover member of the pass group was terminated');
  assert.equal(groupAlive(ids.dispatcher), false);
  assert.equal(up(ids.ticket), true, 'the detached ticket run was not touched');
  assert.match(tk.output(), /exited but left processes running in its process group \d+; terminating that group only/);
  assert.match(tk.output(), /pass alpha: exit 0 .*\(leftover processes terminated\)/);
  const st = readTickState(w.p).projects[root];
  assert.deepEqual([st.result, st.exitCode, st.reason], ['ok', 0, 'left processes running in its process group, terminated']);
  assert.equal(readLock(w.p), null, 'ownership is dropped only once the group is empty');
  // A second tick finds nothing running in the group and a free lock.
  rmSync(join(root, '.sandcastle/left.json'));
  const t2 = startTick(w);
  assert.equal(await t2.exited, 0);
  assert.match(t2.output(), /pass alpha: exit 0/);
  assert.equal(up(left(root).ticket), true);
});

test('a leftover that ignores SIGTERM is killed after the grace period (that group only); one that cannot be killed keeps ownership recorded', async t => {
  const w = world(t);
  const root = await leftoverProject(w, 'alpha', true);
  writeScheduleConfig(w.p, { path: process.env.PATH!, node: process.execPath });
  const backend = new FakeSchedule(w.p);
  backend.timer = 'active'; backend.enabled = true;
  const r = await tick(w.p, { backend, log: () => {}, cancel: { graceMs: 150, confirmMs: 1000 } });
  assert.equal(r.result, 'done');
  const ids = left(root);
  assert.equal(groupAlive(ids.dispatcher), false);
  assert.equal(up(ids.ticket), true, 'SIGKILL stayed inside the owned group');
  assert.match(readTickState(w.p).projects[root].reason!, /terminated with SIGKILL/);
  // Now signals that never arrive: the group stays alive, so the lock keeps the pass recorded and no pass starts over it.
  rmSync(join(root, '.sandcastle/left.json'));
  const r2 = await tick(w.p, { backend, log: () => {}, cancel: { graceMs: 100, confirmMs: 100, kill: () => {} } });
  assert.equal(r2.result, 'failed');
  const ids2 = left(root);
  assert.equal(r2.unconfirmed, ids2.dispatcher);
  assert.equal(groupAlive(ids2.dispatcher), true);
  assert.equal(readLock(w.p)!.pass!.pid, ids2.dispatcher, 'the live group is still recorded');
  const kept = readTickState(w.p).projects[root];
  assert.deepEqual([kept.result, kept.exitCode], ['ok', 0], 'the leader exited 0, so that is what is recorded, not interrupted');
  assert.ok(kept.finishedAt && kept.durationMs !== undefined && kept.durationMs >= 0, 'its observed finish time and duration are kept');
  assert.match(kept.reason!, /termination of leftover processes unconfirmed: process group \d+ is still running/);
  const ended = readHistory(w.p).slice(-2);
  assert.deepEqual(ended.map(x => [x.kind, x.result]), [['pass', 'ok'], ['tick', 'failed']], 'the history records what was observed, once');
  let started = false;
  const r3 = await tick(w.p, { backend, log: () => {}, pass: async () => { started = true; return 0; } });
  assert.equal(r3.result, 'busy');
  assert.equal(started, false, 'no pass starts while an owned group is alive');
  process.kill(-ids2.dispatcher, 'SIGKILL');
  await waitFor('the group to vanish', () => !groupAlive(ids2.dispatcher));
});

// ---- 6. Failed enable and partial installation, through the real CLI, production adapter and stub ----------------------

const mutating = (w: World) => w.stub.lines().filter(l => !l.startsWith('show '));
const tickUnits = (w: World) => readManifest(w.p)!.entries.filter(e => e.unit?.startsWith('factory-tick')).map(e => e.unit);

test('stub: a failed enable --now reports the manager state and keeps the ledger; a retry succeeds without duplicates', async t => {
  const w = world(t);
  await installed(w);
  const before = w.stub.calls().length;
  w.stub.fail('once:--user enable --now factory-tick.timer');
  const r = await cli(w, ['schedule', 'on']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /Scheduler state now: timer disabled\/inactive, tick service inactive/);
  assert.match(r.err, /ledger is kept; run factory schedule on again to retry/);
  assert.deepEqual(tickUnits(w), ['factory-tick.service', 'factory-tick.timer']);
  assert.doesNotMatch(readFileSync(w.p.scheduleConfig, 'utf8'), /enabled/i, 'no enabled member in schedule.json');
  assert.deepEqual(w.stub.calls().slice(before).filter(c => c[0] !== 'show').map(c => c.join(' ')), ['daemon-reload', 'enable --now factory-tick.timer'], 'the failed call is the last one made');
  assert.equal(w.stub.unit('factory-tick.timer').enabled, false);
  const mid = w.stub.calls().length;
  const retry = await cli(w, ['schedule', 'on']);
  assert.equal(retry.code, 0, retry.err);
  assert.deepEqual(w.stub.calls().slice(mid).filter(c => c[0] !== 'show').map(c => c.join(' ')), ['daemon-reload', 'enable --now factory-tick.timer']);
  assert.deepEqual(tickUnits(w), ['factory-tick.service', 'factory-tick.timer'], 'no duplicate ledger entries');
  assert.deepEqual([w.stub.unit('factory-tick.timer').enabled, w.stub.unit('factory-tick.timer').active], [true, true]);
  assert.deepEqual(w.stub.rejected(), []);
});

test('stub: a failed daemon-reload during on keeps both units ledgered, enables nothing, and uninstall removes both by exact identity', async t => {
  const w = world(t);
  await installed(w);
  const before = w.stub.calls().length;
  w.stub.fail('once:--user daemon-reload');
  const r = await cli(w, ['schedule', 'on']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /injected failure/);
  assert.deepEqual(w.stub.calls().slice(before).filter(c => c[0] !== 'show').map(c => c.join(' ')), ['daemon-reload'], 'enable is never attempted after a failed reload');
  assert.deepEqual(tickUnits(w), ['factory-tick.service', 'factory-tick.timer']);
  assert.equal(existsSync(w.p.tickService) && existsSync(w.p.tickTimer), true);
  assert.equal(w.stub.unit('factory-tick.timer').enabled, false);
  const mid = w.stub.calls().length;
  const u = await cli(w, ['uninstall']);
  assert.equal(u.code, 0, u.err);
  assert.deepEqual(w.stub.calls().slice(mid).filter(c => c[0] !== 'show').map(c => c.join(' ')).slice(0, 8), [
    'disable --now factory-tick.timer', 'stop factory-tick.service',
    'stop factory-tick.timer', 'disable factory-tick.timer', 'daemon-reload',
    'stop factory-tick.service', 'disable factory-tick.service', 'daemon-reload'], 'each unit is removed by its exact identity');
  assert.equal(existsSync(w.p.tickService) || existsSync(w.p.tickTimer), false);
  assert.deepEqual(w.stub.rejected(), []);
});

test('stub: schedule on twice makes the same two mutating calls each time, ledgers once, and the stub rejects nothing', async t => {
  const w = world(t);
  await installed(w);
  for (let i = 0; i < 2; i++) {
    const before = w.stub.calls().length;
    const r = await cli(w, ['schedule', 'on']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(w.stub.calls().slice(before).filter(c => c[0] !== 'show').map(c => c.join(' ')), ['daemon-reload', 'enable --now factory-tick.timer'], `run ${i + 1}`);
  }
  assert.deepEqual(tickUnits(w), ['factory-tick.service', 'factory-tick.timer']);
  assert.deepEqual(w.stub.rejected(), []);
});
