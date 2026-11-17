// Offline fixtures exercise bundle assembly and private dependency validation without npm or project access.
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RUNTIME_ASSETS, validateRuntimeInventory } from '../src/runtime-assets.mts';
import { installRuntimePackages, prepareRuntimeBundle, validateRuntimeBundle } from '../src/runtime-bundle.mts';
import { installPackages as install } from './runtime-fixture.mts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'factory-bundle-test-')), source = join(root, 'source'), store = join(root, 'store');
  mkdirSync(source);
  for (const asset of RUNTIME_ASSETS) { const dest = join(source, asset.source); mkdirSync(dirname(dest), { recursive: true }); cpSync(join(repo, asset.source), dest); }
  return { root, source, store, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const prepare = (f: ReturnType<typeof fixture>) => prepareRuntimeBundle({ sourceRoot: f.source, runtimeStore: f.store, install });

test('flat inventory contains executable imports and the source-layout admission bridges', () => {
  const paths = new Set(RUNTIME_ASSETS.map(a => a.destination));
  for (const asset of RUNTIME_ASSETS.filter(a => /\.(mts|js)$/.test(a.source))) {
    const text = readFileSync(join(repo, asset.source), 'utf8').replace(/^import type .*;$/gm, '');
    if (asset.destination === 'runtime-ownership.mts') assert.ok(paths.has('admission.mts'), 'flat ownership imports its inventoried admission helper');
    for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = posix.normalize(posix.join(posix.dirname(asset.destination), match[1]));
      if (asset.destination === 'capabilities.mts' && target === '../board/admission.mts') continue; // Source-tree type import; runtime uses colocated admission.
      assert(paths.has(target), `${asset.destination} references missing ${target}`);
    }
  }
});

