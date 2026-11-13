// `factory legacy status|retire` (#95) through the real CLI against stubs/systemctl with STUB_LEGACY=1 (the stub's legacy
// `disable --now` and its one effect Factory reads: the timer's timers.target.wants link goes). Status calls no manager;
// retire sends exactly one `disable --now` per enabled legacy timer, removes only the retired instances' env files, keeps
// the template units, unrelated timers and env files, reports a failed timer and keeps its env file. Systemd's own
// disable/stop behaviour is trusted (TESTING.md).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { factoryBin, home, repo, repoRoot, systemctlStub } from './schedule-helpers.mts';

function machine(t: TestContext) {
  const { p } = home(t, 'factory-legacy-');
  const stub = systemctlStub(t, p);
  const units = join(p.home, '.config/systemd/user');
  const wants = join(units, 'timers.target.wants');
  const conf = join(p.home, '.config/sandcastle/dispatch');
  mkdirSync(wants, { recursive: true });
  mkdirSync(conf, { recursive: true });
  for (const f of ['sandcastle-dispatch@.service', 'sandcastle-dispatch@.timer']) copyFileSync(join(repoRoot, 'orchestrator', f), join(units, f));
  writeFileSync(join(units, 'unrelated.timer'), '[Timer]\nOnCalendar=daily\n');
  symlinkSync('../unrelated.timer', join(wants, 'unrelated.timer'));
  const alpha = repo(p, 'alpha');
  const beta = repo(p, 'beta', { register: false });
  for (const [name, root] of [['alpha', alpha], ['beta', beta]]) {
    symlinkSync('../sandcastle-dispatch@.timer', join(wants, `sandcastle-dispatch@${name}.timer`));
    writeFileSync(join(conf, `${name}.env`), `SANDCASTLE_REPO="${root}"\nPATH="/usr/bin"\n`);
  }
  writeFileSync(join(conf, 'stale.env'), 'SANDCASTLE_REPO="/gone"\n');
  const cli = (...args: string[]) => new Promise<{ code: number | null; out: string; err: string }>(done => {
    const c = spawn(process.execPath, [factoryBin, ...args], { env: { ...process.env, FACTORY_HOME: p.home, ...stub.env, STUB_LEGACY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    c.on('exit', code => done({ code, out, err }));
  });
  return { p, stub, units, wants, conf, alpha, beta, cli };
}

test('legacy status lists each enabled timer with its checkout and registration, and calls no service manager', async t => {
  const m = machine(t);
  const r = await m.cli('legacy', 'status', '--json');
  assert.equal(r.code, 0, r.err);
  const s = JSON.parse(r.out);
  assert.deepEqual(s.timers.map((x: any) => [x.timer, x.repo, x.project]), [
    ['sandcastle-dispatch@alpha.timer', m.alpha, { name: 'alpha', scheduled: false }],
    ['sandcastle-dispatch@beta.timer', m.beta, null]]);
  const text = await m.cli('legacy', 'status');
  assert.match(text.out, /sandcastle-dispatch@beta\.timer .*not registered with Factory/);
  assert.match(text.out, /factory legacy retire/);
  assert.deepEqual(m.stub.lines(), []);
});

test('legacy retire disables only legacy timers, removes their env files, and keeps templates and unrelated files', async t => {
  const m = machine(t);
  const r = await m.cli('legacy', 'retire');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(m.stub.lines(), ['disable --now sandcastle-dispatch@alpha.timer', 'disable --now sandcastle-dispatch@beta.timer']);
  assert.deepEqual(m.stub.rejected(), []);
  for (const n of ['alpha', 'beta']) {
    assert.equal(existsSync(join(m.wants, `sandcastle-dispatch@${n}.timer`)), false);
    assert.equal(existsSync(join(m.conf, `${n}.env`)), false);
  }
  assert.match(r.out, new RegExp(`factory project add ${m.beta}`), 'points the unregistered checkout at project add');
  assert.equal(existsSync(join(m.conf, 'stale.env')), true, 'an env file with no enabled timer is not ours to remove');
  assert.equal(existsSync(join(m.units, 'sandcastle-dispatch@.timer')), true, 'template units stay for slice six');
  assert.equal(existsSync(join(m.wants, 'unrelated.timer')), true);
  assert.equal(m.stub.unit('factory-tick.timer').enabled, false, 'retire never arms the Factory scheduler');
  const again = await m.cli('legacy', 'retire');
  assert.equal(again.code, 0);
  assert.match(again.out, /Nothing to retire/);
  assert.equal(m.stub.lines().length, 2, 'a second retire sends nothing');
  assert.doesNotMatch((await m.cli('schedule', 'status')).out, /Legacy/);
});

test('legacy retire reports a timer it could not disable, keeps its env file, and still retires the others', async t => {
  const m = machine(t);
  m.stub.fail('--user disable --now sandcastle-dispatch@alpha.timer');
  const r = await m.cli('legacy', 'retire');
  assert.equal(r.code, 1);
  assert.match(r.err, /Could not retire sandcastle-dispatch@alpha\.timer/);
  assert.equal(existsSync(join(m.wants, 'sandcastle-dispatch@alpha.timer')), true);
  assert.equal(readFileSync(join(m.conf, 'alpha.env'), 'utf8').includes(m.alpha), true);
  assert.equal(existsSync(join(m.conf, 'beta.env')), false);
  m.stub.clearFail();
  const retry = await m.cli('legacy', 'retire');
  assert.equal(retry.code, 0, retry.err);
  assert.equal(existsSync(join(m.conf, 'alpha.env')), false);
});
