// Linux scheduler: factory-tick.service (a oneshot that runs `factory tick`) and factory-tick.timer, written from
// templates/ with exact quoted paths. Only the timer is enabled. Every systemctl call is `systemctl --user ...` with a
// fixed argument list, run through `run` (so a stub on PATH sees exactly these calls). Timer enablement is read from
// UnitFileState and timer activity from ActiveState, separate from the tick service's activity. Output that does not
// parse is an error, not a guess. Tick stop and kill behaviour comes from the unit's directives (KillMode=process,
// TimeoutStopSec, TimeoutStartSec=infinity); systemd implements them, Factory only supplies them.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { run } from './index.mts';
import type { ScheduleBackend, ScheduleSpec, ScheduleStatus, UnitState } from './scheduler.mts';
import type { ManifestEntry } from '../manifest.mts';
import type { Paths } from '../paths.mts';
const quote = (s: string) => '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
/** An ExecStart= argument: also escape `$`, which ExecStart expands. */
const arg = (s: string) => quote(s.replaceAll('$', () => '$$'));
/** The scheduler's unit files, keyed by unit name. `home` is Factory's HOME (FACTORY_HOME in the unit). */
export function schedulerUnits(spec: ScheduleSpec, home: string): Record<'factory-tick.service' | 'factory-tick.timer', string> {
  const values: Record<string, string> = { NODE: arg(spec.node), FACTORY: arg(`${spec.app}/cli/bin/factory.mts`), PATH: quote(`PATH=${spec.path}`),
    HOME: quote(`FACTORY_HOME=${home}`), STATE: quote(`SANDCASTLE_STATE_DIR=${spec.state}`) };
  const read = (name: string) => readFileSync(new URL(`../../templates/${name}`, import.meta.url), 'utf8').replace(/@([A-Z]+)@/g, (m, key) => values[key] ?? m);
  return { 'factory-tick.service': read('factory-tick.service'), 'factory-tick.timer': read('factory-tick.timer') };
}
const show = (unit: string, properties: string) => run('systemctl', ['--user', 'show', unit, `--property=${properties}`]);
const prop = (out: string, key: string): string => {
  const m = out.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) throw new Error(`systemctl show gave no ${key}: ${JSON.stringify(out)}`);
  return m[1];
};
const loaded = (unit: string) => prop(show(unit, 'LoadState'), 'LoadState') !== 'not-found';
export class SystemdSchedule implements ScheduleBackend {
  readonly p: Paths;
  constructor(p: Paths) { this.p = p; }
  async install(spec: ScheduleSpec, record: (entry: ManifestEntry) => void) {
    mkdirSync(dirname(this.p.tickService), { recursive: true });
    const units = schedulerUnits(spec, this.p.home);
    // The service first: a timer is never on disk without the unit it starts. Each is ledgered before the next is written.
    for (const [unit, path] of [['factory-tick.service', this.p.tickService], ['factory-tick.timer', this.p.tickTimer]] as const) {
      writeFileSync(path, units[unit]);
      record({ kind: 'systemd', unit, path });
    }
    run('systemctl', ['--user', 'daemon-reload']);
  }
  async enable() { run('systemctl', ['--user', 'enable', '--now', 'factory-tick.timer']); }
  async disable() {
    if (loaded('factory-tick.timer')) run('systemctl', ['--user', 'disable', '--now', 'factory-tick.timer']);
    if (loaded('factory-tick.service')) run('systemctl', ['--user', 'stop', 'factory-tick.service']);
  }
  async status(): Promise<ScheduleStatus> {
    const timer = show('factory-tick.timer', 'LoadState,ActiveState,UnitFileState,LastTriggerUSec');
    const service = show('factory-tick.service', 'LoadState,ActiveState');
    const state = (out: string): UnitState => prop(out, 'LoadState') === 'not-found' ? 'missing'
      : ['active', 'activating', 'deactivating', 'reloading'].includes(prop(out, 'ActiveState')) ? 'active' : 'inactive';
    const last = timer.match(/^LastTriggerUSec=(.+)$/m)?.[1];
    return { timer: state(timer), enabled: prop(timer, 'UnitFileState') === 'enabled', tick: state(service),
      ...(last && last !== 'n/a' && last !== '0' ? { lastTick: last } : {}) };
  }
  async remove(entry: ManifestEntry) {
    const unit = entry.unit;
    if (unit !== 'factory-tick.service' && unit !== 'factory-tick.timer') throw new Error(`Not a scheduler unit: ${unit}`);
    if (loaded(unit)) {
      run('systemctl', ['--user', 'stop', unit]);
      try { run('systemctl', ['--user', 'disable', unit]); } catch (error) { if (existsSync(entry.path)) throw error; }
    }
    if (existsSync(entry.path)) rmSync(entry.path);
    run('systemctl', ['--user', 'daemon-reload']);
  }
}
