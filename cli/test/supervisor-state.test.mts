// Pure supervisor policy matrices and one disposable filesystem/crash boundary. No workers or external services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ownerOf } from '../../board/admission.mts';
import { supervisorHash, proposalIdentity } from '../../orchestrator/supervisor-contract.mts';
import type { Proposal, IndependentReview, Intent, HumanRequest } from '../../orchestrator/supervisor-contract.mts';
import { emptySupervisor, incidentIdentity, transitionSupervisor, validateSupervisor, readSupervisor, commitSupervisor, supervisorFile, HISTORY_LIMIT } from '../src/supervisor-state.mts';
import type { SupervisorState, Event, Reservation, Limits } from '../src/supervisor-state.mts';

const h = 'a'.repeat(64), at = '2026-11-17T12:00:00.000Z';
const project = { root: '/fixture/project', tracker: { kind: 'github' as const, host: 'github.com', project: 'owner/repo' } };
const owner = { pid: 123, start: 'fixture:start-a' };
const facts = { scope: { kind: 'ticket' as const, ticket: 233 }, requirements: h, gate: h, runId: 'run-a', failure: h };
const iid = incidentIdentity(project, facts);
const observation: Event = { id: 'observe', at, kind: 'observe', facts, snapshotHash: h, reason: 'Gate failed; saved evidence remains original' };
const limits: Limits = { project: { tokens: 1000, cost: 1000 }, shared: { tokens: 2000, cost: 2000 }, capacity: 2, reviewCalls: 1, reviewTimeoutMs: 600_000 };
const apply = (s: SupervisorState, e: Event, status: 'alive' | 'dead' | 'unknown' = 'alive', peers?: SupervisorState[]) => transitionSupervisor(s, e, { ownerState: () => status, projects: peers });
const initial = () => apply(emptySupervisor(project), observation);
function reservation(id = 'call-1', kind: 'diagnosis' | 'review' = 'diagnosis'): Reservation {
  return { id, incidentId: iid, kind, owner, fence: `fence:${id}`, at, deadline: '2026-11-17T12:10:00.000Z', reserved: { tokens: 100, cost: 100 }, actual: null, state: 'active', reviewId: null };
}
const reserve = (r = reservation(), l = limits): Event => ({ id: `reserve:${r.id}`, at, kind: 'reserve', reservation: r, limits: l });
const finish = (r = reservation()): Event => ({ id: `finish:${r.id}`, at, kind: 'finish', reservationId: r.id, fence: r.fence, owner: r.owner, actual: { tokens: 5, cost: 5 } });
function proposal(): Proposal {
  const body: Omit<Proposal, 'id'> = { version: 1, project, scope: facts.scope, incidentId: iid, snapshotHash: h,
    change: { category: 'verification-command-substitution', path: 'TESTING.md', before: 'original', after: 'equivalent', owner: { ticket: 233, runId: 'run-a' }, expiresAt: '2026-11-17T13:00:00.000Z' },
    rationale: 'Equivalent offline command', alternatives: ['Fix original command'], risks: ['Equivalence requires independent evidence'] };
  return { ...body, id: proposalIdentity(body) };
}
function withProposal() { const p = proposal(); return apply(initial(), { id: 'proposal', at, kind: 'proposal', proposal: p }); }
function review(disposition: IndependentReview['disposition'] = 'deny'): IndependentReview {
  return { version: 1, id: 'review-a', inputHash: h, proposalId: proposal().id, invocationId: 'review-call', reviewer: 'independent', model: 'fixed-large', startedAt: at, completedAt: at, disposition, reason: 'Original command should be repaired' };
}
function denied() {
  const r = reservation('review-call', 'review');
  let s = apply(withProposal(), reserve(r));
  s = apply(s, { id: 'review', at, kind: 'review', review: review(), reservationId: r.id, fence: r.fence, owner });
  return apply(s, finish(r));
}
function human(): HumanRequest {
  return { version: 1, id: 'human-a', project, scope: facts.scope, incidentId: iid, proposalId: proposal().id, reason: 'review-denied', question: 'Repair original command?', evidence: ['host:review-a'], nextAction: 'Inspect denial; authenticated operator decision required', delivery: { state: 'pending', attempts: 0 }, stop: 'required' };
}
function intent(): Intent {
  return { version: 1, id: 'intent-a', project, scope: facts.scope, incidentId: iid, proposalId: proposal().id, reviewId: 'review-a', inputHash: h, runId: 'run-a', fence: 'intent-fence', expiresAt: '2026-11-17T13:00:00.000Z', state: 'proposed' };
}

