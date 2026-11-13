// Lifecycle tests run inside a disposable HOME with no host service manager calls. Install-source tests stand in a
// synthetic checkout and pretend the running script is the installed app. The resume-reminder test registers projects by writing the registry directly.
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
test('install ends with a resume reminder naming opted-in projects, and only when there is something to resume', async t => {
  const { p, service } = fixture(t);
  const logs: string[] = [];
  t.mock.method(console, 'log', (l: string) => logs.push(l));
  await install(p, service);
  assert.equal(logs.some(l => /factory schedule on/.test(l)), false, 'nothing to resume on a fresh install');
  mkdirSync(p.config, { recursive: true });
  writeFileSync(p.projects, JSON.stringify({ version: 1, projects: [
    { name: 'alpha', root: '/alpha', schedule: { enabled: true, branch: 'main', since: '' } },
    { name: 'beta', root: '/beta', schedule: { enabled: false, branch: 'main', since: '' } }] }));
  logs.length = 0;
  await install(p, service);
  assert.equal(logs.at(-1), 'The scheduler is off; install never turns it back on. Opted-in projects waiting: alpha. Resume it with: factory schedule on');
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
function fakeCheckout(t: TestContext, marker: string) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-checkout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['board', 'orchestrator', 'skills']) mkdirSync(join(dir, name));
  mkdirSync(join(dir, 'cli/bin'), { recursive: true });
  writeFileSync(join(dir, 'cli/bin/factory.mts'), marker);
  mkdirSync(join(dir, 'cli/src'));
  return dir;
}
test('the installed factory command installs the checkout it is run from', async t => {
  const { p, service } = fixture(t);
  await install(p, service);
  const checkout = fakeCheckout(t, 'updated checkout');
  // Run as the installed app, from a subfolder of another checkout.
  await install(p, service, { running: p.app, cwd: join(checkout, 'cli/src') });
  assert.equal(readFileSync(join(p.app, 'cli/bin/factory.mts'), 'utf8'), 'updated checkout');
  assert.equal(readManifest(p)!.entries.length, 3);
});
test('the installed factory command outside a checkout refuses and leaves the app alone', async t => {
  const { p, service } = fixture(t);
  await install(p, service);
  writeFileSync(join(p.app, 'cli/bin/factory.mts'), 'installed');
  await assert.rejects(install(p, service, { running: p.app, cwd: p.home }), /not a checkout/);
  assert.equal(readFileSync(join(p.app, 'cli/bin/factory.mts'), 'utf8'), 'installed');
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
