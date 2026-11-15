// Build and validate content-addressed runtime directories without touching project dependencies.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { RUNTIME_ASSETS, RUNTIME_INVENTORY_VERSION, validateRelativePath, validateRuntimeInventory } from './runtime-assets.mts';
import type { RuntimeAsset } from './runtime-assets.mts';

export const RUNTIME_MANIFEST = 'runtime-manifest.json';
export type RuntimeFile = { path: string; sha256: string; mode: number };
export type RuntimeManifest = { version: 1; inventoryVersion: number; node: { version: string; platform: string; arch: string; minimum: string }; files: RuntimeFile[]; id: string; dependencies: string };
export type PackageInstaller = (directory: string) => void;
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const exists = (path: string) => { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } };
const inside = (root: string, path: string) => { const r = relative(root, path); return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };

// Reject symlinks in source and assembled asset paths, including intermediate directories.
function regularFile(root: string, path: string): string {
  validateRelativePath(path);
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlink in runtime asset: ${path}`);
    if (current !== join(root, path) && !stat.isDirectory()) throw new Error(`Not a directory: ${current}`);
  }
  if (!lstatSync(current).isFile()) throw new Error(`Not a regular runtime asset: ${path}`);
  return current;
}

function identity(node: RuntimeManifest['node'], files: RuntimeFile[]): string {
  return hash(JSON.stringify({ version: 1, inventoryVersion: RUNTIME_INVENTORY_VERSION, node, files }));
}
function metadata() { return { version: process.versions.node, platform: process.platform, arch: process.arch, minimum: '22.18.0' }; }
function checkNode(node: RuntimeManifest['node']) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error('Runtime requires Node 22.18 or newer');
  if (!node || typeof node.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(node.version) || node.minimum !== '22.18.0' || node.platform !== process.platform || node.arch !== process.arch) throw new Error('Runtime Node metadata is incompatible');
}
// V2 entrypoints already require explicit project settings. Preserve source bytes in the bundle.
function sourceBytes(root: string, asset: RuntimeAsset): Buffer {
  return readFileSync(regularFile(root, asset.source));
}
function entries(root: string, assets: readonly RuntimeAsset[], assemble = false): RuntimeFile[] {
  return assets.map(({ source, destination }) => {
    const file = regularFile(root, source), st = lstatSync(file);
    return { path: destination, sha256: hash(assemble ? sourceBytes(root, { source, destination }) : readFileSync(file)), mode: st.mode & 0o777 };
  }).sort((a, b) => order(a.path, b.path));
}

// The versioned source inventory is closed. Overrides may edit listed assets, not add unreviewed helpers.
function validateSourceTree(root: string, assets: readonly RuntimeAsset[]) {
  const files = new Set([...assets.map(asset => asset.destination), RUNTIME_MANIFEST]);
  const directories = new Set<string>();
  for (const file of files) {
    let parent = dirname(file);
    while (parent !== '.') { directories.add(parent); parent = dirname(parent); }
  }
  function walk(directory: string, prefix = '') {
    for (const name of readdirSync(directory)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (path === 'node_modules') continue; // Validated recursively by dependencyHash.
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) throw new Error(`Symlink in runtime asset: ${path}`);
      if (stat.isDirectory() && directories.has(path)) walk(join(root, path), path);
      else if (!stat.isFile() || !files.has(path)) throw new Error(`Unknown runtime source entry: ${path}`);
    }
  }
  walk(root);
}

// Hash every installed file and link, so reuse detects missing or modified transitive dependencies.
function dependencyHash(root: string): string {
  const base = join(root, 'node_modules');
  if (!lstatSync(base).isDirectory() || lstatSync(base).isSymbolicLink()) throw new Error('Missing private node_modules');
  const rows: unknown[] = [];
  function walk(dir: string, prefix: string) {
    for (const name of readdirSync(dir).sort(order)) {
      const path = join(dir, name), rel = prefix ? `${prefix}/${name}` : name, st = lstatSync(path);
      if (st.isSymbolicLink()) {
        const link = readlinkSync(path), resolved = realpathSync(path);
        if (isAbsolute(link) || !inside(base, resolved)) throw new Error(`Unsafe dependency symlink: ${rel}`);
        rows.push([rel, 'link', link]);
      } else if (st.isDirectory()) { rows.push([rel, 'dir', st.mode & 0o777]); walk(path, rel); }
      else if (st.isFile()) rows.push([rel, 'file', st.mode & 0o777, hash(readFileSync(path))]);
      else throw new Error(`Unsupported dependency entry: ${rel}`);
    }
  }
  walk(base, '');
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw new Error('Unsupported package lock');
  for (const [path, data] of Object.entries(lock.packages) as [string, any][]) {
    if (!path) continue;
    const applies = (values: string[] | undefined, value: string) => !values || (!values.includes(`!${value}`) && (values.every(x => x.startsWith('!')) || values.includes(value)));
    if (data.optional && (!applies(data.os, process.platform) || !applies(data.cpu, process.arch))) continue;
    if (!path.startsWith('node_modules/') || data.link || typeof data.version !== 'string') throw new Error(`Unsupported lock entry: ${path}`);
    const rel = path.slice('node_modules/'.length);
    const installed = JSON.parse(readFileSync(regularFile(base, `${rel}/package.json`), 'utf8'));
    if (installed.version !== data.version) throw new Error(`Invalid locked dependency: ${path}`);
  }
  for (const name of ['@ai-hero/sandcastle', 'tsx']) {
    if (!pkg.devDependencies?.[name] || pkg.devDependencies[name] !== lock.packages[''].devDependencies?.[name]) throw new Error(`Missing locked dependency: ${name}`);
    const locked = lock.packages[`node_modules/${name}`];
    const installed = JSON.parse(readFileSync(regularFile(base, `${name}/package.json`), 'utf8'));
    if (!locked?.version || installed.version !== locked.version || installed.name !== name) throw new Error(`Invalid private dependency: ${name}`);
    const bin = typeof locked.bin === 'string' ? locked.bin : locked.bin?.[name === 'tsx' ? 'tsx' : 'sandcastle'];
    if (typeof bin !== 'string') throw new Error(`Missing locked executable: ${name}`);
    regularFile(base, `${name}/${bin}`);
  }
  // With postinstall disabled, tsx resolves esbuild's applicable platform package directly.
  const platformPackage = `@esbuild/${process.platform}-${process.arch}`;
  const binary = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild';
  const executable = regularFile(base, `${platformPackage}/${binary}`);
  if (process.platform !== 'win32' && !(lstatSync(executable).mode & 0o111)) throw new Error('Missing executable esbuild platform binary');
  return hash(JSON.stringify(rows));
}

type NpmRunner = (command: string, args: string[], options: { cwd: string; stdio: 'inherit' }) => { error?: Error; status: number | null; signal?: string | null };
export const installRuntimePackages = (directory: string, run: NpmRunner = spawnSync): void => {
  const result = run('npm', ['ci', '--include=dev', '--include=optional', '--ignore-scripts'], { cwd: directory, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ci failed (${result.status ?? result.signal})`);
};

