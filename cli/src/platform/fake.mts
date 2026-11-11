// In-memory service managers with real fixture files; they never invoke a host manager. `Fake` is the board service.
// `FakeSchedule` models the tick timer's enablement and activity and the tick service's activity as separate states,
// logs every call in order (`calls`), and fails on demand (`fail`: method names, or 'stop' for the tick service stop).
// Its `files` and `logHint` are the Linux ones.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServiceBackend, ServiceSpec, ServiceStatus } from './index.mts';
import type { ScheduleBackend, ScheduleSpec, ScheduleStatus, UnitState } from './scheduler.mts';
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

export class FakeSchedule implements ScheduleBackend {
  timer: UnitState = 'missing';
  enabled = false;
  tick: UnitState = 'missing';
  calls: string[] = [];
  /** Operations that throw: 'install', 'install-timer', 'enable', 'disable', 'stop', 'status', 'remove'. */
  fail = new Set<string>();
  /** Runs inside disable() after the timer is stopped, before the tick service stop; tests use it to order events. */
  onStop?: () => void | Promise<void>;
  readonly p: Paths;
  readonly files: string[];
  readonly logHint = 'journalctl --user -u factory-tick';
  constructor(p: Paths) { this.p = p; this.files = [p.tickService, p.tickTimer]; }
  private step(name: string, op = name) { this.calls.push(name); if (this.fail.has(op)) throw new Error(`Simulated ${op} failure`); }
  async install(_spec: ScheduleSpec, record: (entry: ManifestEntry) => void) {
    this.step('install', 'install');
    mkdirSync(dirname(this.p.tickService), { recursive: true });
    writeFileSync(this.p.tickService, '# Fake factory-tick.service\n');
    record({ kind: 'systemd', unit: 'factory-tick.service', path: this.p.tickService });
    if (this.fail.has('install-timer')) throw new Error('Simulated install-timer failure');
    writeFileSync(this.p.tickTimer, '# Fake factory-tick.timer\n');
    record({ kind: 'systemd', unit: 'factory-tick.timer', path: this.p.tickTimer });
    if (this.timer === 'missing') this.timer = 'inactive';
    if (this.tick === 'missing') this.tick = 'inactive';
  }
  async enable() { this.step('enable'); this.enabled = true; this.timer = 'active'; }
  async disable() {
    this.step('disable');
    if (this.timer !== 'missing') { this.enabled = false; this.timer = 'inactive'; }
    await this.onStop?.();
    this.step('stop');
    if (this.tick !== 'missing') this.tick = 'inactive';
  }
  async status(): Promise<ScheduleStatus> { this.step('status'); return { timer: this.timer, enabled: this.enabled, tick: this.tick }; }
  async remove(entry: ManifestEntry) {
    this.step(`remove ${entry.unit}`, 'remove');
    if (entry.unit === 'factory-tick.timer') { this.timer = 'missing'; this.enabled = false; } else this.tick = 'missing';
    rmSync(entry.path, { force: true });
  }
}
