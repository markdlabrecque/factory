// Scheduled self-recovery end to end across restarts and failures (#64, the acceptance step of #30's slice four). Every
// tick is a fresh process (cli/test/fixtures/tick-recovery.mts: `factory tick` as the service runs it, with only the repair
// command swapped for a stand-in) against the stateful systemctl stub, so nothing carries over between ticks but Factory's
// files. The dispatcher is a real dispatch.sh that reports a jam on stopped #7; jam confirmation, the launcher, settling,
// `factory schedule off|on` and `factory recovery review|reset` are the real code. The repair stand-in runs detached as the
// launcher starts it, creates its exact container in a docker stub (exact-name `rm -f` and `container inspect` only;
// anything else is rejected) and waits; the test crashes it, or finishes it as main.mts would by writing the attempt record.
// It proves: a jam needs two completed passes and a dead tick's pass never counts; a running repair survives the tick that
// launched it and `schedule off` cancelling a later tick, and is never doubled; off launches nothing; a crashed repair whose
// container docker cannot confirm gone keeps the project held across ticks; once confirmed it settles as interrupted and
// the second attempt starts; after two the budget stops repairs across restarts; reset launches nothing and confirmation
// starts over; the ticket's commits, dirty work and evidence are never touched. Not proven: systemd's timer, real Docker,
// main.mts --recover itself (orchestrator/recovery-entrypoint.test.mts), a real agent or tracker.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyFor, readAdmission } from '../../board/admission.mts';
import { claimRun, readRuns } from '../../board/board.mts';
import { readAttemptRecord, writeAttemptRecord } from '../../orchestrator/recovery.mts';
import type { AttemptRecord } from '../../orchestrator/recovery.mts';
import { readRecovery } from '../src/recovery-state.mts';
import { groupOf, sameProcess } from '../src/tick-lock.mts';
import { factoryBin, git, home, repo, systemctlStub } from './schedule-helpers.mts';

const fixtureTick = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/tick-recovery.mts');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => T | undefined | false, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}
const up = (pid: number) => sameProcess({ pid, startTicks: null });

// The dispatcher: reports a jam on #7 for its pass, then holds the pass open while .sandcastle/hold exists.
const DISPATCH = `#!/bin/sh
d="$(dirname "$0")"
printf '{"version":1,"pass":"%s","project":"site/site","at":"%s","tickets":[7],"observed":[]}' "$FACTORY_PASS_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$FACTORY_JAM_REPORT"
if [ -e "$d/hold" ]; then echo $$ > "$d/pass.pid"; sleep 300; fi
exit 0
`;
// docker: exact-name `rm -f <name>` (a no-op while stuck/<name> exists) and `container inspect --format {{.Name}} <name>`; anything else is rejected.
const DOCKER = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const D = process.env.DOCKER_STUB_DIR, a = process.argv.slice(2), name = a[a.length - 1], f = path.join(D, 'containers', name);
const ok = (a.length === 3 && a[0] === 'rm' && a[1] === '-f') || (a.length === 5 && a[0] === 'container' && a[1] === 'inspect' && a[2] === '--format' && a[3] === '{{.Name}}');
fs.appendFileSync(path.join(D, 'calls.jsonl'), JSON.stringify({ argv: a, ...(ok ? {} : { rejected: true }) }) + '\\n');
if (!ok) { console.error('docker stub: rejected ' + a.join(' ')); process.exit(64); }
if (a[0] === 'rm') { if (!fs.existsSync(path.join(D, 'stuck', name))) fs.rmSync(f, { force: true }); process.exit(0); }
if (fs.existsSync(f)) { console.log('/' + name); process.exit(0); }
console.error('Error: No such container: ' + name); process.exit(1);
`;
// The repair stand-in for \`npx tsx .sandcastle/main.mts --recover\`: records itself, creates its exact container, waits.
const REPAIR = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const a = process.argv.slice(2), rec = a[a.indexOf('--attempt-record') + 1];
fs.writeFileSync(path.join(process.env.DOCKER_STUB_DIR, 'containers', 'factory-recovery-' + path.basename(rec, '.json')), '');
fs.appendFileSync('.sandcastle/repairs.jsonl', JSON.stringify({ pid: process.pid, args: a }) + '\\n');
setInterval(() => {}, 1000);
`;

