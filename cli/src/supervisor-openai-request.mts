// Load the pinned, inventoried Pi subpath closure; consume journal permission at the final bounded HTTP gate. No action/settlement authority.
import { ADVISORY_PROFILE, validateDiagnosisGrant } from './supervisor-advisory-contract.mts';
import type { DiagnosisGrant } from './supervisor-advisory-contract.mts';
import { authorizeAdvisorySend, readSupervisor } from './supervisor-state.mts';
import type { AdvisoryControls, AdvisoryRegistration } from './supervisor-state.mts';
import { validateRuntimeBundle } from './runtime-bundle.mts';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const flat = existsSync(new URL('./admission.mts', import.meta.url));
const { ownerOf } = await import(flat ? './admission.mts' : '../../board/admission.mts');
const { validateSnapshot, supervisorHash } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
const { diagnosisBasis, diagnosisContext } = await import(flat ? './supervisor.mts' : '../../orchestrator/supervisor.mts');
import type { Snapshot } from '../../orchestrator/supervisor-contract.mts';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const artifacts = [
  ['@earendil-works/pi-ai', '1.5.2', 'pi-ai-1.5.2.tgz', 'd5715efa834c23bfdf10a042b49df4ee169cc99000bf16d7998fab2d533b45f8'],
  ['@earendil-works/pi-telemetry', '1.5.2', 'pi-telemetry-1.5.2.tgz', '0d29dbee830c74af7115035c7cb326c1e9da2f690a3f6f95620597092da9f9ee'],
  ['openai', '7.19.0', 'openai-7.19.0.tgz', '597532dcb9051ee8aa5edadedb57b798b42add68cc5aec1d67e994d0cfad07f1'],
  ['partial-json', '0.1.7', 'partial-json-0.1.7.tgz', '30eafeed6fdc25fb2ca24f34c37796d9f98f0bf5e156452b98a2c356762f6322'],
] as const;
/** Public subpath closure only, not a full Pi installation. No npm/network or source/global dependency fallback. */
async function pinnedProvider(runtime: string, temporary: string) {
  for (const [name, version, archive, digest] of artifacts) {
    const source = join(runtime, 'supervisor-provider', archive);
    const bytes = readFileSync(source);
    if (sha(bytes) !== digest) throw Error('Advisory held: provider archive identity changed');
    const verified = join(temporary, archive); writeFileSync(verified, bytes, { flag: 'wx', mode: 0o600 });
    const dest = join(temporary, 'node_modules', name); mkdirSync(dest, { recursive: true, mode: 0o700 });
    execFileSync('tar', ['-xzf', verified, '--strip-components=1', '-C', dest], { timeout: 5000, env: { PATH: '/usr/bin:/bin', LANG: 'C' }, stdio: 'pipe' });
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
    if (pkg.name !== name || pkg.version !== version) throw Error('Advisory held: provider package identity changed');
  }
  const pi = join(temporary, 'node_modules/@earendil-works/pi-ai');
  for (const [path, hash] of [['dist/api/openai-responses.js', ADVISORY_PROFILE.serializer], ['dist/providers/data/openai.json', ADVISORY_PROFILE.catalogue]])
    if (sha(readFileSync(join(pi, path))) !== hash) throw Error('Advisory held: provider profile artifact mismatch');
  const { stream } = await import(pathToFileURL(join(pi, 'dist/api/openai-responses.js')).href);
  const { OPENAI_MODELS } = await import(pathToFileURL(join(pi, 'dist/providers/openai.models.js')).href);
  const model = Object.values(OPENAI_MODELS).find((m: any) => m.id === ADVISORY_PROFILE.model) as any;
  if (!model || model.provider !== ADVISORY_PROFILE.provider || model.api !== ADVISORY_PROFILE.api
    || model.baseUrl !== 'https://api.openai.com/v1' || model.contextWindow !== 272000 || model.headers !== undefined)
    throw Error('Advisory held: exact fixed resolved provider required');
  return { stream, model };
}

/** Offline positive closure verification using the very same pinned loader as the request path.
 * Imports only digest-verified public SDK artifacts; never sends, discovers auth or probes tokens. */
export async function verifyPinnedProvider(runtime: string): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'factory-advisory-verify-'));
  try { await pinnedProvider(runtime, temporary); }
  finally { rmSync(temporary, { recursive: true, force: true }); }
}

