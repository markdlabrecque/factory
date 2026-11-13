// Scheduled passes preserve their environment and pass no --max override, leaving the cap to the project's dispatcher config (#117).
// The macOS scheduler (#35) across a stubbed launchd boundary. Factory's production launchd adapter
// (platform/scheduler-launchd.mts), its generated launch agent, the real supervisor (commands/supervise.mts, run as its own
// process through fixtures/supervisor.mts) and the real tick run against stubs/launchctl, a stateful, failure-injecting
// stand-in that records exact argv, models the label's enablement, loaded and running states separately, rejects calls
// Factory should not make, and, for `bootout`, does what launchd documents: SIGTERM to the job's process and a wait for it.
// It is a command stub, not launchd: these tests prove what Factory asks of launchd and in what order, the supervisor's
// own cadence and cancellation, and Factory's process handling on synthetic process trees. They do not prove that launchd
// loads agents at login, honours KeepAlive or ExitTimeOut, or writes the log file; that is trusted. They run on Linux:
// the adapter's commands are the same, and /proc gives the tick lock its start times.
import { test as nodeTest } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fake } from '../src/platform/fake.mts';
import { LaunchdSchedule, supervisorPlist } from '../src/platform/scheduler-launchd.mts';
import { isTickEntry } from '../src/platform/scheduler.mts';
import { install } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { schedule } from '../src/commands/schedule.mts';
import { supervise, FIRST_DELAY_MS, INTERVAL_MS } from '../src/commands/supervise.mts';
import { readManifest, validate } from '../src/manifest.mts';
import { readTickState } from '../src/schedule-state.mts';
import { setProjectSchedule } from '../src/schedule.mts';
import { acquireTickLock, groupAlive, readLock, sameProcess } from '../src/tick-lock.mts';
import { QUICK, held, heldScript, home, launchctlStub, repo } from './schedule-helpers.mts';

const test = (name: string, fn: (t: TestContext) => Promise<void> | void) => nodeTest(name, { timeout: 60_000 }, fn);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => T | undefined | false, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}
const up = (pid: number) => sameProcess({ pid, startTicks: null });
const SVC = 'gui/UID/com.factory.tick';
/** The calls that change launchd, without the read-only `print`s. */
const changes = (stub: ReturnType<typeof launchctlStub>) => stub.lines().filter(l => !l.startsWith('print'));
const supervisorFixture = fileURLToPath(new URL('fixtures/supervisor.mts', import.meta.url));

type World = ReturnType<typeof world>;
function world(t: TestContext) {
  const { p } = home(t, 'factory-macos-');
  const stub = launchctlStub(t, p);
  const cleanup: (() => void)[] = [];
  const logs: string[] = [];
  t.mock.method(console, 'log', (l: string) => logs.push(String(l)));
  t.mock.method(console, 'warn', () => {});
  t.after(() => {
    for (const fn of cleanup) fn();
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try { if (readlinkSync(`/proc/${name}/cwd`).startsWith(p.home)) process.kill(Number(name), 'SIGKILL'); } catch { /* gone, or not ours */ }
    }
  });
  return { p, stub, cleanup, logs, backend: new LaunchdSchedule(p), service: new Fake(p) };
}
const spec = (w: World) => ({ node: '/usr/local/bin/node', app: w.p.app, state: w.p.state, path: '/usr/bin:/bin' });
/** Installed (app linked to this checkout), with `projects` opted in, and the scheduler switched on through the adapter. */
async function armed(w: World, projects: string[] = []) {
  await install(w.p, w.service, { link: true });
  for (const root of projects) setProjectSchedule(w.p, root, true);
  await w.stub.using(() => schedule(w.p, w.backend, 'on'));
}
function heldProject(w: World, name: string) {
  const root = repo(w.p, name, { script: '#!/bin/sh\n' });
  writeFileSync(join(root, '.sandcastle/dispatch.sh'), heldScript(root), { mode: 0o755 });
  w.cleanup.push(() => { try { process.kill(held(root).ticket, 'SIGKILL'); } catch { /* not started or gone */ } });
  return root;
}
/** A real supervisor process, as launchd would run it, registered with the stub as the job's process. */
function startSupervisor(w: World) {
  const env = { PATH: w.stub.env.PATH, HOME: w.p.home, FACTORY_HOME: w.p.home, STUB_DIR: w.stub.env.STUB_DIR, STUB_AGENT_DIR: w.stub.env.STUB_AGENT_DIR, FIRST_MS: '50' };
  const child = spawn(process.execPath, [supervisorFixture], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', d => out += d); child.stderr!.on('data', d => out += d);
  const exited = new Promise<number | null>(done => child.on('exit', code => done(code)));
  w.cleanup.push(() => { try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ } });
  w.stub.set('com.factory.tick', { pid: child.pid });
  return { child, exited, output: () => out };
}

