// Cheap byte fixtures prove patch guards; one temporary flat runtime proves the filesystem boundary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { planSandcastlePatch, readSandcastlePatch } from '../src/sandcastle-patch.mts';
import type { SandcastlePatch } from '../src/sandcastle-patch.mts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() {
  const files = new Map(Object.entries({ 'package.json': '{"name":"@ai-hero/sandcastle","version":"0.14.0"}', 'dist/a.js': 'keep .sandcastle end', 'dist/b.js': '.sandcastle untouched' }).map(([p, s]) => [p, Buffer.from(s)]));
  const spec: SandcastlePatch = { ...readSandcastlePatch(), files: [...files].map(([path, bytes]) => {
    const text = bytes.toString(), offset = text.indexOf('.sandcastle'), after = text.replace('.sandcastle', '.factory');
    return { path, before: hash(text), after: hash(after), edits: offset < 0 ? [] : [{ offset, before: '.sandcastle', after: '.factory' }] };
  }) };
  const lock = { lockfileVersion: 3, packages: { 'node_modules/@ai-hero/sandcastle': { version: spec.version, integrity: spec.integrity } } };
  return { spec, lock, files };
}

test('bounded edits preserve unrelated bytes and complete repetition is a no-op', () => {
  const f = fixture(), plan = planSandcastlePatch(f.spec, f.lock, f.files);
  assert.equal(plan.state, 'original');
  assert.equal(plan.files.get('dist/a.js')!.toString(), 'keep .factory end');
  assert.equal(plan.files.get('dist/b.js')!.toString(), '.factory untouched');
  assert.deepEqual(plan.files.get('package.json'), f.files.get('package.json'));
  assert.deepEqual(planSandcastlePatch(f.spec, f.lock, plan.files), { state: 'patched', files: plan.files });
  assert.equal(f.files.get('dist/a.js')!.toString(), 'keep .sandcastle end');
});

test('version, integrity, missing/extra files, drift and mixed states fail closed', () => {
  for (const mutate of [
    f => { f.lock.packages['node_modules/@ai-hero/sandcastle'].version = '0.15.0'; },
    f => { f.lock.packages['node_modules/@ai-hero/sandcastle'].integrity = 'wrong'; },
    f => { f.files.set('package.json', Buffer.from('{"name":"@ai-hero/sandcastle","version":"0.15.0"}')); },
    f => { f.files.delete('dist/a.js'); },
    f => { f.files.set('extra.js', Buffer.from('extra')); },
    f => { f.files.set('dist/a.js', Buffer.from('keep .factory drift')); },
    f => { f.files.set('dist/a.js', Buffer.from('keep .factory end')); },
    f => { f.spec.files[1].edits[0].offset++; },
    f => { f.spec.files[1].after = '0'.repeat(64); },
    f => { f.spec.files[1].path = '../escape'; },
    f => { f.spec.files.push(f.spec.files[1]); },
  ] as ((f: ReturnType<typeof fixture>) => void)[]) {
    const f = fixture(); mutate(f);
    assert.throws(() => planSandcastlePatch(f.spec, f.lock, f.files));
  }
});

test('flat helper validates all private files before writing, repeats safely and rejects links', async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-patch-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(), pkg = join(root, 'node_modules/@ai-hero/sandcastle'); mkdirSync(join(pkg, 'dist'), { recursive: true });
  for (const name of ['sandcastle-patch.mts', 'runtime-assets.mts']) cpSync(new URL(`../src/${name}`, import.meta.url), join(root, name));
  // Import succeeds before the specification, lock or package files even exist.
  const { prepareSandcastlePackage } = await import(pathToFileURL(join(root, 'sandcastle-patch.mts')).href);
  writeFileSync(join(root, 'sandcastle-patch.json'), JSON.stringify(f.spec));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(f.lock));
  for (const [path, bytes] of f.files) writeFileSync(join(pkg, path), bytes);
  writeFileSync(join(pkg, 'dist/b.js'), 'drift');
  assert.throws(() => prepareSandcastlePackage(root), /Unexpected Sandcastle bytes/);
  assert.equal(readFileSync(join(pkg, 'dist/a.js'), 'utf8'), 'keep .sandcastle end');
  writeFileSync(join(pkg, 'dist/b.js'), f.files.get('dist/b.js')!);
  assert.deepEqual(prepareSandcastlePackage(root), { state: 'original', changed: ['dist/a.js', 'dist/b.js'] });
  assert.deepEqual(prepareSandcastlePackage(root), { state: 'patched', changed: [] });
  writeFileSync(join(root, 'runtime-manifest.json'), '{}');
  assert.throws(() => prepareSandcastlePackage(root), /published or manifested runtime/);
  rmSync(join(root, 'runtime-manifest.json'));
  rmSync(join(pkg, 'dist/b.js')); symlinkSync(join(pkg, 'dist/a.js'), join(pkg, 'dist/b.js'));
  assert.throws(() => prepareSandcastlePackage(root), /symlink/);
});

test('tracked specification agrees with the lock and preserves upstream provenance', () => {
  const spec = readSandcastlePatch();
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(spec.version, lock.packages['node_modules/@ai-hero/sandcastle'].version);
  assert.equal(spec.integrity, lock.packages['node_modules/@ai-hero/sandcastle'].integrity);
  for (const path of ['LICENSE', 'package.json', 'dist/index.js.map']) {
    const file = spec.files.find(f => f.path === path)!;
    assert(file); assert.equal(file.before, file.after); assert.deepEqual(file.edits, []);
  }
  for (const path of ['dist/index.js', 'dist/chunk-G2R53CVZ.js', 'dist/main.js', 'dist/index.d.ts']) assert(spec.files.find(f => f.path === path)!.edits.length > 0);
});
