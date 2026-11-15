// Report project-owned assets; runtime upgrades use install and update never repairs project code or data.
import { controlAction } from '../../../board/execution-events.mts';
import { runStateDir } from '../runs.mts';
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
    ['project', 'Project-owned (never written by update)'],
    ['current', 'Current'],
  ],
  apply: [
    ['missing', 'Created'],
    ['outdated', 'Replaced (were unmodified earlier Factory copies)'],
    ['modified', 'Edited locally (kept; merge by hand)'],
    ['project', 'Project-owned (never written by update)'],
    ['current', 'Current'],
  ],
};

export function update(p: Paths, o: UpdateOptions = {}): number {
  if (o.dryRun && o.apply) throw new Error('Pass either --dry-run or --apply, not both.');
  if (!o.dryRun && !o.apply) throw new Error('Pass --dry-run or --apply to report project-owned assets. Neither repairs project files.');
  const ctx = resolveProject(p, o);
  const app = o.app ?? appRoot;
  const history = factoryHistory(app);
  const apply = (done?: (result: 'changed' | 'no-op') => void) => {
  const result = o.apply ? applyCopy(p, ctx.root, { app, history }) : { files: classifyCopy(p, ctx.root, { app, history }), created: [], replaced: [] };
  const { files } = result;
  const written = [...result.created, ...result.replaced];
  done?.(written.length ? 'changed' : 'no-op');
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
  console.log('Project data and workflow overrides are never repaired by update. Upgrade the Factory runtime with factory install.');
  if (review) {
    console.log(`Recovery workflow files changed (${written.filter(f => WORKFLOW.includes(f)).join(', ')}); self-recovery stays inactive until you check them and run: factory recovery review --confirm --project ${ctx.name}`);
  }
  return 0;
  };
  return o.apply ? controlAction(runStateDir(p), { project: ctx.tracker }, 'update-apply', apply) : apply();
}
