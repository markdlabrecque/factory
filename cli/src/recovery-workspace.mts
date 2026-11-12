// Which branch and worktree a recovery attempt may resume (slice four, #59). A repair continues the affected ticket's
// own work; it never creates a branch, restarts from scratch, deletes anything or takes over a checkout Factory does not
// own. resumeTarget reads the ticket's run record and the project's Git state (local refs, the last-fetched origin refs
// and `git worktree list`, no network) and accepts only:
// - the branch the record names, `<ticket>-<slug>` as main.mts creates it, existing locally, with no other local
//   `<ticket>-*` branch beside it;
// - an origin copy of it (as last fetched) that the local branch already contains, so nobody else's pushed commits are
//   overwritten or dropped;
// - at most one worktree with the branch checked out, and only inside Sandcastle's worktree folder
//   (`<root>/.sandcastle/worktrees/` by default), present on disk. A dirty worktree is accepted and its changes are
//   listed so the repair keeps them; none means Sandcastle checks the branch out afresh;
// - the record's evidence folder, when set, being the ticket's own `<root>/.sandcastle/evidence/<ticket>`.
// Anything else (no recorded branch, a branch only on origin, a diverged origin copy, the branch checked out in the
// project's main checkout or a worktree outside that folder, a missing registered worktree) is ambiguous ownership:
// the attempt is refused with the reason and nothing is touched. Read-only; the recovery launcher (#60) calls it
// before claimRecovery and passes the accepted branch on.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { RunState } from '../../board/board.mts';

export type ResumeTarget = {
  branch: string; tip: string; base?: string; evidenceDir: string;
  worktree?: { path: string; dirty: string[] };
};
export type ResumeCheck = ({ ok: true } & ResumeTarget) | { ok: false; reason: string };

type Worktree = { path: string; branch?: string; prunable: boolean };

function git(root: string, args: string[], trim = true): string {
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return trim ? out.trim() : out;
}
const ok = (root: string, args: string[]) => { try { git(root, args); return true; } catch { return false; } };
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
const inside = (dir: string, p: string) => { const r = relative(dir, p); return !!r && !r.startsWith('..') && !isAbsolute(r); };

function worktrees(root: string): Worktree[] {
  const list: Worktree[] = [];
  for (const block of git(root, ['worktree', 'list', '--porcelain']).split(/\n\n+/)) {
    const lines = block.split('\n');
    const path = lines.find(l => l.startsWith('worktree '))?.slice(9);
    if (!path) continue;
    const branch = lines.find(l => l.startsWith('branch '))?.slice(7);
    list.push({ path, branch, prunable: lines.some(l => l.startsWith('prunable')) });
  }
  return list;
}

/** The ticket's recorded branch and Factory-owned worktree a repair may continue, or why it may not. `root` is the
 *  project's canonical checkout root; `worktreeDir` overrides Sandcastle's worktree folder (tests). */
export function resumeTarget(root: string, run: Pick<RunState, 'iid' | 'branch' | 'base' | 'evidenceDir'>,
  o: { worktreeDir?: string } = {}): ResumeCheck {
  const no = (reason: string): ResumeCheck => ({ ok: false, reason: `#${run.iid}: ${reason}` });
  const branch = run.branch;
  if (!branch) return no('its run record names no branch; recovery does not create or guess one');
  if (!branch.startsWith(`${run.iid}-`) || !ok(root, ['check-ref-format', '--branch', branch])) {
    return no(`recorded branch ${branch} is not a Factory branch for this ticket (${run.iid}-<slug>)`);
  }
  const evidenceDir = resolve(root, '.sandcastle/evidence', run.iid);
  if (run.evidenceDir && real(run.evidenceDir) !== real(evidenceDir)) {
    return no(`recorded evidence folder ${run.evidenceDir} is not the ticket's own (${evidenceDir})`);
  }

  const local = git(root, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${run.iid}-*`]).split('\n').filter(Boolean)
    // for-each-ref globs match within one path component only; keep names that really start with the prefix.
    .filter(b => b.startsWith(`${run.iid}-`));
  if (!local.includes(branch)) {
    const remote = ok(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    return no(remote ? `branch ${branch} exists only on origin; recovery resumes only a local branch Factory recorded`
      : `recorded branch ${branch} no longer exists; recovery does not restart the ticket from scratch`);
  }
  const others = local.filter(b => b !== branch);
  if (others.length) return no(`other local branches for this ticket (${others.join(', ')}) make ownership ambiguous`);
  const tip = git(root, ['rev-parse', `refs/heads/${branch}`]);
  if (ok(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])
    && !ok(root, ['merge-base', '--is-ancestor', `refs/remotes/origin/${branch}`, tip])) {
    return no(`origin/${branch} has commits the local branch does not (as last fetched); someone else may own it`);
  }

  const owned = real(o.worktreeDir ?? join(root, '.sandcastle/worktrees'));
  const holding = worktrees(root).filter(w => w.branch === `refs/heads/${branch}`);
  if (holding.length > 1) return no(`branch ${branch} is checked out in several worktrees: ${holding.map(w => w.path).join(', ')}`);
  const held = holding[0];
  if (!held) return { ok: true, branch, tip, base: run.base, evidenceDir };
  const path = real(held.path);
  if (path === real(root)) return no(`branch ${branch} is checked out in the project's own checkout, which Factory does not own`);
  if (!inside(owned, path)) return no(`branch ${branch} is checked out in ${held.path}, outside Factory's worktree folder ${owned}`);
  if (held.prunable || !existsSync(held.path)) return no(`branch ${branch}'s registered worktree ${held.path} is missing`);
  const dirty = git(held.path, ['status', '--porcelain', '--untracked-files=all'], false).split('\n').filter(Boolean);
  return { ok: true, branch, tip, base: run.base, evidenceDir, worktree: { path: held.path, dirty } };
}
