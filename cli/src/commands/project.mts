// `factory project add|ls|rm`: edit the registry only. Never writes into, or deletes from, a project. `ls` also
// shows each project's scheduler switch (`[scheduled: <branch>]`, `[schedule paused]`; none when never opted in).
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Paths } from '../paths.mts';
import { addProject, canonicalRoot, listProjects, readRegistry, removeProject } from '../projects.mts';
export async function project(p: Paths, action: string | undefined, path: string | undefined, options: { json?: boolean } = {}) {
  if (action === 'add') {
    const root = canonicalRoot(path ?? process.cwd());
    console.log(addProject(p, root) ? `Added ${root}` : `Already registered: ${root}`);
  } else if (action === 'ls') {
    const rows = listProjects(p);
    if (options.json) console.log(JSON.stringify({ version: 1, projects: rows }, null, 2));
    else if (!rows.length) console.log('No projects registered.');
    else for (const r of rows) console.log(`${r.name}  ${r.root}${r.exists ? '' : '  [checkout missing]'}${r.exists && !r.scaffold ? '  [no .sandcastle yet]' : ''}${!r.schedule ? '' : r.schedule.enabled ? `  [scheduled: ${r.schedule.branch}]` : '  [schedule paused]'}`);
  } else if (action === 'rm') {
    const target = path ?? process.cwd();
    let root: string;
    if (existsSync(target)) {
      try { root = canonicalRoot(target); } catch { root = realpathSync(target); }
    } else {
      // A deleted checkout can only be named by its recorded absolute root.
      root = resolve(target);
      if (resolve(target) !== target || !readRegistry(p).projects.some(x => x.root === root)) {
        console.log(`Not registered: ${target}`);
        return;
      }
    }
    console.log(removeProject(p, root) ? `Removed ${root} from the registry. Project files untouched.` : `Not registered: ${root}`);
  } else throw new Error('Usage: factory project add|ls|rm [path]');
}