test('complete inventory, deterministic identity, private install and validation', async t => {
  const f = fixture(); t.after(f.cleanup);
  const a = prepare(f), b = prepare(f);
  assert.equal(a.id, b.id); assert.deepEqual(validateRuntimeBundle(a.directory), a.manifest);
  assert.deepEqual(a.manifest.files.map(x => x.path), [...RUNTIME_ASSETS.map(x => x.destination)].sort());
  assert(!existsSync(join(a.directory, 'config.mts')));
  const layout = await import(pathToFileURL(join(a.directory, 'project-layout.mts')).href);
  assert.equal(layout.projectLayoutPaths('/fixture-project').assets, '/fixture-project/.factory');
  const input = await import(pathToFileURL(join(a.directory, 'supervisor-input.mts')).href);
  assert.equal(typeof input.collectSupervisorInput, 'function');
  assert.deepEqual(readFileSync(join(a.directory,'supervisor-input.mts')),readFileSync(join(f.source,'cli/src/supervisor-input.mts')));
  const facts = await import(pathToFileURL(join(a.directory, 'supervisor-facts.mts')).href);
  assert.equal(facts.safeExcerpt('token=private'), '[REDACTED]');
  assert.equal(facts.observed('fixture', 'saved', '2026-11-16T00:00:00.000Z', []).status, 'known');
  const state = await import(pathToFileURL(join(a.directory, 'supervisor-state.mts')).href);
  assert.equal(state.emptySupervisor({ root: '/fixture/project', tracker: { kind: 'github', host: 'github.com', project: 'owner/repo' } }).revision, 0);
  assert.deepEqual(readFileSync(join(a.directory, 'supervisor-state.mts')), readFileSync(join(f.source, 'cli/src/supervisor-state.mts')), 'state ships unchanged');
  const admission = await import(pathToFileURL(join(a.directory, 'supervisor-admission.mts')).href);
  assert.equal(typeof admission.claimSupervisorHold, 'function');
  assert.equal(typeof admission.releaseSupervisorHold, 'function');
  assert.deepEqual(readFileSync(join(a.directory, 'supervisor-admission.mts')), readFileSync(join(f.source, 'cli/src/supervisor-admission.mts')), 'admission ships unchanged without source fallback');
  const advisory = await import(pathToFileURL(join(a.directory, 'supervisor-advisory-contract.mts')).href);
  assert.deepEqual(advisory.advisoryReservation(), { tokens: 1_054_096, cost: 5_808_792 });
  const hostPolicy = await import(pathToFileURL(join(a.directory, 'supervisor-host-policy.mts')).href);
  assert.equal(typeof hostPolicy.readHostAdvisoryPolicy, 'function');
  const request = await import(pathToFileURL(join(a.directory, 'supervisor-openai-request.mts')).href);
  assert.equal(typeof request.requestAdvisory, 'function');
  const usage = await import(pathToFileURL(join(a.directory, 'supervisor-openai-usage.mts')).href);
  assert.equal(typeof usage.providerUsage, 'function'); assert.equal(typeof usage.persistProviderUsage, 'function');
  assert.equal(typeof usage.providerResources, 'function');
  assert.deepEqual(readFileSync(join(a.directory, 'supervisor-openai-usage.mts')), readFileSync(join(f.source, 'cli/src/supervisor-openai-usage.mts')), 'usage ships unchanged');
  const provider = JSON.parse(readFileSync(join(a.directory, 'supervisor-provider/package-lock.json'), 'utf8'));
  assert.equal(provider.packages['node_modules/@earendil-works/pi-ai'].version, '1.5.2');
  assert.equal(provider.packages['node_modules/openai'].version, '7.19.0');
  for (const path of ['supervisor-openai-request.mts', 'supervisor-provider/manifest.json', 'supervisor-provider/package.json', 'supervisor-provider/package-lock.json', 'supervisor-provider/pi-ai-1.5.2.tgz', 'supervisor-provider/openai-7.19.0.tgz'])
    assert.ok(a.manifest.files.some(f => f.path === path), 'provider code, artifacts and dependency provenance are inventoried');
  assert.equal(typeof state.authorizeAdvisorySend, 'function');
  for (const name of ['supervisor-advisory-contract.mts', 'supervisor-host-policy.mts'])
    assert.deepEqual(readFileSync(join(a.directory, name)), readFileSync(join(f.source, 'cli/src', name)), 'advisory assets ship unchanged');
  const owned = await import(pathToFileURL(join(a.directory, 'supervisor-openai.mts')).href);
  assert.equal(typeof owned.createOpenAIDiagnosisBoundary, 'function');
  const runtime = await import(pathToFileURL(join(a.directory, 'supervisor-runtime.mts')).href);
  assert.equal(typeof runtime.createSupervisorRuntime, 'function', 'trusted composition ships with all private imports');
  assert.deepEqual(readFileSync(join(a.directory, 'supervisor-runtime.mts')), readFileSync(join(f.source, 'cli/src/supervisor-runtime.mts')));
  assert.equal(typeof request.verifyPinnedProvider, 'function', 'same actual SDK closure verifier is available before child start');
  const processBoundary = await import(pathToFileURL(join(a.directory, 'supervisor-process.mts')).href);
  assert.equal(typeof processBoundary.confirmOwnedCleanup, 'function');
  for (const name of ['supervisor-openai.mts', 'supervisor-process.mts', 'supervisor-runner.mts', 'supervisor-guard.mjs']) {
    assert.ok(a.manifest.files.some(f => f.path === name), 'every actual owned process asset is inventoried');
    assert.deepEqual(readFileSync(join(a.directory, name)), readFileSync(join(f.source, 'cli/src', name)), `${name} ships unchanged`);
  }
  const worker = await import(pathToFileURL(join(a.directory, 'supervisor-worker.mts')).href);
  assert.equal(typeof worker.diagnoseProject, 'function', 'complete selected worker imports without source-tree dependencies');
  assert.deepEqual(readFileSync(join(a.directory, 'supervisor-worker.mts')), readFileSync(join(f.source, 'cli/src/supervisor-worker.mts')), 'worker ships unchanged');
  const lifecycle = await import(pathToFileURL(join(a.directory, 'supervisor-schedule.mts')).href);
  assert.equal(typeof lifecycle.supervisorWakeups, 'function', 'flat lifecycle imports only inventoried worker/review/application helpers');
  assert.deepEqual(readFileSync(join(a.directory, 'supervisor-schedule.mts')), readFileSync(join(f.source, 'cli/src/supervisor-schedule.mts')));
  const broker = await import(pathToFileURL(join(a.directory, 'supervisor-broker.mts')).href);
  assert.equal(typeof broker.brokerSupervisor, 'function');
  assert.deepEqual(readFileSync(join(a.directory, 'supervisor-broker.mts')), readFileSync(join(f.source, 'cli/src/supervisor-policy.mts')));
  assert.deepEqual(layout.projectLayoutPolicy({ kind: 'fresh' }, 'existing'), { allowed: false, reason: 'fresh-not-allowed' });
  const reviewer = await import(pathToFileURL(join(a.directory, 'supervisor-review.mts')).href);
  assert.equal(typeof reviewer.reviewGateProposal, 'function');
  const applicator = await import(pathToFileURL(join(a.directory, 'supervisor-gate-apply.mts')).href);
  assert.equal(typeof applicator.applyReviewedGate, 'function');
  assert.equal(typeof applicator.gateScopeHold, 'function');
  assert.deepEqual(readFileSync(join(a.directory, 'supervisor-gate-apply.mts')), readFileSync(join(f.source, 'cli/src/supervisor-gate-apply.mts')));
  const escalation = await import(pathToFileURL(join(a.directory, 'supervisor-escalation.mts')).href);
  assert.equal(typeof escalation.deliverSupervisorRequest, 'function');
  for (const name of ['main.mts', 'model-policy.mts', 'supervisor-contract.mts', 'supervisor-policy.mts', 'supervisor.mts', 'prompt.supervisor.md', 'gate-review.mts', 'prompt.gate-review.md']) {
    assert.deepEqual(readFileSync(join(a.directory, name)), readFileSync(join(f.source, 'orchestrator', name)), `${name} ships unchanged`);
  }
  const providerArchive=join(a.directory,'supervisor-provider/pi-ai-1.5.2.tgz'), originalArchive=readFileSync(providerArchive);
  writeFileSync(providerArchive,'corrupt'); assert.throws(()=>validateRuntimeBundle(a.directory),'pre-entry provider artifact drift is a bundle-validation case');
  writeFileSync(providerArchive,originalArchive); validateRuntimeBundle(a.directory);
  assert(!readFileSync(join(a.directory, 'main.mts'), 'utf8').includes('sandcastle-islandhealth'));
  assert(existsSync(join(a.directory, 'node_modules/tsx/dist/cli.mjs')));
  writeFileSync(join(a.directory, 'node_modules/tsx/dist/cli.mjs'), 'poison');
  assert.throws(() => prepare(f), /dependencies changed/);
});

