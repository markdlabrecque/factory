// #149: fresh and repaired copies include dependency evaluation.
// #150: fresh and repaired scaffolds include the required verification proof helper.
// #137: TOML/offline parser assets and explicit legacy migration compatibility.
// #126: personal scaffolds ship description aliases and never require model tracker labels.
// Init tests: scaffold contents, no-clobber, rerun repair, failure-doesn't-register, wrapper quoting, shared
// state, uninstall's treatment of projects, and that every module a scaffolded file imports is scaffolded,
// including refresh.mts, the independent assessment store (#78) and journal projection (#101-#102).
// Disposable HOME and Git repos; no network, service manager or credentials.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths } from '../src/paths.mts';
import { Fake } from '../src/platform/fake.mts';
import { install } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { init } from '../src/commands/init.mts';
import { readRegistry } from '../src/projects.mts';
import { buildAssets } from '../src/scaffold.mts';
import { readReview, recoveryCopyProblem } from '../src/recovery-review.mts';

const personal = { profile: 'personal', repo: 'me/site', image: 'sandcastle-site' };
const client = { profile: 'client', repo: 'group/sub/site', image: 'sandcastle-client', host: 'git.example.com', 'project-id': '42' };
// #149: the shared dependency helper is mandatory in fresh and repaired copies.
const EXPECTED = ['dependencies.mts', 'verification.mts', 'factory.toml', 'project-config.mts', 'runtime-config.mts', 'config-read.mts', 'selection.mts',
  ...['index.js','date.js','error.js','extract.js','parse.js','primitive.js','stringify.js','struct.js','util.js','package.json','LICENSE','UPSTREAM.md'].map(f => `vendor/smol-toml/${f}`), '.env', '.env.example', '.gitignore', 'admission.mts', 'analyze.mts', 'assessment.mts', 'board.mts', 'board.template.html', 'ci.mts', 'config.mts', 'dispatch.mts',
  'dispatch.sh', 'factory-dispatch.sh', 'graph.mts', 'handoff.mts', 'journal.mts', 'main.mts', 'manifests.mts', 'models.mts', 'ownership.mts', 'preflight.mts', 'prompt.analyze.md', 'prompt.md',
  'prompt.recover.md', 'prompt.verify.md', 'recovery-sandbox.mts', 'recovery.mts', 'refresh.mts', 'tracker.github.mts', 'tracker.gitlab.mts', 'tracker.mts'].sort();

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
  assert.equal(mode(s('dispatch.sh')) & 0o111, 0o111);
  assert.equal(mode(s('factory-dispatch.sh')) & 0o111, 0o111);
  const main = readFileSync(s('main.mts'), 'utf8');
  assert.match(main, /image: "sandcastle-site"/);
  assert.match(main, /sandboxSetup: \[\] as/);
  for (const f of EXPECTED.filter(f => f.endsWith('.mts') || f.endsWith('.md') || f.endsWith('.example'))) {
    assert.doesNotMatch(readFileSync(s(f), 'utf8'), /islandhealth|composer install|start-web\.sh \/home|\/opt\/sandcastle\/bootstrap-site/, f);
  }
  assert.match(readFileSync(s('.gitignore'), 'utf8'), /^\.env\nevidence\/\nstate\/\nlogs\/\nboard\.html\n$/);
  const example = readFileSync(s('.env.example'), 'utf8');
  assert.doesNotMatch(example, /OPENAI|sk-/);
  assert.deepEqual(readRegistry(p).projects.map(x => x.root), [root]);
  assert.match(out, /Not ready to run an agent yet/);
  assert.equal(existsSync(join(root, '.sandcastle/sandbox')), false, 'no Drupal sandbox helpers copied');
});

