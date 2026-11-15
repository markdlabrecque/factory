// Data-only update fixtures: no project assets or override code are repaired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { buildAssets, writeScaffold } from '../src/scaffold.mts';
import { classifyCopy, applyCopy } from '../src/update.mts';
import { update } from '../src/commands/update.mts';
import { addProject } from '../src/projects.mts';

test('factory and project modes never repair code or data', t => {
  const base = mkdtempSync(join(tmpdir(), 'factory-update-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const p = paths(join(base, 'home'));
  for (const mode of ['factory', 'project']) {
    const root = join(base, mode); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
    writeScaffold(root, buildAssets({ profile: 'personal', repo: 'me/site', image: 'img' }, p.state));
    const dir = join(root, '.sandcastle');
    if (mode === 'project') writeFileSync(join(dir, 'factory.toml'), readFileSync(join(dir, 'factory.toml'), 'utf8') + '\n[workflow]\nmode = "project"\ndirectory = ".sandcastle/workflow"\n');
    mkdirSync(join(dir, 'workflow')); writeFileSync(join(dir, 'workflow/main.mts'), 'custom');
    mkdirSync(join(dir, 'instructions')); writeFileSync(join(dir, 'instructions/common.md'), 'literal {{placeholder}}');
    mkdirSync(join(dir, 'helpers')); writeFileSync(join(dir, 'helpers/helper.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(dir, 'helpers/helper.sh'), 0o751); chmodSync(join(dir, 'factory.toml'), 0o640);
    rmSync(join(dir, '.env.example'));
    addProject(p, root);
    const snapshot = () => readdirSync(dir, { recursive: true }).sort().map(name => {
      const path = join(dir, name.toString()), st = lstatSync(path);
      return [name, st.mode, st.mtimeMs, st.isFile() ? readFileSync(path).toString('base64') : null];
    });
    const before = snapshot();
    const rows = classifyCopy(p, root);
    assert.ok(rows.every(r => r.class === 'project'));
    assert.equal(rows.some(r => r.file === 'main.mts'), false);
    assert.deepEqual(applyCopy(p, root).created, []);
    assert.deepEqual(snapshot(), before);
    const output: string[] = [];
    const log = console.log; console.log = (...args) => { output.push(args.join(' ')); };
    try {
      for (const apply of [false, true]) for (const json of [false, true]) {
        output.length = 0;
        assert.equal(update(p, { cwd: root, apply, dryRun: !apply, json }), 0);
        if (json) {
          const report = JSON.parse(output.join('\n'));
          assert.ok(report.files.every((row: { class: string }) => row.class === 'project'));
          if (apply) { assert.deepEqual(report.created, []); assert.deepEqual(report.replaced, []); }
        } else assert.match(output.join('\n'), /never repaired/);
        assert.deepEqual(snapshot(), before);
      }
    } finally { console.log = log; }
    assert.equal(readFileSync(join(dir, 'workflow/main.mts'), 'utf8'), 'custom');
  }
});
