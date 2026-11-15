// Offline readiness tests. All writes/Git commands belong to temporary fixtures; errors are injected portably.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectReadiness, observeReadiness, probeFilesystem, validReport, displayFreshness } from './readiness.mts';
import type { ReadinessInput, ReadinessIO, ReadinessPath } from './readiness.mts';
function fixture(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'factory readiness ')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project'), state = join(root, 'shared state'), runtime = join(root, 'runtime');
  for (const p of [project, state, runtime]) fs.mkdirSync(p);
  fs.writeFileSync(join(runtime, 'main.mts'), 'fixture runtime');
  fs.writeFileSync(join(project, 'instructions.md'), 'fixture asset');
  const input: ReadinessInput = { identity: { projectRoot: project, runtimeIdentity: 'runtime-a', configIdentity: 'config-a', contextFingerprint: 'context-a' },
    owner: { invocationId: 'invocation-a', ownerId: 'owner-a', generation: 'generation-a' }, paths: [
      { id: 'checkout', role: 'checkout', scope: 'project', path: project, trustedRoot: project, access: 'read-directory' },
      { id: 'instructions', role: 'project-asset', scope: 'ticket-input', path: join(project, 'instructions.md'), trustedRoot: project, access: 'read-file' },
      { id: 'runtime', role: 'runtime', scope: 'project', path: join(runtime, 'main.mts'), trustedRoot: runtime, access: 'read-file' },
      { id: 'state', role: 'state', scope: 'project', path: state, trustedRoot: state, access: 'write-directory' },
      { id: 'logs', role: 'artifact', scope: 'project', path: join(project, '.sandcastle', 'logs'), trustedRoot: project, access: 'write-directory', create: true },
    ] };
  return { root, project, state, runtime, input };
}
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(path: string) { for (const n of fs.readdirSync(path)) { const p = join(path, n), s = fs.lstatSync(p); if (s.isDirectory()) walk(p); else result[p] = s.isSymbolicLink() ? fs.readlinkSync(p) : fs.readFileSync(p).toString('hex'); } }
  walk(root); return result;
}
const error = (code: string) => Object.assign(new Error('PRIVATE BODY MUST NOT APPEAR'), { code });
function inject(method: keyof ReadinessIO, fn: (...args: any[]) => any): ReadinessIO { return { ...fs, [method]: fn } as ReadinessIO; }
test('passive is byte-preserving and unproven; active creates only intended dirs and removes owned probes', async t => {
  const f = fixture(t), before = snapshot(f.root);
  const passive = await observeReadiness(f.input);
  assert.equal(passive.status, 'unknown'); assert.ok(validReport(passive));
  assert.equal(passive.checks.find(c => c.id === 'logs')?.operation, 'write-unproven');
  assert.deepEqual(snapshot(f.root), before); assert.equal(fs.existsSync(join(f.project, '.sandcastle')), false);
  const active = await probeFilesystem(f.input);
  assert.equal(active.status, 'ready', JSON.stringify(active)); assert.ok(validReport(active));
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(fs.readdirSync(join(f.project, '.sandcastle')), ['logs']);
  assert.deepEqual(fs.readdirSync(join(f.project, '.sandcastle', 'logs')), []);
  assert.deepEqual(fs.readdirSync(f.state), []);
  assert.equal(displayFreshness(active, f.input.identity, Date.parse(active.observedAt)), 'current');
  assert.equal(displayFreshness(active, { ...f.input.identity, configIdentity: 'other' }, Date.parse(active.observedAt)), 'stale');
});
test('normal and linked Git checkouts with external common-dir work; dirtiness is not a veto', async t => {
  const f = fixture(t);
  const git = (...args: string[]) => execFileSync('git', ['-C', f.project, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  git('init', '-q'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'empty', '--allow-empty');
  const linked = join(f.root, 'linked checkout'); git('worktree', 'add', '-qb', 'fixture-linked', linked);
  const common = join(f.project, '.git');
  const actualGit = execFileSync('git', ['-C', linked, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  f.input.identity.projectRoot = linked;
  f.input.paths = [
    { id: 'checkout', role: 'checkout', scope: 'project', path: linked, trustedRoot: linked, access: 'read-directory' },
    { id: 'git-dir', role: 'git-dir', scope: 'project', path: actualGit, trustedRoot: common, access: 'read-directory' },
    { id: 'common', role: 'git-common-dir', scope: 'project', path: common, trustedRoot: common, access: 'read-directory' },
    { id: 'base', role: 'base', scope: 'project', path: join(common, 'HEAD'), trustedRoot: common, access: 'read-file' },
    { id: 'worktrees', role: 'worktree-parent', scope: 'ticket-workspace', path: join(f.state, 'worktrees'), trustedRoot: f.state, access: 'write-directory', create: true },
  ];
  const before = snapshot(f.root);
  assert.equal((await probeFilesystem(f.input)).status, 'ready'); assert.deepEqual(snapshot(f.root), before);
  fs.writeFileSync(join(linked, 'dirty.txt'), 'dirty');
  assert.equal((await probeFilesystem(f.input)).status, 'ready');
});
for (const code of ['EACCES', 'EROFS', 'ENOSPC', 'EDQUOT']) test(`portable injected ${code} holds launch without leaking error body`, t => {
  const f = fixture(t); f.input.paths = [f.input.paths[3]];
  const report = collectReadiness(f.input, 'active', inject('openSync', (...args: any[]) => {
    if (String(args[0]).includes('.factory-probe-')) throw error(code);
    return (fs.openSync as any)(...args);
  }));
  assert.equal(report.status, 'blocked'); assert.equal(report.checks[0].errno, code);
  assert.equal(report.checks[0].operation, 'create'); assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  assert.deepEqual(fs.readdirSync(f.state), []);
});
for (const method of ['writeSync', 'renameSync', 'unlinkSync'] as const) test(`injected ${method} retains failure and owned cleanup diagnostics`, t => {
  const f = fixture(t); f.input.paths = [f.input.paths[3]];
  const report = collectReadiness(f.input, 'active', inject(method, () => { throw error('EACCES'); }));
  assert.equal(report.status, 'blocked'); assert.ok(report.checks.some(c => c.errno === 'EACCES'));
  if (method !== 'unlinkSync') assert.deepEqual(fs.readdirSync(f.state), []);
  else assert.ok(report.checks.some(c => c.operation === 'remove'));
});
test('read errors and incomplete writes cannot be reported as established access', t => {
  const f = fixture(t);
  f.input.paths = [f.input.paths[1]];
  const unreadable = collectReadiness(f.input, 'passive', inject('readSync', () => { throw error('EIO'); }));
  assert.equal(unreadable.status, 'blocked'); assert.equal(unreadable.checks[0].operation, 'read');
  f.input.paths = [{ id: 'state', role: 'state', scope: 'project', path: f.state, trustedRoot: f.state, access: 'write-directory' }];
  const short = collectReadiness(f.input, 'active', inject('writeSync', () => 1));
  assert.equal(short.status, 'blocked'); assert.equal(short.checks[0].operation, 'write');
  assert.deepEqual(fs.readdirSync(f.state), []);
});
test('capacity zero blocks, low capacity is advisory, unsupported metrics stay unavailable', t => {
  const f = fixture(t); f.input.paths = [f.input.paths[3]];
  for (const [bavail, ffree, status] of [[0n, 10n, 'blocked'], [10n, 0n, 'blocked'], [1n, 1n, 'ready']] as const) {
    const report = collectReadiness(f.input, 'active', inject('statfsSync', () => ({ bavail, bsize: 1n, files: 10n, ffree })));
    assert.equal(report.status, status);
  }
  const report = collectReadiness(f.input, 'active', inject('statfsSync', () => { throw error('ENOSYS'); }));
  assert.equal(report.status, 'ready');
  assert.deepEqual(report.checks.at(-1)?.capacity, { bytesAvailable: null, inodesAvailable: null });
  assert.equal(report.checks.at(-1)?.required, false);
});
test('escaping and dangling symlinks, wrong asset roots and missing required assets fail closed', async t => {
  const f = fixture(t), before = snapshot(f.root);
  for (const dest of [f.state, join(f.root, 'absent')]) {
    const link = join(f.project, 'linked'); fs.symlinkSync(dest, link);
    f.input.paths = [{ id: 'unsafe', scope: 'project', role: 'artifact', path: join(link, 'logs'), trustedRoot: f.project, access: 'write-directory', create: true }];
    assert.equal((await probeFilesystem(f.input)).status, 'blocked'); fs.unlinkSync(link);
  }
  f.input.paths = [{ id: 'asset', scope: 'ticket-input', role: 'project-asset', path: join(f.runtime, 'main.mts'), trustedRoot: f.runtime, access: 'read-file' }];
  assert.equal((await observeReadiness(f.input)).status, 'blocked');
  f.input.paths = [{ ...f.input.paths[0], path: join(f.project, 'missing.md'), trustedRoot: f.project }];
  assert.equal((await probeFilesystem(f.input)).checks[0].errno, 'ENOENT');
  assert.deepEqual(snapshot(f.root), before);
});
test('path replacement is detected before mutation and never follows the replacement link', t => {
  const f = fixture(t), target = join(f.state, 'owned'); fs.mkdirSync(target);
  f.input.paths = [{ id: 'state', role: 'state', scope: 'project', path: target, trustedRoot: f.state, access: 'write-directory' }];
  let swapped = false;
  const report = collectReadiness(f.input, 'active', inject('lstatSync', (...args: any[]) => {
    if (args[0] === f.state && !swapped) { swapped = true; fs.renameSync(target, `${target}.old`); fs.symlinkSync(f.runtime, target); }
    return (fs.lstatSync as any)(...args);
  }));
  assert.equal(report.status, 'blocked'); assert.deepEqual(fs.readdirSync(f.runtime), ['main.mts']);
  assert.deepEqual(fs.readdirSync(`${target}.old`), []);
});
test('timeouts and cancellation reject rather than reuse healthy observations', async t => {
  const f = fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(probeFilesystem(f.input, { signal: controller.signal }), { code: 'ECANCELED' });
  await assert.rejects(observeReadiness(f.input, { timeoutMs: 1 }), { code: 'ETIMEDOUT' });
  const running = new AbortController(), promise = probeFilesystem(f.input, { signal: running.signal }); running.abort();
  await assert.rejects(promise, { code: 'ECANCELED' });
});
