// Copied-install public controls and selected-runtime capability audit. Unsupported action journeys remain blocked,
// not replaced by injected activation. Existing worker/reviewer/recovery/proof fixtures own effect-boundary evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readinessFixture } from './ticket-readiness-fixture.mts';
import { install } from './runtime-fixture.mts';
import { Fake } from '../src/platform/fake.mts';
import { record } from '../src/manifest.mts';
import { resolveWorkflow } from '../../orchestrator/workflow.mts';
import { projectFixture } from './workflow-fixture.mts';
import { supervisorFixture, AT } from './supervisor-fixture.mts';
import { commitSupervisor, readSupervisor, supervisorFile } from '../src/supervisor-state.mts';
import { ownerOf } from '../../board/admission.mts';

test('copied public supervisor refuses activation; selected runtime and complete overrides cannot manufacture capabilities', async t => {
  const f = readinessFixture(t);
  // The shared readiness helper already published this fixture-owned runtime.
  record(f.p, { kind: 'dir', path: f.p.runtimes });
  record(f.p, { kind: 'file', path: f.p.runtimeDescriptor });
  await install(f.p, new Fake(f.p)); // Disposable copied app only; injected package and service boundaries.
  const env = { ...f.runtime.env, FACTORY_HOME: f.home, SANDCASTLE_STATE_DIR: f.p.state,
    PATH: `${f.bin}:${process.env.PATH}`, HOME: f.home };
  // Reject the managed tracker wrapper too; no live tracker/model/service fallback is permitted.
  for (const name of ['gh-axi', 'gh', 'op'])
    writeFileSync(join(f.bin, name), readFileSync(join(f.bin, 'pi')), { mode: 0o755 });
  const cli = (args: string[]) => spawnSync(process.execPath, [join(f.p.app, 'cli/bin/factory.mts'), ...args, '--project', f.root],
    { cwd: f.root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  const run = (code: string) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code],
      { cwd: f.root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  };
  writeFileSync(join(f.root, 'saved.md'), 'saved operator work\n'); f.git('add', 'saved.md');
  writeFileSync(join(f.root, 'saved.md'), 'dirty operator work\n');
  const work = () => ({ status: f.git('status', '--porcelain=v1'), refs: f.git('show-ref'),
    index: f.git('diff', '--cached'), dirty: readFileSync(join(f.root, 'saved.md'), 'utf8') });
  const original = work(), base = readFileSync(f.config, 'utf8');
  for (const family of ['openai', 'anthropic'] as const) {
    // Configured-family contracts only: no semantic model or provider-enforcement claim.
    const config = base + `\n[agent]\nfamily = "${family}"\n`;
    writeFileSync(f.config, config);
    for (const action of ['status', 'explain']) {
      const result = cli(['supervisor', action, '--json']); assert.equal(result.status, 0, result.stderr);
      const view = JSON.parse(result.stdout); assert.equal(view.mode, 'observe');
      assert.equal(view.hostDecision.actionAuthorized, false);
    }
    assert.equal(existsSync(supervisorFile(f.p.state)), false, 'public reads create no journal');
    let selected = resolveWorkflow(f.root, f.p.runtimeDescriptor);
    const contracts = run(`const {modelForRole}=await import(${JSON.stringify(join(selected.root, 'model-policy.mts'))});
      const {loadTomlConfig}=await import(${JSON.stringify(join(selected.root, 'project-config.mts'))});
      const config=loadTomlConfig(${JSON.stringify(join(f.root, '.factory'))});
      console.log(JSON.stringify({policy:config.supervisor,family:config.AGENT.family,
        diagnosis:modelForRole(config.AGENT.family,'supervisor'),review:modelForRole(config.AGENT.family,'gateReview')}));`);
    assert.equal(contracts.family, family);
    assert.deepEqual(contracts.policy, { enabled: false });
    assert.equal(contracts.diagnosis.tier, 'mid'); assert.equal(contracts.review.tier, 'large');
    assert.notEqual(contracts.diagnosis.model, contracts.review.model);
    // Exercise the actual selected transport without a host binding, exactly as default tick constructs it.
    const hints = run(`const {supervisorWakeups}=await import(${JSON.stringify(join(selected.root, 'supervisor-schedule.mts'))});
      const results=[]; const hook=supervisorWakeups(()=>undefined,r=>results.push(r));
      hook.enqueue(${JSON.stringify(f.root)},'checkpoint'); hook.handoff(new AbortController().signal); await hook.settled(); console.log(JSON.stringify(results));`);
    assert.equal(hints[0].state, 'held'); assert.match(hints[0].reason, /No trusted supervisor/);
    assert.equal(existsSync(supervisorFile(f.p.state)), false);
    const finite = `\n[supervisor]\nenabled = true\nmax_tokens = 1000\nmax_cost_usd = 1\nmax_calls = 10\n[supervisor.diagnosis]\nmax_tokens = 100\nmax_cost_usd = 0.1\nmax_calls = 2\ntimeout_seconds = 30\n[supervisor.review]\nmax_tokens = 100\nmax_cost_usd = 0.1\nmax_calls = 2\ntimeout_seconds = 30\n`;
    writeFileSync(f.config, config + finite);
    const refused = cli(['supervisor', 'mode', 'act', '--pilot', '--confirm']);
    assert.equal(refused.status, 1); assert.match(refused.stderr, /activation unavailable/i);
    assert.equal(existsSync(supervisorFile(f.p.state)), false, 'explicit opt-in cannot bypass installed refusal');
    projectFixture(f.p, f.root); selected = resolveWorkflow(f.root, f.p.runtimeDescriptor);
    assert.equal(selected.mode, 'project'); assert.equal(selected.root, join(f.root, '.factory-workflow'));
    const opaque = cli(['supervisor', 'mode', 'act', '--pilot', '--confirm']);
    assert.equal(opaque.status, 1); assert.match(opaque.stderr, /opaque project workflow/);
    rmSync(join(selected.root, 'supervisor-schedule.mts'));
    assert.throws(() => resolveWorkflow(f.root, f.p.runtimeDescriptor), /no Factory fallback/);
    rmSync(selected.root, { recursive: true });
  }
  writeFileSync(f.config, base);
  assert.deepEqual(work(), original, 'all refusal/inspection paths preserve dirty work, index and refs');

  // Seed an exact owned reservation through the real journal API, not a fictitious installed worker.
  // This tests public cross-process stop honesty, not paid launch/cancellation or act admission.
  const a = supervisorFixture(f.root), project = a.snapshot.project;
  const commit = (event: any) => commitSupervisor(f.p.state, project, readSupervisor(f.p.state, project).revision, event);
  const observed = commit({ id: 'acceptance-observe', at: AT, kind: 'observe', facts: a.facts, snapshotHash: 'a'.repeat(64), reason: 'Synthetic retained worker observation' });
  commit({ id: 'acceptance-reserve', at: AT, kind: 'reserve', reservation: { id: 'acceptance-worker', incidentId: Object.keys(observed.incidents)[0], kind: 'diagnosis',
    owner: ownerOf(process.pid), fence: 'acceptance-fence', at: AT, deadline: '2026-11-17T12:01:00.000Z', reserved: { tokens: 10, cost: 10 }, actual: null, state: 'active', reviewId: null },
    limits: { project: { tokens: 100, cost: 100 }, shared: { tokens: 100, cost: 100 }, capacity: 1, reviewCalls: 1, reviewTimeoutMs: 60000 } });
  const before = readSupervisor(f.p.state, project);
  const stopped = cli(['supervisor', 'stop']); assert.equal(stopped.status, 1); assert.match(stopped.stdout, /cancellation\/accounting is pending/);
  const after = readSupervisor(f.p.state, project); assert.equal(after.control?.mode, 'stopped');
  assert.deepEqual(after.reservations, before.reservations); assert.deepEqual(after.charged, before.charged);
  const bytes = readFileSync(supervisorFile(f.p.state), 'utf8');
  const restarted = cli(['supervisor', 'status', '--json']); assert.equal(restarted.status, 0, restarted.stderr);
  assert.equal(JSON.parse(restarted.stdout).cancellation.pendingTotal, 1);
  assert.equal(readFileSync(supervisorFile(f.p.state), 'utf8'), bytes);
  assert.deepEqual(work(), original);
  assert.equal(existsSync(join(f.fake, 'unexpected.jsonl')), false);
  assert.equal(existsSync(join(f.fake, 'image-calls.jsonl')), false);
});
