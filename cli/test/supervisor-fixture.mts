// Synthetic frozen diagnosis input shared by pure proposal and stubbed worker tests. Never reads local project context.
import { sourceHash } from '../../orchestrator/supervisor-contract.mts';
import type { Snapshot } from '../../orchestrator/supervisor-contract.mts';
import type { DiagnosisAuthorization } from '../src/supervisor-worker.mts';
export const AT = '2026-11-17T12:00:00.000Z';
export const HASH = 'a'.repeat(64);
export function supervisorFixture(root = '/fixture/project'): DiagnosisAuthorization {
  const snapshot: Snapshot = {
    version: 1, project: { root, tracker: { kind: 'github', host: 'github.com', project: 'owner/repo' } }, scope: { kind: 'ticket', ticket: 236 },
    observedAt: AT, mode: 'observe', material: { runId: 'run-a', base: 'develop', baseline: 'b'.repeat(40), tip: 'b'.repeat(40),
      runtime: HASH, dependencies: HASH, policy: HASH, settings: HASH, ticketInput: HASH, admissionGeneration: 'generation-a' },
    projectGuidelines: ['Use equivalent offline evidence'], factoryConstraints: ['Never waive independent proof or exact-SHA delivery'],
    sources: (['child','parent','human-planning','guidelines','factory-rules','gate','failure','prior-decisions'] as const).map(role => ({
      role, locator: `fixture:${role}`, status: 'complete', text: `original ${role}`, sha256: sourceHash(`original ${role}`),
    })),
  };
  const budget = { maxTokens: 10000, maxCostUsd: 2, maxCalls: 10 };
  return { snapshot, facts: { scope: snapshot.scope, requirements: HASH, gate: HASH, runId: 'run-a', failure: HASH },
    family: 'openai', policy: { enabled: true, limits: { ...budget, diagnosis: { ...budget, timeoutSeconds: 30 }, review: { ...budget, timeoutSeconds: 30 } } },
    registered: true, globalAllowed: true, paused: false, outsideAdmissionLocks: true, shared: { tokens: 100000, cost: 10000000 }, capacity: 2 };
}
