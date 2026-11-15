// Fixture-only atomic readiness publication, passive reads and cross-process generation fencing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { beginReadiness, publishReadiness, readReadiness } from './readiness.mts';
import { collectReadiness, projectKey, MAX_REPORT_BYTES, validReport } from '../orchestrator/readiness.mts';
import { RUNTIME_ASSETS } from '../cli/src/runtime-assets.mts';
function fixture(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'factory-readiness-store-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project'), state = join(root, 'state'); fs.mkdirSync(project); fs.mkdirSync(state);
  const identity = { projectRoot: project, runtimeIdentity: 'runtime-a', configIdentity: 'config-a', contextFingerprint: 'context-a' };
  const owner = { invocationId: 'invocation', ownerId: 'owner' };
  const observe = (token: ReturnType<typeof beginReadiness>) => collectReadiness({ identity, owner: token.owner, paths: [
    { id: 'checkout', path: project, trustedRoot: project, role: 'checkout', scope: 'project', access: 'read-directory' },
  ] }, 'passive');
  return { root, project, state, identity, owner, observe, file: join(state, 'readiness', `${projectKey(project)}.json`) };
}
test('passive missing reader creates nothing; publication is atomic, current, stale or pending', t => {
  const f = fixture(t);
  assert.equal(readReadiness(f.state, f.identity).state, 'missing'); assert.deepEqual(fs.readdirSync(f.state), []);
  const token = beginReadiness(f.state, f.identity, f.owner);
  assert.equal(readReadiness(f.state, f.identity).state, 'pending');
  const report = f.observe(token); assert.equal(publishReadiness(f.state, token, report), true);
  const bytes = fs.readFileSync(f.file), mtime = fs.statSync(f.file).mtimeMs;
  assert.equal(readReadiness(f.state, f.identity, Date.parse(report.observedAt)).state, 'current');
  assert.equal(readReadiness(f.state, f.identity, Date.parse(report.observedAt) + 60_001).state, 'stale');
  assert.equal(readReadiness(f.state, f.identity, Date.parse(report.observedAt) - 1).state, 'stale');
  for (const key of ['runtimeIdentity', 'configIdentity', 'contextFingerprint']) assert.equal(readReadiness(f.state, { ...f.identity, [key]: 'changed' }).state, 'stale');
  assert.deepEqual(fs.readFileSync(f.file), bytes); assert.equal(fs.statSync(f.file).mtimeMs, mtime);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
});
test('newer process observation fences old publishers and diagnostics stay bounded', t => {
  const f = fixture(t), old = beginReadiness(f.state, f.identity, f.owner), oldReport = f.observe(old);
  const store = new URL('./readiness.mts', import.meta.url).href;
  const newer = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { beginReadiness } from ${JSON.stringify(store)};
    console.log(JSON.stringify(beginReadiness(${JSON.stringify(f.state)}, ${JSON.stringify(f.identity)}, ${JSON.stringify(f.owner)})));
  `], { encoding: 'utf8' }));
  assert.equal(publishReadiness(f.state, old, oldReport), false);
  assert.equal(readReadiness(f.state, f.identity).state, 'pending');
  assert.equal(publishReadiness(f.state, newer, f.observe(newer)), true);
  for (let i = 0; i < 10; i++) { const token = beginReadiness(f.state, f.identity, f.owner); publishReadiness(f.state, token, f.observe(token)); }
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).diagnostics.length, 3);
  assert.deepEqual(fs.readdirSync(join(f.state, 'readiness')), [f.file.split('/').at(-1)]);
});
test('identity replacement fences a healthy previous runtime; wrong owner and malformed schema are refused', t => {
  const f = fixture(t), old = beginReadiness(f.state, f.identity, f.owner), report = f.observe(old);
  publishReadiness(f.state, old, report);
  beginReadiness(f.state, { ...f.identity, runtimeIdentity: 'runtime-b' }, f.owner);
  assert.equal(publishReadiness(f.state, old, report), false);
  assert.throws(() => publishReadiness(f.state, old, { ...report, owner: { ...report.owner, ownerId: 'another' } }), { code: 'EINVAL' });
  assert.throws(() => publishReadiness(f.state, old, { ...report, status: 'blocked' }), { code: 'EINVAL' });
});
test('malformed, oversized, symlinked reports and store paths never produce healthy output', t => {
  const f = fixture(t); beginReadiness(f.state, f.identity, f.owner);
  for (const bytes of ['{', '{}', 'x'.repeat(MAX_REPORT_BYTES + 1)]) { fs.writeFileSync(f.file, bytes); assert.equal(readReadiness(f.state, f.identity).state, 'invalid'); }
  fs.unlinkSync(f.file); fs.symlinkSync(join(f.project, 'secret'), f.file);
  assert.equal(readReadiness(f.state, f.identity).state, 'invalid');
  fs.unlinkSync(f.file); fs.rmdirSync(join(f.state, 'readiness')); fs.symlinkSync(f.project, join(f.state, 'readiness'));
  assert.equal(readReadiness(f.state, f.identity).state, 'invalid');
  assert.throws(() => beginReadiness(f.state, f.identity, f.owner)); assert.deepEqual(fs.readdirSync(f.project), []);
});
test('report write errors are direct errors, not a claimed saved success; locks fail closed', t => {
  const f = fixture(t), token = beginReadiness(f.state, f.identity, f.owner), report = f.observe(token);
  fs.unlinkSync(f.file); fs.mkdirSync(f.file);
  assert.throws(() => publishReadiness(f.state, token, report));
  assert.equal(readReadiness(f.state, f.identity).state, 'invalid'); fs.rmdirSync(f.file);
  // A competing lock is a portable failure even when the test runner is root.
  const next = beginReadiness(f.state, f.identity, f.owner); fs.writeFileSync(`${f.file}.lock`, 'fixture competing writer');
  assert.throws(() => publishReadiness(f.state, next, f.observe(next)), { code: 'EEXIST' });
  assert.equal(readReadiness(f.state, f.identity).state, 'pending');
});
test('late atomic report rename failure propagates its actual errno and leaves no healthy saved report', t => {
  const f = fixture(t), token = beginReadiness(f.state, f.identity, f.owner), report = f.observe(token);
  const store = new URL('./readiness.mts', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { publishReadiness, readReadiness } from ${JSON.stringify(store)};
    fs.renameSync = () => { throw Object.assign(new Error('fixture rename failure'), { code: 'ENOSPC' }); };
    syncBuiltinESMExports();
    try { publishReadiness(${JSON.stringify(f.state)}, ${JSON.stringify(token)}, ${JSON.stringify(report)}); process.exit(99); }
    catch (error) { console.log(JSON.stringify({ code: error.code, message: error.message, read: readReadiness(${JSON.stringify(f.state)}, ${JSON.stringify(f.identity)}) })); }
  `], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.code, 'ENOSPC'); assert.equal(result.message, 'fixture rename failure'); assert.equal(result.read.state, 'pending');
  assert.deepEqual(fs.readdirSync(join(f.state, 'readiness')), [f.file.split('/').at(-1)]);
});
test('store directory replacement is rejected before atomic publication, without following its link', t => {
  const f = fixture(t), token = beginReadiness(f.state, f.identity, f.owner), report = f.observe(token);
  const store = new URL('./readiness.mts', import.meta.url).href, dir = join(f.state, 'readiness');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { publishReadiness } from ${JSON.stringify(store)};
    const original = fs.openSync;
    fs.openSync = (...args) => {
      const fd = original(...args);
      if (String(args[0]).endsWith('.tmp')) { fs.renameSync(${JSON.stringify(dir)}, ${JSON.stringify(`${dir}.old`)}); fs.symlinkSync(${JSON.stringify(f.project)}, ${JSON.stringify(dir)}); }
      return fd;
    };
    syncBuiltinESMExports();
    try { publishReadiness(${JSON.stringify(f.state)}, ${JSON.stringify(token)}, ${JSON.stringify(report)}); process.exit(99); }
    catch (error) { console.log(error.code); }
  `], { encoding: 'utf8' });
  assert.equal(output.trim(), 'ESTALE'); assert.deepEqual(fs.readdirSync(f.project), []);
  assert.equal(readReadiness(f.state, f.identity).state, 'invalid');
  assert.deepEqual(fs.readdirSync(`${dir}.old`), [f.file.split('/').at(-1)]);
});
test('post-rename directory fsync failure withdraws the owned healthy report', t => {
  const f = fixture(t), token = beginReadiness(f.state, f.identity, f.owner), report = f.observe(token);
  const store = new URL('./readiness.mts', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { publishReadiness, readReadiness } from ${JSON.stringify(store)};
    const original = fs.fsyncSync;
    fs.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('fixture directory fsync'), { code: 'EIO' }); original(fd); };
    syncBuiltinESMExports();
    try { publishReadiness(${JSON.stringify(f.state)}, ${JSON.stringify(token)}, ${JSON.stringify(report)}); process.exit(99); }
    catch (error) { console.log(JSON.stringify({ code: error.code, read: readReadiness(${JSON.stringify(f.state)}, ${JSON.stringify(f.identity)}) })); }
  `], { encoding: 'utf8' });
  const result = JSON.parse(output); assert.equal(result.code, 'EIO'); assert.equal(result.read.state, 'missing');
  assert.deepEqual(fs.readdirSync(join(f.state, 'readiness')), []);
});
test('unknown payload fields and inconsistent checks cannot be persisted as a healthy report', t => {
  const f = fixture(t), token = beginReadiness(f.state, f.identity, f.owner), report = f.observe(token);
  assert.equal(validReport({ ...report, fileBody: 'not allowed' }), false);
  assert.equal(validReport({ ...report, checks: [{ ...report.checks[0], commandOutput: 'not allowed' }] }), false);
  assert.equal(validReport({ ...report, checks: [{ ...report.checks[0], capacity: null }] }), false);
  assert.equal(validReport({ ...report, checks: [{ ...report.checks[0], status: 'blocked' }] }), false);
});
test('the authoritative flat runtime inventory supports probe workers and the distinctly named store', t => {
  const f = fixture(t), runtime = join(f.root, 'flat-runtime'); fs.mkdirSync(runtime);
  for (const asset of RUNTIME_ASSETS.filter(a => a.source.includes('/readiness'))) {
    fs.copyFileSync(new URL(`../${asset.source}`, import.meta.url), join(runtime, asset.destination));
  }
  assert.deepEqual(fs.readdirSync(runtime).sort(), ['readiness-schema.mts', 'readiness-store.mts', 'readiness.mts']);
  const script = `
    import { probeFilesystem } from ${JSON.stringify(new URL(`file://${join(runtime, 'readiness.mts')}`).href)};
    import { beginReadiness, publishReadiness, readReadiness } from ${JSON.stringify(new URL(`file://${join(runtime, 'readiness-store.mts')}`).href)};
    const identity = ${JSON.stringify(f.identity)};
    const token = beginReadiness(${JSON.stringify(f.state)}, identity, ${JSON.stringify(f.owner)});
    const report = await probeFilesystem({ ...token, paths: [{ id: 'state', role: 'state', scope: 'project', path: ${JSON.stringify(f.state)}, trustedRoot: ${JSON.stringify(f.state)}, access: 'write-directory' }] });
    console.log(JSON.stringify({ published: publishReadiness(${JSON.stringify(f.state)}, token, report), status: report.status, read: readReadiness(${JSON.stringify(f.state)}, identity).state }));
  `;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })), { published: true, status: 'ready', read: 'current' });
});
