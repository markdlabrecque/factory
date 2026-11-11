// Linux user services: the board, and the scheduler's factory-tick.service + factory-tick.timer (templates/). Removal
// handles any unit the manifest records, including an already-missing unit file.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { run } from './index.mts';
import type { SchedulerSpec, SchedulerStatus, ServiceBackend, ServiceSpec, ServiceStatus } from './index.mts';
import type { ManifestEntry } from '../manifest.mts';
import type { Paths } from '../paths.mts';
const quote = (s: string) => '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
/** An ExecStart= argument: also escape `$`, which ExecStart expands. */
const arg = (s: string) => quote(s.replaceAll('$', () => '$$'));
/** The scheduler's unit files, keyed by unit name. */
export function schedulerUnits(spec: SchedulerSpec): Record<'factory-tick.service' | 'factory-tick.timer', string> {
  const values: Record<string, string> = { NODE: arg(spec.node), FACTORY: arg(spec.factory), PATH: quote(`PATH=${spec.path}`), HOME: quote(`FACTORY_HOME=${spec.home}`) };
  const read = (name: string) => readFileSync(new URL(`../../templates/${name}`, import.meta.url), 'utf8').replace(/@([A-Z]+)@/g, (m, key) => values[key] ?? m);
  return { 'factory-tick.service': read('factory-tick.service'), 'factory-tick.timer': read('factory-tick.timer') };
}
export class Systemd implements ServiceBackend {
  readonly p: Paths;
  constructor(p: Paths) { this.p = p; }
  async install(spec: ServiceSpec) {
    let text = readFileSync(new URL('../../templates/factory-board.service', import.meta.url), 'utf8');
    for (const [key, value] of Object.entries({ NODE: spec.node, SERVER: `${spec.app}/board/board-server.mts`, STATE: `SANDCASTLE_STATE_DIR=${spec.state}` })) text = text.replaceAll(`@${key}@`, () => key === 'STATE' ? quote(value) : arg(value));
    mkdirSync(dirname(this.p.systemd), { recursive: true });
    writeFileSync(this.p.systemd, text);
    return { kind: 'systemd' as const, unit: 'factory-board.service', path: this.p.systemd };
  }
  async enable() { run('systemctl', ['--user', 'daemon-reload']); run('systemctl', ['--user', 'enable', 'factory-board.service']); }
  async start() { run('systemctl', ['--user', 'restart', 'factory-board.service']); }
  async stop() { run('systemctl', ['--user', 'stop', 'factory-board.service']); }
  async status(): Promise<ServiceStatus> {
    const state = run('systemctl', ['--user', 'show', 'factory-board.service', '--property=LoadState,ActiveState']);
    if (state.includes('LoadState=not-found')) return 'missing';
    return state.includes('ActiveState=active') ? 'active' : 'inactive';
  }
  async remove(entry: ManifestEntry) {
    const unit = entry.unit || 'factory-board.service';
    const state = run('systemctl', ['--user', 'show', unit, '--property=LoadState,ActiveState']);
    if (!state.includes('LoadState=not-found')) run('systemctl', ['--user', 'stop', unit]);
    try { run('systemctl', ['--user', 'disable', unit]); }
    catch (error) { if (existsSync(entry.path)) throw error; }
    if (existsSync(entry.path)) rmSync(entry.path);
    run('systemctl', ['--user', 'daemon-reload']);
  }
  async installScheduler(spec: SchedulerSpec, record: (entry: ManifestEntry) => void) {
    mkdirSync(dirname(this.p.tickService), { recursive: true });
    const units = schedulerUnits(spec);
    // The service first: a timer is never on disk without the unit it starts.
    for (const [unit, path] of [['factory-tick.service', this.p.tickService], ['factory-tick.timer', this.p.tickTimer]] as const) {
      writeFileSync(path, units[unit]);
      record({ kind: 'systemd', unit, path });
    }
    run('systemctl', ['--user', 'daemon-reload']);
  }
  async startScheduler() { run('systemctl', ['--user', 'enable', '--now', 'factory-tick.timer']); }
  async stopScheduler() {
    if (!run('systemctl', ['--user', 'show', 'factory-tick.timer', '--property=LoadState']).includes('not-found'))
      run('systemctl', ['--user', 'disable', '--now', 'factory-tick.timer']);
  }
  async schedulerStatus(): Promise<SchedulerStatus> {
    const timer = run('systemctl', ['--user', 'show', 'factory-tick.timer', '--property=LoadState,ActiveState,LastTriggerUSec']);
    const service = run('systemctl', ['--user', 'show', 'factory-tick.service', '--property=ActiveState']);
    const last = timer.match(/^LastTriggerUSec=(.+)$/m)?.[1];
    return {
      timer: timer.includes('LoadState=not-found') ? 'missing' : /^ActiveState=active$/m.test(timer) ? 'active' : 'inactive',
      tick: /^ActiveState=activating$/m.test(service) ? 'running' : 'idle',
      ...(last && last !== 'n/a' && last !== '0' ? { lastTick: last } : {}),
    };
  }
}
