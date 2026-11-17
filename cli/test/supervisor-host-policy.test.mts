// Cheap advisory policy/grant/ordering permutations plus one private policy/journal persistence boundary. No provider work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ADVISORY_PROFILE_ID, advisoryReservation, diagnosisGrant, validateDiagnosisGrant, usdCeilingMicroUSD } from '../src/supervisor-advisory-contract.mts';
import { validateHostAdvisoryPolicy, readHostAdvisoryPolicy, hostAdvisoryPolicyIdentity, advisoryLimitHold } from '../src/supervisor-host-policy.mts';
import { emptySupervisor, incidentIdentity, transitionSupervisor, validateSupervisor, commitSupervisor, readSupervisor, authorizeAdvisorySend } from '../src/supervisor-state.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { ownerOf } from '../../board/admission.mts';
const project = { root: '/fixture/project', tracker: { kind: 'github' as const, host: 'github.com', project: 'owner/repo' } };
const h = 'a'.repeat(64), at = '2026-11-17T00:00:00.000Z', later = '2026-11-17T00:00:01.000Z';
const controller = { pid: 123, start: 'controller' }, worker = { pid: 124, start: 'worker' };
const host = { version: 1 as const, enabled: true as const, profile: ADVISORY_PROFILE_ID, capacity: 1 as const,
  cumulative: { tokens: 10_000_000, cost: 100_000_000, calls: 10 } };