// ---- 1. The production adapter's contract with launchd ----------------------------------------------------------

test('adapter: install disables the unloaded label, writes and ledgers the plist and starts nothing; enable enables, then bootstraps', async t => {
  const w = world(t);
  const recorded: string[] = [];
  await w.stub.using(async () => {
    await w.backend.install(spec(w), e => { recorded.push(e.label!); assert.equal(existsSync(e.path), true, 'the plist is on disk when it is ledgered'); });
    assert.deepEqual(changes(w.stub), [`disable ${SVC}`], 'a plist on disk never loads by itself before on enables it');
    assert.deepEqual([w.stub.service().loaded, w.stub.service().disabled], [false, true]);
    await w.backend.enable();
  });
  assert.deepEqual(recorded, ['com.factory.tick']);
  assert.deepEqual(changes(w.stub), [`disable ${SVC}`, `enable ${SVC}`, `bootstrap gui/UID ${w.p.tickPlist}`]);
  assert.deepEqual([w.stub.service().disabled, w.stub.service().loaded, w.stub.service().running], [false, true, true]);
  // Repeating on while it runs neither disables nor restarts it; loaded but not running is kickstarted.
  await w.stub.using(async () => {
    const n = changes(w.stub).length;
    await w.backend.install(spec(w), () => {});
    await w.backend.enable();
    assert.deepEqual(changes(w.stub).slice(n), [`enable ${SVC}`], 'a running supervisor is left alone');
    w.stub.set('com.factory.tick', { running: false });
    await w.backend.enable();
    assert.deepEqual(changes(w.stub).slice(n + 1), [`enable ${SVC}`, `kickstart ${SVC}`]);
  });
  assert.deepEqual(w.stub.rejected(), []);
});

test('adapter: status reads enablement, loaded and running separately, and the tick from the lock; failures and odd output throw', async t => {
  const w = world(t);
  await w.stub.using(async () => {
    assert.deepEqual(await w.backend.status(), { timer: 'missing', enabled: false, loaded: false, tick: 'missing' });
    await w.backend.install(spec(w), () => {});
    assert.deepEqual(await w.backend.status(), { timer: 'inactive', enabled: false, loaded: false, tick: 'inactive' }, 'installed, disabled, not loaded');
    w.stub.set('com.factory.tick', { disabled: false, override: true, loaded: true });
    assert.deepEqual(await w.backend.status(), { timer: 'inactive', enabled: true, loaded: true, tick: 'inactive' }, 'enabled/loaded/not running');
    w.stub.set('com.factory.tick', { disabled: true, running: true });
    assert.deepEqual(await w.backend.status(), { timer: 'active', enabled: false, loaded: true, tick: 'inactive' }, 'disabled but still running');
    w.stub.setRoot({ oldFormat: true });
    assert.equal((await w.backend.status()).enabled, false, 'older macOS prints "=> true" for disabled');
    w.stub.set('com.factory.tick', { disabled: false });
    assert.equal((await w.backend.status()).enabled, true);
    const lock = acquireTickLock(w.p);
    assert.ok(!('busy' in lock));
    assert.equal((await w.backend.status()).tick, 'active', 'a live tick holding the lock');
    lock.release();
    w.stub.fail(`print gui/${process.getuid!()}`);
    await assert.rejects(w.backend.status(), /injected failure/, 'an unreachable domain is not "not loaded"');
    w.stub.fail(`print gui/${process.getuid!()}/com.factory.tick`);
    await assert.rejects(w.backend.status(), /injected failure/, 'only exit 113 means not loaded');
    w.stub.clearFail();
    writeFileSync(join(w.stub.bin, 'launchctl'), '#!/bin/sh\necho gibberish\n');
    await assert.rejects(w.backend.status(), /gave no/);
  });
});

