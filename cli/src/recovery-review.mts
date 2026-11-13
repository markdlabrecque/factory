// Recovery workflow gate (slice four, #63). A project's self-recovery is active only when its .sandcastle copy has the
// complete recovery workflow (WORKFLOW: main.mts with --recover/--attempt-record and every file the repair path runs) and
// a person has reviewed exactly those files. The review is a host-owned record, <state>/recovery/<key>.review.json
// (same key as the project's recovery record; never in the project, so no agent can write it), holding the SHA-256 of
// each workflow file at review time. Any later edit, a missing file or an incompatible main.mts makes recovery inactive
// again until the copy is reviewed once more. `factory init` records the review when it created every workflow file
// itself (a new scaffold is Factory's own workflow); an existing project is upgraded by hand (orchestrator/ADAPTING.md,
// "Upgrading an existing project for self-recovery") and then reviewed with `factory recovery review --confirm`.
// assessment.mts belongs in the reviewed workflow because board.mts imports it even on the repair path (#78).
// refresh-worker.mts is service-only and is not copied into projects or run by recovery.
// Nothing here copies, merges or changes project files; automated scaffold upgrades are out of scope.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from './paths.mts';
import { recoveryFile } from './recovery-state.mts';
import { appRoot } from './scaffold.mts';

/** Every .sandcastle file the repair path runs, as the review covers them. config.mts is project configuration, not workflow. */
export const WORKFLOW = ['main.mts', 'recovery.mts', 'recovery-sandbox.mts', 'handoff.mts', 'ownership.mts', 'admission.mts', 'assessment.mts', 'board.mts',
  'prompt.recover.md', 'prompt.verify.md'];
/** Where Factory's own copy of each workflow file lives, for showing which project files differ. main.mts is templated, so it has none. */
const SHIPPED: Record<string, string> = {
  'recovery.mts': 'orchestrator/recovery.mts', 'recovery-sandbox.mts': 'orchestrator/recovery-sandbox.mts', 'handoff.mts': 'orchestrator/handoff.mts',
  'ownership.mts': 'orchestrator/ownership.mts', 'admission.mts': 'board/admission.mts', 'assessment.mts': 'board/assessment.mts', 'board.mts': 'board/board.mts',
  'prompt.recover.md': 'orchestrator/prompt.recover.md', 'prompt.verify.md': 'cli/templates/project/prompt.verify.md',
};
export type Review = { version: 1; root: string; reviewedAt: string; by: 'init' | 'review'; files: Record<string, string> };

export const reviewFile = (p: Paths, root: string) => recoveryFile(p, root).replace(/\.json$/, '.review.json');
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sandcastle = (root: string) => join(root, '.sandcastle');

/** What the copy is missing for a repair (absent files, or a main.mts without --recover --attempt-record). */
export function missingWorkflow(root: string): string[] {
  const dir = sandcastle(root);
  const missing = WORKFLOW.filter(f => !existsSync(join(dir, f)));
  if (!missing.includes('main.mts') && !readFileSync(join(dir, 'main.mts'), 'utf8').includes('"attempt-record": { type: "string" }')) missing.push('main.mts --recover --attempt-record');
  return missing;
}

/** The review record, or why it cannot be read (a malformed one is never overwritten silently: review again replaces it). */
export function readReview(p: Paths, root: string): Review | null | string {
  const file = reviewFile(p, root);
  if (!existsSync(file)) return null;
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    if (d?.version === 1 && d.root === root && typeof d.reviewedAt === 'string' && d.files && typeof d.files === 'object') return d;
  } catch {}
  return `the recovery review record ${file} is malformed`;
}

/** Files whose content is not what was reviewed. */
export function changedSinceReview(root: string, r: Review): string[] {
  return WORKFLOW.filter(f => r.files[f] !== sha(join(sandcastle(root), f)));
}

/** Why the project cannot run a repair now, or null: the workflow must be complete, compatible and reviewed as it is. */
export function recoveryCopyProblem(p: Paths, root: string): string | null {
  const missing = missingWorkflow(root);
  if (missing.length) return `the project's .sandcastle copy has no recovery workflow (missing ${missing.join(', ')}); recovery stays inactive until the copy is upgraded and reviewed`;
  const r = readReview(p, root);
  if (r === null) return 'the recovery workflow in .sandcastle has not been reviewed; recovery stays inactive until `factory recovery review --confirm`';
  if (typeof r === 'string') return `${r}; recovery stays inactive until \`factory recovery review --confirm\``;
  const changed = changedSinceReview(root, r);
  if (changed.length) return `${changed.join(', ')} changed since the recovery workflow was reviewed; recovery stays inactive until \`factory recovery review --confirm\``;
  return null;
}

/** Per workflow file: whether it is present and whether it matches Factory's own copy (null when not comparable). */
export function workflowFiles(root: string, app = appRoot) {
  return WORKFLOW.map(f => {
    const file = join(sandcastle(root), f);
    const present = existsSync(file);
    const shipped = SHIPPED[f] ? join(app, SHIPPED[f]) : undefined;
    return { file: f, present, sha: present ? sha(file) : undefined,
      matchesFactory: present && shipped && existsSync(shipped) ? sha(file) === sha(shipped) : null };
  });
}

/** Record that the copy's workflow files, as they are now, were reviewed. Refuses an incomplete or incompatible copy. */
export function recordReview(p: Paths, root: string, o: { at?: string; by?: Review['by'] } = {}): Review {
  const missing = missingWorkflow(root);
  if (missing.length) throw new Error(`cannot record a review: the .sandcastle copy is missing ${missing.join(', ')}`);
  const review: Review = { version: 1, root, reviewedAt: o.at ?? new Date().toISOString(), by: o.by ?? 'review',
    files: Object.fromEntries(WORKFLOW.map(f => [f, sha(join(sandcastle(root), f))])) };
  const file = reviewFile(p, root);
  mkdirSync(p.recovery, { recursive: true });
  writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(review, null, 2), { mode: 0o600 });
  renameSync(`${file}.${process.pid}.tmp`, file);
  return review;
}
