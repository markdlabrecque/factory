// Frozen input and instruction regressions use the same normal-entrypoint fixture, independently shardable.
import { test } from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

for (const scenario of ['parent-plan', 'parent-read-failed', 'instruction-missing', 'instruction-edit', 'title', 'body', 'comment', 'parent', 'tier-edit']) {
  test(`normal entrypoint ${scenario} openai/default: only the proven tip may leave`, t => normalEntrypointFixture(t, scenario, 'openai'));
}
