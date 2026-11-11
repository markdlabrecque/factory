// `factory dispatch` tests: it runs the chosen project's own dispatch.sh from the checkout root, with the
// flags passed through and Factory's run-state folder, and returns its exit code. A stub dispatch.sh stands in
// for the real one; no tracker, Docker or service manager.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { dispatch } from '../src/commands/dispatch.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-dispatch-')));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  delete process.env.SANDCASTLE_STATE_DIR;
  t.after(() => { rmSync(home, { recursive: true, force: true }); if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const p = paths(home);
  const project = (dir: string, exit = 0) => {
    const root = join(home, dir);
    mkdirSync(join(root, '.sandcastle'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.sandcastle/config.mts'), `export const TRACKER = {\n  project: "me/${dir}",\n};\n`);
    writeFileSync(join(root, '.sandcastle/dispatch.sh'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$PWD" "$SANDCASTLE_STATE_DIR" "$*" > "$PWD/called"\nexit ${exit}\n`, { mode: 0o755 });
    addProject(p, realpathSync(root));
    return realpathSync(root);
  };
  return { home, p, project };
}
const called = (root: string) => readFileSync(join(root, 'called'), 'utf8').split('\n').slice(0, 3);

test('runs the current project\'s dispatch.sh from its root, with the flags and Factory\'s state folder', async t => {
  const { p, project } = fixture(t);
  const a = project('a');
  mkdirSync(join(a, 'sub'));
  assert.equal(await dispatch(p, { cwd: join(a, 'sub'), dryRun: true, max: '3', wholeIssues: true }), 0);
  assert.deepEqual(called(a), [a, p.state, '--dry-run --max 3 --whole-issues']);
});

test('--project picks another project; SANDCASTLE_STATE_DIR from the caller wins; the exit code comes back', async t => {
  const { home, p, project } = fixture(t);
  const a = project('a');
  const b = project('b', 7);
  process.env.SANDCASTLE_STATE_DIR = join(home, 'elsewhere');
  assert.equal(await dispatch(p, { cwd: a, project: 'b' }), 7);
  assert.deepEqual(called(b), [b, join(home, 'elsewhere'), '']);
});

test('a bad --max or an unregistered folder fails before anything runs', async t => {
  const { home, p, project } = fixture(t);
  const a = project('a');
  await assert.rejects(dispatch(p, { cwd: a, max: '0' }), /--max needs a positive whole number/);
  await assert.rejects(dispatch(p, { cwd: home }), /not a registered project/);
  assert.throws(() => readFileSync(join(a, 'called')));
});
