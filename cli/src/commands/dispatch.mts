// #137: reject unsafe cap overrides before shell preflight, matching TOML and dispatcher validation.
// `factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]`: one dispatcher pass for one
// project. Resolves one complete workflow and runs its dispatch.sh from the checkout root, preserving
// preflight, argv, exit codes and project logs without project dependency installs. SANDCASTLE_STATE_DIR is set to
// Factory's shared run-state folder (runStateDir), as factory-dispatch.sh does, so the pass shows on the
// board. Output streams through; the result is dispatch.sh's exit code. `factory run` (run.mts) and the scheduler's
// tick (tick.mts) start dispatch.sh the same way through runDispatchSh. Its optional `SpawnOptions` let the tick set the
// scheduled environment, start dispatch.sh as the leader of its own process group (so cancelling a pass can reach its
// nested children and nothing else) and learn the pid at spawn; manual callers pass none and keep the inherited
// environment, stdin and process group.
import { spawn } from 'node:child_process';
import { projectWorkflow } from '../workflow.mts';
import type { Paths } from '../paths.mts';
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

/** The selected complete workflow's dispatch.sh; invalid selection fails without fallback. */
export function dispatchScript(ctx: ProjectContext, p: Paths): string {
  return projectWorkflow(p, ctx.root).entrypoints.dispatch;
}

/** `env` replaces the default environment; `group` starts dispatch.sh in a new process group led by it (its pid is the
 *  group id); `onSpawn` gets the pid synchronously after spawn. If `onSpawn` throws, the new group is killed. */
export type SpawnOptions = { env?: NodeJS.ProcessEnv; group?: boolean; onSpawn?: (pid: number) => void };

/** Runs selected dispatch.sh from the project root against shared state; resolves to its exit code. */
export function runDispatchSh(p: Paths, ctx: ProjectContext, args: string[], o: SpawnOptions = {}): Promise<number> {
  const workflow = projectWorkflow(p, ctx.root, o.env);
  const child = spawn(workflow.entrypoints.dispatch, args, { cwd: ctx.root, stdio: 'inherit', detached: o.group, env: { ...(o.env ?? process.env), ...workflow.env, SANDCASTLE_STATE_DIR: o.env?.SANDCASTLE_STATE_DIR ?? runStateDir(p) } });
  if (child.pid !== undefined && o.onSpawn) {
    try { o.onSpawn(child.pid); }
    catch (e) { try { process.kill(o.group ? -child.pid : child.pid, 'SIGKILL'); } catch { /* already gone */ } throw e; }
  }
  return new Promise((done, fail) => {
    child.on('error', fail);
    child.on('exit', (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
}