test('stable facts, not observation prose/time, identify incidents; exact event replay is idempotent', () => {
  const s = initial(); assert.equal(apply(s, observation), s);
  const again = apply(s, { ...observation, id: 'observe-again', at: '2026-11-17T12:01:00.000Z', reason: 'Rephrased diagnosis', snapshotHash: 'b'.repeat(64) });
  assert.equal(Object.keys(again.incidents).length, 1); assert.deepEqual(again.incidents, s.incidents);
  assert.throws(() => apply(s, { ...observation, reason: 'different event bytes' }), /reused/);
  for (const field of ['requirements','gate','failure','runId'] as const) assert.notEqual(incidentIdentity(project, { ...facts, [field]: field === 'runId' ? 'run-b' : 'b'.repeat(64) }), iid);
  assert.notEqual(incidentIdentity(project, { ...facts, scope: { kind: 'project' } }), iid);
  assert.equal(s.revision, 1);
});

test('two diagnosis calls survive restart/history truncation; actual usage never refunds reserved budget', () => {
  let s = initial();
  for (const id of ['call-1','call-2']) { const r = reservation(id); s = apply(s, reserve(r)); s = apply(s, finish(r)); }
  for (let n = 0; n < HISTORY_LIMIT + 5; n++) s = apply(s, { ...observation, id: `repeat:${n}` });
  s = validateSupervisor(JSON.parse(JSON.stringify(s)), project);
  assert.equal(s.history.length, HISTORY_LIMIT); assert.equal(s.incidents[iid].incident.diagnosisCalls, 2);
  assert.deepEqual(s.charged.diagnosis, { tokens: 200, cost: 200 });
  assert.throws(() => apply(s, reserve(reservation('call-3'))), /call budget/);
  assert.equal(apply(s, reserve()), s); // Old event identity remains after bounded display eviction.
});

test('review resources are distinct, finite and never form a free review loop', () => {
  let s = initial();
  for (const id of ['d1','d2']) { const r = reservation(id); s = apply(s, reserve(r)); s = apply(s, finish(r)); }
  const r = reservation('review-1', 'review'); s = apply(s, reserve(r)); s = apply(s, finish(r));
  assert.deepEqual(s.charged.review, { tokens: 100, cost: 100 });
  assert.throws(() => apply(s, reserve(reservation('review-2', 'review'))), /call budget/);
  assert.equal(s.incidents[iid].incident.diagnosisCalls, 2);
});

test('finite project/shared ceilings, one project decision, capacity and ten-minute deadline hold before charge', () => {
  const s = initial(), active = apply(s, reserve());
  assert.throws(() => apply(active, reserve(reservation('other'))), /unsettled/);
  for (const bad of [0, -1, Infinity, NaN, undefined]) {
    assert.throws(() => apply(s, reserve(reservation(), { ...limits, project: { tokens: bad as number, cost: 1000 } })), /finite|budget|not JSON/);
  }
  assert.throws(() => apply(s, reserve(reservation(), { ...limits, project: { tokens: 99, cost: 1000 } })), /budget/);
  assert.throws(() => apply(s, reserve(reservation(), { ...limits, shared: { tokens: 1000, cost: 99 } })), /budget/);
  assert.throws(() => apply(s, reserve({ ...reservation(), deadline: '2026-11-17T12:10:00.001Z' })), /deadline/);
  const peerProject = { ...project, root: '/fixture/peer' };
  const peerFacts = { ...facts }; const peerId = incidentIdentity(peerProject, peerFacts);
  let peer = apply(emptySupervisor(peerProject), { ...observation, facts: peerFacts });
  peer = apply(peer, reserve({ ...reservation('peer'), incidentId: peerId }));
  assert.throws(() => apply(s, { ...observation, id: 'unknown-peer-owner' }, 'unknown', [peer, s]), /unknown worker/);
  assert.throws(() => apply(s, reserve(reservation(), { ...limits, capacity: 1 }), 'alive', [peer, s]), /capacity/);
  assert.throws(() => apply(s, reserve(reservation(), { ...limits, shared: { tokens: 199, cost: 1000 } }), 'alive', [peer, s]), /budget/);
  assert.deepEqual(s.charged.diagnosis, { tokens: 0, cost: 0 });
});

