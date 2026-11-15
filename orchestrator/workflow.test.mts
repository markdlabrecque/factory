// Data-only selection against complete disposable bundles, including hostile manifests and dependency trees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkflow, regenerateRuntimeManifest } from './workflow.mts';
import { paths } from '../cli/src/paths.mts';
import { prepareRuntimeBundle, validateRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
import { installedFixture } from '../cli/test/workflow-fixture.mts';
import { factoryToml } from '../cli/test/config-fixture.mts';
import { recoveryCopyProblem, recordReview } from '../cli/src/recovery-review.mts';

function fixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'factory-workflow-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const p = paths(home), root = join(home, 'project'), config = join(root, '.sandcastle/factory.toml');
  mkdirSync(join(root, '.sandcastle'), { recursive: true });
  writeFileSync(config, factoryToml('owner/repo'));
  installedFixture(p);
  const factory = resolveWorkflow(root, p.runtimeDescriptor);
  const override = join(root, 'workflow');
  cpSync(factory.root, override, { recursive: true });
  const selectProject = (directory = 'workflow') => writeFileSync(config, factoryToml('owner/repo') + `\n[workflow]\nmode = "project"\ndirectory = ${JSON.stringify(directory)}\n`);
  const publish = () => writeFileSync(join(override, 'runtime-manifest.json'), JSON.stringify(regenerateRuntimeManifest(override)));
  return { p, root, config, factory, override, selectProject, publish, select: (env?: NodeJS.ProcessEnv) => resolveWorkflow(root, p.runtimeDescriptor, env) };
}

test('factory is the default; copied project executables never select or execute themselves', t => {
  const f = fixture(t);
  for (const name of ['main.mts', 'dispatch.mts', 'dispatch.sh', 'config.mts']) writeFileSync(join(f.root, '.sandcastle', name), 'throw Error("LOCAL CODE EXECUTED")');
  const selected = f.select();
  assert.equal(selected.mode, 'factory'); assert.equal(selected.root, f.factory.root);
  assert.equal(selected.id, f.factory.id);
  assert.equal(selected.entrypoints.main, join(selected.root, 'main.mts'));
  assert.equal(recoveryCopyProblem(f.p, f.root), null, 'validated Factory bundle needs no per-project review');
  assert.equal(existsSync(f.p.recovery), false, 'selection and review eligibility write no state');
});

test('complete explicit override owns every helper and dependencies; edits need regeneration and a new review', t => {
  const f = fixture(t); f.selectProject();
  writeFileSync(join(f.override, 'main.mts'), 'throw Error("MUST NOT IMPORT PROJECT CODE DURING SELECTION")');
  assert.throws(() => f.select(), /regenerate.*no Factory fallback/);
  const before = readFileSync(join(f.override, 'runtime-manifest.json'));
  const manifest = regenerateRuntimeManifest(f.override);
  assert.deepEqual(readFileSync(join(f.override, 'runtime-manifest.json')), before, 'regeneration is pure');
  assert.notEqual(manifest.id, f.factory.id); f.publish();
  const w = f.select(); assert.equal(w.mode, 'project'); assert.equal(w.root, f.override);
  for (const entry of Object.values(w.entrypoints)) assert.ok(entry.startsWith(f.override + '/'));
  assert.equal(w.tsx, join(f.override, 'node_modules/tsx/dist/cli.mjs'));
  assert.match(recoveryCopyProblem(f.p, f.root)!, /not been reviewed/);
  recordReview(f.p, f.root); assert.equal(recoveryCopyProblem(f.p, f.root), null);
  writeFileSync(join(f.override, 'prompt.recover.md'), 'changed repair policy');
  assert.match(recoveryCopyProblem(f.p, f.root)!, /mismatch/);
  f.publish(); assert.match(recoveryCopyProblem(f.p, f.root)!, /changed since recovery review/);
  recordReview(f.p, f.root); assert.equal(recoveryCopyProblem(f.p, f.root), null);
  writeFileSync(f.config, factoryToml('owner/repo'));
  assert.equal(recoveryCopyProblem(f.p, f.root), null);
  f.selectProject();
  const other = join(f.root, 'other-workflow'); cpSync(f.override, other, { recursive: true });
  f.selectProject('other-workflow');
  assert.match(recoveryCopyProblem(f.p, f.root)!, /changed since recovery review/, 'same code at another root cannot reuse review');
});