function world(t: TestContext) {
  const { p } = home(t, 'factory-recovery-sched-');
  const stub = systemctlStub(t, p);
  const docker = join(p.home, 'docker');
  for (const d of ['containers', 'stuck']) mkdirSync(join(docker, d), { recursive: true });
  writeFileSync(join(stub.bin, 'docker'), DOCKER); chmodSync(join(stub.bin, 'docker'), 0o755);
  const npx = join(p.home, 'repair-stub');
  writeFileSync(npx, REPAIR); chmodSync(npx, 0o755);
  const env = { ...stub.env, FACTORY_HOME: p.home, HOME: p.home, DOCKER_STUB_DIR: docker };
  t.after(() => {
    // Every process this test started (ticks, dispatchers, repair stand-ins) runs under its HOME.
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try { if (readlinkSync(`/proc/${name}/cwd`).startsWith(p.home)) process.kill(Number(name), 'SIGKILL'); } catch { /* gone, or not ours */ }
    }
  });
  const run = (cmd: string, args: string[]) => new Promise<{ code: number | null; out: string }>(done => {
    const c = spawn(process.execPath, [cmd, ...args], { env: { ...process.env, ...env }, cwd: p.home, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('exit', code => done({ code, out }));
  });
  /** `factory …` to completion. */
  const cli = async (...args: string[]) => { const r = await run(factoryBin, args); assert.equal(r.code, 0, `factory ${args.join(' ')}: ${r.out}`); return r.out; };
  /** One tick in its own process, as the service starts it (a controlled environment, no shell profile). */
  const startTick = () => {
    const c = spawn(process.execPath, [fixtureTick], { env: { PATH: stub.env.PATH, HOME: p.home, FACTORY_HOME: p.home, STUB_DIR: stub.env.STUB_DIR,
      STUB_UNIT_DIR: stub.env.STUB_UNIT_DIR, DOCKER_STUB_DIR: docker, RECOVERY_NPX: npx }, cwd: p.home, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    return { child: c, exited: new Promise<number | null>(done => c.on('exit', code => done(code))), output: () => out };
  };
  const tick = async () => { const k = startTick(); const code = await k.exited; return { code, out: k.output() }; };
  const dockerCalls = (): { argv: string[]; rejected?: boolean }[] =>
    existsSync(join(docker, 'calls.jsonl')) ? readFileSync(join(docker, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  return { p, stub, docker, cli, tick, startTick, dockerCalls };
}

test('scheduled recovery stays safe across tick restarts, schedule off, a crashed repair, an unconfirmed container, a spent budget and reset', { timeout: 120_000 }, async t => {
  const w = world(t);
  const { p } = w;
  await w.cli('install', '--link');
  await w.cli('schedule', 'on');
  const root = repo(p, 'site', { script: DISPATCH });
  const sc = join(root, '.sandcastle');
  writeFileSync(join(sc, 'config.mts'), 'export const TRACKER = {\n  kind: "github",\n  host: "github.com",\n  project: "site/site",\n};\n');
  // The complete recovery workflow (board.mts keeps what the scheduler's copy check needs), reviewed by a person.
  writeFileSync(join(sc, 'main.mts'), 'parseArgs({ options: { recover: { type: "string" }, "attempt-record": { type: "string" } } });\n');
  for (const f of ['recovery.mts', 'recovery-sandbox.mts', 'handoff.mts', 'ownership.mts', 'admission.mts', 'prompt.recover.md', 'prompt.verify.md']) writeFileSync(join(sc, f), '');
  // The ticket's preserved work: a commit and uncommitted changes in its Factory worktree, and earlier evidence.
  git(root, 'branch', '7-fix-login');
  const worktree = join(sc, 'worktrees/7-fix-login');
  git(root, 'worktree', 'add', '-q', worktree, '7-fix-login');
  git(worktree, 'commit', '-q', '--allow-empty', '-m', 'half done');
  writeFileSync(join(worktree, 'wip.txt'), 'uncommitted\n');
  const evidence = join(sc, 'evidence/7');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'before-1.png'), 'old evidence');
  const tip = execFileSync('git', ['rev-parse', '7-fix-login'], { cwd: root, encoding: 'utf8' }).trim();
  claimRun({ dir: p.state, project: 'site/site', iid: '7', pid: 2 ** 22 + 4321, cap: 99,
    patch: { stage: 'stopped', note: 'exited', starting: undefined, branch: '7-fix-login', base: 'main', evidenceDir: evidence } });
  await w.cli('schedule', 'on', '--project', 'site');
  await w.cli('recovery', 'review', '--project', 'site', '--confirm');

  const recovery = () => readRecovery(p, root);
  const repairs = (): { pid: number; args: string[] }[] =>
    existsSync(join(sc, 'repairs.jsonl')) ? readFileSync(join(sc, 'repairs.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const claim = () => readAdmission(p.state).claims[keyFor('7', 'site/site')];
  const recoveryLines = (out: string) => out.split('\n').filter(l => l.startsWith('recovery site:')).join('\n');

  // 1. One completed pass only sees the jam.
  let r = await w.tick();
  assert.equal(r.code, 0, r.out);
  assert.match(recoveryLines(r.out), /jam on #7 seen \(1 of 2 passes\)/);

  // 2. A tick that dies mid-pass (after its dispatcher wrote a report) never counts that pass. The dead tick's pass group
  //    is gone too, as after a reboot; the next tick clears its leftovers.
  writeFileSync(join(sc, 'hold'), '');
  const dying = w.startTick();
  const passPid = await waitFor('the held pass', () => existsSync(join(sc, 'pass.pid')) && Number(readFileSync(join(sc, 'pass.pid'), 'utf8')));
  assert.equal(readdirSync(join(p.schedulerState, 'jam')).length, 1, 'its dispatcher wrote the pass\'s report');
  dying.child.kill('SIGKILL');
  await dying.exited;
  try { process.kill(-passPid, 'SIGKILL'); } catch { /* gone */ }
  await waitFor('the dead pass group to go', () => !up(passPid));
  rmSync(join(sc, 'hold')); rmSync(join(sc, 'pass.pid'));
  assert.equal(recovery().episode?.passes.length, 1, 'the dead tick\'s pass was not counted');

  // 3. A fresh tick: the second completed pass confirms the jam and starts exactly one detached repair.
  r = await w.tick();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /recovered state from an interrupted tick/);
  assert.match(recoveryLines(r.out), /jam on #7 confirmed; attempt 1 on #7 started/);
  assert.equal(repairs().length, 1);
  const first = repairs()[0];
  assert.deepEqual(first.args.slice(0, 8), ['tsx', '.sandcastle/main.mts', '--issue', '7', '--base', 'main', '--recover', '1']);
  assert.ok(up(first.pid), 'the repair outlives the tick that launched it');
  assert.equal(groupOf(first.pid), first.pid, 'in its own process group');
  assert.equal(claim()?.owner.pid, first.pid, 'its recovery claim belongs to the repair process');

  // 4. `schedule off` while a tick's pass runs cancels that tick and pass only: the repair keeps going, holds its claim,
  //    and nothing else is launched.
  writeFileSync(join(sc, 'hold'), '');
  const held = w.startTick();
  await waitFor('the held pass', () => existsSync(join(sc, 'pass.pid')));
  const off = await w.cli('schedule', 'off');
  assert.match(off, /Scheduler off/);
  assert.equal(await held.exited, 143, held.output());
  assert.equal(recoveryLines(held.output()), '', 'a cancelled pass is not handed to recovery');
  rmSync(join(sc, 'hold')); rmSync(join(sc, 'pass.pid'));
  assert.ok(up(first.pid), 'off never reaches the detached repair');
  assert.equal(claim()?.owner.pid, first.pid);
  r = await w.tick();
  assert.match(r.out, /tick skipped: scheduler is off/);
  assert.equal(repairs().length, 1);
  assert.deepEqual(recovery().attempts.map(a => a.result), ['running']);

  // 5. Back on, while the repair runs: passes are not counted and no second repair starts.
  await w.cli('schedule', 'on');
  r = await w.tick();
  assert.match(recoveryLines(r.out), /attempt 1 on #7 is running; pass not counted/);
  assert.equal(repairs().length, 1);

  // 6. The repair crashes and docker cannot confirm its exact container gone: the attempt stays running and the claim
  //    holds the ticket, a slot and the project, tick after tick.
  const container = `factory-recovery-${basename(first.args.at(-1)!, '.json')}`;
  writeFileSync(join(w.docker, 'stuck', container), '');
  process.kill(first.pid, 'SIGKILL');
  await waitFor('the repair to die', () => !up(first.pid));
  for (let i = 0; i < 2; i++) {
    r = await w.tick();
    assert.equal(r.code, 0, r.out);
    assert.match(recoveryLines(r.out), /still present after docker rm -f.*pass not counted/);
  }
  assert.deepEqual(recovery().attempts.map(a => a.result), ['running']);
  assert.equal(claim()?.kind, 'recovery', 'the dead repair\'s claim is kept until its container is confirmed gone');
  assert.equal(repairs().length, 1);

  // 7. Once docker confirms it gone, the attempt settles as interrupted and the unchanged jam gets its second attempt.
  rmSync(join(w.docker, 'stuck', container));
  r = await w.tick();
  assert.match(recoveryLines(r.out), /attempt 1 on #7 ended: interrupted/);
  assert.match(recoveryLines(r.out), /attempt 2 on #7 started/);
  assert.equal(repairs().length, 2);
  const second = repairs()[1];

  // 8. The second attempt fails (main.mts records it, leaves the run stopped and exits). The budget then stops repairs, across restarts.
  const record = second.args.at(-1)!;
  const rec = (readAttemptRecord(record) as { record: AttemptRecord }).record;
  writeAttemptRecord(record, { ...rec, phase: 'finished', outcome: 'failed', reason: 'tests still fail', finishedAt: new Date().toISOString() });
  const runFile = join(p.state, `${keyFor('7', 'site/site')}.json`);
  writeFileSync(runFile, JSON.stringify({ ...JSON.parse(readFileSync(runFile, 'utf8')), stage: 'stopped', note: 'recovery attempt 2: tests still fail' }));
  rmSync(join(w.docker, 'containers', `factory-recovery-${basename(record, '.json')}`));
  process.kill(second.pid, 'SIGTERM');
  await waitFor('the second repair to exit', () => !up(second.pid));
  r = await w.tick();
  assert.match(recoveryLines(r.out), /attempt 2 on #7 ended: failed/);
  assert.match(recoveryLines(r.out), /used its 2 recovery attempts/);
  r = await w.tick();
  assert.match(recoveryLines(r.out), /used its 2 recovery attempts/);
  assert.equal(repairs().length, 2, 'no third attempt');
  assert.equal(claim(), undefined, 'settled attempts release their claim');
  assert.deepEqual(recovery().attempts.map(a => a.result), ['interrupted', 'failed']);

  // 9. Reset renews the budget but launches nothing; confirmation starts over on the next completed passes.
  await w.cli('recovery', 'reset', '--project', 'site');
  assert.equal(repairs().length, 2, 'reset never launches');
  r = await w.tick();
  assert.match(recoveryLines(r.out), /jam on #7 seen \(1 of 2 passes\)/);
  r = await w.tick();
  assert.match(recoveryLines(r.out), /attempt 3 on #7 started/);
  assert.equal(repairs().length, 3);

  // Throughout: the ticket's work is untouched, docker only ever named the attempts' own containers, and no call to the
  // service manager or docker was rejected.
  assert.equal(execFileSync('git', ['rev-parse', '7-fix-login'], { cwd: root, encoding: 'utf8' }).trim(), tip);
  assert.equal(readFileSync(join(worktree, 'wip.txt'), 'utf8'), 'uncommitted\n');
  assert.ok(existsSync(join(evidence, 'before-1.png')));
  assert.equal(readRuns(p.state).find(x => x.iid === '7')?.branch, '7-fix-login');
  const own = new Set(repairs().map(x => `factory-recovery-${basename(x.args.at(-1)!, '.json')}`));
  assert.deepEqual(w.dockerCalls().filter(c => c.rejected || !own.has(c.argv.at(-1)!)), []);
  assert.deepEqual(w.stub.rejected(), []);
});