test('generated configs import with the right tracker, agent and merge policy; personal inherits the subscription models', async t => {
  const { p, repo } = fixture(t);
  const a = repo('a'); const b = repo('b');
  await quiet(() => init(p, a, personal));
  await quiet(() => init(p, b, client));
  const pc = await import(pathToFileURL(join(a, '.sandcastle/config.mts')).href);
  assert.equal(pc.TRACKER.kind, 'github');
  assert.equal(pc.TRACKER.project, 'me/site');
  assert.equal(pc.TRACKER.milestone, undefined);
  assert.equal(pc.AGENT.provider, 'pi');
  assert.equal(pc.AGENT.modelAliases['Sonnet 5.5'], 'pi-claude-subscription/claude-sonnet-5-5');
  assert.equal(pc.AGENT.modelAliases['Opus 5.5'], 'pi-claude-subscription/claude-opus-5-5');
  assert.ok(!pc.allLabels().some((l: string) => l.startsWith('model:')));
  assert.equal(pc.AGENT.model, 'pi-claude-subscription/claude-opus-5-5');
  assert.equal(pc.GRAPH.model, 'pi-claude-subscription/claude-sonnet-5-5');
  assert.equal(pc.MERGE.auto, true);
  const cc = await import(pathToFileURL(join(b, '.sandcastle/config.mts')).href);
  assert.deepEqual([cc.TRACKER.kind, cc.TRACKER.gitlabHost, cc.TRACKER.project, cc.TRACKER.projectId, cc.TRACKER.milestone], ['gitlab', 'git.example.com', 'group/sub/site', 42, undefined]);
  assert.equal(cc.AGENT.provider, 'claude');
  assert.equal(cc.MERGE.auto, false);
  assert.match(readFileSync(join(b, '.sandcastle/.env.example'), 'utf8'), /CLAUDE_CODE_OAUTH_TOKEN=\n/);
});

test('rerun keeps existing bytes and modes, fills gaps, reports skips, never duplicates the registry', async t => {
  const { p, repo } = fixture(t);
  const root = repo();
  await quiet(() => init(p, root, personal));
  const s = (f: string) => join(root, '.sandcastle', f);
  writeFileSync(s('config.mts'), '// my custom config\n');
  writeFileSync(s('main.mts'), '// my custom main\n');
  writeFileSync(s('.gitignore'), 'node_modules\n');
  chmodSync(s('prompt.md'), 0o640);
  const keep = readFileSync(s('prompt.md'));
  rmSync(s('ci.mts'));
  const { out } = await quiet(() => init(p, root, { ...client }));
  assert.equal(readFileSync(s('config.mts'), 'utf8'), '// my custom config\n');
  assert.equal(readFileSync(s('main.mts'), 'utf8'), '// my custom main\n');
  assert.deepEqual(readFileSync(s('prompt.md')), keep);
  assert.equal(mode(s('prompt.md')), 0o640);
  assert.ok(existsSync(s('ci.mts')), 'missing file recreated');
  assert.match(out, new RegExp(`Created 1 file\\(s\\), skipped ${EXPECTED.length - 1}`));
  assert.match(out, /skipped .*config\.mts/);
  assert.match(out, /nothing was reconfigured/);
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

  mkdirSync(join(root, '.sandcastle/config.mts'), { recursive: true });
  assert.match(String((await quiet(() => init(p, root, personal))).error), /in the way/);
  assert.deepEqual(readdirSync(join(root, '.sandcastle')), ['config.mts'], 'preflight failed before the first write');
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
  rmSync(join(root, '.sandcastle/ci.mts'));
  assert.ok((await quiet(() => init(p, root, personal, { beforeWrite: () => { throw new Error('again'); } }))).error);
  assert.equal(readRegistry(p).projects.length, 1, 'stays registered');
});

