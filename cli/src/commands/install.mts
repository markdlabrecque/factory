// Install only Factory-owned paths, recording each artifact before starting services.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, record, validate } from '../manifest.mts';
import { boardURL } from '../paths.mts';
import type { Paths } from '../paths.mts';
import type { ServiceBackend } from '../platform/index.mts';
export const repository = fileURLToPath(new URL('../../../', import.meta.url));
export function nodeSupported(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 18);
}
export function legacyPaths(p: Paths) {
  const found = [join(p.home, '.config/sandcastle'), join(p.home, '.local/state/sandcastle')].filter(existsSync);
  for (const [dir, prefix] of [[dirname(p.systemd), 'sandcastle-'], [dirname(p.launchd), 'com.sandcastle.']]) {
    if (existsSync(dir)) found.push(...readdirSync(dir).filter(name => name.startsWith(prefix)).map(name => join(dir, name)));
  }
  return found;
}
export async function install(p: Paths, service: ServiceBackend, options: { link?: boolean; source?: string } = {}) {
  if (!nodeSupported()) throw new Error(`Node 22.18+ required; found ${process.versions.node}`);
  const source = realpathSync(options.source || repository);
  const manifest = readManifest(p);
  const entries = [ { kind: 'dir' as const, path: p.app }, { kind: 'file' as const, path: p.bin },
    process.platform === 'darwin' ? { kind: 'launchd' as const, label: 'com.factory.board', path: p.launchd } : { kind: 'systemd' as const, unit: 'factory-board.service', path: p.systemd } ];
  for (const entry of entries) {
    validate(p, entry);
    let present = false;
    try { lstatSync(entry.path); present = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (present && !manifest?.entries.some(e => e.path === entry.path)) throw new Error(`Refusing to overwrite unowned path: ${entry.path}`);
  }
  mkdirSync(p.data, { recursive: true });
  if (resolve(source) !== resolve(p.app)) {
    // In --link mode the source resolves through app; never delete the source checkout.
    if (!options.link && source.startsWith(p.app + '/')) throw new Error('Source cannot be inside the installed app');
    const alreadyLinked = existsSync(p.app) && lstatSync(p.app).isSymbolicLink() && realpathSync(p.app) === source;
    if (!alreadyLinked || !options.link) {
      rmSync(p.app, { recursive: true, force: true });
      if (options.link) symlinkSync(source, p.app, 'dir');
      else {
        // Record the app before copying, so an interrupted copy is removable.
        mkdirSync(p.app, { recursive: true });
        record(p, entries[0]);
        for (const name of ['cli', 'board', 'orchestrator', 'skills']) cpSync(join(source, name), join(p.app, name), { recursive: true });
      }
    }
  }
  record(p, entries[0]);
  mkdirSync(dirname(p.bin), { recursive: true });
  rmSync(p.bin, { force: true });
  symlinkSync(join(p.app, 'cli/bin/factory.mts'), p.bin);
  record(p, entries[1]);
  mkdirSync(p.state, { recursive: true });
  const entry = await service.install({ app: p.app, node: process.execPath, state: p.state });
  record(p, entry);
  await service.enable();
  await service.start();
  const old = legacyPaths(p);
  if (old.length) console.warn(`Legacy Sandcastle paths left untouched (adoption is not available yet):\n${old.join('\n')}`);
  if (!(process.env.PATH || '').split(':').includes(dirname(p.bin))) console.log(`Add to your shell: export PATH="${dirname(p.bin)}:$PATH"`);
  console.log(`Installed ${p.bin}\nBoard: ${boardURL}`);
}
