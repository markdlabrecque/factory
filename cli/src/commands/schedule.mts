// `factory schedule on|off|status [--project <name|path>] [--json]`. Without --project the command is for the one global
// scheduler, even inside a checkout; with it, for one registered project (a name, or a path in the checkout or the
// recorded root of a deleted one). `--json` is for status only.
// - Global state belongs to the service manager (systemd on Linux, launchd on macOS). Factory stores no on/off flag: `on`
//   and `off` change the timer (macOS: the com.factory.tick supervisor agent), and `status` asks it, reporting the job's
//   enablement and activity (and on macOS whether it is loaded) and whether a tick is running separately; a failed query
//   shows as `unknown`, never as on.
// - `on` needs `factory install` first. It saves the current PATH and absolute Node (schedule.mts), writes
//   factory-tick.service then factory-tick.timer (Linux) or com.factory.tick.plist (macOS), ledgering each as written,
//   then enables and starts the job: the first tick about a minute later, then one five minutes after each tick finishes
//   (macOS: the supervisor keeps that cadence itself, commands/supervise.mts). If installing or
//   enabling fails, the ledger stays, and the error is reported with what the manager says now. Repeat it to retry or to
//   refresh PATH/Node. It refuses unit files Factory does not own, never touches legacy `sandcastle-dispatch` timers
//   (it prints the commands to disable them) and starts no project that was not opted in.
// - `off` disables and stops the timer, then stops the tick service and waits for it (macOS: disables the label, then boots
//   the agent out, which SIGTERMs the supervisor and waits for it), then confirms the tick and its
//   dispatcher pass group are gone (stopScheduling, tick-cancel.mts). The active tick, its pass and the pass's non-detached
//   children are cancelled and no later project starts; ticket runs already detached keep going. If cancellation can't be
//   confirmed it fails and keeps the runtime files. What it prints comes from what was observed (the manager's tick
//   state before the stop, the lock, and the pass entries that became `interrupted`), so a tick that systemd's stop
//   already cancelled is reported as stopped, and a failed manager query is reported as unknown, never as "no tick".
//   `factory uninstall` removes the units.
// - `on|off --project` flips one project's switch (schedule.mts). `on` saves the branch checked out now and refuses a
//   project with no `origin` branch of that name, a non-executable or missing dispatch.sh, or a `.sandcastle` copy that
//   predates launch reservations (#32); refresh that copy by hand first. `off` touches no project file, keeps the
//   saved branch, and lets a pass already running finish.
// - `status` shows the manager's state and, for every registered project, its switch and why it would not get a pass,
//   or `ready`, and the result of its last pass (state.json). The full status contract is #37.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Paths } from '../paths.mts';
import { readManifest, record } from '../manifest.mts';
import { isTickEntry } from '../platform/scheduler.mts';
import type { ScheduleBackend, ScheduleStatus } from '../platform/scheduler.mts';
import { canonicalRoot, readRegistry } from '../projects.mts';
import type { Project } from '../projects.mts';
import { copyProblem, currentBranch, readScheduleConfig, scheduleBlocker, setProjectSchedule, writeScheduleConfig } from '../schedule.mts';
import { readTickState } from '../schedule-state.mts';
import { cancelTick } from '../tick-cancel.mts';
import type { CancelOptions } from '../tick-cancel.mts';
import { schedulingState } from './tick.mts';

/** A registered project by name, or by a path inside (or the recorded root of) its checkout. Uses the registry only,
 *  so a deleted checkout can still be selected. */
export function findProject(p: Paths, arg: string): Project {
  const registered = readRegistry(p).projects;
  const named = registered.filter(x => x.name === arg);
  if (named.length > 1) throw new Error(`Several registered projects are named ${arg}: ${named.map(x => x.root).join(', ')}. Pass the path instead.`);
  if (named[0]) return named[0];
  let root = resolve(arg);
  if (existsSync(arg)) { try { root = canonicalRoot(arg); } catch { /* not a checkout: compared as given */ } }
  const found = registered.find(x => x.root === root);
  if (!found) throw new Error(`No registered project ${arg}.${registered.length ? ` Registered: ${registered.map(x => x.name).join(', ')}.` : ' Run: factory project add'}`);
  return found;
}

