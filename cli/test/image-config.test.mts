// Configuration discovery reads data without executing project code, including legacy fallback and ambiguous overrides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readImageConfig } from '../src/image-config.mts';
import { buildAssets } from '../src/scaffold.mts';
test('TOML is authoritative even when executable legacy code throws', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-image-config-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const f of buildAssets({ profile: 'personal', repo: 'owner/repo', image: 'reviewed-image' }, join(root, 'state'))) {
    mkdirSync(join(root, f.path, '..'), { recursive: true }); writeFileSync(join(root, f.path), f.content);
  }
  rmSync(join(root, '.sandcastle/factory.toml'));
  assert.deepEqual(readImageConfig(root), { ok: true, image: 'reviewed-image' }, 'shipped legacy fallback is understood without importing main');
  for (const f of buildAssets({ profile: 'personal', repo: 'owner/repo', image: 'reviewed-image' }, join(root, 'state'))) {
    if (f.path.endsWith('/factory.toml')) writeFileSync(join(root, f.path), f.content);
  }
  writeFileSync(join(root, '.sandcastle/main.mts'), 'throw Error("MUST NOT EXECUTE");');
  assert.deepEqual(readImageConfig(root), { ok: true, image: 'reviewed-image' });
});
for (const [code, ok] of [
  ['const CONFIG = { image: "local-image", sandboxSetup: [{command:"true"}] };', true],
  ["const CONFIG = { image: 'single-quoted' };", true],
  ['const CONFIG = effectiveConfig ? effectiveConfig.config : { image: "fallback", sandboxSetup: [] }; console.log(CONFIG.image);', true],
  ['// const CONFIG = { image: "fake" };\nconst CONFIG = {image:"real"};', true],
  ['const CONFIG = { image: process.env.IMAGE };', false],
  ['const CONFIG = { image: "one", image: "two" };', false],
  ['const CONFIG = { image: "one", ...custom };', false],
  ['const CONFIG = { image: "one", [field]: "two" };', false],
  ['const CONFIG = { image: "one" }; CONFIG.image = "two";', false],
  ['const CONFIG = { image: "one" }; CONFIG["image"] = "two";', false],
  ['const CONFIG = { image: "one" }; Object.assign(CONFIG, {image:"two"});', false],
  ['const CONFIG = { image: "one" }; const alias = CONFIG;', false],
  ['const CONFIG = { image: "one" }; const CONFIG = { image: "two" };', false],
  ['const CONFIG = { image: `dynamic-${value}` };', false],
  ['const CONFIG = { image: "one" + suffix };', false],
  ['const CONFIG = chooseImage();', false],
] as const) test(`legacy discovery ${ok ? 'accepts' : 'holds'} ${code}`, t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-legacy-image-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.sandcastle'));
  const sentinel = join(root, 'executed');
  writeFileSync(join(root, '.sandcastle/main.mts'), `require('fs').writeFileSync(${JSON.stringify(sentinel)},'unsafe');\n${code}`);
  assert.equal(readImageConfig(root).ok, ok);
  assert.equal(existsSync(sentinel), false);
});
