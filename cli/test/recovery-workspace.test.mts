// Recovery workspace tests (#59): a repair resumes only the ticket's recorded local branch and, at most, one worktree
// inside Sandcastle's worktree folder, keeping dirty work; every ambiguous ownership case is refused and left untouched.
// Since #75: a pre-upgrade run only on its canonical worktree, ownership receipts checked and a crash between receipt
// and creation reconciled, and a remote-only branch fetched exactly and created without force.
// Disposable Git repos (a bare origin and a clone); no tracker, Docker or agent.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectId, readReceipt, receiptFile, recordIntent } from '../../orchestrator/ownership.mts';
import { fetchRecordedBranch, resumeTarget } from '../src/recovery-workspace.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-resume-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const sh = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
  const origin = join(home, 'origin.git');
  mkdirSync(origin);
  sh(origin, 'init', '-q', '--bare', '-b', 'main');
  const root = join(home, 'site');
  mkdirSync(root);
  const git = (...args: string[]) => sh(root, ...args);
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  git('branch', '7-fix-login');
  const run = { iid: '7', branch: '7-fix-login', base: 'main', evidenceDir: join(root, '.sandcastle/evidence/7') };
  const wt = (name: string) => join(root, '.sandcastle/worktrees', name);
  return { home, root, git, sh, run, wt };
}
const refused = (r: ReturnType<typeof resumeTarget>) => (assert.equal(r.ok, false), (r as { reason: string }).reason);

test('resumes the recorded branch, reusing its Factory worktree and keeping dirty work', t => {
  const { root, git, run, wt } = fixture(t);
  const tip = git('rev-parse', '7-fix-login');
  // No worktree yet: Sandcastle checks the branch out afresh.
  assert.deepEqual(resumeTarget(root, run), { ok: true, branch: '7-fix-login', tip, base: 'main', evidenceDir: run.evidenceDir, adopt: true });

  // A pushed copy the local branch contains is fine.
  git('push', '-q', 'origin', '7-fix-login');
  git('worktree', 'add', '-q', wt('7-fix-login'), '7-fix-login');
  writeFileSync(join(wt('7-fix-login'), 'half-done.txt'), 'work in progress\n');
  const r = resumeTarget(root, run);
  assert.equal(r.ok, true);
  assert.deepEqual((r as { worktree: unknown }).worktree, { path: wt('7-fix-login'), dirty: ['?? half-done.txt'] });
  // Read-only: the dirty file and the branch are untouched.
  assert.equal(readFileSync(join(wt('7-fix-login'), 'half-done.txt'), 'utf8'), 'work in progress\n');
  assert.equal(git('rev-parse', '7-fix-login'), tip);
});

