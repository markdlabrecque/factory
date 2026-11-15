// All launch boundaries use one complete runtime. Only disposable Git repos, fake packages and local Node children run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject, removeProject } from '../src/projects.mts';
import { resolveProject } from '../src/runs.mts';
import { projectWorkflow } from '../src/workflow.mts';
import { copyProblem, setProjectSchedule, writeScheduleConfig } from '../src/schedule.mts';
import { tick } from '../src/commands/tick.mts';
import { FakeSchedule } from '../src/platform/fake.mts';
import { prepareRecovery } from '../src/recovery-prepare.mts';
import { launchRecovery } from '../src/recovery-run.mts';
import { recordReview, recoveryCopyProblem } from '../src/recovery-review.mts';
import { observePass, readRecovery } from '../src/recovery-state.mts';
import { prepareRuntimeBundle, regenerateRuntimeManifest } from '../src/runtime-bundle.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../src/runtime-ownership.mts';
import { installedFixture } from './workflow-fixture.mts';
import { installPackages } from './runtime-fixture.mts';
import { factoryToml } from './config-fixture.mts';
import { preparedFixture } from './prepared-fixture.mts';
import { claimRun, readRuns } from '../../board/board.mts';
import { readAdmission } from '../../board/admission.mts';
import { requestRefresh, readAssessment } from '../../board/assessment.mts';

