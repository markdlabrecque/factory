// Offline unit contracts plus one local argv/stdin boundary; no real Pi, SDK, credentials or host actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { MODEL_POLICY } from './model-policy.mts';
import { piAnalysisArgs } from './models.mts';
import {
  sourceHash, supervisorHash, proposalIdentity, reviewOutcome, validateProject, validateScope, validateSnapshot,
  validateIncident, validateGateChange, validateProposal, validateReviewInput, validateIndependentReview, validateIntent, validateHumanRequest, validateHostOutcome,
} from './supervisor-contract.mts';
import type { Snapshot, Proposal, ReviewInput, IndependentReview, HumanRequest } from './supervisor-contract.mts';

const h = 'a'.repeat(64), sha = 'b'.repeat(40), now = '2026-11-17T12:00:00.000Z';
const project = { root: '/fixture/project', tracker: { kind: 'github' as const, host: 'github.com', project: 'owner/repo' } };
function fixture() {
  const snapshot: Snapshot = {
    version: 1, project: structuredClone(project), scope: { kind: 'ticket', ticket: 232 }, observedAt: '2026-11-17T11:00:00.000Z', mode: 'act',
    material: { runId: 'run-a', base: 'develop', baseline: sha, tip: sha, runtime: h, dependencies: h, policy: h, settings: h, ticketInput: h, admissionGeneration: 'generation-a' },
    projectGuidelines: ['Equivalent offline command evidence is allowed'], factoryConstraints: ['Independent verification and exact-SHA delivery cannot be waived'],
    sources: (['child','parent','human-planning','guidelines','factory-rules','gate','failure','prior-decisions'] as const).map(role => ({ role, locator: `fixture:${role}`, status: 'complete', text: `original ${role}`, sha256: sourceHash(`original ${role}`) })),
  };
  const body: Omit<Proposal, 'id'> = { version: 1, incidentId: 'incident-a', snapshotHash: supervisorHash(snapshot), project: structuredClone(project), scope: { kind: 'ticket', ticket: 232 },
    change: { category: 'verification-command-substitution', path: 'TESTING.md', before: 'old-command', after: 'equivalent-offline-command', owner: { ticket: 232, runId: 'run-a' }, expiresAt: '2026-11-17T13:00:00.000Z' },
    rationale: 'Same project-owned behavior at cheaper tier', alternatives: ['Repair original command'], risks: ['Incorrect equivalence judgment'] };
  const input: ReviewInput = { version: 1, snapshot, proposal: { ...body, id: proposalIdentity(body) } };
  const review: IndependentReview = { version: 1, id: 'review-a', inputHash: supervisorHash(input), proposalId: input.proposal.id, invocationId: 'fresh-a', reviewer: 'reviewer-a', model: MODEL_POLICY.openai.large,
    startedAt: '2026-11-17T11:10:00.000Z', completedAt: '2026-11-17T11:20:00.000Z', disposition: 'approve', reason: 'Equivalent evidence within guidelines; no host gate removed' };
  const host = { now, currentInputHash: supervisorHash(input), invocationId: 'fresh-a', proposer: 'diagnoser-a', reviewer: 'reviewer-a', model: MODEL_POLICY.openai.large, denied: false };
  return { input, review, host };
}
function rebind(input: ReviewInput) {
  input.proposal.snapshotHash = supervisorHash(input.snapshot);
  const { id, ...body } = input.proposal; input.proposal.id = proposalIdentity(body);
}
const human = (): HumanRequest => ({ version: 1, id: 'human-a', project: structuredClone(project), scope: { kind: 'ticket', ticket: 232 }, incidentId: 'incident-a', proposalId: h,
  reason: 'review-denied', question: 'Should the original project command be repaired instead?', evidence: ['host:review-a'], nextAction: 'Inspect exact denial and preserve work; explicitly resume or abandon incident', delivery: { state: 'pending', attempts: 0 }, stop: 'required' });