test('PID/start identity, fence and expiry reject late completions; crash uncertainty retains charges/capacity', () => {
  const s = apply(initial(), reserve());
  for (const patch of [{ fence: 'stale' }, { owner: { ...owner, start: 'reused-pid' } }, { at: '2026-11-17T12:10:00.000Z' }]) assert.throws(() => apply(s, { ...finish(), ...patch }), /stale/);
  assert.throws(() => apply(s, finish(), 'dead'), /owner/);
  assert.throws(() => apply(s, { ...observation, id: 'unknown-observation' }, 'unknown'), /unknown/);
  const e: Event = { id: 'crash', at, kind: 'reconcile-worker', reservationId: 'call-1' };
  assert.throws(() => apply(s, e, 'alive'), /owner/);
  const crashed = apply(s, e, 'dead');
  assert.equal(crashed.reservations[supervisorHash('call-1')].state, 'ambiguous');
  assert.deepEqual(crashed.charged, s.charged);
  assert.throws(() => apply(crashed, reserve(reservation('after-crash'))), /unsettled/);
});

test('denial persists across rephrasing, new facts and restart; one pending human request never auto-notifies', () => {
  let s = denied(); assert.equal(s.incidents[iid].denied, true);
  s = apply(s, { id: 'human', at, kind: 'human', request: human() });
  s = apply(s, { id: 'human-rephrase', at, kind: 'human', request: { ...human(), id: 'another', question: 'Try a different reviewer?' } });
  assert.equal(s.humans[iid].id, 'human-a'); assert.equal(s.humans[iid].delivery.state, 'pending');
  const changed = { ...facts, requirements: 'b'.repeat(64) };
  s = apply(s, { ...observation, id: 'material-change', facts: changed });
  s = validateSupervisor(JSON.parse(JSON.stringify(s)), project);
  assert.equal(s.incidents[iid].superseded, true); assert.equal(s.incidents[iid].denied, true);
  assert.throws(() => apply(s, reserve({ ...reservation('new-facts'), incidentId: incidentIdentity(project, changed) })), /human-held/);
  assert.throws(() => apply(s, { id: 'notify-claim', at, kind: 'human', request: { ...human(), delivery: { state: 'notified', attempts: 1, channel: 'invented', receipt: 'fake', notifiedAt: at } } }), /no notification/);
  assert.throws(() => apply(denied(), reserve(reservation('review-again', 'review'))), /human-held/);
});

test('in-flight denial is retained even when changed facts supersede its incident first', () => {
  const r = reservation('review-call', 'review');
  let s = apply(withProposal(), reserve(r));
  const changed = { ...facts, failure: 'b'.repeat(64) };
  s = apply(s, { ...observation, id: 'supersede-before-result', facts: changed });
  s = apply(s, { id: 'late-denial', at, kind: 'review', review: review(), reservationId: r.id, fence: r.fence, owner });
  s = apply(s, finish(r));
  assert.equal(s.incidents[iid].superseded, true); assert.equal(s.incidents[iid].denied, true);
  assert.equal(s.reviews[supervisorHash('review-a')].disposition, 'deny');
  assert.throws(() => apply(s, reserve({ ...reservation('new-incident'), incidentId: incidentIdentity(project, changed) })), /human-held/);
});

test('a review reservation binds exactly one invocation/result; replay remains idempotent', () => {
  const r = reservation('review-call', 'review'); let s = apply(withProposal(), reserve(r));
  const e: Event = { id: 'review-result', at, kind: 'review', review: review('inconclusive'), reservationId: r.id, fence: r.fence, owner };
  assert.throws(() => apply(s, { ...e, review: { ...review(), invocationId: 'unreserved-worker' } }), /reservation/);
  s = apply(s, e); assert.equal(apply(s, e), s);
  assert.throws(() => apply(s, { ...e, id: 'another-result', review: { ...review('approve'), id: 'review-b' } }), /consumed/);
  assert.deepEqual(s.charged.review, { tokens: 100, cost: 100 });
  s = apply(s, finish(r)); assert.equal(s.reservations[supervisorHash(r.id)].reviewId, 'review-a');
});

test('material supersession never resurrects old incidents or spent budgets', () => {
  let s = apply(initial(), reserve()); s = apply(s, finish());
  s = apply(s, { ...observation, id: 'changed', facts: { ...facts, failure: 'b'.repeat(64) } });
  s = apply(s, { ...observation, id: 'old-facts-return' });
  assert.equal(s.incidents[iid].superseded, true); assert.equal(s.incidents[iid].incident.diagnosisCalls, 1);
  assert.throws(() => apply(s, reserve(reservation('retry-old'))), /superseded/);
});

