// `factory update --dry-run [--project <name|path>] [--json]` (slice 4.5, #91): classify a registered project's
// `.sandcastle/` files against Factory's copy (cli/src/update.mts classifyCopy) and say what an update would do:
// create missing Factory-owned files, replace unmodified older ones, and leave edited and project-owned files
// (config.mts, main.mts, dispatch.sh, prompt.md, prompt.verify.md) for a hand merge. It writes nothing. Without
// --dry-run it refuses: applying (#92) is not built yet. Updating the workflow files can make self-recovery inactive
// until `factory recovery review --confirm` is run again; this command does not record a review.
import type { Paths } from '../paths.mts';
import { resolveProject } from '../runs.mts';
import { appRoot } from '../scaffold.mts';
import { classifyCopy, factoryHistory } from '../update.mts';
import type { FileClass } from '../update.mts';

export type UpdateOptions = { dryRun?: boolean; json?: boolean; project?: string; cwd?: string; app?: string };
const HEADINGS: [FileClass, string][] = [
  ['missing', 'Missing (would create)'],
  ['outdated', 'Outdated, unmodified (would replace)'],
  ['modified', 'Edited locally (kept; merge by hand)'],
  ['project', 'Project-owned (never written by update; merge by hand)'],
  ['current', 'Current'],
];

export function update(p: Paths, o: UpdateOptions = {}): number {
  if (!o.dryRun) throw new Error('Only factory update --dry-run is available; it lists what an update would change and writes nothing.');
  const ctx = resolveProject(p, o);
  const app = o.app ?? appRoot;
  const history = factoryHistory(app);
  const files = classifyCopy(p, ctx.root, { app, history });
  if (o.json) {
    console.log(JSON.stringify({ project: ctx.name, root: ctx.root, factory: app, history: history.kind, dryRun: true, files }, null, 2));
    return 0;
  }
  console.log(`Dry run for ${ctx.name} (${ctx.scaffold}) against Factory at ${app}. Nothing was written.`);
  for (const [cls, heading] of HEADINGS) {
    const group = files.filter(f => f.class === cls);
    if (!group.length) continue;
    console.log(`${heading}: ${group.length}${cls === 'current' ? ` (${group.map(f => f.file).join(', ')})` : ''}`);
    if (cls !== 'current') for (const f of group) console.log(`  ${f.file}  (${f.source}; ${f.detail})`);
  }
  if (history.kind === 'none') {
    console.log(`Factory's earlier versions are unknown (${app} has no Git history or install catalog), so every Factory-owned file that differs counts as edited. Reinstall from a checkout with factory install to record them.`);
  }
  return 0;
}