test('versioned records accept bounded data and reject unknown fields/states', () => {
  const { input, review } = fixture();
  validateGateChange(input.proposal.change);
  assert.throws(() => validateGateChange({ ...input.proposal.change, unknown: true }));
  for (const path of ['../outside','/host/file','a/../b','a\\b','C:/host']) assert.throws(() => validateGateChange({ ...input.proposal.change, path }));
  const samples: [any, (x: any) => unknown][] = [
    [input.snapshot, validateSnapshot], [input.proposal, validateProposal], [input, validateReviewInput], [review, validateIndependentReview],
    [{ version: 1, id: 'incident-a', project, scope: input.snapshot.scope, snapshotHash: h, state: 'open', reason: 'stalled', diagnosisCalls: 0 }, validateIncident],
    [{ version: 1, id: 'intent-a', project, scope: input.snapshot.scope, incidentId: 'incident-a', proposalId: input.proposal.id, inputHash: h, reviewId: review.id, runId: 'run-a', fence: 'fence-a', expiresAt: now, state: 'proposed' }, validateIntent],
    [human(), validateHumanRequest], [{ version: 1, state: 'held', reason: 'missing context' }, validateHostOutcome],
    [{ version: 1, state: 'review-approved', reviewId: review.id, inputHash: h }, validateHostOutcome],
    [{ version: 1, state: 'human-required', reason: 'factory-wide', scope: { kind: 'project' } }, validateHostOutcome],
  ];
  for (const [value, validate] of samples) {
    assert.doesNotThrow(() => validate(value));
    assert.throws(() => validate({ ...value, unknown: true }), /unknown/);
    assert.throws(() => validate({ ...value, version: 2 }), /version/);
    for (const key of Object.keys(value)) { const missing = { ...value }; delete missing[key]; assert.throws(() => validate(missing), key); }
  }
  assert.throws(() => validateIncident({ ...samples[4][0], diagnosisCalls: 3 }));
  assert.throws(() => validateIntent({ ...samples[5][0], scope: { kind: 'project' } }));
  assert.throws(() => validateSnapshot({ ...input.snapshot, mode: 'automatic' }));
  assert.throws(() => validateIndependentReview({ ...review, disposition: 'PASS' }));
  assert.throws(() => validateHostOutcome({ version: 1, state: 'apply-anyway', reason: 'approved' }));
});

test('canonical tracker/project identity and ticket versus project scope do not alias', () => {
  validateProject(project); validateScope({ kind: 'project' });
  for (const root of ['/fixture/../project','/fixture//project','relative','/fixture/project/']) assert.throws(() => validateProject({ ...project, root }));
  for (const tracker of [{ ...project.tracker, host: 'https://github.com' }, { ...project.tracker, project: 'Owner/Repo' }, { ...project.tracker, project: 'owner/repo.git' }, { ...project.tracker, project: 'a/b/c' }]) assert.throws(() => validateProject({ ...project, tracker }));
  validateProject({ ...project, tracker: { kind: 'gitlab', host: 'git.example.com', project: 'group/subgroup/repo' } });
  for (const scope of [{ kind: 'project', ticket: 232 }, { kind: 'ticket', ticket: 0 }, { kind: 'all' }]) assert.throws(() => validateScope(scope));
  assert.notEqual(supervisorHash(project), supervisorHash({ ...project, root: '/other/checkout' }));
});

test('original evidence is bounded and hashes checked; incompleteness never approves', () => {
  for (const status of ['missing','truncated','not-applicable'] as const) {
    const { input, review, host } = fixture(); input.snapshot.sources[0].status = status; input.snapshot.sources[0].text = ''; input.snapshot.sources[0].sha256 = sourceHash(''); rebind(input);
    review.proposalId = input.proposal.id; review.inputHash = host.currentInputHash = supervisorHash(input);
    assert.equal(reviewOutcome(input, review, host).state, 'held');
  }
  const { input } = fixture();
  for (const mutate of [(s: Snapshot) => { s.sources[0].sha256 = h; }, (s: Snapshot) => { s.sources.push(s.sources[0]); },
    (s: Snapshot) => { s.sources[0].text = 'x'.repeat(262145); }, (s: Snapshot) => { s.projectGuidelines = []; }, (s: Snapshot) => { s.factoryConstraints = []; },
    (s: Snapshot) => { s.sources = []; }]) { const s = structuredClone(input.snapshot); mutate(s); assert.throws(() => validateSnapshot(s)); }
  const s = structuredClone(input.snapshot); s.sources = Array.from({ length: 10 }, (_, i) => ({ ...s.sources[0], locator: String(i), text: 'x'.repeat(262144), sha256: sourceHash('x'.repeat(262144)) })); assert.throws(() => validateSnapshot(s), /2 MiB/);
});

test('exact approved review admits review only, not application or delivery', () => {
  const { input, review, host } = fixture();
  assert.deepEqual(reviewOutcome(input, review, host), { version: 1, state: 'review-approved', reviewId: review.id, inputHash: supervisorHash(input) });
  assert.equal(supervisorHash({ b: 2, a: 1 }), supervisorHash({ a: 1, b: 2 }));
  for (const field of Object.keys(input.snapshot.material)) {
    const changed = structuredClone(input); (changed.snapshot.material as any)[field] = field === 'baseline' || field === 'tip' ? 'c'.repeat(40) : field.endsWith('Id') || field === 'base' || field === 'admissionGeneration' ? 'changed' : 'c'.repeat(64);
    assert.notEqual(supervisorHash(changed), host.currentInputHash, field);
    assert.equal(reviewOutcome(changed, review, host).state, 'held', field);
  }
  for (const mutate of [(i: ReviewInput) => { i.proposal.change.after = 'different command'; }, (i: ReviewInput) => { i.snapshot.sources[1].text += ' changed parent'; },
    (i: ReviewInput) => { i.proposal.scope = { kind: 'ticket', ticket: 233 }; }, (i: ReviewInput) => { i.proposal.project.root = '/other/project'; }]) {
    const changed = structuredClone(input); mutate(changed); assert.equal(reviewOutcome(changed, review, host).state, 'held');
  }
  for (const patch of [{ currentInputHash: h }, { invocationId: 'resumed' }, { reviewer: host.proposer }, { model: MODEL_POLICY.openai.mid }, { now: 'bad' }, { now: '2026-11-17T14:00:00.000Z' }]) assert.equal(reviewOutcome(input, review, { ...host, ...patch }).state, 'held');
  for (const patch of [{ disposition: 'inconclusive' as const }, { completedAt: '2026-11-18T12:00:00.000Z' }, { startedAt: '2026-11-16T12:00:00.000Z' }, { inputHash: h }]) assert.equal(reviewOutcome(input, { ...review, ...patch }, host).state, 'held');
  input.snapshot.mode = 'observe'; rebind(input); review.proposalId = input.proposal.id; review.inputHash = host.currentInputHash = supervisorHash(input);
  assert.equal(reviewOutcome(input, review, host).state, 'held');
});

