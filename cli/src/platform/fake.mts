// In-memory service manager with real fixture files; never invokes a host manager. Tracks the board service and
// the scheduler timer separately, so removing one leaves the other's state alone.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SchedulerSpec, SchedulerStatus, ServiceBackend, ServiceSpec, ServiceStatus } from './index.mts';
import type { Paths } from '../paths.mts';
import type { ManifestEntry } from '../manifest.mts';
export class Fake implements ServiceBackend {
  state: ServiceStatus = 'missing';
  timer: ServiceStatus = 'missing';
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
  async remove(entry: ManifestEntry) {
    if (entry.unit === 'factory-tick.timer') this.timer = 'missing';
    else if (entry.unit !== 'factory-tick.service') this.state = 'missing';
    rmSync(entry.path, { force: true });
  }
  async installScheduler(_spec: SchedulerSpec, record: (entry: ManifestEntry) => void) {
    mkdirSync(dirname(this.p.tickService), { recursive: true });
    for (const [unit, path] of [['factory-tick.service', this.p.tickService], ['factory-tick.timer', this.p.tickTimer]] as const) {
      writeFileSync(path, `# Fake ${unit}\n`);
      record({ kind: 'systemd', unit, path });
    }
    if (this.timer === 'missing') this.timer = 'inactive';
  }
  async startScheduler() { this.timer = 'active'; }
  async stopScheduler() { if (this.timer !== 'missing') this.timer = 'inactive'; }
  async schedulerStatus(): Promise<SchedulerStatus> { return { timer: this.timer, tick: 'idle' }; }
}
