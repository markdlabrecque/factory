// Bounded numeric scans skip ticket-local refusals and saved human holds, never project stops or admitted failures.
// Follow-up refresh after settlement/refusal retains saved work and budgets; snapshots never confirm a fresh pass.
// Opened checkpoints never count as repair-budget progress; only confirmed merged completion does.
// #137: reviewed workflow fixtures include nested offline-parser/runtime assets.
// Jam confirmation after normal dispatch (#61, cli/src/jam-detect.mts): a pass's report is counted only for its own pass
// and project; the same jam on two completed passes is confirmed and one repair is launched on the stopped ticket, only
// when the project's copy has the recovery workflow and new work is still allowed; a running attempt or a normal
// admission between passes keeps the jam from confirming; a person's label change renews a spent budget. Real recovery
// state, admission record and run records in a disposable folder; the launcher is a recording stub. No tracker or Docker.
import { factoryToml } from './config-fixture.mts';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyFor, readAdmission, withAdmission } from '../../board/admission.mts';
import { projectWorkflow } from '../src/workflow.mts';
import { triageRecovery } from '../src/recovery-triage.mts';
import type { TriageOptions } from '../src/recovery-triage.mts';
import { unavailable } from '../../orchestrator/recovery-triage-contract.mts';
import { findJam } from '../../orchestrator/graph.mts';
import { unitEligibility } from '../../orchestrator/selection.mts';
import { afterPass } from '../src/jam-detect.mts';
import type { AfterPassOptions } from '../src/jam-detect.mts';
import { paths } from '../src/paths.mts';
import {preparedFixture} from './prepared-fixture.mts';
import { projectFixture } from './workflow-fixture.mts';
import { recordReview, WORKFLOW } from '../src/recovery-review.mts';
import { beginAttempt, deliveryMarker, finishAttempt, readRecovery, mutateRecovery, observePass } from '../src/recovery-state.mts';

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

