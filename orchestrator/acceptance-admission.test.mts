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
import { claimRun } from '../board/board.mts';
import { readAdmission } from '../board/admission.mts';

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

test('explicit refresh missing preparation preserves the old card without analyst spend', t => {
  const f = fixture(t, 'github', false);
  const prior = f.record(7, 'stopped');
  f.pass(['--refresh-only', '--ticket', '7']);
  assert.equal(existsSync(join(f.fake, 'analysis.jsonl')), false, 'no assessment analyst invocation');
  assert.match(f.assessment().error!, /Acceptance static hold: missing-preparation/);
  assert.equal(readFileSync(join(f.dir, 'owner_repo--7.json'), 'utf8'), prior);
});

test('direct run missing preparation holds before adoption, model auth or implementation record', t => {
  const f = fixture(t, 'github', false);
  f.save();
  writeFileSync(join(f.home, 'bin/docker'), `#!${process.execPath}\nimport {capabilityDocker} from ${JSON.stringify(new URL('./fixtures/capability-docker.mjs', import.meta.url).pathname)}; const out=capabilityDocker(process.argv.slice(2),process.env.FAKE_STATE); if(out===undefined) process.exit(90); console.log(out);\n`, {mode:0o755});
  const result = spawnSync(f.node, [join(f.runtime.directory, 'main.mts'), '--issue', '7', '--base', 'main'], {cwd:f.root, env:f.env, encoding:'utf8', timeout:20_000});
  assert.match(result.stderr, /Acceptance static hold: missing-preparation/, result.stdout + result.stderr);
  assert.equal(existsSync(join(f.dir, 'owner_repo--7.json')), false, 'no manufactured implementation record');
  assert.equal(existsSync(join(f.fake, 'models.log')), false);
  assert.equal(existsSync(join(f.fake, 'analysis.jsonl')), false);
});

