// Explicit roots, private dependencies, pinned identities and process-owned leases in disposable offline bundles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadExecutionContext, contextHold, EMPTY_ADDITIVE, freezeAdditive } from './context.mts';
import { bindExecution } from '../cli/test/execution-fixture.mts';
import { factoryToml } from '../cli/test/config-fixture.mts';
import { projectId, receiptFile, recordIntent } from './ownership.mts';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { acquireRuntimeLease, releaseRuntimeLease, recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor, preflightRuntimeRemoval } from '../cli/src/runtime-ownership.mts';

function fixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'factory-context-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'project'); mkdirSync(join(root, '.factory'), { recursive: true });
  writeFileSync(join(root, '.factory/factory.toml'), factoryToml('one/project', { image: 'first-image' }));
  const runtime = bindExecution(root, { ...process.env, HOME: home, SANDCASTLE_STATE_DIR: join(home, 'state') });
  const input = { env: runtime.env, cwd: root, moduleRoot: runtime.directory };
  return { home, root, runtime, input, load: () => loadExecutionContext(input) };
}

test('canonical project-root cwd and complete selected runtime identity are mandatory', async t => {
  const f = fixture(t);
  const good = await f.load();
  assert.equal(good.projectRoot, f.root); assert.equal(good.runtimeRoot, f.runtime.directory);
  assert.equal(good.config.TRACKER.project, 'one/project');
  assert.equal(good.tsx, join(f.runtime.directory, 'node_modules/tsx/dist/cli.mjs'));
  assert.equal(good.sandcastle, join(f.runtime.directory, 'node_modules/@ai-hero/sandcastle/dist/main.js'));
  for (const role of ['implementation', 'verification', 'analysis', 'recovery'] as const) assert.deepEqual(good.additive[role], EMPTY_ADDITIVE);
  assert.throws(() => { good.config.config.image = 'mutated'; });
  assert.throws(() => { good.identity.runtime.id = 'mutated'; });
  assert.ok(Object.isFrozen(good.manifest.files));
  assert.throws(() => good.codePath('../project')); assert.throws(() => good.projectPath('/outside'));
  const alias = join(f.home, 'alias'); symlinkSync(f.root, alias);
  const runtimeAlias = join(f.home, 'runtime-alias'); symlinkSync(f.runtime.directory, runtimeAlias);
  for (const env of [
    { ...f.runtime.env, FACTORY_PROJECT_ROOT: undefined },
    { ...f.runtime.env, FACTORY_RUNTIME_ROOT: undefined },
    { ...f.runtime.env, FACTORY_RUNTIME_ROOT: runtimeAlias },
    { ...f.runtime.env, FACTORY_RUNTIME_ID: undefined },
    { ...f.runtime.env, FACTORY_RUNTIME_ID: '0'.repeat(64) },
    { ...f.runtime.env, FACTORY_PROJECT_ROOT: alias },
    { ...f.runtime.env, FACTORY_PROJECT_ROOT: f.root + '/.' },
    { ...f.runtime.env, SANDCASTLE_STATE_DIR: 'relative-state' },
  ]) await assert.rejects(loadExecutionContext({ ...f.input, env }), /execution context/);
  await assert.rejects(loadExecutionContext({ ...f.input, cwd: f.home }), /cwd must be project root/);
  await assert.rejects(loadExecutionContext({ ...f.input, moduleRoot: f.root }), /not from selected runtime/);
  await assert.rejects(loadExecutionContext({ ...f.input, env: { ...f.runtime.env, FACTORY_RUNTIME_ROOT: join(f.home, 'missing') } }), /execution context/);
  rmSync(join(f.runtime.directory, 'runtime-manifest.json'));
  await assert.rejects(f.load(), /Use Factory commands/);
});

test('missing/legacy settings never import code or installed sample configuration', async t => {
  const f = fixture(t), file = join(f.root, '.factory/factory.toml');
  writeFileSync(join(f.root, '.factory/config.mts'), 'throw Error("PROJECT CODE EXECUTED")');
  rmSync(file);
  await assert.rejects(f.load(), /config-missing/);
  writeFileSync(file, factoryToml('one/project').replace('version = 2', 'version = 1'));
  await assert.rejects(f.load(), /version.*no conversion/);
  writeFileSync(file, factoryToml('one/project') + '\n[agent]\nmodel = "custom"\n');
  await assert.rejects(f.load(), /agent.model/);
  writeFileSync(file, factoryToml('one/project') + '\n[instructions]\ncommon = ["not-loaded.md"]\n');
  await assert.rejects(f.load(), /Cannot load instruction file/);
  rmSync(file); symlinkSync(join(f.runtime.directory, 'package.json'), file);
  await assert.rejects(f.load(), /config-unsafe/);
  rmSync(join(f.root, '.factory'), { recursive: true, force: true });
  await assert.rejects(f.load(), /fresh-not-allowed/);
});

