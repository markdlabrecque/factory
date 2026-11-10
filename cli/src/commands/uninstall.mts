// Reverse the ownership ledger, never glob-delete services or modify projects.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readManifest, validate } from '../manifest.mts';
import type { Paths } from '../paths.mts';
import { run } from '../platform/index.mts';
import type { ServiceBackend } from '../platform/index.mts';
export async function uninstall(p: Paths, service: ServiceBackend, options: { dryRun?: boolean; purge?: boolean } = {}) {
  const m = readManifest(p);
  if (!m) {
    console.log('Nothing installed: no manifest. No files removed.');
    for (const [dir, prefix] of [[dirname(p.systemd), 'factory-'], [dirname(p.launchd), 'com.factory.']]) {
      if (existsSync(dir)) for (const name of readdirSync(dir).filter(n => n.startsWith(prefix))) console.log(`Untracked service, left untouched: ${join(dir, name)}`);
    }
    return;
  }
  for (const entry of [...m.entries].reverse()) {
    validate(p, entry);
    console.log(`${options.dryRun ? 'Would remove' : 'Removing'} ${entry.kind}: ${entry.path}`);
    if (options.dryRun) continue;
    if (entry.kind === 'systemd' || entry.kind === 'launchd') await service.remove(entry);
    else rmSync(entry.path, { recursive: entry.kind === 'dir', force: true });
  }
  if (options.purge) {
    // Reuse validation's parent-symlink guard for the two retained data folders.
    for (const path of [p.config, p.state]) {
      validate({ ...p, app: path }, { kind: 'dir', path });
      console.log(`${options.dryRun ? 'Would remove' : 'Removing'} ${path}`);
      if (!options.dryRun) rmSync(path, { recursive: true, force: true });
    }
    console.log(`${options.dryRun ? 'Would remove' : 'Removing'} Docker images labelled factory.managed=true`);
    if (!options.dryRun) {
      const images = run('docker', ['image', 'ls', '--filter', 'label=factory.managed=true', '--quiet']).split(/\s+/).filter(Boolean);
      if (images.length) run('docker', ['image', 'rm', ...new Set(images)]);
    }
  } else console.log(`Keeping config and history: ${p.config}, ${p.state}`);
  console.log('Projects are untouched. No project registry exists in this slice.');
  if (process.platform === 'linux') console.log('If linger was enabled, it has been left enabled.');
  console.log(`${options.dryRun ? 'Would remove' : 'Removing'} manifest: ${p.manifest}`);
  if (!options.dryRun) rmSync(p.manifest, { force: true });
}