test('Factory-wide classification holds new decisions without approving or starting a reviewer', () => {
  const p = proposal(); p.change.category = 'factory-policy'; const { id, ...body } = p; p.id = proposalIdentity(body);
  const s = apply(initial(), { id: 'factory-wide', at, kind: 'proposal', proposal: p });
  assert.equal(s.incidents[iid].incident.state, 'human-required');
  assert.throws(() => apply(s, reserve(reservation('review', 'review'))), /human-held/);
});

test('intent must be durable inert proposal before observation; reconciliation never executes/replays or grants authority', () => {
  const event: Event = { id: 'intent', at, kind: 'intent', intent: intent(), owner };
  const s = apply(withProposal(), event);
  assert.equal(apply(s, event), s);
  assert.throws(() => apply(s, { ...event, id: 'replay-effect' }), /already exists/);
  assert.throws(() => apply(withProposal(), { ...event, intent: { ...intent(), state: 'authorized' } }), /inert/);
  const reconcile: Event = { id: 'observe-effect', at, kind: 'reconcile-intent', intentId: intent().id, outcome: 'observed-applied', evidence: ['host:exact-preimage-and-current-bytes'] };
  assert.throws(() => apply(s, reconcile, 'unknown'), /unknown/);
  assert.throws(() => apply(s, reconcile, 'alive'), /owner/);
  const after = apply(s, reconcile, 'dead');
  assert.equal(after.intents[supervisorHash(intent().id)].intent.state, 'proposed');
  assert.equal(after.intents[supervisorHash(intent().id)].outcome, 'observed-applied');
  assert.equal(apply(after, reconcile, 'dead'), after);
  assert.throws(() => apply(after, { ...reconcile, id: 'repeat-with-other-id' }, 'dead'), /already reconciled/);
  assert.deepEqual(after.proposals, s.proposals);
});

test('strict schema rejects corruption, foreign identity, unknown owner and lost counters', () => {
  const s = apply(initial(), reserve());
  for (const mutate of [
    (x: any) => x.version = 2,
    (x: any) => x.project.root = '/foreign',
    (x: any) => x.extra = true,
    (x: any) => delete x.reservations[supervisorHash('call-1')].owner.start,
    (x: any) => x.charged.diagnosis.tokens = 0,
    (x: any) => x.incidents[iid].incident.diagnosisCalls = 0,
  ]) { const x = structuredClone(s); mutate(x); assert.throws(() => validateSupervisor(x, project)); }
});