test('source and lock changes produce separate bundles and leave old bundle intact', t => {
  const f = fixture(); t.after(f.cleanup);
  const a = prepare(f);
  writeFileSync(join(f.source, 'orchestrator/main.mts'), readFileSync(join(f.source, 'orchestrator/main.mts'), 'utf8') + '\n// changed');
  const b = prepare(f); assert.notEqual(a.id, b.id); validateRuntimeBundle(a.directory);
  const lock = join(f.source, 'package-lock.json'); writeFileSync(lock, `${readFileSync(lock, 'utf8')}\n`);
  const c = prepare(f); assert.notEqual(b.id, c.id); validateRuntimeBundle(b.directory);
});

test('patch helper and specification participate in source identity with synthetic prepared packages', t => {
  const f = fixture(); t.after(f.cleanup);
  let previous = prepare(f);
  for (const name of ['sandcastle-patch.mts', 'sandcastle-patch.json']) {
    const path = join(f.source, 'cli/src', name);
    writeFileSync(path, readFileSync(path, 'utf8') + '\n');
    const next = prepare(f);
    assert.notEqual(next.id, previous.id);
    assert.equal(next.manifest.dependencies, previous.manifest.dependencies);
    validateRuntimeBundle(previous.directory);
    previous = next;
  }
});