test('old run and ownership paths cannot acquire new-layout authority or be rewritten', async t => {
  const f = fixture(t), state = f.input.env.SANDCASTLE_STATE_DIR!;
  mkdirSync(state, {recursive:true});
  const runFile = join(state, 'one-project--7.json');
  const run = JSON.stringify({project:'one/project',iid:'7',stage:'stopped',evidenceDir:join(f.root,'.sandcastle/evidence/7')});
  writeFileSync(runFile, run);
  await assert.rejects(f.load(), /cross-layout evidence identity/);
  assert.equal(readFileSync(runFile, 'utf8'), run);
  writeFileSync(runFile, JSON.stringify({project:'one/project',iid:'7',stage:'stopped',evidenceDir:42}));
  await assert.rejects(f.load(), /unknown evidence identity/);
  rmSync(runFile);
  const tracker = {kind:'github',host:'github.com',project:'one/project'};
  const file = receiptFile(state, projectId(f.root,tracker), '7'); mkdirSync(dirname(file), {recursive:true});
  const at = new Date().toISOString();
  const receipt = JSON.stringify({version:1,projectId:projectId(f.root,tracker),projectRoot:f.root,gitCommonDir:join(f.root,'.git'),ticket:'7',branch:'7-fix',worktreePath:join(f.root,'.sandcastle/worktrees/7-fix'),runId:'old',creationIntent:{branch:true,worktree:true,at},createdAt:at,updatedAt:at,implementationBaseSha:'a'.repeat(40)});
  writeFileSync(file, receipt);
  await assert.rejects(f.load(), /cross-layout identity/);
  assert.throws(() => recordIntent(state, {root:f.root,tracker,ticket:'7',branch:'7-fix',runId:'new',branchToCreate:true,worktreeToCreate:true}), /cross-layout identity/);
  assert.equal(readFileSync(file, 'utf8'), receipt);
});

test('two projects share runtime bytes, not settings, templates, dependencies or artifacts', async t => {
  const f = fixture(t), second = join(f.home, 'second');
  mkdirSync(join(second, '.factory'), { recursive: true });
  writeFileSync(join(second, '.factory/factory.toml'), factoryToml('two/project', { image: 'second-image' }) + '\n[agent]\nfamily = "anthropic"\n');
  for (const root of [f.root, second]) {
    mkdirSync(join(root, 'node_modules/tsx/dist'), { recursive: true });
    writeFileSync(join(root, 'node_modules/tsx/dist/cli.mjs'), 'throw Error("PROJECT DEPENDENCY EXECUTED")');
    for (const name of ['main.mts', 'dispatch.mts', 'prompt.md', 'prompt.verify.md']) writeFileSync(join(root, '.factory', name), 'PROJECT POISON');
  }
  const one = await f.load(), two = await loadExecutionContext({ ...f.input, cwd: second, env: { ...f.runtime.env, FACTORY_PROJECT_ROOT: second } });
  assert.equal(one.manifest.id, two.manifest.id);
  assert.equal(one.config.config.image, 'first-image'); assert.equal(two.config.config.image, 'second-image');
  assert.equal(one.config.AGENT.family, 'openai'); assert.equal(two.config.AGENT.family, 'anthropic');
  assert.notEqual(one.policyIdentity, two.policyIdentity);
  assert.equal(one.templates['prompt.md'], two.templates['prompt.md']);
  assert.notEqual(one.templates['prompt.md'], 'PROJECT POISON');
  for (const context of [one, two]) {
    const output = context.projectPath('.factory/logs/proof.txt'); mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, context.config.TRACKER.project);
    const result = spawnSync(process.execPath, [context.tsx, context.codePath('config-read.mts'), context.assetRoot, 'image'], { cwd: context.projectRoot, env: { ...f.runtime.env, ...context.env }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, context.config.config.image);
  }
  assert.equal(readFileSync(one.projectPath('.factory/logs/proof.txt'), 'utf8'), 'one/project');
  assert.equal(readFileSync(two.projectPath('.factory/logs/proof.txt'), 'utf8'), 'two/project');
});

