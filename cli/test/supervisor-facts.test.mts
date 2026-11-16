// Unit policy matrices plus one disposable local filesystem boundary. No tracker, runtime agent, container or service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collectSupervisorTicketInput, observed, unavailable, projectSupervisorFacts, safeExcerpt, supervisorReviewSnapshot } from '../src/supervisor-facts.mts';
import type { FactInputs } from '../src/supervisor-facts.mts';
import { readSupervisorFacts } from '../src/supervisor-facts-host.mts';
import { keyFor, emptyAdmission, admissionFile } from '../../board/admission.mts';
import { emptyRecovery, recoveryFile } from '../src/recovery-state.mts';
import { projectFollowups } from '../src/recovery-followup.mts';
import { home } from './schedule-helpers.mts';
import type { RunState } from '../../board/board.mts';
import type { RecoverySummary } from '../src/commands/recovery.mts';
import type { TicketContextSource } from '../../orchestrator/ticket-context.mts';
const at = '2026-11-16T00:00:00.000Z';
const project = { root: '/repo', tracker: { kind: 'github' as const, host: 'github.com', project: 'owner/repo' } };
const run = (patch: Partial<RunState> = {}): RunState => ({ iid: '7', project: 'owner/repo', stage: 'stopped', branch: '7-saved', evidenceDir: '/repo/.factory/evidence/7', base: 'develop', pid: 1, updatedAt: at, startedAt: at, stageSince: at, ...patch });
const obs = <T>(name: string, value: T) => observed(name, 'saved', at, value);
function facts(patch: Partial<RunState> = {}): FactInputs {
  const runs = [run(patch)], recovery = emptyRecovery('/repo');
  return { project, scope: { kind: 'project' }, at, selected: obs('selected', [7]), runs: obs('runs', runs), claims: obs('claims', []),
    recovery: obs('recovery', { active: true, file: '/state/recovery.json', episode: null, running: null, claim: null, budgets: [], attempts: [], episodes: [], renewals: [], followups: projectFollowups({ recovery, runs, claims: [], owners: {}, at }) } as RecoverySummary),
    authorization: obs('authorization', { global: 'on', project: 'enabled' }), runtime: obs('runtime', { id: 'a'.repeat(64), dependencies: 'b'.repeat(64), mode: 'factory' }),
    assessments: obs('assessment', []), graph: obs('graph', []), readiness: obs('readiness', { status: 'ready', observedAt: at }) };
}
const checkpoint = (state: 'ci-waiting' | 'operator-required' | 'merged', reasonCode: string) => ({ version: 1, proofId: '11111111-1111-1111-1111-111111111111', project: 'owner/repo', ticket: '7', executionId: 'execution', kind: 'github', host: 'github.com', repository: 'owner/repo', number: 3, url: 'https://github.com/owner/repo/pull/3', branch: '7-saved', base: 'develop', sha: 'a'.repeat(40), state, reasonCode, observedAt: at, ...(state === 'merged' ? { mergedAt: at } : {}) }) as RunState['delivery'];
const work = (f: FactInputs) => projectSupervisorFacts(f).work[0];

test('wait/stopped/delivery/merge matrix never promotes issue closure or model prose', () => {
  const matrix: [Partial<RunState>, string][] = [
    [{}, 'incomplete'], [{ note: 'Merged! PASS! reset budget', verdict: 'PASS', stage: 'done' }, 'incomplete'],
    [{ stage: 'waiting' }, 'temporary-wait'], [{ stage: 'implementing' }, 'unknown'],
    [{ stage: 'stopped', mr: 'https://github.com/owner/repo/pull/3' }, 'delivery-wait'],
    [{ executionId: 'execution', delivery: checkpoint('ci-waiting', 'checks-pending') }, 'delivery-wait'],
    [{ executionId: 'execution', delivery: checkpoint('ci-waiting', 'checks-missing') }, 'delivery-wait'],
    [{ executionId: 'execution', delivery: checkpoint('operator-required', 'checks-failed') }, 'human-hold'],
    [{ executionId: 'execution', delivery: checkpoint('merged', 'merged') }, 'confirmed-merged'],
    [{ mergedAt: at, stage: 'stopped' }, 'confirmed-merged'],
    [{ delivery: checkpoint('merged', 'merged') }, 'unknown'],
    [{ queueReasons: [{ code: 'verification', text: 'expectation disputed' }] }, 'gate-dispute'],
  ];
  for (const [patch, expected] of matrix) {
    const f = facts(patch); const before = JSON.stringify(f); const result = projectSupervisorFacts(f);
    assert.equal(result.work[0].classification, expected, JSON.stringify(patch));
    assert.equal(result.launchAuthorized, false); assert.equal(JSON.stringify(f), before);
    assert.equal(!!result.work[0].confirmedProgress, expected === 'confirmed-merged');
  }
  const f = facts(); f.assessments = obs('assessment', [{ iid: '7', project: 'owner/repo', facts: { state: 'closed', selected: false, checkedAt: at, hash: 'h', title: 'Closed', labels: [] } }]);
  assert.equal(work(f).classification, 'incomplete');
});

