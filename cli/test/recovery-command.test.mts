// `factory recovery status|reset|review` tests (#62, review #63), plus the recovery summary in `factory status` and repair logs in
// `factory logs --recovery`. Disposable HOME, Git repo and run-state folder; recovery state is set up through
// recovery-state.mts and the admission record; no tracker, Docker or service manager. Recovery review also gates
// assessment.mts, board.mts's mandatory import, on presence and changes since review (#78).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admissionFile, emptyAdmission } from '../../board/admission.mts';
import { paths } from '../src/paths.mts';
import { readReview, recoveryCopyProblem, WORKFLOW } from '../src/recovery-review.mts';
import { addProject } from '../src/projects.mts';
import { beginAttempt, finishAttempt, observePass, readRecovery } from '../src/recovery-state.mts';
import { recovery } from '../src/commands/recovery.mts';
import { status } from '../src/commands/status.mts';
import { logs } from '../src/commands/logs.mts';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-recovery-cmd-')));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  delete process.env.SANDCASTLE_STATE_DIR;
  t.after(() => { rmSync(home, { recursive: true, force: true }); if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const p = paths(home);
  const root = join(home, 'site');
  mkdirSync(join(root, '.sandcastle/logs'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.sandcastle/config.mts'), 'export const TRACKER = {\n  project: "me/site",\n};\n');
  addProject(p, realpathSync(root));
  mkdirSync(p.state, { recursive: true });
  const lines: string[] = [], errors: string[] = [];
  t.mock.method(console, 'log', (s: string) => lines.push(s));
  t.mock.method(console, 'error', (s: string) => errors.push(s));
  const r = realpathSync(root);
  // A confirmed jam on #12 with one finished attempt that left a report.
  const jam = () => {
    observePass(p, r, { pass: 'a', at: '2026-11-12T10:00:00Z', jam: [12] });
    observePass(p, r, { pass: 'b', at: '2026-11-12T10:05:00Z', jam: [12] });
    const report = join(root, 'report.md');
    writeFileSync(report, 'cause\n');
    const a = beginAttempt(p, r, { ticket: 12, at: '2026-11-12T10:06:00Z', branch: '12-fix', log: join(root, '.sandcastle/logs/recover-12.log') });
    finishAttempt(p, r, a.seq, { at: '2026-11-12T10:20:00Z', result: 'unresolved', reason: 'needs a credential', report });
  };
  return { p, root: r, jam, out: () => lines.join('\n'), err: () => errors.join('\n'), clear: () => { lines.length = 0; errors.length = 0; } };
}
const now = Date.parse('2026-11-12T10:30:00Z');

test('recovery status shows inactive copy, confirmed jam, budgets, attempts with log and report', async t => {
  const { p, root, jam, out } = fixture(t);
  jam();
  assert.equal(await recovery(p, 'status', { cwd: root, now }), 0);
  const text = out();
  assert.match(text, /State: inactive: .*no recovery workflow/);
  assert.match(text, /Jam: #12, confirmed 25m ago/);
  assert.match(text, /#12 +1 of 2 attempts left/);
  assert.match(text, /1 +#12 +unresolved .*\[12-fix\]\n +needs a credential\n +log: .*recover-12\.log \(missing\)\n +report: .*report\.md$/m);
});

test('factory status summarizes recovery; --json carries it', async t => {
  const { p, root, jam, out, clear } = fixture(t);
  jam();
  const service = { status: async () => 'active' };
  await status(p, service, { cwd: root, now });
  assert.match(out(), /Recovery: inactive \(no recovery workflow in this copy\), jam: #12, confirmed 25m ago/);
  assert.match(out(), /Last attempt: attempt 1 on #12 unresolved 10m ago: needs a credential/);
  assert.match(out(), /Attempts left: #12 1\/2/);
  clear();
  await status(p, service, { cwd: root, json: true });
  const data = JSON.parse(out());
  assert.equal(data.recovery.episode.tickets[0], 12);
  assert.equal(data.recovery.attempts[0].result, 'unresolved');
});

test('reset ends the jam and renews budgets without touching run records or launching', async t => {
  const { p, root, jam, out } = fixture(t);
  jam();
  const record = join(p.state, 'me_site--12.json');
  writeFileSync(record, JSON.stringify({ iid: '12', project: 'me/site', stage: 'stopped', branch: '12-fix' }));
  assert.equal(await recovery(p, 'reset', { cwd: root, at: '2026-11-12T10:30:00Z' }), 0);
  const s = readRecovery(p, root);
  assert.equal(s.episode, undefined);
  assert.equal(s.episodes.at(-1)?.end, 'reset');
  assert.deepEqual(s.budgets['12'], { used: 0, renewedAt: '2026-11-12T10:30:00Z', renewal: 'reset' });
  assert.equal(s.attempts.length, 1);
  assert.equal(JSON.parse(readFileSync(record, 'utf8')).stage, 'stopped');
  assert.match(out(), /Nothing was launched/);
});

test('reset refuses while an attempt runs or a recovery claim is held', async t => {
  const { p, root, err } = fixture(t);
  observePass(p, root, { pass: 'a', at: '2026-11-12T10:00:00Z', jam: [12] });
  observePass(p, root, { pass: 'b', at: '2026-11-12T10:05:00Z', jam: [12] });
  const a = beginAttempt(p, root, { ticket: 12, at: '2026-11-12T10:06:00Z' });
  assert.equal(await recovery(p, 'reset', { cwd: root }), 1);
  assert.match(err(), /reset refused for site: recovery attempt 1 on #12 is running/);
  assert.equal(readRecovery(p, root).budgets['12'].used, 1);

  finishAttempt(p, root, a.seq, { at: '2026-11-12T10:10:00Z', result: 'failed' });
  const adm = emptyAdmission();
  adm.claims['me_site--12'] = { token: 't', project: 'me/site', iid: '12', kind: 'recovery', owner: { pid: process.pid }, at: '2026-11-12T10:06:00Z', attempt: 'u' };
  mkdirSync(join(p.state, 'admission'), { recursive: true });
  writeFileSync(admissionFile(p.state), JSON.stringify(adm));
  assert.equal(await recovery(p, 'reset', { cwd: root }), 1);
  assert.match(err(), /a recovery claim holds #12/);
  assert.ok(readRecovery(p, root).episode);
});

test('logs --recovery shows the ticket\'s repair log, or the newest one', async t => {
  const { p, root } = fixture(t);
  writeFileSync(join(root, '.sandcastle/logs/run-12.log'), 'run\n');
  writeFileSync(join(root, '.sandcastle/logs/recover-12.log'), 'repair\n');
  let out = '';
  const write = (b: Buffer) => { out += b.toString(); };
  await logs(p, '12', { cwd: root, recovery: true, write });
  await logs(p, undefined, { cwd: root, recovery: true, write });
  assert.equal(out, 'repair\nrepair\n');
  await assert.rejects(logs(p, '9', { cwd: root, recovery: true, write }), /No recovery log for #9 in site yet/);
});

test('review lists the workflow, refuses an incomplete copy, and --confirm activates recovery until a file changes', async t => {
  const { p, root, out, err, clear } = fixture(t);
  const sc = (f: string) => join(root, '.sandcastle', f);
  // A hand upgrade in progress: everything but the repair prompt.
  writeFileSync(sc('main.mts'), 'parseArgs({ options: { recover: { type: "string" }, "attempt-record": { type: "string" } } });\n');
  for (const f of WORKFLOW.filter(f => f !== 'main.mts' && f !== 'prompt.recover.md')) writeFileSync(sc(f), `// ${f}\n`);
  assert.equal(await recovery(p, 'review', { cwd: root, confirm: true }), 1);
  assert.match(err(), /missing prompt\.recover\.md[^]*Nothing was recorded/);
  assert.equal(readReview(p, root), null);

  writeFileSync(sc('prompt.recover.md'), readFileSync(new URL('../../orchestrator/prompt.recover.md', import.meta.url)));
  clear();
  assert.equal(await recovery(p, 'review', { cwd: root }), 0, 'without --confirm it only lists');
  assert.match(out(), /prompt\.recover\.md +same as Factory's/);
  assert.match(out(), /recovery\.mts +differs from Factory's copy/);
  assert.match(out(), /main\.mts +project-specific/);
  assert.match(out(), /Recovery is inactive/);
  assert.equal(readReview(p, root), null);

  clear();
  assert.equal(await recovery(p, 'review', { cwd: root, confirm: true, at: '2026-11-12T10:00:00Z' }), 0);
  assert.equal(recoveryCopyProblem(p, root), null);
  await recovery(p, 'status', { cwd: root, now });
  assert.match(out(), /State: active/);

  writeFileSync(sc('handoff.mts'), '// edited after review\n');
  clear();
  await status(p, { status: async () => 'active' }, { cwd: root, now });
  assert.match(out(), /Recovery: inactive \(workflow not reviewed as it is\)/);
  clear();
  await recovery(p, 'review', { cwd: root });
  assert.match(out(), /handoff\.mts +differs from Factory's copy, changed since review/);
  assert.match(out(), /main\.mts +project-specific, reviewed/);

  // The current board's import must be present and included in the reviewed hashes, not just copied by init.
  rmSync(sc('assessment.mts'));
  assert.match(recoveryCopyProblem(p, root) ?? '', /missing assessment\.mts/);
  writeFileSync(sc('assessment.mts'), readFileSync(new URL('../../board/assessment.mts', import.meta.url)));
  clear();
  assert.equal(await recovery(p, 'review', { cwd: root, confirm: true }), 0);
  assert.match(out(), /assessment\.mts +same as Factory's/);
  assert.equal(recoveryCopyProblem(p, root), null);
  writeFileSync(sc('assessment.mts'), '// edited after review\n');
  assert.match(recoveryCopyProblem(p, root) ?? '', /assessment\.mts changed since/);
});
