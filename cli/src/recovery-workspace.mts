// Typed read-only refusals distinguish ticket facts from Git/filesystem uncertainty. No failed Git read becomes absence.
// Which branch and worktree a recovery attempt may resume (slice four, #59). A repair continues the affected ticket's
// own work; it never creates a branch, restarts from scratch, deletes anything or takes over a checkout Factory does not
// own. resumeTarget reads the ticket's run record and the project's Git state (local refs, the last-fetched origin refs
// and `git worktree list`, no network) and accepts only:
// - the branch the record names, `<ticket>-<slug>` as main.mts creates it, existing locally, with no other local
//   `<ticket>-*` branch beside it;
// - an origin copy of it (as last fetched) that the local branch already contains, so nobody else's pushed commits are
//   overwritten or dropped;
// - at most one worktree with the branch checked out, and only inside Sandcastle's worktree folder
//   (`<root>/.factory/worktrees/` by default), present on disk. A dirty worktree is accepted and its changes are
//   listed so the repair keeps them; none means Sandcastle checks the branch out afresh;
// - the recorded evidence folder being the ticket root or its exact recorded execution directory, contained on disk.
// Anything else (no recorded branch, a diverged origin copy, the branch checked out in the project's main checkout or a
// worktree outside that folder, a missing registered worktree) is ambiguous ownership: the attempt is refused with the
// reason and nothing is touched. Read-only; the recovery launcher (#60) calls it before claimRecovery.
// Ownership receipts (#75, orchestrator/ownership.mts) tighten this. With a receipt for the ticket, its project root, Git
// common directory, ticket and branch must match, a recorded branch identity must still be in the branch's history, and
// a worktree holding the branch must be the receipt's. A receipt whose intent has no identity yet (a crash between the
// receipt and the branch or worktree creation) is reconciled: what Git now shows is returned under `reconcile` for the
// launcher to fill in, and a branch that was never created is refused. Without a receipt (a run stopped before the
// upgrade), only the exact recorded branch is accepted, with at most the one canonical worktree
// (`.factory/worktrees/<branch>`) whose Git common directory is the project's; `adopt` tells the launcher to write
// the receipt. A branch only on origin is refused with `remoteOnly`; fetchRecordedBranch then fetches exactly that branch
// and creates the local ref without force (refusing several matching refs or a mismatch), and the check runs again.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import type { RunState } from '../../board/board.mts';
import { gitCommonDir } from '../../orchestrator/ownership.mts';
import { projectLayoutPaths } from '../../orchestrator/project-layout.mts';
import type { Receipt } from '../../orchestrator/ownership.mts';

export type ResumeTarget = {
  branch: string; tip: string; base?: string; evidenceDir: string;
  worktree?: { path: string; dirty: string[] };
  /** No receipt yet (a pre-upgrade run): the launcher writes one for this exact branch. */
  adopt?: true;
  /** Identities a receipt's creation intent is missing that Git now shows. */
  reconcile?: { branchSha?: string; worktreeAt?: true };
};
export type RefusalCode = 'branch-missing' | 'branch-invalid' | 'base-missing' | 'base-invalid' | 'branches-ambiguous'
  | 'branch-diverged' | 'worktree-not-owned' | 'evidence-mismatch' | 'ownership-unknown' | 'validation-uncertain';
export type ResumeCheck = ({ ok: true } & ResumeTarget) | { ok: false; kind: 'ticket-refused' | 'project-stopped'; code: RefusalCode; reason: string; remoteOnly?: true };

type Worktree = { path: string; branch?: string; prunable: boolean };

