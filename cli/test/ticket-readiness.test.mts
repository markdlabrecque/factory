// Cross-path acceptance: actual CLI/runtime gates and passive Board projections share one observation.
// All projects, command boundaries and runtime bundles are disposable; no installed projects or services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readinessFixture } from './ticket-readiness-fixture.mts';
import { bindExecution } from './execution-fixture.mts';
import { projectFixture } from './workflow-fixture.mts';
import { run } from '../src/commands/run.mts';
import { dispatch } from '../src/commands/dispatch.mts';
import { tick } from '../src/commands/tick.mts';
import { status } from '../src/commands/status.mts';
import { doctorReadiness, diagnosticContext } from '../src/readiness.mts';
import { FakeSchedule } from '../src/platform/fake.mts';
import { setProjectSchedule, writeScheduleConfig } from '../src/schedule.mts';
import { readAdmission } from '../../board/admission.mts';
import { readReadiness, readStoredReadiness, scopedReadiness } from '../../board/readiness.mts';
import { handleRequest } from '../../board/board-server.mts';
import { projectLaunchReadiness } from '../../orchestrator/launch-readiness.mts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadinessRead } from '../../board/readiness.mts';

async function capture(fn: () => unknown) {
  const lines: string[] = [], saved = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = saved; }
  return lines.join('\n');
}
function boardObservation(): ReadinessRead {
  let body = '', code = 0; const headers: Record<string, string> = {};
  handleRequest({url:'/api/readiness',method:'GET',headers:{}} as IncomingMessage, {
    writeHead(n: number, h: Record<string,string>) { code = n; Object.assign(headers, h); },
    setHeader(k: string, v: string) { headers[k] = v; }, end(s: string) { body = s; },
  } as unknown as ServerResponse);
  assert.equal(code, 200); assert.equal(headers['cache-control'], 'no-store');
  const data = JSON.parse(body); assert.equal(data.projects.length, 1);
  return data.projects[0].observation;
}
async function agreement(f: ReturnType<typeof readinessFixture>) {
  const saved = readStoredReadiness(f.p.state, f.root); assert.ok('report' in saved);
  const before = readFileSync(join(f.p.state, 'readiness', readdirSync(join(f.p.state, 'readiness')).find(n => n.endsWith('.json'))!));
  const json = JSON.parse(await capture(() => status(f.p, {status:async () => 'fixture-only'}, {cwd:f.root,json:true})));
  assert.deepEqual(json.readiness, saved); assert.deepEqual(boardObservation(), saved);
  const text = await capture(() => status(f.p, {status:async () => 'fixture-only'}, {cwd:f.root}));
  for (const check of saved.report.checks.filter(c => c.status !== 'ready')) {
    assert.ok(text.includes(check.operation), text);
    assert.ok(text.includes(check.nextAction), text);
  }
  assert.equal(json.readiness.report.owner.generation, saved.report.owner.generation);
  assert.equal(json.readiness.report.observedAt, saved.report.observedAt);
  assert.deepEqual(json.readiness.report.checks, saved.report.checks, 'operation, scope, next actor and automatic policy are identical');
  assert.deepEqual(readFileSync(join(f.p.state, 'readiness', readdirSync(join(f.p.state, 'readiness')).find(n => n.endsWith('.json'))!)), before, 'readers do not renew the report');
  return saved.report;
}
async function freshHost(f: ReturnType<typeof readinessFixture>) {
  const {workflow} = diagnosticContext(f.p, f.root);
  return projectLaunchReadiness({projectRoot:f.root,runtimeRoot:workflow.root,runtimeIdentity:workflow.id,runtimeDependencies:workflow.manifest.dependencies,config:workflow.config,stateRoot:f.p.state,base:'main'});
}
function noLaunch(f: ReturnType<typeof readinessFixture>) {
  assert.equal(existsSync(join(f.fake, 'unexpected.jsonl')), false, 'no agent, container, auth, npm or service boundary');
  assert.equal(existsSync(join(f.p.state, 'owner_repo--7.json')), false, 'no invented queued/stopped execution');
  if (existsSync(join(f.p.state, 'admission'))) {
    // Managed entry ownership precedes host probing; no implementation/recovery admission is manufactured.
    const admission = readAdmission(f.p.state);
    assert.deepEqual(admission.claims, {}); assert.deepEqual(admission.generations, {});
    assert.deepEqual(admission.recovery, {}); assert.deepEqual(admission.supervisorHolds, {});
  }
}

