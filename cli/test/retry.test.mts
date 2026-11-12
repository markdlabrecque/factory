// `factory retry` tests: it deletes only a stopped run's record (failed, or its process gone), refuses done, live and
// queued runs and a ticket without a record, and warns about a leftover `<ticket>-*` branch, which it keeps. Since #75 it
// refuses a card a recovery claim, a live launch claim or an unreadable admission record protects, and keeps receipts.
// Disposable HOME, Git repo and run-state folder; no tracker, Docker or service manager.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { retry } from '../src/commands/retry.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-retry-')));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  delete process.env.SANDCASTLE_STATE_DIR;
  t.after(() => { rmSync(home, { recursive: true, force: true }); if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const p = paths(home);
  const root = join(home, 'site');
  mkdirSync(join(root, '.sandcastle'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  writeFileSync(join(root, '.sandcastle/config.mts'), 'export const TRACKER = {\n  project: "me/site",\n};\n');
  addProject(p, realpathSync(root));
  mkdirSync(p.state, { recursive: true });
  const record = (iid: number, stage: string, pid = process.pid) => {
    const f = join(p.state, `me_site--${iid}.json`);
    const now = new Date().toISOString();
    writeFileSync(f, JSON.stringify({ iid: String(iid), project: 'me/site', stage, stageSince: now, startedAt: now, updatedAt: now, pid }));
    return f;
  };
  return { home, p, root, git, record };
}

test('clears a failed run, or one whose process is gone; warns about a leftover branch without deleting it', async t => {
  const { p, root, git, record } = fixture(t);
  const failed = record(4, 'stopped');
  await retry(p, '#4', { cwd: root });
  assert.equal(existsSync(failed), false);
  const dead = record(5, 'implementing', 2 ** 22 + 12345);
  git('branch', '5-thing');
  const lines: string[] = [];
  t.mock.method(console, 'log', (s: string) => lines.push(s));
  await retry(p, '5', { cwd: root });
  assert.equal(existsSync(dead), false);
  assert.match(lines.join('\n'), /exited without finishing[\s\S]*has: 5-thing/);
  assert.match(git('branch', '--list', '5-thing').toString(), /5-thing/);
});

test('refuses done, live and queued runs, and a ticket with no record', async t => {
  const { p, root, record } = fixture(t);
  const kept = [record(1, 'done'), record(2, 'implementing'), record(3, 'queued')];
  await assert.rejects(retry(p, '1', { cwd: root }), /#1 in site is finished/);
  await assert.rejects(retry(p, '2', { cwd: root }), /still running/);
  await assert.rejects(retry(p, '3', { cwd: root }), /queued/);
  await assert.rejects(retry(p, '9', { cwd: root }), /No run record for #9/);
  for (const f of kept) assert.equal(existsSync(f), true);
});

test('the CLI takes the ticket and --project, and rejects extra arguments', t => {
  const { home, record } = fixture(t);
  const f = record(6, 'stopped');
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, '../bin/factory.mts'), 'retry', ...args],
    { cwd: home, encoding: 'utf8', env: { ...process.env, FACTORY_HOME: home } });
  assert.match(cli('6', '7', '--project', 'site').stderr, /Unexpected arguments/);
  const ok = cli('6', '--project', 'site');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(existsSync(f), false);
});

test('refuses a stopped card an active or unknown claim protects, and keeps ownership receipts', async t => {
  const { p, root, record } = fixture(t);
  const { claimRun } = await import('../../board/board.mts');
  const { admissionFile, keyFor, readAdmission, writeDurable } = await import('../../board/admission.mts');
  // A recovery claim whose worker died with its container unconfirmed: the record reads stopped, the claim holds.
  const c = claimRun({ dir: p.state, project: 'me/site', iid: '4', pid: 2 ** 22 + 1, cap: 9, kind: 'recovery', attempt: 'a-1', patch: { stage: 'stopped', starting: undefined } });
  assert.equal(c.ok, true);
  const receipt = join(p.state, 'ownership', 'abc', '4.json');
  mkdirSync(join(p.state, 'ownership', 'abc'), { recursive: true });
  writeFileSync(receipt, '{}');
  await assert.rejects(retry(p, '4', { cwd: root }), /held by recovery attempt a-1/);
  assert.equal(existsSync(join(p.state, 'me_site--4.json')), true);
  // A launch claim whose owner still runs.
  const live = record(5, 'stopped');
  const s = readAdmission(p.state);
  s.claims[keyFor('5', 'me/site')] = { token: 't', project: 'me/site', iid: '5', kind: 'normal', owner: { pid: process.pid }, at: new Date().toISOString() };
  writeDurable(admissionFile(p.state), JSON.stringify(s));
  await assert.rejects(retry(p, '5', { cwd: root }), /claimed by process/);
  assert.equal(existsSync(live), true);
  // An unreadable admission record: unknown, refused.
  writeFileSync(admissionFile(p.state), '{nope');
  await assert.rejects(retry(p, '5', { cwd: root }), /claim is unknown/);
  // A dead launch claim does not protect; clearing keeps the receipt.
  s.claims[keyFor('5', 'me/site')].owner = { pid: 2 ** 22 + 2 };
  writeDurable(admissionFile(p.state), JSON.stringify(s));
  t.mock.method(console, 'log', () => {});
  await retry(p, '5', { cwd: root });
  assert.equal(existsSync(live), false);
  assert.equal(existsSync(receipt), true, 'receipts are kept');
});
