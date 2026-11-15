// Data-only update fixtures: no project assets or override code are repaired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { buildAssets, writeScaffold } from '../src/scaffold.mts';
import { classifyCopy, applyCopy } from '../src/update.mts';

test('factory and project modes never repair code or data', t => {
  const base = mkdtempSync(join(tmpdir(), 'factory-update-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const p = paths(join(base, 'home'));
  for (const mode of ['factory', 'project']) {
    const root = join(base, mode); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
    writeScaffold(root, buildAssets({ profile: 'personal', repo: 'me/site', image: 'img' }, p.state));
    const dir = join(root, '.sandcastle');
    if (mode === 'project') writeFileSync(join(dir, 'factory.toml'), readFileSync(join(dir, 'factory.toml'), 'utf8') + '\n[workflow]\nmode = "project"\ndirectory = ".sandcastle/workflow"\n');
    mkdirSync(join(dir, 'workflow')); writeFileSync(join(dir, 'workflow/main.mts'), 'custom');
    rmSync(join(dir, '.env.example'));
    const before = readdirSync(dir, { recursive: true }).sort();
    const rows = classifyCopy(p, root);
    assert.ok(rows.every(r => r.class === 'project'));
    assert.equal(rows.some(r => r.file === 'main.mts'), false);
    assert.deepEqual(applyCopy(p, root).created, []);
    assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), before);
    assert.equal(readFileSync(join(dir, 'workflow/main.mts'), 'utf8'), 'custom');
  }
});
