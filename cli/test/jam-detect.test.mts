// Bounded numeric scans continue only for typed read-only refusals, never project stops or admitted failures.
// Follow-up refresh after settlement/refusal retains saved work and budgets; snapshots never confirm a fresh pass.
// Opened checkpoints never count as repair-budget progress; only confirmed merged completion does.
// #137: reviewed workflow fixtures include nested offline-parser/runtime assets.
// Jam confirmation after normal dispatch (#61, cli/src/jam-detect.mts): a pass's report is counted only for its own pass
// and project; the same jam on two completed passes is confirmed and one repair is launched on the stopped ticket, only
// when the project's copy has the recovery workflow and new work is still allowed; a running attempt or a normal
// admission between passes keeps the jam from confirming; a person's label change renews a spent budget. Real recovery
// state, admission record and run records in a disposable folder; the launcher is a recording stub. No tracker or Docker.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyFor, withAdmission } from '../../board/admission.mts';
import { afterPass } from '../src/jam-detect.mts';
import type { AfterPassOptions } from '../src/jam-detect.mts';
import { paths } from '../src/paths.mts';
import { recordReview, WORKFLOW } from '../src/recovery-review.mts';
import { beginAttempt, deliveryMarker, finishAttempt, readRecovery, mutateRecovery } from '../src/recovery-state.mts';

test('temporary refusal is observed without spending attempts; later successful passes reconsider saved work', async t => {
  const f = fixture(t);
  f.record(3, 'stopped');
  // A stale persistent observation is not a jam report or permission to launch.
  mutateRecovery(f.p, f.root, s => { s.followups = { '3': { state: 'pending', reason: 'saved', nextAction: 'recheck', changedAt: at(0) } }; return { write: true, value: undefined }; });
  let calls = 0;
  const refuse = () => { calls++; return { ok: false as const, kind: 'project-stopped' as const, admitted: false as const,
    code: 'project-claimed', reason: 'competing admission' }; };
  await f.pass([3], { launch: refuse });
  assert.equal(calls, 0, 'snapshot never bypasses two-pass confirmation');
  await f.pass([3], { launch: refuse });
  assert.equal(calls, 1);
  assert.equal(readRecovery(f.p, f.root).budgets['3'], undefined);
  assert.equal(readRecovery(f.p, f.root).followups?.['3'].state, 'pending');
  await f.pass([3]);
  assert.deepEqual(f.launches, [3], 'no manual retry or budget reset after competing work clears');
  await f.pass([3], { pauseReason: () => 'Project paused', mayLaunch: async () => false });
  assert.equal(readRecovery(f.p, f.root).followups?.['3'].state, 'paused');
});

test('opened delivery checkpoints never count as recovery progress', () => {
  const base = { stage: 'done' as const, verdict: 'PASS', mr: 'https://github.com/owner/repo/pull/1' };
  for (const state of ['ci-waiting','operator-required']) assert.equal(deliveryMarker({ ...base, delivery: {state} as any }), undefined);
  assert.equal(deliveryMarker({ ...base, delivery: {state:'merged',mergedAt:'2026-01-01T00:00:00Z'} as any }), `merged ${base.mr}`);
});

const TRACKER = 'acme/site';
const at = (m: number) => new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString();

