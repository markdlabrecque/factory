// One offline provider boundary: actual copied-runtime adapter, unmodified pinned SDK, real journal/worker handshake, synthetic HTTP/SSE only.
import fs, { mkdtempSync, rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import { prepareRuntimeBundle } from '../src/runtime-bundle.mts';
import { installPackages } from './runtime-fixture.mts';
import { supervisorFixture } from './supervisor-fixture.mts';
import { commitSupervisor, readSupervisor, incidentIdentity } from '../src/supervisor-state.mts';
import { diagnosisGrant, ADVISORY_PROFILE_ID, advisoryReservation } from '../src/supervisor-advisory-contract.mts';
import { hostAdvisoryPolicyIdentity } from '../src/supervisor-host-policy.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { diagnosisBasis } from '../../orchestrator/supervisor.mts';
import { ownerOf } from '../../board/admission.mts';

export function denyNetwork() {
  const deny = () => { throw Error('Offline provider fixture: external network denied'); };
  globalThis.fetch = deny;
  net.connect = deny as any; net.createConnection = deny as any;
  net.Socket.prototype.connect = deny as any; tls.connect = deny as any;
  http.request = deny as any; http.get = deny as any; https.request = deny as any; https.get = deny as any;
  syncBuiltinESMExports();
}
export const sse = (value: any) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
export const providerTerminal = () => ({ type: 'response.completed', response: { id: 'resp_offline', model: 'gpt-6.1-terra', status: 'completed',
  service_tier: 'default', output: [], usage: { input_tokens: 25, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0,
    cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 10,
    output_tokens_details: { reasoning_tokens: 8 }, total_tokens: 35 } } });
export const offlineText = 'a'.repeat(16_384); // Synthetic model output only; never useful advice or measured usage.
export function providerTextStream(text = '{}', options: {missingUsage?: boolean} = {}) {
  const terminal: any = providerTerminal();
  if (options.missingUsage) delete terminal.response.usage;
  const item = { type: 'message', id: 'msg_offline', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] };
  return sse({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })
    + sse({ type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: text })
    + sse({ type: 'response.output_item.done', output_index: 0, item }) + sse(terminal);
}
const host = { version: 1 as const, enabled: true as const, profile: ADVISORY_PROFILE_ID, capacity: 1 as const,
  cumulative: { tokens: 10_000_000, cost: 100_000_000, calls: 10 } };
const role = { maxTokens: 5_000_000, maxCostUsd: 50, maxCalls: 5, timeoutSeconds: 60 };
const policy = { enabled: true, limits: { maxTokens: 10_000_000, maxCostUsd: 100, maxCalls: 10, diagnosis: role, review: role } };
const controls = { registered: true, global: 'on' as const, projectControl: 'enabled' as const };