const cli = new URL('../bin/factory.mts', import.meta.url).pathname;
const worker = new URL('../../board/refresh-worker.mts', import.meta.url).href;
const assessment = new URL('../../board/assessment.mts', import.meta.url).href;
for (const mode of ['factory', 'project'] as const) {
  test(`${mode}: CLI, tick, unopted refresh, Board, preparation, readiness and recovery select identical code`, { timeout: 30_000 }, async t => {
    const home = mkdtempSync(join(tmpdir(), 'factory-routing-')), p = paths(home), root = join(home, 'site');
    t.after(() => rmSync(home, { recursive: true, force: true }));
    t.mock.method(console, 'log', () => {});
    mkdirSync(join(root, '.sandcastle'), { recursive: true });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main'); git('commit', '-q', '--allow-empty', '-m', 'fixture');
    const origin = join(home, 'origin.git'); execFileSync('git', ['init', '-q', '--bare', origin]);
    git('remote', 'add', 'origin', origin); git('push', '-q', 'origin', 'main'); git('branch', '7-saved');
    const config = join(root, '.sandcastle/factory.toml');
    writeFileSync(config, factoryToml('owner/repo') + (mode === 'project' ? '\n[workflow]\nmode = "project"\ndirectory = "workflow"\n' : ''));
    installedFixture(p);
    const source = join(home, 'workflow-source'), records = join(root, 'selected.jsonl');
    const recorder = `import {appendFileSync,readFileSync} from 'node:fs'; import {dirname} from 'node:path'; import {fileURLToPath} from 'node:url'; const root=process.env.FACTORY_PROJECT_ROOT; appendFileSync(root+'/selected.jsonl',JSON.stringify({entry:import.meta.url,cwd:process.cwd(),args:process.argv.slice(2),node:process.execPath,path:process.env.PATH,state:process.env.SANDCASTLE_STATE_DIR,project:root,runtime:process.env.FACTORY_RUNTIME_ROOT,id:process.env.FACTORY_RUNTIME_ID,mode:process.env.FACTORY_WORKFLOW_MODE,scheduled:process.env.FACTORY_SCHEDULED,readonly:process.env.FACTORY_REFRESH_ONLY})+'\\n');`;
    writeFileSync(join(source, 'orchestrator/dispatch.sh'), '#!/bin/sh\nexec node "$FACTORY_RUNTIME_ROOT/dispatch.mts" "$@"\n', { mode: 0o755 });
    writeFileSync(join(source, 'orchestrator/dispatch.mts'), recorder + `if(process.env.FACTORY_REFRESH_KEY){ const a=await import(${JSON.stringify(assessment)});a.clearRequest(process.env.SANDCASTLE_STATE_DIR,process.env.FACTORY_REFRESH_KEY,a.pendingRequests(process.env.SANDCASTLE_STATE_DIR).get(process.env.FACTORY_REFRESH_KEY));}`);
    writeFileSync(join(source, 'orchestrator/config-read.mts'), recorder + `process.stdout.write('0.01');`);
    writeFileSync(join(source, 'orchestrator/recovery-analysis.mts'), recorder + `process.stdout.write(readFileSync(root+'/prepared.json','utf8'));`);
    writeFileSync(join(source, 'orchestrator/capabilities.mts'), `import {appendFileSync} from 'node:fs'; export async function checkImageCapabilities(o){appendFileSync(${JSON.stringify(join(root, 'capabilities.jsonl'))},JSON.stringify({entry:import.meta.url,image:o.image})+'\\n');return {ok:true,imageId:'sha256:'+'a'.repeat(64),cached:false};}`);
    const bundle = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: p.runtimes, install: installPackages });
    withRuntimeLock(p, () => { recordRuntimeOwnership(p, bundle.id); writeRuntimeDescriptor(p, bundle.id); });
    if (mode === 'project') cpSync(bundle.directory, join(root, 'workflow'), { recursive: true });
    // Project-local decoys are never executable overrides, even when a complete explicit override is selected elsewhere.
    for (const name of ['dispatch.sh', 'dispatch.mts', 'main.mts', 'config-read.mts', 'capabilities.mts']) writeFileSync(join(root, '.sandcastle', name), 'throw Error("DECOY EXECUTED")');
    addProject(p, root);
    const selected = projectWorkflow(p, root), ctx = resolveProject(p, { project: root });
    assert.equal(copyProblem(root, p), null); assert.equal(ctx.root, root);
    assert.equal(selected.mode, mode);
    if (mode === 'project') recordReview(p, root);
    assert.equal(recoveryCopyProblem(p, root), null);
    const env = { ...process.env, HOME: home, FACTORY_HOME: home, SANDCASTLE_STATE_DIR: p.state, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, FACTORY_RUNTIME_DESCRIPTOR: p.runtimeDescriptor };
    for (const args of [['dispatch', '--project', root, '--dry-run'], ['run', '7', '--project', root]]) {
      const child = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
      assert.equal(child.status, 0, child.stdout + child.stderr);
    }
    writeScheduleConfig(p, { node: process.execPath, path: env.PATH });
    const backend = new FakeSchedule(p); backend.enabled = true; backend.timer = 'active';
    // A never-opted project receives read-only refresh, with the scheduler's saved Node/PATH.
    const refreshed = await tick(p, { backend, log: () => {}, maintenance: () => {} });
    assert.equal(refreshed.refreshed.site, 'ok');
    setProjectSchedule(p, root, true);
    let recoveryEnv: NodeJS.ProcessEnv | undefined;
    const passed = await tick(p, { backend, log: () => {}, clean: () => {}, maintenance: () => {}, recovery: async (_p, o) => { recoveryEnv = o.workflowEnv; } });
    assert.deepEqual(passed.passes, ['site']); assert.deepEqual(recoveryEnv, selected.env);
    // A project pause never runs a dispatch or refresh; local maintenance is a separate boundary.
    const read = () => readFileSync(records, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const beforePause = read().length; setProjectSchedule(p, root, false);
    await tick(p, { backend, log: () => {}, maintenance: () => {} }); assert.equal(read().length, beforePause);
    claimRun({ dir: p.state, project: 'owner/repo', iid: '7', pid: 99999999, cap: 99, patch: { stage: 'stopped', starting: undefined, branch: '7-saved', base: 'main' } });
    const key = 'owner_repo--7'; requestRefresh(p.state, key, '7', 'owner/repo');
    const runFile = join(p.state, key + '.json'), runBytes = readFileSync(runFile);
    const runBoard = (extra = {}) => spawnSync(process.execPath, ['--input-type=module', '-e', `const {executeRefresh}=await import(${JSON.stringify(worker)});await executeRefresh(${JSON.stringify(key)},5000);`], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
    const board = runBoard();
    assert.equal(board.status, 0, board.stderr); assert.equal(readAssessment(p.state, key)?.error, undefined, board.stderr);
    assert.deepEqual(readFileSync(runFile), runBytes, 'Board refresh preserves run bytes');
    assert.equal(readAdmission(p.state).claims[key], undefined, 'Board refresh did not admit work');
    const beforeRefusals = read().length;
    requestRefresh(p.state, key, '7', 'owner/repo');
    assert.equal(runBoard({ FACTORY_RUNTIME_DESCRIPTOR: '' }).status, 0);
    assert.match(readAssessment(p.state, key)!.error!, /Missing trusted Factory runtime descriptor/);
    const duplicate = join(home, 'ambiguous'); mkdirSync(join(duplicate, '.sandcastle'), { recursive: true });
    writeFileSync(join(duplicate, '.sandcastle/factory.toml'), factoryToml('owner/repo'));
    addProject(p, duplicate); requestRefresh(p.state, key, '7', 'owner/repo');
    assert.equal(runBoard().status, 0);
    assert.match(readAssessment(p.state, key)!.error!, /Several project roots match/);
    removeProject(p, duplicate);
    assert.equal(read().length, beforeRefusals, 'failed Board selection starts no workflow');
    assert.deepEqual(readFileSync(runFile), runBytes);
    // A new descriptor is visible to fresh invocations, but preparation/recovery children retain this pass's A.
    writeFileSync(join(source, 'orchestrator/prompt.analyze.md'), 'replacement runtime B');
    const replacement = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: p.runtimes, install: installPackages });
    withRuntimeLock(p, () => { recordRuntimeOwnership(p, replacement.id); writeRuntimeDescriptor(p, replacement.id); });
    assert.notEqual(replacement.id, bundle.id);
    if (mode === 'factory') assert.equal(projectWorkflow(p, root).id, replacement.id);
    const prepared = preparedFixture({ root, tracker: 'owner/repo', ticket: 7, dir: p.state });
    writeFileSync(join(root, 'prepared.json'), JSON.stringify(prepared));
    const ready = await prepareRecovery(p, { root, tracker: 'owner/repo', ticket: 7, base: 'main', dir: p.state, node: process.execPath, path: env.PATH, workflowEnv: selected.env });
    assert.deepEqual(ready, prepared); assert.equal(readRecovery(p, root).attempts.length, 0);
    observePass(p, root, { pass: 'a', at: new Date().toISOString(), jam: [7] });
    observePass(p, root, { pass: 'b', at: new Date().toISOString(), jam: [7] });
    let launch: any; let child: ReturnType<typeof spawn> | undefined;
    t.after(() => child?.kill('SIGKILL'));
    const result = await launchRecovery(p, { root, tracker: 'owner/repo', dir: p.state, ticket: 7, preparation: ready, node: process.execPath, path: env.PATH, workflowEnv: selected.env,
      spawn: (cmd, args, o) => { launch = { cmd, args, ...o }; child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); return child.pid!; } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(launch.cmd, process.execPath); assert.equal(launch.cwd, root); assert.equal(launch.env.PATH, env.PATH);
    assert.deepEqual(launch.args.slice(0, 2), [selected.tsx, selected.entrypoints.main]);
    for (const [key, value] of Object.entries(selected.env)) assert.equal(launch.env[key], value);
    assert.equal(launch.env.SANDCASTLE_STATE_DIR, p.state); assert.ok(launch.env.FACTORY_RUNTIME_LEASE);
    assert.equal(readRecovery(p, root).budgets['7'].used, 1);
    const capabilities = JSON.parse(readFileSync(join(root, 'capabilities.jsonl'), 'utf8').trim());
    assert.equal(capabilities.entry, new URL('capabilities.mts', 'file://' + selected.root + '/').href);
    const calls = read(); assert.equal(calls.length, 7);
    for (const c of calls) {
      assert.equal(c.cwd, root); assert.equal(c.project, root); assert.equal(c.runtime, selected.root); assert.equal(c.id, selected.id); assert.equal(c.mode, mode);
      assert.ok(c.entry.startsWith('file://' + selected.root + '/'));
      assert.equal(c.node, process.execPath); assert.equal(c.path, env.PATH); assert.equal(c.state, p.state);
    }
    assert.deepEqual(calls[0].args, ['--dry-run']); assert.deepEqual(calls[1].args, ['--issue', '7']);
    assert.deepEqual(calls[2].args, ['--refresh-only', '--base', 'main']);
    assert.equal(calls[3].scheduled, '1'); assert.deepEqual(calls[4].args, ['--refresh-only', '--ticket', '7', '--base', 'main']);
    const before = readRuns(p.state, false); assert.equal(before.length, 1);
    child!.kill('SIGKILL'); await once(child!, 'exit');
    // A stale selected override cannot be launched, scheduled, refreshed or reviewed by using Factory as a fallback.
    if (mode === 'project') {
      writeFileSync(join(selected.root, 'recovery-analysis.mts'), 'changed override');
      assert.match(copyProblem(root, p)!, /no Factory fallback/);
      assert.match(recoveryCopyProblem(p, root)!, /mismatch/);
      const held = await prepareRecovery(p, { root, tracker: 'owner/repo', ticket: 7, base: 'main', dir: p.state });
      assert.equal(held.state, 'held'); assert.equal(read().length, calls.length);
      writeFileSync(join(selected.root, 'runtime-manifest.json'), JSON.stringify(regenerateRuntimeManifest(selected.root)));
      assert.match(recoveryCopyProblem(p, root)!, /changed since recovery review/);
    }
  });
}
