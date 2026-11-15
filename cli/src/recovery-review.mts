// Host-owned recovery review binds a complete project override, never partial copies or TOML data.
// Validated installed Factory bundles need no per-project review; all admission/proof/budget gates remain separate.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Paths } from './paths.mts';
import { paths } from './paths.mts';
import { recoveryFile } from './recovery-state.mts';
import { projectWorkflow } from './workflow.mts';
import { RUNTIME_ASSETS } from './runtime-assets.mts';
export const WORKFLOW = RUNTIME_ASSETS.map(a => a.destination);
export type Review = { version: 2; root: string; reviewedAt: string; by: 'init' | 'review'; mode: 'factory' | 'project'; workflowRoot: string; id: string; dependencies: string; files: Record<string, string> };
export const reviewFile = (p: Paths, root: string) => recoveryFile(p, root).replace(/\.json$/, '.review.json');
export function missingWorkflow(root: string, p: Paths = paths()): string[] {
  try { projectWorkflow(p, root); return []; } catch (error) { return [(error as Error).message]; }
}
export function readReview(p: Paths, root: string): Review | null | string {
  const file = reviewFile(p, root);
  if (!existsSync(file)) return null;
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    if (d?.version === 2 && d.root === root && typeof d.reviewedAt === 'string' && ['factory','project'].includes(d.mode) && typeof d.workflowRoot === 'string' && /^[a-f0-9]{64}$/.test(d.id) && /^[a-f0-9]{64}$/.test(d.dependencies) && d.files && typeof d.files === 'object') return d;
  } catch {}
  return `the recovery review record ${file} is malformed or obsolete; review the selected complete workflow again`;
}
export function changedSinceReview(root: string, review: Review, p: Paths = paths()): string[] {
  try {
    const w = projectWorkflow(p, root);
    const changed = w.manifest.files.filter(f => review.files[f.path] !== f.sha256).map(f => f.path);
    if (review.mode !== w.mode || review.workflowRoot !== w.root || review.id !== w.id || review.dependencies !== w.manifest.dependencies) changed.push('workflow identity/mode/dependencies');
    if (Object.keys(review.files).length !== w.manifest.files.length) changed.push('inventory');
    return changed;
  } catch (error) { return [(error as Error).message]; }
}
export function recoveryCopyProblem(p: Paths, root: string): string | null {
  let w;
  try { w = projectWorkflow(p, root); } catch (error) { return (error as Error).message; }
  if (w.mode === 'factory') return null;
  const r = readReview(p, root);
  if (!r || typeof r === 'string') return `${typeof r === 'string' ? r : 'The complete project workflow has not been reviewed'}; recovery stays inactive until \`factory recovery review --confirm\``;
  const changed = changedSinceReview(root, r, p);
  return changed.length ? `${changed.join(', ')} changed since recovery review; run \`factory recovery review --confirm\`` : null;
}
export function workflowFiles(root: string, _app?: string, p: Paths = paths()) {
  const w = projectWorkflow(p, root);
  return w.manifest.files.map(f => ({ file: f.path, present: true, sha: f.sha256, matchesFactory: w.mode === 'factory' ? true : null }));
}
export function recordReview(p: Paths, root: string, o: { at?: string; by?: Review['by'] } = {}): Review {
  const w = projectWorkflow(p, root);
  const review: Review = { version: 2, root, reviewedAt: o.at ?? new Date().toISOString(), by: o.by ?? 'review',
    mode: w.mode, workflowRoot: w.root, id: w.id, dependencies: w.manifest.dependencies,
    files: Object.fromEntries(w.manifest.files.map(f => [f.path, f.sha256])) };
  const file = reviewFile(p, root);
  mkdirSync(p.recovery, { recursive: true });
  writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(review, null, 2), { mode: 0o600 });
  renameSync(`${file}.${process.pid}.tmp`, file);
  return review;
}
