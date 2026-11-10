// Registry tests: identity by canonical root, atomic writes, lock contention. Disposable HOME and Git repos only.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject, canonicalRoot, listProjects, readRegistry, removeProject } from '../src/projects.mts';
import { project } from '../src/commands/project.mts';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'ignore' });
export function repo(t: TestContext, home: string, name: string) {
  const dir = join(home, 'work', name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  return realpathSync(dir);
}
function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-proj-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, p: paths(home) };
}
test('identity is the canonical root: aliases collapse, same basename at different roots stays distinct', t => {
  const { home, p } = fixture(t);
  const a = repo(t, home, 'app');
  mkdirSync(join(home, 'other'), { recursive: true });
  git(join(home, 'other'), 'init', '-q');
  mkdirSync(join(home, 'other/app'));
  git(join(home, 'other/app'), 'init', '-q');
  const b = realpathSync(join(home, 'other/app'));
  symlinkSync(a, join(home, 'alias'));
  mkdirSync(join(a, 'sub'));
  assert.equal(addProject(p, canonicalRoot(a)), true);
  assert.equal(addProject(p, canonicalRoot(join(home, 'alias'))), false, 'symlink alias is the same project');
  assert.equal(addProject(p, canonicalRoot(join(a, 'sub'))), false, 'a subdirectory resolves to the Git root');
  assert.equal(addProject(p, canonicalRoot(b)), true, 'same basename, different root');
  assert.deepEqual(readRegistry(p).projects.map(x => x.root), [a, b].sort());
  assert.throws(() => canonicalRoot(home + '/nope'), /No such directory/);
  mkdirSync(join(home, 'plain'));
  assert.throws(() => canonicalRoot(join(home, 'plain')), /Not a Git checkout/);
});
test('git worktrees are separate projects; paths with spaces work', t => {
  const { home, p } = fixture(t);
  const main = repo(t, home, 'my app');
  writeFileSync(join(main, 'f'), 'x');
  git(main, 'add', 'f'); git(main, 'commit', '-qm', 'init');
  const wt = join(home, 'wt tree');
  git(main, 'worktree', 'add', '-q', '-b', 'wt-branch', wt);
  addProject(p, canonicalRoot(main));
  addProject(p, canonicalRoot(wt));
  assert.equal(readRegistry(p).projects.length, 2);
});
test('rm removes only the matching entry; deleted checkouts stay listable and removable; unknown is a no-op', async t => {
  const { home, p } = fixture(t);
  const a = repo(t, home, 'a'); const b = repo(t, home, 'b');
  addProject(p, a); addProject(p, b);
  rmSync(a, { recursive: true });
  const rows = listProjects(p);
  assert.deepEqual(rows.map(r => [r.root, r.exists]), [[a, false], [b, true]].sort());
  await project(p, 'rm', a);
  assert.deepEqual(readRegistry(p).projects.map(x => x.root), [b]);
  assert.ok(existsSync(b), 'project files untouched');
  assert.equal(removeProject(p, '/not/there'), false);
});
test('missing registry is empty; malformed or unsupported registry is reported and never replaced', t => {
  const { home, p } = fixture(t);
  assert.deepEqual(readRegistry(p), { version: 1, projects: [] });
  mkdirSync(p.config, { recursive: true });
  for (const bad of ['{nope', JSON.stringify({ version: 2, projects: [] }), JSON.stringify({ version: 1, projects: [{ name: 'x', root: 'relative' }] })]) {
    writeFileSync(p.projects, bad);
    assert.throws(() => addProject(p, repo(t, home, 'x' + bad.length)), /registry/);
    assert.equal(readFileSync(p.projects, 'utf8'), bad);
  }
});
test('mutation lock: contention fails with a retry message, loses nothing, and is released afterwards', t => {
  const { home, p } = fixture(t);
  const a = repo(t, home, 'a'); const b = repo(t, home, 'b');
  addProject(p, a);
  writeFileSync(`${p.projects}.lock`, '');
  assert.throws(() => addProject(p, b), /Retry shortly/);
  assert.deepEqual(readRegistry(p).projects.map(x => x.root), [a]);
  rmSync(`${p.projects}.lock`);
  addProject(p, b);
  assert.equal(existsSync(`${p.projects}.lock`), false);
  assert.equal(readRegistry(p).projects.length, 2);
});
test('writes are atomic: no temp file is left behind, a failed write keeps the old file, mode is 0600', t => {
  const { home, p } = fixture(t);
  const a = repo(t, home, 'a');
  addProject(p, a);
  assert.equal(execFileSync('stat', ['-c', '%a', p.projects], { encoding: 'utf8' }).trim(), '600');
  const before = readFileSync(p.projects, 'utf8');
  // Block the rename target by making the destination a directory the rename cannot replace.
  rmSync(p.projects); mkdirSync(p.projects);
  assert.throws(() => addProject(p, repo(t, home, 'b')));
  rmSync(p.projects, { recursive: true }); writeFileSync(p.projects, before);
  assert.deepEqual(execFileSync('ls', [p.config], { encoding: 'utf8' }).split('\n').filter(n => n.endsWith('.tmp') || n.endsWith('.lock')), []);
});
