// Offline immutable image readiness, ownership, bounded control, cache and uncertainty regressions. No Docker daemon.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkImageCapabilities, PROBE_HASH } from './capabilities.mts';
import type { DockerCommand } from './capabilities.mts';
const A = `sha256:${'a'.repeat(64)}`, B = `sha256:${'b'.repeat(64)}`, ID = 'c'.repeat(64);
function fixture(t: TestContext) {
  const stateDir = mkdtempSync(join(tmpdir(), 'factory-image-'));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const calls: { args: string[]; timeout: number; signal?: AbortSignal }[] = [];
  const s = { imageId: A, user: '1000', message: 'browser preflight OK', exit: 0, fail: '', uncertain: false, foreign: false, running: false,
    hook: undefined as undefined | ((args: string[]) => Promise<void>) };
  let container: any;
  const docker: DockerCommand = async (args, options) => {
    calls.push({ args, ...options });
    assert.ok(options.timeout > 0 && options.timeout <= 10000);
    await s.hook?.(args);
    if (s.fail === `${args[0]} ${args[1]}`) throw Error('secret daemon error');
    if (args[0] === 'image') return JSON.stringify([{ Id: s.imageId, Config: { User: s.user } }]);
    switch (args[1]) {
      case 'create':
        container = { Name: `/${args[args.indexOf('--name') + 1]}`, Id: ID, Image: s.imageId,
          Config: { Labels: { 'com.factory.preflight': args[args.indexOf('--label') + 1].split('=')[1] } },
          State: { Status: s.running ? 'running' : 'exited', ExitCode: s.exit, OOMKilled: false, Error: '' } };
        return ID;
      case 'start': return ID;
      case 'inspect': return JSON.stringify([{ ...container, ...(s.foreign ? { Image: B } : {}) }]);
      case 'logs': return s.message;
      case 'ls': return container ? ID : '';
      case 'rm': assert.equal(args.at(-1), ID, 'remove only the inspected exact ID'); if (!s.uncertain) container = undefined; return ID;
    }
    throw Error('unexpected fake Docker call');
  };
  const input = { image: 'mutable:tag', uid: 1000, gid: 1000, stateDir, docker };
  const check = (patch: Partial<Parameters<typeof checkImageCapabilities>[0]> = {}) => checkImageCapabilities({ ...input, ...patch });
  const files = () => existsSync(join(stateDir, 'capabilities')) ? readdirSync(join(stateDir, 'capabilities')) : [];
  return { s, calls, stateDir, check, files };
}
test('owned image probe is non-root, offline, mount/env-free, immutable and cleaned before atomic success caching', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.check(), { ok: true, imageId: A, cached: false });
  const create = f.calls.find(c => c.args[1] === 'create')!.args;
  assert.match(create[create.indexOf('--name') + 1], /^factory-preflight-[a-f0-9-]{36}$/);
  assert.equal(create[create.indexOf('--user') + 1], '1000:1000');
  assert.equal(create[create.indexOf('--network') + 1], 'none');
  assert.equal(create[create.indexOf('--pull') + 1], 'never');
  assert.equal(create[create.indexOf('--entrypoint') + 1], 'node');
  assert.ok(create.includes(A)); assert.ok(!create.includes('mutable:tag'));
  assert.ok(!create.some(a => /^(?:-v|--mount|--volume|--env|--env-file)$/.test(a)));
  assert.ok(create.indexOf('-e') > create.indexOf(A), 'Node -e is an image argument, never Docker environment injection');
  assert.ok(!create.some(a => /workspace|docker.sock|OPENAI|OAUTH|credentials/.test(a)));
  const saved = JSON.parse(readFileSync(join(f.stateDir, 'capabilities', f.files()[0]), 'utf8'));
  assert.deepEqual({ ...saved, completedAt: undefined }, { imageId: A, uid: 1000, gid: 1000, probeHash: PROBE_HASH, completedAt: undefined });
  assert.ok(Number.isFinite(Date.parse(saved.completedAt)));
  const count = f.calls.filter(c => c.args[1] === 'create').length;
  assert.deepEqual(await f.check(), { ok: true, imageId: A, cached: true });
  assert.equal(f.calls.filter(c => c.args[1] === 'create').length, count);
  assert.equal(f.calls.at(-1)!.args[0], 'image', 'even cached calls re-resolve the tag');
});
test('cache is invalidated by immutable identity, UID/GID or source hash, never mutable tag alone', async t => {
  const f = fixture(t);
  await f.check();
  f.s.imageId = B; await f.check();
  f.s.user = '1001'; await f.check({ uid: 1001 });
  await f.check({ uid: 1001, gid: 1002 });
  await f.check({ uid: 1001, gid: 1002, probeHash: 'changed-source' });
  assert.equal(f.calls.filter(c => c.args[1] === 'create').length, 5);
  assert.equal(f.files().filter(n => n.endsWith('.json')).length, 5);
});
test('malformed or mismatched cache records re-probe; failure is not sticky', async t => {
  const f = fixture(t); await f.check();
  const file = join(f.stateDir, 'capabilities', f.files()[0]);
  for (const text of ['{', '{}', JSON.stringify({ imageId: B, uid: 1000, gid: 1000, probeHash: PROBE_HASH, completedAt: 'yesterday' })]) {
    writeFileSync(file, text); assert.equal((await f.check()).ok, true);
  }
  rmSync(file); f.s.exit = 1; f.s.message = 'browser preflight failed: Chromium launch';
  const failed = await f.check(); assert.equal(failed.ok, false); assert.deepEqual(f.files(), []);
  f.s.exit = 0; f.s.message = 'browser preflight OK'; assert.equal((await f.check()).ok, true);
});
for (const failure of ['CLI missing', 'global module resolution', 'Chromium launch', 'DOM marker', 'cleanup', 'timeout']) test(`probe ${failure} refuses without permanent cache`, async t => {
  const f = fixture(t); f.s.exit = 1; f.s.message = `browser preflight failed: ${failure}\nsecret`;
  const r = await f.check(); assert.equal(r.ok, false); assert.doesNotMatch(JSON.stringify(r), /secret/);
  assert.deepEqual(f.files(), []); assert.ok(f.calls.some(c => c.args[1] === 'rm'));
});
for (const fail of ['image inspect', 'container create', 'container start', 'container logs']) test(`uncertain ${fail} never succeeds`, async t => {
  const f = fixture(t); f.s.fail = fail;
  assert.equal((await f.check()).ok, false);
  assert.ok(!f.files().some(n => n.endsWith('.json')));
});
test('host probe deadline refuses a still-running container and confirms cleanup', async t => {
  const f = fixture(t); let now = 0;
  t.mock.method(Date, 'now', () => now);
  f.s.running = true;
  f.s.hook = async args => { if (args[1] === 'inspect' && args[0] === 'container') now += 30001; };
  assert.equal((await f.check()).ok, false);
  assert.ok(f.calls.some(c => c.args[1] === 'rm'));
  assert.deepEqual(f.files(), []);
});
test('wrong or root UID/GID and malformed image identity refuse before container creation', async t => {
  const f = fixture(t);
  f.s.user = 'root'; assert.equal((await f.check()).ok, false);
  f.s.user = '1000'; assert.equal((await f.check({ uid: 0 })).ok, false);
  assert.equal((await f.check({ gid: 0 })).ok, false);
  f.s.imageId = 'mutable'; assert.equal((await f.check()).ok, false);
  assert.ok(!f.calls.some(c => c.args[1] === 'create'));
});
test('uncertain cleanup retains ownership and publishes nothing, even after probe success', async t => {
  const f = fixture(t); f.s.uncertain = true;
  const r = await f.check(); assert.equal(r.ok, false); if (!r.ok) assert.match(r.reason, /cleanup is unconfirmed/);
  assert.equal(f.files().filter(n => n.endsWith('.lock')).length, 1);
  assert.ok(!f.files().some(n => n.endsWith('.json')));
  const calls = f.calls.length; assert.equal((await f.check()).ok, false);
  assert.equal(f.calls.length, calls + 1, 'live/unknown owner cannot be stolen');
});
test('foreign ownership is never removed; a dead owner is reconciled by exact identity, not age', async t => {
  const f = fixture(t); f.s.foreign = true;
  assert.equal((await f.check()).ok, false); assert.ok(!f.calls.some(c => c.args[1] === 'rm'));
  const lockDir = join(f.stateDir, 'capabilities', f.files()[0]), ownerFile = join(lockDir, 'owner.json');
  const old = JSON.parse(readFileSync(ownerFile, 'utf8')); old.owner = { pid: 2 ** 22 + 1234 }; writeFileSync(ownerFile, JSON.stringify(old));
  assert.equal((await f.check()).ok, false, 'uncertain dead cleanup stays held and may be retried');
  assert.ok(!f.files().some(n => n.endsWith('.json')));
  f.s.foreign = false;
  assert.equal((await f.check()).ok, false, 'dead cleanup is a retryable hold, never cached success');
  assert.deepEqual(f.files(), []);
  assert.equal((await f.check()).ok, true);
});
test('concurrent same-key probes hold instead of sharing container ownership', async t => {
  const f = fixture(t); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }); const ready = new Promise<void>(r => { entered = r; });
  f.s.hook = async a => { if (a[1] === 'create') { entered(); await gate; } };
  const first = f.check(); await ready;
  assert.equal((await f.check()).ok, false);
  release(); assert.equal((await first).ok, true);
  assert.equal(f.calls.filter(c => c.args[1] === 'create').length, 1);
});
test('cancellation before and during start never caches and still confirms exact cleanup', async t => {
  const f = fixture(t), cancel = new AbortController(); cancel.abort();
  assert.equal((await f.check({ signal: cancel.signal })).ok, false); assert.deepEqual(f.calls, []);
  const active = new AbortController();
  f.s.hook = async a => { if (a[1] === 'start') active.abort(); };
  assert.equal((await f.check({ signal: active.signal })).ok, false);
  assert.ok(f.calls.some(c => c.args[1] === 'rm' && !c.signal));
  assert.deepEqual(f.files(), []);
});
