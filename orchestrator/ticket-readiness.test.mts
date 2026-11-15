// Cross-path acceptance uses the same complete runtime assembly as copied installs, not module substitutes.
// SDK/tracker/container/service boundaries are fake; Git, prompts, evidence, charge and cleanup are real fixture data.
import { test } from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';
import { recoveryEntrypointFixture } from './recovery-entrypoint-fixture.mts';

test('complete copied runtime delivers the full child specification and parent decisions/plan with matching prompt, snapshot and proof hashes', t =>
  normalEntrypointFixture(t, 'readiness-acceptance', 'openai', 'mid', true));

test('copied recovery refuses incomplete input before charge, then preserves frozen repair/verifier input and settles exact delivery', t =>
  recoveryEntrypointFixture(t, 'pass', 'mid', true));

for (const scenario of ['sandbox-workspace', 'sandbox-evidence', 'sandbox-cleanup']) {
  test(`copied normal ${scenario} starts no agent and preserves owned cleanup`, t =>
    normalEntrypointFixture(t, scenario, 'openai', 'mid', true));
  test(`copied recovery ${scenario} retains its post-container charge and exact cleanup ownership`, t =>
    recoveryEntrypointFixture(t, scenario, 'mid', true));
}

test('copied runtime rejects changed parent plan before independent verification without rewriting frozen input', t =>
  normalEntrypointFixture(t, 'parent-plan', 'openai', 'mid', true));
