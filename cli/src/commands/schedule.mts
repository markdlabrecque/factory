// `factory schedule on|off [project]`, `factory schedule status [--json]` and `factory schedule tick`.
// - `on` (no project) needs `factory install` first. It writes factory-tick.service and factory-tick.timer (Linux;
//   macOS is #35), recording each in the manifest as it is written, turns the global switch on and enables the
//   timer: the first tick about a minute later, then one five minutes after each tick finishes. It records the
//   current PATH in the service, since the units get no shell profile; rerun it to refresh. Refuses unit files
//   Factory does not own. It never touches legacy `sandcastle-dispatch` timers: it prints the exact commands to
//   disable them, since running both would double passes.
// - `off` (no project) turns the global switch off and disables the timer. A tick in progress finishes its
//   current pass and visits no more projects; runs already launched keep going. `factory uninstall` removes the units.
// - `on|off <project>` (a registered name or a path in its checkout) flips one project's switch (schedule.mts):
//   `on` saves the branch checked out now. `on` refuses a project whose `.sandcastle` dispatcher copy predates
//   launch reservations (#32), since scheduled admission would undercount; refresh that copy by hand first.
// - `status` shows both switches, the timer and, for every registered project, why it would not get a scheduled
//   pass, or `ready`.
// - `tick` is what the service runs (tick.mts); SIGTERM interrupts it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Paths } from '../paths.mts';
import { scaffoldName } from '../paths.mts';
import { readManifest, record } from '../manifest.mts';
import type { ServiceBackend } from '../platform/index.mts';
import { canonicalRoot, readRegistry } from '../projects.mts';
import type { Project } from '../projects.mts';
import { currentBranch, readScheduler, scheduleBlocker, setProjectSchedule, setScheduler } from '../schedule.mts';
import { tick } from '../tick.mts';
import type { TickOptions } from '../tick.mts';

/** A registered project by name, or by a path inside (or the recorded root of) its checkout. */
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

/** Why a project's `.sandcastle` copy can't be scheduled safely, or null. */
function copyProblem(root: string): string | null {
  const scaffold = join(root, scaffoldName);
  if (!existsSync(join(scaffold, 'dispatch.sh'))) return `no ${scaffoldName}/dispatch.sh. Run: factory init ${root}`;
  const read = (name: string) => { try { return readFileSync(join(scaffold, name), 'utf8'); } catch { return ''; } };
  if (!read('dispatch.mts').includes('reserveRun(') || !read('board.mts').includes('export function reserveRun'))
    return `its ${scaffoldName} dispatcher copy predates launch reservations, so scheduled passes could overfill the run cap. Copy dispatch.mts, main.mts and board.mts from Factory's orchestrator/ and board/ into ${scaffold} (see "Updating a project's copy of the workflow"), then opt in again.`;
  return null;
}

export async function schedule(p: Paths, service: ServiceBackend, action: string | undefined, target: string | undefined,
  o: { json?: boolean; tick?: TickOptions } = {}): Promise<number> {
  if (action === 'tick') {
    if (target) throw new Error('Unexpected arguments');
    const r = await tick(p, o.tick);
    return r.result === 'interrupted' ? 143 : 0;
  }
  if (action === 'status') {
    if (target) throw new Error('Unexpected arguments');
    return status(p, service, o.json), 0;
  }
  if (action !== 'on' && action !== 'off') throw new Error('Usage: factory schedule on|off [project] | status [--json]');
  const on = action === 'on';
  if (target) {
    const project = findProject(p, target);
    if (on) { const problem = copyProblem(project.root); if (problem) throw new Error(`Not scheduling ${project.name}: ${problem}`); }
    const s = setProjectSchedule(p, project.root, on);
    if (on) {
      console.log(`Scheduled ${project.name} on branch ${s!.branch}. Scheduled passes use only that branch and skip the project while another is checked out.`);
      if (!readScheduler(p).enabled) console.log('The scheduler is off, so nothing runs yet. Turn it on with: factory schedule on');
    } else console.log(s ? `Paused ${project.name}. A pass already running finishes; runs it launched keep going.` : `${project.name} was not scheduled.`);
    return 0;
  }
  if (on) {
    if (!readManifest(p)) throw new Error('Factory is not installed. Run factory install first.');
    const owned = readManifest(p)!.entries.map(e => e.path);
    for (const path of [p.tickService, p.tickTimer]) if (existsSync(path) && !owned.includes(path)) throw new Error(`Refusing to overwrite unowned path: ${path}`);
    await service.installScheduler({ node: process.execPath, factory: join(p.app, 'cli/bin/factory.mts'), path: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', home: p.home }, e => record(p, e));
    setScheduler(p, true);
    await service.startScheduler();
    console.log('Scheduler on: the first tick in about a minute, then one 5 minutes after each tick finishes.');
    console.log('The tick uses the PATH recorded now; after installing tools elsewhere, run factory schedule on again.');
    const scheduled = readRegistry(p).projects.filter(x => x.schedule?.enabled);
    console.log(scheduled.length ? `Scheduled projects: ${scheduled.map(x => x.name).join(', ')}` : 'No project is scheduled yet. Opt one in with: factory schedule on <project>');
    for (const line of legacyAdvice(p)) console.warn(line);
  } else {
    setScheduler(p, false);
    await service.stopScheduler();
    console.log('Scheduler off. A tick in progress finishes its current pass and visits no more projects; launched runs keep going.');
  }
  return 0;
}

async function status(p: Paths, service: ServiceBackend, json?: boolean) {
  const global = readScheduler(p);
  let timer: string;
  let tickState = '';
  let lastTick: string | undefined;
  try { const s = await service.schedulerStatus(); timer = s.timer; tickState = s.tick; lastTick = s.lastTick; }
  catch (e) { timer = `unknown (${e instanceof Error ? e.message.split('\n')[0] : e})`; }
  const projects = readRegistry(p).projects.map(x => {
    const exists = existsSync(x.root);
    return { name: x.name, root: x.root, schedule: x.schedule ?? null, blocker: scheduleBlocker(global, x, exists, exists ? currentBranch(x.root) : null) };
  });
  const legacy = legacyTimers(p);
  if (json) {
    console.log(JSON.stringify({ version: 1, scheduler: { ...global, timer, tick: tickState || null, lastTick: lastTick ?? null }, legacyTimers: legacy, projects }, null, 2));
    return;
  }
  console.log(`Scheduler: ${global.enabled ? 'on' : 'off'}${global.since ? ` since ${global.since}` : ''}`);
  console.log(`Timer: ${timer}${tickState === 'running' ? '  (a tick is running)' : ''}${lastTick ? `  last tick ${lastTick}` : ''}`);
  if (global.enabled && (timer === 'missing' || timer === 'inactive')) console.log('  The switch is on but the timer is not running. Run: factory schedule on');
  if (!global.enabled && timer === 'active') console.log('  The switch is off; ticks skip every project.');
  for (const line of legacyAdvice(p)) console.log(line);
  if (!projects.length) console.log('No projects registered.');
  for (const x of projects) console.log(`${x.name}  ${x.schedule ? `${x.schedule.enabled ? 'on' : 'paused'} (${x.schedule.branch})` : 'off'}  ${x.blocker ?? 'ready'}`);
  console.log('Tick log: journalctl --user -u factory-tick');
}
