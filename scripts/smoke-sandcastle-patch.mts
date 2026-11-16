// Exact-package offline probes. Export accessors only in a disposable copy of the installed SDK.
// No agent/provider is started; Docker/Podman are argv-recording local executables, never daemons.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function smokeSandcastlePatch(bundle: string, root: string, env: Record<string, string>): Promise<void> {
  const probe = join(root, 'sdk-probe'); mkdirSync(probe);
  cpSync(join(bundle, 'node_modules'), join(probe, 'node_modules'), { recursive: true });
  const dist = join(probe, 'node_modules/@ai-hero/sandcastle/dist');
  appendFileSync(join(dist, 'index.js'), '\nexport { resolveEnv, resolveRunLogging, Effect_exports, NodeContext_exports };\n');
  appendFileSync(join(dist, 'chunk-G2R53CVZ.js'), '\nexport { isManagedWorktree, createPatchDir, removePatchDir, buildRecoveryMessage };\n');
  const sdk = await import(pathToFileURL(join(dist, 'index.js')).href);
  const worktree = await import(pathToFileURL(join(dist, 'chunk-G2R53CVZ.js')).href);
  const run = (effect: any) => sdk.Effect_exports.runPromise(effect.pipe(sdk.Effect_exports.provide(sdk.NodeContext_exports.layer)));
  const repo = join(probe, 'repo'); mkdirSync(join(repo, '.factory'), { recursive: true });
  const gitEnv = { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Offline fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Offline fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  function git(...args: string[]) {
    const result = spawnSync('git', args, { cwd: repo, env: gitEnv, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  }
  git('init', '--initial-branch=main');
  writeFileSync(join(repo, '.gitignore'), '.factory/\n.sandcastle/\n');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '.gitignore'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'offline fixture');
  const wt = await run(worktree.create(repo, { branch: 'offline-probe' }));
  assert.equal(wt.path, join(repo, '.factory/worktrees/offline-probe'));
  assert(worktree.isManagedWorktree(wt.path));
  assert(!worktree.isManagedWorktree(join(repo, '.sandcastle/worktrees/old')));
  // A managed worktree can be reused. Pruning removes only orphan directories, not a live worktree.
  writeFileSync(join(wt.path, 'dirty-fixture'), 'force local reuse without origin refresh\n');
  assert.equal((await run(worktree.create(repo, { branch: 'offline-probe' }))).path, wt.path);
  const orphan = join(repo, '.factory/worktrees/orphan'); mkdirSync(orphan);
  await run(worktree.pruneStale(repo));
  assert(!existsSync(orphan)); assert(existsSync(wt.path));
  writeFileSync(join(repo, '.factory/.env'), 'FACTORY_OFFLINE_SENTINEL=owned-fixture\n');
  assert.equal((await run(sdk.resolveEnv(repo))).FACTORY_OFFLINE_SENTINEL, 'owned-fixture');
  const logging = sdk.resolveRunLogging({}, repo, { resolvedBranch: 'offline-probe' });
  assert.equal(logging.type, 'file'); assert(logging.path.startsWith(join(repo, '.factory/logs/')));
  const explicit = { type: 'file', path: join(probe, 'explicit.log') };
  assert.equal(sdk.resolveRunLogging({ logging: explicit }, repo, { resolvedBranch: 'offline-probe' }), explicit);
  // Exercise the SDK's real file logger, without an agent.
  const loggingEffect = worktree.Display.pipe(sdk.Effect_exports.flatMap((display: any) => display.textChunk('offline-log-sentinel')));
  await sdk.Effect_exports.runPromise(loggingEffect.pipe(sdk.Effect_exports.provide(worktree.FileDisplay.layer(logging.path)), sdk.Effect_exports.provide(sdk.NodeContext_exports.layer)));
  assert.match(readFileSync(logging.path, 'utf8'), /offline-log-sentinel/);
  const patchDir = await run(worktree.createPatchDir(repo));
  assert(patchDir.startsWith(join(repo, '.factory/patches/'))); assert(existsSync(patchDir));
  const recovery = worktree.buildRecoveryMessage({ patchDir: '.factory/patches/fixture', failedStep: 'diff', hasCommits: false, hasDiff: true, hasUntracked: false });
  assert.match(recovery, /\.factory\/patches\/fixture/); assert(!recovery.includes('.sandcastle'));
  await run(worktree.removePatchDir(repo, patchDir));
  assert(!existsSync(join(repo, '.factory/patches')));
  await run(worktree.remove(wt.path)); assert(!existsSync(wt.path));
  assert(!existsSync(join(repo, '.sandcastle')));

  const bin = join(probe, 'bin'), argvFile = join(probe, 'docker-argv.json'); mkdirSync(bin);
  for (const command of ['docker', 'podman']) writeFileSync(join(bin, command), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  writeFileSync(join(repo, '.factory/Dockerfile'), '# inert offline fixture\n');
  writeFileSync(join(repo, '.factory/Containerfile'), '# inert offline fixture\n');
  const custom = join(repo, 'custom-containerfile'); writeFileSync(custom, '# inert custom fixture\n');
  for (const command of ['docker', 'podman']) for (const explicit of [false, true]) {
    const flag = command === 'docker' ? '--dockerfile' : '--containerfile';
    const result = spawnSync(process.execPath, [join(dist, 'main.js'), command, 'build-image', '--image-name', 'offline-fixture', ...explicit ? [flag, custom] : []], {
      cwd: repo, env: { ...gitEnv, PATH: `${bin}:${env.PATH}` }, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const args = JSON.parse(readFileSync(argvFile, 'utf8'));
    const buildArgs = command === 'docker' ? ['--build-arg', `AGENT_UID=${process.getuid!()}`, '--build-arg', `AGENT_GID=${process.getgid!()}`] : [];
    assert.deepEqual(args, ['build', '-t', 'offline-fixture', ...buildArgs, ...explicit ? ['-f', custom, repo] : [join(repo, '.factory')]]);
  }
  console.log('PASS: exact patched SDK create/reuse/recognize/prune/remove worktrees, env, default/explicit file log, patch create/cleanup/recovery, CLI Docker/Podman default and explicit build argv (local recorders only)');
}
