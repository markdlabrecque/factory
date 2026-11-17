// Managed entry exclusion, image/setup, sandbox filesystem and exact-cleanup use fixture-owned external boundaries.
import { test } from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

for (const scenario of ['custody-create-error','custody-registration-error']) {
  test(`actual flat main ${scenario} retains pending custody and entry after controller exit`, t => normalEntrypointFixture(t, scenario, 'openai'));
}

test('actual flat normal producer saves exact payload closure and only that saved run permits exclusion', t => normalEntrypointFixture(t, 'no-commit-custody', 'openai'));

test('actual flat main, dispatch and shell bootstrap refuse a real supervisor hold before tracker, provider or readiness work', t => normalEntrypointFixture(t, 'supervisor-held', 'openai'));

for (const scenario of ['image-bad', 'setup-bad', 'image-changed', 'sandbox-workspace', 'sandbox-evidence', 'sandbox-baseline', 'sandbox-index', 'sandbox-cancel', 'sandbox-cleanup']) {
  test(`normal entrypoint ${scenario} openai/default: only the proven tip may leave`, t => normalEntrypointFixture(t, scenario, 'openai'));
}
