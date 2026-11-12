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
import { beginAttempt, finishAttempt, readRecovery } from '../src/recovery-state.mts';

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
    for (const f of ['recovery.mts', 'recovery-sandbox.mts', 'handoff.mts', 'prompt.recover.md']) writeFileSync(join(sc, f), '');
    writeFileSync(join(sc, 'main.mts'), '"attempt-record": { type: "string" }\n');
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
      launch: (_p, x) => { launches.push(x.ticket); return { ok: true, attempt: { seq: launches.length } as any, pid: 1, branch: '', log: 'l' }; },
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
