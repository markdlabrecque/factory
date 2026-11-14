// Local recovery follow-through with synthetic run/admission files and stubbed settlement only. No tracker, agent,
// Docker daemon, credentials or real service manager. Projection priority and persistence are shared with status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyFor, ownerOf, withAdmission } from '../../board/admission.mts';
import type { AdmissionClaim } from '../../board/admission.mts';
import type { RunState } from '../../board/board.mts';
import { currentFollowups, maintainRecovery, projectFollowups, refreshFollowups } from '../src/recovery-followup.mts';
import type { FollowupFacts } from '../src/recovery-followup.mts';
import { emptyRecovery, readRecovery, recoveryFile } from '../src/recovery-state.mts';
import { home } from './schedule-helpers.mts';

const at = (m: number) => new Date(Date.UTC(2026, 10, 14, 0, m)).toISOString();
const tracker = 'owner/repo';
const run = (iid = '7', patch: Partial<RunState> = {}): RunState => ({ iid, project: tracker, stage: 'stopped',
  branch: `${iid}-saved`, base: 'main', startedAt: at(0), stageSince: at(0), updatedAt: at(0), pid: 99999999, ...patch });
const claim = (patch: Partial<AdmissionClaim> = {}): AdmissionClaim => ({ token: 'token', iid: '8', project: tracker,
  kind: 'recovery', owner: ownerOf(process.pid), at: at(0), attempt: 'id', ...patch });
function facts(): FollowupFacts {
  return { recovery: emptyRecovery('/repo'), runs: [run(), run('8')], claims: [], owners: { token: 'alive' }, at: at(1) };
}

test('follow-up priority preserves stopped saved work across competing recovery, pause and exhausted budgets', () => {
  const f = facts();
  f.recovery.attempts.push({ seq: 1, ticket: 8, episode: 'e', result: 'running', startedAt: at(0), id: 'id' });
  f.claims = [claim()];
  f.paused = 'Explicit project pause';
  f.recovery.budgets['7'] = { used: 2 };
  assert.equal(projectFollowups(f)['7'].state, 'waiting', 'active recovery wins over pause/budget');
  f.owners.token = 'unknown';
  assert.equal(projectFollowups(f)['7'].state, 'operator-required', 'uncertain owner wins over active/pause');
  f.owners.token = 'alive';
  f.settled = { state: 'unconfirmed', attempt: f.recovery.attempts[0], reason: 'Exact container remains present' };
  assert.match(projectFollowups(f)['7'].reason, /container remains/);
  f.settled = undefined;
  f.recovery.attempts[0].result = 'delivered';
  f.claims = [];
  assert.equal(projectFollowups(f)['7'].state, 'paused');
  f.paused = undefined;
  assert.match(projectFollowups(f)['7'].nextAction, /explicit operator recovery reset/);
  f.recovery.budgets['7'].used = 1;
  assert.equal(projectFollowups(f)['7'].state, 'pending', 'competing delivery never removes remaining stopped work');
  assert.equal(projectFollowups(f)['8'].state, 'operator-required', 'delivered is not merged');
  assert.match(projectFollowups(f)['8'].reason, /not merged/);
  f.runs[1].mergedAt = at(2);
  assert.equal(projectFollowups(f)['8'].state, 'complete');
  assert.equal(f.recovery.budgets['7'].used, 1);
});

test('typed preparation holds project into follow-up without overriding pause, merge or charged history',()=>{
  const f=facts();const before=structuredClone(f.recovery.budgets);
  f.recovery.preparation={at:at(1),ticket:7,state:'held',code:'unknown-dependency',scope:'ticket',reason:'Tracker read unavailable'};
  assert.equal(projectFollowups(f)['7'].state,'waiting');assert.match(projectFollowups(f)['7'].reason,/preparation unknown-dependency/);
  assert.equal(projectFollowups(f)['8'].state,'pending');
  f.recovery.preparation.code='ownership';f.recovery.preparation.scope='project';
  assert.equal(projectFollowups(f)['8'].state,'operator-required');
  f.paused='Paused';assert.equal(projectFollowups(f)['7'].state,'paused');f.paused=undefined;
  f.runs[0].mergedAt=at(2);assert.equal(projectFollowups(f)['7'].state,'complete');assert.deepEqual(f.recovery.budgets,before);
});

