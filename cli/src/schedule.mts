// Scheduler storage and project opt-in.
// - Global scheduling state belongs to the service manager (systemd on Linux), never to a Factory file: a timer that
//   is enabled and active means on. Factory keeps no global on/off flag. A leftover ~/.config/factory/scheduler.json
//   from earlier builds is ignored.
// - The launch configuration, ~/.config/factory/schedule.json `{version:1, path, node}` (mode 0600, atomic), holds the
//   PATH and absolute Node the tick's dispatcher passes get, since a service has no shell profile. `schedule on`
//   refreshes it. It says nothing about whether scheduling is on.
// - Each project's own switch is `schedule: {enabled, branch, since}` on its registry entry (projects.mts); missing
//   means off, so new projects are never scheduled until opted in. Opting in saves the branch the checkout has then;
//   scheduled passes use only that branch and never switch branches.
// `scheduleBlocker` gives the one-line reason a project would not get a scheduled pass, or null when it would.
// `optInProblem` and `copyProblem` are the checks `schedule on --project` and each tick make before a pass.
// Upgrade advice includes the dispatcher's refresh/analysis files and board's mandatory admission/assessment imports (#78).
// This module only stores, reads and checks: `factory schedule` (commands/schedule.mts) changes things and the tick
// (commands/tick.mts) runs passes.
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Paths } from './paths.mts';
import { scaffoldName } from './paths.mts';
import { mutate } from './projects.mts';
import type { Project, ProjectSchedule } from './projects.mts';
export type ScheduleConfig = { version: 1; path: string; node: string };
/** What the service manager says about scheduling. `on` needs the timer enabled and active; anything else is off, and a
 *  failed query is `unknown`, which blocks new scheduled work just as off does. */
export type Scheduling = { state: 'on' | 'off' | 'unknown'; reason?: string };

/** The saved launch configuration, or null when none was saved. Malformed content throws and is never overwritten.
 *  Fields from older builds (such as an `enabled` flag) are ignored. */
export function readScheduleConfig(p: Paths): ScheduleConfig | null {
  if (!existsSync(p.scheduleConfig)) return null;
  let d: any;
  try { d = JSON.parse(readFileSync(p.scheduleConfig, 'utf8')); } catch { throw new Error(`Schedule configuration is not valid JSON: ${p.scheduleConfig}. Fix or remove it; Factory will not overwrite it.`); }
  if (d?.version !== 1 || typeof d.path !== 'string' || d.path === '' || typeof d.node !== 'string' || !isAbsolute(d.node))
    throw new Error(`Unsupported schedule configuration: ${p.scheduleConfig}. Fix or remove it; Factory will not overwrite it.`);
  return { version: 1, path: d.path, node: d.node };
}
export function writeScheduleConfig(p: Paths, c: { path: string; node: string }): ScheduleConfig {
  if (!c.path) throw new Error('PATH is empty; scheduled passes would find no tools.');
  if (!isAbsolute(c.node)) throw new Error(`Node must be an absolute path, got ${JSON.stringify(c.node)}`);
  readScheduleConfig(p); // a malformed file is reported, not replaced
  const config: ScheduleConfig = { version: 1, path: c.path, node: c.node };
  mkdirSync(p.config, { recursive: true });
  const temp = `${p.scheduleConfig}.${process.pid}.tmp`;
  try { writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, p.scheduleConfig); }
  catch (e) { rmSync(temp, { force: true }); throw e; }
  return config;
}

/** The branch checked out in a checkout, or null when HEAD is detached. */
export function currentBranch(root: string): string | null {
  try {
    return execFileSync('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Why a checkout can't be opted in, or null. The branch must exist on `origin` as of the last fetch: Factory does not
 *  contact the remote here, since that could prompt for credentials. */
export function optInProblem(root: string, branch: string): string | null {
  try { git(root, 'remote', 'get-url', 'origin'); } catch { return `${root} has no \`origin\` remote. Scheduled passes work from a branch that exists on origin.`; }
  try { git(root, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`); }
  catch { return `branch ${branch} is not on origin (as of the last fetch). Push it, run \`git fetch origin\` in ${root}, then opt in again.`; }
  return null;
}

/** Why a project's `.sandcastle` copy can't be scheduled safely, or null. */
export function copyProblem(root: string): string | null {
  const scaffold = join(root, scaffoldName);
  const script = join(scaffold, 'dispatch.sh');
  if (!existsSync(script)) return `no ${scaffoldName}/dispatch.sh. Run: factory init ${root}`;
  try { accessSync(script, constants.X_OK); } catch { return `${script} is not executable. Run: chmod +x ${script}`; }
  const read = (name: string) => { try { return readFileSync(join(scaffold, name), 'utf8'); } catch { return ''; } };
  if (!read('dispatch.mts').includes('reserveRun(') || !read('board.mts').includes('export function reserveRun'))
    return `its ${scaffoldName} dispatcher copy predates launch reservations, so scheduled passes could overfill the run cap. Copy dispatch.mts, refresh.mts, analyze.mts, main.mts and ownership.mts from Factory's orchestrator/, and board.mts, admission.mts, assessment.mts and board.template.html from board/ into ${scaffold} (see "Updating a project's copy of the workflow"), then opt in again.`;
  return null;
}

/** Switch a registered project's scheduling on (saving its current branch) or off. Returns the stored switch
 *  (null for a project switched off that was never opted in). Unchanged switches are not rewritten. */
export function setProjectSchedule(p: Paths, root: string, enabled: boolean, now = new Date()): ProjectSchedule | null {
  let branch: string | null = null;
  if (enabled) {
    if (!existsSync(root)) throw new Error(`Checkout missing: ${root}. Restore it before opting it in.`);
    branch = currentBranch(root);
    if (!branch) throw new Error(`${root} has no branch checked out (detached HEAD). Check out the branch scheduled passes should use, then opt in.`);
    const problem = optInProblem(root, branch);
    if (problem) throw new Error(problem);
  }
  let result: ProjectSchedule | null = null;
  mutate(p, r => {
    const entry = r.projects.find(x => x.root === root);
    if (!entry) throw new Error(`Not registered: ${root}. Run \`factory project add\` first.`);
    const old = entry.schedule;
    if (!enabled) {
      if (!old?.enabled) { result = old ?? null; return false; }
      result = { ...old, enabled: false, since: now.toISOString() };
    } else {
      if (old?.enabled && old.branch === branch) { result = old; return false; }
      result = { enabled: true, branch: branch!, since: now.toISOString() };
    }
    entry.schedule = result;
    return true;
  });
  return result;
}

/** Why a project would not get a scheduled pass now, or null when it would. `branch` is what its checkout has now. */
export function scheduleBlocker(scheduling: Scheduling, project: Project, exists: boolean, branch: string | null): string | null {
  if (scheduling.state === 'off') return `scheduler is off${scheduling.reason ? ` (${scheduling.reason})` : ''}`;
  if (scheduling.state === 'unknown') return `scheduler state unknown${scheduling.reason ? ` (${scheduling.reason})` : ''}`;
  if (!project.schedule) return 'project not opted in';
  if (!project.schedule.enabled) return 'project paused';
  if (!exists) return 'checkout missing';
  if (branch !== project.schedule.branch) return `checkout is on ${branch ?? 'a detached HEAD'}, scheduled branch is ${project.schedule.branch}`;
  return null;
}