/** Enabled legacy dispatcher timers (install-dispatch.sh). Factory reports them and never touches them. */
export function legacyTimers(p: Paths): string[] {
  const wants = join(dirname(p.systemd), 'timers.target.wants');
  return existsSync(wants) ? readdirSync(wants).filter(n => /^sandcastle-dispatch(@.+)?\.timer$/.test(n)).sort() : [];
}
export function legacyAdvice(p: Paths): string[] {
  const timers = legacyTimers(p);
  if (!timers.length) return [];
  return [`Legacy dispatcher timers are enabled and would run passes too. Factory leaves them alone; disable them yourself:`,
    ...timers.map(t => `  systemctl --user disable --now ${t}`)];
}

/** What stopScheduling saw. `tickActive` is the manager's answer before it stopped anything (null when the query failed,
 *  with the reason in `unknown`); `cancelled` is whether Factory itself had to signal a tick or pass; `interrupted` names the
 *  projects whose `running` entry in state.json is `interrupted` afterwards (cancelled by the stop); `finished` names those whose
 *  entry became `ok`, `error` or `skipped` in the meantime (the pass ended by itself before the stop took effect). */
export type StopReport = { tickActive: boolean | null; unknown?: string; cancelled: boolean; escalated: boolean; interrupted: string[]; finished: string[] };

/** Stops scheduling, in this order: disable and stop the timer, stop the tick service and wait for it, then confirm
 *  the tick and its dispatcher pass group are gone. Throws at the first step that fails; nothing later runs and no file
 *  is removed, so the same call retries safely. Ticket runs are not touched. The report says what was observed, so a
 *  tick that systemd's stop cancelled (and so left no lock) is still reported as stopped. */
export async function stopScheduling(backend: ScheduleBackend, p: Paths, cancel?: CancelOptions): Promise<StopReport> {
  let tickActive: boolean | null = null;
  let unknown: string | undefined;
  try { tickActive = (await backend.status()).tick === 'active'; } catch (e) { unknown = (e instanceof Error ? e.message : String(e)).split('\n')[0]; }
  const results = () => { try { return Object.fromEntries(Object.entries(readTickState(p).projects).map(([root, x]) => [root, x.result])); } catch { return {} as Record<string, string>; } };
  const before = Object.entries(results()).filter(([, result]) => result === 'running').map(([root]) => root);
  await backend.disable();
  const r = await cancelTick(p, cancel);
  const after = results();
  const names = new Map<string, string>();
  try { for (const x of readRegistry(p).projects) names.set(x.root, x.name); } catch { /* roots are shown as they are */ }
  return { tickActive, ...(unknown ? { unknown } : {}), cancelled: r.active, escalated: r.escalated,
    interrupted: before.filter(root => after[root] === 'interrupted').map(root => names.get(root) ?? root),
    finished: before.filter(root => after[root] !== undefined && after[root] !== 'running' && after[root] !== 'interrupted').map(root => names.get(root) ?? root) };
}
/** One sentence for what a stop did, from the report: stopped a tick, found none, or could not tell. */
export function describeStop(r: StopReport): string {
  const who = r.interrupted.length ? ` Its pass for ${r.interrupted.join(', ')} was cancelled and recorded as interrupted.` : '';
  const done = r.finished.length ? ` The pass for ${r.finished.join(', ')} had already finished on its own.` : '';
  const kill = r.escalated ? ' SIGKILL was needed for the pass group.' : '';
  if (r.tickActive || r.cancelled) return `The active tick was stopped.${who}${done}${kill}`;
  if (r.interrupted.length) return `No tick was running, but ${r.interrupted.join(', ')} had a pass recorded as running; it is now recorded as interrupted.${done}`;
  if (r.unknown) return `The service manager could not be read before stopping (${r.unknown}), so Factory can't say whether a tick was running. It found no tick lock or running pass.${done}`;
  return `No tick was running.${done}`;
}

