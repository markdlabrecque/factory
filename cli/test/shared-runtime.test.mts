// Copied install and data-only init execute the normal workflow against fixture-owned boundaries.
import { test } from 'node:test';
import { normalEntrypointFixture } from '../../orchestrator/verification-entrypoint-fixture.mts';
import { recoveryEntrypointFixture } from '../../orchestrator/recovery-entrypoint-fixture.mts';

test('copied install runs Pi Terra implementation and independent verification', t =>
  normalEntrypointFixture(t, 'pass', 'openai', 'mid', true));

test('copied install recovers saved Pi Terra work with independent Large verification', t =>
  recoveryEntrypointFixture(t, 'pass', 'mid', true));

test('two data-only projects share one runtime without sharing settings or artifacts', t =>
  normalEntrypointFixture(t, 'shared-projects', 'openai', undefined, true));

test('active detached normal run pins A while a fresh invocation runs published B', t =>
  normalEntrypointFixture(t, 'publication', 'openai', 'mid', true));
