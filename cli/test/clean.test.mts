// `factory clean` tests (#96): only a merged (`done` + `mergedAt`) ticket's local branch is removed, with its Factory
// worktree, when every commit is in the base or on origin and the worktree is clean; unpushed work, a dirty worktree,
// a checkout Factory does not own and unmerged runs are kept; remote branches stay; --dry-run deletes nothing.
// Disposable HOME, Git repos with a bare origin, and run records; no tracker, Docker or service manager.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { clean } from '../src/commands/clean.mts';
import { factoryBin } from './schedule-helpers.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-clean-')));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  delete process.env.SANDCASTLE_STATE_DIR;
  t.after(() => { rmSync(home, { recursive: true, force: true }); if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const p = paths(home);
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
  const origin = join(home, 'origin.git');
  mkdirSync(origin);
  sh(origin, 'init', '-q', '--bare', '-b', 'main');
  const root = join(home, 'site');
  mkdirSync(join(root, '.sandcastle'), { recursive: true });
  const git = (...args: string[]) => sh(root, ...args);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), '.sandcastle/\n');
  git('add', '.gitignore');
  git('commit', '-q', '-m', 'init');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  writeFileSync(join(root, '.sandcastle/config.mts'), 'export const TRACKER = {\n  project: "me/site",\n};\n');
  addProject(p, realpathSync(root));
  mkdirSync(p.state, { recursive: true });
  const record = (iid: number, extra: Record<string, unknown>) => {
    const now = new Date().toISOString();
    writeFileSync(join(p.state, `me_site--${iid}.json`), JSON.stringify({ iid: String(iid), project: 'me/site', stage: 'done',
      stageSince: now, startedAt: now, updatedAt: now, pid: process.pid, base: 'main', ...extra }));
  };
  /** A Factory branch `<iid>-work` with one commit, made in its worktree under .sandcastle/worktrees/ (or none). */
  const branch = (iid: number, o: { worktree?: boolean; push?: boolean } = {}) => {
    const name = `${iid}-work`, wt = join(root, '.sandcastle/worktrees', name);
    git('worktree', 'add', '-q', '-b', name, wt, 'main');
    writeFileSync(join(wt, `f${iid}.txt`), `${iid}\n`);
    sh(wt, 'add', '.'); sh(wt, 'commit', '-q', '-m', `#${iid}`);
    if (o.push) sh(wt, 'push', '-q', 'origin', name);
    if (o.worktree === false) git('worktree', 'remove', wt);
    return { name, wt };
  };
  const has = (b: string) => git('branch', '--list', b) !== '';
  return { home, p, root, git, sh, origin, record, branch, has };
}

test('removes merged, clean Factory branches and their worktrees, and keeps anything that would lose work', t => {
  const f = fixture(t);
  const merged = { mergedAt: '2026-11-12T00:00:00Z' };
  const squashed = f.branch(1, { push: true });                 // squash-merged: pushed, not in main
  f.record(1, { branch: squashed.name, ...merged });
  const plain = f.branch(2, { worktree: false });               // merged into main locally, no worktree
  f.git('merge', '-q', '--ff-only', plain.name);
  f.record(2, { branch: plain.name, ...merged });
  const unpushed = f.branch(3, { push: true });                 // a commit made after the push
  writeFileSync(join(unpushed.wt, 'late.txt'), 'late\n');
  f.sh(unpushed.wt, 'add', '.'); f.sh(unpushed.wt, 'commit', '-q', '-m', 'late');
  f.record(3, { branch: unpushed.name, ...merged });
  const dirty = f.branch(4, { push: true });
  writeFileSync(join(dirty.wt, 'scratch.txt'), 'wip\n');
  f.record(4, { branch: dirty.name, ...merged });
  const foreign = f.branch(5, { push: true, worktree: false });
  const elsewhere = join(f.home, 'mine');
  f.git('worktree', 'add', '-q', elsewhere, foreign.name);
  f.record(5, { branch: foreign.name, ...merged });
  const open = f.branch(6, { push: true });                     // done, PR not merged yet
  f.record(6, { branch: open.name });

  const lines: string[] = [];
  t.mock.method(console, 'log', (s: string) => lines.push(s));
  assert.equal(clean(f.p, { cwd: f.root, dryRun: true }), 0);
  assert.ok([1, 2, 3, 4, 5, 6].every(i => f.has(`${i}-work`)) && existsSync(squashed.wt), 'a dry run deletes nothing');
  assert.match(lines.join('\n'), /Would remove #1: 1-work and worktree/);

  assert.equal(clean(f.p, { cwd: f.root }), 0);
  assert.equal(f.has('1-work'), false);
  assert.equal(existsSync(squashed.wt), false);
  assert.equal(f.has('2-work'), false);
  for (const i of [3, 4, 5, 6]) assert.ok(f.has(`${i}-work`), `#${i} is kept`);
  assert.ok(existsSync(join(dirty.wt, 'scratch.txt')) && existsSync(elsewhere));
  const out = lines.join('\n');
  assert.match(out, /Kept #3: 3-work has commits that are neither in main nor on origin\/3-work/);
  assert.match(out, /Kept #4: 4-work its worktree has uncommitted/);
  assert.match(out, /Kept #5: 5-work is checked out in .*mine, which Factory does not own/);
  assert.doesNotMatch(out, /#6/);
  assert.ok(f.sh(f.origin, 'branch', '--list', '1-work'), 'the remote branch is never touched');
});

test('the CLI cleans the project named by --project and reports JSON', t => {
  const f = fixture(t);
  const b = f.branch(7, { push: true });
  f.record(7, { branch: b.name, mergedAt: '2026-11-12T00:00:00Z' });
  const r = spawnSync(process.execPath, [factoryBin, 'clean', '--project', 'site', '--json'], { encoding: 'utf8', env: { ...process.env, FACTORY_HOME: f.home } });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.removed, [{ ticket: '7', branch: '7-work', worktree: b.wt }]);
  assert.equal(f.has('7-work'), false);
});
