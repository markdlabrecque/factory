// Project registry: ~/.config/factory/projects.json, {version:1, projects:[{name,root}]}. A project's
// identity is its canonical (realpath) Git checkout root, never its name. Writes are temp-file + rename under
// an exclusive sibling lock, so concurrent adds are never silently lost. A malformed or unsupported file is
// reported and left untouched. Holds no tokens, and never touches a project's files.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { scaffoldName } from './paths.mts';
import type { Paths } from './paths.mts';
export type Project = { name: string; root: string };
export type Registry = { version: 1; projects: Project[] };
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
export function readRegistry(p: Paths): Registry {
  if (!existsSync(p.projects)) return { version: 1, projects: [] };
  let data: any;
  try { data = JSON.parse(readFileSync(p.projects, 'utf8')); } catch { throw new Error(`Project registry is not valid JSON: ${p.projects}. Fix or remove it; Factory will not overwrite it.`); }
  const ok = data?.version === 1 && Array.isArray(data.projects)
    && data.projects.every((x: any) => typeof x?.name === 'string' && typeof x?.root === 'string' && isAbsolute(x.root));
  if (!ok) throw new Error(`Unsupported project registry: ${p.projects}. Fix or remove it; Factory will not overwrite it.`);
  return data;
}
function mutate(p: Paths, change: (r: Registry) => boolean): boolean {
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
