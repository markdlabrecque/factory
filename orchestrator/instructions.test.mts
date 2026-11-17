// Instruction loading uses only temporary checkout files and no agent or service boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadInstructions } from './instructions.mts';

test('common and role instructions freeze in order, deduplicating canonical aliases', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-instructions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'common.md'), 'literal {{TICKET}} $(echo nope)');
  writeFileSync(join(root, 'impl.md'), 'implement');
  writeFileSync(join(root, 'verify.md'), 'verify');
  symlinkSync('common.md', join(root, 'alias.md'));
  const lists = { common: ['common.md'], implementation: ['alias.md', 'impl.md'], verification: ['verify.md'], analysis: [], recovery: [], supervisor: ['impl.md'], gateReview: ['verify.md'] };
  const frozen = loadInstructions(root, lists, 'implementation');
  assert.equal(frozen.text, 'literal {{TICKET}} $(echo nope)\n\nimplement');
  assert.deepEqual(Object.keys(frozen.hashes), ['common.md', 'impl.md']);
  assert.equal(loadInstructions(root, lists, 'verification').text, 'literal {{TICKET}} $(echo nope)\n\nverify');
  assert.equal(loadInstructions(root, lists, 'supervisor').text, 'literal {{TICKET}} $(echo nope)\n\nimplement');
  assert.equal(loadInstructions(root, lists, 'gateReview').text, 'literal {{TICKET}} $(echo nope)\n\nverify');
  writeFileSync(join(root, 'impl.md'), 'changed');
  assert.equal(frozen.text, 'literal {{TICKET}} $(echo nope)\n\nimplement');
  assert.notEqual(frozen.hashes['impl.md'], loadInstructions(root, lists, 'implementation').hashes['impl.md']);
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.hashes));
  const paths=['a.md','b.md','c.md','d.md'];
  for (const [i,path] of paths.entries()) writeFileSync(join(root,path),'x'.repeat(256*1024-(i===3?6:0)));
  const bounded={...lists,common:paths,implementation:[]};
  assert.equal(Buffer.byteLength(loadInstructions(root,bounded,'implementation').text),1024*1024,'aggregate boundary includes separators');
  writeFileSync(join(root,'d.md'),'x'.repeat(256*1024-5));
  assert.throws(()=>loadInstructions(root,bounded,'implementation'),/aggregate/);
  writeFileSync(join(root,'a.md'),'x'.repeat(256*1024+1));
  assert.throws(()=>loadInstructions(root,bounded,'implementation'),/oversized/);
  assert.throws(()=>loadInstructions(root,{...lists,common:Array(129).fill('missing.md')},'implementation'),/128 configured paths/,'path cap precedes file reads');
});

test('unreadable instruction fails closed', t => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root can read mode-000 files');
  const root = mkdtempSync(join(tmpdir(), 'factory-unreadable-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'private.md');
  writeFileSync(path, 'private');
  chmodSync(path, 0);
  const lists = { common: ['private.md'], implementation: [], verification: [], analysis: [], recovery: [], supervisor: [], gateReview: [] };
  assert.throws(() => loadInstructions(root, lists, 'analysis'), /Cannot load instruction file/);
});

test('empty lists and invalid, missing, directory, and escaping paths', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-instructions-'));
  const outside = mkdtempSync(join(tmpdir(), 'factory-instructions-outside-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  mkdirSync(join(root, 'dir.md'));
  writeFileSync(join(outside, 'outside.md'), 'outside');
  symlinkSync(join(outside, 'outside.md'), join(root, 'escape.md'));
  const lists = { common: [] as string[], implementation: [] as string[], verification: [] as string[], analysis: [] as string[], recovery: [] as string[], supervisor: [] as string[], gateReview: [] as string[] };
  assert.equal(loadInstructions(root, lists, 'analysis').text, '');
  for (const path of ['/absolute.md', '../outside.md', 'missing.md', 'dir.md', 'escape.md', 'plain.txt']) {
    assert.throws(() => loadInstructions(root, { ...lists, analysis: [path] }, 'analysis'), undefined, path);
  }
});
