// Shared project and run lookup for the slice 3 commands (dispatch, run, retry, status, logs). Picks the
// registered project a command is for (`--project <name|path>`, else the registered checkout the caller is
// standing in), reads its tracker name from `.sandcastle/config.mts` (the name its run records carry), and
// finds its run records in the shared run-state folder and its run and repair (recover-<n>.log, #62) log files. Read-only: it never writes a
// record, the registry or a project file. A run whose process is gone without finishing is reported as
// stopped (as the board does) but its record is left for the board and dispatcher to update. A launch the
// dispatcher reserved whose process died before the run started is skipped, as the board drops it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { keyFor, PARKED, TERMINAL } from '../../board/board.mts';
import type { RunState } from '../../board/board.mts';
import type { Paths } from './paths.mts';
import { scaffoldName } from './paths.mts';
import { canonicalRoot, readRegistry } from './projects.mts';
import type { Project } from './projects.mts';
export type ProjectContext = Project & { scaffold: string; tracker: string };
export type Run = RunState & { key: string };

/** The project a command is for: `--project` (a registered name, or a path inside a registered checkout), else `cwd`'s checkout. */
export function resolveProject(p: Paths, options: { project?: string; cwd?: string } = {}): ProjectContext {
  const registered = readRegistry(p).projects;
  const known = registered.length ? ` Registered: ${registered.map(x => x.name).join(', ')}.` : ' No projects are registered; run: factory project add';
  let found: Project | undefined;
  if (options.project) {
    const named = registered.filter(x => x.name === options.project);
    if (named.length > 1) throw new Error(`Several registered projects are named ${options.project}: ${named.map(x => x.root).join(', ')}. Pass --project <path> instead.`);
    found = named[0];
    if (!found && existsSync(options.project)) {
      let root: string | undefined;
      try { root = canonicalRoot(options.project); } catch { /* not a checkout: reported below */ }
      found = registered.find(x => x.root === root);
    }
    if (!found) throw new Error(`No registered project ${options.project}.${known}`);
  } else {
    const cwd = options.cwd ?? process.cwd();
    let root: string | undefined;
    try { root = canonicalRoot(cwd); } catch { /* not a checkout: reported below */ }
    found = registered.find(x => x.root === root);
    if (!found) throw new Error(`${root ?? cwd} is not a registered project. Run this inside one, or pass --project <name>.${known}`);
  }
  if (!existsSync(found.root)) throw new Error(`Checkout missing for project ${found.name}: ${found.root}`);
  const scaffold = join(found.root, scaffoldName);
  const config = join(scaffold, 'config.mts');
  if (!existsSync(config)) throw new Error(`No ${scaffoldName}/config.mts in ${found.root}. Run: factory init ${found.root}`);
  // Same reading as dispatch.sh: the first `project: "..."` line is TRACKER.project.
  const tracker = readFileSync(config, 'utf8').match(/^\s*project:\s*"([^"]+)"/m)?.[1];
  if (!tracker) throw new Error(`Couldn't read TRACKER.project from ${config}.`);
  return { ...found, scaffold, tracker };
}

/** The shared run-state folder: SANDCASTLE_STATE_DIR when set (as factory-dispatch.sh honours it), else Factory's state folder. */
export function runStateDir(p: Paths): string {
  const env = process.env.SANDCASTLE_STATE_DIR;
  if (!env) return p.state;
  return env.startsWith('~/') ? resolve(homedir(), env.slice(2)) : resolve(env);
}

/** A ticket argument: `13` or `#13`. */
export function ticketId(arg: string | undefined): string {
  const m = arg?.match(/^#?(\d+)$/);
  if (!m) throw new Error(`Expected a ticket number, got ${arg === undefined ? 'nothing' : JSON.stringify(arg)}`);
  return String(Number(m[1]));
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
function load(dir: string, file: string): Run | undefined {
  try {
    const s: RunState = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (typeof s?.iid !== 'string' || typeof s.stage !== 'string') return undefined;
    if (!TERMINAL.includes(s.stage) && !PARKED.includes(s.stage) && !alive(s.pid)) {
      if (s.starting) return undefined;
      s.note = `process ${s.pid} exited without finishing (last stage: ${s.stage})`;
      s.stage = 'stopped';
    }
    return { ...s, key: file.replace(/\.json$/, '') };
  } catch { return undefined; }
}

/** Every run record of the project, oldest first. Unreadable records are skipped. */
export function projectRuns(p: Paths, ctx: ProjectContext): Run[] {
  const dir = runStateDir(p);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => load(dir, f))
    .filter((r): r is Run => !!r && r.project === ctx.tracker)
    .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
}

/** The record file and (if any) record of one ticket's run in the project. */
export function findRun(p: Paths, ctx: ProjectContext, ticket: string): { file: string; run?: Run } {
  const key = keyFor(ticketId(ticket), ctx.tracker);
  const file = join(runStateDir(p), `${key}.json`);
  return { file, run: existsSync(file) ? load(runStateDir(p), `${key}.json`) : undefined };
}

/** A ticket's run log, as dispatch.mts writes it (`.sandcastle/logs/run-<n>.log`). It may not exist yet. */
export const runLog = (ctx: ProjectContext, ticket: string) => join(ctx.scaffold, 'logs', `run-${ticketId(ticket)}.log`);
/** A ticket's repair log, as the recovery launcher writes it (`.sandcastle/logs/recover-<n>.log`, recovery-run.mts). */
export const recoveryLog = (ctx: ProjectContext, ticket: string) => join(ctx.scaffold, 'logs', `recover-${ticketId(ticket)}.log`);