function fixture(t: TestContext, o: { copy?: boolean; triage?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-jam-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const p = paths(home);
  const root = join(home, 'site');
  const sc = join(root, '.factory');
  mkdirSync(sc, { recursive: true });
  writeFileSync(join(sc, 'factory.toml'), factoryToml(TRACKER) + (o.triage === undefined ? '' : `\n[recovery]\ntriage = ${o.triage}\n`));
  if (o.copy !== false) {
    // #137: reviewed workflow includes nested vendored parser assets.
    const code = join(root, '.factory-workflow');
    for (const f of WORKFLOW.filter(f => !['package.json','package-lock.json'].includes(f))) { mkdirSync(join(code, f, '..'), { recursive: true }); writeFileSync(join(code, f), ''); }
    writeFileSync(join(code, 'main.mts'), '"attempt-record": { type: "string" }\n');
    projectFixture(p, root); recordReview(p, root);
  }
  const dir = p.state;
  mkdirSync(dir, { recursive: true });
  const record = (iid: number, stage: string) => writeFileSync(join(dir, `${keyFor(String(iid), TRACKER)}.json`),
    JSON.stringify({ iid: String(iid), project: TRACKER, stage, startedAt: at(0), branch: `${iid}-fix`, base: 'main', evidenceDir: join(root, '.factory/evidence', String(iid)) }));
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
      inspect:()=>({ok:true}),prepare:async (_p,x)=>preparedFixture(x),
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
  assert.match((await bare.pass([3])).join('\n'), /confirmed; not repairing: .*runtime.json/);
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

test('preparation holds cost zero and stop scanning; ready rechecks scheduling authorization',async t=>{
  const f=fixture(t);f.record(3,'stopped');f.record(5,'stopped');await f.pass([3,5]);const inspected:number[]=[];
  const lines=await f.pass([3,5],{inspect:(_p,o)=>{inspected.push(o.ticket);return {ok:true};},
    prepare:async()=>({version:1,state:'held',code:'unknown-dependency',scope:'ticket',reason:'Dependency information unavailable'})});
  assert.match(lines.join('\n'),/no attempt charged/);assert.deepEqual(inspected,[3]);assert.deepEqual(f.launches,[]);
  const s=readRecovery(f.p,f.root);assert.equal(s.attempts.length,0);assert.equal(s.budgets['3']?.used??0,0);assert.equal(s.preparation?.code,'unknown-dependency');
  let checks=0;await f.pass([3,5],{mayLaunch:async()=>++checks===1});assert.equal(checks,2);assert.deepEqual(f.launches,[]);
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
  const inspect: AfterPassOptions['inspect'] = (_p, o) => {
    order.push(o.ticket);
    return o.ticket !== 100 ? refused(o.ticket) : {ok:true};
  };
  await f.pass([100, 20, 10, 2]);
  const lines = await f.pass([100, 20, 10, 2], { inspect });
  assert.deepEqual(order, [2, 10, 20, 100]);
  assert.equal(lines.filter(l => l.includes('ticket-refused branch-missing')).length, 3);
  assert.match(lines.at(-1)!, /attempt 1 on #100 started/);
  assert.equal(readRecovery(f.p, f.root).attempts.length, 0, 'read-only stub refusals charge nothing');
  order.length = 0;
  await f.pass([100, 20, 10, 2], { inspect: (_p, o) => { order.push(o.ticket); return refused(o.ticket); } });
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
      inspect: (_p, o) => {
        order.push(o.ticket);
        if (o.ticket === 2) {
          if (stop === 'off') allowed = false;
          if (stop === 'generation') withAdmission(f.dir, tx => { tx.state.generations[TRACKER] = 1; tx.commit(); });
          if (stop === 'review') writeFileSync(join(f.root, '.factory-workflow/recovery.mts'), 'changed');
          if (stop === 'active') beginAttempt(f.p, f.root, { ticket: 2, at: at(10), replay: true });
          if (stop === 'changed-run') f.record(10, 'done');
          if (stop === 'malformed-store') writeFileSync(join(f.dir, 'broken.json'), '{');
          return refused(2);
        }
        if (stop === 'throw') throw new Error('unexpected IO');
        if (stop === 'admitted-failed') return {ok:true};
        return { ok: false, kind: 'project-stopped', admitted: false, code: 'capacity', reason: 'capacity or readiness unknown' };
      },
      launch:()=>({ok:false,kind:'admitted-failed',admitted:true,attempt:{seq:1} as any,reason:'spawn failed, charged'}),
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
  await f.pass([10, 3], { inspect: (_p, o) => refused(o.ticket) });
  for (const m of [10, 11]) finishAttempt(f.p, f.root, beginAttempt(f.p, f.root, { ticket: 3, at: at(m), replay: true }).seq, { at: at(m), result: 'failed' });
  const order: number[] = [];
  await f.pass([10, 3], { inspect: (_p, o) => { order.push(o.ticket); return refused(o.ticket); } });
  assert.deepEqual(order, [10]);
  assert.equal(readRecovery(f.p, f.root).budgets['3'].used, 2);
});

const advice = { version: 1, fresh: false, key: 'a'.repeat(64), reason: 'Triage fixture' } as const;
const human = { ...advice, state: 'human', action: 'gate-change', cause: 'Incorrect gate expectation', delivery: 'delivered' } as const;

function chargingRecovery() {
  const prepared: number[] = [], launched: number[] = [];
  return { prepared, launched, options: {
    prepare: async (_p, o) => { prepared.push(o.ticket); return preparedFixture(o); },
    launch: (p, o) => {
      const attempt = beginAttempt(p, o.root, { ticket: o.ticket, at: o.at });
      launched.push(o.ticket);
      return { ok: true, kind: 'started', admitted: true, attempt, pid: 1, branch: '', log: 'l' };
    },
  } satisfies Partial<AfterPassOptions> };
}

for (const config of ['omitted', 'off', 'helper missing'] as const) test(`triage ${config} preserves ordinary recovery`, async t => {
  const f = fixture(t, { triage: config === 'omitted' ? undefined : config === 'helper missing' });
  const c = chargingRecovery();
  const options: Partial<AfterPassOptions> = { ...c.options, triage: async () => { assert.fail('unexpected triage'); } };
  if (config === 'helper missing') options.selectTriageWorkflow = (p, root) => {
    const workflow = projectWorkflow(p, root);
    return { ...workflow, entrypoints: { ...workflow.entrypoints, triage: join(root, 'missing.mts') } };
  };
  f.record(3, 'stopped');
  await f.pass([3], options);
  await f.pass([3], options);
  const saved = readRecovery(f.p, f.root);
  assert.deepEqual(c.prepared, [3]);
  assert.deepEqual(c.launched, [3]);
  assert.equal(saved.budgets[3].used, 1);
  assert.equal(saved.triage, undefined);
});

for (const state of ['repair', 'released', 'unavailable'] as const) test(`${state} reaches preparation then charges one attempt`, async t => {
  const f = fixture(t, { triage: true }), c = chargingRecovery();
  f.record(3, 'stopped');
  const result = { ...advice, state };
  const options: Partial<AfterPassOptions> = { ...c.options, triage: async (_, o) => {
    assert.deepEqual(c.prepared, []);
    assert.equal(o.base, 'main');
    return result;
  } };
  await f.pass([3], options);
  const lines = await f.pass([3], options);
  const s = readRecovery(f.p, f.root);
  assert.equal(s.triage?.[3]?.state, state);
  assert.deepEqual(c.prepared, [3]);
  assert.deepEqual(c.launched, [3]);
  assert.equal(s.budgets[3].used, 1);
  if (state === 'unavailable') assert.equal(lines.filter(line => line.includes('triage unavailable: Triage fixture')).length, 1);
  assert.match(readFileSync(join(f.root, '.factory/logs/recover-3.log'), 'utf8'), new RegExp(`triage ${state}: Triage fixture`));
});

test('dispatcher unit selection removes needs-human from later jams when the label is excluded', t => {
  const f = fixture(t);
  const { LABELS } = projectWorkflow(f.p, f.root).config;
  const units = [3, 5].map(iid => ({ iid, state: 'open', title: '', description: '', url: '', labels: iid === 3 ? [LABELS.needsHuman] : [] }));
  // As in dispatch.mts, select units before mapping their stopped runs into findJam.
  const jam = (exclude: string[]) => findJam({ active: [], decisions: [], room: 1, units: units
    .filter(t => unitEligibility(t, true, exclude).status === 'selected')
    .map(t => ({ iid: t.iid, stage: 'stopped' })) });
  assert.deepEqual(jam(LABELS.exclude).tickets, [5]);
  assert.deepEqual(jam(LABELS.exclude.filter(label => label !== LABELS.needsHuman)).tickets, [3, 5]);
});

test('a fresh human hold ends this pass without charge; the saved hold lets the next stopped ticket proceed', async t => {
  const f = fixture(t, { triage: true }), c = chargingRecovery();
  for (const ticket of [3, 5]) f.record(ticket, 'stopped');
  await f.pass([5, 3]);
  const spent = beginAttempt(f.p, f.root, { ticket: 3, at: at(0), replay: true });
  finishAttempt(f.p, f.root, spent.seq, { at: at(0), result: 'failed' });
  const before = readRecovery(f.p, f.root);
  const seen: number[] = [];
  let fresh = true;
  const options: Partial<AfterPassOptions> = { ...c.options, triage: async (_, { ticket }) => {
    seen.push(ticket);
    return ticket === 3 ? { ...human, fresh } : { ...advice, fresh: true, state: 'repair' };
  } };
  await f.pass([5, 3], options);
  const held = readRecovery(f.p, f.root);
  assert.deepEqual(seen, [3], 'one fresh call per pass');
  assert.deepEqual(c.prepared, []);
  assert.deepEqual(c.launched, []);
  assert.deepEqual(held.attempts, before.attempts);
  assert.deepEqual(held.budgets, before.budgets);
  assert.equal(held.preparation, undefined);
  assert.equal(held.triage?.[3]?.state, 'human');
  assert.match(readFileSync(join(f.root, '.factory/logs/recover-3.log'), 'utf8'), /triage human \(gate-change, delivered\): Incorrect gate expectation/);
  fresh = false;
  await f.pass([5, 3], options);
  const next = readRecovery(f.p, f.root);
  assert.deepEqual(c.prepared, [5]);
  assert.deepEqual(c.launched, [5]);
  assert.deepEqual(next.budgets[3], before.budgets[3]);
  assert.equal(next.budgets[5].used, 1);
  assert.equal(next.followups?.[3]?.state, 'operator-required');
});

for (const change of ['schedule', 'generation', 'run', 'episode'] as const) test(`${change} change during triage fences preparation`, async t => {
  const f = fixture(t, { triage: true }), c = chargingRecovery();
  f.record(3, 'stopped');
  await f.pass([3]);
  let allowed = true;
  const lines = await f.pass([3], { ...c.options, mayLaunch: async () => allowed, triage: async () => {
    switch (change) {
      case 'schedule': allowed = false; break;
      case 'generation': withAdmission(f.dir, tx => { tx.state.generations[TRACKER] = 1; tx.commit(); }); break;
      case 'run': f.record(3, 'done'); break;
      case 'episode': observePass(f.p, f.root, { pass: 'cleared', at: at(4), jam: [] }); break;
    }
    return { ...advice, state: 'repair' };
  } });
  assert.match(lines.join('\n'), /scheduled work stopped during triage|project-stopped (generation|candidate|episode)-changed/);
  assert.deepEqual(c.prepared, []);
  assert.deepEqual(c.launched, []);
  assert.deepEqual(readRecovery(f.p, f.root).budgets, {});
});

function fakeHelper(run: (child: EventEmitter, stdout: PassThrough) => void): ChildProcess {
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { pid: 12345, stdout, stderr: new EventEmitter() });
  queueMicrotask(() => run(child, stdout));
  return child as unknown as ChildProcess;
}

for (const outcome of ['success', 'timeout', 'oversize', 'malformed', 'cancelled', 'nonzero'] as const) test(`triage helper: ${outcome}`, async t => {
  const f = fixture(t, { triage: true }), workflow = projectWorkflow(f.p, f.root);
  const signal = new AbortController(), reply = { ...advice, state: 'repair' };
  let cleaned = false;
  if (outcome === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
  const run = triageRecovery(f.p, { root: f.root, ticket: 3, base: 'main', dir: f.dir, workflow, node: '/fixture/node', path: '/fixture/bin', signal: signal.signal,
    spawn: (node, args, o) => fakeHelper((child, stdout) => {
      assert.equal(node, '/fixture/node');
      assert.deepEqual(args, [workflow.entrypoints.triage, '3', 'main']);
      assert.equal(o.env.PATH, '/fixture/bin');
      assert.equal(o.env.SANDCASTLE_STATE_DIR, f.dir);
      assert.equal(o.detached, true);
      if (outcome === 'timeout') return;
      if (outcome === 'cancelled') return signal.abort();
      stdout.emit('data', Buffer.from(outcome === 'oversize' ? 'é'.repeat(8193) : outcome === 'malformed' ? 'not JSON' : JSON.stringify(reply)));
      child.emit('exit', outcome === 'nonzero' ? 1 : 0);
      queueMicrotask(() => stdout.end());
    }), terminate: async pid => {
      assert.equal(pid, 12345);
      cleaned = true;
      return { confirmed: true, escalated: false };
    },
  });
  if (outcome === 'timeout') {
    assert.equal(cleaned, false);
    t.mock.timers.tick(workflow.config.GRAPH.analysisTimeoutMinutes * 60_000 + 59_999);
    assert.equal(cleaned, false);
    t.mock.timers.tick(1);
  }
  const result = await run;
  assert.equal(cleaned, true);
  if (outcome === 'success') assert.deepEqual(result, reply);
  else assert.deepEqual(result, unavailable({ timeout: 'Recovery triage timed out', oversize: 'Recovery triage output exceeded 16 KiB',
    malformed: 'Invalid recovery triage helper result', cancelled: 'Recovery triage cancelled', nonzero: 'Recovery triage helper failed' }[outcome]));
  assert.deepEqual(readdirSync(f.p.recovery).filter(file => file.startsWith('triage-')), []);
  assert.deepEqual(readAdmission(f.dir).entries, {});
});

test('unconfirmed triage cleanup retains its recorded group and stops recovery even if triage is later off', async t => {
  const f = fixture(t, { triage: true }), c = chargingRecovery();
  f.record(3, 'stopped');
  await f.pass([3]);
  const spawn: TriageOptions['spawn'] = () => fakeHelper((child, stdout) => {
    stdout.emit('data', Buffer.from(JSON.stringify({ ...advice, state: 'repair' })));
    child.emit('exit', 0);
  });
  const lines = await f.pass([3], { ...c.options, triage: (p, o) => triageRecovery(p, {
    ...o, spawn, terminate: async () => ({ confirmed: false, escalated: true }),
  }) });
  assert.match(lines.join('\n'), /project-stopped triage ownership: .*process group 12345 cleanup unconfirmed/);
  const file = readdirSync(f.p.recovery).find(n => n.startsWith('triage-'))!;
  const stop = JSON.parse(readFileSync(join(f.p.recovery, file), 'utf8'));
  assert.equal(stop.pid, 12345);
  assert.equal(readAdmission(f.dir).entries[stop.entry]?.project.root, f.root);
  writeFileSync(join(f.root, '.factory/factory.toml'), factoryToml(TRACKER));
  assert.match((await f.pass([3], c.options)).join('\n'), /Previous triage ownership is unconfirmed/);
  assert.deepEqual(c.prepared, []);
  assert.deepEqual(c.launched, []);
  assert.deepEqual(readRecovery(f.p, f.root).budgets, {});
});