test('adapter: disable disables the label before booting the agent out; a failed disable signals nothing; remove deletes only the plist', async t => {
  const w = world(t);
  await w.stub.using(async () => {
    await w.backend.disable();
    assert.deepEqual(changes(w.stub), [], 'nothing installed: no change');
    await w.backend.install(spec(w), () => {});
    await w.backend.enable();
    let n = changes(w.stub).length;
    await w.backend.disable();
    assert.deepEqual(changes(w.stub).slice(n), [`disable ${SVC}`, `bootout ${SVC}`]);
    assert.deepEqual([w.stub.service().disabled, w.stub.service().loaded], [true, false]);
    n = changes(w.stub).length;
    await w.backend.disable();
    assert.deepEqual(changes(w.stub).slice(n), [`disable ${SVC}`], 'repeating off is safe: nothing loaded to boot out');
    await w.backend.enable();
    w.stub.fail(`disable gui/${process.getuid!()}/com.factory.tick`);
    n = changes(w.stub).length;
    await assert.rejects(w.backend.disable(), /injected failure/);
    assert.equal(changes(w.stub).slice(n).some(l => l.startsWith('bootout')), false, 'never signalled while still enabled');
    w.stub.clearFail();
    w.stub.fail(`bootout gui/${process.getuid!()}/com.factory.tick`);
    await assert.rejects(w.backend.disable(), /injected failure/);
    assert.deepEqual([w.stub.service().disabled, w.stub.service().loaded], [true, true], 'disabled first; still loaded after the failed bootout');
    w.stub.clearFail();
    await assert.rejects(w.backend.remove({ kind: 'launchd', label: 'com.factory.board', path: w.p.launchd }), /Not the scheduler agent/);
    writeFileSync(w.p.launchd, 'board');
    await w.backend.remove({ kind: 'launchd', label: 'com.factory.tick', path: w.p.tickPlist });
    assert.deepEqual([existsSync(w.p.tickPlist), w.stub.service().loaded, existsSync(w.p.launchd)], [false, false, true]);
    await w.backend.remove({ kind: 'launchd', label: 'com.factory.tick', path: w.p.tickPlist });
  });
  assert.deepEqual(w.stub.rejected(), []);
});

test('plist: runs the supervisor with escaped paths; restarts only after a crash; signals only the supervisor; no interval or timeout keys', () => {
  const text = supervisorPlist({ node: '/opt/n & <n>/node', app: "/A'pp", state: '/s"t', path: '/p&q:/bin' }, '/h<o>me', '/s"t/scheduler/tick.log');
  assert.match(text, /<key>ProgramArguments<\/key><array><string>\/opt\/n &amp; &lt;n&gt;\/node<\/string><string>\/A&apos;pp\/cli\/bin\/factory\.mts<\/string><string>supervise<\/string><\/array>/);
  for (const re of [/<key>PATH<\/key><string>\/p&amp;q:\/bin<\/string>/, /<key>FACTORY_HOME<\/key><string>\/h&lt;o&gt;me<\/string>/, /<key>SANDCASTLE_STATE_DIR<\/key><string>\/s&quot;t<\/string>/,
    /<key>Label<\/key><string>com\.factory\.tick<\/string>/, /<key>RunAtLoad<\/key><true\/>/, /<key>KeepAlive<\/key><dict><key>SuccessfulExit<\/key><false\/><\/dict>/,
    /<key>AbandonProcessGroup<\/key><true\/>/, /<key>StandardOutPath<\/key><string>\/s&quot;t\/scheduler\/tick\.log<\/string>/]) assert.match(text, re);
  const exit = Number(text.match(/<key>ExitTimeOut<\/key><integer>(\d+)<\/integer>/)![1]);
  assert.ok(exit >= 30 + 5 + 2, 'launchd waits longer than the cancellation deadline before it SIGKILLs the supervisor');
  assert.doesNotMatch(text, /StartInterval|StartCalendarInterval|Disabled|@[A-Z]+@/);
  assert.doesNotMatch(text.replace(/<!--[^]*?-->/g, ''), /--/, 'no stray comment markers');
});

