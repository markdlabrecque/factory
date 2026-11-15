// Copied install and data-only init execute the normal workflow against fixture-owned boundaries.
import { test } from 'node:test';
import { normalEntrypointFixture } from '../../orchestrator/verification-entrypoint-fixture.mts';

test('copied install runs Pi Terra implementation and independent verification', t =>
  normalEntrypointFixture(t, 'pass', 'openai', undefined, true));