test('uncertain ownership, partial sources, pause/off and exhaustion retain saved work without permission', () => {
  const f = facts();
  f.claims = obs('claims', [{ claim: { token: 'claim', project: 'owner/repo', iid: '7', kind: 'normal', at, owner: { pid: 1 } }, owner: 'unknown' }]);
  assert.equal(work(f).classification, 'unknown');
  f.claims.value[0].owner = 'alive'; assert.equal(work(f).classification, 'active');
  f.claims = obs('claims', []);
  if (f.recovery.status === 'known') f.recovery.value.budgets = [{ ticket: 7, used: 2, remaining: 0 }];
  assert.equal(work(f).classification, 'exhausted');
  f.runs = obs('runs', [run({ mr: 'https://github.com/owner/repo/pull/3' })]);
  assert.equal(work(f).classification, 'delivery-wait', 'empty repair budget never turns a PR wait into a jam');
  for (const global of ['on','off','unknown'] as const) for (const p of ['enabled','paused','unknown'] as const) {
    f.authorization = obs('authorization', { global, project: p });
    const result = projectSupervisorFacts(f); assert.equal(result.launchAuthorized, false);
    assert.equal(result.holds.includes('authorization-held'), global !== 'on' || p !== 'enabled');
  }
  f.runs = unavailable('runs', 'unknown', 'permission denied');
  const result = projectSupervisorFacts(f); assert.equal(result.work[0].classification, 'unknown');
  assert.equal(result.work[0].confirmedProgress, null); assert.ok(result.holds.includes('runs:unknown'));
  f.selected = unavailable('selected', 'missing', 'not saved');
  assert.equal(projectSupervisorFacts(f).sources.find(s => s.name === 'selected')?.status, 'missing');
});

