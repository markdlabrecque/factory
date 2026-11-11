// `factory status` tests: board service state, only the chosen project's runs with their stage (a dead process
// reads as stopped), the --json shape, and a service manager that can't be reached.
// Disposable HOME, Git repo and run-state folder; fake service backend, no tracker or Docker.
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
import { status } from '../src/commands/status.mts';

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
  const { home } = fixture(t);
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, '../bin/factory.mts'), 'status', ...args],
    { cwd: home, encoding: 'utf8', env: { ...process.env, FACTORY_HOME: home } });
  assert.match(cli('7', '--project', 'site').stderr, /Unexpected arguments/);
  assert.match(cli().stderr, /is not a registered project/);
  const ok = cli('--project', 'site', '--json');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).project.name, 'site');
});