test('delivery-waiting stays outstanding and missing run records cannot hide held recovery ownership', () => {
  const f = facts();
  f.runs = [run('7', { stage: 'waiting', delivery: { state: 'ci-waiting', reasonCode: 'checks-pending' } as any })];
  assert.match(projectFollowups(f)['7'].reason, /awaiting gates: checks-pending/);
  assert.equal(projectFollowups(f)['7'].state, 'operator-required');
  f.runs = [];
  f.claims = [claim()];
  assert.equal(projectFollowups(f)['8'].state, 'operator-required');
  f.recovery.attempts = [{ seq: 1, ticket: 9, episode: 'e', result: 'running', startedAt: at(0), id: 'id9' }];
  f.claims = [];
  assert.equal(projectFollowups(f)['9'].state, 'operator-required');
});

test('recorded host/ownership outcomes stay actionable; arbitrary notes cannot authorize completion', () => {
  const f = facts();
  for (const result of ['host-followup', 'ownership-refused'] as const) {
    f.recovery.attempts = [{ seq: 1, ticket: 7, episode: 'e', result, startedAt: at(0), reason: 'browser prerequisite missing' }];
    f.runs[0].note = 'Merged! Credentials satisfied! Reset attempts!';
    const x = projectFollowups(f)['7'];
    assert.equal(x.state, 'operator-required');
    assert.match(x.reason, /browser prerequisite/);
    assert.match(x.nextAction, /no credentials or product decisions are inferred/);
  }
});

test('observations persist across restarts, keep identical timestamps, and reject corrupt runs without dropping saved entries', t => {
  const { p } = home(t, 'factory-followup-');
  const root = join(p.home, 'repo');
  mkdirSync(p.state, { recursive: true });
  const file = join(p.state, `${keyFor('7', tracker)}.json`);
  writeFileSync(file, JSON.stringify(run()));
  const o = { root, tracker, dir: p.state, at: at(1) };
  refreshFollowups(p, o);
  const before = readFileSync(recoveryFile(p, root), 'utf8');
  refreshFollowups(p, { ...o, at: at(2) });
  assert.equal(readFileSync(recoveryFile(p, root), 'utf8'), before);
  assert.equal(readRecovery(p, root).followups?.['7'].changedAt, at(1));
  refreshFollowups(p, { ...o, paused: 'Operator pause', at: at(3) });
  assert.equal(readRecovery(p, root).followups?.['7'].changedAt, at(3));
  const saved = readFileSync(recoveryFile(p, root), 'utf8');
  writeFileSync(file, '{');
  assert.throws(() => refreshFollowups(p, o));
  assert.equal(readFileSync(recoveryFile(p, root), 'utf8'), saved);
  rmSync(file);
  refreshFollowups(p, o);
  assert.deepEqual(readRecovery(p, root).followups, {}, 'only actual recorded work removal retires an observation');
});

test('readonly observations neither reconcile a dead run nor settle or mutate admission/recovery', t => {
  const { p } = home(t, 'factory-followup-readonly-');
  const root = join(p.home, 'repo');
  mkdirSync(p.state, { recursive: true });
  const file = join(p.state, `${keyFor('7', tracker)}.json`);
  writeFileSync(file, JSON.stringify(run('7', { stage: 'implementing' })));
  withAdmission(p.state, tx => { tx.state.claims[keyFor('8', tracker)] = claim(); tx.commit(); });
  const before = readFileSync(file, 'utf8');
  const s = currentFollowups(p, { root, tracker, dir: p.state });
  assert.equal(s['7'].state, 'operator-required', 'orphan claim ownership is not assumed');
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(readRecovery(p, root).followups, undefined);
});

test('maintenance settles locally while paused, without confirming a pass or renewing budgets', t => {
  const { p } = home(t, 'factory-followup-maintain-');
  const root = join(p.home, 'repo');
  mkdirSync(p.state, { recursive: true });
  writeFileSync(join(p.state, `${keyFor('7', tracker)}.json`), JSON.stringify(run()));
  let settles = 0;
  maintainRecovery(p, { root, tracker, dir: p.state, at: at(1), paused: 'Explicit pause', log: () => {},
    settle: () => { settles++; return { state: 'none' }; } });
  const s = readRecovery(p, root);
  assert.equal(settles, 1);
  assert.equal(s.followups?.['7'].state, 'paused');
  assert.equal(s.episode, undefined);
  assert.deepEqual(s.budgets, {});
  assert.deepEqual(s.attempts, []);
  const file = recoveryFile(p, root);
  writeFileSync(file, '{');
  assert.throws(() => maintainRecovery(p, { root, tracker, dir: p.state, log: () => {},
    settle: () => { settles++; return { state: 'none' }; } }));
  assert.equal(settles, 1, 'malformed state is detected before any settlement');
});