/** Pure preconditions are independently testable without starting a provider process. Neither helper grants authority. */
export function validateAdvisoryEnvironment(keys: readonly string[]) {
  const allowed = new Set(['PATH','HOME','LANG','LC_ALL','LC_CTYPE','TZ','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE']);
  if (keys.some(k => !allowed.has(k))) throw Error('Advisory held: provider worker environment must be isolated');
}
export function validateAdvisoryInput(value: Snapshot, grant: DiagnosisGrant): Snapshot {
  validateDiagnosisGrant(grant); const snapshot = validateSnapshot(value);
  if (supervisorHash(snapshot.project) !== supervisorHash(grant.project) || snapshot.scope.kind !== 'ticket' || snapshot.scope.ticket !== grant.ticket
    || snapshot.material.runId !== grant.runId || snapshot.material.runtime !== grant.runtime || snapshot.material.dependencies !== grant.dependencies
    || diagnosisBasis(snapshot) !== grant.basis) throw Error('Advisory held: frozen complete input does not match grant');
  return snapshot;
}

export type AdvisoryObservation = { snapshot: Snapshot; policy: AdvisoryRegistration; controls: AdvisoryControls };
export type AdvisoryRequest = { runtimeRoot: string; stateDir: string; grant: DiagnosisGrant; policy: AdvisoryRegistration; controls: AdvisoryControls;
  /** Owned host path requires fresh data over the original controller IPC, not permission. Legacy direct component fixtures omit this. */
  observe?: () => Promise<AdvisoryObservation>;
  snapshot: Snapshot; apiKey: string; signal?: AbortSignal;
  /** SDK-supported HTTP seam only: never an authorization callback. Production defaults to native fetch. */
  fetch?: typeof globalThis.fetch };
/** Returns raw evidence, not settled usage or execution authority. Every failed/ambiguous send stays spent.
 * The complete selected bundle and separate registered worker are mandatory; PID existence alone never authorizes. */
