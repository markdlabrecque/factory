// Exercise the production browser probe with fixture-owned runtimes. Poll for delivered SIGKILL before asserting exit,
// and clean up every recorded descendant even if an assertion fails on a constrained CI runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { browserPreflight, runVerifier } from './handoff.mts';

function fixture(mode: string) {
  const dir = mkdtempSync(join(tmpdir(), 'browser-probe-'));
  const bin = join(dir, 'bin'), modules = join(dir, 'modules');
  mkdirSync(bin); mkdirSync(modules);
  symlinkSync(process.execPath, join(bin, 'node'));
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\necho '${modules}'\n`, {mode:0o755});
  if (mode !== 'cli') writeFileSync(join(bin, 'playwright'), '#!/bin/sh\nexit 0\n', {mode:0o755});
  if (mode !== 'module') {
    mkdirSync(join(modules, 'playwright'));
    const hanging = mode === 'hang' ? `
      process.on('SIGTERM', () => {});
      require('fs').writeFileSync(${JSON.stringify(join(dir, 'probe.pid'))}, String(process.pid));
      require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(`process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(join(dir, 'child.pid'))}, String(process.pid)); setInterval(() => {}, 1000);`)}], {stdio:'inherit'});
      await new Promise(() => {});` : '';
    writeFileSync(join(modules, 'playwright', 'index.js'), `exports.chromium={launch:async()=>{${mode === 'launch' ? 'throw Error("secret")' : ''};return {newPage:async()=>{${hanging};return {setContent:async()=>{},locator:()=>({textContent:async()=>${JSON.stringify(mode === 'dom' ? 'wrong' : 'ready')}})}},close:async()=>{${mode === 'cleanup' ? 'throw Error("secret cleanup")' : ''};require('fs').writeFileSync(${JSON.stringify(join(dir, 'closed'))},'yes')}}}};`);
  }
  const exec = (cmd: string) => new Promise<{stdout:string; stderr:string; exitCode:number}>(resolve => {
    execFile('/bin/sh', ['-c', cmd], {env:{ PATH: `${bin}:/usr/bin:/bin` }}, (err, stdout, stderr) => resolve({stdout, stderr, exitCode: err ? 1 : 0}));
  });
  return {dir, exec};
}
for (const mode of ['ok', 'cli', 'module', 'launch', 'dom', 'cleanup']) test(`probe ${mode}`, async () => {
  const f = fixture(mode);
  const result = await browserPreflight(f, f.dir);
  if (mode === 'ok') assert.equal(result, undefined); else assert.match(result!, /Playwright\/Chromium provisioning failure/);
  const log = readFileSync(join(f.dir, 'browser-preflight.log'), 'utf8');
  assert.ok(log.length < 256); assert.doesNotMatch(log, /secret/);
  if (mode === 'ok' || mode === 'dom') assert.ok(existsSync(join(f.dir, 'closed')));
  if (mode === 'cleanup') {
    assert.match(result!, /failed: cleanup/);
    assert.match(log, /failed: cleanup/);
    assert.doesNotMatch(log, /preflight OK/);
  }
});
test('timeout awaits forced termination of a SIGTERM-ignoring probe and descendant', {timeout:10000}, async t => {
  const f = fixture('hang');
  t.after(() => {
    for (const name of ['probe.pid', 'child.pid']) {
      try { process.kill(Number(readFileSync(join(f.dir, name), 'utf8')), 'SIGKILL'); } catch { /* not started or gone */ }
    }
  });
  const start = Date.now();
  const result = await browserPreflight(f, f.dir, 2000);
  assert.match(result!, /provisioning failure/);
  assert.ok(Date.now() - start < 5000, 'exec must settle within the forced-kill deadline');
  for (const name of ['probe.pid', 'child.pid']) {
    const pid = Number(readFileSync(join(f.dir, name), 'utf8'));
    // Orphaned zombies may remain until container init reaps them; they cannot execute.
    const live = () => {
      try { return !/^.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return false; }
    };
    // The timeout process can exit before the kernel schedules every SIGKILL recipient, especially on two CPUs.
    const deadline = Date.now() + 1000;
    while (live() && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(live(), false, `${name} must not survive preflight refusal`);
  }
});
test('timeout, rejection and log failure refuse verification', async () => {
  const f = fixture('ok');
  assert.match((await browserPreflight({exec: async () => { throw Error('secret'); }}, f.dir))!, /provisioning failure/);
  assert.match((await browserPreflight(f, join(f.dir, 'missing')))!, /evidence could not be recorded/);
});
test('failure clears stale verdict and delivery before refusing without running verifier', async () => {
  const f = fixture('cli'); writeFileSync(join(f.dir, 'verdict.md'), 'PASS');
  const state: Record<string, unknown> = {verdict:'PASS', mr:'old', mergedAt:'old'};
  let ran = false;
  const refusal = await runVerifier({...f, run: async () => {ran = true; return {commits:[]};}}, {setStage: (_id, patch) => Object.assign(state, patch)}, {iid:'1', evidenceHost:f.dir, agent:{}, promptArgs:{}, tip:'unchanged'});
  assert.match(refusal!, /provisioning failure/); assert.equal(ran, false);
  assert.equal(existsSync(join(f.dir, 'verdict.md')), false);
  assert.equal(state.verdict, undefined); assert.equal(state.mr, undefined); assert.equal(state.mergedAt, undefined);
});