test('refuses a missing, foreign or remote-only branch rather than create or guess one', t => {
  const { root, git, run } = fixture(t);
  assert.match(refused(resumeTarget(root, { ...run, branch: undefined })), /names no branch/);
  assert.match(refused(resumeTarget(root, { ...run, branch: '8-other' })), /not a Factory branch for this ticket/);
  assert.match(refused(resumeTarget(root, { ...run, evidenceDir: '/elsewhere/7' })), /not the ticket's own/);

  git('push', '-q', 'origin', '7-fix-login');
  git('branch', '-D', '7-fix-login');
  assert.match(refused(resumeTarget(root, run)), /exists only on origin/);
  assert.equal((resumeTarget(root, run) as { remoteOnly?: boolean }).remoteOnly, true, 'the launcher may fetch it');
  git('push', '-q', 'origin', '--delete', '7-fix-login');
  assert.match(refused(resumeTarget(root, run)), /no longer exists; recovery does not restart/);
});

test('refuses ambiguous branch ownership: a second ticket branch or a diverged origin copy', t => {
  const { root, git, sh, home, run } = fixture(t);
  git('branch', '7-fix-login-again');
  assert.match(refused(resumeTarget(root, run)), /other local branches for this ticket \(7-fix-login-again\)/);
  git('branch', '-D', '7-fix-login-again');

  // Someone else pushed to the ticket's branch; the local branch lacks that commit.
  git('push', '-q', 'origin', '7-fix-login');
  const other = join(home, 'other');
  sh(home, 'clone', '-q', join(home, 'origin.git'), other);
  sh(other, 'checkout', '-q', '7-fix-login');
  sh(other, 'commit', '-q', '--allow-empty', '-m', 'theirs');
  sh(other, 'push', '-q', 'origin', '7-fix-login');
  assert.equal(resumeTarget(root, run).ok, true, 'not fetched yet: no network call is made');
  git('fetch', '-q', 'origin');
  assert.match(refused(resumeTarget(root, run)), /origin\/7-fix-login has commits the local branch does not/);
});

test('refuses a branch checked out outside Factory worktrees, or whose worktree is missing', t => {
  const { root, git, home, run, wt } = fixture(t);
  git('checkout', '-q', '7-fix-login');
  assert.match(refused(resumeTarget(root, run)), /project's own checkout/);
  git('checkout', '-q', 'main');

  const mine = join(home, 'my-worktree');
  git('worktree', 'add', '-q', mine, '7-fix-login');
  assert.match(refused(resumeTarget(root, run)), /outside Factory's worktree folder/);
  git('worktree', 'remove', mine);

  git('worktree', 'add', '-q', wt('7'), '7-fix-login');
  rmSync(wt('7'), { recursive: true, force: true });
  assert.match(refused(resumeTarget(root, run)), /registered worktree .* is missing/);
  assert.match(git('worktree', 'list'), /prunable/, 'nothing pruned');
});

test('an ownership receipt must match; a crash between the receipt and branch creation is reconciled from Git', t => {
  const { home, root, git, run, wt } = fixture(t);
  const state = join(home, 'state');
  const tracker = { kind: 'github', host: 'github.com', project: 'me/site' };
  // A run wrote its receipt (intent: branch and worktree), then crashed before creating either.
  git('branch', '-D', '7-fix-login');
  const file = recordIntent(state, { root, tracker, ticket: '7', branch: '7-fix-login', base: 'main', runId: 'run-1', branchToCreate: true, worktreeToCreate: true });
  assert.equal(file, receiptFile(state, projectId(root, tracker), '7'));
  const receipt = readReceipt(file)!;
  assert.match(refused(resumeTarget(root, run, { receipt })), /was about to be created, but it never was/);
  // Or it crashed after creating them but before filling the receipt in: Git's identities are returned to fill in.
  git('branch', '7-fix-login');
  git('worktree', 'add', '-q', wt('7-fix-login'), '7-fix-login');
  const tip = git('rev-parse', '7-fix-login');
  const r = resumeTarget(root, run, { receipt });
  assert.equal(r.ok, true, (r as { reason?: string }).reason);
  assert.deepEqual((r as { reconcile?: unknown; adopt?: unknown }).reconcile, { branchSha: tip, worktreeAt: true });
  assert.equal((r as { adopt?: unknown }).adopt, undefined);

  // A receipt for another checkout, another branch, or a branch replaced since its recorded commit is refused.
  assert.match(refused(resumeTarget(root, run, { receipt: { ...receipt, gitCommonDir: '/elsewhere/.git' } })), /not this checkout/);
  assert.match(refused(resumeTarget(root, run, { receipt: { ...receipt, branch: '7-other' } })), /names 7-other/);
  assert.match(refused(resumeTarget(root, run, { receipt: { ...receipt, branchSha: 'f'.repeat(40) } })), /no longer contains/);
  assert.match(refused(resumeTarget(root, run, { receipt: { ...receipt, worktreePath: wt('7') } })), /not the worktree its ownership receipt names/);
});

test('fetchRecordedBranch creates the local branch at exactly origin\'s commit and never forces', t => {
  const { root, git } = fixture(t);
  git('push', '-q', 'origin', '7-fix-login');
  const tip = git('rev-parse', '7-fix-login');
  // A stale remote-tracking ref origin's copy does not descend from: the non-forced fetch refuses to move it.
  git('branch', '-D', '7-fix-login');
  git('checkout', '-q', '--orphan', 'x');
  git('commit', '-q', '--allow-empty', '-m', 'unrelated');
  git('update-ref', 'refs/remotes/origin/7-fix-login', 'HEAD');
  git('checkout', '-q', 'main');
  const stale = fetchRecordedBranch(root, '7-fix-login');
  assert.equal(stale.ok, false);
  assert.match((stale as { reason: string }).reason, /fetch refused/);
  assert.equal(git('branch', '--list', '7-fix-login'), '');
  git('update-ref', '-d', 'refs/remotes/origin/7-fix-login');
  assert.deepEqual(fetchRecordedBranch(root, '7-fix-login'), { ok: true, sha: tip });
  assert.equal(git('rev-parse', '7-fix-login'), tip);
  // A local branch that exists already is never overwritten.
  assert.match((fetchRecordedBranch(root, '7-fix-login') as { reason: string }).reason, /without force/);
});
