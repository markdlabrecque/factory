// Reverse the ownership ledger, never glob-delete services or modify projects. When the ledger has scheduler units, the
// scheduler is stopped first (stopScheduling: disable and stop the timer, stop the tick service and wait, confirm the tick
// and its dispatcher pass group are gone), and only then is any ledgered file removed. If that fails, uninstall stops
// there with the ledger, unit files, app and runtime state untouched, so it can be retried. Ticket runs are never
// signalled. Entries are routed by exact identity: scheduler units to the schedule backend, everything else to the board
// adapter. --dry-run changes and signals nothing and makes no service-manager call.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readManifest, validate } from '../manifest.mts';
import { scaffoldName, shq } from '../paths.mts';
import type { Paths } from '../paths.mts';
import { readRegistry } from '../projects.mts';
import { run } from '../platform/index.mts';
import type { ServiceBackend } from '../platform/index.mts';
import { isTickEntry, scheduleBackend } from '../platform/scheduler.mts';
import type { ScheduleBackend } from '../platform/scheduler.mts';
import type { CancelOptions } from '../tick-cancel.mts';
import { describeStop, stopScheduling } from './schedule.mts';
export async function uninstall(p: Paths, service: ServiceBackend, options: { dryRun?: boolean; purge?: boolean; schedule?: ScheduleBackend; cancel?: CancelOptions } = {}) {
  const m = readManifest(p);
  if (!m) {
    console.log('Nothing installed: no manifest. No files removed.');
    for (const [dir, prefix] of [[dirname(p.systemd), 'factory-'], [dirname(p.launchd), 'com.factory.']]) {
      if (existsSync(dir)) for (const name of readdirSync(dir).filter(n => n.startsWith(prefix))) console.log(`Untracked service, left untouched: ${join(dir, name)}`);
    }
    return;
  }
  // List before --purge deletes the registry. Project scaffolds are never removed by uninstall.
  try {
    for (const project of readRegistry(p).projects) {
      const scaffold = join(project.root, scaffoldName);
      console.log(`Project scaffold, not removed: ${scaffold}\n  To remove it yourself: rm -rf ${shq(scaffold)}`);
    }
  } catch (e) { console.log(`Could not read the project registry: ${(e as Error).message}`); }
  for (const entry of m.entries) validate(p, entry);
  const scheduling = options.schedule ?? (m.entries.some(isTickEntry) ? scheduleBackend(p) : undefined);
  if (m.entries.some(isTickEntry)) {
    console.log(`${options.dryRun ? 'Would stop' : 'Stopping'} the scheduler: disable the timer, stop the tick service, cancel the active tick and its dispatcher pass. Ticket runs keep going.`);
    if (!options.dryRun) console.log(describeStop(await stopScheduling(scheduling!, p, options.cancel)));
  }
  for (const entry of [...m.entries].reverse()) {
    console.log(`${options.dryRun ? 'Would remove' : 'Removing'} ${entry.kind}: ${entry.path}`);
    if (options.dryRun) continue;
    if (isTickEntry(entry)) await scheduling!.remove(entry);
    else if (entry.kind === 'systemd' || entry.kind === 'launchd') await service.remove(entry);
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
  console.log('Projects are untouched; the project registry is kept unless --purge removed Factory config.');
  if (process.platform === 'linux') console.log('If linger was enabled, it has been left enabled.');
  console.log(`${options.dryRun ? 'Would remove' : 'Removing'} manifest: ${p.manifest}`);
  if (!options.dryRun) rmSync(p.manifest, { force: true });
}