const describe = (s: ScheduleStatus) => s.loaded !== undefined
  ? `supervisor ${s.enabled ? 'enabled' : 'disabled'}/${s.loaded ? 'loaded' : 'not loaded'}/${s.timer === 'active' ? 'running' : 'not running'}, tick ${s.tick}`
  : `timer ${s.enabled ? 'enabled' : 'disabled'}/${s.timer}, tick service ${s.tick}`;
async function observed(backend: ScheduleBackend): Promise<string> {
  try { return describe(await backend.status()); } catch (e) { return `unknown (${(e instanceof Error ? e.message : String(e)).split('\n')[0]})`; }
}

export type ScheduleOptions = { json?: boolean; project?: string; cancel?: CancelOptions };
export async function schedule(p: Paths, backend: ScheduleBackend, action: string | undefined, o: ScheduleOptions = {}): Promise<number> {
  if (action === 'status') { await status(p, backend, o); return 0; }
  if (action !== 'on' && action !== 'off') throw new Error('Usage: factory schedule on|off|status [--project <name|path>] [--json (status)]');
  if (o.json) throw new Error('--json applies to schedule status');
  const on = action === 'on';
  if (o.project !== undefined) return setProject(p, backend, on, o.project);
  if (on) return globalOn(p, backend);
  const r = await stopScheduling(backend, p, o.cancel);
  console.log(`Scheduler off: timer disabled and stopped. ${describeStop(r)} Ticket runs already launched keep going.`);
  return 0;
}

async function setProject(p: Paths, backend: ScheduleBackend, on: boolean, target: string): Promise<number> {
  const project = findProject(p, target);
  if (on) { const problem = copyProblem(project.root); if (problem) throw new Error(`Not scheduling ${project.name}: ${problem}`); }
  const s = setProjectSchedule(p, project.root, on);
  if (on) {
    console.log(`Scheduled ${project.name} on branch ${s!.branch}. Scheduled passes use only that branch and skip the project while another is checked out.`);
    const g = await schedulingState(backend);
    if (g.state !== 'on') console.log(`The scheduler is ${g.state === 'off' ? 'off' : 'in an unknown state'}${g.reason ? ` (${g.reason})` : ''}, so nothing runs yet. Turn it on with: factory schedule on`);
  } else console.log(s ? `Paused ${project.name}. A pass already running finishes; runs it launched keep going.` : `${project.name} was not scheduled.`);
  return 0;
}

