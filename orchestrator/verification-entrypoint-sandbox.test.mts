// Image/setup, sandbox filesystem and exact-cleanup regressions use fixture-owned external boundaries.
import { test } from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

for (const scenario of ['image-bad', 'setup-bad', 'image-changed', 'sandbox-workspace', 'sandbox-evidence', 'sandbox-baseline', 'sandbox-index', 'sandbox-cancel', 'sandbox-cleanup']) {
  test(`normal entrypoint ${scenario} openai/default: only the proven tip may leave`, t => normalEntrypointFixture(t, scenario, 'openai'));
}