function fixture(t: TestContext, o: { copy?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-jam-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const p = paths(home);
  const root = join(home, 'site');
  const sc = join(root, '.sandcastle');
  mkdirSync(sc, { recursive: true });
  if (o.copy !== false) {
    // #137: reviewed workflow includes nested vendored parser assets.
    for (const f of WORKFLOW) { mkdirSync(join(sc, f, '..'), { recursive: true }); writeFileSync(join(sc, f), ''); }
    writeFileSync(join(sc, 'main.mts'), '"attempt-record": { type: "string" }\n');
    recordReview(p, root);
  }
  const dir = p.state;
  mkdirSync(dir, { recursive: true });
  const record = (iid: number, stage: string) => writeFileSync(join(dir, `${keyFor(String(iid), TRACKER)}.json`),
    JSON.stringify({ iid: String(iid), project: TRACKER, stage, startedAt: at(0), branch: `${iid}-fix`, base: 'main' }));
  const launches: number[] = [];
  const lines: string[] = [];
  let n = 0;
  /** One completed pass whose dispatcher reported `jam`; returns the log lines it produced. */
  const pass = async (jam: number[], extra: Partial<AfterPassOptions> & { reportPass?: string; labels?: string[] } = {}) => {
    const id = `pass-${++n}`;
    const report = join(home, `${id}.json`);
    writeFileSync(report, JSON.stringify({ version: 1, pass: extra.reportPass ?? id, project: TRACKER, at: at(n), tickets: jam,
      observed: jam.map(iid => ({ iid, content: 'h', labels: extra.labels ?? ['bug'] })) }));
    const from = lines.length;
    await afterPass(p, { root, tracker: TRACKER, name: 'site', pass: id, report, dir, log: l => lines.push(l), mayLaunch: async () => true,
      launch: (_p, x) => { launches.push(x.ticket); return { ok: true, kind: 'started', admitted: true, attempt: { seq: launches.length } as any, pid: 1, branch: '', log: 'l' }; },
      ...extra });
    return lines.slice(from);
  };
  return { p, root, dir, record, pass, launches };
}

test('the same jam on two completed passes is confirmed and one repair starts on its stopped ticket', async t => {
  const f = fixture(t);
  f.record(3, 'stopped');
  assert.match((await f.pass([3, 5])).join('\n'), /jam on #3, #5 seen \(1 of 2 passes\)/);
  assert.deepEqual(f.launches, []);
  assert.match((await f.pass([3, 5])).join('\n'), /confirmed; attempt 1 on #3 started/);
  assert.deepEqual(f.launches, [3], 'the dependency-held #5 has no work of its own; its stopped prerequisite is repaired');
  assert.ok(readRecovery(f.p, f.root).episode?.confirmedAt);
});

test('a confirmed jam launches nothing without the recovery workflow, or once scheduled work was stopped', async t => {
  const bare = fixture(t, { copy: false });
  bare.record(3, 'stopped');
  await bare.pass([3]);
  assert.match((await bare.pass([3])).join('\n'), /confirmed; not repairing: .*no recovery workflow/);
  assert.deepEqual(bare.launches, []);
  const off = fixture(t);
  off.record(3, 'stopped');
  await off.pass([3], { mayLaunch: async () => false });
  assert.match((await off.pass([3], { mayLaunch: async () => false })).join('\n'), /scheduled work was stopped/);
  assert.deepEqual(off.launches, []);
});

test('a running attempt, another pass\'s report or a normal admission between passes keeps a jam from confirming', async t => {
  const f = fixture(t);
  f.record(3, 'stopped');
  await f.pass([3]);
  const running = await f.pass([3], { settle: () => ({ state: 'running', attempt: { seq: 1, ticket: 3 } as any }) });
  assert.match(running.join('\n'), /running; pass not counted/);
  assert.match((await f.pass([3], { reportPass: 'someone-else' })).join('\n'), /not pass-3; pass not counted/);
  withAdmission(f.dir, tx => { tx.state.generations[TRACKER] = 1; tx.commit(); }); // a normal launch was admitted
  assert.match((await f.pass([3])).join('\n'), /seen \(1 of 2 passes\)/, 'confirmation starts over');
  assert.deepEqual(f.launches, []);
  await f.pass([]);
  assert.equal(readRecovery(f.p, f.root).episode, undefined, 'a pass with no jam ends the episode');
});

test('a spent budget stops repairs until a person changes the ticket', async t => {
  const f = fixture(t);
  f.record(3, 'stopped');
  await f.pass([3]);
  await f.pass([3]);
  // The stub launcher charges nothing; spend both attempts as two failed repairs would.
  for (const m of [10, 11]) finishAttempt(f.p, f.root, beginAttempt(f.p, f.root, { ticket: 3, at: at(m), replay: true }).seq, { at: at(m), result: 'failed' });
  f.launches.length = 0;
  assert.match((await f.pass([3])).join('\n'), /used its 2 recovery attempts/);
  assert.deepEqual(f.launches, []);
  const renewed = await f.pass([3], { labels: ['bug', 'model:opus'] });
  assert.match(renewed.join('\n'), /#3 budget renewed \(requirement-change: labels \+model:opus\)/);
  assert.deepEqual(f.launches, [3]);
});

const refused = (ticket: number) => ({ ok: false as const, kind: 'ticket-refused' as const, admitted: false as const,
  code: 'branch-missing' as const, reason: `#${ticket}: restore its recorded branch` });

test('three local refusals then one admission in numeric order; no refusal cache or charge', async t => {
  const f = fixture(t);
  const order: number[] = [];
  for (const n of [2, 10, 20, 100]) f.record(n, 'stopped');
  const launch: AfterPassOptions['launch'] = (_p, o) => {
    order.push(o.ticket);
    if (o.ticket !== 100) return refused(o.ticket);
    return { ok: true, kind: 'started', admitted: true, attempt: { seq: 1 } as any, pid: 1, branch: '100-fix', log: 'l' };
  };
  await f.pass([100, 20, 10, 2]);
  const lines = await f.pass([100, 20, 10, 2], { launch });
  assert.deepEqual(order, [2, 10, 20, 100]);
  assert.equal(lines.filter(l => l.includes('ticket-refused branch-missing')).length, 3);
  assert.match(lines.at(-1)!, /attempt 1 on #100 started/);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0, 'read-only stub refusals charge nothing');
  order.length = 0;
  await f.pass([100, 20, 10, 2], { launch: (_p, o) => { order.push(o.ticket); return refused(o.ticket); } });
  assert.deepEqual(order, [2, 10, 20, 100], 'all local facts are rechecked on a later pass');
});

for (const stop of ['project-stopped', 'admitted-failed', 'throw', 'off', 'generation', 'review', 'active', 'changed-run', 'malformed-store'] as const) {
  test(`a local refusal followed by ${stop} stops before later candidates`, async t => {
    const f = fixture(t);
    for (const n of [2, 10, 20]) f.record(n, 'stopped');
    await f.pass([20, 10, 2]);
    const order: number[] = [];
    let allowed = true;
    const lines = await f.pass([20, 10, 2], {
      mayLaunch: async () => allowed,
      launch: (_p, o) => {
        order.push(o.ticket);
        if (o.ticket === 2) {
          if (stop === 'off') allowed = false;
          if (stop === 'generation') withAdmission(f.dir, tx => { tx.state.generations[TRACKER] = 1; tx.commit(); });
          if (stop === 'review') writeFileSync(join(f.root, '.sandcastle/recovery.mts'), 'changed');
          if (stop === 'active') beginAttempt(f.p, f.root, { ticket: 2, at: at(10), replay: true });
          if (stop === 'changed-run') f.record(10, 'done');
          if (stop === 'malformed-store') writeFileSync(join(f.dir, 'broken.json'), '{');
          return refused(2);
        }
        if (stop === 'throw') throw new Error('unexpected IO');
        if (stop === 'admitted-failed') return { ok: false, kind: stop, admitted: true, attempt: { seq: 1 } as any, reason: 'spawn failed, charged' };
        return { ok: false, kind: 'project-stopped', admitted: false, code: 'capacity', reason: 'capacity or readiness unknown' };
      },
    });
    assert.deepEqual(order, ['project-stopped', 'admitted-failed', 'throw'].includes(stop) ? [2, 10] : [2]);
    assert.ok(lines.length >= 2);
    assert.equal(order.includes(20), false);
  });
}

test('a ticket exhausted under current budget rules is skipped, not renewed', async t => {
  const f = fixture(t);
  for (const n of [3, 10]) f.record(n, 'stopped');
  await f.pass([10, 3]);
  await f.pass([10, 3], { launch: (_p, o) => refused(o.ticket) });
  for (const m of [10, 11]) finishAttempt(f.p, f.root, beginAttempt(f.p, f.root, { ticket: 3, at: at(m), replay: true }).seq, { at: at(m), result: 'failed' });
  const order: number[] = [];
  await f.pass([10, 3], { launch: (_p, o) => { order.push(o.ticket); return refused(o.ticket); } });
  assert.deepEqual(order, [10]);
  assert.equal(readRecovery(f.p, f.root).budgets['3'].used, 2);
});