test('common analysis entry refuses missing preparation independently of its caller', t => {
  const f = fixture(t, 'github', false);
  f.save();
  const result = spawnSync(f.node, ['--input-type=module', '-e', `
    const t=await import(${JSON.stringify(join(f.runtime.directory,'tracker.mts'))});
    const {freezeTicketInput}=await import(${JSON.stringify(join(f.runtime.directory,'ticket-input.mts'))});
    const {analyse}=await import(${JSON.stringify(join(f.runtime.directory,'analyze.mts'))});
    analyse({project:'owner/repo',base:'main',worktree:{path:process.cwd(),sha:'a'.repeat(40)},ticket:t.ticket(7),input:freezeTicketInput(t.contextSource,7),notes:[],catalogue:[],manifests:new Map(),keepImplementerBlockers:false});
  `], {cwd:f.root,env:f.env,encoding:'utf8',timeout:20_000});
  assert.equal(existsSync(join(f.fake, 'analysis.jsonl')), false, 'common entry cannot bypass admission');
  assert.match(result.stderr, /Acceptance static hold: missing-preparation/);
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

test('direct run rechecks preparation after Git I/O before acquiring its normal claim', t => {
  const f = fixture(t, 'github', false);
  f.save();
  const file = prepareFixtureAcceptance(f.dir, inputFor(f));
  writeFileSync(join(f.home,'bin/docker'), `#!${process.execPath}\nimport {capabilityDocker} from ${JSON.stringify(new URL('./fixtures/capability-docker.mjs',import.meta.url).pathname)}; const out=capabilityDocker(process.argv.slice(2),process.env.FAKE_STATE); if(out===undefined) process.exit(90); console.log(out);\n`, {mode:0o755});
  writeFileSync(join(f.home,'bin/git'), `#!${process.execPath}\nimport {spawnSync} from 'node:child_process'; import {rmSync} from 'node:fs'; const a=process.argv.slice(2);const r=spawnSync('/usr/bin/git',a,{stdio:'inherit'}); if(a.join(' ')==='ls-remote --heads origin 7-ticket-7') rmSync(${JSON.stringify(file)}); process.exit(r.status??90);\n`, {mode:0o755});
  const result=spawnSync(f.node,[join(f.runtime.directory,'main.mts'),'--issue','7','--base','main'],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20_000});
  assert.match(result.stderr,/Acceptance static hold: missing-preparation/);
  assert.equal(existsSync(join(f.dir,'owner_repo--7.json')),false,'no claim-created implementation record');
  assert.equal(existsSync(join(f.fake,'models.log')),false);
});

for (const route of ['dispatch', 'refresh', 'recovery']) test(`${route}: revocation during actual analyst I/O discards output and retains a static hold`, t => {
  const f = fixture(t, 'github', false);
  f.data.parents[7] = 20;
  f.data.notes[20] = [{body:'Original approved parent decisions and full ordered plan',system:false}];
  f.save();
  const input = inputFor(f), file = prepareFixtureAcceptance(f.dir, input);
  const prior = route === 'dispatch' ? undefined : f.record(7, 'stopped');
  writeFileSync(join(f.home,'bin/pi'), `#!${process.execPath}\nimport {writeFileSync,readFileSync,rmSync} from 'node:fs'; writeFileSync(process.env.FAKE_STATE+'/analyst-input',readFileSync(0)); rmSync(${JSON.stringify(file)}); console.log(JSON.stringify({provides:[],requires:[],footprint:[]}));\n`, {mode:0o755});
  const result = route === 'recovery' ? prepare(f) : f.pass(route === 'refresh' ? ['--refresh-only','--ticket','7'] : []);
  assert.ok(readFileSync(join(f.fake,'analyst-input'),'utf8').includes(input.text), 'analyst gets exact original approved full child/parent rendering');
  assert.equal(existsSync(join(f.fake,'launches')),false);
  assert.equal(f.bytes(join(f.dir,'owner_repo--7.json')),prior ?? 'absent');
  assert.equal(existsSync(join(f.dir,'graph/owner_repo--7.json')),false);
  const stored = readStoredReadiness(f.dir,f.root);
  assert.ok('report' in stored, JSON.stringify(stored));
  const check = stored.report.checks.find(c=>c.id==='acceptance-static-7');
  if (route === 'recovery') {
    const { state, code } = JSON.parse(result.stdout);
    assert.deepEqual({ state, code, status: check?.status, reason: check?.reason },
      { state: 'held', code: 'acceptance-static', status: 'blocked', reason: 'Acceptance static: missing-preparation' }, result.stdout + result.stderr);
    assert.deepEqual(readAdmission(f.dir).recovery, {});
  } else assert.equal(check?.status,'blocked', result.stdout + result.stderr);
});

test('a dispatched child with missing preparation cannot adopt or rewrite a pending run or its budgets', t => {
  const f=fixture(t,'github',false); f.save();
  const claimed=claimRun({dir:f.dir,project:'owner/repo',iid:'7',pid:process.pid,cap:2,patch:{base:'main',note:'pending preserved work'}});
  assert.ok(claimed.ok);
  const file=join(f.dir,'owner_repo--7.json'), before=readFileSync(file,'utf8'), authority=readAdmission(f.dir);
  writeFileSync(join(f.home,'bin/docker'), `#!${process.execPath}\nimport {capabilityDocker} from ${JSON.stringify(new URL('./fixtures/capability-docker.mjs',import.meta.url).pathname)}; const out=capabilityDocker(process.argv.slice(2),process.env.FAKE_STATE); if(out===undefined) process.exit(90); console.log(out);\n`, {mode:0o755});
  const result=spawnSync(f.node,[join(f.runtime.directory,'main.mts'),'--issue','7','--base','main'],{cwd:f.root,env:{...f.env,FACTORY_LAUNCH_CLAIM:claimed.run.claim},encoding:'utf8',timeout:20_000});
  assert.match(result.stderr,/Acceptance static hold: missing-preparation/);
  assert.equal(readFileSync(file,'utf8'),before);
  assert.deepEqual(readAdmission(f.dir),authority);
  assert.equal(existsSync(join(f.fake,'models.log')),false);
});

test('cached explicit assessment cannot bypass revoked preparation and preserves saved run bytes', t => {
  const f=fixture(t,'github',false);
  f.save(); const input=inputFor(f), file=prepareFixtureAcceptance(f.dir,input), prior=f.record(7,'stopped');
  f.pass(['--refresh-only','--ticket','7']);
  assert.equal(f.assessment().analysisState,'current');
  const calls=readFileSync(join(f.fake,'analysis.jsonl'),'utf8');
  assert.ok(JSON.parse(calls.trim()).input.includes(input.text));
  rmSync(file);
  f.pass(['--refresh-only','--ticket','7']);
  assert.match(f.assessment().error!,/Acceptance static hold: missing-preparation/);
  assert.equal(readFileSync(join(f.fake,'analysis.jsonl'),'utf8'),calls);
  assert.equal(readFileSync(join(f.dir,'owner_repo--7.json'),'utf8'),prior);
});

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
