// Install and lease integration uses disposable homes, fixture package trees and fake services only.
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { Fake } from '../src/platform/fake.mts';
import { ownerOf } from '../../board/admission.mts';
import { install as installReal } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { acquireRuntimeLease, readRuntimeDescriptor, releaseRuntimeLease, transferRuntimeLease } from '../src/runtime-ownership.mts';
import { copyRuntimeSources, installPackages } from './runtime-fixture.mts';

for (const link of [false, true]) test(`install ${link ? 'linked' : 'copied'} retains leased old runtime and failed descriptor`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-runtime-integration-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = paths(root), source = join(root, 'source'), service = new Fake(p);
  mkdirSync(join(source, 'skills'), { recursive: true }); copyRuntimeSources(source);
  const opts = { source, link, installPackages };
  await installReal(p, service, opts);
  const a = readRuntimeDescriptor(p), oldPath = join(p.runtimes, a.id, 'main.mts');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const old = readFileSync(oldPath, 'utf8'), lease = acquireRuntimeLease(p, a.id, ownerOf(child.pid!));
  const sourceMain = join(source, 'orchestrator/main.mts');
  writeFileSync(sourceMain, readFileSync(sourceMain, 'utf8') + '\n// changed\n');
  const before = readFileSync(p.runtimeDescriptor);
  await assert.rejects(installReal(p, service, { ...opts, installPackages: () => { throw Error('offline'); } }), /offline/);
  assert.deepEqual(readFileSync(p.runtimeDescriptor), before);
  await installReal(p, service, opts);
  assert.notEqual(readRuntimeDescriptor(p).id, a.id);
  assert.equal(readFileSync(oldPath, 'utf8'), old);
  assert(existsSync(join(p.runtimes, a.id, 'node_modules/tsx/dist/cli.mjs')));
  await assert.rejects(uninstall(p, service), /live or unknown owner/);
  assert(existsSync(p.app));
  transferRuntimeLease(p, lease.token, ownerOf(process.pid));
  releaseRuntimeLease(p, lease.token);
  child.kill(); await once(child, 'exit');
  await uninstall(p, service);
  assert(!existsSync(p.runtimes));
});

