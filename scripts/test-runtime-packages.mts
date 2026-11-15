// Opt-in offline smoke test for real locked packages. Reads only explicitly supplied public npm cache content.
// All npm configuration, cache writes, bundles and execution artifacts live in a disposable fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';

const [cacheSource, npmCli] = process.argv.slice(2);
if (!cacheSource || !npmCli) throw new Error('Usage: node scripts/test-runtime-packages.mts <npm-cache-directory> <npm-cli.js>');
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'factory-locked-packages-'));
try {
  const cache = join(root, 'cache'), home = join(root, 'home'), config = join(root, 'npmrc'), global = join(root, 'global-npmrc');
  mkdirSync(home); writeFileSync(config, ''); writeFileSync(global, '');
  const lock = JSON.parse(readFileSync(join(sourceRoot, 'package-lock.json'), 'utf8'));
  for (const [name, pkg] of Object.entries(lock.packages) as [string, any][]) {
    if (!name || (pkg.optional && (pkg.os && !pkg.os.includes(process.platform) || pkg.cpu && !pkg.cpu.includes(process.arch)))) continue;
    assert(pkg.integrity.startsWith('sha512-'));
    const hex = Buffer.from(pkg.integrity.slice(7), 'base64').toString('hex');
    const suffix = join('content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    const target = join(cache, '_cacache', suffix); mkdirSync(dirname(target), { recursive: true });
    cpSync(join(resolve(cacheSource), '_cacache', suffix), target);
  }
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home,
    npm_config_cache: cache, npm_config_userconfig: config, npm_config_globalconfig: global,
    npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  const bundle = prepareRuntimeBundle({ sourceRoot, runtimeStore: join(root, 'runtimes'), install: directory => {
    const result = spawnSync(process.execPath, [resolve(npmCli), 'ci', '--include=dev', '--include=optional', '--ignore-scripts', '--offline'], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  } });
  const entry = join(bundle.directory, 'locked-smoke.mts');
  writeFileSync(entry, `import assert from 'node:assert/strict';
import * as sandcastle from '@ai-hero/sandcastle';
import { transformSync } from 'esbuild';
const value: number = 42;
assert.equal(value, 42);
assert(Object.keys(sandcastle).length > 0);
assert.match(transformSync('const n: number = 7', { loader: 'ts' }).code, /const n = 7/);
console.log('locked packages usable');
`);
  // A project alias must not redirect any static SDK import before context validation.
  writeFileSync(join(home, 'poison.mts'), 'throw Error("PROJECT CODE EXECUTED");');
  writeFileSync(join(home, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    baseUrl: '.', paths: { '@ai-hero/sandcastle': ['./poison.mts'] },
  } }));
  const tsx = join(bundle.directory, 'node_modules/tsx/dist/cli.mjs');
  const unsafe = spawnSync(process.execPath, [tsx, entry], { cwd: home, env, encoding: 'utf8' });
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /PROJECT CODE EXECUTED/, 'control proves real tsx reads project aliases');
  const result = spawnSync(process.execPath, [tsx, '--tsconfig', join(bundle.directory, 'runtime.tsconfig.json'), entry], { cwd: home, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /locked packages usable/);
  console.log(`PASS: Node ${process.versions.node}, private locked tsx/esbuild/Sandcastle, offline npm ci --ignore-scripts`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
