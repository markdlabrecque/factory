// One real pinned Pi/OpenAI serialization boundary; synthetic transport is permanently offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAdvisoryPayload } from '../src/supervisor-openai-request.mts';

test('copied pinned Pi adapter consumes real journal permission before one bounded request and exposes raw terminal usage', () => {
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
  const system = evidence.payload.input[0].content, user = evidence.payload.input[1].content[0].text;
  for (const change of [{ tools: [] }, { tool_choice: 'auto' }, { previous_response_id: 'continuation' }, { background: true },
    { prompt_cache_key: 'warming' }, { service_tier: 'priority' }, { max_output_tokens: 4097 }, { truncation: 'auto' }])
    assert.throws(() => validateAdvisoryPayload({ ...evidence.payload, ...change }, system, user));
  assert.deepEqual(evidence.scenarios.map((s: any) => [s.scenario, s.transmissions, s.authorizations]), [
    ['complete',1,1], ['stop-first',0,0], ['inflight-stop',1,1], ['retry-429',1,1], ['retry-503',1,1], ['overflow',1,1], ['duplicate-terminal',1,1], ['changed-input',0,0], ['environment',0,0], ['tls-environment',0,0], ['artifact-drift',0,0], ['mid-load-prompt',0,0], ['mid-load-dependencies',0,0],
  ]);
});
