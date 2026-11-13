// `factory clean` (#96): remove a project's local Factory branches whose work has merged, and the Factory-owned worktrees
// holding them, when nothing would be lost. Offline: it reads the project's run records, local refs, the origin refs as
// last fetched and `git worktree list`; it never fetches, never pushes and never touches a remote branch.
// A branch is a candidate only when its ticket's run record is `done` with `mergedAt` set (the dispatcher saw its PR/MR
// merged, by Factory or outside it, #87), is not claimed by a recovery attempt, and names a `<ticket>-<slug>` branch that
// exists locally. It is removed only when it is also clean:
// - every commit on it is already in the base (`origin/<base>` or `<base>`) or in `origin/<branch>` as last fetched, so
//   a squash-merged branch that was pushed qualifies and one with unpushed commits is kept;
// - it is not checked out in the project's own checkout or in a worktree outside `<root>/.sandcastle/worktrees/`;
// - the Factory worktree holding it, if any, has no uncommitted or untracked changes (`git status --porcelain`).
// Then the worktree goes first (`git worktree remove`, never --force, so Git refuses a dirty or locked one too; a
// registered worktree whose folder is gone is pruned), and the branch is deleted only at the tip that was checked
// (`git update-ref -d refs/heads/<branch> <tip>`), so a commit made meanwhile keeps it. Anything else is kept and
// reported with the reason. Run records, receipts, evidence and logs are left alone. `dryRun` only reports.
// Callers: `factory clean` (commands/clean.mts) and, after each completed scheduled pass, the tick (#97,
// commands/tick.mts cleanAfterPass).
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { RunState } from '../../board/board.mts';

export type CleanEntry = { ticket: string; branch: string; worktree?: string; reason?: string };
export type CleanResult = { removed: CleanEntry[]; kept: CleanEntry[]; failed: CleanEntry[] };
type Run = Pick<RunState, 'iid' | 'branch' | 'base' | 'stage' | 'mergedAt' | 'recovery' | 'starting'>;

const git = (root: string, args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ok = (root: string, args: string[]) => { try { git(root, args); return true; } catch { return false; } };
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
const inside = (dir: string, p: string) => { const r = relative(dir, p); return !!r && !r.startsWith('..') && !isAbsolute(r); };
const ref = (root: string, name: string) => ok(root, ['rev-parse', '--verify', '--quiet', name]) ? name : undefined;
const merged = (r: Run) => r.stage === 'done' && !!r.mergedAt && !r.recovery && !r.starting;

function worktrees(root: string) {
  return git(root, ['worktree', 'list', '--porcelain']).split(/\n\n+/).flatMap(block => {
    const lines = block.split('\n');
    const path = lines.find(l => l.startsWith('worktree '))?.slice(9);
    return path ? [{ path, branch: lines.find(l => l.startsWith('branch '))?.slice(7), prunable: lines.some(l => l.startsWith('prunable')) }] : [];
  });
}

/** Removes the project's merged, clean Factory branches and their worktrees. `root` is the canonical checkout; `current`
 *  re-reads a ticket's run record just before anything is deleted; `worktreeDir` overrides Factory's worktree folder. */
export function cleanProject(root: string, runs: Run[], o: { dryRun?: boolean; current?: (iid: string) => Run | undefined; worktreeDir?: string } = {}): CleanResult {
  const result: CleanResult = { removed: [], kept: [], failed: [] };
  const owned = real(o.worktreeDir ?? join(root, '.sandcastle/worktrees'));
  for (const run of runs) {
    const branch = run.branch;
    if (!merged(run) || !branch || !branch.startsWith(`${run.iid}-`) || !ref(root, `refs/heads/${branch}`)) continue;
    const keep = (reason: string, worktree?: string) => result.kept.push({ ticket: run.iid, branch, ...(worktree ? { worktree } : {}), reason });
    const tip = git(root, ['rev-parse', `refs/heads/${branch}`]);
    const into = [run.base && ref(root, `refs/remotes/origin/${run.base}`), run.base && ref(root, `refs/heads/${run.base}`), ref(root, `refs/remotes/origin/${branch}`)]
      .filter((x): x is string => !!x);
    if (!into.some(r => ok(root, ['merge-base', '--is-ancestor', tip, r]))) {
      keep(`has commits that are neither in ${run.base ?? 'its base'} nor on origin/${branch} (as last fetched)`);
      continue;
    }
    const holding = worktrees(root).filter(w => w.branch === `refs/heads/${branch}`);
    const foreign = holding.find(w => real(w.path) === real(root) || !inside(owned, real(w.path)));
    if (foreign) { keep(`is checked out in ${foreign.path}, which Factory does not own`); continue; }
    const live = holding.filter(w => !w.prunable && existsSync(w.path));
    const dirty = live.find(w => git(w.path, ['status', '--porcelain']) !== '');
    if (dirty) { keep('its worktree has uncommitted or untracked changes', dirty.path); continue; }
    const worktree = live[0]?.path;
    const entry = { ticket: run.iid, branch, ...(worktree ? { worktree } : {}) };
    if (o.dryRun) { result.removed.push(entry); continue; }
    const now = o.current ? o.current(run.iid) : run;
    if (!now || !merged(now) || now.branch !== branch) { keep('its run record changed meanwhile', worktree); continue; }
    try {
      for (const w of live) git(root, ['worktree', 'remove', w.path]);
      if (holding.length > live.length) git(root, ['worktree', 'prune']);
      git(root, ['update-ref', '-d', `refs/heads/${branch}`, tip]);
      result.removed.push(entry);
    } catch (e) {
      result.failed.push({ ...entry, reason: ((e as { stderr?: string }).stderr || String(e)).trim().split('\n')[0] });
    }
  }
  return result;
}
