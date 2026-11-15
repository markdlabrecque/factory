// `factory run` tests: it runs the chosen project's dispatch.sh with --issue <n> from the checkout root, against
// Factory's run-state folder, returns its exit code, and refuses an older dispatch.sh without --issue. Then the
// real orchestrator/dispatch.sh --issue, with stub tools on the PATH (no tracker, Docker or agent): it runs
// main.mts for that ticket in the foreground, logs to .sandcastle/logs/run-<n>.log, and rejects pass-only flags.
// The curl stub drains the piped dummy auth header before returning, avoiding SIGPIPE under dispatch.sh's pipefail.
import { projectFixture } from './workflow-fixture.mts';
import { factoryToml } from './config-fixture.mts';
import { bindExecution } from './execution-fixture.mts';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
    writeFileSync(join(root, '.sandcastle/factory.toml'), factoryToml(`me/${dir}`));
    mkdirSync(join(root, '.factory-workflow'), { recursive: true });
    writeFileSync(join(root, '.factory-workflow/dispatch.sh'), script, { mode: 0o755 });
    projectFixture(p, root);
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

test('bad tickets and a stale complete override fail before anything runs', async t => {
  const { p, project } = fixture(t);
  const a = project('a', `#!/usr/bin/env bash\ntouch "$PWD/called"\n`);
  await assert.rejects(run(p, 'abc', { cwd: a }), /Expected a ticket number/);
  await assert.rejects(run(p, undefined, { cwd: a }), /Expected a ticket number/);
  writeFileSync(join(a, '.factory-workflow/dispatch.sh'), '#!/bin/sh\nexit 99\n');
  await assert.rejects(run(p, '15', { cwd: a }), /identity mismatch/);
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
  tool('pi', 'test "$*" = "auth check --provider openai"');
  tool('curl', 'while IFS= read -r _; do :; done; printf 400');
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}\nimport { capabilityDocker } from ${JSON.stringify(join(import.meta.dirname, '../../orchestrator/fixtures/capability-docker.mjs'))};\nconst a = process.argv.slice(2); if (a[0] === 'info') process.exit(0); const out = capabilityDocker(a, ${JSON.stringify(home)}); if (out === undefined) process.exit(90); console.log(out);`, { mode: 0o755 });
  tool('npx', `printf '%s\\n' "$*" > "$PWD/npx-called"; echo "run output"; exit 4`);
  const origin = join(home, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const root = join(home, 'site');
  mkdirSync(join(root, '.sandcastle'), { recursive: true });
  copyFileSync(join(import.meta.dirname, '../../orchestrator/dispatch.sh'), join(root, '.sandcastle/dispatch.sh'));
  copyFileSync(join(import.meta.dirname, '../../orchestrator/capabilities.mts'), join(root, '.sandcastle/capabilities.mts'));
  copyFileSync(join(import.meta.dirname, '../../board/admission.mts'), join(root, '.sandcastle/admission.mts'));
  copyFileSync(join(import.meta.dirname, '../../board/execution-events.mts'), join(root, '.sandcastle/execution-events.mts'));
  writeFileSync(join(root, '.sandcastle/dispatch.mts'), '');
  writeFileSync(join(root, '.sandcastle/factory.toml'), factoryToml('me/site', { kind: 'gitlab', host: 'gitlab.example' }));
  writeFileSync(join(root, '.sandcastle/main.mts'), 'const CONFIG = {\n  image: "site-image",\n};\n');
  writeFileSync(join(root, '.sandcastle/.env'), 'CLAUDE_CODE_OAUTH_TOKEN=x\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'dev');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'dev');
  const runtime = bindExecution(root, process.env, { overlays: false, install: dir => {
    writeFileSync(join(dir, 'node_modules/tsx/dist/cli.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(process.cwd()+'/bundled-called',process.argv.slice(2).join(' ')); console.log('run output'); process.exit(4);`);
  } });
  const sh = (...args: string[]) => spawnSync(join(runtime.directory, 'dispatch.sh'), args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...runtime.env, PATH: `${bin}:${process.env.PATH}`, SANDCASTLE_STATE_DIR: join(home, 'state') },
  });
  return { root, sh, runtime };
}

test('dispatch.sh --issue runs main.mts for that ticket after the checks, logging to run-<n>.log', t => {
  const { root, sh, runtime } = sandcastleProject(t);
  const r = sh('--issue', '15', '--no-push');
  assert.equal(r.status, 4, r.stderr);
  assert.equal(readFileSync(join(root, 'bundled-called'), 'utf8').trim(), `${join(runtime.directory, 'main.mts')} --base dev --issue 15 --no-push`);
  assert.equal(existsSync(join(root, 'npx-called')), false);
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
