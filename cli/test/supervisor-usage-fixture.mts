// Synthetic raw provider metadata and exact grant/authorization identities shared by usage unit/filesystem fixtures. No provider/auth discovery.
import { diagnosisGrant, ADVISORY_PROFILE_ID, advisoryReservation } from '../src/supervisor-advisory-contract.mts';
import { hostAdvisoryPolicyIdentity } from '../src/supervisor-host-policy.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { incidentIdentity } from '../src/supervisor-state.mts';
import { captureProviderEvidence } from '../src/supervisor-openai-usage.mts';
export function usageFixture(worker = { pid: 124, start: 'worker' }, root = '/fixture/project') {
  const h = 'a'.repeat(64), at = new Date().toISOString();
  const project = { root, tracker: { kind: 'github' as const, host: 'github.com', project: 'owner/repo' } };
  const facts = { scope: { kind: 'ticket' as const, ticket: 7 }, requirements: h, gate: h, runId: 'run-1', failure: h }, incidentId = incidentIdentity(project,facts);
  const host = { version: 1 as const, enabled: true as const, profile: ADVISORY_PROFILE_ID, capacity: 1 as const,
    cumulative: { tokens: 10_000_000, cost: 100_000_000, calls: 10 } };
  const role = { maxTokens: 5_000_000, maxCostUsd: 50, maxCalls: 5, timeoutSeconds: 600 };
  const registration = { at, holdId: 'synthetic-exclusion-identity', host,
    project: { enabled: true, limits: { maxTokens: 10_000_000, maxCostUsd: 100, maxCalls: 10, diagnosis: role, review: role } } };
  const g = diagnosisGrant({ version: 1, project, ticket: 7, runId: facts.runId, attemptId: null, incidentId, basis: h,
    invocationId: 'invocation', fence: 'fence', holdId: registration.holdId, runtime: h, dependencies: h, profile: ADVISORY_PROFILE_ID,
    policy: hostAdvisoryPolicyIdentity(host), owner: worker, deadline: new Date(Date.parse(at) + 600_000).toISOString(), reserved: advisoryReservation() });
  const body = { version: 1 as const, grantId: g.id, invocationId: g.invocationId, fence: g.fence, worker, profile: g.profile, payload: h, at };
  const a = { ...body, receipt: supervisorHash(body) };
  const result = { authorization: a, response: { status: 200, requestId: 'req_unit' }, terminalProblem: null,
    result: { stopReason: 'stop', usage: { input: 999999, totalTokens: 999999 } },
    terminal: { type: 'response.completed', response: { id: 'resp_unit', model: 'gpt-6.1-terra', status: 'completed', service_tier: 'default',
      output: [{ text: 'Not a valid diagnosis; accounting does not grant advice authority.' }], usage: { input_tokens: 25,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 10,
        output_tokens_details: { reasoning_tokens: 8 }, total_tokens: 35 } } } };
  return { g, a, result, raw: captureProviderEvidence(result), facts, registration, at, h,
    controls: { registered: true, global: 'on' as const, projectControl: 'enabled' as const } };
}
