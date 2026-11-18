// Normal implementation resume with a stub SDK/tracker and real disposable Git; no model or Docker.
import test from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

for (const scenario of ['pass', 'failed-verification', 'exhausted', 'error', 'stalled', 'false-success', 'superseded', 'wrong-checkout', 'outside-commit']) {
  test(`normal implementation continuation: ${scenario}`, t => normalEntrypointFixture(t, `continuation-${scenario}`, 'openai'));
}
