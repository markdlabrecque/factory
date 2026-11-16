// Pure layout/policy cases plus one temporary-filesystem boundary test. No project execution or real-home access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyProjectLayout, inspectProjectLayout, projectLayoutPaths, projectLayoutPolicy,
  PROJECT_ASSET_BASENAME, UNSUPPORTED_PROJECT_ASSET_BASENAME } from './project-layout.mts';
import type { LayoutEntry, LayoutObservations, LayoutInspection } from './project-layout.mts';

const root = '/checkout', p = projectLayoutPaths(root);
const missing: LayoutEntry = { kind: 'missing' };
const directory = (canonicalPath: string): LayoutEntry => ({ kind: 'directory', canonicalPath });
const file = (canonicalPath: string): LayoutEntry => ({ kind: 'file', canonicalPath });
const good: LayoutObservations = { project: directory(root), factory: directory(p.assets), legacy: missing, config: file(p.config) };
const classify = (overrides: Partial<LayoutObservations> = {}) => classifyProjectLayout(root, { ...good, ...overrides });
const refused = (reason: string) => ({ kind: 'refused', reason });

test('pure project path contract covers assets without rewriting owner suffixes', () => {
  assert.equal(PROJECT_ASSET_BASENAME, '.factory');
  assert.equal(UNSUPPORTED_PROJECT_ASSET_BASENAME, '.sandcastle');
  assert.deepEqual(p, { projectRoot: root, assets: '/checkout/.factory', unsupportedAssets: '/checkout/.sandcastle',
    config: '/checkout/.factory/factory.toml', env: '/checkout/.factory/.env', envExample: '/checkout/.factory/.env.example',
    gitignore: '/checkout/.factory/.gitignore', dispatchWrapper: '/checkout/.factory/factory-dispatch.sh',
    helpers: '/checkout/.factory/sandbox', logs: '/checkout/.factory/logs', evidence: '/checkout/.factory/evidence',
    worktrees: '/checkout/.factory/worktrees', diagnosticSessions: '/checkout/.factory/diagnostic-sessions', recovery: '/checkout/.factory/recovery' });
  assert.equal(join(p.recovery, 'attempt-identity', 'git'), '/checkout/.factory/recovery/attempt-identity/git');
});

test('pure classification refuses every legacy entry, aliases, type conflicts and unknown observations', () => {
  assert.deepEqual(classify(), { kind: 'supported', config: 'present' });
  assert.deepEqual(classify({ factory: missing, config: missing }), { kind: 'fresh' });
  assert.deepEqual(classify({ config: missing }), { kind: 'supported', config: 'missing' });
  for (const legacy of [directory('/old'), file('/old'), { kind: 'symlink' }, { kind: 'other' }] as LayoutEntry[]) {
    assert.deepEqual(classify({ legacy, factory: missing }), refused('legacy-layout'));
    assert.deepEqual(classify({ legacy }), refused('mixed-layout'));
  }
  for (const key of ['project', 'factory', 'legacy', 'config'] as const)
    assert.deepEqual(classify({ [key]: { kind: 'unknown' } }), refused('inspection-unavailable'), key);
  for (const entry of [missing, file(root), directory('/alias'), { kind: 'symlink' }, { kind: 'other' }] as LayoutEntry[])
    assert.deepEqual(classify({ project: entry }), refused('project-unsafe'));
  for (const entry of [file(p.assets), directory('/alias'), { kind: 'symlink' }, { kind: 'other' }] as LayoutEntry[])
    assert.deepEqual(classify({ factory: entry }), refused('factory-unsafe'));
  for (const entry of [directory(p.config), file('/outside/factory.toml'), file(p.assets + '-alias/factory.toml'),
    file(p.assets), file('relative'), { kind: 'symlink' }, { kind: 'other' }] as LayoutEntry[])
    assert.deepEqual(classify({ config: entry }), refused('config-unsafe'));
  assert.deepEqual(classify({ factory: missing, legacy: { kind: 'unknown' } }), refused('inspection-unavailable'));
});

test('init fresh allowance is explicit and existing layouts always retain config/runtime validation gates', () => {
  const fresh: LayoutInspection = { kind: 'fresh' };
  assert.deepEqual(projectLayoutPolicy(fresh, 'init'), { allowed: true, requiresProjectValidation: false });
  assert.deepEqual(projectLayoutPolicy(fresh, 'existing'), { allowed: false, reason: 'fresh-not-allowed' });
  for (const operation of ['init', 'existing'] as const) {
    assert.deepEqual(projectLayoutPolicy(classify(), operation), { allowed: true, requiresProjectValidation: true });
    assert.deepEqual(projectLayoutPolicy(classify({ config: missing }), operation), { allowed: false, reason: 'config-missing' });
    for (const reason of ['project-unsafe', 'inspection-unavailable', 'legacy-layout', 'mixed-layout', 'factory-unsafe', 'config-unsafe'] as const)
      assert.deepEqual(projectLayoutPolicy({ kind: 'refused', reason }, operation), { allowed: false, reason });
  }
});

