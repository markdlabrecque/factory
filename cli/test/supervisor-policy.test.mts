// Pure host broker matrix using synthetic retained input, no worker, filesystem, tracker or paid launch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokerSupervisor } from '../src/supervisor-policy.mts';
import type { BrokerFacts } from '../src/supervisor-policy.mts';
import { emptyRecovery } from '../src/recovery-state.mts';
import { emptySupervisor, transitionSupervisor, incidentIdentity } from '../src/supervisor-state.mts';
import { diagnosisBasis } from '../../orchestrator/supervisor.mts';
import type { DiagnosisAction, DiagnosisDecision, Diagnostic } from '../../orchestrator/supervisor.mts';
import { supervisorHash, proposalIdentity, validateHumanRequest } from '../../orchestrator/supervisor-contract.mts';
import { supervisorFixture, AT } from './supervisor-fixture.mts';
const clock = Date.parse(AT);
function fixture(action: DiagnosisAction = { kind: 'request-repair', ticket: 236, runId: 'run-a', expectation: 'fresh preparation' }) {
  const a = supervisorFixture(); a.snapshot.mode = 'act';
  const incidentId = incidentIdentity(a.snapshot.project, a.facts);
  const state = transitionSupervisor(emptySupervisor(a.snapshot.project), { id: 'observe', at: AT, kind: 'observe', facts: a.facts,
    snapshotHash: supervisorHash(a.snapshot), reason: 'fixture' }, { ownerState: () => 'dead' });
  const decision: DiagnosisDecision = { version: 1, incidentId, basisHash: diagnosisBasis(a.snapshot), classification: 'problem', rationale: 'saved stopped work', alternatives: ['ask operator'], action };
  const body: Omit<Diagnostic, 'id'> = { reservationId: 'invocation', incidentId, basisHash: decision.basisHash, snapshotHash: supervisorHash(a.snapshot), fence: 'old-diagnosis-fence',
    startedAt: AT, completedAt: AT, inputRef: '/fixture/host/input.json', outcome: 'proposed', reason: 'retained', stdout: '', stderr: '', decision };
  const d = { ...body, id: supervisorHash(body) }; state.diagnostics = { [d.id]: d };
  const facts: BrokerFacts = { snapshot: a.snapshot, state, diagnosticId: d.id, enabled: true, registered: true, global: 'on', project: 'enabled',
    activationAuthorized: true, escalationBridgeReady: true, recovery: emptyRecovery(a.snapshot.project.root), fence: 'current-host-fence', expiresAt: new Date(clock + 1000).toISOString(),
    run: { ticket: 236, runId: 'run-a', state: 'stopped', ci: 'none' } };
  return { facts, decide: () => brokerSupervisor(() => facts, () => clock) };
}
test('repair is stable advisory identity only; current-time fence cannot authorize after a late change', () => {
  const f = fixture(), before = structuredClone(f.facts);
  const a = f.decide(), b = f.decide(); assert.equal(a.state, 'candidate'); assert.equal(b.state, 'candidate');
  if (a.state !== 'candidate' || b.state !== 'candidate') return;
  assert.equal(a.candidate.id, b.candidate.id); assert.ok(a.candidate.authorize()); assert.deepEqual(f.facts, before, 'broker does not write host/model records');
  f.facts.recovery!.preparation = { at: AT, ticket: 236, state: 'ready', code: 'ready', reason: 'current preparation', scope: 'ticket' };
  f.facts.recovery!.followups = { '236': { state: 'pending', reason: 'observation', nextAction: 'prepare', changedAt: AT } };
  f.facts.snapshot.observedAt = new Date(clock + 1).toISOString();
  assert.ok(a.candidate.authorize(), 'successful preparation/follow-up publication and later observation do not revoke unchanged material authority');
  f.facts.project = 'paused'; assert.equal(a.candidate.authorize(), false);
  f.facts.project = 'enabled'; f.facts.fence = 'replaced'; assert.equal(a.candidate.authorize(), false);
  const expired = brokerSupervisor(() => before, () => clock + 1000); assert.equal(expired.state, 'held');
});
for (const [name, mutate, expected] of [
  ['disabled', (f: BrokerFacts) => { f.enabled = false; }, 'held'],
  ['observe', (f: BrokerFacts) => { f.snapshot.mode = 'observe'; }, 'held'],
  ['stopped', (f: BrokerFacts) => { f.snapshot.mode = 'stopped'; }, 'held'],
  ['off', (f: BrokerFacts) => { f.global = 'off'; }, 'held'],
  ['unknown', (f: BrokerFacts) => { f.global = 'unknown'; }, 'held'],
  ['paused', (f: BrokerFacts) => { f.project = 'paused'; }, 'held'],
  ['missing bridge', (f: BrokerFacts) => { f.escalationBridgeReady = false; }, 'held'],
  ['no activation', (f: BrokerFacts) => { f.activationAuthorized = false; }, 'held'],
  ['active', (f: BrokerFacts) => { f.run.state = 'active'; }, 'refused'],
  ['foreign run', (f: BrokerFacts) => { f.run.runId = 'other'; }, 'refused'],
  ['unknown accounting', (f: BrokerFacts) => { f.recovery = null; }, 'held'],
  ['automatic already charged', (f: BrokerFacts) => { f.recovery!.nextSeq = 2; f.recovery!.attempts = [{ seq: 1, episode: 'jam', result: 'failed', id: 'existing', ticket: 236, startedAt: AT }]; }, 'held'],
  ['earlier-start later-admission cannot infer replay authority', (f: BrokerFacts) => { f.recovery!.nextSeq = 2; f.recovery!.attempts = [{ seq: 1, episode: 'jam', result: 'failed', id: 'automatic', ticket: 236, startedAt: new Date(clock - 60000).toISOString() }]; }, 'held'],
  ['truncated history', (f: BrokerFacts) => { f.recovery!.nextSeq = 101; }, 'held'],
  ['spent budget', (f: BrokerFacts) => { f.recovery!.budgets['236'] = { used: 2 }; }, 'held'],
  ['unknown CI', (f: BrokerFacts) => { f.run.ci = 'unknown'; }, 'held'],
  ['CI wait', (f: BrokerFacts) => { f.run.ci = 'waiting'; }, 'wait'],
  ['stale material', (f: BrokerFacts) => { f.snapshot.material.tip = 'c'.repeat(40); }, 'held'],
  ['denial', (f: BrokerFacts) => { Object.values(f.state.incidents)[0].denied = true; }, 'held'],
  ['superseded', (f: BrokerFacts) => { Object.values(f.state.incidents)[0].superseded = true; }, 'held'],
] as const) test(`host ${name} cannot become a repair launch`, () => { const f = fixture(); mutate(f.facts); assert.equal(f.decide().state, expected); });
test('wait and scoped follow-up remain data; failed CI alone is not branch modification authority', () => {
  assert.equal(fixture({ kind: 'wait', expectation: 'existing CI completes' }).decide().state, 'wait');
  const f = fixture({ kind: 'follow-up-draft', title: 'Clarify requirement', body: 'Proposed requirements, labels and dependencies need human approval' });
  f.facts.run.ci = 'failed'; const draft = f.decide(); assert.equal(draft.state, 'draft');
  if (draft.state === 'draft') assert.equal(draft.approval, 'human-required');
  const repair = fixture(); repair.facts.run.ci = 'failed'; assert.equal(repair.decide().state, 'candidate');
  repair.facts.run.state = 'merged'; assert.equal(repair.decide().state, 'refused');
});
test('gate amendments are refused by this broker, even with a structurally valid exact proposal', () => {
  const f = fixture(); const old = f.facts.state.diagnostics![f.facts.diagnosticId];
  const p = { version: 1 as const, incidentId: old.incidentId, snapshotHash: supervisorHash(f.facts.snapshot), project: f.facts.snapshot.project, scope: f.facts.snapshot.scope,
    change: { category: 'verification-command-substitution' as const, path: 'TESTING.md', before: 'old', after: 'equivalent', owner: { ticket: 236, runId: 'run-a' }, expiresAt: new Date(clock + 1000).toISOString() },
    rationale: 'Equivalent evidence', alternatives: ['Fix mechanism'], risks: ['Independent review required'] };
  const { id: _id, ...body } = old;
  body.decision = { ...body.decision!, action: { kind: 'gate-change', proposal: { ...p, id: proposalIdentity(p) } } };
  const d = { ...body, id: supervisorHash(body) }; f.facts.diagnosticId = d.id; f.facts.state.diagnostics = { [d.id]: d };
  assert.equal(f.decide().state, 'refused');
});
test('escalation is pending request, never delivered notification or resumption; no observe writes', () => {
  const f = fixture({ kind: 'escalate', question: 'Which exact lawful step?', nextAction: 'Inspect original evidence and resolve locally', factoryWide: true });
  const out = f.decide(); assert.equal(out.state, 'human-required');
  if (out.state === 'human-required') { validateHumanRequest(out.request); assert.equal(out.request.delivery.state, 'pending'); assert.equal(out.request.stop, 'required'); }
  assert.deepEqual(f.facts.state.humans, {}, 'caller must durably persist stop before bridge delivery; pure return is not delivery');
  f.facts.snapshot.mode = 'observe'; assert.equal(f.decide().state, 'held');
});
