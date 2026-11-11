// The scheduler's service-manager interface and platform choice. The service manager is the only source of global
// scheduling state: `status()` reports the timer's enablement and activity and the tick service's activity as
// separate observations, and a failed query throws (callers treat that as unknown, never as on or off).
//   install  writes the unit files, handing each to `record` as soon as it exists, and never starts anything;
//   enable   enables and starts the timer (the first tick follows after a minute);
//   disable  disables and stops the timer first, then stops the active tick service and waits for it. It does not
//            touch ticket runs. Factory then confirms the tick and its dispatcher group are gone (tick-cancel.mts);
//   remove   deletes one ledgered unit by exact identity, after stopping and disabling it.
// Linux (systemd) is the only platform so far; on macOS every method throws (#35). Tests inject a fake backend or
// put a stub `systemctl` first on PATH.
import { SystemdSchedule } from './scheduler-systemd.mts';
import type { ManifestEntry } from '../manifest.mts';
import type { Paths } from '../paths.mts';
export type UnitState = 'active' | 'inactive' | 'missing';
/** `timer` and `enabled` describe factory-tick.timer; `tick` is the oneshot factory-tick.service (`active` while a tick runs). */
export type ScheduleStatus = { timer: UnitState; enabled: boolean; tick: UnitState; lastTick?: string };
/** `node` and `app` give `node <app>/cli/bin/factory.mts tick`; `path` is the PATH passes need; `state` is the shared run-state folder. */
export type ScheduleSpec = { node: string; app: string; state: string; path: string };
export interface ScheduleBackend {
  install(spec: ScheduleSpec, record: (entry: ManifestEntry) => void): Promise<void>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  status(): Promise<ScheduleStatus>;
  remove(entry: ManifestEntry): Promise<void>;
}
export const TICK_UNITS = ['factory-tick.service', 'factory-tick.timer'];
export const isTickEntry = (e: ManifestEntry) => e.kind === 'systemd' && TICK_UNITS.includes(e.unit ?? '');

class Unavailable implements ScheduleBackend {
  private fail(): never { throw new Error('The scheduler is not available on this platform yet (macOS is #35). Run passes with factory dispatch.'); }
  async install(): Promise<void> { this.fail(); }
  async enable(): Promise<void> { this.fail(); }
  async disable(): Promise<void> { this.fail(); }
  async status(): Promise<ScheduleStatus> { return this.fail(); }
  async remove(): Promise<void> { this.fail(); }
}
export function scheduleBackend(p: Paths): ScheduleBackend {
  return process.platform === 'linux' ? new SystemdSchedule(p) : new Unavailable();
}
