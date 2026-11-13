// macOS scheduler: the launch agent com.factory.tick (~/Library/LaunchAgents/com.factory.tick.plist, written from
// templates/ with XML-escaped paths), a supervisor running `factory supervise` (commands/supervise.mts), which runs the
// ticks itself on a completion-relative cadence. launchd is the only source of global state; Factory keeps no on/off
// file. Three observations, read separately: enablement (`launchctl print-disabled gui/<uid>`), loaded (`launchctl print
// gui/<uid>/com.factory.tick` succeeds; exit 113 means not loaded) and running (`state = running` in that output). Whether
// a tick is running comes from the tick lock (tick-lock.mts). The domain is checked first (`launchctl print gui/<uid>`),
// so an unreachable launchd throws rather than reading as "not loaded"; output that does not parse throws too.
//   install  disables the label first when the agent is not loaded (so a plist on disk never loads by itself at the next
//            login before `on` enables it), then writes the plist and ledgers it. It starts nothing.
//   enable   `launchctl enable`, then `bootstrap` when not loaded or `kickstart` when loaded but not running.
//   disable  `launchctl disable` BEFORE anything is signalled, then `bootout`, which sends the supervisor SIGTERM and
//            waits for it: the supervisor cancels its dispatcher pass and exits 0 (KeepAlive restarts only on failure).
//   remove   boots out a still-loaded agent and deletes the plist; the label stays disabled.
// timers() is the Board's read-only view: the agent as the one `factory-tick` timer, its next run from the supervisor's own
// record (next-tick.mts, trusted only while that supervisor process is alive), with asynchronous, timed-out queries.
// Every call is `launchctl` with a fixed argument list, through `run`, so a stub on PATH sees exactly these calls.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { run, runAsync } from './index.mts';
import { QUERY_TIMEOUT_MS } from './scheduler.mts';
import type { ScheduleBackend, ScheduleSpec, ScheduleStatus, TimerReport } from './scheduler.mts';
import type { ManifestEntry } from '../manifest.mts';
import type { Paths } from '../paths.mts';
import { readLock, sameProcess } from '../tick-lock.mts';
import { readNextTick } from '../next-tick.mts';
export const TICK_LABEL = 'com.factory.tick';
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
/** The supervisor's launch agent. `home` is Factory's HOME (FACTORY_HOME in the job); `log` receives its output. */
export function supervisorPlist(spec: ScheduleSpec, home: string, log: string): string {
  const values: Record<string, string> = { NODE: spec.node, FACTORY: `${spec.app}/cli/bin/factory.mts`, PATH: spec.path, HOME: home, STATE: spec.state, LOG: log };
  return readFileSync(new URL('../../templates/com.factory.tick.plist', import.meta.url), 'utf8').replace(/@([A-Z]+)@/g, (m, key) => key in values ? escape(values[key]) : m);
}
type Observed = { enabled: boolean; loaded: boolean; running: boolean };
export class LaunchdSchedule implements ScheduleBackend {
  readonly p: Paths;
  readonly domain = `gui/${process.getuid!()}`;
  readonly service = `${this.domain}/${TICK_LABEL}`;
  readonly files: string[];
  readonly logHint: string;
  constructor(p: Paths) { this.p = p; this.files = [p.tickPlist]; this.logHint = `tail -f ${p.tickLog}`; }
  private async observe(): Promise<Observed> {
    await runAsync('launchctl', ['print', this.domain], QUERY_TIMEOUT_MS);
    const overrides = await runAsync('launchctl', ['print-disabled', this.domain], QUERY_TIMEOUT_MS);
    if (!/disabled services = \{/.test(overrides)) throw new Error(`launchctl print-disabled gave no disabled services: ${JSON.stringify(overrides)}`);
    const m = overrides.match(new RegExp(`^\\s*"${TICK_LABEL.replaceAll('.', '\\.')}"\\s*=>\\s*(\\S+)\\s*$`, 'm'));
    if (m && !['disabled', 'enabled', 'true', 'false'].includes(m[1])) throw new Error(`launchctl print-disabled gave ${JSON.stringify(m[0].trim())}`);
    const enabled = !m || m[1] === 'enabled' || m[1] === 'false';
    let out: string;
    try { out = await runAsync('launchctl', ['print', this.service], QUERY_TIMEOUT_MS); }
    catch (e) { if ((e as { status?: number }).status === 113) return { enabled, loaded: false, running: false }; throw e; }
    const state = out.match(/^\s*state = (.+?)\s*$/m);
    if (!state) throw new Error(`launchctl print gave no state: ${JSON.stringify(out.slice(0, 200))}`);
    return { enabled, loaded: true, running: state[1] === 'running' };
  }
  async install(spec: ScheduleSpec, record: (entry: ManifestEntry) => void) {
    if (!(await this.observe()).loaded) run('launchctl', ['disable', this.service]);
    mkdirSync(dirname(this.p.tickPlist), { recursive: true });
    mkdirSync(dirname(this.p.tickLog), { recursive: true });
    writeFileSync(this.p.tickPlist, supervisorPlist(spec, this.p.home, this.p.tickLog));
    record({ kind: 'launchd', label: TICK_LABEL, path: this.p.tickPlist });
  }
  async enable() {
    run('launchctl', ['enable', this.service]);
    const s = await this.observe();
    if (!s.loaded) run('launchctl', ['bootstrap', this.domain, this.p.tickPlist]);
    else if (!s.running) run('launchctl', ['kickstart', this.service]);
  }
  /** Boots the agent out; the job ending between the check and the call is not an error. */
  private async bootout() {
    if (!(await this.observe()).loaded) return;
    try { run('launchctl', ['bootout', this.service]); }
    catch (e) { if ((await this.observe()).loaded) throw e; }
  }
  async disable() {
    const s = await this.observe();
    if (!s.loaded && !existsSync(this.p.tickPlist)) return;
    run('launchctl', ['disable', this.service]);
    await this.bootout();
  }
  async status(): Promise<ScheduleStatus> { return this.statusOf(await this.observe()); }
  async timers(): Promise<TimerReport[]> {
    const status = this.statusOf(await this.observe());
    const next = status.timer === 'active' && status.tick !== 'active' ? readNextTick(this.p) : null;
    return [{ id: TICK_LABEL, status, ...(next !== null ? { nextAt: next } : {}) }];
  }
  private statusOf(s: Observed): ScheduleStatus {
    const timer = s.running ? 'active' : s.loaded || existsSync(this.p.tickPlist) ? 'inactive' : 'missing';
    const lock = readLock(this.p);
    const tick = timer === 'missing' ? 'missing' : lock && sameProcess(lock.tick) ? 'active' : 'inactive';
    return { timer, enabled: timer !== 'missing' && s.enabled, loaded: s.loaded, tick };
  }
  async remove(entry: ManifestEntry) {
    if (entry.kind !== 'launchd' || entry.label !== TICK_LABEL || entry.path !== this.p.tickPlist) throw new Error(`Not the scheduler agent: ${JSON.stringify(entry)}`);
    await this.bootout();
    if (existsSync(entry.path)) rmSync(entry.path);
  }
}
