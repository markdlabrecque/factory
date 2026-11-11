// Scheduler storage and project opt-in. Two separate switches decide whether scheduled work may run:
// - the global switch, ~/.config/factory/scheduler.json `{version:1, enabled, since}`; missing means off;
// - each project's switch, `schedule: {enabled, branch, since}` on its registry entry (projects.mts); missing means
//   off, so new projects are never scheduled until opted in. Opting in saves the branch the checkout has then;
//   scheduled passes use only that branch and never switch branches. Switching a project off keeps the saved branch
//   for display; switching it on again saves the branch checked out at that moment.
// `scheduleBlocker` gives the one-line reason a project would not get a scheduled pass, or null when it would.
// This module only stores and reads switches: it installs no service and starts no work.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Paths } from './paths.mts';
import { mutate } from './projects.mts';
import type { Project, ProjectSchedule } from './projects.mts';
export type SchedulerSwitch = { version: 1; enabled: boolean; since: string | null };

export function readScheduler(p: Paths): SchedulerSwitch {
  if (!existsSync(p.scheduler)) return { version: 1, enabled: false, since: null };
  let data: any;
  try { data = JSON.parse(readFileSync(p.scheduler, 'utf8')); } catch { throw new Error(`Scheduler switch is not valid JSON: ${p.scheduler}. Fix or remove it; Factory will not overwrite it.`); }
  if (data?.version !== 1 || typeof data.enabled !== 'boolean' || !(data.since === null || typeof data.since === 'string'))
    throw new Error(`Unsupported scheduler switch: ${p.scheduler}. Fix or remove it; Factory will not overwrite it.`);
  return data;
}
/** Turn the global switch on or off. True when it changed. */
export function setScheduler(p: Paths, enabled: boolean, now = new Date()): boolean {
  if (readScheduler(p).enabled === enabled) return false;
  mkdirSync(p.config, { recursive: true });
  const temp = `${p.scheduler}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, enabled, since: now.toISOString() }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, p.scheduler);
  } catch (e) { rmSync(temp, { force: true }); throw e; }
  return true;
}

/** The branch checked out in a checkout, or null when HEAD is detached. */
export function currentBranch(root: string): string | null {
  try {
    return execFileSync('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

/** Switch a registered project's scheduling on (saving its current branch) or off. Returns the stored switch
 *  (null for a project switched off that was never opted in). Unchanged switches are not rewritten. */
export function setProjectSchedule(p: Paths, root: string, enabled: boolean, now = new Date()): ProjectSchedule | null {
  let branch: string | null = null;
  if (enabled) {
    if (!existsSync(root)) throw new Error(`Checkout missing: ${root}. Restore it before opting it in.`);
    branch = currentBranch(root);
    if (!branch) throw new Error(`${root} has no branch checked out (detached HEAD). Check out the branch scheduled passes should use, then opt in.`);
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
export function scheduleBlocker(global: SchedulerSwitch, project: Project, exists: boolean, branch: string | null): string | null {
  if (!global.enabled) return 'scheduler is off';
  if (!project.schedule) return 'project not opted in';
  if (!project.schedule.enabled) return 'project paused';
  if (!exists) return 'checkout missing';
  if (branch !== project.schedule.branch) return `checkout is on ${branch ?? 'a detached HEAD'}, scheduled branch is ${project.schedule.branch}`;
  return null;
}
