// `factory logs` tests: which log file is shown, and -f picking up appended and truncated output.
// Disposable HOME and Git repo; no tracker, Docker, journalctl or service manager.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { logs } from '../src/commands/logs.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-logs-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const p = paths(home);
  const root = join(home, 'site');
  mkdirSync(join(root, '.sandcastle/logs'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.sandcastle/config.mts'), 'export const TRACKER = {\n  project: "me/site",\n};\n');
  addProject(p, realpathSync(root));
  const log = (n: number, text: string, age = 0) => {
    const f = join(root, '.sandcastle/logs', `run-${n}.log`);
    writeFileSync(f, text);
    const t = new Date(Date.now() - age * 1000);
    utimesSync(f, t, t);
    return f;
  };
  let out = '';
  const write = (b: Buffer) => { out += b.toString(); };
  return { home, p, root, log, write, out: () => out };
}

test('shows the ticket\'s log, or the newest one without a ticket; a missing log names the file', async t => {
  const { p, root, log, write, out } = fixture(t);
  log(7, 'seven\n', 60);
  log(12, 'twelve\n');
  await logs(p, '#7', { cwd: root, write });
  assert.equal(out(), 'seven\n');
  await logs(p, undefined, { cwd: root, write });
  assert.equal(out(), 'seven\ntwelve\n');
  await assert.rejects(logs(p, '9', { cwd: root, write }), /No log for #9 in site yet: .*run-9\.log/);
});

test('-f prints what is appended, starts over after truncation, and stops when interrupted', async t => {
  const { p, root, log, write, out } = fixture(t);
  const f = log(5, 'start\n');
  const stop = new AbortController();
  const done = logs(p, '5', { cwd: root, write, follow: true, pollMs: 10, signal: stop.signal });
  const until = async (want: string) => { for (let i = 0; i < 200 && out() !== want; i++) await sleep(10); assert.equal(out(), want); };
  await until('start\n');
  appendFileSync(f, 'more\n');
  await until('start\nmore\n');
  truncateSync(f, 0);
  await sleep(50);
  appendFileSync(f, 'again\n');
  await until('start\nmore\nagain\n');
  stop.abort();
  await done;
});

test('the CLI takes the ticket, --project and rejects extra arguments', t => {
  const { home, log } = fixture(t);
  log(3, 'three\n');
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, '../bin/factory.mts'), 'logs', ...args],
    { cwd: home, encoding: 'utf8', env: { ...process.env, FACTORY_HOME: home } });
  assert.equal(cli('3', '--project', 'site').stdout, 'three\n');
  assert.match(cli('3', '4', '--project', 'site').stderr, /Unexpected arguments/);
  assert.match(cli('3').stderr, /not a registered project/);
});