test('runtime source, private transitive dependencies, settings and template drift revoke authority', async t => {
  const f = fixture(t), context = await f.load();
  assert.equal(contextHold(context), undefined);
  const config = join(f.root, '.factory/factory.toml'), original = readFileSync(config, 'utf8');
  writeFileSync(config, original + '\n# formatting only\n'); assert.equal(contextHold(context), undefined);
  writeFileSync(config, original.replace('first-image', 'different-image'));
  assert.match(contextHold(context)!, /inputs changed/);
  assert.equal(context.config.config.image, 'first-image', 'the active snapshot does not follow edits');
  writeFileSync(config, original);
  const template = context.codePath('prompt.verify.md'), bytes = readFileSync(template);
  writeFileSync(template, 'altered verifier'); assert.match(contextHold(context)!, /mismatch/);
  writeFileSync(template, bytes);
  writeFileSync(context.tsx, 'poison'); assert.match(contextHold(context)!, /dependencies changed/);
});

test('instruction snapshots remain frozen and edits revoke authority', async t => {
  const f = fixture(t), config = join(f.root, '.factory/factory.toml');
  writeFileSync(join(f.root, 'common.md'), 'literal {{TICKET}} $(touch nope)');
  writeFileSync(join(f.root, 'verify.md'), 'verification only');
  writeFileSync(config, factoryToml('one/project') + '\n[instructions]\ncommon = ["common.md"]\nverification = ["verify.md"]\n');
  const context = await f.load();
  assert.equal(context.additive.implementation.text, 'literal {{TICKET}} $(touch nope)');
  assert.equal(context.additive.verification.text, 'literal {{TICKET}} $(touch nope)\n\nverification only');
  assert.ok(!context.additive.analysis.text.includes('verification only'));
  assert.ok(Object.isFrozen(context.additive.verification));
  assert.equal(contextHold(context), undefined);
  writeFileSync(join(f.root, 'common.md'), 'changed');
  assert.match(contextHold(context)!, /inputs changed/);
  assert.equal(context.additive.implementation.text, 'literal {{TICKET}} $(touch nope)');
  const next = await f.load(); assert.notEqual(next.policyIdentity, context.policyIdentity);
});

test('additive interface freezes literal bytes and hash maps without reading files or replacing templates', () => {
  const hashes = { 'notes.md': 'a'.repeat(64) }, frozen = freezeAdditive('{{TICKET}} is literal', hashes);
  hashes['notes.md'] = 'b'.repeat(64);
  assert.equal(frozen.text, '{{TICKET}} is literal'); assert.equal(frozen.hashes['notes.md'], 'a'.repeat(64));
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.hashes));
  assert.throws(() => freezeAdditive('', { file: 'invalid' }));
});

test('a handoff capability for A cannot be consumed or released by selected runtime B', t => {
  const f = fixture(t), source = join(f.runtime.staging, 'source'), store = dirname(f.runtime.directory);
  writeFileSync(join(source, 'orchestrator/prompt.analyze.md'), 'B template');
  const b = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: store, install: installPackages });
  const paths = { data: dirname(store), runtimes: store } as any;
  const lease = acquireRuntimeLease(paths, f.runtime.id);
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `const {executionContext,retainRuntime}=await import(${JSON.stringify(join(b.directory,'context.mts'))}); await retainRuntime(await executionContext());`], {
      cwd: f.root, env: { ...f.runtime.env, FACTORY_RUNTIME_ROOT: b.directory, FACTORY_RUNTIME_ID: b.id, FACTORY_RUNTIME_DEPENDENCIES: b.manifest.dependencies, FACTORY_HOST_RUNTIME_DEPENDENCIES: b.manifest.dependencies, FACTORY_RUNTIME_LEASE: lease.token }, encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Runtime lease identity mismatch/);
    const saved = JSON.parse(readFileSync(join(store, '.leases', lease.token+'.json'), 'utf8'));
    assert.equal(saved.id, f.runtime.id); assert.equal(saved.owner.pid, process.pid);
  } finally { releaseRuntimeLease(paths, lease.token); }
});

