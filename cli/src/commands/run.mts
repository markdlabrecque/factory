// `factory run <ticket> [--project <name>]`: run one ticket now, in the foreground, for one project (the
// registered checkout you are in, or --project). Runs the project's own `.sandcastle/dispatch.sh --issue <n>`
// from the checkout root, so the same checks (tools, logins, .env, image, node deps) come first, then
// main.mts takes the ticket through; its output streams through and also lands in
// `.sandcastle/logs/run-<n>.log` (what `factory logs` reads). SANDCASTLE_STATE_DIR is Factory's run-state
// folder, so the run shows on the board. The result is dispatch.sh's exit code. A project whose
// dispatch.sh copy predates --issue is refused with a message saying how to update it.
import { readFileSync } from 'node:fs';
import type { Paths } from '../paths.mts';
import { scaffoldName } from '../paths.mts';
import { resolveProject, ticketId } from '../runs.mts';
import { dispatchScript, runDispatchSh } from './dispatch.mts';
export type RunOptions = { project?: string; cwd?: string };

export async function run(p: Paths, ticket: string | undefined, o: RunOptions = {}): Promise<number> {
  const iid = ticketId(ticket);
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  const script = dispatchScript(ctx);
  if (!/--issue\b/.test(readFileSync(script, 'utf8'))) {
    throw new Error(`${ctx.root}/${scaffoldName}/dispatch.sh is an older copy without --issue, so factory run can't use it. `
      + `Copy Factory's orchestrator/dispatch.sh over it (refreshing project copies is a later slice).`);
  }
  console.error(`factory: running #${iid} in ${ctx.name} (${ctx.root})`);
  return runDispatchSh(p, ctx, ['--issue', iid]);
}
