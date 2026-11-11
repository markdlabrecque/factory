// `factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]`: one dispatcher pass for one
// project. Runs the project's own `.sandcastle/dispatch.sh` from its checkout root, so its checks (tools,
// logins, .env, image, node deps) and run behaviour stay exactly as before. SANDCASTLE_STATE_DIR is set to
// Factory's shared run-state folder (runStateDir), as factory-dispatch.sh does, so the pass shows on the
// board. Output streams through; the result is dispatch.sh's exit code.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from '../paths.mts';
import { scaffoldName } from '../paths.mts';
import { resolveProject, runStateDir } from '../runs.mts';
export type DispatchOptions = { project?: string; cwd?: string; dryRun?: boolean; max?: string; wholeIssues?: boolean };

/** The arguments passed on to dispatch.sh. `--max` must be a positive whole number. */
export function dispatchArgs(o: DispatchOptions): string[] {
  const args: string[] = [];
  if (o.dryRun) args.push('--dry-run');
  if (o.max !== undefined) {
    if (!/^[1-9]\d*$/.test(o.max)) throw new Error(`--max needs a positive whole number, got ${JSON.stringify(o.max)}`);
    args.push('--max', o.max);
  }
  if (o.wholeIssues) args.push('--whole-issues');
  return args;
}

export async function dispatch(p: Paths, o: DispatchOptions = {}): Promise<number> {
  const args = dispatchArgs(o);
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  const script = join(ctx.scaffold, 'dispatch.sh');
  if (!existsSync(script)) throw new Error(`No ${scaffoldName}/dispatch.sh in ${ctx.root}. Run: factory init ${ctx.root}`);
  console.error(`factory: dispatching ${ctx.name} (${ctx.root})`);
  const child = spawn(script, args, { cwd: ctx.root, stdio: 'inherit', env: { ...process.env, SANDCASTLE_STATE_DIR: runStateDir(p) } });
  return new Promise((done, fail) => {
    child.on('error', fail);
    child.on('exit', (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
}
