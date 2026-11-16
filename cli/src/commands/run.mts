// `factory run <ticket> [--project <name>]`: run one ticket now, in the foreground, for one project (the
// registered checkout you are in, or --project). Runs the selected complete workflow's `dispatch.sh --issue <n>`
// from the checkout root, so the same checks (tools, logins, .env and image) come first, then
// main.mts takes the ticket through; its output streams through and also lands in
// `.factory/logs/run-<n>.log` (what `factory logs` reads). SANDCASTLE_STATE_DIR is Factory's run-state
// folder, so the run shows on the board. The result is dispatch.sh's exit code. Invalid selections fail without fallback.
import type { Paths } from '../paths.mts';
import { resolveProject, ticketId } from '../runs.mts';
import { runDispatchSh } from './dispatch.mts';
export type RunOptions = { project?: string; cwd?: string };

export async function run(p: Paths, ticket: string | undefined, o: RunOptions = {}): Promise<number> {
  const iid = ticketId(ticket);
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  console.error(`factory: running #${iid} in ${ctx.name} (${ctx.root})`);
  return runDispatchSh(p, ctx, ['--issue', iid]);
}
