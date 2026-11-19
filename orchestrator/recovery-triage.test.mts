// Unit tests for the triage contract, stop identity, evidence selection and escalation with offline boundaries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { RunState } from '../board/board.mts';
import { SANDCASTLE_MARK } from './graph.mts';
import { parseTriageAdvice, parseTriageResult, stopKey, TRIAGE_OUTPUT_SCHEMA, type TriageAction, type TriageAdvice } from './recovery-triage-contract.mts';
import { buildTriageBundle, BUNDLE_BYTES, BUNDLE_FILES, escalationComment, triagePiArgs, triageRecovery, type TriageDeps } from './recovery-triage.mts';

const actions: TriageAction[] = [
  { kind: 'repair', expectation: 'Keep the original requirement' },
  { kind: 'escalate', question: 'Who owns the fixture?', nextAction: 'Provide a test fixture' },
  { kind: 'gate-change', path: 'scripts/check', before: 'old', after: 'new', rationale: 'Why', risks: 'What could go wrong' },
  { kind: 'follow-up-draft', title: 'Add a fixture', body: 'With synthetic data' },
  { kind: 'wait', expectation: 'Wait for the owner' },
];
const advice = (action = actions[0]): TriageAdvice => ({ version: 1, classification: 'problem', cause: 'Missing input', rationale: 'The stop note and logs agree.', relatedTickets: [5], action });
const tip = 'f'.repeat(40), baseline = 'a'.repeat(40);
const run: RunState = { iid: '4', project: 'fixture/project', stage: 'stopped', stageSince: '2026-01-01', startedAt: '2025-12-31',
  updatedAt: '2026-01-01', pid: 0, executionId: 'saved-execution', branch: '4-branch', base: 'develop', implementationBaseSha: baseline, note: 'Saved stop' };

test('strict reply accepts every action and rejects wrong shapes, prose and oversize text', () => {
  for (const action of actions) assert.deepEqual(parseTriageAdvice(JSON.stringify(advice(action))), advice(action));
  for (const value of [[], { ...advice(), version: 2 }, { ...advice(), unrelated: 'extra' }, { ...advice(), rationale: undefined },
    { ...advice(), action: { kind: 'unknown' } }, { ...advice(), action: { ...actions[0], unexpected: true } },
    { ...advice(), action: { kind: 'escalate', question: 'Missing next action' } }, { ...advice(), cause: '🙂'.repeat(513) },
    { ...advice(), relatedTickets: [4, 4] }, { ...advice(), relatedTickets: [0] }]) assert.throws(() => parseTriageAdvice(JSON.stringify(value)));
  for (const reply of ['Before ' + JSON.stringify(advice()), JSON.stringify(advice()) + '\nAfter', ' '.repeat(16 * 1024) + JSON.stringify(advice())])
    assert.throws(() => parseTriageAdvice(reply));
  assert.ok(readFileSync(new URL('./prompt.triage.md', import.meta.url), 'utf8').trimEnd().endsWith(TRIAGE_OUTPUT_SCHEMA));
});

test('the stop key is stable and changes with every material input', () => {
  const identity = { project: run.project!, ticket: 4, executionId: run.executionId!, stage: run.stage, stageSince: run.stageSince,
    note: run.note, tip, inputHash: 'frozen-hash', prompt: 'prompt\n', model: 'openai/gpt-6.1-terra' };
  const key = stopKey(identity);
  assert.match(key, /^[a-f\d]{64}$/);
  assert.equal(key, stopKey({ ...identity }));
  for (const [field, value] of Object.entries(identity)) assert.notEqual(key, stopKey({ ...identity, [field]: value + '2' }), field);
});

