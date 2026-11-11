// Service adapters write first; install records ownership before enable/start can fail.
import { execFileSync } from 'node:child_process';
import { Systemd } from './systemd.mts';
import { Launchd } from './launchd.mts';
import type { Paths } from '../paths.mts';
import type { ManifestEntry } from '../manifest.mts';
export type ServiceSpec = { app: string; node: string; state: string };
export type ServiceStatus = 'active' | 'inactive' | 'missing';
export interface ServiceBackend {
  install(spec: ServiceSpec): Promise<ManifestEntry>;
  enable(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<ServiceStatus>;
  remove(entry: ManifestEntry): Promise<void>;
}
export function run(command: string, args: string[]) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function backend(p: Paths): ServiceBackend {
  if (process.platform === 'linux') return new Systemd(p);
  if (process.platform === 'darwin') return new Launchd(p);
  throw new Error(`Unsupported platform: ${process.platform}`);
}
