// Pure paid-call preflight and fixed-role tests; no journals, providers, clocks or live execution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supervisorCallHold, SUPERVISOR_BOUNDS } from './supervisor-policy.mts';
import type { SupervisorPolicy, PaidCallInput } from './supervisor-policy.mts';
import { modelForRole, MODEL_POLICY } from './model-policy.mts';
const limits = { maxTokens: 1000, maxCostUsd: 2, maxCalls: 4, timeoutSeconds: 600 };
const policy: SupervisorPolicy = { enabled: true, limits: { maxTokens: 2000, maxCostUsd: 4, maxCalls: 8, diagnosis: { ...limits }, review: { ...limits } } };
const input = (): PaidCallInput => ({ registered: true, mode: 'act', globalAllowed: true, accountingKnown: true, pricingKnown: true,
  project: { tokens: 500, costUsd: 1, calls: 2 }, role: { tokens: 250, costUsd: 0.5, calls: 1 },
  reservation: { tokens: 100, costUsd: 0.2, calls: 1 }, diagnosisCalls: 0, activeDecisions: 0 });

test('supervisor Mid and independent review Large are fixed in each configured family, regardless of ticket tier', () => {
  for (const family of ['openai', 'anthropic'] as const) for (const tier of ['small','mid','large'] as const) {
    assert.equal(modelForRole(family, 'supervisor', tier).model, MODEL_POLICY[family].mid);
    assert.equal(modelForRole(family, 'gateReview', tier).model, MODEL_POLICY[family].large);
    assert.equal(modelForRole(family, 'gateReview').provider, modelForRole(family, 'supervisor').provider);
    assert.equal(modelForRole(family, 'implementation', tier).model, MODEL_POLICY[family][tier]);
    for (const role of ['verification','recovery'] as const) assert.equal(modelForRole(family, role, tier).tier, 'large');
    assert.equal(modelForRole(family, 'analysis', tier).tier, 'mid');
  }
});
test('paid preflight allows bounded observe diagnosis only, holds reviews/stop and unknown admission', () => {
  assert.equal(supervisorCallHold(policy, 'diagnosis', input()), undefined);
  assert.equal(supervisorCallHold(policy, 'diagnosis', { ...input(), mode: 'observe' }), undefined);
  assert.ok(supervisorCallHold(policy, 'diagnosis', { ...input(), mode: 'stopped' }));
  for (const mode of ['observe','stopped'] as const) assert.ok(supervisorCallHold(policy, 'review', { ...input(), mode }));
  assert.ok(supervisorCallHold({ enabled: false }, 'diagnosis', input()));
  assert.ok(supervisorCallHold({ enabled: true }, 'diagnosis', input()));
  for (const field of ['registered','globalAllowed','accountingKnown','pricingKnown'] as const)
    assert.ok(supervisorCallHold(policy, 'review', { ...input(), [field]: false }), field);
});
test('project AND separately budgeted role totals include reservations; finite exact ceiling succeeds, overflow holds', () => {
  for (const role of ['diagnosis','review'] as const) {
    for (const [field, value] of [['tokens', 1000], ['costUsd', 2], ['calls', 4]] as const) {
      const i = input(); i.role[field] = value; i.project[field] = value;
      assert.ok(supervisorCallHold(policy, role, i), `role ${field}`);
    }
    for (const [field, value] of [['tokens', 2000], ['costUsd', 4], ['calls', 8]] as const) {
      const i = input(); i.project[field] = value;
      assert.ok(supervisorCallHold(policy, role, i), `project ${field}`);
    }
    const exact = input(); exact.project = { tokens: 1900, costUsd: 3.8, calls: 7 }; exact.role = { tokens: 900, costUsd: 1.8, calls: 3 };
    assert.equal(supervisorCallHold(policy, role, exact), undefined);
  }
});
test('unknown/malformed accounting, reservation and concurrent/incident bounds hold without resets', () => {
  assert.deepEqual(SUPERVISOR_BOUNDS, { diagnosesPerIncident: 2, timeoutSeconds: 600, activeDecisionsPerProject: 1 });
  for (const field of ['tokens','costUsd','calls'] as const) for (const value of [NaN, Infinity, -1]) {
    for (const section of ['project','role','reservation'] as const) {
      const i = input(); i[section][field] = value;
      assert.ok(supervisorCallHold(policy, 'diagnosis', i));
    }
  }
  for (const reservation of [{ tokens: 0, costUsd: 1, calls: 1 }, { tokens: 1, costUsd: 0, calls: 1 }, { tokens: 1, costUsd: 1, calls: 0 }])
    assert.ok(supervisorCallHold(policy, 'review', { ...input(), reservation }));
  for (const activeDecisions of [1,2,NaN,-1]) assert.ok(supervisorCallHold(policy, 'review', { ...input(), activeDecisions }));
  for (const diagnosisCalls of [2,3,NaN,-1]) assert.ok(supervisorCallHold(policy, 'diagnosis', { ...input(), diagnosisCalls }));
  assert.equal(supervisorCallHold(policy, 'review', { ...input(), diagnosisCalls: 2 }), undefined);
  assert.ok(supervisorCallHold(policy, 'review', { ...input(), role: { tokens: 501, costUsd: 1, calls: 2 } }));
  const tooLong = structuredClone(policy); tooLong.limits!.review.timeoutSeconds = 601;
  assert.ok(supervisorCallHold(tooLong, 'review', input()));
});