function fixture(model = () => JSON.stringify(advice())) {
  let saved: unknown, calls = 0;
  const state = { run: { ...run }, hash: 'frozen-hash', label: false, storageLocked: false, post: 'ok', comments: [] as string[] };
  const d: TriageDeps = {
    project: run.project!, ticket: 4, base: 'develop', needsHuman: 'needs-human', prompt: 'prompt', model: 'openai/gpt-6.1-terra',
    run: () => ({ ...state.run }), tip: () => tip, input: () => ({ text: 'frozen input', hash: state.hash }),
    saved: () => { if (state.storageLocked) throw Error('unreadable'); return saved; }, save: value => { saved = structuredClone(value); },
    bundle: (_r, _tip, text) => text, modelCall: () => { calls++; return model(); },
    hasLabel: () => state.label, addLabel: () => { state.label = true; }, notes: () => state.comments.map(body => ({ body })),
    comment: body => {
      if (state.post === 'rejected') throw Error('rejected before posting');
      state.comments.push(body);
      if (state.post === 'uncertain') throw Error('reply lost after posting');
    },
  };
  return { d, state, calls: () => calls, saved: () => saved, seedSaved: (value: unknown) => { saved = value; },
    triage: () => parseTriageResult(JSON.stringify(triageRecovery(d)) + '\n') };
}

test('same stop reuses repair advice or a saved model failure; a changed input gets a fresh call', () => {
  for (const [model, expected] of [[() => JSON.stringify(advice()), 'repair'], [() => '{bad JSON}', 'unavailable'],
    [() => { throw Error('Pi unavailable'); }, 'unavailable']] as const) {
    const f = fixture(model);
    const first = f.triage(), second = f.triage();
    assert.equal(first.state, expected);
    assert.equal(first.fresh, true);
    assert.deepEqual(second, { ...first, fresh: false });
    assert.equal(f.calls(), 1);
    f.state.hash += '-new';
    assert.notEqual(f.triage().key, first.key);
    assert.equal(f.calls(), 2);
  }
});

test('a changed run during the call never publishes stale advice or writes the tracker', () => {
  const f = fixture(() => { f.state.run.note = 'New stop'; return JSON.stringify(advice(actions[1])); });
  const result = f.triage();
  assert.equal(result.state, 'unavailable');
  assert.equal(result.fresh, true);
  assert.deepEqual(f.state.comments, []);
  assert.equal(f.state.label, false);
  assert.equal((f.saved() as { state: string }).state, 'unavailable');
});

test('every non-repair action escalates; only label removal releases a delivered stop', () => {
  for (const action of actions.slice(1)) {
    const f = fixture(() => JSON.stringify(advice(action)));
    const first = f.triage();
    assert.equal(first.state, 'human');
    if (first.state !== 'human') throw Error('Expected escalation');
    assert.equal(first.action, action.kind);
    assert.equal(first.delivery, 'delivered');
    assert.equal(f.state.label, true);
    assert.equal(f.state.comments.length, 1);
    assert.deepEqual(f.triage(), { ...first, fresh: false });
    f.state.label = false;
    assert.equal(f.triage().state, 'released');
    assert.equal(f.calls(), 1);
  }
});

test('pending comment retry posts once even if the original post succeeded but its receipt was lost', () => {
  for (const failure of ['rejected', 'uncertain']) {
    const f = fixture(() => JSON.stringify(advice(actions[1])));
    f.state.post = failure;
    const first = f.triage();
    assert.equal(first.state === 'human' && first.delivery, 'pending');
    assert.equal(f.state.label, true);
    assert.equal(f.state.comments.length, failure === 'uncertain' ? 1 : 0);
    f.state.post = 'ok';
    const retry = f.triage();
    assert.equal(retry.state === 'human' && retry.delivery, 'delivered');
    assert.equal(retry.fresh, false);
    assert.equal(f.calls(), 1);
    assert.equal(f.state.comments.length, 1);
  }
});

test('unreadable or malformed saved state is preserved, with no model call', () => {
  for (const locked of [true, false]) {
    const f = fixture(), corrupt = { version: 9 };
    f.seedSaved(corrupt);
    f.state.storageLocked = locked;
    assert.equal(f.triage().state, 'unavailable');
    assert.equal(f.saved(), corrupt);
    assert.equal(f.calls(), 0);
  }
});