if (process.argv[2] === '--request-worker') {
  denyNetwork();
  process.once('message', async (o: any) => {
    try {
      if (o.abort) { process.disconnect(); return; }
      let driftApplied = false;
      if (o.scenario.startsWith('mid-load-')) {
        // Below the adapter, the second prompt-file read is the selected-input read after initial bundle validation.
        // Mutate actual copied files at this deterministic filesystem barrier; no production callback/flag or timing loop.
        const original = fs.readFileSync; let reads = 0;
        fs.readFileSync = ((path: any, ...args: any[]) => {
          const value = (original as any)(path, ...args);
          if (String(path) === join(o.runtimeRoot, 'prompt.supervisor.md') && ++reads === 2) {
            fs.readFileSync = original; syncBuiltinESMExports();
            const target = o.scenario === 'mid-load-prompt' ? path : join(o.runtimeRoot, 'node_modules/tsx/dist/cli.mjs');
            writeFileSync(target, Buffer.concat([original(target), Buffer.from('\nchanged at fixture barrier\n')])); driftApplied = true;
          }
          return value;
        }) as any;
        syncBuiltinESMExports();
      }
      const { requestAdvisory, validateAdvisoryPayload } = await import(pathToFileURL(join(o.runtimeRoot, 'supervisor-openai-request.mts')).href);
      let transmissions = 0, serialized = '', payload: any;
      const terminal = providerTerminal();
      const transport: typeof fetch = async (url, init) => {
        assert.equal(String(url), 'https://api.openai.com/v1/responses'); assert.equal(init!.method, 'POST'); assert.equal(init!.redirect, 'error');
        assert.equal(new Headers(init!.headers).get('authorization'), 'Bearer sk-synthetic-offline-not-a-secret');
        serialized = init!.body as string; payload = JSON.parse(serialized);
        const system = payload.input[0].content, user = payload.input[1].content[0].text;
        validateAdvisoryPayload(payload, system, user);
        assert.throws(() => validateAdvisoryPayload({ ...payload, background: true }, system, user));
        assert.throws(() => validateAdvisoryPayload({ ...payload, truncation: 'auto' }, system, user));
        assert.equal(payload.max_output_tokens, 4096); assert.deepEqual(payload.reasoning, { effort: 'medium', summary: 'auto' });
        assert.deepEqual(payload.input.at(-1), { type: 'configuration_update', reasoning: { effort: 'high' } });
        transmissions++;
        if (o.scenario === 'inflight-stop') { process.send!({ inflight: true }); await once(process, 'message'); }
        const status = o.scenario === 'retry-429' ? 429 : o.scenario === 'retry-503' ? 503 : o.scenario === 'overflow' ? 400 : 200;
        if (status !== 200) return new Response(JSON.stringify({ error: { message: status === 400 ? 'context_length_exceeded' : 'synthetic retryable failure',
          type: 'invalid_request_error', code: status === 400 ? 'context_length_exceeded' : 'synthetic' } }),
          { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
        return new Response(sse(terminal) + (o.scenario === 'duplicate-terminal' ? sse(terminal) : ''), { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_offline' } });
      };
      const options = { ...o, apiKey: 'sk-synthetic-offline-not-a-secret', fetch: transport };
      let result: any, refused: string | undefined;
      try { result = await requestAdvisory(options); } catch (e) { refused = String(e); }
      let extraRequestDenied = false;
      if (!['stop-first','mid-load-prompt','mid-load-dependencies'].includes(o.scenario)) {
        try { await requestAdvisory(options); } catch (e) { extraRequestDenied = /consumed/.test(String(e)); }
      }
      process.send!({ transmissions, serialized, payload, ...result, refused, extraRequestDenied, driftApplied }, () => process.disconnect());
    } catch (e) { process.send!({ error: String(e) }, () => process.disconnect()); }
  });
  process.send!({ ready: true });
}

export const providerScenarios = ['complete','stop-first','inflight-stop','retry-429','retry-503','overflow','duplicate-terminal','mid-load-prompt','mid-load-dependencies'] as const;
export async function runProviderSpike(selected?: string) {
  if (selected && !providerScenarios.includes(selected as any)) throw Error('Unknown offline provider scenario');
  denyNetwork();
  const root = mkdtempSync(join(tmpdir(), 'factory-provider-boundary-'));
  try {
    const bundle = prepareRuntimeBundle({ sourceRoot: fileURLToPath(new URL('../../', import.meta.url)), runtimeStore: join(root, 'runtimes'), install: installPackages });
    const scenarios: any[] = [];
    for (const scenario of providerScenarios.filter(s => !selected || s === selected)) {
      let runtimeRoot = bundle.directory;
      if (scenario.startsWith('mid-load-')) {
        runtimeRoot = join(root, `runtime-${scenario}`); cpSync(bundle.directory, runtimeRoot, { recursive: true });
      }
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--request-worker'],
        { stdio: ['ignore','ignore','ignore','ipc'], env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C' } });
      const closed = once(child, 'close');
      try {
        assert.deepEqual((await once(child, 'message'))[0], { ready: true });
        const { snapshot, facts } = supervisorFixture(join(root, scenario)); mkdirSync(snapshot.project.root);
        snapshot.material.runtime = bundle.id; snapshot.material.dependencies = bundle.manifest.dependencies;
        const stateDir = join(root, `state-${scenario}`), project = snapshot.project, at = new Date().toISOString();
        const incidentId = incidentIdentity(project, facts), owner = ownerOf(process.pid), worker = ownerOf(child.pid!);
        const reservation = { id: 'invocation', incidentId, kind: 'diagnosis' as const, owner, fence: 'fresh-fence', at,
          deadline: new Date(Date.parse(at) + 60_000).toISOString(), reserved: advisoryReservation(), actual: null, state: 'active' as const, reviewId: null };
        const registration = { holdId: 'synthetic-exclusion-binding-not-an-admission-claim', host, project: policy, at };
        const grant = diagnosisGrant({ version: 1, project, ticket: 236, runId: facts.runId, attemptId: null, incidentId, basis: diagnosisBasis(snapshot),
          invocationId: reservation.id, fence: reservation.fence, holdId: registration.holdId, runtime: bundle.id, dependencies: bundle.manifest.dependencies,
          profile: ADVISORY_PROFILE_ID, policy: hostAdvisoryPolicyIdentity(host), owner: worker, deadline: reservation.deadline, reserved: reservation.reserved });
        let state = commitSupervisor(stateDir, project, 0, { id: 'observe', at, kind: 'observe', facts, snapshotHash: supervisorHash(snapshot), reason: 'offline original input' });
        state = commitSupervisor(stateDir, project, state.revision, { id: 'reserve', at, kind: 'reserve-advisory', reservation, policy: registration, controls,
          limits: { project: { tokens: 10_000_000, cost: 100_000_000 }, shared: { tokens: 10_000_000, cost: 100_000_000 }, capacity: 1, reviewCalls: 5, reviewTimeoutMs: 60_000 } });
        state = commitSupervisor(stateDir, project, state.revision, { id: 'register', at: new Date().toISOString(), kind: 'register-advisory-worker',
          reservationId: reservation.id, fence: reservation.fence, owner, grant });
        const stop = () => { const current = readSupervisor(stateDir, project); return commitSupervisor(stateDir, project, current.revision,
          { id: 'stop', at: new Date().toISOString(), kind: 'control', mode: 'stopped', actor: 'fixture-operator', pilot: false }); };
        if (scenario === 'stop-first') stop();
        const reply = once(child, 'message');
        child.send({ scenario, runtimeRoot, stateDir, grant, policy: registration, controls, snapshot });
        let outcome: any = (await reply)[0];
        if (scenario === 'inflight-stop') {
          assert.deepEqual(outcome, { inflight: true }); stop(); const next = once(child, 'message'); child.send({ continue: true }); outcome = (await next)[0];
        }
        assert.equal(outcome.error, undefined, JSON.stringify(outcome));
        const journal = readSupervisor(stateDir, project), sends = Object.values(journal.advisory!.sends);
        if (['stop-first','mid-load-prompt','mid-load-dependencies'].includes(scenario)) { assert.equal(outcome.transmissions, 0); assert.equal(sends.length, 0); }
        else { assert.equal(outcome.transmissions, 1, JSON.stringify(outcome)); assert.equal(sends.length, 1); assert.equal(outcome.extraRequestDenied, true); }
        if (scenario.startsWith('mid-load-')) assert.equal(outcome.driftApplied, true, 'deterministic drift barrier reached');
        if (['complete','inflight-stop'].includes(scenario)) {
          assert.equal(outcome.result.stopReason, 'stop', outcome.result.errorMessage);
          assert.equal(outcome.terminal.response.usage.total_tokens, 35);
          assert.equal(sends[0].payload, createHash('sha256').update(outcome.serialized).digest('hex'));
          for (const source of snapshot.sources) assert.ok(outcome.payload.input[1].content[0].text.includes(source.text));
        } else assert.ok(outcome.refused || outcome.result.stopReason === 'error');
        if (scenario === 'inflight-stop') assert.equal(journal.control!.mode, 'stopped');
        if (scenario === 'duplicate-terminal') assert.match(outcome.terminalProblem, /ambiguous/);
        assert.deepEqual(journal.charged.diagnosis, advisoryReservation(), 'no refund/settlement is claimed');
        scenarios.push({ scenario, ...outcome, authorizations: sends.length });
        await closed;
      } finally { if (child.connected) child.send({ abort: true }, () => {}); await closed; }
    }
    const complete = scenarios.find(s => s.scenario === 'complete');
    return { artifact: 'PiAI1.5.2 / OpenAI7.19.0 copied-runtime public subpath closure', invalidTransmissions: 0,
      transmissions: complete?.transmissions, extraRequestDenied: complete?.extraRequestDenied, payload: complete?.payload,
      rawUsage: complete?.terminal.response.usage, requestId: complete?.response.requestId,
      scenarios: scenarios.map(({ serialized, payload, terminal, result, ...trace }) => trace),
      runtime: bundle.id, dependencies: bundle.manifest.dependencies,
      evidence: 'actual production gate/pinned serializer/copied artifacts/journal/registered child; synthetic HTTP/SSE, host controls and exclusion ID; no live provider/admission/settlement' };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
/** Capability probe only: the shipped serializer receives a synthetic non-sk string, never real auth.
 * Use the same archived closure and final payload validator; no production credential check is bypassed. */
export async function runLoginSerializationSpike() {
  denyNetwork();
  const root = mkdtempSync(join(tmpdir(), 'factory-login-serialization-'));
  try {
    const source = fileURLToPath(new URL('../src/supervisor-provider/', import.meta.url));
    const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
    for (const pkg of manifest.packages) {
      const archive = join(source, pkg.archive);
      assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), pkg.sha256);
      const target = join(root, 'node_modules', pkg.name); mkdirSync(target, { recursive: true });
      execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', target],
        { timeout: 5000, env: { PATH: '/usr/bin:/bin', LANG: 'C' }, stdio: 'pipe' });
    }
    const pi = join(root, 'node_modules/@earendil-works/pi-ai');
    const { stream } = await import(pathToFileURL(join(pi, 'dist/api/openai-responses.js')).href);
    const { OPENAI_MODELS } = await import(pathToFileURL(join(pi, 'dist/providers/openai.models.js')).href);
    const { ADVISORY_PROFILE } = await import('../src/supervisor-advisory-contract.mts');
    const { validateAdvisoryPayload } = await import('../src/supervisor-openai-request.mts');
    assert.equal(createHash('sha256').update(readFileSync(join(pi, 'dist/api/openai-responses.js'))).digest('hex'), ADVISORY_PROFILE.serializer);
    assert.equal(createHash('sha256').update(readFileSync(join(pi, 'dist/providers/data/openai.json'))).digest('hex'), ADVISORY_PROFILE.catalogue);
    const model: any = Object.values(OPENAI_MODELS).find((m: any) => m.id === ADVISORY_PROFILE.model);
    assert.equal(model.provider, 'openai'); assert.equal(model.api, 'openai-responses');
    assert.equal(model.baseUrl, 'https://api.openai.com/v1');
    const system = 'Synthetic offline system', user = 'Synthetic offline user';
    let payload: any, transmissions = 0;
    const result = await stream(model, { messages: [{ role: 'system', content: system, timestamp: 0 },
      { role: 'user', content: user, timestamp: 0 }] }, {
      apiKey: 'synthetic-chatgpt-not-a-token', env: {}, maxTokens: ADVISORY_PROFILE.output,
      reasoningEffort: 'high', cacheRetention: 'none', serviceTier: 'default', maxRetries: 0,
      fetch: async () => { transmissions++; throw Error('Offline login probe must never transmit'); },
      onPayload(value: any) {
        value.truncation = 'disabled'; payload = JSON.parse(JSON.stringify(value));
        validateAdvisoryPayload(payload, system, user); return payload;
      },
    }).result();
    assert.equal(transmissions, 0); assert.equal(result.stopReason, 'error');
    assert.match(result.errorMessage, /unsupported serialized request/);
    return { payload, transmissions, refusal: result.errorMessage,
      evidence: 'exact archived Pi serializer and production payload validator; synthetic credential shape only; no auth, authorization or live provider' };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (process.argv[2] === '--offline-spike') console.log(JSON.stringify(await runProviderSpike(process.argv[3])));
if (process.argv[2] === '--login-serialization-spike') console.log(JSON.stringify(await runLoginSerializationSpike()));
