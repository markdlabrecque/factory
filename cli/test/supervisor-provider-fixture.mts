// Offline spike against unmodified published Pi/OpenAI artifacts. Never a production authorization adapter.
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';

/** Explicit synthetic premise; T01 must replace eligibility with its committed journal primitive. */
export const SPIKE_PROFILE = Object.freeze({ model: 'gpt-6.1-terra', input: 1_050_000, output: 4096,
  reservedTokens: 1_054_096, reservedMicroUSD: 5_808_792 });
const fixture = fileURLToPath(new URL('./fixtures/supervisor-pi/', import.meta.url));

/** This child has no usable network path: injected fetch never delegates, and native socket/HTTP paths throw. */
function denyNetwork() {
  const deny = () => { throw Error('Offline provider fixture: external network denied'); };
  globalThis.fetch = deny;
  net.connect = deny as any; net.createConnection = deny as any;
  net.Socket.prototype.connect = deny as any; tls.connect = deny as any;
  http.request = deny as any; http.get = deny as any; https.request = deny as any; https.get = deny as any;
  syncBuiltinESMExports();
}
function unpack() {
  const root = mkdtempSync(join(tmpdir(), 'factory-pi-spike-'));
  try {
    const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8'));
    for (const p of manifest.packages) {
      const archive = join(fixture, p.archive);
      assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), p.sha256);
      const dest = join(root, 'node_modules', p.name); mkdirSync(dest, { recursive: true });
      execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', dest], { timeout: 5000 });
      const actual = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
      assert.equal(actual.name, p.name); assert.equal(actual.version, p.version);
    }
    return root;
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}
const sse = (value: any) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;

export async function runProviderSpike() {
  denyNetwork();
  const root = unpack();
  try {
    const pi = join(root, 'node_modules/@earendil-works/pi-ai');
    const { stream } = await import(pathToFileURL(join(pi, 'dist/api/openai-responses.js')).href);
    const { OPENAI_MODELS } = await import(pathToFileURL(join(pi, 'dist/providers/openai.models.js')).href);
    const model = Object.values(OPENAI_MODELS).find((m: any) => m.id === SPIKE_PROFILE.model) as any;
    assert.ok(model); assert.equal(model.provider, 'openai'); assert.equal(model.api, 'openai-responses');
    assert.equal(model.baseUrl, 'https://api.openai.com/v1'); assert.equal(model.contextWindow, 272000);
    const context = { messages: [{ role: 'system', content: 'Original Factory constraints.', timestamp: 0 },
      { role: 'user', content: 'Complete synthetic saved-run originals.', timestamp: 0 }] };
    const rawTerminal = { type: 'response.completed', response: { id: 'resp_offline', model: model.id,
      status: 'completed', service_tier: 'default', output: [], usage: { input_tokens: 25,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0,
          cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 10,
        output_tokens_details: { reasoning_tokens: 8 }, total_tokens: 35 } } };
    let attempted = 0, transmitted = 0, payload: any, terminal: any, requestId: any;
    let spent = false;
    // This is a transport permission for the spike only, not a journal grant or host-authority proof.
    const transport = async (url: any, init: any) => {
      attempted++;
      if (spent) throw Error('One request permission already consumed');
      spent = true; // consume before even inspecting a potentially invalid/ambiguous send
      assert.equal(String(url), 'https://api.openai.com/v1/responses'); assert.equal(init.method, 'POST');
      const final = JSON.parse(init.body); assert.deepEqual(final, payload);
      assert.equal(final.max_output_tokens, SPIKE_PROFILE.output); assert.equal(final.truncation, 'disabled');
      transmitted++;
      return new Response(sse(rawTerminal), { status: 200, headers: { 'content-type': 'text/event-stream',
        'x-request-id': 'req_offline' } });
    };
    const options = (eligible: boolean, fetch = transport) => ({ apiKey: 'sk-synthetic-offline-not-a-secret',
      env: {}, maxTokens: SPIKE_PROFILE.output, reasoningEffort: 'high', cacheRetention: 'none',
      maxRetries: 0, serviceTier: 'default', fetch,
      onPayload(value: any, resolved: any) {
        if (!eligible) throw Error('No eligible spike permission');
        assert.equal(resolved.id, model.id); assert.equal(value.model, model.id);
        assert.equal(value.store, false); assert.equal(value.stream, true);
        assert.equal(value.max_output_tokens, SPIKE_PROFILE.output);
        assert.equal(value.service_tier, 'default');
        assert.deepEqual(value.include, ['reasoning.encrypted_content']);
        assert.deepEqual(value.reasoning, { effort: 'medium', summary: 'auto' });
        assert.deepEqual(value.input.at(-1), { type: 'configuration_update', reasoning: { effort: 'high' } });
        assert.deepEqual(value.prompt_cache_options, { mode: 'explicit' });
        assert.equal(value.tools, undefined); assert.equal(value.previous_response_id, undefined);
        assert.equal(value.background, undefined);
        // Supported onPayload transformation. No truncation and no extra request, tool or modality fields.
        value.truncation = 'disabled';
        payload = JSON.parse(JSON.stringify(value));
        const allowed = ['model','input','stream','store','max_output_tokens','service_tier','reasoning',
          'include','prompt_cache_options','truncation'];
        assert.ok(Object.keys(payload).every(k => allowed.includes(k)));
        assert.deepEqual(payload.input.slice(0, -1).map((m: any) => m.role), ['developer', 'user']);
        assert.deepEqual(payload.input.slice(0, -1).map((m: any) => typeof m.content === 'string' ? m.content : m.content.map((c: any) => c.text).join('')),
          context.messages.map(m => m.content));
      },
      onResponse(info: any) { requestId = info.headers['x-request-id']; },
      onProviderStreamEvent(event: any) { if (event.type === 'response.completed') terminal = structuredClone(event); },
    });
    const rejected = await stream(model, context, options(false)).result();
    assert.equal(rejected.stopReason, 'error'); assert.equal(attempted, 0); assert.equal(transmitted, 0);
    const completed = await stream(model, context, options(true)).result();
    assert.equal(completed.stopReason, 'stop', completed.errorMessage); assert.equal(transmitted, 1);
    assert.deepEqual(terminal, rawTerminal); assert.equal(requestId, 'req_offline');
    assert.equal(completed.usage.totalTokens, 35); assert.equal(completed.usage.output, 10);
    const extra = await stream(model, context, options(true)).result();
    assert.equal(extra.stopReason, 'error'); assert.match(extra.errorMessage, /permission already consumed/);
    assert.equal(attempted, 2); assert.equal(transmitted, 1);
    return { artifact: 'pi-ai@1.5.2 / openai@7.19.0', invalidTransmissions: 0, transmissions: transmitted,
      extraRequestDenied: true, rawUsage: terminal.response.usage, requestId,
      payload, profile: SPIKE_PROFILE, evidence: 'real pinned serializer + synthetic HTTP/SSE; no remote acceptance or billing' };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (process.argv[2] === '--offline-spike') console.log(JSON.stringify(await runProviderSpike()));