test('comment sanitizes credential-like strings, paths and model-managed markup', () => {
  const message = escalationComment({ ...advice(actions[1]), cause: 'token=private /home/fixture/secret @operator ![image](asset)',
    rationale: 'ghp_synthetic <b>details</b>' }, 'a'.repeat(64), 'needs-human');
  assert.doesNotMatch(message, /private|\/home|ghp_synthetic|@operator|!\[image\]|<b>/);
  assert.match(message, /credential redacted/);
  assert.match(message, /path redacted/);
  assert.ok(message.includes(`<!-- factory-recovery-triage:${'a'.repeat(64)} -->`));
  assert.ok(message.includes(SANDCASTLE_MARK));
  assert.match(message, /#5/);
  assert.match(message, /No repair attempt was started and no recovery budget was spent/);
  assert.match(message, /Removing the \*\*needs-human\*\* label/);
});

test('bundle prioritizes recorded versions and verdicts, bounds bytes/files and lists omissions', () => {
  const calls: string[] = [];
  const root = '/fixture/root', path = `${root}/.factory/worktrees/4-branch`;
  const bundle = buildTriageBundle(root, run, tip, 'TICKET CONTEXT', {
    git: (cwd, args) => {
      if (args[0] === 'worktree') return `worktree ${path}\0HEAD ${tip}\0branch refs/heads/4-branch\0\0`;
      if (cwd === path) return args[0] === 'status' ? 'DIRTY TREE' : 'LOCAL PATCH';
      assert.ok(args.join(' ').includes(baseline));
      return args[0] === 'log' ? 'COMMIT SUMMARY' : 'COMMITTED PATCH';
    },
    directory: () => {},
    entries: path => ({ truncated: false, entries: path.endsWith('/logs') ? [{ name: 'run-4.log', kind: 'file' }] : path.endsWith('/recovery') ?
      [{ name: 'attempt-1', kind: 'directory' }] : path.endsWith('/attempt-1') ? [{ name: 'repair-report.md', kind: 'file' }] : [
        { name: 'symlink', kind: 'link' }, { name: 'A-binary.bin', kind: 'file' }, { name: 'verdict.md', kind: 'file' },
        ...Array.from({ length: 40 }, (_, i) => ({ name: `note-${i}.txt`, kind: 'file' as const })),
      ] }),
    text: filePath => {
      calls.push(filePath);
      return { text: filePath.endsWith('.bin') ? '\0BINARY' : `CONTENT ${filePath.split('/').at(-1)}`, truncated: false };
    },
    siblings: () => ({ runs: [{ ...run, iid: '5', note: 'Shared cause' }, { ...run, project: 'other/project', note: 'Foreign cause' }], truncated: false }),
  });
  assert.equal(calls.length, BUNDLE_FILES);
  for (const expected of ['Saved stop', 'TICKET CONTEXT', 'COMMIT SUMMARY', 'COMMITTED PATCH', 'DIRTY TREE', 'LOCAL PATCH', 'CONTENT run-4.log',
    'CONTENT verdict.md', 'CONTENT repair-report.md', '#5: Shared cause', 'Omitted or truncated', 'file-count limit', 'A-binary.bin', 'symlink']) assert.ok(bundle.includes(expected), expected);
  assert.ok(bundle.indexOf('CONTENT verdict.md') < bundle.indexOf('CONTENT note-'));
  assert.doesNotMatch(bundle, /BINARY|Foreign cause/);
  assert.ok(calls.every(p => !p.endsWith('symlink')));

  const large = buildTriageBundle(root, run, tip, '🛑'.repeat(BUNDLE_BYTES), {
    git: () => '界'.repeat(BUNDLE_BYTES), directory: () => { throw Error('missing'); },
    entries: () => ({ truncated: true, entries: Array.from({ length: 256 }, (_, i) => ({ name: '\r'.repeat(100) + i, kind: 'link' })) }),
    text: () => { throw Error('not a regular file'); }, siblings: () => ({ runs: [], truncated: true }),
  });
  assert.ok(Buffer.byteLength(large) <= BUNDLE_BYTES);
  assert.match(large, /more omissions/);
  assert.ok(!large.includes('�'));
});

test('shipped prompt separates repair advice from host authorization and preserves diagnostic escalation', () => {
  const prompt = readFileSync(new URL('./prompt.triage.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(prompt, /`repair` is advice, not authorization/);
  assert.match(prompt, /Do not escalate solely because .*attempt history.*worktree.* (is|are) missing/);
  assert.match(prompt, /Do not infer.*budget.*ownership/);
  assert.match(prompt, /Escalate.*cause cannot be established.*human prerequisite.*contradictory/);
  assert.match(prompt, /wrong comparison.*`repair`.*operator approval.*human/);
});

// Exercise the evidence and advice contract, not how a live model would classify it.
for (const scenario of ['reproduced failure', 'missing diagnosis', 'operator approval'] as const) test(`stopped revision with no supplemental artifacts: ${scenario}`, () => {
  const verdict = scenario === 'reproduced failure' ? 'Independent unit verification: comparator returns false for equal counts; expected true.' :
    scenario === 'operator approval' ? 'Independent verification blocked: required operator approval was denied.' : undefined;
  const recommendation = scenario === 'reproduced failure' ?
    { ...advice({ kind: 'repair', expectation: 'Fix the comparison; keep the same unit assertion.' }), cause: 'The saved comparison rejects equality.' } :
    { ...advice({ kind: 'escalate', question: scenario === 'operator approval' ? 'Can the operator approve verification?' : 'What failed in verification?',
      nextAction: scenario === 'operator approval' ? 'Resolve the required approval.' : 'Provide the missing failure evidence.' }),
      cause: verdict ?? 'No verification result or saved diff available.', classification: 'evidence-mechanism' };
  const f = fixture(() => JSON.stringify(recommendation));
  let bundle = '';
  f.d.bundle = (savedRun, savedTip, input) => (bundle = buildTriageBundle('/fixture/root', savedRun, savedTip, input, {
    directory: () => { throw Error('No materialized worktree'); },
    entries: dir => {
      if (dir.endsWith('/logs')) return { truncated: false, entries: [] };
      if (verdict && dir.endsWith('/saved-execution')) return { truncated: false, entries: [{ name: 'verdict.md', kind: 'file' }] };
      throw Error('No evidence directory');
    },
    git: (_cwd, args) => {
      if (args[0] === 'log') return 'Saved comparator change';
      if (args[0] === 'diff' && verdict) return '-return actual <= expected;\n+return actual < expected;';
      throw Error('Unavailable Git evidence');
    },
    text: () => {
      assert.ok(verdict, 'only the listed verdict may be read');
      return { text: verdict, truncated: false };
    },
    siblings: () => ({ runs: [], truncated: false }),
  }));
  const repairable = scenario === 'reproduced failure';
  assert.equal(f.triage().state, repairable ? 'repair' : 'human');
  assert.equal(f.state.label, !repairable);
  assert.equal(f.state.comments.length, repairable ? 0 : 1);
  assert.match(bundle, /Supplemental diagnostics:.*worktree.*recovery attempts.*not host admission evidence/);
  assert.match(bundle, /^- "saved worktree status and uncommitted diff": .*unconfirmed worktree$/m);
  assert.match(bundle, /^- "recovery attempts": missing, unreadable or symlink directory$/m);
  assert.match(bundle, /^- "recover-4.log": log not found$/m);
  assert.doesNotMatch(bundle, /^## "saved worktree/m);
  if (verdict) {
    assert.ok(bundle.includes(verdict));
    assert.match(bundle, /\+return actual < expected;/);
  } else {
    assert.match(bundle, /^- "saved execution": missing, unreadable or symlink directory$/m);
    assert.match(bundle, /^- "diff from recorded base": unavailable or exceeded read limit$/m);
  }
});

test('Pi arguments retain the selected analysis model but expose no tools', () => {
  const argv = triagePiArgs('openai/gpt-6.1-terra', {}, () => false);
  assert.deepEqual(argv, ['-p', '--model', 'openai/gpt-6.1-terra', '--thinking', 'high', '--no-tools', '--no-extensions', '--no-skills', '--no-context-files', '--no-session']);
});
