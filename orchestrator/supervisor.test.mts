// Pure proposal and frozen-context contracts. No process, filesystem, model or tracker boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supervisorFixture, HASH } from '../cli/test/supervisor-fixture.mts';
import { diagnosisBasis, diagnosisContext, parseDiagnosis, validateDiagnosisDecision, MEMORY_LIMIT, DIAGNOSIS_OUTPUT_BYTES } from './supervisor.mts';
import { proposalIdentity, supervisorHash, sourceHash } from './supervisor-contract.mts';
import type { DiagnosisDecision } from './supervisor.mts';
const decision = (): DiagnosisDecision => ({ version: 1, incidentId: HASH, basisHash: diagnosisBasis(supervisorFixture().snapshot),
  classification: 'evidence-mechanism', rationale: 'Wait for CI evidence, not repair of saved work', alternatives: ['Inspect original failure output'], action: { kind: 'wait', expectation: 'CI terminal state' } });

test('frozen original sources survive bounded memory, with separate problem/evidence/expectation and protected rules', () => {
  const snapshot = supervisorFixture().snapshot;
  const prior = Array.from({ length: 20 }, (_, n) => ({ id: HASH, basisHash: HASH, outcome: 'proposed', rationale: `prior ${n}`, reference: `host:original-${n}` }));
  const context = diagnosisContext(snapshot, HASH, prior);
  assert.equal(context.memory.length, MEMORY_LIMIT); assert.equal(context.omittedMemory, 12);
  assert.deepEqual(context.snapshot, snapshot); assert.deepEqual(context.snapshot.sources.map(s => s.text), snapshot.sources.map(s => s.text));
  prior[19].rationale = 'changed'; snapshot.factoryConstraints[0] = 'mutated caller';
  assert.equal(context.memory.at(-1)?.rationale, 'prior 19'); assert.notEqual(context.snapshot.factoryConstraints[0], 'mutated caller');
  assert.notDeepEqual(context.snapshot.projectGuidelines, context.snapshot.factoryConstraints);
});

test('all five proposal categories are strictly typed and never approval or executable authority', () => {
  const snapshot = supervisorFixture().snapshot;
  const p = { version: 1 as const, incidentId: HASH, snapshotHash: supervisorHash(snapshot), project: snapshot.project, scope: snapshot.scope,
    change: { category: 'verification-command-substitution' as const, path: 'TESTING.md', before: 'old', after: 'equivalent', owner: { ticket: 236, runId: 'run-a' }, expiresAt: '2026-11-17T13:00:00.000Z' },
    rationale: 'Equivalent evidence', alternatives: ['Repair original mechanism'], risks: ['Requires independent review'] };
  const actions: DiagnosisDecision['action'][] = [decision().action, { kind: 'observe', expectation: 'Read current evidence' },
    { kind: 'request-repair', ticket: 236, runId: 'run-a', expectation: 'Existing admission must decide' },
    { kind: 'gate-change', proposal: { ...p, id: proposalIdentity(p) } }, { kind: 'follow-up-draft', title: 'Question', body: 'Human approval needed' },
    { kind: 'escalate', question: 'Choose a lawful local alternative?', nextAction: 'Inspect original evidence', factoryWide: true }];
  for (const action of actions) for (const classification of ['problem','evidence-mechanism','expectation'] as const) {
    const d = { ...decision(), classification, action };
    assert.deepEqual(parseDiagnosis(JSON.stringify(d), snapshot, HASH), d);
  }
  const invalid = [ { ...decision(), approved: true }, { ...decision(), version: 2 }, { ...decision(), alternatives: [] },
    { ...decision(), action: { kind: 'approve' } }, { ...decision(), action: { kind: 'request-repair', ticket: 237, runId: 'run-a', expectation: 'repair' } },
    { ...decision(), action: { kind: 'wait', expectation: 'pending', command: 'shell' } } ];
  for (const d of invalid) assert.throws(() => parseDiagnosis(JSON.stringify(d), snapshot, HASH));
  for (const output of ['', 'null', '{}', '```json\n{}\n```', '{} trailing', ' '.repeat(DIAGNOSIS_OUTPUT_BYTES + 1)]) assert.throws(() => parseDiagnosis(output, snapshot, HASH));
  const protectedProposal = { ...p, change: { ...p.change, category: 'factory-policy' as const } };
  assert.throws(() => validateDiagnosisDecision({ ...decision(), action: { kind: 'gate-change', proposal: { ...protectedProposal, id: proposalIdentity(protectedProposal) } } }, snapshot, HASH), /protected policy/);
});

test('basis ignores observation time only, never source bytes, original references, mode, policy or material identities', () => {
  const snapshot = supervisorFixture().snapshot, basis = diagnosisBasis(snapshot);
  assert.equal(diagnosisBasis({ ...snapshot, observedAt: '2026-11-17T12:01:00.000Z' }), basis);
  const changes = [ { ...snapshot, mode: 'stopped' as const }, { ...snapshot, material: { ...snapshot.material, settings: 'c'.repeat(64) } },
    { ...snapshot, factoryConstraints: ['Changed policy'] }, { ...snapshot, sources: snapshot.sources.map((s, n) => n ? s : { ...s, text: 'new original', sha256: sourceHash('new original') }) } ];
  for (const changed of changes) {
    assert.notEqual(diagnosisBasis(changed), basis);
    assert.throws(() => validateDiagnosisDecision(decision(), changed, HASH), /basis/);
  }
  assert.throws(() => validateDiagnosisDecision(decision(), snapshot, 'd'.repeat(64)), /basis/);
});