for (const path of ['evidence', 'worktrees']) test(`clean Git ${path} filesystem hold across manual, dispatch and real tick; next pass fails separately on incomplete parent input`, async t => {
  const f = readinessFixture(t), obstruction = join(f.root, '.factory', path);
  writeFileSync(obstruction, 'A file cannot be used as a writable artifact directory');
  assert.equal(f.git('status', '--porcelain'), '', 'clean Git does not imply usable filesystem');
  const generations = new Set<string>();
  const check = async () => {
    const report = await agreement(f); generations.add(report.owner.generation);
    assert.equal(report.status, 'blocked');
    assert.ok(report.checks.some(c => c.scope === 'project' && c.path === obstruction && c.required && c.status !== 'ready'));
    noLaunch(f); assert.equal(existsSync(join(f.fake, 'gh.jsonl')), false, 'project gate precedes tracker analysis');
  };
  assert.equal(await run(f.p, '7', {cwd:f.root}), 1); await check();
  assert.equal(await dispatch(f.p, {cwd:f.root}), 1); await check();
  writeScheduleConfig(f.p, {node:process.execPath,path:process.env.PATH!}); setProjectSchedule(f.p, f.root, true);
  const backend = new FakeSchedule(f.p); backend.enabled = true; backend.timer = 'active'; let maintained = 0;
  assert.equal((await tick(f.p, {backend,log:()=>{},maintenance:()=>{maintained++;}})).result, 'failed');
  assert.equal(maintained, 1, 'settlement/maintenance is outside the new-launch gate'); await check();
  assert.equal(generations.size, 3, 'each entrypoint actively observes again');
  assert.equal(readFileSync(obstruction, 'utf8'), 'A file cannot be used as a writable artifact directory');
  rmSync(obstruction); mkdirSync(obstruction);
  const result = f.main(); assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /parent #90 notes: read-failed/);
  const inputReport = await agreement(f);
  assert.ok(inputReport.checks.filter(c => c.scope === 'project' && c.required).every(c => c.status === 'ready'));
  const hold = inputReport.checks.find(c => c.scope === 'ticket-input' && c.status === 'blocked');
  assert.ok(hold); assert.equal(hold.ticket, '7'); assert.equal(hold.operation, 'parent notes');
  assert.equal(scopedReadiness({state:'current',report:inputReport}, 'project').report?.status, 'ready');
  assert.equal(f.git('status', '--porcelain'), ''); noLaunch(f);
});

for (const scenario of ['parent-page-failed', 'parent-size-failed']) test(`${scenario} holds actual shared-runtime launch without partial prompt/evidence`, async t => {
  const f = readinessFixture(t), result = f.main(scenario);
  assert.notEqual(result.status, 0, result.stdout + result.stderr); noLaunch(f);
  const report = await agreement(f), hold = report.checks.find(c => c.scope === 'ticket-input' && c.status === 'blocked');
  assert.ok(hold); assert.equal(hold.ticket, '7'); assert.match(hold.reason, scenario === 'parent-page-failed' ? /read-failed/ : /byte-limit/);
  assert.ok(report.checks.filter(c => c.scope === 'project').every(c => c.status === 'ready'));
  assert.equal(existsSync(join(f.p.state, 'ticket-inputs')), false, 'partial context is not saved as frozen evidence');
  if (scenario === 'parent-page-failed') assert.match(readFileSync(join(f.fake, 'gh.jsonl'), 'utf8'), /page=2/);
});

test('missing instruction, current identity changes and report-write failure never reuse healthy authority', async t => {
  const f = readinessFixture(t);
  assert.equal((await freshHost(f)).status, 'ready');
  assert.equal(readStoredReadiness(f.p.state, f.root).state, 'current');
  const identity = diagnosticContext(f.p, f.root).identity;
  const configBytes = readFileSync(f.config, 'utf8');
  writeFileSync(f.config, configBytes + '\n[instructions]\ncommon = ["missing.md"]\n');
  assert.equal(await run(f.p, '7', {cwd:f.root}), 1); noLaunch(f);
  const missing = await agreement(f); assert.ok(missing.checks.some(c => c.operation === 'read-instruction' && c.status === 'blocked'));
  assert.notDeepEqual(missing.identity, identity);
  assert.equal(readReadiness(f.p.state, identity).state, 'stale');
  assert.equal(readReadiness(f.p.state, {...missing.identity,runtimeIdentity:'changed-runtime'}).state, 'stale');
  writeFileSync(f.config, configBytes);
  assert.equal((await freshHost(f)).status, 'ready');
  rmSync(join(f.p.state, 'readiness'), {recursive:true}); writeFileSync(join(f.p.state, 'readiness'), 'report publication obstruction');
  const errors: string[] = [], saved = console.error; console.error = (...a) => {errors.push(a.join(' '));};
  try { assert.equal(await run(f.p, '7', {cwd:f.root}), 1); } finally { console.error = saved; }
  assert.match(errors.join('\n'), /report write failed/);
  assert.notEqual(readStoredReadiness(f.p.state, f.root).state, 'current'); noLaunch(f);
});


