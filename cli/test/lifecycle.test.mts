// Lifecycle tests run inside a disposable HOME with no host service manager calls.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { paths } from '../src/paths.mts';
import { Fake } from '../src/platform/fake.mts';
import { install, repository } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { readManifest } from '../src/manifest.mts';
function fixture(t: TestContext) {
  const home = mkdtempSync(join(tmpdir(), 'factory-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const p = paths(home);
  return { p, service: new Fake(p) };
}
test('uninstall removes exactly the manifest, preserving unrelated services and state', async t => {
  const { p, service } = fixture(t);
  await install(p, service);
  const other = join(dirname(p.systemd), 'factory-other.service');
  const unrelated = join(p.home, 'keep.txt');
  writeFileSync(other, 'unrelated');
  writeFileSync(unrelated, 'keep');
  writeFileSync(join(p.state, 'run.json'), '{}');
  mkdirSync(p.config, { recursive: true });
  writeFileSync(join(p.config, '.env'), 'keep');
  const before = readFileSync(p.manifest, 'utf8');
  await uninstall(p, service, { dryRun: true });
  assert.equal(readFileSync(p.manifest, 'utf8'), before);
  assert.equal(await service.status(), 'active');
  await uninstall(p, service);
  for (const path of [p.app, p.bin, p.systemd, p.manifest]) assert.equal(existsSync(path), false, path);
  for (const path of [other, unrelated, join(p.state, 'run.json'), join(p.config, '.env')]) assert.ok(existsSync(path), path);
  await uninstall(p, service);
  assert.ok(existsSync(other));
});
test('install twice reuses entries and refreshes copied code', async t => {
  const { p, service } = fixture(t);
  await install(p, service);
  writeFileSync(join(p.app, 'cli/bin/factory.mts'), 'stale');
  await install(p, service);
  const entries = readManifest(p)!.entries;
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map(e => e.path)).size, 3);
  assert.ok(entries.every(e => existsSync(e.path)));
  assert.match(readFileSync(join(p.app, 'cli/bin/factory.mts'), 'utf8'), /parseArgs/);
});
for (const phase of ['unit write', 'enable']) test(`crash recovery after ${phase} failure`, async t => {
  const { p, service } = fixture(t);
  service.failInstall = phase === 'unit write';
  service.failEnable = phase === 'enable';
  await assert.rejects(install(p, service), /Simulated/);
  assert.equal(readManifest(p)!.entries.length, phase === 'unit write' ? 2 : 3);
  await uninstall(p, service);
  for (const path of [p.app, p.bin, p.systemd, p.manifest]) assert.equal(existsSync(path), false);
});
test('--link reinstall and uninstall never delete the source checkout', async t => {
  const { p, service } = fixture(t);
  await install(p, service, { link: true });
  await install(p, service, { link: true });
  assert.ok(lstatSync(p.app).isSymbolicLink());
  await uninstall(p, service);
  assert.ok(existsSync(join(repository, 'cli/bin/factory.mts')));
});
test('refuses unowned collisions and manifest paths outside HOME', async t => {
  const { p, service } = fixture(t);
  mkdirSync(dirname(p.bin), { recursive: true });
  writeFileSync(p.bin, 'not ours');
  await assert.rejects(install(p, service), /unowned/);
  assert.equal(readFileSync(p.bin, 'utf8'), 'not ours');
  rmSync(p.bin);
  await install(p, service);
  const m = readManifest(p)!;
  m.entries.push({ kind: 'dir', path: '/tmp/not-factory' });
  writeFileSync(p.manifest, JSON.stringify(m));
  await assert.rejects(uninstall(p, service), /Unsafe/);
  assert.ok(existsSync(p.app));
});
test('refuses deletion through a parent symlink outside HOME', async t => {
  const { p, service } = fixture(t);
  await install(p, service);
  rmSync(dirname(p.bin), { recursive: true });
  symlinkSync(tmpdir(), dirname(p.bin), 'dir');
  await assert.rejects(uninstall(p, service), /escapes HOME/);
  assert.ok(existsSync(p.app));
});
