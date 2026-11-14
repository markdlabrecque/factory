// #149: legacy upgrades install dependency evaluation without overwriting project customization.
// #150: executable tracker changes invalidate recovery review; project-owned prompts remain protected.
// #137: update snapshots cover nested vendor assets and project-owned TOML.
// `factory update --dry-run` (#91) and `--apply` (#92): classification of a project's .sandcastle copy against a synthetic Factory app with
// two committed versions, from its Git history, from an install catalog, and with no history; and that the dry run
// writes nothing; and that --apply creates missing and replaces outdated files only. Disposable HOME, app and project; no network, service manager or credentials.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { appRoot, buildAssets, writeScaffold } from '../src/scaffold.mts';
import { classifyCopy, factoryHistory, writeHistoryCatalog } from '../src/update.mts';
import { update } from '../src/commands/update.mts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });

function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-update-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const p = paths(join(base, 'home'));
  // Factory v1: the scaffold sources, committed.
  const app = join(base, 'app');
  for (const dir of ['orchestrator', 'board', 'cli/templates']) cpSync(join(appRoot, dir), join(app, dir), { recursive: true });
  git(app, 'init', '-q');
  git(app, 'add', '-A');
  git(app, 'commit', '-qm', 'v1');
  // A project scaffolded from v1.
  const root = join(base, 'proj');
  mkdirSync(root);
  git(root, 'init', '-q');
  writeScaffold(root, buildAssets({ profile: 'personal', repo: 'me/site', image: 'img' }, p.state, app));
  // Factory v2 changes three Factory-owned files, a project-owned one and the templated wrapper.
  for (const f of ['orchestrator/graph.mts', 'orchestrator/ci.mts', 'board/board.template.html', 'cli/templates/project/prompt.md', 'cli/templates/project/factory-dispatch.sh']) {
    appendFileSync(join(app, f), '\n# v2\n');
  }
  git(app, 'commit', '-qam', 'v2');
  // The project: graph.mts and factory-dispatch.sh untouched (old), ci.mts edited, tracker.mts deleted, prompt.md and dispatch.sh edited.
  const sc = join(root, '.sandcastle');
  appendFileSync(join(sc, 'ci.mts'), '// mine\n');
  rmSync(join(sc, 'tracker.mts'));
  appendFileSync(join(sc, 'dispatch.sh'), '# mine\n');
  return { base, p, app, root, sc };
}

const classes = (rows: { file: string; class: string }[]) => Object.fromEntries(rows.map(r => [r.file, r.class]));

test('classifies missing, outdated, edited, project-owned and current files from the app\'s Git history', t => {
  const { p, app, root } = fixture(t);
  const c = classes(classifyCopy(p, root, { app }));
  assert.equal(factoryHistory(app).kind, 'git');
  assert.equal(c['tracker.mts'], 'missing');
  assert.equal(c['graph.mts'], 'outdated');
  assert.equal(c['board.template.html'], 'outdated');
  assert.equal(c['factory-dispatch.sh'], 'outdated');
  assert.equal(c['ci.mts'], 'modified');
  for (const f of ['prompt.md', 'dispatch.sh', 'config.mts', 'main.mts']) assert.equal(c[f], 'project', f);
  for (const f of ['dispatch.mts', 'board.mts', 'prompt.verify.md', '.gitignore', '.env.example']) assert.equal(c[f], 'current', f);
  assert.equal(c['.env'], undefined);
});

test('a copied app uses the install catalog; with no history nothing counts as outdated', t => {
  const { base, p, app, root } = fixture(t);
  const copy = join(base, 'copied');
  for (const dir of ['orchestrator', 'board', 'cli']) cpSync(join(app, dir), join(copy, dir), { recursive: true });
  assert.equal(factoryHistory(copy).kind, 'none');
  const bare = classes(classifyCopy(p, root, { app: copy }));
  assert.equal(bare['graph.mts'], 'modified');
  assert.equal(bare['factory-dispatch.sh'], 'modified');
  assert.equal(writeHistoryCatalog(app, copy), true);
  assert.equal(factoryHistory(copy).kind, 'catalog');
  assert.deepEqual(classes(classifyCopy(p, root, { app: copy })), classes(classifyCopy(p, root, { app })));
});