const role = { maxTokens: 5_000_000, maxCostUsd: 50, maxCalls: 5, timeoutSeconds: 600 };
const policy = { enabled: true, limits: { maxTokens: 10_000_000, maxCostUsd: 100, maxCalls: 10, diagnosis: role, review: role } };
const controls = { registered: true, global: 'on' as const, projectControl: 'enabled' as const };
const facts = { scope: { kind: 'ticket' as const, ticket: 7 }, requirements: h, gate: h, runId: 'execution-1', failure: h };
const observation = { id: 'observe', at, kind: 'observe' as const, facts, snapshotHash: h, reason: 'stalled saved run' };
const incidentId = incidentIdentity(project, facts);
function fixture(owner = controller, child = worker) {
  const reservation = { id: 'invoke', incidentId, kind: 'diagnosis' as const, owner, fence: 'fence-1', at,
    deadline: '2026-11-17T00:10:00.000Z', reserved: advisoryReservation(), actual: null, state: 'active' as const, reviewId: null };
  const registration = { holdId: 'hold-1', host, project: policy, at };
  const reserve = { id: 'reserve', at, kind: 'reserve-advisory' as const, reservation, policy: registration, controls,
    limits: { project: { tokens: 10_000_000, cost: 100_000_000 }, shared: { tokens: 10_000_000, cost: 100_000_000 }, capacity: 1, reviewCalls: 5, reviewTimeoutMs: 600_000 } };
  const grant = diagnosisGrant({ version: 1, project, ticket: 7, runId: facts.runId, attemptId: null, incidentId, basis: h,
    invocationId: reservation.id, fence: reservation.fence, holdId: registration.holdId, runtime: h, dependencies: h,
    profile: ADVISORY_PROFILE_ID, policy: hostAdvisoryPolicyIdentity(host), owner: child, deadline: reservation.deadline, reserved: reservation.reserved });
  const register = { id: 'register', at: later, kind: 'register-advisory-worker' as const, reservationId: reservation.id, fence: reservation.fence, owner, grant };
  const send = { id: 'send', at: later, kind: 'authorize-advisory-send' as const, reservationId: reservation.id,
    fence: reservation.fence, worker: child, grantId: grant.id, payload: h, policy: registration, controls };
  const apply = (s: any, e: any, peers: any[] = []) => transitionSupervisor(s, e, { ownerState: () => 'alive', projects: peers });
  const reserved = apply(apply(emptySupervisor(project), observation), reserve);
  const registered = apply(reserved, register);
  return { reservation, registration, reserve, grant, register, send, apply, reserved, registered };
}
test('fixed profile ceilings use exact all-in arithmetic and project USD ceilings round down', () => {
  assert.deepEqual(advisoryReservation(), { tokens: 1_054_096, cost: 5_808_792 });
  assert.equal(usdCeilingMicroUSD(5.808792), 5_808_792);
  assert.equal(usdCeilingMicroUSD(5.8087929), 5_808_792);
  for (const bad of [0, -1, NaN, Infinity, Number.MAX_VALUE, 0.0000001]) assert.throws(() => usdCeilingMicroUSD(bad));
  const f = fixture();
  for (const change of [{ version: 2 }, { profile: h }, { reserved: { tokens: 1, cost: 1 } }, { owner: { pid: 1 } }, { extra: true }])
    assert.throws(() => validateDiagnosisGrant({ ...f.grant, ...change }));
  const changed = { ...f.grant, basis: 'b'.repeat(64) }; assert.throws(() => validateDiagnosisGrant(changed), /identity/);
  assert.throws(() => { f.grant.owner.start = 'mutated'; }, TypeError);
  assert.notEqual(f.grant.owner, worker, 'grant is detached from caller-owned nested records');
});
test('finite cumulative host, project, role and control policy cannot be silently renewed or enlarged', () => {
  const zero = { tokens: 0, cost: 0, calls: 0 };
  const base = { host, project: policy, hostUsed: zero, projectUsed: zero, roleUsed: zero, active: 0, incidentCalls: 0, ...controls, mode: 'observe' as const };
  assert.equal(advisoryLimitHold(base), undefined);
  for (const change of [{ registered: false }, { global: 'unknown' }, { projectControl: 'paused' }, { mode: 'stopped' },
    { active: 1 }, { incidentCalls: 2 }, { hostUsed: { ...zero, calls: 10 } },
    { hostUsed: { ...zero, tokens: Number.MAX_SAFE_INTEGER } }, { project: { enabled: true } },
    { host: { ...host, cumulative: { ...host.cumulative, cost: 5_808_791 } } },
    { project: { ...policy, limits: { ...policy.limits, diagnosis: { ...role, maxTokens: 1_000_000 } } } },
    { project: { ...policy, limits: { ...policy.limits, review: { ...role, maxCalls: 0 } } } }])
    assert.ok(advisoryLimitHold({ ...base, ...change } as any), JSON.stringify(change));
  assert.throws(() => validateHostAdvisoryPolicy({ ...host, enabled: false }));
  assert.throws(() => validateHostAdvisoryPolicy({ ...host, extra: true }));
  const used = { tokens: 9_000_000, cost: 90_000_000, calls: 9 };
  assert.ok(advisoryLimitHold({ ...base, hostUsed: used }));
  assert.equal(advisoryLimitHold({ ...base, host: { ...host, cumulative: { tokens: 20_000_000, cost: 200_000_000, calls: 20 } }, hostUsed: used }), undefined);
  assert.deepEqual(used, { tokens: 9_000_000, cost: 90_000_000, calls: 9 }, 'ceiling changes do not erase spent history');
});
test('reserve transition counts finished legacy review and other-project history without resetting charges', () => {
  const f = fixture();
  const history = (target = project) => {
    let s = f.apply(emptySupervisor(target), observation);
    const r = { ...f.reservation, id: 'legacy-review', incidentId: incidentIdentity(target, facts), kind: 'review',
      reserved: { tokens: 9_000_000, cost: 9_000_000 } };
    s = f.apply(s, { id: 'legacy-reserve', at, kind: 'reserve', reservation: r, limits: f.reserve.limits });
    return f.apply(s, { id: 'legacy-finish', at: later, kind: 'finish', reservationId: r.id, fence: r.fence, owner: controller,
      actual: { tokens: 1, cost: 1 } });
  };
  const prior = history();
  assert.throws(() => f.apply(prior, f.reserve), /ceiling/);
  const peer = history({ ...project, root: '/fixture/other-project' });
  const fresh = f.apply(emptySupervisor(project), observation);
  assert.throws(() => f.apply(fresh, f.reserve, [peer]), /ceiling/);
  const ambiguous = structuredClone(peer); const old = ambiguous.reservations[supervisorHash('legacy-review')];
  old.state = 'ambiguous'; old.actual = null; validateSupervisor(ambiguous, ambiguous.project);
  assert.throws(() => f.apply(fresh, f.reserve, [ambiguous]), /capacity/);
  const raisedPolicy = { ...f.registration, host: { ...host, cumulative: { ...host.cumulative, tokens: 20_000_000 } },
    project: { ...policy, limits: { ...policy.limits, maxTokens: 20_000_000 } } };
  const raised = f.apply(prior, { ...f.reserve, policy: raisedPolicy, limits: { ...f.reserve.limits,
    project: { ...f.reserve.limits.project, tokens: 20_000_000 }, shared: { ...f.reserve.limits.shared, tokens: 20_000_000 } } });
  assert.deepEqual(raised.charged.review, prior.charged.review);
  assert.deepEqual(raised.reservations[supervisorHash('legacy-review')], prior.reservations[supervisorHash('legacy-review')]);
  assert.deepEqual(raised.charged.diagnosis, advisoryReservation());
});
test('same-lock ordering: stop first forbids authorization; send first stays spent after stop', () => {
  const f = fixture(), stop = { id: 'stop', at: later, kind: 'control', mode: 'stopped', actor: 'operator', pilot: false };
  const stopped = f.apply(f.registered, stop);
  assert.throws(() => f.apply(stopped, f.send), /stop/);
  const authorized = f.apply(f.registered, f.send), key = supervisorHash('invoke');
  assert.equal(authorized.advisory!.sends[key].payload, h);
  assert.equal(f.apply(authorized, f.send), authorized, 'event replay is observational only');
  assert.throws(() => f.apply(authorized, { ...f.send, id: 'another-send' }), /consumed/);
  const lateStop = f.apply(authorized, stop);
  assert.deepEqual(lateStop.advisory!.sends, authorized.advisory!.sends, 'stop does not magically unsend an owned request');
  assert.deepEqual(lateStop.charged.diagnosis, advisoryReservation());
  assert.throws(() => f.apply(authorized, { kind: 'finish', id: 'unproven-finish', at: later, reservationId: 'invoke',
    fence: 'fence-1', owner: controller, actual: { tokens: 35, cost: 1 } }), /raw provider/);
});
test('wrong, duplicate, absent, legacy and stale workers or policies never authorize', () => {
  const f = fixture();
  assert.throws(() => f.apply(f.reserved, f.send), /unregistered/);
  assert.throws(() => f.apply(f.registered, { ...f.register, id: 'duplicate' }), /duplicate/);
  for (const change of [{ fence: 'wrong' }, { grantId: h }, { worker: { pid: 999, start: 'other' } }, { payload: 'bad' },
    { at: f.reservation.deadline }, { policy: { ...f.registration, host: { ...host, cumulative: { ...host.cumulative, tokens: 20_000_000 } } } },
    { controls: { ...controls, registered: false } }, { controls: { ...controls, projectControl: 'unknown' } }])
    assert.throws(() => f.apply(f.registered, { ...f.send, ...change }));
  const legacy = structuredClone(f.reserved); delete legacy.advisory; validateSupervisor(legacy, project);
  assert.throws(() => f.apply(legacy, f.register), /legacy/);
  const corrupt = structuredClone(f.registered); corrupt.advisory!.workers[supervisorHash('invoke')].grant.owner.start = 'changed';
  assert.throws(() => validateSupervisor(corrupt, project));
  const exhausted = structuredClone(f.reserved); exhausted.reservations[supervisorHash('invoke')].state = 'ambiguous';
  assert.throws(() => f.apply(exhausted, { ...f.reserve, id: 'reserve-again', reservation: { ...f.reservation, id: 'new' } }), /capacity|unsettled/);
});
test('private host policy and one-use durable journal receipt survive reopen without a second permission', async t => {
  const home = mkdtempSync(join(tmpdir(), 'factory-advisory-policy-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const config = join(home, 'config'), file = join(config, 'supervisor.json'), mount = join(home, 'agent-mount');
  mkdirSync(config, { mode: 0o700 }); mkdirSync(mount, { mode: 0o700 });
  writeFileSync(file, JSON.stringify(host), { mode: 0o600 });
  const original = readFileSync(file, 'utf8'); assert.equal(readHostAdvisoryPolicy(config, [mount]).identity, hostAdvisoryPolicyIdentity(host));
  chmodSync(file, 0o644); assert.throws(() => readHostAdvisoryPolicy(config, [mount]), /private/); chmodSync(file, 0o600);
  assert.throws(() => readHostAdvisoryPolicy(config, [home]), /mount/);
  rmSync(file); symlinkSync(join(home, 'missing'), file); assert.throws(() => readHostAdvisoryPolicy(config, [mount])); rmSync(file);
  writeFileSync(file, '{bad', { mode: 0o600 }); assert.throws(() => readHostAdvisoryPolicy(config, [mount]));
  assert.equal(readFileSync(file, 'utf8'), '{bad', 'corrupt policy never repaired'); writeFileSync(file, original);
  const child = spawn(process.execPath, ['-e', 'process.on("message",()=>process.exit(0));process.send("ready");'],
    { stdio: ['ignore','ignore','ignore','ipc'], env: { PATH: '/usr/bin:/bin', HOME: home } });
  const closed = once(child, 'close');
  try {
    await once(child, 'message');
    const f = fixture(ownerOf(process.pid), ownerOf(child.pid!)), dir = join(home, 'state');
    let s = commitSupervisor(dir, project, 0, observation);
    s = commitSupervisor(dir, project, s.revision, f.reserve); s = commitSupervisor(dir, project, s.revision, f.register);
    const { id, kind, ...input } = f.send;
    const permission = authorizeAdvisorySend(dir, project, s.revision, input);
    s = readSupervisor(dir, project);
    assert.deepEqual(s.advisory!.sends[supervisorHash('invoke')], permission);
    assert.throws(() => authorizeAdvisorySend(dir, project, s.revision, input), /consumed/);
    const bytes = readFileSync(join(dir, 'supervisor/state.json'), 'utf8');
    assert.equal(readSupervisor(dir, project).revision, s.revision); assert.equal(readFileSync(join(dir, 'supervisor/state.json'), 'utf8'), bytes);
  } finally { child.send('exit'); await closed; }
});