test('ledger: the agent validates only as com.factory.tick at its own path, and is a scheduler entry', t => {
  const { p } = home(t, 'factory-macos-');
  const entry = { kind: 'launchd' as const, label: 'com.factory.tick', path: p.tickPlist };
  validate(p, entry);
  assert.equal(isTickEntry(entry), true);
  assert.equal(isTickEntry({ kind: 'launchd', label: 'com.factory.board', path: p.launchd }), false);
  assert.throws(() => validate(p, { ...entry, path: p.launchd }), /Unsafe/);
  assert.throws(() => validate(p, { ...entry, label: 'com.factory.other' }), /Unsafe|Unexpected/);
  assert.throws(() => validate(p, { kind: 'launchd', label: 'com.factory.board', path: p.tickPlist }), /Unsafe/);
});

// ---- 2. The supervisor's cadence ------------------------------------------------------------------------------------

test('supervisor: first tick after a minute, then five minutes after each tick finishes; a failing tick does not stop it; abort ends it with 0', async () => {
  const events: string[] = [];
  const abort = new AbortController();
  let n = 0;
  const code = await supervise({} as never, {
    backend: {} as never, signal: abort.signal, log: () => {},
    wait: async ms => { events.push(`wait ${ms}`); if (n === 3) abort.abort(); return !abort.signal.aborted; },
    tick: async () => {
      n++; events.push(`tick ${n} start`); await sleep(30); events.push(`tick ${n} end`);
      if (n === 2) throw new Error('boom');
      return { result: 'done', passes: [], skipped: {}, errors: {} };
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(events, [`wait ${FIRST_DELAY_MS}`, 'tick 1 start', 'tick 1 end', `wait ${INTERVAL_MS}`, 'tick 2 start', 'tick 2 end',
    `wait ${INTERVAL_MS}`, 'tick 3 start', 'tick 3 end', `wait ${INTERVAL_MS}`], 'each wait starts only once the tick before it has finished');
  assert.deepEqual([FIRST_DELAY_MS, INTERVAL_MS], [60_000, 300_000]);
});

test('supervisor: an abort during a tick reaches the tick and no wait or tick follows; an abort before the first tick runs none', async () => {
  const events: string[] = [];
  const abort = new AbortController();
  const code = await supervise({} as never, {
    backend: {} as never, signal: abort.signal, log: () => {}, wait: async () => { events.push('wait'); return true; },
    tick: async (_p, o) => { events.push('tick'); abort.abort(); assert.equal(o.signal!.aborted, true); return { result: 'interrupted', passes: [], skipped: {}, errors: {} }; },
  });
  assert.deepEqual([code, events], [0, ['wait', 'tick']]);
  const early = new AbortController();
  const ticks: string[] = [];
  const t0 = Date.now();
  const p = supervise({} as never, { backend: {} as never, signal: early.signal, log: () => {}, firstDelayMs: 60_000, tick: async () => { ticks.push('tick'); return { result: 'done', passes: [], skipped: {}, errors: {} }; } });
  setTimeout(() => early.abort(), 20);
  assert.equal(await p, 0);
  assert.ok(Date.now() - t0 < 5000, 'the real wait ends at once on abort');
  assert.deepEqual(ticks, []);
});

test('supervisor: a tick that races with a disabled label sees it through launchd and starts no pass', async t => {
  const w = world(t);
  const root = repo(w.p, 'alpha', { script: QUICK });
  await armed(w, [root]);
  w.stub.set('com.factory.tick', { disabled: true });   // disabled, but the job is still loaded and running: the race window
  const abort = new AbortController();
  let ticks = 0;
  const lines: string[] = [];
  await w.stub.using(() => supervise(w.p, { backend: w.backend, signal: abort.signal, log: l => lines.push(l), firstDelayMs: 1, intervalMs: 1,
    wait: async () => { if (ticks === 2) abort.abort(); return !abort.signal.aborted; },
    tick: async (p, o) => { ticks++; const { tick } = await import('../src/commands/tick.mts'); return tick(p, o); } }));
  assert.equal(existsSync(join(root, '.sandcastle/ran')), false, 'no work while the label is disabled');
  assert.equal(lines.filter(l => /tick skipped: scheduler is off \(timer is running but disabled\)/.test(l)).length, 2, lines.join('\n'));
});

// ---- 3. The real supervisor, off, uninstall and reinstall on synthetic process trees ----------------------------------

test('off disables, then boots out: the supervisor cancels its held pass and nested analysis, exits 0, starts nothing else; the ticket run survives; uninstall follows', async t => {
  const w = world(t);
  const a = heldProject(w, 'alpha');
  const b = repo(w.p, 'beta', { script: QUICK });
  await armed(w, [a, b]);
  assert.deepEqual(changes(w.stub).slice(-2), [`enable ${SVC}`, `bootstrap gui/UID ${w.p.tickPlist}`]);
  const sup = startSupervisor(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  await waitFor('nested children', () => [pids.shell, pids.analysis, pids.ticket].every(up));
  assert.deepEqual([readLock(w.p)!.tick.pid, readLock(w.p)!.pass!.pid], [sup.child.pid, pids.dispatcher], 'the supervisor holds the lock and owns the pass group');
  await w.stub.using(async () => assert.equal((await w.backend.status()).tick, 'active'));
  const ran = JSON.parse(readFileSync(join(a, '.sandcastle/ran.log'), 'utf8').split('\n')[0]);
  assert.deepEqual([ran.argv, ran.stdin, ran.env.FACTORY_SCHEDULED, ran.env.SANDCASTLE_STATE_DIR], [[], '/dev/null', '1', w.p.state]);

  const n = changes(w.stub).length;
  assert.equal(await w.stub.using(() => schedule(w.p, w.backend, 'off')), 0);
  assert.deepEqual(changes(w.stub).slice(n), [`disable ${SVC}`, `bootout ${SVC}`], 'the label is disabled before the supervisor is signalled');
  assert.equal(await sup.exited, 0, `the supervisor exits successfully, so KeepAlive does not restart it\n${sup.output()}`);
  assert.equal(w.stub.service().killed, undefined, 'it exited on SIGTERM, without launchd having to kill it');
  for (const name of ['dispatcher', 'shell', 'analysis'] as const) assert.equal(up(pids[name]), false, `${name} is gone`);
  assert.equal(groupAlive(pids.dispatcher), false, 'the whole owned group is gone, including the analysis child');
  assert.equal(up(pids.ticket), true, 'the independently detached ticket run keeps going');
  assert.equal(existsSync(join(b, '.sandcastle/ran')), false, 'no later project started');
  const st = readTickState(w.p);
  assert.deepEqual([st.projects[a].result, st.projects[a].reason, typeof st.projects[a].durationMs], ['interrupted', 'cancelled', 'number']);
  assert.equal(typeof st.finishedAt, 'string', 'the interrupted tick still records its end and duration');
  assert.equal(st.projects[b], undefined);
  assert.equal(existsSync(w.p.tickLock), false);
  assert.match(w.logs.join('\n'), /Scheduler off: .*The active tick was stopped\. Its pass for alpha was cancelled and recorded as interrupted\./);
  assert.match(sup.output(), /supervisor stopping: cancelled; no further tick/);
  await w.stub.using(async () => assert.deepEqual(await w.backend.status(), { timer: 'inactive', enabled: false, loaded: false, tick: 'inactive' }));

  await w.stub.using(() => schedule(w.p, w.backend, 'status'));
  assert.match(w.logs.join('\n'), /Supervisor \(launchd com\.factory\.tick\): disabled, not loaded, not running; no tick running/);
  assert.match(w.logs.join('\n'), new RegExp(`Tick log: tail -f ${w.p.tickLog.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const m = changes(w.stub).length;
  await w.stub.using(() => uninstall(w.p, w.service, { schedule: w.backend }));
  assert.deepEqual(changes(w.stub).slice(m), [`disable ${SVC}`], 'nothing left to boot out');
  for (const path of [w.p.tickPlist, w.p.manifest]) assert.equal(existsSync(path), false, path);
  for (const keep of [w.p.projects, w.p.scheduleConfig, join(a, '.sandcastle/dispatch.sh')]) assert.equal(existsSync(keep), true, keep);
  assert.equal(up(pids.ticket), true, 'uninstall preserved the detached ticket run');
  assert.deepEqual(w.stub.rejected(), []);
});

test('a failed bootout or unconfirmed cancellation fails off and uninstall and keeps every file; a retry cancels', async t => {
  const w = world(t);
  const a = heldProject(w, 'alpha');
  await armed(w, [a]);
  const sup = startSupervisor(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  const kept = () => { for (const path of [w.p.tickPlist, w.p.manifest, w.p.app, w.p.scheduleConfig, w.p.tickLock]) assert.equal(existsSync(path), true, `${path} is kept`); };
  const manifest = readFileSync(w.p.manifest, 'utf8');

  w.stub.fail(`bootout gui/${process.getuid!()}/com.factory.tick`);
  await assert.rejects(w.stub.using(() => schedule(w.p, w.backend, 'off')), /injected failure/);
  await assert.rejects(w.stub.using(() => uninstall(w.p, w.service, { schedule: w.backend })), /injected failure/);
  assert.equal(w.stub.service().disabled, true, 'future activation was stopped first');
  assert.deepEqual([up(sup.child.pid!), up(pids.dispatcher)], [true, true], 'nothing was signalled');
  kept();
  w.stub.clearFail();

  // launchd's signal does not arrive and Factory's own signals are swallowed: cancellation cannot be confirmed.
  w.stub.set('com.factory.tick', { pid: undefined });
  const kill = () => { /* never arrives */ };
  await assert.rejects(w.stub.using(() => uninstall(w.p, w.service, { schedule: w.backend, cancel: { kill, graceMs: 50, confirmMs: 50 } })), /did not exit after SIGKILL/);
  assert.deepEqual([up(sup.child.pid!), up(pids.dispatcher)], [true, true]);
  assert.equal(readFileSync(w.p.manifest, 'utf8'), manifest, 'the ledger is untouched');
  kept();
  assert.equal(readLock(w.p)!.pass!.pid, pids.dispatcher, 'a retry still knows what to cancel');

  await w.stub.using(() => uninstall(w.p, w.service, { schedule: w.backend }));
  assert.equal(await sup.exited, 0);
  assert.equal(groupAlive(pids.dispatcher), false);
  assert.equal(up(pids.ticket), true);
  for (const path of [w.p.tickPlist, w.p.manifest]) assert.equal(existsSync(path), false, `${path} is removed only after cancellation was confirmed`);
  assert.equal(readTickState(w.p).projects[a].result, 'interrupted');
});

test('a failed bootstrap reports what launchd says and keeps the ledger; a retry enables once without duplicates', async t => {
  const w = world(t);
  await install(w.p, w.service, { link: true });
  w.stub.fail(`bootstrap gui/${process.getuid!()} ${w.p.tickPlist}`);
  await assert.rejects(w.stub.using(() => schedule(w.p, w.backend, 'on')), /injected failure[^]*Scheduler state now: supervisor enabled\/not loaded\/not running, tick inactive\. The unit ledger is kept/);
  assert.deepEqual(readManifest(w.p)!.entries.filter(isTickEntry).map(e => e.label), ['com.factory.tick']);
  w.stub.clearFail();
  await w.stub.using(() => schedule(w.p, w.backend, 'on'));
  assert.deepEqual(readManifest(w.p)!.entries.filter(isTickEntry).map(e => e.label), ['com.factory.tick']);
  assert.deepEqual([w.stub.service().disabled, w.stub.service().loaded, w.stub.service().running], [false, true, true]);
  assert.match(w.logs.join('\n'), /Timer now: supervisor enabled\/loaded\/running, tick inactive\./);
  assert.deepEqual(w.stub.rejected(), []);
});

test('reinstall stops the supervisor and cancels its tick before replacing files, and leaves the label disabled and unloaded', async t => {
  const w = world(t);
  const a = heldProject(w, 'alpha');
  await armed(w, [a]);
  const sup = startSupervisor(w);
  const pids = await waitFor('the held dispatcher', () => existsSync(join(a, '.sandcastle/held.json')) && held(a));
  writeFileSync(w.p.tickPlist, 'stale');
  const n = changes(w.stub).length;
  await w.stub.using(() => install(w.p, w.service, { link: true, schedule: w.backend }));
  assert.deepEqual(changes(w.stub).slice(n), [`disable ${SVC}`, `bootout ${SVC}`, `disable ${SVC}`], 'stopped first; the rewritten plist stays disabled');
  assert.equal(await sup.exited, 0);
  assert.equal(groupAlive(pids.dispatcher), false);
  assert.equal(up(pids.ticket), true);
  assert.match(readFileSync(w.p.tickPlist, 'utf8'), /<string>supervise<\/string>/, 'the plist was refreshed');
  assert.deepEqual([w.stub.service().disabled, w.stub.service().loaded], [true, false]);
  assert.match(w.logs.join('\n'), /The scheduler is off; .*Resume it with: factory schedule on$/);
  assert.equal(readTickState(w.p).projects[a].result, 'interrupted');
});