test('factory update --dry-run reports by class and writes nothing; without --dry-run or --apply it refuses', t => {
  const { p, app, root, sc } = fixture(t);
  addProject(p, root);
  // #137: snapshot nested vendored assets too, without trying to read directories as files.
  const snapshot = () => readdirSync(sc, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(sc.length + 1)).sort().map(f => [f, readFileSync(join(sc, f), 'utf8'), statSync(join(sc, f)).mtimeMs]);
  const before = snapshot();
  const out: string[] = [];
  t.mock.method(console, 'log', (s: string) => out.push(s));
  assert.equal(update(p, { dryRun: true, cwd: root, app }), 0);
  const text = out.join('\n');
  assert.match(text, /Missing \(would create\): 1\n  tracker\.mts/);
  assert.match(text, /Outdated, unmodified \(would replace\): 3/);
  assert.match(text, /Edited locally \(kept; merge by hand\): 1\n  ci\.mts/);
  assert.match(text, /Project-owned .*: 5/);
  out.length = 0;
  update(p, { dryRun: true, json: true, cwd: root, app });
  const json = JSON.parse(out.join('\n'));
  assert.equal(json.history, 'git');
  assert.equal(json.files.find((f: any) => f.file === 'graph.mts').class, 'outdated');
  assert.throws(() => update(p, { cwd: root, app }), /--dry-run.*--apply/);
  assert.throws(() => update(p, { dryRun: true, apply: true, cwd: root, app }), /not both/);
  assert.deepEqual(snapshot(), before);
});

test('legacy upgrade creates verification helper but keeps a customized verifier prompt for explicit merge', t => {
  const { p, app, root, sc } = fixture(t);
  addProject(p, root);
  rmSync(join(sc, 'verification.mts'));
  rmSync(join(sc, 'dependencies.mts'));
  writeFileSync(join(sc, 'prompt.verify.md'), '# My legacy verifier\nWrite verdict.md only.\n');
  const c = classes(classifyCopy(p, root, { app }));
  assert.equal(c['verification.mts'], 'missing');
  assert.equal(c['dependencies.mts'], 'missing');
  assert.equal(c['prompt.verify.md'], 'project');
  const out: string[] = [];
  t.mock.method(console, 'log', (s: string) => out.push(s));
  assert.equal(update(p, { apply: true, cwd: root, app }), 0);
  assert.deepEqual(readFileSync(join(sc, 'verification.mts')), readFileSync(join(app, 'orchestrator/verification.mts')));
  assert.deepEqual(readFileSync(join(sc, 'dependencies.mts')), readFileSync(join(app, 'orchestrator/dependencies.mts')));
  assert.equal(readFileSync(join(sc, 'prompt.verify.md'), 'utf8'), '# My legacy verifier\nWrite verdict.md only.\n');
  assert.match(out.join('\n'), /recovery review/);
});

test('factory update --apply creates missing and replaces outdated files, keeping edited and project-owned ones', t => {
  const { p, app, root, sc } = fixture(t);
  addProject(p, root);
  const kept = ['ci.mts', 'dispatch.sh', 'prompt.md', 'config.mts', 'main.mts', '.env'].map(f => [f, readFileSync(join(sc, f), 'utf8')]);
  const out: string[] = [];
  t.mock.method(console, 'log', (s: string) => out.push(s));
  assert.equal(update(p, { apply: true, cwd: root, app }), 0);
  const text = out.join('\n');
  assert.match(text, /1 created, 3 replaced/);
  assert.match(text, /Edited locally \(kept; merge by hand\): 1\n  ci\.mts/);
  // #150: tracker.mts is executable delivery authority and now requires coherent workflow review.
  assert.match(text, /recovery review/);
  for (const f of ['tracker.mts', 'graph.mts']) assert.deepEqual(readFileSync(join(sc, f)), readFileSync(join(app, 'orchestrator', f)), f);
  assert.equal(readFileSync(join(sc, 'factory-dispatch.sh'), 'utf8'),
    readFileSync(join(app, 'cli/templates/project/factory-dispatch.sh'), 'utf8').replace('{{STATE_DIR_QUOTED}}', `'${p.state}'`));
  assert.equal(statSync(join(sc, 'factory-dispatch.sh')).mode & 0o777, 0o755);
  for (const [f, before] of kept) assert.equal(readFileSync(join(sc, f), 'utf8'), before, f);
  assert.deepEqual(readdirSync(sc).filter(f => f.includes('factory-update')), []);
  const after = classes(classifyCopy(p, root, { app }));
  assert.deepEqual(Object.values(after).filter(c => c === 'missing' || c === 'outdated'), []);
  // A recovery workflow file that was outdated asks for a fresh review.
  appendFileSync(join(app, 'board/board.mts'), '\n// v3\n');
  git(app, 'commit', '-qam', 'v3');
  out.length = 0;
  update(p, { apply: true, json: true, cwd: root, app });
  const json = JSON.parse(out.join('\n'));
  assert.deepEqual(json.replaced, ['board.mts']);
  assert.equal(json.recoveryReviewNeeded, true);
});