test('factory-dispatch.sh cds to the root, forwards argv exactly and sets the state dir, with spaces and apostrophes', async t => {
  const { p, repo, base } = fixture(t, "ho'me dir");
  const root = repo("pro j'ect");
  await quiet(() => init(p, root, personal));
  const dispatch = join(root, '.sandcastle/dispatch.sh');
  writeFileSync(dispatch, '#!/usr/bin/env bash\nnode -e \'console.log(JSON.stringify({cwd: process.cwd(), state: process.env.SANDCASTLE_STATE_DIR, argv: process.argv.slice(1)}))\' -- "$@"\n');
  const wrapper = join(root, '.sandcastle/factory-dispatch.sh');
  const elsewhere = join(base, 'elsewhere'); mkdirSync(elsewhere);
  const run = (env: Record<string, string>) => JSON.parse(spawnSync(wrapper, ['--dry-run', "a b", "it's"], { cwd: elsewhere, encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: p.home, ...env } }).stdout);
  const got = run({});
  assert.deepEqual(got, { cwd: root, state: p.state, argv: ['--dry-run', 'a b', "it's"] });
  assert.equal(run({ SANDCASTLE_STATE_DIR: "/custom/st ate's" }).state, "/custom/st ate's");
});

test('shared state: a run written through the generated board module is read by the installed board from the configured folder', async t => {
  const { p, repo, base } = fixture(t);
  const root = repo();
  await quiet(() => init(p, root, personal));
  const state = join(base, 'shared state');
  const script = `import { setProject, setStage } from './.sandcastle/board.mts'; setProject('me/site'); setStage('7', { stage: 'done', title: 'Hello' });`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', env: { ...process.env, SANDCASTLE_STATE_DIR: state } });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(readdirSync(state), ['me_site--7.json']);
  const read = spawnSync(process.execPath, ['--input-type=module', '-e', `import { readRuns } from './board/board.mts'; console.log(JSON.stringify(readRuns().map(r => [r.iid, r.title, r.stage])));`],
    { cwd: join(import.meta.dirname, '../..'), encoding: 'utf8', env: { ...process.env, SANDCASTLE_STATE_DIR: state } });
  assert.deepEqual(JSON.parse(read.stdout), [['7', 'Hello', 'done']]);
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

test('every workflow module a scaffolded file imports is scaffolded too', () => {
  const files = buildAssets({ profile: 'personal', repo: 'a/b', image: 'x' }, '/s');
  const names = new Set(files.map(f => f.path.split('/').pop()));
  for (const f of files.filter(f => f.path.endsWith('.mts'))) {
    for (const [, dep] of String(f.content).matchAll(/from "\.\/([\w.-]+\.mts)"/g)) {
      assert.ok(names.has(dep), `${f.path} imports ./${dep}, which init does not write`);
    }
  }
});

test('a new scaffold ships the recovery workflow as reviewed; an existing copy stays inactive until it is reviewed', async t => {
  const { p, repo } = fixture(t);
  const fresh = repo('fresh');
  const r1 = await quiet(() => init(p, fresh, personal));
  assert.equal(r1.error, undefined);
  assert.equal(readFileSync(join(fresh, '.sandcastle/prompt.recover.md'), 'utf8'), readFileSync(new URL('../../orchestrator/prompt.recover.md', import.meta.url), 'utf8'));
  assert.equal(recoveryCopyProblem(p, fresh), null, 'active');
  assert.match(r1.out, /Self-recovery: active/);
  writeFileSync(join(fresh, '.sandcastle/main.mts'), readFileSync(join(fresh, '.sandcastle/main.mts'), 'utf8') + '// customized\n');
  assert.match(recoveryCopyProblem(p, fresh) ?? '', /main\.mts changed since the recovery workflow was reviewed/);

  // An existing project whose own main.mts predates recovery: init fills the gaps but records no review.
  const old = repo('old');
  mkdirSync(join(old, '.sandcastle'));
  writeFileSync(join(old, '.sandcastle/main.mts'), '// pre-recovery main\n');
  const r2 = await quiet(() => init(p, old, personal));
  assert.equal(r2.error, undefined);
  assert.equal(readReview(p, old), null);
  assert.match(recoveryCopyProblem(p, old) ?? '', /missing main\.mts --recover --attempt-record/);
  assert.match(r2.out, /Self-recovery: inactive/);
});
