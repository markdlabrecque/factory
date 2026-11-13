// Service adapters write first; install records ownership before enable/start can fail.
// Read-only Board queries use runAsync so a slow manager never blocks the HTTP server.
import { execFile, execFileSync } from 'node:child_process';
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
/** `timeout` (ms) is for read-only queries that must not hang the caller (the board's timer strip); lifecycle calls pass none. */
export function run(command: string, args: string[], timeout?: number) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(timeout ? { timeout } : {}) }).trim();
}
export function runAsync(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout }, (error, stdout) => {
      // Match execFileSync's exit-status field, used to distinguish launchd's missing job.
      if (error) reject(Object.assign(error, { status: typeof error.code === 'number' ? error.code : null }));
      else resolve(stdout.trim());
    });
  });
}
export function backend(p: Paths): ServiceBackend {
  if (process.platform === 'linux') return new Systemd(p);
  if (process.platform === 'darwin') return new Launchd(p);
  throw new Error(`Unsupported platform: ${process.platform}`);
}
