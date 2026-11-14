// #137: reject unsafe cap overrides before shell preflight, matching TOML and dispatcher validation.
// `factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]`: one dispatcher pass for one
// project. Runs the project's own `.sandcastle/dispatch.sh` from its checkout root, so its checks (tools,
// logins, .env, image, node deps) and run behaviour stay exactly as before. SANDCASTLE_STATE_DIR is set to
// Factory's shared run-state folder (runStateDir), as factory-dispatch.sh does, so the pass shows on the
// board. Output streams through; the result is dispatch.sh's exit code. `factory run` (run.mts) and the scheduler's
// tick (tick.mts) start dispatch.sh the same way through runDispatchSh. Its optional `SpawnOptions` let the tick set the
// scheduled environment, start dispatch.sh as the leader of its own process group (so cancelling a pass can reach its
// nested children and nothing else) and learn the pid at spawn; manual callers pass none and keep the inherited
// environment, stdin and process group.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from '../paths.mts';
import { scaffoldName } from '../paths.mts';
import { resolveProject, runStateDir } from '../runs.mts';
import type { ProjectContext } from '../runs.mts';
export type DispatchOptions = { project?: string; cwd?: string; dryRun?: boolean; max?: string; wholeIssues?: boolean };

/** The arguments passed on to dispatch.sh. `--max` must be a positive safe integer. */
export function dispatchArgs(o: DispatchOptions): string[] {
  const args: string[] = [];
  if (o.dryRun) args.push('--dry-run');
  if (o.max !== undefined) {
    if (!/^[1-9]\d*$/.test(o.max) || !Number.isSafeInteger(Number(o.max))) throw new Error(`--max needs a positive whole number within the safe integer range, got ${JSON.stringify(o.max)}`);
    args.push('--max', o.max);
  }
  if (o.wholeIssues) args.push('--whole-issues');
  return args;
}

export async function dispatch(p: Paths, o: DispatchOptions = {}): Promise<number> {
  const args = dispatchArgs(o);
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  console.error(`factory: dispatching ${ctx.name} (${ctx.root})`);
  return runDispatchSh(p, ctx, args);
}

/** The project's dispatch.sh; fails when the project has none. */
export function dispatchScript(ctx: ProjectContext): string {
  const script = join(ctx.scaffold, 'dispatch.sh');
  if (!existsSync(script)) throw new Error(`No ${scaffoldName}/dispatch.sh in ${ctx.root}. Run: factory init ${ctx.root}`);
  return script;
}

/** `env` replaces the default environment; `group` starts dispatch.sh in a new process group led by it (its pid is the
 *  group id); `onSpawn` gets the pid synchronously after spawn. If `onSpawn` throws, the new group is killed. */
export type SpawnOptions = { env?: NodeJS.ProcessEnv; group?: boolean; onSpawn?: (pid: number) => void };

/** Runs the project's dispatch.sh from its root against the shared run-state folder; resolves to its exit code. */
export function runDispatchSh(p: Paths, ctx: ProjectContext, args: string[], o: SpawnOptions = {}): Promise<number> {
  const child = spawn(dispatchScript(ctx), args, { cwd: ctx.root, stdio: 'inherit', detached: o.group, env: o.env ?? { ...process.env, SANDCASTLE_STATE_DIR: runStateDir(p) } });
  if (child.pid !== undefined && o.onSpawn) {
    try { o.onSpawn(child.pid); }
    catch (e) { try { process.kill(o.group ? -child.pid : child.pid, 'SIGKILL'); } catch { /* already gone */ } throw e; }
  }
  return new Promise((done, fail) => {
    child.on('error', fail);
    child.on('exit', (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
}
