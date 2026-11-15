// Pure projection checks use the existing versioned readiness contract, never tracker or log contents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readinessLines, scopedReadiness } from '../../board/readiness.mts';
import type { ReadinessReport } from '../../orchestrator/readiness.mts';
const at = '2026-11-15T12:00:00Z';
const check = (scope: any, id: string, status: any) => ({ id, scope, phase: 'active' as const, observedAt: at, status, required: true,
  operation: 'create', path: `/fixture project/${id}`, reason: 'Observed operation', nextActor: 'operator' as const,
  nextAction: 'Inspect create access', automaticRecheck: 'next-launch' as const });
const report: ReadinessReport = { version: 1, identity: { projectRoot: '/fixture project', runtimeIdentity: 'runtime', configIdentity: 'config', contextFingerprint: 'context' },
  owner: { invocationId: 'launch', ownerId: 'owner', generation: 'generation' }, observedAt: at, phase: 'active', status: 'blocked',
  checks: [check('project', 'checkout', 'ready'), check('ticket-input', 'input-one', 'blocked'), check('ticket-workspace', 'workspace-two', 'blocked')] };
test('multiple ticket holds do not turn the project into a failure or imply every ticket failed', () => {
  const read = { state: 'current' as const, report };
  const project = scopedReadiness(read, 'project');
  assert.ok('report' in project); assert.equal(project.report.status, 'ready');
  const input = scopedReadiness(read, 'ticket-input');
  assert.ok('report' in input); assert.equal(input.report.checks.length, 1); assert.equal(input.report.status, 'blocked');
  assert.doesNotMatch(readinessLines(project).join('\n'), /input-one|workspace-two/);
  assert.match(readinessLines(input).join('\n'), /input-one/);
});
test('stale ready is unknown, keeps observation identity, and gives a next-action policy', () => {
  const text = readinessLines(scopedReadiness({ state: 'stale', report }, 'project')).join('\n');
  assert.match(text, /unknown \(stale\)/); assert.match(text, /checked 2026-11-15/); assert.match(text, /runtime \/ config \/ context/);
  assert.match(text, /not launch authorization/); assert.match(text, /next-launch/);
});