test('synthetic SDK package bytes affect dependency identity independently of source identity', t => {
  const f = fixture(); t.after(f.cleanup);
  const a = prepare(f);
  const b = prepareRuntimeBundle({ sourceRoot: f.source, runtimeStore: join(f.root, 'other-store'), install: directory => {
    install(directory);
    // This is a byte-hash probe, not evidence that a fixture package implements the upstream patch.
    const sdk = join(directory, 'node_modules/@ai-hero/sandcastle/dist/main.js');
    writeFileSync(sdk, readFileSync(sdk, 'utf8') + '\n// synthetic patched package bytes\n');
  } });
  assert.equal(a.id, b.id, 'unchanged source must retain the source identity');
  assert.notEqual(a.manifest.dependencies, b.manifest.dependencies);
  validateRuntimeBundle(a.directory); validateRuntimeBundle(b.directory);
  const sdk = join(b.directory, 'node_modules/@ai-hero/sandcastle/dist/main.js');
  writeFileSync(sdk, readFileSync(sdk, 'utf8') + '\n// post-publication drift\n');
  assert.throws(() => validateRuntimeBundle(b.directory), /dependencies changed/);
  validateRuntimeBundle(a.directory);
});

test('missing source, symlinks and invalid or colliding destinations fail closed', t => {
  const f = fixture(); t.after(f.cleanup);
  assert.throws(() => validateRuntimeInventory([{ source: '../escape', destination: 'x' }]));
  assert.throws(() => validateRuntimeInventory([{ source: 'a', destination: 'x' }, { source: 'b', destination: 'x/y' }]));
  assert.throws(() => validateRuntimeInventory([{ source: 'a', destination: 'x' }, { source: 'b', destination: 'x' }]));
  const main = join(f.source, 'orchestrator/main.mts'); rmSync(main); assert.throws(() => prepare(f));
  symlinkSync(join(repo, 'orchestrator/main.mts'), main); assert.throws(() => prepare(f), /Symlink/);
});

test('failed installation and corrupt existing bundle never publish or modify an old bundle', t => {
  const f = fixture(); t.after(f.cleanup);
  const old = prepare(f), before = readFileSync(join(old.directory, 'runtime-manifest.json'));
  writeFileSync(join(f.source, 'orchestrator/main.mts'), readFileSync(join(f.source, 'orchestrator/main.mts'), 'utf8') + '\n// new');
  assert.throws(() => prepareRuntimeBundle({ sourceRoot: f.source, runtimeStore: f.store, install: () => { throw Error('offline failure'); } }), /offline failure/);
  assert.deepEqual(readFileSync(join(old.directory, 'runtime-manifest.json')), before);
  assert.deepEqual(readdirSync(f.store), [old.id]);
  // Successful fixture npm followed by the real byte guard must fail transactionally.
  const descriptor = join(f.root, 'runtime.json'), selected = JSON.stringify({version:1,id:old.id});
  writeFileSync(descriptor, selected);
  assert.throws(() => prepareRuntimeBundle({ sourceRoot: f.source, runtimeStore: f.store, install: directory => {
    installRuntimePackages(directory, () => { install(directory); return {status:0}; });
  } }), /Unsupported Sandcastle package files/);
  assert.equal(readFileSync(descriptor, 'utf8'), selected);
  const spec = join(f.source, 'cli/src/sandcastle-patch.json');
  assert.throws(() => prepareRuntimeBundle({ sourceRoot: f.source, runtimeStore: f.store, install: directory => {
    install(directory); writeFileSync(spec, readFileSync(spec, 'utf8') + '\n');
  } }), /Runtime source changed during package preparation/);
  assert.equal(readFileSync(descriptor, 'utf8'), selected);
  assert.deepEqual(readdirSync(f.store), [old.id]);
  validateRuntimeBundle(old.directory);
  const next = prepare(f); rmSync(join(next.directory, 'node_modules/tsx/dist/cli.mjs'));
  assert.throws(() => prepare(f)); validateRuntimeBundle(old.directory);
});

test('competing identical preparation reuses the completed bundle', t => {
  const f = fixture(); t.after(f.cleanup);
  let competing: ReturnType<typeof prepare> | undefined;
  const result = prepareRuntimeBundle({ sourceRoot: f.source, runtimeStore: f.store, install: dir => { install(dir); competing = prepare(f); } });
  assert.equal(result.id, competing!.id);
  assert.deepEqual(readdirSync(f.store), [result.id]);
  validateRuntimeBundle(result.directory);
});

