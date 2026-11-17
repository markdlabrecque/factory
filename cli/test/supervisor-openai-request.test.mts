// One real pinned Pi/OpenAI serialization boundary; synthetic transport is permanently offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAdvisoryPayload, validateAdvisoryEnvironment, validateAdvisoryInput } from '../src/supervisor-openai-request.mts';
import { diagnosisGrant } from '../src/supervisor-advisory-contract.mts';
import { diagnosisBasis } from '../../orchestrator/supervisor.mts';
import { supervisorFixture } from './supervisor-fixture.mts';
import { usageFixture } from './supervisor-usage-fixture.mts';
import { providerScenarios } from './supervisor-provider-fixture.mts';

test('pure worker environment and frozen input preconditions refuse drift before provider startup', () => {
  const keys=['PATH','HOME','LANG','LC_ALL','LC_CTYPE','TZ','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE'];
  assert.doesNotThrow(()=>validateAdvisoryEnvironment(keys));
  for(const key of ['OPENAI_LOG','NODE_TLS_REJECT_UNAUTHORIZED','NODE_OPTIONS','HTTP_PROXY','PI_PROVIDER'])
    assert.throws(()=>validateAdvisoryEnvironment([...keys,key]),/environment must be isolated/);
  const f=usageFixture(), snapshot=supervisorFixture(f.g.project.root).snapshot, {id,...body}=f.g;
  const grant=diagnosisGrant({...body,project:snapshot.project,ticket:snapshot.scope.ticket,runId:snapshot.material.runId,
    runtime:snapshot.material.runtime,dependencies:snapshot.material.dependencies,basis:diagnosisBasis(snapshot)});
  assert.deepEqual(validateAdvisoryInput(snapshot,grant),snapshot);
  for(const mutate of [(s:any)=>{s.material.settings='c'.repeat(64);},(s:any)=>{s.material.runtime='c'.repeat(64);},
    (s:any)=>{s.material.dependencies='c'.repeat(64);},(s:any)=>{s.material.runId='other-run';},
    (s:any)=>{s.scope.ticket++;},(s:any)=>{s.project.tracker.project='owner/other';}]) {
    const changed=structuredClone(snapshot); mutate(changed); assert.throws(()=>validateAdvisoryInput(changed,grant),/input does not match grant/);
  }
});

test('pinned ChatGPT-login serializer lacks the approved remote cap/cache contract and is refused before transmission', () => {
  const evidence = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./supervisor-provider-fixture.mts', import.meta.url)),
    '--login-serialization-spike'], { timeout: 15000, maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C' }, encoding: 'utf8' }));
  assert.equal(evidence.transmissions, 0);
  assert.match(evidence.refusal, /unsupported serialized request/);
  const payload = evidence.payload;
  assert.equal(payload.model, 'gpt-6.1-terra');
  for (const field of ['max_output_tokens', 'prompt_cache_options', 'prompt_cache_retention', 'prompt_cache_key'])
    assert.equal(Object.hasOwn(payload, field), false, `${field} is absent from actual serialized login payload`);
  assert.deepEqual(payload.reasoning, { effort: 'high', summary: 'auto' });
  assert.equal(payload.input.some((item: any) => item.type === 'configuration_update'), false);
  assert.equal(payload.service_tier, 'default'); assert.equal(payload.truncation, 'disabled');
  assert.equal(payload.store, false); assert.equal(payload.stream, true);
});

test('copied pinned Pi adapter consumes real journal permission before one bounded request and exposes raw terminal usage', () => {
  // Bound each independent fresh request handshake, not the aggregate nine-case matrix.
  // The unchanged standard test/shard bounds still cap the complete integration.
  const rows = providerScenarios.map(scenario => {
    try { return JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./supervisor-provider-fixture.mts', import.meta.url)),
      '--offline-spike', scenario], { timeout: 15000, maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C' }, encoding: 'utf8' })); }
    catch (error) { throw new Error(`Offline provider scenario ${scenario} failed`, { cause: error }); }
  });
  const evidence = { ...rows[0], scenarios: rows.flatMap(r => r.scenarios) };
  for (const row of rows) { assert.equal(row.invalidTransmissions,0); assert.equal(row.runtime,evidence.runtime); assert.equal(row.dependencies,evidence.dependencies); }
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
    ['complete',1,1], ['stop-first',0,0], ['inflight-stop',1,1], ['retry-429',1,1], ['retry-503',1,1], ['overflow',1,1], ['duplicate-terminal',1,1], ['mid-load-prompt',0,0], ['mid-load-dependencies',0,0],
  ]);
});
