// Normal entrypoint model-family/tier routing uses fixture-owned external boundaries.
// Input, proof and sandbox scenarios live in sibling files so bounded CI shards can distribute them.
import { test } from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

const cases = [
  { scenario: 'pass', family: 'openai' as const, tier: undefined as string | undefined },
  ...(['openai', 'anthropic'] as const).flatMap(family => ['small', 'mid', 'large'].map(tier => ({ scenario: 'pass', family, tier }))),
  { scenario: 'pass', family: 'anthropic' as const, tier: undefined },
];
for (const { scenario, family, tier } of cases) {
  test(`normal entrypoint ${scenario} ${family}/${tier ?? 'default'}: only the proven tip may leave`, t => normalEntrypointFixture(t, scenario, family, tier));
}