function git(root: string, args: string[], trim = true): string {
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return trim ? out.trim() : out;
}
// These predicates have a documented negative exit code. Every other exit is uncertainty, not a missing ref.
function ok(root: string, args: string[]): boolean {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  if (r.error) throw r.error;
  if (r.status === 0) return true;
  if (r.status === 1 && !r.stderr.trim()) return false;
  throw new Error(`git ${args[0]} failed: ${r.stderr.trim() || r.signal || r.status}`);
}
const real = (p: string) => { try { return realpathSync(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return resolve(p); throw e; } };
// Resolve existing ancestors too: a missing leaf must not hide an escaping parent symlink.
const realWithMissing = (p: string): string => {
  try { return realpathSync(p); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    // A dangling symlink is an unknown identity, not an absent evidence directory.
    if (lstatSync(p, { throwIfNoEntry: false })) throw e;
    const parent = dirname(p);
    if (parent === p) throw e;
    return join(realWithMissing(parent), relative(parent, p));
  }
};
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
export function resumeTarget(root: string, run: Pick<RunState, 'iid' | 'branch' | 'base' | 'evidenceDir' | 'executionId'>,
  o: { worktreeDir?: string; receipt?: Receipt | null } = {}): ResumeCheck {
  try { return validateTarget(root, run, o); }
  catch (e) { return { ok: false, kind: 'project-stopped', code: 'validation-uncertain', reason: `#${run.iid}: ${(e as Error).message}` }; }
}

function validateTarget(root: string, run: Pick<RunState, 'iid' | 'branch' | 'base' | 'evidenceDir' | 'executionId'>,
  o: { worktreeDir?: string; receipt?: Receipt | null }): ResumeCheck {
  const no = (code: RefusalCode, reason: string): ResumeCheck => ({ ok: false,
    kind: code === 'ownership-unknown' ? 'project-stopped' : 'ticket-refused', code, reason: `#${run.iid}: ${reason}` });
  const commonDir = gitCommonDir(root); // establish readable project Git identity before any local refusal
  const branch = run.branch;
  if (!branch) return no('branch-missing', 'its run record names no branch; recovery does not create or guess one');
  if (!branch.startsWith(`${run.iid}-`) || !ok(root, ['check-ref-format', `refs/heads/${branch}`])) {
    return no('branch-invalid', `recorded branch ${branch} is not a Factory branch for this ticket (${run.iid}-<slug>)`);
  }
  if (!run.base) return no('base-missing', 'its run record names no base branch');
  if (!ok(root, ['check-ref-format', `refs/heads/${run.base}`]) ||
      !ok(root, ['rev-parse', '--verify', '--quiet', `${run.base}^{commit}`])) {
    return no('base-invalid', `recorded base ${run.base} is not an existing commit or branch`);
  }
  const evidenceRoot = resolve(projectLayoutPaths(root).evidence);
  const ticketDir = resolve(evidenceRoot, run.iid);
  const execution = run.executionId;
  const executionDir = execution && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(execution)
    ? join(ticketDir, execution) : undefined;
  const evidenceDir = run.evidenceDir || ticketDir;
  const expectedTicket = join(realWithMissing(evidenceRoot), run.iid);
  if (realWithMissing(evidenceRoot) !== evidenceRoot ||
      (evidenceDir !== ticketDir && evidenceDir !== executionDir) ||
      realWithMissing(ticketDir) !== expectedTicket ||
      realWithMissing(evidenceDir) !== (evidenceDir === ticketDir ? expectedTicket : join(expectedTicket, execution!))) {
    return no('evidence-mismatch', `recorded evidence folder ${run.evidenceDir} is not the ticket's own (${ticketDir}) or its recorded execution`);
  }

  const receipt = o.receipt ?? null;
  if (receipt) {
    if (receipt.ticket !== run.iid || receipt.branch !== branch) return no('ownership-unknown', `its ownership receipt names ${receipt.branch} for #${receipt.ticket}, not the recorded ${branch}`);
    if (real(receipt.projectRoot) !== real(root) || receipt.gitCommonDir !== commonDir) {
      return no('ownership-unknown', `its ownership receipt is for ${receipt.projectRoot} (${receipt.gitCommonDir}), not this checkout (${commonDir})`);
    }
  }

  const local = git(root, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${run.iid}-*`]).split('\n').filter(Boolean)
    // for-each-ref globs match within one path component only; keep names that really start with the prefix.
    .filter(b => b.startsWith(`${run.iid}-`));
  if (!local.includes(branch)) {
    const remote = ok(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    if (remote && !local.length) return { ok: false, kind: 'project-stopped', code: 'branch-missing', remoteOnly: true, reason: `#${run.iid}: branch ${branch} exists only on origin; fetch it (fetchRecordedBranch) before resuming` };
    if (remote) return no('branches-ambiguous', `branch ${branch} exists only on origin, beside other local branches for this ticket (${local.join(', ')})`);
    if (receipt?.creationIntent.branch && !receipt.branchSha) return no('ownership-unknown', `its ownership receipt shows ${branch} was about to be created, but it never was; recovery does not create it`);
    return no('branch-missing', `recorded branch ${branch} no longer exists; recovery does not restart the ticket from scratch`);
  }
  const others = local.filter(b => b !== branch);
  if (others.length) return no('branches-ambiguous', `other local branches for this ticket (${others.join(', ')}) make ownership ambiguous`);
  const tip = git(root, ['rev-parse', `refs/heads/${branch}`]);
  if (ok(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])
    && !ok(root, ['merge-base', '--is-ancestor', `refs/remotes/origin/${branch}`, tip])) {
    return no('branch-diverged', `origin/${branch} has commits the local branch does not (as last fetched); someone else may own it`);
  }
  if (receipt?.branchSha && (!ok(root, ['rev-parse', '--verify', '--quiet', `${receipt.branchSha}^{commit}`]) ||
      !ok(root, ['merge-base', '--is-ancestor', receipt.branchSha, tip]))) {
    return no('branch-diverged', `branch ${branch} no longer contains ${receipt.branchSha.slice(0, 8)}, the commit its ownership receipt recorded; it was replaced`);
  }
  const reconcile: NonNullable<ResumeTarget['reconcile']> = {};
  if (receipt && !receipt.branchSha) reconcile.branchSha = tip;
  const extra = { ...(receipt ? {} : { adopt: true as const }), ...(Object.keys(reconcile).length ? { reconcile } : {}) };

  const owned = real(o.worktreeDir ?? projectLayoutPaths(root).worktrees);
  const holding = worktrees(root).filter(w => w.branch === `refs/heads/${branch}`);
  if (holding.length > 1) return no('worktree-not-owned', `branch ${branch} is checked out in several worktrees: ${holding.map(w => w.path).join(', ')}`);
  const held = holding[0];
  if (!held) return { ok: true, branch, tip, base: run.base, evidenceDir, ...extra };
  const path = real(held.path);
  if (path === real(root)) return no('worktree-not-owned', `branch ${branch} is checked out in the project's own checkout, which Factory does not own`);
  if (!inside(owned, path)) return no('worktree-not-owned', `branch ${branch} is checked out in ${held.path}, outside Factory's worktree folder ${owned}`);
  if (held.prunable || !existsSync(held.path)) return no('worktree-not-owned', `branch ${branch}'s registered worktree ${held.path} is missing`);
  const expected = receipt ? real(receipt.worktreePath) : real(join(owned, branch.replaceAll('/', '-')));
  if (path !== expected) {
    return no('worktree-not-owned', `branch ${branch} is checked out in ${held.path}, not ${receipt ? 'the worktree its ownership receipt names' : 'its canonical Factory worktree'} (${expected})`);
  }
  if (gitCommonDir(held.path) !== commonDir) return no('ownership-unknown', `worktree ${held.path} belongs to another repository (${gitCommonDir(held.path)})`);
  if (receipt?.creationIntent.worktree && !receipt.worktreeAt) reconcile.worktreeAt = true;
  const dirty = git(held.path, ['status', '--porcelain', '--untracked-files=all'], false).split('\n').filter(Boolean);
  return { ok: true, branch, tip, base: run.base, evidenceDir, worktree: { path: held.path, dirty }, ...extra,
    ...(Object.keys(reconcile).length ? { reconcile } : {}) };
}