test('separate processes concurrently publish one identical complete bundle', async t => {
  const f = fixture(); t.after(f.cleanup);
  const barrier = join(f.root, 'barrier'); mkdirSync(barrier);
  const script = `
    import { prepareRuntimeBundle } from ${JSON.stringify(new URL('../src/runtime-bundle.mts', import.meta.url).href)};
    import { installPackages } from ${JSON.stringify(new URL('./runtime-fixture.mts', import.meta.url).href)};
    import { readdirSync, writeFileSync } from 'node:fs';
    const barrier = ${JSON.stringify(barrier)};
    const bundle = prepareRuntimeBundle({ sourceRoot: ${JSON.stringify(f.source)}, runtimeStore: ${JSON.stringify(f.store)}, install: dir => {
      installPackages(dir);
      writeFileSync(barrier + '/' + process.pid, 'ready');
      const deadline = Date.now() + 5000;
      while (readdirSync(barrier).length < 2) {
        if (Date.now() > deadline) throw Error('concurrent preparation timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    } });
    console.log(bundle.id);
  `;
  const children = [0, 1].map(() => spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }));
  t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill(); }));
  const ids = await Promise.all(children.map(child => new Promise<string>((resolve, reject) => {
    let out = '', err = '';
    child.stdout.on('data', bytes => { out += bytes; }); child.stderr.on('data', bytes => { err += bytes; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(Error(err)));
  })));
  assert.equal(ids[0], ids[1]);
  assert.deepEqual(readdirSync(f.store), [ids[0]]);
  validateRuntimeBundle(join(f.store, ids[0]));
});

test('npm boundary forces dev, optional packages and disabled scripts in the private cwd', () => {
  const calls: unknown[] = [];
  let patched: string | undefined;
  installRuntimePackages('/fixture/runtime', (command, args, options) => { calls.push({ command, args, options }); return { status: 0 }; }, directory => {
    assert.equal(calls.length, 1); patched = directory; return { state: 'original', changed: [] };
  });
  assert.equal(patched, '/fixture/runtime');
  assert.deepEqual(calls, [{ command: 'npm', args: ['ci', '--include=dev', '--include=optional', '--ignore-scripts'], options: { cwd: '/fixture/runtime', stdio: 'inherit' } }]);
  assert.throws(() => installRuntimePackages('/fixture', () => ({ status: 0 }), () => { throw Error('patch refused'); }), /patch refused/);
  assert.throws(() => installRuntimePackages('/fixture', () => ({ status: 1 })), /npm ci failed/);
  assert.throws(() => installRuntimePackages('/fixture', () => ({ status: null, error: new Error('missing npm') })), /missing npm/);
});

test('missing applicable optional package or platform binary cannot publish', t => {
  const f = fixture(); t.after(f.cleanup);
  for (const binaryOnly of [false, true]) {
    assert.throws(() => prepareRuntimeBundle({ sourceRoot: f.source, runtimeStore: f.store, install: dir => {
      install(dir);
      const platform = join(dir, 'node_modules', `@esbuild/${process.platform}-${process.arch}`);
      rmSync(binaryOnly ? join(platform, process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild') : platform, { recursive: true });
    } }));
    assert.deepEqual(readdirSync(f.store), []);
  }
});

test('project poison is not read or executed and dependency links cannot escape', t => {
  const f = fixture(); t.after(f.cleanup);
  const project = join(f.root, 'project'); mkdirSync(join(project, 'node_modules'), { recursive: true });
  writeFileSync(join(project, 'package.json'), '{"scripts":{"preinstall":"exit 1"}}');
  assert.throws(() => prepareRuntimeBundle({ sourceRoot: f.source, runtimeStore: f.store, install: dir => { assert.notEqual(dir, project); install(dir); symlinkSync(project, join(dir, 'node_modules/escape')); } }), /Unsafe dependency symlink/);
  assert.deepEqual(readdirSync(f.store), []);
});
