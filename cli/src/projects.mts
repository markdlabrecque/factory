// Project registry: ~/.config/factory/projects.json, {version:1, projects:[{name,root,schedule?}]}. A project's
// identity is its canonical (realpath) Git checkout root, never its name. Writes are temp-file + rename under
// an exclusive sibling lock, so concurrent adds are never silently lost. A malformed or unsupported file is
// reported and left untouched. Holds no tokens, and never touches a project's files. `schedule` is the project's
// scheduler switch and the branch saved when it was switched on (schedule.mts); missing means off, so a newly
// added project is never scheduled until someone opts it in.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readRegistry } from './project-registry.mts';
import type { Project, Registry } from './project-registry.mts';
export { readRegistry } from './project-registry.mts';
export type { ProjectSchedule, Project, Registry } from './project-registry.mts';
import { scaffoldName } from './paths.mts';
import type { Paths } from './paths.mts';
export type ProjectRow = Project & { exists: boolean; scaffold: boolean };

/** Canonical Git checkout root of a path (worktrees are distinct roots; symlink aliases collapse). */
export function canonicalRoot(path: string): string {
  let real: string;
  try { real = realpathSync(resolve(path)); } catch { throw new Error(`No such directory: ${path}`); }
  let top: string;
  try { top = execFileSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { throw new Error(`Not a Git checkout: ${real}`); }
  return realpathSync(top);
}
export function mutate(p: Paths, change: (r: Registry) => boolean): boolean {
  mkdirSync(p.config, { recursive: true });
  const lock = `${p.projects}.lock`;
  let fd: number;
  try { fd = openSync(lock, 'wx', 0o600); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another factory command is changing the project list (${lock}). Retry shortly; if none is running, delete that file.`);
    throw e;
  }
  try {
    const registry = readRegistry(p);
    if (!change(registry)) return false;
    registry.projects.sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
    const temp = `${p.projects}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 });
      renameSync(temp, p.projects);
    } catch (e) { rmSync(temp, { force: true }); throw e; }
    return true;
  } finally { closeSync(fd); rmSync(lock, { force: true }); }
}
/** True when added, false when the root was already recorded. */
export function addProject(p: Paths, root: string): boolean {
  return mutate(p, r => {
    if (r.projects.some(x => x.root === root)) return false;
    r.projects.push({ name: basename(root), root });
    return true;
  });
}
/** True when an entry was removed. The root may be a deleted checkout. */
export function removeProject(p: Paths, root: string): boolean {
  return mutate(p, r => {
    const n = r.projects.length;
    r.projects = r.projects.filter(x => x.root !== root);
    return r.projects.length !== n;
  });
}
export function listProjects(p: Paths): ProjectRow[] {
  return readRegistry(p).projects.map(x => ({ ...x, exists: existsSync(x.root), scaffold: existsSync(join(x.root, scaffoldName)) }))
    .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
}
