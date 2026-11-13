// Linux scheduler: factory-tick.service (a oneshot that runs `factory tick`) and factory-tick.timer, written from
// templates/ with exact quoted paths. Only the timer is enabled. Every systemctl call is `systemctl --user ...` with a
// fixed argument list, run through `run` (so a stub on PATH sees exactly these calls). Timer enablement is read from
// UnitFileState and timer activity from ActiveState, separate from the tick service's activity. Output that does not
// parse is an error, not a guess. `files` are the two unit files; the log is the journal. Tick stop and kill behaviour comes from the unit's directives (KillMode=process,
// TimeoutStopSec, TimeoutStartSec=infinity); systemd implements them, Factory only supplies them.
// `timers()` (the Board's strip) asks `list-timers --all --output=json factory-tick*.timer` for every Factory tick timer and
// its next run (`next`, epoch microseconds; `show` prints the monotonic next elapse as a span, which can't be used), always
// including factory-tick.timer so a missing or disabled one still reads as such. Each timer's state comes from the same `show`
// calls as status(). Legacy `sandcastle-dispatch@` timers never match the pattern. Board queries are asynchronous and timed out.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { run, runAsync } from './index.mts';
import { QUERY_TIMEOUT_MS } from './scheduler.mts';
import type { ScheduleBackend, ScheduleSpec, ScheduleStatus, TimerReport, UnitState } from './scheduler.mts';
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
const show = (unit: string, properties: string, timeout?: number) => run('systemctl', ['--user', 'show', unit, `--property=${properties}`], timeout);
const prop = (out: string, key: string): string => {
  const m = out.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) throw new Error(`systemctl show gave no ${key}: ${JSON.stringify(out)}`);
  return m[1];
};
const loaded = (unit: string) => prop(show(unit, 'LoadState'), 'LoadState') !== 'not-found';
const TIMER = /^factory-tick[A-Za-z0-9@._-]*\.timer$/;
const SERVICE = /^factory-tick[A-Za-z0-9@._-]*\.service$/;
/** One timer's and its service's state from `systemctl show`. `lastTick` is the timer's last trigger when known. */
function observe(timerUnit: string, serviceUnit: string, timeout?: number): ScheduleStatus {
  const timer = show(timerUnit, 'LoadState,ActiveState,UnitFileState,LastTriggerUSec', timeout);
  const service = show(serviceUnit, 'LoadState,ActiveState', timeout);
  return observed(timer, service);
}
function observed(timer: string, service: string): ScheduleStatus {
  const state = (out: string): UnitState => prop(out, 'LoadState') === 'not-found' ? 'missing'
    : ['active', 'activating', 'deactivating', 'reloading'].includes(prop(out, 'ActiveState')) ? 'active' : 'inactive';
  const last = timer.match(/^LastTriggerUSec=(.+)$/m)?.[1];
  return { timer: state(timer), enabled: prop(timer, 'UnitFileState') === 'enabled', tick: state(service),
    ...(last && last !== 'n/a' && last !== '0' ? { lastTick: last } : {}) };
}
export class SystemdSchedule implements ScheduleBackend {
  readonly p: Paths;
  readonly files: string[];
  readonly logHint = 'journalctl --user -u factory-tick';
  constructor(p: Paths) { this.p = p; this.files = [p.tickService, p.tickTimer]; }
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
  async status(): Promise<ScheduleStatus> { return observe('factory-tick.timer', 'factory-tick.service'); }
  async timers(): Promise<TimerReport[]> {
    const listed: unknown = JSON.parse(await runAsync('systemctl', ['--user', 'list-timers', '--all', '--output=json', '--no-pager', 'factory-tick*.timer'], QUERY_TIMEOUT_MS));
    if (!Array.isArray(listed)) throw new Error(`systemctl list-timers gave no list: ${JSON.stringify(listed)}`);
    const rows = new Map<string, { next: number; service: string }>();
    for (const r of listed) {
      if (typeof r?.unit !== 'string' || !TIMER.test(r.unit)) continue;
      rows.set(r.unit, { next: typeof r.next === 'number' && r.next > 0 ? Math.floor(r.next / 1000) : 0,
        service: typeof r.activates === 'string' && SERVICE.test(r.activates) ? r.activates : r.unit.replace(/\.timer$/, '.service') });
    }
    if (!rows.has('factory-tick.timer')) rows.set('factory-tick.timer', { next: 0, service: 'factory-tick.service' });
    return Promise.all([...rows].sort(([a], [b]) => (a === 'factory-tick.timer' ? -1 : b === 'factory-tick.timer' ? 1 : a.localeCompare(b))).map(async ([id, r]) => {
      const showAsync = (unit: string, properties: string) => runAsync('systemctl', ['--user', 'show', unit, `--property=${properties}`], QUERY_TIMEOUT_MS);
      const [timer, service] = await Promise.all([
        showAsync(id, 'LoadState,ActiveState,UnitFileState,LastTriggerUSec'),
        showAsync(r.service, 'LoadState,ActiveState'),
      ]);
      const { lastTick: _last, ...status } = observed(timer, service); // the Board shows no last-run time
      return { id, status, ...(status.timer === 'active' && r.next ? { nextAt: r.next } : {}) };
    }));
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
