// Recovery entrypoint regression scenarios share fixture-owned external boundaries.
import { test } from 'node:test';
import { recoveryEntrypointFixture } from './recovery-entrypoint-fixture.mts';

for (const { scenario, tier } of [
  ...['pass', 'missing-baseline', 'title', 'parent-plan', 'closed-before', 'dirty', 'legacy-prompt', 'dependency-unknown', 'setup-bad', 'sandbox-workspace', 'sandbox-evidence', 'sandbox-baseline', 'sandbox-index', 'sandbox-cancel', 'sandbox-cleanup'].map(scenario => ({ scenario, tier: 'mid' })),
  { scenario: 'pass', tier: 'small' }, { scenario: 'pass', tier: 'large' },
]) {
  test(`real recovery entrypoint: ${scenario} implementer tier ${tier}`, t => recoveryEntrypointFixture(t, scenario, tier));
}
