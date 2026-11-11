// `factory run` tests: it runs the chosen project's dispatch.sh with --issue <n> from the checkout root, against
// Factory's run-state folder, returns its exit code, and refuses an older dispatch.sh without --issue. Then the
// real orchestrator/dispatch.sh --issue, with stub tools on the PATH (no tracker, Docker or agent): it runs
// main.mts for that ticket in the foreground, logs to .sandcastle/logs/run-<n>.log, and rejects pass-only flags.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { run } from '../src/commands/run.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-run-')));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  delete process.env.SANDCASTLE_STATE_DIR;
  t.after(() => { rmSync(home, { recursive: true, force: true }); if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const p = paths(home);
  const project = (dir: string, script: string) => {
    const root = join(home, dir);
    mkdirSync(join(root, '.sandcastle'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.sandcastle/config.mts'), `export const TRACKER = {\n  project: "me/${dir}",\n};\n`);
    writeFileSync(join(root, '.sandcastle/dispatch.sh'), script, { mode: 0o755 });
    addProject(p, realpathSync(root));
    return realpathSync(root);
  };
  return { home, p, project };
}
const stub = (exit = 0) => `#!/usr/bin/env bash\n# takes --issue N\nprintf '%s\\n' "$PWD" "$SANDCASTLE_STATE_DIR" "$*" > "$PWD/called"\nexit ${exit}\n`;
const called = (root: string) => readFileSync(join(root, 'called'), 'utf8').split('\n').slice(0, 3);

test('runs dispatch.sh --issue <n> from the project root with Factory\'s state folder; the exit code comes back', async t => {
  const { p, project } = fixture(t);
  const a = project('a', stub());
  const b = project('b', stub(3));
  mkdirSync(join(a, 'sub'));
  assert.equal(await run(p, '#15', { cwd: join(a, 'sub') }), 0);
  assert.deepEqual(called(a), [a, p.state, '--issue 15']);
  assert.equal(await run(p, '7', { cwd: a, project: 'b' }), 3);
  assert.deepEqual(called(b), [b, p.state, '--issue 7']);
});

test('a bad ticket or an older dispatch.sh without --issue fails before anything runs', async t => {
  const { p, project } = fixture(t);
  const a = project('a', `#!/usr/bin/env bash\ntouch "$PWD/called"\n`);
  await assert.rejects(run(p, 'abc', { cwd: a }), /Expected a ticket number/);
  await assert.rejects(run(p, undefined, { cwd: a }), /Expected a ticket number/);
  await assert.rejects(run(p, '15', { cwd: a }), /older copy without --issue/);
  assert.throws(() => readFileSync(join(a, 'called')));
});

// The real dispatch.sh in a checkout whose checks all pass against stubs.
function sandcastleProject(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-dispatch-sh-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const tool = (name: string, body: string) => writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  for (const name of ['npm', 'glab']) tool(name, '');
  tool('claude', `echo '{"loggedIn": true}'`);
  tool('curl', 'printf 400');
  tool('docker', `[ "$1" = image ] && id -u; exit 0`);
  tool('npx', `printf '%s\\n' "$*" > "$PWD/npx-called"; echo "run output"; exit 4`);
  const origin = join(home, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const root = join(home, 'site');
  mkdirSync(join(root, '.sandcastle'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@ai-hero/sandcastle'), { recursive: true });
  copyFileSync(join(import.meta.dirname, '../../orchestrator/dispatch.sh'), join(root, '.sandcastle/dispatch.sh'));
  writeFileSync(join(root, '.sandcastle/dispatch.mts'), '');
  writeFileSync(join(root, '.sandcastle/config.mts'), 'export const TRACKER = {\n  gitlabHost: "gitlab.example",\n  project: "me/site",\n};\n');
  writeFileSync(join(root, '.sandcastle/main.mts'), 'const CONFIG = {\n  image: "site-image",\n};\n');
  writeFileSync(join(root, '.sandcastle/.env'), 'CLAUDE_CODE_OAUTH_TOKEN=x\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'dev');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'dev');
  const sh = (...args: string[]) => spawnSync(join(root, '.sandcastle/dispatch.sh'), args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SANDCASTLE_STATE_DIR: join(home, 'state') },
  });
  return { root, sh };
}

test('dispatch.sh --issue runs main.mts for that ticket after the checks, logging to run-<n>.log', t => {
  const { root, sh } = sandcastleProject(t);
  const r = sh('--issue', '15', '--no-push');
  assert.equal(r.status, 4, r.stderr);
  assert.equal(readFileSync(join(root, 'npx-called'), 'utf8').trim(), 'tsx .sandcastle/main.mts --base dev --issue 15 --no-push');
  assert.match(r.stdout, /run output/);
  assert.match(readFileSync(join(root, '.sandcastle/logs/run-15.log'), 'utf8'), /run output/);
});

test('dispatch.sh rejects a bad --issue, and pass-only flags with --issue, before the checks', t => {
  const { root, sh } = sandcastleProject(t);
  for (const [args, message] of [[['--issue', 'x'], /--issue needs a ticket number/], [['--issue'], /--issue needs a ticket number/],
    [['--issue=15', '--dry-run'], /--dry-run is for a dispatcher pass/], [['--max', '2', '--issue', '15'], /--max is for a dispatcher pass/]] as const) {
    const r = sh(...args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, message);
  }
  assert.throws(() => readFileSync(join(root, 'npx-called')));
});
