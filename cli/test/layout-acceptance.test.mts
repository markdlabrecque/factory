// Offline entrypoint acceptance: rejected layouts preserve project/Git/shared authority byte-for-byte.
// Only Board assessment/request observations may change. All external execution stubs reject; homes are temporary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { init } from '../src/commands/init.mts';
import { run } from '../src/commands/run.mts';
import { dispatch, runDispatchSh } from '../src/commands/dispatch.mts';
import { runRefreshOnly } from '../src/commands/tick.mts';
import { clean } from '../src/commands/clean.mts';
import { project } from '../src/commands/project.mts';
import { addProject } from '../src/projects.mts';
import { resolveProject } from '../src/runs.mts';
import { doctorReadiness } from '../src/readiness.mts';
import { installedFixture } from './workflow-fixture.mts';
import { factoryToml } from './config-fixture.mts';
import { executeRefresh } from '../../board/refresh-worker.mts';
import { readAssessment, requestRefresh, writeAssessment } from '../../board/assessment.mts';
import { requireProjectLayout } from '../../orchestrator/project-layout.mts';

// Do not follow links or compare timestamps. Include Git's index, refs, worktree registrations and credentials.
function snapshot(path: string, omit: string[] = []): unknown {
  if (!existsSync(path)) { try { lstatSync(path); } catch { return null; } }
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return { mode: st.mode, link: readlinkSync(path) };
  if (st.isDirectory()) return { mode: st.mode, entries: readdirSync(path).sort().filter(n => !omit.includes(n)).map(n => [n, snapshot(join(path, n))]) };
  return { mode: st.mode, bytes: readFileSync(path).toString('hex') };
}

