// Run lookup tests: which project a command targets, and which run records and logs are that project's.
// Disposable HOME, Git repos and state folder; no tracker, Docker or service manager.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { findRun, projectRuns, resolveProject, runLog, ticketId } from '../src/runs.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-runs-')));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  delete process.env.SANDCASTLE_STATE_DIR;
  t.after(() => { rmSync(home, { recursive: true, force: true }); if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const p = paths(home);
  const project = (dir: string, tracker?: string) => {
    const root = join(home, dir);
    mkdirSync(join(root, '.sandcastle'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    if (tracker) writeFileSync(join(root, '.sandcastle/config.mts'), `export const TRACKER = {\n  kind: "github",\n  project: "${tracker}", // factory:project\n};\n`);
    addProject(p, realpathSync(root));
    return realpathSync(root);
  };
  const record = (key: string, run: object) => {
    mkdirSync(p.state, { recursive: true });
    writeFileSync(join(p.state, `${key}.json`), JSON.stringify({ startedAt: '2026-11-10T00:00:00Z', pid: process.pid, ...run }));
  };
  return { home, p, project, record };
}

test('project is the registered checkout you stand in, or --project by name or path; anything else names the choices', t => {
  const { home, p, project } = fixture(t);
  const site = project('work/site', 'me/site');
  project('other/site', 'me/site-two');
  const shop = project('shop', 'me/shop');
  mkdirSync(join(shop, 'sub'));
  assert.equal(resolveProject(p, { cwd: join(shop, 'sub') }).root, shop);
  assert.equal(resolveProject(p, { cwd: shop }).tracker, 'me/shop');
  assert.equal(resolveProject(p, { project: 'shop', cwd: home }).root, shop);
  assert.throws(() => resolveProject(p, { project: 'site' }), /Several registered projects are named site/);
  assert.equal(resolveProject(p, { project: site, cwd: shop }).tracker, 'me/site', '--project wins over cwd');
  assert.throws(() => resolveProject(p, { cwd: home }), /not a registered project.*--project.*Registered: /);
  assert.throws(() => resolveProject(p, { project: 'nope' }), /No registered project nope/);
  const bare = project('bare');
  assert.throws(() => resolveProject(p, { cwd: bare }), /factory init/);
});

test('runs are the project\'s own records; a crashed run reads as stopped without rewriting it; logs follow dispatch.mts', t => {
  const { p, project, record } = fixture(t);
  const root = project('site', 'me/site');
  record('me_site--7', { iid: '7', project: 'me/site', stage: 'done', startedAt: '2026-11-10T02:00:00Z' });
  record('me_site--5', { iid: '5', project: 'me/site', stage: 'implementing', pid: 2 ** 22 + 12345 });
  record('me_other--7', { iid: '7', project: 'me/other', stage: 'stopped' });
  writeFileSync(join(p.state, 'broken.json'), '{');
  const ctx = resolveProject(p, { cwd: root });
  assert.deepEqual(projectRuns(p, ctx).map(r => [r.iid, r.stage]), [['5', 'stopped'], ['7', 'done']]);
  const { file, run } = findRun(p, ctx, '#5');
  assert.equal(file, join(p.state, 'me_site--5.json'));
  assert.match(run!.note!, /exited without finishing \(last stage: implementing\)/);
  assert.match(execFileSync('cat', [file], { encoding: 'utf8' }), /"implementing"/, 'record untouched');
  assert.equal(findRun(p, ctx, '9').run, undefined);
  assert.equal(runLog(ctx, '#7'), join(root, '.sandcastle/logs/run-7.log'));
  assert.throws(() => ticketId('abc'), /Expected a ticket number/);
  process.env.SANDCASTLE_STATE_DIR = join(p.home, 'elsewhere');
  assert.deepEqual(projectRuns(p, ctx), [], 'SANDCASTLE_STATE_DIR wins, as in factory-dispatch.sh');
});