test('actual config and runtime publication changes stale old diagnostic data; passive Board remains a stored observation', async t => {
  const f = readinessFixture(t);
  const publish = () => freshHost(f);
  assert.equal((await publish()).status, 'ready');
  const original = diagnosticContext(f.p, f.root).identity;
  writeFileSync(f.config, readFileSync(f.config, 'utf8') + '\n# fresh raw config bytes\n');
  const configIdentity = diagnosticContext(f.p, f.root).identity;
  assert.notEqual(configIdentity.configIdentity, original.configIdentity);
  assert.equal((await doctorReadiness(f.p, f.root, false)).saved.state, 'stale');
  assert.equal((await publish()).status, 'ready');
  const template = join(f.runtime.staging, 'source/cli/templates/project/prompt.md');
  writeFileSync(template, readFileSync(template, 'utf8') + '\nSynthetic runtime B template\n');
  const b = bindExecution(f.root, process.env, {paths:f.p,overlays:false,sourceRoot:join(f.runtime.staging,'source'),sdk:join(import.meta.dirname,'../../orchestrator/fixtures/entrypoint/sandcastle')});
  assert.notEqual(b.id, f.runtime.id);
  assert.equal(diagnosticContext(f.p, f.root).identity.runtimeIdentity, b.id);
  assert.equal((await doctorReadiness(f.p, f.root, false)).saved.state, 'stale');
  const stored = boardObservation(); assert.equal(stored.state, 'current');
  assert.ok('report' in stored); assert.equal(stored.report.identity.runtimeIdentity, f.runtime.id, 'Board must not import or revalidate selected code');
  assert.equal((await publish()).identity.runtimeIdentity, b.id);
  assert.equal((await doctorReadiness(f.p, f.root, false)).saved.state, 'current');
  noLaunch(f);
});

test('complete custom workflow gets fresh host gates but its internal input and sandbox stay opaque', async t => {
  const f = readinessFixture(t), code = join(f.root, '.factory-workflow'); mkdirSync(code);
  writeFileSync(join(code, 'dispatch.sh'), '#!/bin/sh\n# --issue N\nprintf "opaque invocation" > "$PWD/.factory/custom-called"\n', {mode:0o755});
  projectFixture(f.p, f.root);
  const obstruction = join(f.root, '.factory/evidence'); writeFileSync(obstruction, 'preserve');
  assert.equal(await run(f.p, '7', {cwd:f.root}), 1);
  assert.equal(existsSync(join(f.root, '.factory/custom-called')), false);
  await agreement(f); noLaunch(f);
  rmSync(obstruction);
  assert.equal(await run(f.p, '7', {cwd:f.root}), 0);
  assert.equal(readFileSync(join(f.root, '.factory/custom-called'), 'utf8'), 'opaque invocation');
  const report = await agreement(f); assert.equal(report.status, 'ready');
  assert.ok(report.checks.every(c => c.scope === 'project'), 'host success invents no ticket-context or internal sandbox success');
  assert.equal(existsSync(join(f.fake, 'gh.jsonl')), false); noLaunch(f);
});

test('ticket branch collision is ticket-only, preserves the ref and starts no agent or admission', async t => {
  const f = readinessFixture(t); f.git('branch', '7-fix-login');
  const before = f.git('rev-parse', '7-fix-login');
  const result = f.main('pass'); assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const report = await agreement(f);
  assert.ok(report.checks.filter(c => c.scope === 'project' && c.required).every(c => c.status === 'ready'));
  const conflict = report.checks.find(c => c.scope === 'ticket-workspace' && c.status === 'blocked');
  assert.ok(conflict); assert.equal(conflict.ticket, '7');
  assert.equal(f.git('rev-parse', '7-fix-login'), before); noLaunch(f);
});

test('unusable shared state fails directly before tracker and cannot manufacture a healthy report or execution', async t => {
  const f = readinessFixture(t); rmSync(f.p.state, {recursive:true,force:true});
  mkdirSync(join(f.p.state, '..'), {recursive:true}); writeFileSync(f.p.state, 'state directory obstruction');
  const errors: string[] = [], saved = console.error; console.error = (...args) => {errors.push(args.join(' '));};
  try { assert.equal(await run(f.p, '7', {cwd:f.root}), 1); } finally { console.error = saved; }
  assert.match(errors.join('\n'), /admission held/); assert.match(errors.join('\n'), /ENOTDIR/);
  assert.equal(readFileSync(f.p.state, 'utf8'), 'state directory obstruction');
  assert.notEqual(readStoredReadiness(f.p.state, f.root).state, 'current');
  assert.equal(existsSync(join(f.fake, 'gh.jsonl')), false); noLaunch(f);
});
