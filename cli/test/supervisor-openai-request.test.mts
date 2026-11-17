// One real pinned Pi/OpenAI serialization boundary; synthetic transport is permanently offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('pinned Pi request is gated before transmission and exposes raw terminal usage', () => {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('./supervisor-provider-fixture.mts', import.meta.url)),
    '--offline-spike'], { timeout: 15000, maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C' }, encoding: 'utf8' });
  const evidence = JSON.parse(output);
  assert.equal(evidence.invalidTransmissions, 0);
  assert.equal(evidence.transmissions, 1);
  assert.equal(evidence.extraRequestDenied, true);
  assert.equal(evidence.payload.max_output_tokens, 4096);
  assert.equal(evidence.payload.truncation, 'disabled');
  assert.equal(evidence.rawUsage.output_tokens, 10);
  assert.equal(evidence.rawUsage.output_tokens_details.reasoning_tokens, 8);
  assert.equal(evidence.rawUsage.total_tokens, 35);
  assert.equal(evidence.requestId, 'req_offline');
});