for (const kind of ['old-only', 'mixed', 'symlink', 'type-conflict', 'unreadable'] as const) {
  test(`${kind}: init, launch, scheduled/Board refresh and project cleanup preserve saved authority`, async t => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-layout-accept-'))), p = paths(home);
    const root = join(home, 'project'), outside = join(home, 'outside'), bin = join(home, 'bin');
    mkdirSync(root); mkdirSync(outside); mkdirSync(bin);
    const saved = { ...process.env };
    t.after(() => {
      if (kind === 'unreadable') chmodSync(join(root, '.factory/factory.toml'), 0o640);
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved); rmSync(home, { recursive: true, force: true });
    });
    Object.assign(process.env, { HOME: home, FACTORY_HOME: home, SANDCASTLE_STATE_DIR: p.state, FACTORY_RUNTIME_DESCRIPTOR: p.runtimeDescriptor, PATH: `${bin}:/usr/bin:/bin`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' });
    for (const command of ['gh', 'gh-axi', 'glab', 'docker', 'podman', 'npm', 'npx', 'curl', 'systemctl', 'launchctl']) {
      writeFileSync(join(bin, command), `#!/bin/sh\necho ${command} >> '${home}/external-called'\nexit 99\n`, { mode: 0o755 });
    }
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    writeFileSync(join(root, 'app.txt'), 'committed\n'); git('add', 'app.txt');
    git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
    git('remote', 'add', 'origin', root); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(join(root, '.factory'));
    writeFileSync(join(root, '.factory/factory.toml'), factoryToml('owner/repo'));
    writeFileSync(join(root, '.factory/.env'), 'fixture-secret-not-to-be-read', { mode: 0o600 });
    mkdirSync(join(root, '.factory/evidence/7/saved'), { recursive: true });
    writeFileSync(join(root, '.factory/evidence/7/saved/proof'), Buffer.from([0, 255, 42]), { mode: 0o640 });
    git('worktree', 'add', '-q', '-b', '7-saved', join(root, '.factory/worktrees/7-saved'), 'main');
    writeFileSync(join(root, '.factory/worktrees/7-saved/dirty.txt'), 'keep untracked work');
    writeFileSync(join(root, 'app.txt'), 'staged\n'); git('add', 'app.txt'); writeFileSync(join(root, 'app.txt'), 'unstaged\n');
    installedFixture(p); addProject(p, root);
    const ctx = resolveProject(p, { cwd: root });
    const ready = await doctorReadiness(p, root, true);
    assert.equal(ready.report.status, 'ready', 'the later refusal must not trust this previously ready observation');
    mkdirSync(p.state, { recursive: true });
    const key = 'owner_repo--7';
    writeFileSync(join(p.state, `${key}.json`), JSON.stringify({ iid: '7', project: 'owner/repo', stage: 'stopped', pid: process.pid, branch: '7-saved', base: 'main', executionId: 'saved-execution', evidenceDir: join(root, '.factory/evidence/7/saved') }));
    mkdirSync(join(p.state, 'recovery'), { recursive: true });
    writeFileSync(join(p.state, 'recovery/saved.json'), '{"attempts":[{"id":"interrupted","state":"cleanup-pending"}]}', { mode: 0o640 });
    writeAssessment(p.state, key, { iid: '7', project: 'owner/repo', projectRoot: root });
    requestRefresh(p.state, key, '7', 'owner/repo');
    if (kind === 'old-only') renameSync(join(root, '.factory'), join(root, '.sandcastle'));
    if (kind === 'mixed') { mkdirSync(join(root, '.sandcastle')); writeFileSync(join(root, '.sandcastle/receipt'), 'historical ownership'); }
    if (kind === 'symlink') { renameSync(join(root, '.factory'), join(outside, 'assets')); symlinkSync(join(outside, 'assets'), join(root, '.factory')); }
    if (kind === 'type-conflict') { renameSync(join(root, '.factory'), join(outside, 'assets')); writeFileSync(join(root, '.factory'), 'not a directory', { mode: 0o640 }); }
    if (kind === 'unreadable') chmodSync(join(root, '.factory/factory.toml'), 0);
    const reason = /legacy-layout|mixed-layout|factory-unsafe|inspection-unavailable/;
    assert.throws(() => requireProjectLayout(root), reason);
    // Restore permissions only for snapshot reads, never while an entrypoint observes the unreadable layout.
    const capture = () => {
      if (kind === 'unreadable') {
        assert.equal(lstatSync(join(root, '.factory/factory.toml')).mode & 0o777, 0, 'entrypoints must preserve unreadable mode');
        chmodSync(join(root, '.factory/factory.toml'), 0o640);
      }
      try { return { project: snapshot(root), outside: snapshot(outside), state: snapshot(p.state, ['assessment', 'refresh']), registry: snapshot(p.projects), git: [git('show-ref'), git('status', '--porcelain=v1', '--untracked-files=all'), git('ls-files', '--stage')] }; }
      finally { if (kind === 'unreadable') chmodSync(join(root, '.factory/factory.toml'), 0); }
    };
    const before = capture();
    const refuse = async (operation: () => unknown) => {
      await assert.rejects(async () => operation(), reason);
      assert.deepEqual(capture(), before);
    };
    await refuse(() => init(p, root, { profile: 'personal', repo: 'owner/repo', image: 'fixture' }));
    await refuse(() => run(p, '7', { cwd: root }));
    await refuse(() => dispatch(p, { cwd: root }));
    const options = { group: true as const, env: { ...process.env, FACTORY_SCHEDULED: '1' }, onSpawn: () => assert.fail('refused project cannot spawn') };
    await refuse(() => runDispatchSh(p, ctx, [], options));
    await refuse(() => runRefreshOnly(process.execPath, p)(ctx, ['--refresh-only', '--base', 'main'], options));
    await refuse(() => project(p, 'add', root));
    await refuse(() => clean(p, { cwd: root }));
    await executeRefresh(key);
    assert.match(readAssessment(p.state, key)?.error ?? '', reason);
    assert.deepEqual(capture(), before, 'Board may record a refusal observation, never mutate saved authority');
    assert.equal(existsSync(join(home, 'external-called')), false);
    assert.equal(existsSync(join(p.state, 'admission')), false);
  });
}
