// #153: copied scaffolds include continuation/checkpoint helpers and admission-fenced writers.
// #149: fresh and repaired copies include dependency evaluation.
// #150: fresh and repaired scaffolds include the required verification proof helper.
// V2 TOML/parser and policy assets ship together. Ticket tiers never require model tracker labels.
// Init tests: scaffold contents, no-clobber, rerun repair, failure-doesn't-register, wrapper quoting, shared
// state, uninstall's treatment of projects, and that every module a scaffolded file imports is scaffolded,
// including refresh.mts, the independent assessment store (#78) and journal projection (#101-#102).
// Disposable HOME and Git repos; no network, service manager or credentials.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { Fake } from '../src/platform/fake.mts';
import { install } from './runtime-fixture.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { init } from '../src/commands/init.mts';
import { readRegistry } from '../src/projects.mts';
import { buildAssets } from '../src/scaffold.mts';
import { bindExecution } from './execution-fixture.mts';
import { readReview, recoveryCopyProblem } from '../src/recovery-review.mts';

const personal = { profile: 'personal', repo: 'me/site', image: 'sandcastle-site' };
const client = { profile: 'client', repo: 'group/sub/site', image: 'sandcastle-client', host: 'git.example.com', 'project-id': '42' };
const EXPECTED = ['.env', '.env.example', '.gitignore', 'factory-dispatch.sh', 'factory.toml'].sort();

function fixture(t: TestContext, homeName = 'home') {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-init-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, homeName);
  mkdirSync(home);
  const repo = (name = 'proj') => {
    const dir = join(base, name);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return realpathSync(dir);
  };
  return { base, home, p: paths(home), repo };
}
async function quiet<T>(fn: () => Promise<T>): Promise<{ out: string; result?: T; error?: unknown }> {
  const log = console.log; let out = '';
  console.log = (...a: unknown[]) => { out += a.join(' ') + '\n'; };
  try { const result = await fn(); return { out, result }; } catch (error) { return { out, error }; } finally { console.log = log; }
}
const files = (root: string) => readdirSync(join(root, '.sandcastle'), { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(join(root, '.sandcastle').length + 1)).sort();
const mode = (path: string) => statSync(path).mode & 0o777;

test('clean personal init creates exactly the allowlist, no client bootstrap, safe defaults, and registers', async t => {
  const { p, repo } = fixture(t);
  const root = repo();
  const { error, out } = await quiet(() => init(p, root, personal));
  assert.equal(error, undefined);
  assert.deepEqual(files(root), EXPECTED);
  const s = (f: string) => join(root, '.sandcastle', f);
  assert.equal(mode(s('.env')), 0o600);
  assert.equal(readFileSync(s('.env'), 'utf8'), '');
  assert.equal(mode(s('factory-dispatch.sh')) & 0o111, 0o111);
  const settings = loadTomlConfig(join(root, '.sandcastle'));
  assert.equal(settings.config.image, 'sandcastle-site');
  assert.deepEqual(settings.config.sandboxSetup, []);
  for (const f of EXPECTED.filter(f => f.endsWith('.mts') || f.endsWith('.md') || f.endsWith('.example'))) {
    assert.doesNotMatch(readFileSync(s(f), 'utf8'), /islandhealth|composer install|start-web\.sh \/home|\/opt\/sandcastle\/bootstrap-site/, f);
  }
  assert.match(readFileSync(s('.gitignore'), 'utf8'), /worktrees\//);
  const example = readFileSync(s('.env.example'), 'utf8');
  assert.doesNotMatch(example, /OPENAI|sk-/);
  assert.deepEqual(readRegistry(p).projects.map(x => x.root), [root]);
  assert.match(out, /Not ready to run an agent yet/);
  assert.equal(existsSync(join(root, '.sandcastle/sandbox')), false, 'no Drupal sandbox helpers copied');
});

test('generated runtimes derive model tiers and preserve tracker and merge policy', async t => {
  const { p, repo } = fixture(t);
  const a = repo('a'); const b = repo('b');
  await quiet(() => init(p, a, personal));
  await quiet(() => init(p, b, client));
  const settings = (root: string) => {
    const runtime = bindExecution(root);
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `const c=await import(${JSON.stringify(join(runtime.directory, 'runtime-config.mts'))}); console.log(JSON.stringify({...c,labels:c.allLabels()}));`], { cwd: root, env: runtime.env, encoding: 'utf8' }));
  };
  const pc = settings(a);
  assert.equal(pc.TRACKER.kind, 'github');
  assert.equal(pc.TRACKER.project, 'me/site');
  assert.equal(pc.TRACKER.milestone, undefined);
  assert.equal(pc.AGENT.provider, 'pi');
  assert.equal(pc.AGENT.family, 'openai');
  assert.equal(pc.AGENT.thinking, 'high');
  assert.deepEqual(pc.AGENT.modelAliases, { small: 'openai/gpt-6-luna', mid: 'openai/gpt-6.1-terra', large: 'openai/gpt-6.1-sol' });
  assert.ok(!pc.labels.some((l: string) => l.startsWith('model:')));
  assert.equal(pc.AGENT.model, 'openai/gpt-6.1-sol');
  assert.equal(pc.GRAPH.model, 'openai/gpt-6.1-terra');
  assert.equal(pc.MERGE.auto, true);
  const cc = settings(b);
  assert.deepEqual([cc.TRACKER.kind, cc.TRACKER.gitlabHost, cc.TRACKER.project, cc.TRACKER.projectId, cc.TRACKER.milestone], ['gitlab', 'git.example.com', 'group/sub/site', 42, undefined]);
  assert.equal(cc.AGENT.provider, 'pi');
  assert.equal(cc.AGENT.family, 'openai');
  assert.deepEqual(cc.AGENT, pc.AGENT);
  assert.equal(cc.GRAPH.model, pc.GRAPH.model);
  assert.equal(cc.MERGE.auto, false);
  assert.match(readFileSync(join(b, '.sandcastle/.env.example'), 'utf8'), /Authenticate Pi/);
});