for (const phase of ['temporary', 'published']) test(`interrupted ${phase} publication has recoverable ownership`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-runtime-interrupt-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = paths(root), source = join(root, 'source'), service = new Fake(p);
  mkdirSync(join(source, 'skills'), { recursive: true }); copyRuntimeSources(source);
  await installReal(p, service, { source, installPackages });
  const before = readFileSync(p.runtimeDescriptor);
  const main = join(source, 'orchestrator/main.mts'); writeFileSync(main, readFileSync(main, 'utf8') + '\n// new version\n');
  const url = (path: string) => pathToFileURL(resolve(path)).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { install } from ${JSON.stringify(url('cli/src/commands/install.mts'))};
    import { paths } from ${JSON.stringify(url('cli/src/paths.mts'))};
    import { Fake } from ${JSON.stringify(url('cli/src/platform/fake.mts'))};
    import { installPackages } from ${JSON.stringify(url('cli/test/runtime-fixture.mts'))};
    const p = paths(${JSON.stringify(root)}), service = new Fake(p);
    ${phase === 'published' ? 'service.install = async () => process.exit(73);' : ''}
    await install(p, service, { source: ${JSON.stringify(source)}, installPackages: ${phase === 'temporary' ? '() => process.exit(73)' : 'installPackages'} });
  `], { encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  assert.deepEqual(readFileSync(p.runtimeDescriptor), before);
  if (phase === 'temporary') assert(readdirSync(p.runtimes).some(x => x.startsWith('.runtime-')));
  await installReal(p, service, { source, installPackages });
  assert.notDeepEqual(readFileSync(p.runtimeDescriptor), before);
  assert(!readdirSync(p.runtimes).some(x => x.startsWith('.runtime-')));
  await uninstall(p, service);
});

test('late service failure does not switch the old descriptor', async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-runtime-late-failure-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = paths(root), source = join(root, 'source'), service = new Fake(p);
  mkdirSync(join(source, 'skills'), { recursive: true }); copyRuntimeSources(source);
  await installReal(p, service, { source, installPackages });
  const before = readFileSync(p.runtimeDescriptor), id = readRuntimeDescriptor(p).id;
  const main = join(source, 'orchestrator/main.mts'); writeFileSync(main, readFileSync(main, 'utf8') + '\n// new version\n');
  service.failEnable = true;
  await assert.rejects(installReal(p, service, { source, installPackages }), /Simulated/);
  assert.deepEqual(readFileSync(p.runtimeDescriptor), before);
  assert.equal(readRuntimeDescriptor(p).id, id);
  service.failEnable = false;
  await uninstall(p, service);
});

test('async install transaction fences a competing install and uninstall', async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-runtime-transaction-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = paths(root), source = join(root, 'source'), service = new Fake(p);
  mkdirSync(join(source, 'skills'), { recursive: true }); copyRuntimeSources(source);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = service.install.bind(service);
  service.install = async options => { entered(); await gate; return original(options); };
  const installing = installReal(p, service, { source, installPackages });
  await started;
  await assert.rejects(installReal(p, new Fake(p), { source, installPackages }), /transaction has live or unknown owner/);
  await assert.rejects(uninstall(p, new Fake(p)), /transaction has live or unknown owner/);
  release(); await installing;
  assert(readRuntimeDescriptor(p).id);
  await uninstall(p, service);
});

for (const kind of ['ledger', 'lease']) for (const phase of ['partial', 'staged']) test(`interrupted ${kind} ${phase} durable metadata write does not strand the store`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-runtime-metadata-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = paths(root), service = new Fake(p);
  await installReal(p, service, { installPackages });
  const id = readRuntimeDescriptor(p).id;
  const url = pathToFileURL(resolve('cli/src/runtime-ownership.mts')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { withRuntimeLock, recordRuntimeOwnership, acquireRuntimeLease } from ${JSON.stringify(url)};
    const p = ${JSON.stringify(p)};
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (${phase === 'partial' ? "String(from).includes('/metadata/') && String(from).endsWith('.tmp')" : "String(from).includes('/metadata/') && !String(from).endsWith('.tmp')"}) process.exit(73);
      return original(from, to);
    };
    syncBuiltinESMExports();
    ${kind === 'ledger' ? `withRuntimeLock(p, () => recordRuntimeOwnership(p, ${JSON.stringify(id)}));` : `acquireRuntimeLease(p, ${JSON.stringify(id)});`}
  `], { encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  assert(readdirSync(join(p.data, 'runtime-ownership', 'metadata')).length > 0);
  assert.equal(readRuntimeDescriptor(p).id, id);
  await installReal(p, service, { installPackages });
  assert.equal(readdirSync(join(p.data, 'runtime-ownership', 'metadata')).length, 0);
  await uninstall(p, service);
});

test('unknown and dead lease owners and unknown bundles fail closed', async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-runtime-lease-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = paths(root), service = new Fake(p);
  await installReal(p, service, { installPackages });
  const lease = acquireRuntimeLease(p, readRuntimeDescriptor(p).id), file = join(p.runtimes, '.leases', `${lease.token}.json`);
  writeFileSync(file, JSON.stringify({ ...lease, owner: { pid: process.pid } }));
  await assert.rejects(uninstall(p, service), /live or unknown/);
  writeFileSync(file, JSON.stringify({ ...lease, owner: { pid: process.pid, start: 'different-start' } }));
  mkdirSync(join(p.runtimes, 'unknown'));
  await assert.rejects(uninstall(p, service), /Unknown ownership/);
  rmSync(join(p.runtimes, 'unknown'), { recursive: true });
  await uninstall(p, service);
  assert(!existsSync(p.runtimes));
});
