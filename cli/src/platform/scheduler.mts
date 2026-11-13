// The scheduler's service-manager interface and platform choice. The service manager is the only source of global
// scheduling state: `status()` reports the scheduler job's enablement and activity and whether a tick is running as
// separate observations, and a failed query throws (callers treat that as unknown, never as on or off).
//   install  writes the job's files, handing each to `record` as soon as it exists, and never starts anything;
//   enable   enables and starts the job (the first tick follows after a minute);
//   disable  disables the job first, then stops it and the active tick and waits. It does not touch ticket runs.
//            Factory then confirms the tick and its dispatcher group are gone (tick-cancel.mts);
//   remove   deletes one ledgered file by exact identity, after stopping it.
// `files` are the paths install writes (`schedule on` refuses ones Factory does not own); `logHint` is how to read
// the tick log. `timers()` is the Board's read-only view of the same job (every `factory-tick` timer, each with its next run when
// the manager or the supervisor knows it, never last-run or timing data).
// Linux: systemd, factory-tick.timer starting the oneshot factory-tick.service (scheduler-systemd.mts). There `timer` is
// the timer and `tick` the service. macOS: launchd, the com.factory.tick agent, a supervisor that runs the ticks itself
// (scheduler-launchd.mts, commands/supervise.mts). There `timer` is the agent (active = running), `loaded` whether
// launchd has it loaded, `enabled` its launchd enablement, and `tick` whether a tick holds the tick lock. Other
// platforms refuse. Tests inject a fake backend or put a stub `systemctl`/`launchctl` first on PATH.
import { SystemdSchedule } from './scheduler-systemd.mts';
import { LaunchdSchedule, TICK_LABEL } from './scheduler-launchd.mts';
import type { ManifestEntry } from '../manifest.mts';
import type { Paths } from '../paths.mts';
export type UnitState = 'active' | 'inactive' | 'missing';
/** `timer` and `enabled` describe the scheduler job (factory-tick.timer, or the com.factory.tick agent); `tick` is
 *  whether a tick is running. `loaded` is launchd's own observation, absent on systemd. */
export type ScheduleStatus = { timer: UnitState; enabled: boolean; tick: UnitState; loaded?: boolean; lastTick?: string };
/** `node` and `app` give `node <app>/cli/bin/factory.mts tick|supervise`; `path` is the PATH passes need; `state` is the shared run-state folder. */
export type ScheduleSpec = { node: string; app: string; state: string; path: string };
/** One scheduler timer as the Board reads it: the manager's id for it, its status, and when it next fires (epoch ms) when known. */
export type TimerReport = { id: string; status: ScheduleStatus; nextAt?: number };
/** A read-only query must not hang its caller. */
export const QUERY_TIMEOUT_MS = 5000;
export interface ScheduleBackend {
  readonly files: string[];
  readonly logHint: string;
  install(spec: ScheduleSpec, record: (entry: ManifestEntry) => void): Promise<void>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  status(): Promise<ScheduleStatus>;
  /** Read-only: every `factory-tick` timer the manager reports (the macOS agent counts as one), with its next run. Throws when the manager can't be read. */
  timers(): Promise<TimerReport[]>;
  remove(entry: ManifestEntry): Promise<void>;
}
export const TICK_UNITS = ['factory-tick.service', 'factory-tick.timer'];
export const isTickEntry = (e: ManifestEntry) => (e.kind === 'systemd' && TICK_UNITS.includes(e.unit ?? '')) || (e.kind === 'launchd' && e.label === TICK_LABEL);

class Unavailable implements ScheduleBackend {
  readonly files: string[] = [];
  readonly logHint = '';
  private fail(): never { throw new Error(`The scheduler is not available on ${process.platform}. Run passes with factory dispatch.`); }
  async install(): Promise<void> { this.fail(); }
  async enable(): Promise<void> { this.fail(); }
  async disable(): Promise<void> { this.fail(); }
  async status(): Promise<ScheduleStatus> { return this.fail(); }
  async timers(): Promise<TimerReport[]> { return this.fail(); }
  async remove(): Promise<void> { this.fail(); }
}
export function scheduleBackend(p: Paths): ScheduleBackend {
  return process.platform === 'linux' ? new SystemdSchedule(p) : process.platform === 'darwin' ? new LaunchdSchedule(p) : new Unavailable();
}