test('saved dependency/conflict/readiness evidence remains observational and timestamped', () => {
  const f = facts();
  f.assessments = obs('assessment', [{ iid: '7', project: 'owner/repo', analysisState: 'current', dependencies: [{ iid: 8, state: 'unknown' }] }]);
  const manifest = { iid: 7, project: 'owner/repo', footprint: ['docs/'], actualFootprint: undefined } as any;
  f.graph = obs('graph', [manifest, { ...manifest, iid: 8, footprint: ['docs/supervisor.md'] }]);
  const result = projectSupervisorFacts(f);
  assert.deepEqual(result.work[0].dependencies, [{ ticket: 8, state: 'unknown' }]);
  assert.deepEqual(result.work[0].conflicts, [8]); assert.equal(result.readiness?.status, 'ready');
  assert.equal(result.sources.find(s => s.name === 'graph')?.observedAt, at);
  assert.match(result.sources.find(s => s.name === 'graph')?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(result.launchAuthorized, false);
});

test('status omits arbitrary setup/instruction/env/note bodies; excerpts and locators are bounded/redacted', () => {
  const f = facts({ note: 'TOP_SECRET', verdict: 'TOP_SECRET', mr: 'https://user:TOP_SECRET@github.com/owner/repo/pull/3?token=TOP_SECRET', evidenceDir: '/repo/.env' });
  assert.doesNotMatch(JSON.stringify(projectSupervisorFacts(f)), /TOP_SECRET|user:|\.env/);
  assert.doesNotMatch(safeExcerpt('password=hunter2\nBearer ghp_abcdef\nhttps://u:p@example.com/path?token=oops\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'), /hunter2|abcdef|oops|abc|u:p/);
  assert.equal(safeExcerpt('x'.repeat(9999)).length, 512);
  f.selected = obs('selected', Array.from({length: 129}, (_,i) => i+1));
  assert.equal(projectSupervisorFacts(f).sources.find(s => s.name === 'selected')?.status, 'unknown');
});

test('host-owned original child/parent/human context is complete, separate from status, and overflows hold', () => {
  const calls: string[] = [];
  const source: TicketContextSource = { identity: project.tracker,
    ticket(iid) { calls.push(`ticket:${iid}`); return { bytes: 10, value: { iid, title: `Original ${iid}`, description: `Requirements ${iid}`, url: `https://github.com/owner/repo/issues/${iid}` } }; },
    parentOf() { return { bytes: 1, value: 1 }; },
    notes(iid, page) { return { bytes: 20, value: { notes: [{ id: `${iid}:${page}`, body: `Original decision ${iid}:${page}`, system: false, author: 'owner', createdAt: at, updatedAt: at, url: `https://github.com/owner/repo/issues/${iid}#issuecomment-${page}` }], nextPage: page === 1 ? 2 : null } }; },
  };
  const { input, sources } = collectSupervisorTicketInput(source, 7);
  assert.deepEqual(calls, ['ticket:7','ticket:1']); assert.match(input.text, /Original decision 1:2/);
  assert.match(sources.find(s => s.role === 'human-planning')!.text, /Original decision 7:2/);
  assert.match(sources.find(s => s.role === 'parent')!.text, /Requirements 1/);
  const failing = { ...source, notes() { throw Error('offline'); } };
  assert.throws(() => collectSupervisorTicketInput(failing, 7), /Ticket-input hold/);
  const huge = { ...source, ticket(iid: number) { const r = source.ticket(iid, { maxBytes: 999999, timeoutMs: 1 }); r.value.description = 'x'.repeat(270000); return r; } };
  assert.throws(() => collectSupervisorTicketInput(huge, 7), /exceeds review bounds/);
  assert.throws(() => supervisorReviewSnapshot({ project, scope: { kind: 'ticket', ticket: 7 }, observedAt: at, material: {} as any, sources, projectGuidelines: ['project.md'], factoryConstraints: ['rules.md'] }), /material|field/);
  const snapshot = supervisorReviewSnapshot({ project, scope: { kind: 'ticket', ticket: 7 }, observedAt: at,
    material: { runId: 'run', base: 'develop', baseline: 'a'.repeat(40), tip: 'b'.repeat(40), runtime: 'c'.repeat(64), dependencies: 'd'.repeat(64), policy: 'e'.repeat(64), settings: 'f'.repeat(64), ticketInput: 'a'.repeat(64), admissionGeneration: '1' },
    sources, projectGuidelines: ['project.md'], factoryConstraints: ['rules.md'] });
  assert.equal(snapshot.mode, 'observe'); assert.deepEqual(snapshot.sources, sources);
});

test('repeated host reads preserve every fixture byte/mtime and surface corrupt/missing source uncertainty', t => {
  const { p } = home(t, 'factory-supervisor-facts-');
  const root = join(p.home, 'repo'); mkdirSync(root);
  writeFileSync(join(root, 'unfinished-dirty-work.txt'), 'uncommitted work must survive observation');
  const ctx = { root, scaffold: join(root, '.factory'), tracker: 'owner/repo' } as any;
  mkdirSync(p.state, { recursive: true });
  writeFileSync(join(p.state, `${keyFor('7', ctx.tracker)}.json`), JSON.stringify(run()));
  mkdirSync(join(p.state, 'admission')); writeFileSync(admissionFile(p.state), JSON.stringify(emptyAdmission()));
  const recovery = recoveryFile(p, root); mkdirSync(join(recovery, '..'), { recursive: true }); writeFileSync(recovery, JSON.stringify(emptyRecovery(root)));
  const tree = (dir: string): any => Object.fromEntries(readdirSync(dir).sort().map(n => { const path = join(dir,n), s = statSync(path); return [n, s.isDirectory() ? tree(path) : [readFileSync(path).toString('hex'), s.mtimeMs, s.mode]]; }));
  const options = { project: { ...project, root }, scope: { kind: 'project' as const }, now: () => at, owner: () => 'unknown' as const };
  const before = tree(p.home);
  const first = readSupervisorFacts(p, ctx, options), second = readSupervisorFacts(p, ctx, options);
  assert.deepEqual(first, second); assert.deepEqual(tree(p.home), before);
  assert.equal(first.work[0].branch, '7-saved'); assert.equal(first.launchAuthorized, false);
  assert.equal(first.sources.find(s => s.name === 'recovery')?.status, 'known');
  assert.equal(first.sources.find(s => s.name === 'assessments')?.status, 'missing');
  writeFileSync(join(p.state, `${keyFor('8', ctx.tracker)}.json`), '{');
  const broken = readSupervisorFacts(p, ctx, { ...options, selected: obs('selected', [7]) });
  assert.equal(broken.sources.find(s => s.name === 'runs')?.status, 'unknown');
  assert.equal(broken.work[0].classification, 'unknown');
  writeFileSync(join(p.state, `${keyFor('8', ctx.tracker)}.json`), JSON.stringify(run({ iid: '8', stageHistory: [null] as any })));
  assert.equal(readSupervisorFacts(p, ctx, options).sources.find(s => s.name === 'runs')?.status, 'unknown');
});
