// Normal entrypoint regression scenarios share fixture-owned external boundaries.
import { test } from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

const cases = [
  ...['pass', 'instruction-edit', 'title', 'body', 'comment', 'parent', 'closed', 'excluded', 'claim', 'dirty', 'branch', 'missing-baseline', 'legacy-prompt', 'image-bad', 'setup-bad', 'image-changed', 'config-family', 'config-setup', 'runtime-template', 'tier-edit'].map(scenario => ({ scenario, family: 'openai' as const, tier: undefined as string | undefined })),
  ...(['openai', 'anthropic'] as const).flatMap(family => ['small', 'mid', 'large'].map(tier => ({ scenario: 'pass', family, tier }))),
  { scenario: 'pass', family: 'anthropic' as const, tier: undefined },
];
for (const { scenario, family, tier } of cases) {
  test(`normal entrypoint ${scenario} ${family}/${tier ?? 'default'}: only the proven tip may leave`, t => normalEntrypointFixture(t, scenario, family, tier));
}