test('rerun keeps existing bytes and modes, fills gaps, reports skips, never duplicates the registry', async t => {
  const { p, repo } = fixture(t);
  const root = repo();
  await quiet(() => init(p, root, personal));
  const s = (f: string) => join(root, '.sandcastle', f);
  writeFileSync(s('factory.toml'), readFileSync(s('factory.toml'), 'utf8') + '\n# retained\n');
  writeFileSync(s('.gitignore'), 'node_modules\n');
  rmSync(s('.env.example'));
  const { out, error } = await quiet(() => init(p, root, { ...client }));
  assert.equal(error, undefined);
  assert.match(readFileSync(s('factory.toml'), 'utf8'), /# retained/);
  assert.ok(existsSync(s('.env.example')));
  assert.match(out, /Created 1 file/);
  assert.match(out, /Add: \.env evidence\/ state\/ logs\/ board\.html/);
  assert.equal(readRegistry(p).projects.length, 1);
});

test('invalid input, symlink escape and type conflicts fail before any write or registration', async t => {
  const { p, repo, base } = fixture(t);
  const root = repo();
  const bad: Record<string, any>[] = [
    {}, { ...personal, profile: 'team' }, { ...personal, repo: 'noslash' }, { ...personal, repo: 'a/b/c' }, { ...personal, image: 'Bad Image' },
    { ...personal, host: 'x.example.com' }, { ...client, host: undefined }, { ...client, 'project-id': '0' }, { ...client, 'project-id': '4x' },
  ];
  for (const o of bad) assert.ok((await quiet(() => init(p, root, o))).error, JSON.stringify(o));
  assert.equal(existsSync(join(root, '.sandcastle')), false);

  const outside = join(base, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(root, '.sandcastle'));
  assert.match(String((await quiet(() => init(p, root, personal))).error), /symlink/);
  assert.deepEqual(readdirSync(outside), []);
  rmSync(join(root, '.sandcastle'));

  mkdirSync(join(root, '.sandcastle/.env'), { recursive: true });
  assert.match(String((await quiet(() => init(p, root, personal))).error), /in the way/);
  assert.deepEqual(readdirSync(join(root, '.sandcastle')), ['.env'], 'preflight failed before the first write');
  rmSync(join(root, '.sandcastle'), { recursive: true });

  writeFileSync(join(root, '.sandcastle'), 'a file');
  assert.match(String((await quiet(() => init(p, root, personal))).error), /Expected a directory/);
  assert.equal(existsSync(p.projects), false, 'nothing registered');
});

test('a mid-copy failure leaves a repairable scaffold and does not register; rerun repairs; a registered project stays registered', async t => {
  const { p, repo } = fixture(t);
  const root = repo();
  const stop = (_: string, i: number) => { if (i === 3) throw new Error('disk full (simulated)'); };
  const failed = await quiet(() => init(p, root, personal, { beforeWrite: stop }));
  assert.match(String(failed.error), /disk full/);
  assert.equal(files(root).length, 3);
  assert.equal(existsSync(p.projects), false);
  const ok = await quiet(() => init(p, root, personal));
  assert.equal(ok.error, undefined);
  assert.deepEqual(files(root), EXPECTED);
  assert.equal(readRegistry(p).projects.length, 1);
  rmSync(join(root, '.sandcastle/.env.example'));
  assert.ok((await quiet(() => init(p, root, personal, { beforeWrite: () => { throw new Error('again'); } }))).error);
  assert.equal(readRegistry(p).projects.length, 1, 'stays registered');
});

test('wrapper forwards canonical project and literal arguments', async t => {
  const { p, repo, base } = fixture(t);
  const root = repo("pro j'ect");
  await quiet(() => init(p, root, personal));
  const bin = join(base, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'factory'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  const res = spawnSync(join(root, '.sandcastle/factory-dispatch.sh'), ['--ticket', 'a b', "$(touch nope)"], { cwd: base, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.stdout.trimEnd().split('\n'), ['dispatch', '--project', root, '--ticket', 'a b', '$(touch nope)']);
  assert.equal(existsSync(join(base, 'nope')), false);
});

test('uninstall lists project scaffolds but never deletes them; purge removes only Factory config and state', async t => {
  const { p, repo, base } = fixture(t, "ho'me");
  const root = repo();
  await quiet(() => init(p, root, personal));
  const service = new Fake(p);
  await install(p, service);
  const bin = join(base, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'docker'), 0o755);
  const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; });
  const before = files(root);
  const plain = await quiet(() => uninstall(p, service));
  assert.match(plain.out, /Project scaffold, not removed: .*\.sandcastle/);
  assert.ok(plain.out.includes(`rm -rf '${join(root, '.sandcastle')}'`));
  assert.ok(existsSync(p.projects), 'default uninstall keeps the registry');
  await install(p, service);
  const purged = await quiet(() => uninstall(p, service, { purge: true }));
  assert.match(purged.out, /Project scaffold, not removed/, 'listed before the registry is purged');
  assert.equal(existsSync(p.projects), false);
  assert.equal(existsSync(p.config), false);
  assert.deepEqual(files(root), before);
  assert.ok(lstatSync(root).isDirectory());
});

