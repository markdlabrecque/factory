// Service adapters write first; install records ownership before enable/start can fail. The board is one service;
// the scheduler (`factory schedule`) is a tick service plus its timer, written by installScheduler, which hands each
// unit to `record` as soon as its file exists. Scheduler units exist on Linux only so far (macOS is #35).
import { execFileSync } from 'node:child_process';
import { Systemd } from './systemd.mts';
import { Launchd } from './launchd.mts';
import type { Paths } from '../paths.mts';
import type { ManifestEntry } from '../manifest.mts';
export type ServiceSpec = { app: string; node: string; state: string };
export type ServiceStatus = 'active' | 'inactive' | 'missing';
/** The scheduler's tick: `node` and `factory` (the installed factory.mts) run `factory schedule tick`; `path` is the
 *  PATH the tick's passes need (the unit gets no shell profile); `home` is Factory's HOME. */
export type SchedulerSpec = { node: string; factory: string; path: string; home: string };
/** `timer` is the timer unit's state; `tick` is 'running' while a tick is in progress. */
export type SchedulerStatus = { timer: ServiceStatus; tick: 'running' | 'idle'; lastTick?: string };
export interface ServiceBackend {
  install(spec: ServiceSpec): Promise<ManifestEntry>;
  enable(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<ServiceStatus>;
  remove(entry: ManifestEntry): Promise<void>;
  installScheduler(spec: SchedulerSpec, record: (entry: ManifestEntry) => void): Promise<void>;
  startScheduler(): Promise<void>;
  stopScheduler(): Promise<void>;
  schedulerStatus(): Promise<SchedulerStatus>;
}
export function run(command: string, args: string[]) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function backend(p: Paths): ServiceBackend {
  if (process.platform === 'linux') return new Systemd(p);
  if (process.platform === 'darwin') return new Launchd(p);
  throw new Error(`Unsupported platform: ${process.platform}`);
}
