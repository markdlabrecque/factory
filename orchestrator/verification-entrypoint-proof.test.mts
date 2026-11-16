// Eligibility, claim and proof-freshness regressions share the normal-entrypoint fixture and CI inventory.
import { test } from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

for (const scenario of ['closed', 'excluded', 'claim', 'dirty', 'branch', 'missing-baseline', 'legacy-prompt', 'config-family', 'config-setup', 'runtime-template']) {
  test(`normal entrypoint ${scenario} openai/default: only the proven tip may leave`, t => normalEntrypointFixture(t, scenario, 'openai'));
}