/** Fetch exactly `branch` from origin and create the local branch at it, without force. Refused when origin advertises
 *  no or several refs matching it, when the fetched ref does not match what origin advertised, when `contains` (a
 *  receipt's recorded commit) is not in its history, or when a local branch of that name appeared meanwhile. */
export function fetchRecordedBranch(root: string, branch: string, o: { contains?: string } = {}): { ok: true; sha: string } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason: `${branch}: ${reason}` });
  if (!ok(root, ['check-ref-format', `refs/heads/${branch}`])) return no('not a valid branch name');
  let listed: string[];
  try { listed = git(root, ['ls-remote', 'origin', `refs/heads/${branch}`]).split('\n').filter(Boolean); }
  catch (e) { return no(`origin could not be read: ${(e as Error).message.split('\n')[0]}`); }
  const refs = listed.map(l => l.split('\t')).map(([sha, name]) => ({ sha, name }));
  if (refs.length !== 1 || refs[0].name !== `refs/heads/${branch}`) {
    return no(refs.length ? `origin has several matching refs (${refs.map(r => r.name).join(', ')}); not guessing` : 'origin does not have it');
  }
  const sha = refs[0].sha;
  // No leading '+': a remote-tracking ref that would not fast-forward is refused, not overwritten.
  try { git(root, ['fetch', '--quiet', '--no-tags', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`]); }
  catch (e) { return no(`fetch refused: ${(e as Error).message.split('\n')[0]}`); }
  const fetched = git(root, ['rev-parse', `refs/remotes/origin/${branch}`]);
  if (fetched !== sha) return no(`fetched ${fetched.slice(0, 8)}, but origin advertised ${sha.slice(0, 8)}`);
  if (o.contains && !ok(root, ['merge-base', '--is-ancestor', o.contains, sha])) return no(`origin's copy does not contain ${o.contains.slice(0, 8)}, the commit its ownership receipt recorded`);
  // An empty old value: update-ref creates the branch only if it does not exist yet.
  try { git(root, ['update-ref', `refs/heads/${branch}`, sha, '']); }
  catch (e) { return no(`the local branch could not be created without force: ${(e as Error).message.split('\n')[0]}`); }
  return { ok: true, sha };
}
