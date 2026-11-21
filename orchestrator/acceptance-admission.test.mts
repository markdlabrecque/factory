// Recovery preparation admission: actual selected helper, disposable Git and rejecting tracker/model stubs.
// These are static-admission wiring tests, not baseline-runner or installed-release acceptance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './refresh-fixture.mts';
import { prepareFixtureAcceptance } from './fixtures/acceptance-preparation.mts';
import { execFileSync } from 'node:child_process';
import { readStoredReadiness } from '../board/readiness.mts';

function inputFor(f: ReturnType<typeof fixture>) {
  return JSON.parse(execFileSync(f.node, ['--input-type=module', '-e',
    `const t = await import(${JSON.stringify(join(f.runtime.directory, 'tracker.mts'))}); const g = await import(${JSON.stringify(join(f.runtime.directory, 'ticket-input.mts'))}); process.stdout.write(JSON.stringify(g.freezeTicketInput(t.contextSource, 7)));`],
    { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 20_000 }));
}
function prepare(f: ReturnType<typeof fixture>) {
  return spawnSync(f.node, [join(f.runtime.directory, 'recovery-analysis.mts'), '7', 'main'], {
    cwd: f.root, env: f.env, encoding: 'utf8', timeout: 20_000,
  });
}

test('dispatch missing preparation holds before analysis, queue record or claim', t => {
  const f = fixture(t, 'github', false);
  f.save();
  const result = f.pass();
  assert.equal(existsSync(join(f.fake, 'analysis.jsonl')), false, 'no analysis model invocation');
  assert.match(result.stdout, /Acceptance static hold: missing-preparation/);
  assert.equal(existsSync(join(f.fake, 'launches')), false);
  assert.equal(existsSync(join(f.dir, 'owner_repo--7.json')), false);
});

for (const kind of ['github', 'gitlab']) for (const family of ['openai', 'anthropic']) {
  test(`recovery preparation refuses missing acceptance before analysis (${kind}/${family})`, t => {
    const f = fixture(t, kind, false);
    const config = join(f.root, '.factory/factory.toml');
    writeFileSync(config, readFileSync(config, 'utf8').replace('family = "anthropic"', `family = "${family}"`));
    f.save();
    writeFileSync(join(f.home, 'bin/pi'), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(process.env.FAKE_STATE+'/unexpected-analysis', 'called'); process.exit(91);\n`, { mode: 0o755 });
    const result = prepare(f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(existsSync(join(f.fake, 'unexpected-analysis')), false, 'no analysis model invocation');
    assert.equal(response.state, 'held', JSON.stringify(response));
    assert.equal(response.code, 'acceptance-static', JSON.stringify(response));
    assert.equal(response.scope, 'ticket');
    assert.match(response.reason, /prepar.*review/i);
    assert.equal(existsSync(join(f.dir, 'graph/owner_repo--7.json')), false, 'no execution manifest publication');
  });
}

for (const fault of ['malformed-record', 'malformed-contract', 'unapproved', 'changed-ticket']) {
  test(`recovery preparation refuses ${fault} without analyst or implementation effects`, t => {
    const f = fixture(t, 'github', false);
    f.save();
    const input = inputFor(f), file = prepareFixtureAcceptance(f.dir, input);
    const record = JSON.parse(readFileSync(file, 'utf8'));
    if (fault === 'malformed-record') writeFileSync(file, '{');
    if (fault === 'malformed-contract' || fault === 'unapproved') {
      const original = join(f.dir, 'acceptance', record.bundle.id, fault === 'malformed-contract' ? 'contract.json' : 'approval.json');
      chmodSync(original, 0o600);
      writeFileSync(original, fault === 'malformed-contract' ? '{' : JSON.stringify({ decision: 'approve', semanticAdequacy: true }));
    }
    if (fault === 'changed-ticket') { f.data.tickets[0].description += '\nNew requirement'; f.save(); }
    const result = prepare(f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(response.code, 'acceptance-static', JSON.stringify(response));
    assert.equal(response.scope, 'ticket');
    assert.equal(existsSync(join(f.fake, 'analysis.jsonl')), false);
    assert.equal(existsSync(join(f.dir, 'graph/owner_repo--7.json')), false);
    assert.equal(existsSync(join(f.fake, 'launches')), false);
    assert.equal(existsSync(join(f.dir, 'owner_repo--7.json')), false, 'no manufactured implementation record');
  });
}

test('authentic preparation reaches the analyst; cached analysis is still revoked by current preparation', t => {
  const f = fixture(t, 'github', false);
  f.data.tickets[0].description = 'Model tier: mid\nComplete standalone requirement';
  f.save();
  const input = inputFor(f), file = prepareFixtureAcceptance(f.dir, input);
  const first = prepare(f);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(JSON.parse(first.stdout).state, 'ready', first.stdout + first.stderr);
  assert.equal(readFileSync(join(f.fake, 'analysis.jsonl'), 'utf8').trim().split('\n').length, 1);
  const manifest = readFileSync(join(f.dir, 'graph/owner_repo--7.json'), 'utf8');
  const cached = prepare(f);
  assert.equal(JSON.parse(cached.stdout).state, 'ready', cached.stdout + cached.stderr);
  assert.equal(readFileSync(join(f.fake, 'analysis.jsonl'), 'utf8').trim().split('\n').length, 1);
  rmSync(file);
  const revoked = prepare(f);
  assert.equal(JSON.parse(revoked.stdout).code, 'acceptance-static', revoked.stdout + revoked.stderr);
  assert.equal(readFileSync(join(f.fake, 'analysis.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.equal(readFileSync(join(f.dir, 'graph/owner_repo--7.json'), 'utf8'), manifest, 'saved analysis preserved');
  const stored = readStoredReadiness(f.dir, f.root);
  assert.ok('report' in stored, JSON.stringify(stored));
  const check = stored.report.checks.find(c => c.id === 'acceptance-static-7')!;
  assert.equal(check.status, 'blocked'); assert.equal(check.ticket, '7');
  assert.equal(check.reason, 'Acceptance static: missing-preparation');
  assert.equal(check.nextActor, 'operator'); assert.match(check.nextAction, /Preparer\/reviewer/);
  // Passive projection neither recreates preparation nor invokes the model or alters saved work.
  const names = readdirSync(join(f.dir, 'acceptance')).sort();
  assert.deepEqual(readStoredReadiness(f.dir, f.root), stored);
  assert.deepEqual(readdirSync(join(f.dir, 'acceptance')).sort(), names);
  assert.equal(existsSync(file), false);
  assert.equal(readFileSync(join(f.fake, 'analysis.jsonl'), 'utf8').trim().split('\n').length, 1);
});
