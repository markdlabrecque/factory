// Image discovery uses v2 data only and never falls back to executable project settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readImageConfig } from '../src/image-config.mts';
import { factoryToml } from './config-fixture.mts';

test('TOML is authoritative even when executable legacy code throws', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-image-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.sandcastle'));
  writeFileSync(join(root, '.sandcastle/factory.toml'), factoryToml('owner/repo', { image: 'reviewed-image' }));
  for (const file of ['config.mts', 'main.mts']) writeFileSync(join(root, '.sandcastle', file), 'throw Error("MUST NOT EXECUTE");');
  assert.deepEqual(readImageConfig(root), { ok: true, image: 'reviewed-image' });
});

for (const config of ['missing', 'version1', 'invalid'] as const) {
  test(`${config} TOML rejects literal executable image fallback without running project code`, t => {
    const root = mkdtempSync(join(tmpdir(), 'factory-image-config-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.sandcastle'));
    const sentinel = join(root, 'executed');
    const sideEffect = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'unsafe');\n`;
    writeFileSync(join(root, '.sandcastle/main.mts'), sideEffect + 'const CONFIG = {image: "legacy-image"};');
    writeFileSync(join(root, '.sandcastle/config.mts'), sideEffect + 'export const TRACKER = {project: "owner/repo"};');
    if (config !== 'missing') writeFileSync(join(root, '.sandcastle/factory.toml'), config === 'version1' ? factoryToml('owner/repo').replace('version = 2', 'version = 1') : 'invalid = [');
    assert.throws(() => readImageConfig(root), /factory.toml/);
    assert.equal(existsSync(sentinel), false);
  });
}
