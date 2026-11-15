// Offline npm substitute: creates only locked fixture packages in the supplied runtime directory.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { install as realInstall, repository } from '../src/commands/install.mts';
import { RUNTIME_ASSETS } from '../src/runtime-assets.mts';
export function copyRuntimeSources(destination: string) {
  for (const asset of RUNTIME_ASSETS) {
    const target = join(destination, asset.source); mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repository, asset.source), target);
  }
}
export function installPackages(dir: string) {
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  for (const [key, data] of Object.entries(lock.packages) as [string, any][]) {
    if (!key || (data.optional && (data.os && !data.os.includes(process.platform) || data.cpu && !data.cpu.includes(process.arch)))) continue;
    const path = join(dir, key); mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name: key.slice('node_modules/'.length), version: data.version }));
  }
  for (const [name, bin] of [['tsx', 'dist/cli.mjs'], ['@ai-hero/sandcastle', 'dist/main.js'], [`@esbuild/${process.platform}-${process.arch}`, process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild']]) {
    const path = join(dir, 'node_modules', name, bin); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'fixture', { mode: 0o755 });
  }
}
export const install: typeof realInstall = (p, service, options = {}) => realInstall(p, service, { ...options, installPackages });