export async function requestAdvisory(o: AdvisoryRequest) {
  // Detach all data before the first await. The only retained live reference is the intended abort/HTTP boundary.
  o = { ...o, grant: structuredClone(o.grant), snapshot: structuredClone(o.snapshot), policy: structuredClone(o.policy), controls: structuredClone(o.controls) };
  // Do not discover credentials/configuration from the environment or let SDK logging/proxies select another request context.
  validateAdvisoryEnvironment(Object.keys(process.env));
  const grant = validateDiagnosisGrant(o.grant), worker = ownerOf(process.pid);
  const manifest = validateRuntimeBundle(o.runtimeRoot);
  if (realpathSync(o.runtimeRoot) !== realpathSync(dirname(fileURLToPath(import.meta.url))) || manifest.id !== grant.runtime
    || manifest.dependencies !== grant.dependencies || worker.pid !== grant.owner.pid || worker.start !== grant.owner.start
    || typeof o.apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]+$/.test(o.apiKey) || o.signal?.aborted)
    throw Error('Advisory held: selected bundle, explicit auth, exact registered worker and live request required');
  const snapshot = validateAdvisoryInput(o.snapshot, grant);
  const retained = readSupervisor(o.stateDir, grant.project), key = supervisorHash(grant.invocationId);
  if (retained.advisory?.workers[key]?.grant.id !== grant.id || retained.advisory?.sends[key])
    throw Error('Advisory held: unregistered or already consumed grant');
  const history = Object.values(retained.diagnostics ?? {}).map(d => ({ id: d.id, basisHash: d.basisHash,
    outcome: d.outcome, rationale: d.reason, reference: d.inputRef }));
  const systemBytes = readFileSync(join(o.runtimeRoot, 'prompt.supervisor.md'));
  if (sha(systemBytes) !== manifest.files.find(f => f.path === 'prompt.supervisor.md')?.sha256)
    throw Error('Advisory held: selected prompt bytes changed');
  const system = new TextDecoder('utf-8', { fatal: true }).decode(systemBytes);
  const user = JSON.stringify({ ...diagnosisContext(snapshot, grant.incidentId, history), basisHash: grant.basis });
  // Bound resources never depend on local text estimation. The provider rejects oversize complete input without truncating it.
  const temporary = mkdtempSync(join(tmpdir(), 'factory-advisory-provider-'));
  try {
    const { stream, model } = await pinnedProvider(o.runtimeRoot, temporary);
    let attempted = false, authorization: ReturnType<typeof authorizeAdvisorySend> | null = null;
    let terminal: unknown = null, terminalProblem: string | null = null, response: { status: number; requestId: string | null } | null = null;
    const network = o.fetch ?? globalThis.fetch;
    const transport: typeof globalThis.fetch = async (url, init) => {
      if (attempted) throw Error('Advisory held: one transport attempt already consumed');
      attempted = true; // Even an invalid or ambiguous attempt may never become a replacement request.
      if (String(url) !== ADVISORY_PROFILE.endpoint || init?.method !== 'POST' || typeof init.body !== 'string' || o.signal?.aborted)
        throw Error('Advisory held: unsupported final transport');
      validateAdvisoryPayload(JSON.parse(init.body), system, user);
      const final = validateRuntimeBundle(o.runtimeRoot);
      if (final.id !== grant.runtime || final.dependencies !== grant.dependencies) throw Error('Advisory held: runtime changed before authorization');
      const observation = o.observe ? await o.observe() : { snapshot, policy: o.policy, controls: o.controls };
      validateAdvisoryInput(observation.snapshot, grant);
      if (supervisorHash(observation.policy) !== supervisorHash(o.policy) || o.signal?.aborted || Date.now() >= Date.parse(grant.deadline))
        throw Error('Advisory held: current host policy/deadline changed');
      const observedRuntime = validateRuntimeBundle(o.runtimeRoot);
      if (observedRuntime.id !== grant.runtime || observedRuntime.dependencies !== grant.dependencies)
        throw Error('Advisory held: runtime changed during current observation');
      const current = readSupervisor(o.stateDir, grant.project);
      authorization = authorizeAdvisorySend(o.stateDir, grant.project, current.revision, { at: new Date().toISOString(),
        grantId: grant.id, reservationId: grant.invocationId, fence: grant.fence, worker, payload: sha(init.body), policy: observation.policy, controls: observation.controls });
      // No network under the journal lock. Authorization-first remains owned in-flight if stop now commits.
      return network(url, { ...init, redirect: 'error' });
    };
    const result = await stream(model, { messages: [{ role: 'system', content: system, timestamp: 0 },
      { role: 'user', content: user, timestamp: 0 }] }, {
      apiKey: o.apiKey, env: {}, maxTokens: ADVISORY_PROFILE.output, reasoningEffort: 'high', cacheRetention: 'none',
      maxRetries: 0, serviceTier: 'default', signal: o.signal, timeoutMs: Math.max(1, Math.min(600_000, Date.parse(grant.deadline) - Date.now())), fetch: transport,
      onPayload(value: any) {
        value.truncation = 'disabled';
        // Pi leaves own undefined cache-key/retention properties; validate the exact JSON wire object, not JS-only keys.
        const wire = JSON.parse(JSON.stringify(value)); validateAdvisoryPayload(wire, system, user); return wire;
      },
      onResponse(value: any) { response = { status: value.status, requestId: value.headers['x-request-id'] ?? null }; },
      onProviderStreamEvent(value: any) {
        if (['response.completed','response.incomplete','response.failed'].includes(value.type)) {
          if (terminal !== null || JSON.stringify(value).length > 1_000_000) {
            terminalProblem = 'ambiguous/oversize terminal evidence'; throw Error(`Advisory held: ${terminalProblem}`);
          }
          terminal = structuredClone(value); // Captured before Pi's normalized/default-zero counters; T03 owns durable accounting.
        }
      },
    }).result();
    // Complete selected dependency identity is checked on both sides; an altered runtime cannot yield usable adapter evidence.
    const after = validateRuntimeBundle(o.runtimeRoot);
    if (after.id !== grant.runtime || after.dependencies !== grant.dependencies) throw Error('Advisory held: selected runtime changed');
    return { authorization, response, terminal, terminalProblem, result };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

/** Validate the complete serialized payload against the exact text supplied by the trusted caller.
 * The context window bound is a provider admission premise, not a local token estimate. */
export function validateAdvisoryPayload(value: unknown, system: string, user: string): void {
  const expected = {
    model: ADVISORY_PROFILE.model,
    input: [
      { role: 'developer', content: system },
      { role: 'user', content: [{ type: 'input_text', text: user }] },
      { type: 'configuration_update', reasoning: { effort: 'high' } },
    ],
    stream: true,
    prompt_cache_options: { mode: 'explicit' },
    store: false,
    max_output_tokens: ADVISORY_PROFILE.output,
    service_tier: 'default',
    reasoning: { effort: 'medium', summary: 'auto' },
    include: ['reasoning.encrypted_content'],
    truncation: 'disabled',
  };
  if (typeof system !== 'string' || !system || typeof user !== 'string' || !user)
    throw Error('Advisory held: complete text input required');
  // Canonical structural comparison rejects extra fields, tools, cache marks and continuations.
  const canonical = (item: any): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    return `{${Object.keys(item).sort().map(k => `${JSON.stringify(k)}:${canonical(item[k])}`).join(',')}}`;
  };
  if (canonical(value) !== canonical(expected)) throw Error('Advisory held: unsupported serialized request');
}