test('filesystem boundary: durable restart, CAS race, corruption/foreign/unknown holds, crash before/after rename and replay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'supervisor-state-'));
  try {
    const savedWork = join(dir, 'saved-run-recovery-proof-evidence.fixture');
    writeFileSync(savedWork, 'Original run, attempt counters, receipt, proof and saved work must remain unchanged.');
    const savedWorkBytes = readFileSync(savedWork);
    assert.equal(readSupervisor(dir, project).revision, 0);
    let s = commitSupervisor(dir, project, 0, observation);
    const file = supervisorFile(dir);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const before = readFileSync(file, 'utf8');
    assert.throws(() => commitSupervisor(dir, project, 0, { ...observation, id: 'losing-writer' }), /CAS/);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.deepEqual(readSupervisor(dir, project), s);
    const realOwner = ownerOf(process.pid); assert.ok(realOwner.start);
    const r = { ...reservation(), owner: realOwner };
    s = commitSupervisor(dir, project, s.revision, reserve(r));
    assert.equal(commitSupervisor(dir, project, s.revision, reserve(r)).revision, s.revision);
    const saved = readFileSync(file, 'utf8');
    for (const corrupt of ['{broken', JSON.stringify({ version: 2, projects: {} }), saved.replace('/fixture/project', '/foreign'), saved.replace(realOwner.start!, '')]) {
      writeFileSync(file, corrupt);
      assert.throws(() => commitSupervisor(dir, project, s.revision, { ...observation, id: 'must-not-overwrite' }));
      assert.equal(readFileSync(file, 'utf8'), corrupt);
    }
    writeFileSync(file, saved);
    s = commitSupervisor(dir, project, s.revision, finish(r));
    const module = new URL('../src/supervisor-state.mts', import.meta.url).href;
    // Interrupt the actual durable writer immediately before/after its atomic rename; stale lock is reclaimed by PID/start.
    for (const stage of ['before','after']) {
      const crashReservation = { ...reservation(`crash:${stage}`), owner: realOwner,
        incidentId: stage === 'before' ? iid : incidentIdentity(project, { ...facts, failure: 'b'.repeat(64) }) };
      const e: Event = reserve(crashReservation);
      const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
        const original = fs.renameSync; fs.renameSync = (a,b) => { if (b === ${JSON.stringify(file)}) { if (${JSON.stringify(stage)} === 'before') process.exit(71); original(a,b); process.exit(72); } return original(a,b); }; syncBuiltinESMExports();
        const {commitSupervisor} = await import(${JSON.stringify(module)}); commitSupervisor(${JSON.stringify(dir)}, ${JSON.stringify(project)}, ${s.revision}, ${JSON.stringify(e)});`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
      assert.equal(child.status, stage === 'before' ? 71 : 72, child.stderr);
      const restarted = readSupervisor(dir, project);
      assert.equal(restarted.revision, s.revision + (stage === 'after' ? 1 : 0));
      s = commitSupervisor(dir, project, restarted.revision, e);
      assert.equal(commitSupervisor(dir, project, s.revision, e).revision, s.revision);
      assert.deepEqual(s.charged.diagnosis, { tokens: stage === 'before' ? 200 : 300, cost: stage === 'before' ? 200 : 300 });
      s = commitSupervisor(dir, project, s.revision, finish(crashReservation));
      // Use a fresh project/incident for the second crash; the two-call limit is never reset.
      if (stage === 'before') {
        s = commitSupervisor(dir, project, s.revision, { ...observation, id: 'new-crash-incident', facts: { ...facts, failure: 'b'.repeat(64) } });
      }
    }
    assert.deepEqual(readSupervisor(dir, project).incidents[iid].incident.diagnosisCalls, 2);
    // Unreadable/unknown lock ownership is never taken over by age and cannot change the journal.
    const lock = join(dir, 'supervisor', 'admission', 'lock'); writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    const frozen = readFileSync(file, 'utf8');
    assert.throws(() => commitSupervisor(dir, project, s.revision, { ...observation, id: 'blocked-lock' }), /locked/);
    assert.equal(readFileSync(file, 'utf8'), frozen);
    rmSync(lock);
    const race = async (inputs: { project: typeof project; revision: number; event: Event }[]) => {
      const children = inputs.map(input => {
        const script = `const {commitSupervisor} = await import(${JSON.stringify(module)});
          const {ownerOf} = await import(${JSON.stringify(new URL('../../board/admission.mts', import.meta.url).href)});
          const input = ${JSON.stringify(input)};
          if (input.event.kind === 'reserve') input.event.reservation.owner = ownerOf(process.pid);
          process.once('message', () => { try { commitSupervisor(${JSON.stringify(dir)}, input.project, input.revision, input.event); process.exit(0); } catch(e) { console.error(e.message); process.exit(2); } }); process.send('ready');`;
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore','ignore','pipe','ipc'] });
        let stderr = ''; child.stderr!.on('data', b => stderr += b);
        const done = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve({ code, stderr })); });
        const ready = new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); child.once('exit', () => reject(Error('writer exited before barrier'))); });
        return { child, ready, done };
      });
      await Promise.all(children.map(x => x.ready)); children.forEach(x => x.child.send('start'));
      const results = await Promise.all(children.map(x => x.done));
      assert.deepEqual(results.map(x => x.code).sort(), [0, 2], JSON.stringify(results));
      return results;
    };
    const sameProject = { ...project, root: '/fixture/race' };
    const sameResults = await race(['a','b'].map(id => ({ project: sameProject, revision: 0, event: { ...observation, id: `racer:${id}` } })));
    assert.match(sameResults.find(x => x.code === 2)!.stderr, /CAS|locked/);
    assert.equal(readSupervisor(dir, sameProject).revision, 1);
    const peers = ['/fixture/capacity-a','/fixture/capacity-b'].map(root => ({ ...project, root }));
    peers.forEach(p => commitSupervisor(dir, p, 0, observation));
    const capacityResults = await race(peers.map((p, i) => ({ project: p, revision: 1,
      event: reserve({ ...reservation(`capacity:${i}`), incidentId: incidentIdentity(p, facts) }, { ...limits, capacity: 1 }) })));
    assert.match(capacityResults.find(x => x.code === 2)!.stderr, /capacity|locked/);
    const records = peers.map(p => readSupervisor(dir, p));
    assert.equal(records.reduce((n, p) => n + p.charged.diagnosis.tokens, 0), 100);
    assert.equal(records.reduce((n, p) => n + Object.keys(p.reservations).length, 0), 1);
    assert.deepEqual(readFileSync(savedWork), savedWorkBytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