test('scaffold assets resolve from the installed app, not the working directory', () => {
  const cwd = process.cwd();
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'factory-cwd-')));
  try {
    process.chdir(tmp);
    assert.equal(buildAssets({ profile: 'personal', repo: 'a/b', image: 'x' }, '/s').length, EXPECTED.length);
  } finally { process.chdir(cwd); rmSync(tmp, { recursive: true, force: true }); }
});

test('unsupported existing config is not rewritten or registered', async t => {
  const { p, repo } = fixture(t); const root = repo();
  mkdirSync(join(root, '.sandcastle'));
  writeFileSync(join(root, '.sandcastle/factory.toml'), 'version = 1\n');
  assert.match(String((await quiet(() => init(p, root, personal))).error), /manually migrate/);
  assert.deepEqual(readdirSync(join(root, '.sandcastle')), ['factory.toml']);
  assert.equal(existsSync(p.projects), false);
});

test('a racing creator is never overwritten or registered', async t => {
  const { p, repo } = fixture(t); const root = repo();
  const result = await quiet(() => init(p, root, personal, { beforeWrite: (path, index) => {
    if (index === 0) { mkdirSync(join(root, '.sandcastle'), { recursive: true }); writeFileSync(join(root, path), 'racer'); }
  } }));
  assert.ok(result.error);
  assert.equal(readFileSync(join(root, '.sandcastle/factory.toml'), 'utf8'), 'racer');
  assert.equal(existsSync(p.projects), false);
});
