// Rehearsal of the single-machine scheduler cutover (#38, docs/scheduler-cutover.md) across the stubbed systemd boundary.
// It walks the runbook's steps in order on a disposable HOME that looks like a machine still on install-dispatch.sh: an
// enabled legacy `sandcastle-dispatch@alpha.timer` (template units, its timers.target.wants link and its env file), an
// unrelated enabled timer, a project whose `.sandcastle` copy predates launch reservations, a current one and one that is
// never opted in. Factory's real CLI runs against stubs/systemctl WITHOUT legacy support, so any call Factory made to a
// legacy unit would be rejected; only the developer's own step (the legacy installer's `--uninstall`) runs with
// STUB_LEGACY=1. What this proves: Factory reports legacy timers and never touches them, refuses a stale copy until the
// shipped files are copied in, and arms only its own timer once the legacy one is gone; rollback leaves the opt-ins.
// It does not prove systemd's own disable/stop behaviour, which is trusted (TESTING.md).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRegistry } from '../src/projects.mts';
import { factoryBin, home, repo, repoRoot, systemctlStub } from './schedule-helpers.mts';

type World = { p: ReturnType<typeof home>['p']; stub: ReturnType<typeof systemctlStub> };
function cli(w: World, args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise(done => {
    const c = spawn(process.execPath, [factoryBin, ...args], { env: { ...process.env, FACTORY_HOME: w.p.home, ...w.stub.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    c.on('exit', code => done({ code, out, err }));
  });
}
const json = async (w: World) => { const r = await cli(w, ['schedule', 'status', '--json']); assert.equal(r.code, 0, r.err); return JSON.parse(r.out); };

/** What install-dispatch.sh left on a machine for project `name`, plus an unrelated enabled timer. */
function legacyMachine(t: TestContext, w: World, name: string, root: string) {
  const units = join(w.p.home, '.config/systemd/user');
  const wants = join(units, 'timers.target.wants');
  mkdirSync(wants, { recursive: true });
  for (const f of ['sandcastle-dispatch@.service', 'sandcastle-dispatch@.timer']) copyFileSync(join(repoRoot, 'orchestrator', f), join(units, f));
  symlinkSync('../sandcastle-dispatch@.timer', join(wants, `sandcastle-dispatch@${name}.timer`));
  writeFileSync(join(units, 'unrelated.timer'), '[Timer]\nOnCalendar=daily\n');
  symlinkSync('../unrelated.timer', join(wants, 'unrelated.timer'));
  const conf = join(w.p.home, '.config/sandcastle/dispatch');
  mkdirSync(conf, { recursive: true });
  writeFileSync(join(conf, `${name}.env`), `SANDCASTLE_REPO="${root}"\nPATH="/usr/bin"\n`);
  return { units, wants, env: join(conf, `${name}.env`) };
}

test('cutover rehearsal: report legacy timers, remove them by hand, refresh the copy, opt in, arm; Factory never touches legacy units', { timeout: 60_000 }, async t => {
  const { p } = home(t, 'factory-cutover-');
  const w: World = { p, stub: systemctlStub(t, p) };
  const alpha = repo(p, 'alpha', { current: false });
  repo(p, 'beta');
  repo(p, 'gamma');
  const legacy = legacyMachine(t, w, 'alpha', alpha);
  assert.equal((await cli(w, ['install', '--link'])).code, 0);

  // 1. Inventory: the legacy timer is reported with the exact command, and nothing is armed yet.
  let s = await json(w);
  assert.deepEqual(s.legacyTimers, ['sandcastle-dispatch@alpha.timer']);
  assert.equal(s.scheduler.serviceEnabled, false);
  assert.match((await cli(w, ['schedule', 'status'])).out, /systemctl --user disable --now sandcastle-dispatch@alpha\.timer/);

  // 2. A stale copy cannot be opted in, and the refusal changes nothing.
  const refused = await cli(w, ['schedule', 'on', '--project', 'alpha']);
  assert.notEqual(refused.code, 0);
  assert.match(refused.err, /predates launch reservations/);
  assert.equal(readRegistry(p).projects.find(x => x.name === 'alpha')!.schedule, undefined);

  // 3. The developer removes the legacy timer (the runbook's command; Factory never runs it).
  execFileSync(join(repoRoot, 'orchestrator/install-dispatch.sh'), ['--uninstall', 'alpha'],
    { env: { ...process.env, HOME: p.home, ...w.stub.env, STUB_LEGACY: '1' }, stdio: 'ignore' });
  assert.equal(existsSync(join(legacy.wants, 'sandcastle-dispatch@alpha.timer')), false);
  assert.equal(existsSync(legacy.env), false);
  assert.equal(existsSync(join(legacy.wants, 'unrelated.timer')), true, 'unrelated timers stay');
  assert.equal(existsSync(join(legacy.units, 'sandcastle-dispatch@.timer')), true, 'template units stay for slice six');

  // 4. The developer refreshes the copy from this checkout's shipped files, then opts the projects in.
  copyFileSync(join(repoRoot, 'orchestrator/dispatch.mts'), join(alpha, '.sandcastle/dispatch.mts'));
  copyFileSync(join(repoRoot, 'board/board.mts'), join(alpha, '.sandcastle/board.mts'));
  for (const name of ['alpha', 'beta']) { const r = await cli(w, ['schedule', 'on', '--project', name]); assert.equal(r.code, 0, r.err); }
  assert.equal(w.stub.unit('factory-tick.timer').enabled, false, 'opting projects in never arms the timer');

  // 5. Arm the one scheduler: no legacy warning, and only Factory's own timer is enabled.
  const before = w.stub.lines().length;
  const on = await cli(w, ['schedule', 'on']);
  assert.equal(on.code, 0, on.err);
  assert.doesNotMatch(on.out + on.err, /Legacy/);
  assert.deepEqual(w.stub.lines().slice(before).filter(l => !l.startsWith('show ')), ['daemon-reload', 'enable --now factory-tick.timer']);
  s = await json(w);
  assert.deepEqual(s.legacyTimers, []);
  assert.deepEqual([s.scheduler.serviceEnabled, s.scheduler.timerActive], [true, true]);
  const blocker = (name: string) => s.projects.find((x: { name: string }) => x.name === name).blocker;
  assert.deepEqual([blocker('alpha'), blocker('beta'), blocker('gamma')], [null, null, 'project not opted in']);

  // 6. Rollback path: off disables Factory's timer and keeps the opt-ins and saved branches.
  const off = await cli(w, ['schedule', 'off']);
  assert.equal(off.code, 0, off.err);
  assert.deepEqual([w.stub.unit('factory-tick.timer').enabled, w.stub.unit('factory-tick.timer').active], [false, false]);
  assert.deepEqual(readRegistry(p).projects.filter(x => x.schedule?.enabled).map(x => [x.name, x.schedule!.branch]), [['alpha', 'main'], ['beta', 'main']]);

  // Factory made no call naming a legacy unit (it would have been rejected); the one legacy call was the developer's.
  assert.deepEqual(w.stub.rejected(), []);
  assert.deepEqual(w.stub.lines().filter(l => l.includes('sandcastle-dispatch')), ['disable --now sandcastle-dispatch@alpha.timer']);
  assert.equal(readFileSync(join(legacy.units, 'unrelated.timer'), 'utf8'), '[Timer]\nOnCalendar=daily\n');
});