test('denial latch prevents reviewer shopping and Factory-wide scope never admits a local effect', () => {
  const { input, review, host } = fixture();
  assert.deepEqual(reviewOutcome(input, { ...review, disposition: 'deny' }, host), { version: 1, state: 'human-required', reason: 'review-denied', scope: { kind: 'ticket', ticket: 232 } });
  assert.equal(reviewOutcome(input, { ...review, reviewer: 'another' }, { ...host, reviewer: 'another', denied: true }).state, 'human-required');
  for (const denied of [undefined, null, 0, 1, 'false']) assert.equal(reviewOutcome(input, review, { ...host, denied } as any).state, 'held', 'unknown durable latch must not approve');
  for (const patch of [{ proposalId: h }, { inputHash: h }, { invocationId: 'unrelated' }, { reviewer: 'unrelated' }, { model: MODEL_POLICY.openai.mid }])
    assert.equal(reviewOutcome(input, { ...review, ...patch, disposition: 'deny' }, host).state, 'held', 'unbound denial must not latch this incident');
  input.proposal.change.category = 'factory-policy'; rebind(input); review.proposalId = input.proposal.id; review.inputHash = host.currentInputHash = supervisorHash(input);
  assert.deepEqual(reviewOutcome(input, review, host), { version: 1, state: 'human-required', reason: 'factory-wide', scope: { kind: 'project' } });
  for (const category of ['unknown', 'skip-ci', 'waive-proof']) assert.throws(() => validateProposal({ ...input.proposal, change: { ...input.proposal.change, category } }));
});

test('actionable pending human request is not notification; a receipt never resumes automation', () => {
  const request = human(); validateHumanRequest(request);
  assert.throws(() => validateHumanRequest({ ...request, delivery: { state: 'notified', attempts: 1 } }));
  validateHumanRequest({ ...request, delivery: { state: 'notified', attempts: 1, channel: 'operator-approved-channel', receipt: 'ack-123', notifiedAt: now } });
  for (const patch of [{ nextAction: '' }, { question: '' }, { evidence: [] }, { stop: 'optional' }, { reason: 'factory-wide' }]) assert.throws(() => validateHumanRequest({ ...request, ...patch }));
  validateHumanRequest({ ...request, reason: 'factory-wide', scope: { kind: 'project' } });
});

test('existing Pi read-only argv crosses fresh local process/stdin boundary without resume/session discovery', () => {
  // This records the real argument builder at a local Node boundary, NOT a claim of Pi/SDK execution.
  const { input } = fixture(); const frozen = JSON.stringify(input);
  for (const family of ['openai','anthropic'] as const) {
    const args = piAnalysisArgs(MODEL_POLICY[family].large, { HOME: '/fixture', FACTORY_PI_SUBSCRIPTION_EXTENSION: '/fixture/provider.ts' }, () => true);
    const record = () => spawnSync(process.execPath, ['-e', 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({pid:process.pid,args:process.argv.slice(1),input:s})));', '--', ...args], { input: frozen, encoding: 'utf8', env: {}, timeout: 5000 });
    const first = record(), second = record(); assert.equal(first.status, 0); assert.equal(second.status, 0);
    const a = JSON.parse(first.stdout), b = JSON.parse(second.stdout); assert.notEqual(a.pid, b.pid);
    assert.equal(a.input, frozen); assert.deepEqual(a.args, args);
    for (const flag of ['--no-session','--no-context-files','--no-skills','--no-extensions']) assert.ok(a.args.includes(flag));
    assert.deepEqual(a.args.slice(a.args.indexOf('--tools'), a.args.indexOf('--tools') + 2), ['--tools','read,grep,find,ls']);
    assert.ok(!a.args.some((v: string) => ['--resume','--continue','--session','-r','-c'].includes(v)));
    assert.ok(!a.args.join(' ').includes('FlagAHuman'), 'host outbox bridge is required; tool is not in runtime allowlist');
  }
});
