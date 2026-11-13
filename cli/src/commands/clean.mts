// `factory clean [--dry-run] [--project <name|path>] [--json]` (slice 4.5, #96): remove a registered project's local
// Factory branches whose PR/MR merged (their run record is `done` with `mergedAt`) and the Factory-owned worktrees
// under `.sandcastle/worktrees/` holding them, when nothing would be lost (cli/src/clean.mts cleanProject decides).
// Offline: no fetch, and remote branches are never touched. Kept branches are listed with the reason. --dry-run
// deletes nothing. Exits 1 only when a removal Git refused failed. The tick runs the same cleanup after each completed
// scheduled pass (#97, tick.mts cleanAfterPass).
import type { Paths } from '../paths.mts';
import { cleanProject } from '../clean.mts';
import { findRun, projectRuns, resolveProject } from '../runs.mts';

export function clean(p: Paths, o: { dryRun?: boolean; json?: boolean; project?: string; cwd?: string } = {}): number {
  const ctx = resolveProject(p, o);
  const r = cleanProject(ctx.root, projectRuns(p, ctx), { dryRun: o.dryRun, current: iid => findRun(p, ctx, iid).run });
  if (o.json) {
    console.log(JSON.stringify({ project: ctx.name, root: ctx.root, dryRun: !!o.dryRun, ...r }, null, 2));
    return r.failed.length ? 1 : 0;
  }
  const where = (e: { branch: string; worktree?: string }) => `${e.branch}${e.worktree ? ` and worktree ${e.worktree}` : ''}`;
  if (!r.removed.length && !r.kept.length && !r.failed.length) console.log(`${ctx.name}: no merged Factory branches to clean.`);
  for (const e of r.removed) console.log(`${o.dryRun ? 'Would remove' : 'Removed'} #${e.ticket}: ${where(e)}`);
  for (const e of r.kept) console.log(`Kept #${e.ticket}: ${e.branch} ${e.reason}`);
  for (const e of r.failed) console.error(`Could not remove #${e.ticket}: ${where(e)}: ${e.reason}`);
  if (o.dryRun) console.log('Dry run: nothing was deleted.');
  console.log('Remote branches are never touched.');
  return r.failed.length ? 1 : 0;
}
