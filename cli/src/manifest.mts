// Atomic ownership ledger. Validate every entry before uninstall can delete anything. Systemd entries are the board
// service and the scheduler's tick service and timer, each only at its own path.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { Paths } from './paths.mts';
export type ManifestEntry = { kind: 'file' | 'dir' | 'systemd' | 'launchd'; path: string; unit?: string; label?: string };
export type Manifest = { version: 1; installedAt: string; platform: string; entries: ManifestEntry[] };
export function readManifest(p: Paths): Manifest | undefined {
  if (!existsSync(p.manifest)) return;
  validate(p, { kind: 'dir', path: p.app });
  const m = JSON.parse(readFileSync(p.manifest, 'utf8'));
  if (m.version !== 1 || !Array.isArray(m.entries)) throw new Error('Unsupported manifest');
  for (const entry of m.entries) validate(p, entry);
  return m;
}
export function validate(p: Paths, entry: ManifestEntry) {
  const units: Record<string, string> = { 'factory-board.service': p.systemd, 'factory-tick.service': p.tickService, 'factory-tick.timer': p.tickTimer };
  const expected = { file: p.bin, dir: p.app, systemd: units[entry?.unit ?? ''] ?? p.systemd, launchd: p.launchd };
  if (!entry || entry.path !== expected[entry.kind] || !resolve(entry.path).startsWith(p.home + sep))
    throw new Error(`Unsafe manifest entry: ${JSON.stringify(entry)}`);
  if (entry.kind === 'systemd' && !Object.hasOwn(units, entry.unit ?? '')) throw new Error('Unexpected unit');
  if (entry.kind === 'launchd' && entry.label !== 'com.factory.board') throw new Error('Unexpected launch agent');
  // Check parents, not the final component: --link deliberately points outside HOME.
  let parent = dirname(entry.path);
  while (!existsSync(parent)) parent = dirname(parent);
  const realHome = realpathSync(p.home);
  const realParent = realpathSync(parent);
  if (realParent !== realHome && !realParent.startsWith(realHome + sep)) throw new Error(`Path escapes HOME: ${entry.path}`);
}
export function saveManifest(p: Paths, m: Manifest) {
  mkdirSync(p.data, { recursive: true });
  const temp = `${p.manifest}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(m, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, p.manifest);
}
export function record(p: Paths, entry: ManifestEntry) {
  validate(p, entry);
  const m = readManifest(p) || { version: 1, installedAt: new Date().toISOString(), platform: process.platform, entries: [] };
  if (!m.entries.some(e => e.path === entry.path)) m.entries.push(entry);
  saveManifest(p, m);
}