for (const corruption of ['missing-manifest', 'unknown-version', 'unknown-inventory', 'missing-inventory-file', 'extra-inventory-file', 'illegal-inventory-path', 'missing-helper', 'stale-hash', 'missing-lock', 'missing-dependencies', 'missing-transitive', 'changed-dependency', 'dangling-source-link', 'escaping-source-link', 'internal-source-link', 'escaping-dependency-link', 'dangling-dependency-link']) {
  test(`broken override fails without fallback: ${corruption}`, t => {
    const f = fixture(t); f.selectProject();
    const file = join(f.override, 'runtime-manifest.json'), manifest = JSON.parse(readFileSync(file, 'utf8'));
    if (corruption === 'missing-manifest') rmSync(file);
    if (corruption === 'unknown-version') { manifest.version = 999; writeFileSync(file, JSON.stringify(manifest)); }
    if (corruption === 'unknown-inventory') { manifest.inventoryVersion = 999; writeFileSync(file, JSON.stringify(manifest)); }
    if (corruption === 'missing-inventory-file') { manifest.files.pop(); writeFileSync(file, JSON.stringify(manifest)); }
    if (corruption === 'extra-inventory-file') { manifest.files.push({ path: 'unknown.mts', sha256: 'a'.repeat(64), mode: 420 }); writeFileSync(file, JSON.stringify(manifest)); }
    if (corruption === 'illegal-inventory-path') { manifest.files[0].path = '../outside.mts'; writeFileSync(file, JSON.stringify(manifest)); }
    if (corruption === 'missing-helper') rmSync(join(f.override, 'recovery-analysis-contract.mts'));
    if (corruption === 'stale-hash') writeFileSync(join(f.override, 'dispatch.mts'), 'changed');
    if (corruption === 'missing-lock') rmSync(join(f.override, 'package-lock.json'));
    if (corruption === 'missing-dependencies') rmSync(join(f.override, 'node_modules'), { recursive: true });
    if (corruption === 'missing-transitive') rmSync(join(f.override, `node_modules/@esbuild/${process.platform}-${process.arch}/bin/esbuild`));
    if (corruption === 'changed-dependency') writeFileSync(join(f.override, 'node_modules/tsx/dist/cli.mjs'), 'changed');
    if (corruption.endsWith('source-link')) {
      rmSync(join(f.override, 'graph.mts'));
      symlinkSync(corruption.startsWith('internal') ? 'main.mts' : corruption.startsWith('dangling') ? 'missing.mts' : join(f.factory.root, 'graph.mts'), join(f.override, 'graph.mts'));
    }
    if (corruption.endsWith('dependency-link')) symlinkSync(corruption.startsWith('escaping') ? f.factory.root : 'missing', join(f.override, 'node_modules/bad-link'));
    assert.throws(() => f.select(), /Invalid project workflow.*no Factory fallback/);
    assert.equal(validateRuntimeBundle(f.factory.root).id, f.factory.id, 'a valid installed bundle must not mask a broken override');
  });
}

for (const directory of ['/tmp/absolute', '../outside', 'workflow/../workflow', 'missing', 'escape', 'dangling']) {
  test(`illegal workflow directory is refused: ${directory}`, t => {
    const f = fixture(t);
    if (directory === 'escape') symlinkSync(f.factory.root, join(f.root, directory));
    if (directory === 'dangling') symlinkSync('missing', join(f.root, directory));
    f.selectProject(directory); assert.throws(() => f.select());
  });
}

test('trusted descriptor and pinned identity fail closed; publishing B never changes inherited A', t => {
  const f = fixture(t), a = f.select();
  const source = join(f.p.home, 'workflow-source');
  writeFileSync(join(source, 'orchestrator/prompt.analyze.md'), 'B analysis policy');
  const b = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: f.p.runtimes, install: installPackages });
  withRuntimeLock(f.p, () => { recordRuntimeOwnership(f.p, b.id); writeRuntimeDescriptor(f.p, b.id); });
  assert.equal(f.select().id, b.id); assert.notEqual(b.id, a.id);
  const inherited = f.select(a.env); assert.equal(inherited.id, a.id); assert.equal(inherited.root, a.root);
  assert.throws(() => f.select({ ...a.env, FACTORY_RUNTIME_ID: 'b'.repeat(64) }), /changed during invocation/);
  f.selectProject(); assert.throws(() => f.select(a.env), /changed during invocation/);
  rmSync(f.p.runtimeDescriptor); assert.throws(() => f.select());
});

for (const descriptor of ['unknown-version', 'invalid-id', 'missing-bundle', 'symlink']) {
  test(`invalid trusted descriptor fails without project-copy fallback: ${descriptor}`, t => {
    const f = fixture(t);
    if (descriptor === 'symlink') {
      const saved = join(f.p.home, 'descriptor.json');
      cpSync(f.p.runtimeDescriptor, saved); rmSync(f.p.runtimeDescriptor); symlinkSync(saved, f.p.runtimeDescriptor);
    } else writeFileSync(f.p.runtimeDescriptor, JSON.stringify({ version: descriptor === 'unknown-version' ? 9 : 1,
      id: descriptor === 'invalid-id' ? '../workflow' : '0'.repeat(64) }));
    assert.throws(() => f.select());
  });
}

test('manifest regeneration rejects aliased roots and never repairs an incomplete override', t => {
  const f = fixture(t), alias = join(f.root, 'alias');
  symlinkSync(f.override, alias); assert.throws(() => regenerateRuntimeManifest(alias), /canonical workflow directory/);
  const saved = readFileSync(join(f.override, 'runtime-manifest.json'));
  rmSync(join(f.override, 'recovery-analysis.mts'));
  assert.throws(() => regenerateRuntimeManifest(f.override));
  assert.deepEqual(readFileSync(join(f.override, 'runtime-manifest.json')), saved);
});
