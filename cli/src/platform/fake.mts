// In-memory service manager with real fixture files; never invokes a host manager.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServiceBackend, ServiceSpec, ServiceStatus } from './index.mts';
import type { Paths } from '../paths.mts';
import type { ManifestEntry } from '../manifest.mts';
export class Fake implements ServiceBackend {
  state: ServiceStatus = 'missing';
  failInstall = false;
  failEnable = false;
  readonly p: Paths;
  constructor(p: Paths) { this.p = p; }
  async install(_spec: ServiceSpec) {
    if (this.failInstall) throw new Error('Simulated unit failure');
    mkdirSync(dirname(this.p.systemd), { recursive: true });
    writeFileSync(this.p.systemd, '# Fake Factory board\n');
    this.state = 'inactive';
    return { kind: 'systemd' as const, unit: 'factory-board.service', path: this.p.systemd };
  }
  async enable() { if (this.failEnable) throw new Error('Simulated enable failure'); }
  async start() { this.state = 'active'; }
  async stop() { this.state = 'inactive'; }
  async status() { return this.state; }
  async remove(entry: ManifestEntry) { this.state = 'missing'; rmSync(entry.path, { force: true }); }
}