/** Recompute complete source/dependency metadata without writing files or executing workflow code.
 * Project override maintainers explicitly write this result after reviewing their edits. */
export function regenerateRuntimeManifest(directory: string, node: RuntimeManifest['node'] = metadata()): RuntimeManifest {
  validateRuntimeInventory(RUNTIME_ASSETS);
  checkNode(node);
  const root = resolve(directory);
  if (realpathSync(root) !== root || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error('Invalid canonical workflow directory');
  validateSourceTree(root, RUNTIME_ASSETS);
  const files = entries(root, RUNTIME_ASSETS.map(a => ({ source: a.destination, destination: a.destination })));
  return { version: 1, inventoryVersion: RUNTIME_INVENTORY_VERSION, node, files, id: identity(node, files), dependencies: dependencyHash(root) };
}

/** Validate the full inventory and private dependency snapshot. Never repairs a bundle. */
export function validateRuntimeBundle(directory: string, assets: readonly RuntimeAsset[] = RUNTIME_ASSETS): RuntimeManifest {
  validateRuntimeInventory(assets);
  const root = resolve(directory);
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error('Invalid runtime directory');
  validateSourceTree(root, assets);
  const manifest = JSON.parse(readFileSync(regularFile(root, RUNTIME_MANIFEST), 'utf8')) as RuntimeManifest;
  if (manifest.version !== 1 || manifest.inventoryVersion !== RUNTIME_INVENTORY_VERSION || !Array.isArray(manifest.files)) throw new Error('Invalid runtime manifest');
  checkNode(manifest.node);
  const actual = entries(root, assets.map(a => ({ source: a.destination, destination: a.destination })));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files) || identity(manifest.node, actual) !== manifest.id) throw new Error('Runtime content or identity mismatch');
  if (dependencyHash(root) !== manifest.dependencies) throw new Error('Runtime dependencies changed');
  return manifest;
}

/** Prepare in a sibling directory and publish once. A competing identical publisher is validated before reuse. */
export function prepareRuntimeBundle(options: { sourceRoot: string; runtimeStore: string; install?: PackageInstaller; assets?: readonly RuntimeAsset[]; beforePrepare?: (plan: { id: string; temporary: string }) => void }): { id: string; directory: string; manifest: RuntimeManifest } {
  const assets = options.assets ?? RUNTIME_ASSETS;
  validateRuntimeInventory(assets);
  const source = resolve(options.sourceRoot), store = resolve(options.runtimeStore);
  if (lstatSync(source).isSymbolicLink() || !lstatSync(source).isDirectory()) throw new Error('Invalid runtime source root');
  const node = metadata(); checkNode(node);
  const files = entries(source, assets, true), id = identity(node, files), directory = join(store, id);
  mkdirSync(store, { recursive: true, mode: 0o700 });
  if (lstatSync(store).isSymbolicLink() || !lstatSync(store).isDirectory()) throw new Error('Invalid runtime store');
  const reused = () => { const manifest = validateRuntimeBundle(directory, assets); if (manifest.id !== id) throw new Error('Existing runtime identity mismatch'); return { id, directory, manifest }; };
  if (exists(directory)) return reused();
  const temporary = `.runtime-${randomUUID()}`, temp = join(store, temporary);
  // Reserve ownership durably before creating either temporary or published directories.
  options.beforePrepare?.({ id, temporary });
  mkdirSync(temp, { mode: 0o700 });
  try {
    for (const { source: src, destination } of assets) {
      const from = regularFile(source, src), to = join(temp, destination);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, sourceBytes(source, { source: src, destination }), { flag: 'wx', mode: lstatSync(from).mode & 0o777 });
      chmodSync(to, lstatSync(from).mode & 0o777);
    }
    if (JSON.stringify(entries(temp, assets.map(a => ({ source: a.destination, destination: a.destination })))) !== JSON.stringify(files)) throw new Error('Runtime source changed during preparation');
    (options.install ?? installRuntimePackages)(temp);
    const manifest: RuntimeManifest = { version: 1, inventoryVersion: RUNTIME_INVENTORY_VERSION, node, files, id, dependencies: dependencyHash(temp) };
    writeFileSync(join(temp, RUNTIME_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    validateRuntimeBundle(temp, assets);
    if (exists(directory)) return reused();
    try { renameSync(temp, directory); } catch (error) { if (!exists(directory)) throw error; return reused(); }
    return { id, directory, manifest };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