test('an active process pins A after B publication; detached child owns A until its cleanup finishes', async t => {
  const f = fixture(t), output = join(f.home, 'child.json'), ready = join(f.home, 'parent-ready');
  // Prepare a complete A whose stand-in main exercises the real context/lease helper.
  const source = join(f.runtime.staging, 'source');
  writeFileSync(join(source, 'orchestrator/main.mts'), `import {writeFileSync} from 'node:fs'; import {executionContext,retainRuntime} from './context.mts'; const c=await executionContext(); const lease=await retainRuntime(c); lease.pendingCleanup(); writeFileSync(${JSON.stringify(output)},JSON.stringify({env:c.env,token:lease.token,tsx:c.tsx})); process.stdin.resume(); process.stdin.once('data',()=>{lease.confirmedCleanup();lease.release();process.exit(0);});`);
  const store = dirname(f.runtime.directory), paths = { data: dirname(store), runtimes: store, runtimeDescriptor: join(dirname(store), 'runtime.json') } as any;
  const a = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: store, install: installPackages });
  // Supply the fixture tsx in source-independent private dependencies before publication, not afterward.
  // This invocation launches main with Node, so the placeholder tsx is never executed.
  withRuntimeLock(paths, () => { recordRuntimeOwnership(paths, a.id); writeRuntimeDescriptor(paths, a.id); });
  const env = { ...f.runtime.env, FACTORY_RUNTIME_ROOT: a.directory, FACTORY_RUNTIME_ID: a.id, FACTORY_RUNTIME_DEPENDENCIES: a.manifest.dependencies, FACTORY_HOST_RUNTIME_DEPENDENCIES: a.manifest.dependencies };
  const driver = join(f.home, 'driver.mts');
  writeFileSync(driver, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const {executionContext,retainRuntime}=await import(${JSON.stringify(join(a.directory, 'context.mts'))}); const c=await executionContext(), own=await retainRuntime(c); writeFileSync(${JSON.stringify(ready)},c.manifest.id); process.stdin.once('data',()=>{const lease=own.childLease();const child=spawn(process.execPath,[c.codePath('main.mts')],{cwd:c.projectRoot,env:{...process.env,...c.env,FACTORY_RUNTIME_LEASE:lease.token},detached:true,stdio:['pipe','ignore','inherit']});own.transfer(lease.token,child.pid);child.once('exit',()=>process.exit(0));process.stdin.once('data',()=>child.stdin.write('cleanup'));});`);
  const parent = spawn(process.execPath, [driver], { cwd: f.root, env, stdio: ['pipe', 'ignore', 'pipe'] });
  let diagnostics = ''; parent.stderr.on('data', bytes => { diagnostics += bytes; });
  t.after(() => { if (parent.exitCode === null) parent.kill('SIGKILL'); });
  const until = async (path: string) => {
    const deadline = Date.now() + 5000;
    while (!existsSync(path)) {
      if (parent.exitCode !== null || Date.now() >= deadline) assert.fail(diagnostics || `No fixture output: ${path}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  await until(ready);
  writeFileSync(join(source, 'orchestrator/prompt.analyze.md'), 'B template');
  const b = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: store, install: installPackages });
  withRuntimeLock(paths, () => { recordRuntimeOwnership(paths, b.id); writeRuntimeDescriptor(paths, b.id); });
  assert.notEqual(a.id, b.id);
  parent.stdin.write('launch'); await until(output);
  const child = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(child.env.FACTORY_RUNTIME_ID, a.id); assert.equal(child.env.FACTORY_RUNTIME_ROOT, a.directory);
  assert.equal(child.tsx, join(a.directory, 'node_modules/tsx/dist/cli.mjs'));
  const leases = join(store, '.leases');
  assert.equal(readdirSync(leases).length, 2, 'parent and detached child have independent tokens');
  assert.throws(() => withRuntimeLock(paths, () => preflightRuntimeRemoval(paths)), /live or unknown owner/);
  parent.stdin.write('cleanup'); const [code] = await once(parent, 'exit'); assert.equal(code, 0, diagnostics);
  assert.deepEqual(readdirSync(leases), [], 'only completed process-owned leases were released');
  assert.equal(JSON.parse(readFileSync(paths.runtimeDescriptor, 'utf8')).id, b.id);
});
