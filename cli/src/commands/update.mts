// `factory update --dry-run|--apply [--project <name|path>] [--json]` (slice 4.5, #91/#92): classify a registered
// project's `.sandcastle/` files against Factory's copy (cli/src/update.mts classifyCopy) and say what an update does:
// create missing Factory-owned files, replace unmodified older ones, and leave edited and project-owned files
// (config.mts, main.mts, dispatch.sh, prompt.md, prompt.verify.md) for a hand merge. --dry-run writes nothing; --apply
// (applyCopy) writes only the missing and outdated files and lists the rest for a hand merge. Exactly one of the two is
// required. Updating a recovery workflow file makes self-recovery inactive until `factory recovery review --confirm` is
// run again; --apply says so but never records a review itself.
import type { Paths } from '../paths.mts';
import { WORKFLOW } from '../recovery-review.mts';
import { resolveProject } from '../runs.mts';
import { appRoot } from '../scaffold.mts';
import { applyCopy, classifyCopy, factoryHistory } from '../update.mts';
import type { FileClass } from '../update.mts';

export type UpdateOptions = { dryRun?: boolean; apply?: boolean; json?: boolean; project?: string; cwd?: string; app?: string };
const HEADINGS: Record<'dry' | 'apply', [FileClass, string][]> = {
  dry: [
    ['missing', 'Missing (would create)'],
    ['outdated', 'Outdated, unmodified (would replace)'],
    ['modified', 'Edited locally (kept; merge by hand)'],
    ['project', 'Project-owned (never written by update; merge by hand)'],
    ['current', 'Current'],
  ],
  apply: [
    ['missing', 'Created'],
    ['outdated', 'Replaced (were unmodified earlier Factory copies)'],
    ['modified', 'Edited locally (kept; merge by hand)'],
    ['project', 'Project-owned (never written by update; merge by hand)'],
    ['current', 'Current'],
  ],
};

export function update(p: Paths, o: UpdateOptions = {}): number {
  if (o.dryRun && o.apply) throw new Error('Pass either --dry-run or --apply, not both.');
  if (!o.dryRun && !o.apply) throw new Error('Pass --dry-run to list what an update would change (writes nothing), or --apply to create missing and replace unmodified outdated files.');
  const ctx = resolveProject(p, o);
  const app = o.app ?? appRoot;
  const history = factoryHistory(app);
  const result = o.apply ? applyCopy(p, ctx.root, { app, history }) : { files: classifyCopy(p, ctx.root, { app, history }), created: [], replaced: [] };
  const { files } = result;
  const written = [...result.created, ...result.replaced];
  const review = written.some(f => WORKFLOW.includes(f));
  if (o.json) {
    console.log(JSON.stringify({
      project: ctx.name, root: ctx.root, factory: app, history: history.kind, dryRun: !o.apply, files,
      ...(o.apply ? { created: result.created, replaced: result.replaced, recoveryReviewNeeded: review } : {}),
    }, null, 2));
    return 0;
  }
  console.log(o.apply
    ? `Updated ${ctx.name} (${ctx.scaffold}) from Factory at ${app}: ${result.created.length} created, ${result.replaced.length} replaced.`
    : `Dry run for ${ctx.name} (${ctx.scaffold}) against Factory at ${app}. Nothing was written.`);
  for (const [cls, heading] of HEADINGS[o.apply ? 'apply' : 'dry']) {
    const group = files.filter(f => f.class === cls);
    if (!group.length) continue;
    console.log(`${heading}: ${group.length}${cls === 'current' ? ` (${group.map(f => f.file).join(', ')})` : ''}`);
    if (cls !== 'current') for (const f of group) console.log(`  ${f.file}  (${f.source}; ${f.detail})`);
  }
  if (history.kind === 'none') {
    console.log(`Factory's earlier versions are unknown (${app} has no Git history or install catalog), so every Factory-owned file that differs counts as edited. Reinstall from a checkout with factory install to record them.`);
  }
  if (review) {
    console.log(`Recovery workflow files changed (${written.filter(f => WORKFLOW.includes(f)).join(', ')}); self-recovery stays inactive until you check them and run: factory recovery review --confirm --project ${ctx.name}`);
  }
  return 0;
}
