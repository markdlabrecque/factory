// #150: publication uses frozen proof copies, never mutable attempt files.
// Verification posting contract for canonical adapters and Factory-generated workflows.
// Real handoff and tracker code, isolated command stubs. No network, credentials, agents or services.
// This tests gh's invocation contract, not GitHub rendering, which was live-tested in the media research.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAssets } from '../cli/src/scaffold.mts';

const source = dirname(fileURLToPath(import.meta.url));
for (const generated of [false, true]) for (const kind of ['github', 'gitlab']) {
  for (const origin of ['implemented', 'repaired']) for (const verdict of ['PASS', 'FAIL', 'INCONCLUSIVE']) {
    test(`${generated ? 'generated' : 'canonical'} ${kind} ${origin} ${verdict}: one verification comment even with --no-push`, t => {
      const f = fixture(t, generated, kind);
      const result = run(f, { origin, verdict, noPush: true });
      assert.equal(result.out.ok, verdict === 'PASS');
      assert.equal(result.out.verdict, verdict);
      assert.deepEqual(result.delivery, []);
      assert.equal(result.calls.filter(c => c.args[0] === 'push').length, 0);
      const posts = result.calls.filter(c => kind === 'github' ? c.cmd === 'gh' : c.args[0] === 'issue');
      assert.equal(posts.length, 1);
      const post = posts[0];
      assert.match(post.body, new RegExp(`## Sandcastle verification: ${verdict}`));
      assert.match(post.body, /### Before[\s\S]*### After/);
      assert.match(post.body, /Synthetic data/);
      assert.match(post.body, /<!-- sandcastle/);
      assert.equal(post.body.includes('Repaired by Factory recovery attempt 2'), origin === 'repaired');
      assert.doesNotMatch(post.body, /undefined|sandcastle-evidence/);
      if (kind === 'github') {
        assert.deepEqual(post.args.slice(0, 7), ['issue', 'comment', '7', '-R', generated ? 'test/media' : 'islandhealth/public-site', '--body-file', '-']);
        const attachments = post.args.slice(7).filter((_, i) => i % 2 === 1);
        assert.deepEqual(attachments.map(p => basename(p)), f.media.map(p => basename(p)));
        assert.ok(attachments.every(p => p.includes('/proof-state/verification/')));
        for (const p of attachments) assert.ok(post.body.includes(`](<${p}>)`));
        assert.match(post.body, /\n\n!\[before.webm\]\([^\n]+\)\n\n/);
        assert.equal(result.calls.length, 1, 'no git, separate comment, or alternate hosting');
      } else {
        assert.equal(result.calls.filter(c => c.args[0] === 'api').length, f.media.length);
        assert.match(post.body, /!\[uploaded\]\(\/uploads\/fixture.png\)/);
      }
      for (const p of f.media) assert.equal(readFileSync(p, 'utf8'), 'synthetic media');
    });
  }
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'canonical'} GitHub PASS posts before implementation push and delivery`, t => {
    const f = fixture(t, generated, 'github');
    const result = run(f, { origin: 'implemented', verdict: 'PASS', noPush: false });
    assert.equal(result.out.ok, true);
    assert.deepEqual(result.delivery, [['rev-parse', 'refs/heads/7-fix'], ['push', 'origin', `${'b'.repeat(40)}:refs/heads/7-fix`], ['ls-remote', '--heads', 'origin', 'refs/heads/7-fix'], 'deliver']);
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.stages.map(s => s.stage), ['posting', undefined, 'pushing', 'done']);
  });
  test(`${generated ? 'generated' : 'canonical'} GitHub verdict without media still posts once`, t => {
    const f = fixture(t, generated, 'github');
    for (const p of f.media) rmSync(p);
    const result = run(f, { origin: 'implemented', verdict: 'INCONCLUSIVE', noPush: false });
    assert.equal(result.out.ok, false);
    assert.equal(result.calls.length, 1);
    assert.ok(!result.calls[0].args.includes('--attach'));
    assert.doesNotMatch(result.calls[0].body, /### Before|### After|undefined/);
    assert.deepEqual(result.delivery, []);
  });
}

for (const generated of [false, true]) for (const failure of ['unsupported', 'upload']) {
  for (const noPush of [false, true]) test(`${generated ? 'generated' : 'canonical'} GitHub ${failure} failure, noPush=${noPush}: retains evidence and stops`, t => {
    const f = fixture(t, generated, 'github');
    const result = run(f, { origin: 'repaired', verdict: 'PASS', noPush, failure });
    assert.equal(result.out.ok, false);
    assert.match(result.out.reason, /Verification posting failed[\s\S]*Evidence retained/);
    assert.deepEqual(result.delivery, []);
    assert.equal(result.calls.length, 1, 'no retries, fallback, or implementation push');
    assert.equal(result.calls[0].cmd, 'gh');
    assert.ok(!result.stages.some(s => ['pushing', 'done'].includes(s.stage)));
    for (const p of f.media) assert.equal(readFileSync(p, 'utf8'), 'synthetic media');
  });
}

type Call = { cmd: string; args: string[]; body: string };
function fixture(t: { after(fn: () => void): void }, generated: boolean, kind: string) {
  const root = mkdtempSync(join(tmpdir(), 'factory media (128)-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin);
  const evidence = join(root, 'evidence'); mkdirSync(evidence);
  const media = ['before-1.png', 'before.webm', 'after-1.png', 'after.mp4'].map(n => join(evidence, n));
  for (const p of media) writeFileSync(p, 'synthetic media');
  writeFileSync(join(evidence, 'recovery-report.md'), 'not media');
  const log = join(root, 'calls.jsonl');
  for (const cmd of ['gh', 'glab', 'git', 'gh-axi']) {
    writeFileSync(join(bin, cmd), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const body = args.includes('--body-file') ? fs.readFileSync(0, 'utf8') : (args[args.indexOf('-m') + 1] || '');
fs.appendFileSync(process.env.CALLS, JSON.stringify({cmd: ${JSON.stringify(cmd)}, args, body}) + '\\n');
if (${JSON.stringify(cmd)} === 'gh' && process.env.FAILURE) { console.error(process.env.FAILURE === 'unsupported' ? 'unknown flag: --attach' : 'attachment upload failed'); process.exit(1); }
if (${JSON.stringify(cmd)} === 'glab') {
  if (args[0] === 'api' && args.includes('--form')) console.log(JSON.stringify({ markdown: '![uploaded](/uploads/fixture.png)' }));
  else if (args[0] !== 'issue') process.exit(91);
} else if (${JSON.stringify(cmd)} !== 'gh' || args[0] !== 'issue' || args[1] !== 'comment') process.exit(92);
`, { mode: 0o755 });
  }
  let modules = source;
  if (generated) {
    for (const file of buildAssets({ profile: kind === 'github' ? 'personal' : 'client', repo: 'test/media', image: 'unused', host: 'git.example.test', projectId: 42 }, join(root, 'state'))) {
      const p = join(root, file.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, file.content);
    }
    modules = join(root, '.sandcastle');
  }
  return { root, bin, evidence, media, log, modules, generated, kind };
}
function run(f: ReturnType<typeof fixture>, o: { origin: string; verdict: string; noPush: boolean; failure?: string }) {
  // Policy 1 fixture: media is listed explicitly, with command assertions for command PASS.
  writeFileSync(join(f.evidence, 'check.txt'), 'checked');
  writeFileSync(join(f.evidence, 'verification.json'), JSON.stringify({ version: 1, verdict: o.verdict, changeKind: 'feature', evidenceKind: 'command', interactive: false,
    criteria: [{ requirement: 'Fixture', result: o.verdict.toLowerCase(), evidence: ['check.txt'] }], limitations: [],
    artifacts: [{ path: 'check.txt', kind: 'command-output', phase: 'check' }, ...f.media.filter(p => existsSync(p)).map(p => ({ path: basename(p), kind: p.endsWith('.png') ? 'image' : 'video', phase: basename(p).startsWith('before') ? 'before' : 'after' }))] }));
  writeFileSync(join(f.evidence, 'verdict.md'), `VERDICT: ${o.verdict}\nSynthetic verification summary`);
  const url = (name: string) => JSON.stringify(pathToFileURL(join(f.modules, name)).href);
  const driver = join(f.root, 'driver.mts');
  writeFileSync(driver, `
// #150: publish only synthetic media frozen by the host proof writer.
import { createProof } from ${url('verification.mts')};
import { postAndDeliver } from ${url('handoff.mts')};
import { postVerification } from ${url(f.generated ? 'tracker.mts' : `tracker.${f.kind}.mts`)};
const stages = [], delivery = [];
const identity = { project: 'test/media', ticket: '7', executionId: 'execution', branch: '7-fix', base: 'main', baseline: 'a'.repeat(40), tip: 'b'.repeat(40), requirementsHash: 'c'.repeat(64) };
const state = ${JSON.stringify(join(f.root, 'proof-state'))};
const frozen = createProof(state, ${JSON.stringify(f.evidence)}, identity, { imageId: 'sha256:'+'d'.repeat(64), nodeVersion: 'v22', code: {}, settings: {} });
const out = await postAndDeliver({ identity, state, proofId: frozen.id, recheck: () => undefined, iid: '7', project: 'test/media', branch: '7-fix', base: 'main', baseSha: identity.baseline, tip: identity.tip, title: 'Fix', evidenceHost: ${JSON.stringify(f.evidence)}, origin: {kind: ${JSON.stringify(o.origin)}, attempt: 2}, noPush: ${o.noPush}, ciWaitMinutes: 1, noCiMinutes: 1, autoMerge: false }, {
  setStage: (_iid, s) => stages.push(s), readRuns: () => [], live: () => false,
  git: a => { delivery.push(a); return identity.tip; }, gitStatus: () => { throw Error('unexpected gitStatus'); },
  tracker: { postVerification, openMrBranches: () => new Set(), deliver: async () => { delivery.push('deliver'); return {url: 'https://example.test/pr/1', merged: false}; } }
});
console.log(JSON.stringify({ out, stages, delivery }));
`);
  const child = spawnSync(process.execPath, [driver], { cwd: f.root, encoding: 'utf8', env: { PATH: f.bin, HOME: f.root, CALLS: f.log, FAILURE: o.failure ?? '' } });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1)!);
  const calls: Call[] = readFileSync(f.log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  return { ...result, calls } as { out: {ok: boolean; verdict: string; reason: string}; stages: {stage: string}[]; delivery: unknown[]; calls: Call[] };
}