async function globalOn(p: Paths, backend: ScheduleBackend): Promise<number> {
  const manifest = readManifest(p);
  if (!manifest) throw new Error('Factory is not installed. Run factory install first.');
  const owned = manifest.entries.map(e => e.path);
  for (const path of backend.files) if (existsSync(path) && !owned.includes(path)) throw new Error(`Refusing to overwrite unowned path: ${path}`);
  const config = writeScheduleConfig(p, { path: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', node: process.execPath });
  try {
    await backend.install({ node: config.node, app: p.app, state: p.state, path: config.path }, e => record(p, e));
    await backend.enable();
  } catch (e) {
    throw new Error(`${(e as Error).message}\nScheduler state now: ${await observed(backend)}. The unit ledger is kept; run factory schedule on again to retry, or factory schedule off.`);
  }
  console.log('Scheduler on: the first tick in about a minute, then one 5 minutes after each tick finishes.');
  console.log(`Timer now: ${await observed(backend)}.`);
  console.log('The tick uses the PATH recorded now; after installing tools elsewhere, run factory schedule on again.');
  const scheduled = readRegistry(p).projects.filter(x => x.schedule?.enabled);
  console.log(scheduled.length ? `Scheduled projects: ${scheduled.map(x => x.name).join(', ')}` : 'No project is scheduled yet. Opt one in with: factory schedule on --project <name>');
  for (const line of legacyAdvice(p)) console.warn(line);
  return 0;
}

async function status(p: Paths, backend: ScheduleBackend, o: ScheduleOptions) {
  const only = o.project !== undefined ? findProject(p, o.project) : undefined;
  const scheduling = await schedulingState(backend);
  let manager: ScheduleStatus | null = null;
  let unknown: string | undefined;
  try { manager = await backend.status(); } catch (e) { unknown = (e instanceof Error ? e.message : String(e)).split('\n')[0]; }
  const tickState = readTickState(p);
  const config = readScheduleConfig(p);
  const projects = readRegistry(p).projects.filter(x => !only || x.root === only.root).map(x => {
    const exists = existsSync(x.root);
    const last = tickState.projects[x.root];
    return { name: x.name, root: x.root, schedule: x.schedule ?? null, blocker: scheduleBlocker(scheduling, x, exists, exists ? currentBranch(x.root) : null), last: last ?? null };
  });
  const legacy = legacyTimers(p);
  const phase = unknown ? 'unknown' : !manager || scheduling.state === 'off' ? (manager?.tick === 'active' ? 'running' : 'off') : manager.tick === 'active' ? 'running' : 'waiting';
  if (o.json) {
    console.log(JSON.stringify({ version: 1,
      scheduler: { service: manager ? manager.timer : 'unknown', serviceEnabled: manager ? manager.enabled : null, timerActive: manager ? manager.timer === 'active' : null,
        tickActive: manager ? manager.tick === 'active' : null, ...(unknown ? { reason: unknown } : {}), phase, cap: 3, intervalMs: 300000,
        ...(tickState.startedAt ? { startedAt: tickState.startedAt } : {}), ...(tickState.finishedAt ? { finishedAt: tickState.finishedAt } : {}),
        ...(tickState.durationMs !== undefined ? { durationMs: tickState.durationMs } : {}), ...(tickState.pid ? { pid: tickState.pid } : {}),
        ...(tickState.currentRoot ? { currentRoot: tickState.currentRoot } : {}), ...(manager?.loaded !== undefined ? { loaded: manager.loaded } : {}), logHint: backend.logHint },
        config: config ? { path: config.path, node: config.node } : null, legacyTimers: legacy, projects }, null, 2));
    return;
  }
  console.log(`Scheduler: ${scheduling.state}${scheduling.reason ? ` (${scheduling.reason})` : ''}`);
  if (manager?.loaded !== undefined) console.log(`Supervisor (launchd com.factory.tick): ${manager.enabled ? 'enabled' : 'disabled'}, ${manager.loaded ? 'loaded' : 'not loaded'}, ${manager.timer === 'active' ? 'running' : 'not running'}; ${manager.tick === 'active' ? 'a tick is running' : 'no tick running'}`);
  else console.log(manager ? `Timer: ${manager.enabled ? 'enabled' : 'disabled'}, ${manager.timer}; tick service: ${manager.tick === 'active' ? 'a tick is running' : manager.tick}${manager.lastTick ? `  last tick ${manager.lastTick}` : ''}` : `Timer: unknown (${unknown})`);
  if (manager && manager.enabled && manager.timer !== 'active') console.log('  The timer is enabled but not running. Run: factory schedule on');
  if (manager && !manager.enabled && manager.timer === 'active') console.log('  The timer is running but not enabled, so ticks skip every project. Run: factory schedule off (or on).');
  for (const line of legacyAdvice(p)) console.log(line);
  if (!projects.length) console.log('No projects registered.');
  for (const x of projects) {
    const l = x.last;
    const lastPass = l && l.result !== 'skipped' ? `  last pass ${l.result}${l.exitCode !== undefined ? ` (exit ${l.exitCode})` : ''}${l.pid && l.result === 'running' ? ` pid ${l.pid}` : ''}${l.reason ? `: ${l.reason}` : ''}` : '';
    console.log(`${x.name}  ${x.schedule ? `${x.schedule.enabled ? 'on' : 'paused'} (${x.schedule.branch})` : 'off'}  ${x.blocker ?? 'ready'}${lastPass}`);
  }
  console.log(`Tick log: ${backend.logHint}`);
}