// Capture names, bytes, link text and modes without following links. Atime is intentionally not a write contract.
function snapshot(path: string): unknown {
  const st = lstatSync(path), mode = st.mode;
  if (st.isSymbolicLink()) return { mode, link: readlinkSync(path) };
  if (st.isDirectory()) return { mode, entries: readdirSync(path).sort().map(name => [name, snapshot(join(path, name))]) };
  return { mode, bytes: readFileSync(path).toString('hex') };
}

test('filesystem inspection preserves all bytes/modes and creates nothing across absence and refusal cases', t => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'factory-layout-')));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const project = join(temp, 'project'); mkdirSync(project);
  const paths = projectLayoutPaths(project);
  function check(expected: LayoutInspection, target = project) {
    const before = snapshot(temp);
    assert.deepEqual(inspectProjectLayout(target), expected);
    assert.deepEqual(snapshot(temp), before, 'inspection must preserve names, link targets, bytes and modes');
    for (const operation of ['init', 'existing'] as const) projectLayoutPolicy(inspectProjectLayout(target), operation);
    assert.deepEqual(snapshot(temp), before, 'policy must create nothing, including for refusals');
  }
  check(refused('project-unsafe') as LayoutInspection, join(temp, 'missing-project'));
  check({ kind: 'fresh' });
  mkdirSync(paths.unsupportedAssets);
  const evidence = join(paths.unsupportedAssets, 'evidence/7/attempt'); mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'proof'), Buffer.from([0, 255, 10, 42])); chmodSync(join(evidence, 'proof'), 0o640);
  writeFileSync(join(paths.unsupportedAssets, '.env'), 'DO NOT READ OR ECHO'); chmodSync(join(paths.unsupportedAssets, '.env'), 0o600);
  check(refused('legacy-layout') as LayoutInspection);
  mkdirSync(paths.assets); check(refused('mixed-layout') as LayoutInspection);
  rmSync(paths.assets, { recursive: true });
  rmSync(paths.unsupportedAssets, { recursive: true });
  for (const target of [join(temp, 'missing-target'), temp]) {
    symlinkSync(target, paths.unsupportedAssets);
    check(refused('legacy-layout') as LayoutInspection);
    mkdirSync(paths.assets); check(refused('mixed-layout') as LayoutInspection);
    rmSync(paths.assets, { recursive: true }); rmSync(paths.unsupportedAssets);
  }
  writeFileSync(paths.unsupportedAssets, 'old non-directory'); check(refused('legacy-layout') as LayoutInspection);
  rmSync(paths.unsupportedAssets);
  writeFileSync(paths.assets, 'conflict'); check(refused('factory-unsafe') as LayoutInspection); rmSync(paths.assets);
  const outside = join(temp, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'factory.toml'), 'not parsed');
  for (const target of [outside, join(temp, 'missing-target')]) {
    symlinkSync(target, paths.assets); check(refused('factory-unsafe') as LayoutInspection); rmSync(paths.assets);
  }
  mkdirSync(paths.assets); check({ kind: 'supported', config: 'missing' });
  mkdirSync(paths.config); check(refused('config-unsafe') as LayoutInspection); rmSync(paths.config, { recursive: true });
  // Both contained and escaping aliases are refused, including dangling config aliases.
  writeFileSync(join(paths.assets, 'inside.toml'), 'still not parsed');
  for (const target of [join(paths.assets, 'inside.toml'), join(outside, 'factory.toml'), join(temp, 'missing-config')]) {
    symlinkSync(target, paths.config); check(refused('config-unsafe') as LayoutInspection); rmSync(paths.config);
  }
  writeFileSync(paths.config, 'deliberately invalid config: structural approval is not validation'); chmodSync(paths.config, 0o640);
  writeFileSync(paths.env, 'UNREAD_ENV'); chmodSync(paths.env, 0o600);
  check({ kind: 'supported', config: 'present' });
  const alias = join(temp, 'project-alias'); symlinkSync(project, alias);
  check(refused('project-unsafe') as LayoutInspection, alias);
});
