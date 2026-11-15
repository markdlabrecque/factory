// Execute normal readiness/setup/verifier gates with real Git and fixture-owned agent/Docker/tracker boundaries.
// No Docker daemon, credentials, browser installation, tracker or service manager is used.
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bindExecution, stageExecutionPackages } from '../cli/test/execution-fixture.mts';
import { buildAssets } from '../cli/src/scaffold.mts';
import { paths } from '../cli/src/paths.mts';
import { Fake } from '../cli/src/platform/fake.mts';
import { install } from '../cli/src/commands/install.mts';
import { pathToFileURL } from 'node:url';
import { fixtureReport } from './fixtures/verification.mts';
import { proofRoot } from './verification.mts';
import { createHash } from 'node:crypto';
import { MODEL_POLICY } from './model-policy.mts';
import { prepareRuntimeBundle, regenerateRuntimeManifest } from '../cli/src/runtime-bundle.mts';
import { addProject } from '../cli/src/projects.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
import { resolveWorkflow } from './workflow.mts';


export async function normalEntrypointFixture(t: TestContext, scenario: string, family: 'openai' | 'anthropic', tier?: string, copied = false) {
    const home = mkdtempSync(join(tmpdir(), 'verification-entry-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const root = join(home, 'site'), origin = join(home, 'origin.git'), p = paths(home), state = copied ? p.state : join(home, 'state'), fake = join(home, 'fake'), bin = join(home, 'bin');
    mkdirSync(fake); mkdirSync(bin);
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(home, 'init', '-q', '--bare', '-b', 'main', origin); git(home, 'clone', '-q', origin, root);
    git(root, 'config', 'user.name', 't'); git(root, 'config', 'user.email', 't@t');
    writeFileSync(join(root, 'app.txt'), 'before'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'init'); git(root, 'push', '-q', 'origin', 'main');
    const baseline = git(root, 'rev-parse', 'main');
    const sdk = join(home, 'fixture-sdk');
    cpSync(join(import.meta.dirname, 'fixtures/entrypoint/sandcastle'), sdk, { recursive: true });
    writeFileSync(join(sdk, 'index.mjs'), `
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd(), scenario = process.env.SCENARIO, fake = process.env.FAKE_STATE;
const git = (cwd, args) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();
const readFileSyncBarrier = () => { try { return readFileSync(join(fake, 'release'), 'utf8') === 'yes'; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export const pi = (model, options) => {
  if (Object.keys(options.env ?? {}).some(key => key !== 'OPENAI_API_KEY')) throw Error('Unexpected credential handed to sandbox agent');
  return {model, thinking: options.thinking};
};
export async function createSandbox(o) {
  if (scenario === 'shared-projects') writeFileSync(join(fake, 'sandbox-options.json'), JSON.stringify(o));
  const worktree = join(root, '.sandcastle/worktrees', o.branch); mkdirSync(join(root, '.sandcastle/worktrees'), {recursive:true});
  git(root, ['worktree', 'add', '-b', o.branch, worktree, o.baseBranch]);
  writeFileSync(join(fake, 'live'), 'yes');
  return {worktreePath:worktree, sandboxId:'fixture-container',
    exec: async cmd => {
      if (cmd.startsWith('command -v playwright')) return scenario === 'setup-bad' ? {stdout:'browser preflight failed: Chromium launch',exitCode:1} : {stdout:'browser preflight OK',exitCode:0};
      if (cmd === 'hostname') return {stdout:'fixture-container',exitCode:0};
      return {stdout:execFileSync('sh',['-c',cmd],{cwd:worktree,encoding:'utf8'}),exitCode:0};
    },
    run: async o => {
      if (scenario === 'publication' || scenario === 'shared-projects' || scenario === 'project-override') {
        const { executionContext } = await import(process.env.FACTORY_RUNTIME_ROOT + '/context.mts');
        const c = await executionContext();
        writeFileSync(join(fake, o.name + '-identity.json'), JSON.stringify({root:c.runtimeRoot, identity:c.identity, templates:c.templates, additive:c.additive}));
      }
      writeFileSync(join(fake, o.name + '-agent.json'), JSON.stringify(o.agent));
      writeFileSync(join(fake, o.name + '-instructions.txt'), o.promptArgs.ADDITIVE_INSTRUCTIONS);
      // Contract stub: mark template shell blocks before a single callback substitution.
      // This deliberately does not claim execution of the real SDK.
      const template = readFileSync(o.promptFile, 'utf8');
      const marked = template.replace(/!\x60([^\x60]*)\x60/g, (_m, command) => '!SDK_MARK\x60' + command + '\x60');
      const rendered = marked.replace(/\\{\\{(\\w+)\\}\\}/g, (match, key) => o.promptArgs[key] ?? match);
      writeFileSync(join(fake, o.name + '-prompt.txt'), rendered);
      const evidence = o.promptArgs.EVIDENCE_DIR.replace('/home/agent/evidence', join(root,'.sandcastle/evidence'));
      if (o.name === 'implementer') {
        writeFileSync(join(fake,'implementer-started'),'yes');
        if (scenario === 'publication' && process.env.FIXTURE_BARRIER === 'yes') {
          while (!readFileSyncBarrier()) await new Promise(resolve => setTimeout(resolve, 10));
        }
        writeFileSync(join(worktree,'app.txt'),'after'); git(worktree,['commit','-qam','implementation']);
        if (scenario === 'instruction-edit') { writeFileSync(join(root,'common.md'),'changed after invocation'); writeFileSync(join(fake,'frozen-after-edit.txt'),o.promptArgs.ADDITIVE_INSTRUCTIONS); }
        if (scenario === 'config-family') { const file=join(root,'.sandcastle/factory.toml'); writeFileSync(file,readFileSync(file,'utf8').replace('family = "openai"','family = "anthropic"')); }
        if (scenario === 'config-setup') { const file=join(root,'.sandcastle/factory.toml'); writeFileSync(file,readFileSync(file,'utf8').replace('setup = []','setup = [{command="changed setup"}]')); }
        if (scenario === 'runtime-template') writeFileSync(join(process.env.FACTORY_RUNTIME_ROOT,'prompt.verify.md'),'changed verifier');
        if (scenario === 'tier-edit' || scenario === 'parent-plan') writeFileSync(join(fake,'changed'),'yes');
        if (scenario === 'missing-baseline') rmSync(join(root,'.git/objects',${JSON.stringify(baseline.slice(0, 2))},${JSON.stringify(baseline.slice(2))}));
        return {commits:['implementation']};
      }
      writeFileSync(join(fake,'verifier-started'),'yes');
      writeFileSync(join(evidence,'verdict.md'),'VERDICT: PASS\\nSynthetic checks');
      if (scenario !== 'legacy-prompt') writeFileSync(join(evidence,'verification.json'),${JSON.stringify(JSON.stringify(fixtureReport()))});
      writeFileSync(join(evidence,'check.txt'),process.env.FIXTURE_ARTIFACT ?? 'Assertions passed');
      if (scenario === 'dirty') writeFileSync(join(worktree,'app.txt'),'verifier changed tracked output');
      writeFileSync(join(fake,'changed'),'yes');
      return {commits:[]};
    },
    close: async () => {
      rmSync(join(fake,'live'));
      if (scenario === 'branch') git(worktree,['reset','--hard','HEAD~1']);
      if (scenario === 'claim') {
        const p = join(process.env.SANDCASTLE_STATE_DIR,'owner_repo--7.json');
        const r = JSON.parse(readFileSync(p)); r.claim = 'another'; writeFileSync(p,JSON.stringify(r));
      }
    }
  };
}
`);
    writeFileSync(join(sdk, 'docker.mjs'), 'export const docker = o => o;');
    // The package exports its sandbox adapter from this path.
    const pkg = JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'));
    const dockerTarget = pkg.exports['./sandboxes/docker'];
    writeFileSync(join(sdk, typeof dockerTarget === 'string' ? dockerTarget : 'docker.mjs'), 'export const docker = o => o;');
    if (copied) {
      await install(p, new Fake(p), { installPackages: dir => stageExecutionPackages(dir, sdk) });
      const { init } = await import(pathToFileURL(join(p.app, 'cli/src/commands/init.mts')).href);
      await init(p, root, { profile: 'personal', repo: 'owner/repo', image: 'img' });
      assert.deepEqual(readdirSync(join(root, '.sandcastle')).sort(), ['.env', '.env.example', '.gitignore', 'factory-dispatch.sh', 'factory.toml'].sort());
    } else {
      for (const f of buildAssets({ profile: 'personal', repo: 'owner/repo', image: 'img' }, state)) {
        const target = join(root, f.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, f.content, { mode: f.mode });
      }
    }
    const config = join(root, '.sandcastle/factory.toml');
    writeFileSync(config, readFileSync(config, 'utf8').replace('family = "openai"', `family = "${family}"`));
    if (scenario === 'pass' || scenario === 'instruction-edit' || scenario === 'publication') {
      writeFileSync(join(root, 'common.md'), 'Common {{TICKET}} $(literal) !`shell`');
      writeFileSync(join(root, 'impl.md'), 'implementation only');
      writeFileSync(join(root, 'verify.md'), 'verification only');
      writeFileSync(config, readFileSync(config, 'utf8') + '\n[instructions]\ncommon = ["common.md"]\nimplementation = ["impl.md"]\nverification = ["verify.md"]\n');
    }
    const ghSource = readFileSync(join(import.meta.dirname, 'fixtures/entrypoint/gh.mjs'), 'utf8');
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n` + ghSource.replace("const ticket =", `const scenario = process.env.SCENARIO;
const ticket =`).replace("const out = (v)", `if (changed) {
 if (scenario === 'title') ticket.title += ' edited';
 if (scenario === 'body') ticket.body += ' edited';
 if (scenario === 'tier-edit') ticket.body = 'Model tier: large\\nThe login form must work.';
 if (scenario === 'closed') ticket.state = 'CLOSED';
 if (scenario === 'excluded') ticket.labels.push({name:'needs-human'});
}
const out = (v)`).replace('parent: null,', "parent: changed && scenario === 'parent' ? {number:9} : null,").replace('out([[]]);', "out([[...(changed && scenario === 'comment' ? [{body:'Human added requirements',system:false}] : [])]]);"), { mode: 0o755 });
    writeFileSync(join(bin, 'docker'), `#!${process.execPath}
import * as fs from 'node:fs'; import * as path from 'node:path';
import { capabilityDocker } from ${JSON.stringify(join(import.meta.dirname, 'fixtures/capability-docker.mjs'))};
const a = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.FAKE_STATE, 'docker-calls.jsonl'), JSON.stringify(a)+'\\n');
const out = capabilityDocker(a, process.env.FAKE_STATE);
if (out !== undefined) { console.log(out); process.exit(0); }
if (a[0] !== 'container' || a[1] !== 'inspect') process.exit(90);
if (!fs.existsSync(path.join(process.env.FAKE_STATE,'live'))) { console.error('No such container'); process.exit(1); }
console.log('sha256:'+'a'.repeat(64));
`, { mode: 0o755 });
    writeFileSync(join(bin, 'pi'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_STATE/pi-calls"\n[ "$1" = auth ] || exit 90\nprintf "fixture-token\\n"\n', { mode: 0o755 });
    const runtime = bindExecution(root, process.env, { sdk, overlays: false, ...(copied ? { sourceRoot: p.app, paths: p } : {}) });
    if (!copied) for (const name of ['main.mts', 'dispatch.mts', 'prompt.md', 'prompt.verify.md']) writeFileSync(join(root, '.sandcastle', name), 'PROJECT POISON MUST NOT EXECUTE');
    if (copied) {
      assert.equal(runtime.directory, join(p.runtimes, runtime.id));
      assert.equal(runtime.env.FACTORY_RUNTIME_ROOT, runtime.directory);
      assert.equal(runtime.env.FACTORY_RUNTIME_ID, runtime.id);
      for (const name of ['main.mts', 'dispatch.mts', 'project-config.mts', 'prompt.md', 'prompt.verify.md', 'node_modules']) assert.equal(existsSync(join(root, '.sandcastle', name)), false, name);
      for (const name of ['main.mts', 'dispatch.mts', 'project-config.mts', 'prompt.md', 'prompt.verify.md']) writeFileSync(join(root, '.sandcastle', name), 'PROJECT POISON MUST NOT EXECUTE');
      writeFileSync(join(bin, 'npm'), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(fake, 'npm-called'))}, 'unexpected npm'); process.exit(91);\n`, { mode: 0o755 });
    }
    assert.equal(existsSync(join(root, 'node_modules')), false, 'the project never supplies fixture dependencies');
    if (scenario === 'project-override') {
      assert.ok(copied);
      const override = join(root, '.factory-workflow');
      cpSync(runtime.directory, override, { recursive: true });
      const template = join(override, 'prompt.verify.md'), main = join(override, 'main.mts');
      writeFileSync(template, readFileSync(template, 'utf8') + '\nCUSTOM OVERRIDE VERIFIER MARKER\n');
      writeFileSync(main, readFileSync(main, 'utf8') + '\nawait import("node:fs").then(fs => fs.writeFileSync(process.env.FAKE_STATE + "/custom-code-ran", "CUSTOM OVERRIDE CODE"));\n');
      writeFileSync(join(override, 'runtime-manifest.json'), JSON.stringify(regenerateRuntimeManifest(override)) + '\n');
      writeFileSync(config, readFileSync(config, 'utf8') + '\n[workflow]\nmode = "project"\ndirectory = ".factory-workflow"\n');
      const selected = resolveWorkflow(root, p.runtimeDescriptor);
      assert.equal(selected.root, override); assert.notEqual(selected.id, runtime.id);
      const env = { ...runtime.env, ...selected.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: 'Model tier: mid\nThe login form must work.' };
      const result = spawnSync(process.execPath, [selected.entrypoints.main, '--issue', '7', '--base', 'main'], { cwd: root, encoding: 'utf8', env, timeout: 15000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      for (const role of ['implementer', 'verifier']) {
        const identity = JSON.parse(readFileSync(join(fake, `${role}-identity.json`), 'utf8'));
        assert.equal(identity.root, override); assert.equal(identity.identity.runtime.id, selected.id);
        assert.deepEqual(identity.templates, JSON.parse(readFileSync(join(fake, 'implementer-identity.json'), 'utf8')).templates);
      }
      assert.ok(readFileSync(join(fake, 'verifier-prompt.txt'), 'utf8').includes('CUSTOM OVERRIDE VERIFIER MARKER'));
      assert.equal(readFileSync(join(fake, 'custom-code-ran'), 'utf8'), 'CUSTOM OVERRIDE CODE');
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: 'openai/gpt-6.1-terra', thinking: 'high' });
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'verifier-agent.json'), 'utf8')), { model: MODEL_POLICY.openai.large, thinking: 'high' });
      assert.ok(existsSync(join(fake, 'implementer-started')) && existsSync(join(fake, 'verifier-started')));
      const run = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
      const proof = JSON.parse(readFileSync(join(proofRoot(state, 'owner/repo', '7', run.verification.id), 'proof.json'), 'utf8'));
      assert.equal(proof.report.verdict, 'PASS');
      assert.equal(proof.provenance.code['main.mts'], selected.manifest.files.find((f: {path: string}) => f.path === 'main.mts')!.sha256);
      assert.equal(readFileSync(join(run.evidenceDir, 'check.txt'), 'utf8'), 'Assertions passed');
      addProject(p, root);
      const snapshot = (dir: string): Record<string, string> => {
        if (!existsSync(dir)) return {};
        return Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).map(d => {
          const path = join(d.parentPath, d.name); return [path, readFileSync(path).toString('base64')];
        }));
      };
      const beforeState = snapshot(state), beforeEvidence = snapshot(join(root, '.sandcastle/evidence')), beforeFake = snapshot(fake);
      rmSync(join(override, 'verification.mts'));
      const cli = join(p.app, 'cli/bin/factory.mts');
      const refused = spawnSync(process.execPath, [cli, 'run', '7', '--project', root], { cwd: root, encoding: 'utf8', env: { ...env, HOME: home, FACTORY_HOME: home }, timeout: 15000 });
      assert.notEqual(refused.status, 0, refused.stdout + refused.stderr);
      assert.match(refused.stdout + refused.stderr, /Invalid project workflow/);
      assert.match(refused.stdout + refused.stderr, /no Factory fallback is permitted/);
      assert.deepEqual(snapshot(state), beforeState); assert.deepEqual(snapshot(join(root, '.sandcastle/evidence')), beforeEvidence);
      assert.deepEqual(snapshot(fake), beforeFake, 'no tracker, sandbox or agent boundary ran');
      assert.equal(existsSync(join(fake, 'npm-called')), false);
      assert.equal(existsSync(join(root, 'node_modules')), false);
      assert.equal(existsSync(join(root, '.sandcastle/node_modules')), false);
      return;
    }
    if (scenario === 'shared-projects') {
      assert.ok(copied);
      const second = join(home, 'second'), secondOrigin = join(home, 'second.git'), secondFake = join(home, 'second-fake'), secondBin = join(home, 'second-bin');
      mkdirSync(secondFake); mkdirSync(secondBin);
      git(home, 'init', '-q', '--bare', '-b', 'main', secondOrigin); git(home, 'clone', '-q', secondOrigin, second);
      git(second, 'config', 'user.name', 't'); git(second, 'config', 'user.email', 't@t');
      writeFileSync(join(second, 'app.txt'), 'before second'); git(second, 'add', '.'); git(second, 'commit', '-qm', 'init'); git(second, 'push', '-q', 'origin', 'main');
      const { init } = await import(pathToFileURL(join(p.app, 'cli/src/commands/init.mts')).href);
      await init(p, second, { profile: 'personal', repo: 'other/project', image: 'second-image' });
      assert.deepEqual(readdirSync(join(second, '.sandcastle')).sort(), ['.env', '.env.example', '.gitignore', 'factory-dispatch.sh', 'factory.toml'].sort());
      const secondConfig = join(second, '.sandcastle/factory.toml');
      writeFileSync(secondConfig, readFileSync(secondConfig, 'utf8').replace('family = "openai"', 'family = "anthropic"'));
      for (const [project, label] of [[root, 'first'], [second, 'second']]) {
        const file = join(project, '.sandcastle/factory.toml');
        writeFileSync(file, readFileSync(file, 'utf8').replace('setup = []', `setup = [{command="echo ${label}-setup"}]`) + '\n[instructions]\ncommon = ["common.md"]\nimplementation = ["impl.md"]\nverification = ["verify.md"]\n');
        for (const [name, text] of [['common.md', 'common'], ['impl.md', 'implementer'], ['verify.md', 'verifier']]) writeFileSync(join(project, name), `${label}-${text}`);
        for (const name of ['main.mts', 'dispatch.mts', 'project-config.mts', 'prompt.md', 'prompt.verify.md']) writeFileSync(join(project, '.sandcastle', name), 'PROJECT POISON MUST NOT EXECUTE');
      }
      for (const name of ['docker', 'pi']) cpSync(join(bin, name), join(secondBin, name));
      writeFileSync(join(secondBin, 'npm'), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(secondFake, 'npm-called'))}, 'unexpected npm'); process.exit(91);\n`, { mode: 0o755 });
      writeFileSync(join(secondBin, 'gh'), readFileSync(join(bin, 'gh'), 'utf8').replaceAll('owner/repo', 'other/project'), { mode: 0o755 });
      const launch = (project: string, fakeDir: string, binDir: string, ticket: string, label: string) => {
        const child = spawn(process.execPath, [join(runtime.directory, 'main.mts'), '--issue', '7', '--base', 'main'], { cwd: project, env: { ...runtime.env, FACTORY_PROJECT_ROOT: project, PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fakeDir, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: ticket, FIXTURE_ARTIFACT: `${label}-artifact` }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
        t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
        return once(child, 'exit').then(([code]) => assert.equal(code, 0, output));
      };
      // The readiness probe uses a shared lock, so run the two asynchronous launches in order.
      await launch(root, fake, bin, 'Model tier: small\nThe login form must work.', 'first');
      await launch(second, secondFake, secondBin, 'The login form must work.', 'second');
      for (const [project, fakeDir, repo, label, modelFamily, modelTier, image] of [[root, fake, 'owner/repo', 'first', 'openai', 'small', 'img'], [second, secondFake, 'other/project', 'second', 'anthropic', 'mid', 'second-image']] as const) {
        const run = JSON.parse(readFileSync(join(state, `${repo.replace('/', '_')}--7.json`), 'utf8'));
        const proof = JSON.parse(readFileSync(join(proofRoot(state, repo, '7', run.verification.id), 'proof.json'), 'utf8'));
        for (const role of ['implementer', 'verifier']) {
          const identity = JSON.parse(readFileSync(join(fakeDir, `${role}-identity.json`), 'utf8'));
          assert.equal(identity.root, runtime.directory); assert.equal(identity.identity.runtime.id, runtime.id);
          assert.equal(readFileSync(join(fakeDir, `${role}-instructions.txt`), 'utf8'), `${label}-common\n\n${label}-${role}`);
          assert.deepEqual(JSON.parse(readFileSync(join(fakeDir, `${role}-agent.json`), 'utf8')), { model: MODEL_POLICY[modelFamily][role === 'implementer' ? modelTier : 'large'], thinking: 'high' });
        }
        assert.equal(run.modelChoice.family, modelFamily); assert.equal(run.modelChoice.tier, modelTier);
        assert.equal(run.modelChoice.source, label === 'first' ? 'ticket-tier' : 'factory-default');
        assert.equal(proof.provenance.settings.image, image);
        assert.equal(run.implementationModel, label === 'first' ? 'openai/gpt-6-luna' : 'pi-claude-subscription/claude-sonnet-5-5');
        assert.ok(JSON.stringify(proof.provenance.settings).includes(`${label}-setup`));
        assert.ok(readFileSync(join(fakeDir, 'sandbox-options.json'), 'utf8').includes(`${label}-setup`));
        const calls = readFileSync(join(fakeDir, 'gh.jsonl'), 'utf8');
        assert.ok(calls.includes(repo));
        assert.ok(!calls.includes(label === 'first' ? 'other/project' : 'owner/repo'));
        assert.equal(proof.report.verdict, 'PASS');
        assert.ok(run.evidenceDir.startsWith(join(project, '.sandcastle/evidence') + '/'));
        assert.equal(readFileSync(join(run.evidenceDir, 'check.txt'), 'utf8'), `${label}-artifact`);
        assert.ok(proof.artifacts.some((a: { path: string }) => a.path === 'check.txt'));
        assert.equal(existsSync(join(project, 'node_modules')), false); assert.equal(existsSync(join(project, '.sandcastle/node_modules')), false);
        assert.equal(existsSync(join(fakeDir, 'npm-called')), false);
      }
      return;
    }
    if (scenario === 'publication') {
      assert.ok(copied);
      const env = { ...runtime.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: 'Model tier: mid\nThe login form must work.', FIXTURE_BARRIER: 'yes' };
      const child = spawn(process.execPath, [join(runtime.directory, 'main.mts'), '--issue', '7', '--base', 'main'], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
      t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
      const exited = once(child, 'exit');
      const deadline = Date.now() + 15000;
      while (!existsSync(join(fake, 'implementer-started'))) {
        assert.ok(child.exitCode === null && child.signalCode === null && Date.now() < deadline, output || 'implementer did not reach barrier');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const aImpl = JSON.parse(readFileSync(join(fake, 'implementer-identity.json'), 'utf8'));
      const source = join(runtime.staging, 'source');
      const verifyTemplate = join(source, 'cli/templates/project/prompt.verify.md');
      writeFileSync(verifyTemplate, readFileSync(verifyTemplate, 'utf8') + '\nB VERIFIER TEMPLATE MARKER\n');
      const b = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: p.runtimes, install: dir => stageExecutionPackages(dir, sdk) });
      withRuntimeLock(p, () => { recordRuntimeOwnership(p, b.id); writeRuntimeDescriptor(p, b.id); });
      assert.notEqual(b.id, runtime.id);
      assert.equal(child.exitCode, null);
      writeFileSync(join(fake, 'release'), 'yes');
      const [code] = await exited; assert.equal(code, 0, output);
      const aVerify = JSON.parse(readFileSync(join(fake, 'verifier-identity.json'), 'utf8'));
      assert.equal(aImpl.root, runtime.directory); assert.equal(aImpl.identity.runtime.id, runtime.id);
      assert.deepEqual(aVerify, aImpl);
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: 'openai/gpt-6.1-terra', thinking: 'high' });
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'verifier-agent.json'), 'utf8')), { model: MODEL_POLICY.openai.large, thinking: 'high' });
      assert.equal(readFileSync(join(fake, 'implementer-instructions.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nimplementation only');
      assert.equal(readFileSync(join(fake, 'verifier-instructions.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nverification only');
      assert.ok(!readFileSync(join(fake, 'verifier-prompt.txt'), 'utf8').includes('B VERIFIER TEMPLATE MARKER'));
      const selected = resolveWorkflow(root, p.runtimeDescriptor);
      assert.equal(selected.id, b.id); assert.equal(selected.root, b.directory);
      git(root, 'push', '-q', 'origin', '--delete', '7-fix-login');
      git(root, 'worktree', 'remove', '--force', join(root, '.sandcastle/worktrees/7-fix-login'));
      git(root, 'branch', '-D', '7-fix-login');
      rmSync(state, { recursive: true, force: true }); mkdirSync(state, { recursive: true });
      rmSync(join(fake, 'changed'), { force: true });
      const fresh = spawnSync(process.execPath, [selected.entrypoints.main, '--issue', '7', '--base', 'main'], { cwd: root, encoding: 'utf8', env: { ...env, ...selected.env, FIXTURE_BARRIER: '' }, timeout: 15000 });
      assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
      const bImpl = JSON.parse(readFileSync(join(fake, 'implementer-identity.json'), 'utf8'));
      const bVerify = JSON.parse(readFileSync(join(fake, 'verifier-identity.json'), 'utf8'));
      assert.equal(bImpl.root, b.directory); assert.equal(bImpl.identity.runtime.id, b.id); assert.deepEqual(bVerify, bImpl);
      assert.notEqual(bImpl.templates['prompt.verify.md'], aImpl.templates['prompt.verify.md']);
      assert.deepEqual(bImpl.additive, aImpl.additive);
      assert.ok(readFileSync(join(fake, 'verifier-prompt.txt'), 'utf8').includes('B VERIFIER TEMPLATE MARKER'));
      assert.equal(readFileSync(join(fake, 'verifier-instructions.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nverification only');
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: 'openai/gpt-6.1-terra', thinking: 'high' });
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'verifier-agent.json'), 'utf8')), { model: MODEL_POLICY.openai.large, thinking: 'high' });
      assert.equal(existsSync(join(fake, 'npm-called')), false);
      assert.equal(existsSync(join(root, 'node_modules')), false);
      assert.equal(existsSync(join(root, '.sandcastle/node_modules')), false);
      return;
    }
    if (scenario === 'instruction-missing') {
      writeFileSync(config, readFileSync(config, 'utf8') + '\n[instructions]\ncommon = ["missing.md"]\n');
    }
    const result = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), '--issue', '7', '--base', 'main'], {
      cwd: root, encoding: 'utf8', env: { ...runtime.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state, FAKE_CONTEXT_PARENT: ['pass','parent-plan','parent-read-failed'].includes(scenario) ? '90' : '', FAKE_TICKET_BODY: tier ? `Model tier: ${tier}\nThe login form must work.` : 'The login form must work.',
        FACTORY_FAKE_CAPABILITY: scenario === 'image-bad' ? 'bad' : '', FACTORY_READY_IMAGE: scenario === 'image-changed' ? `sha256:${'b'.repeat(64)}` : '' }, timeout: 15000,
    });
    writeFileSync(join(home, 'output.txt'), result.stdout + result.stderr);
    if (copied) {
      assert.equal(existsSync(join(fake, 'npm-called')), false, 'execution must not invoke npm');
      assert.equal(existsSync(join(root, 'node_modules')), false, 'execution must not create project dependencies');
      assert.equal(existsSync(join(root, '.sandcastle/node_modules')), false, 'execution must not fall back to project dependencies');
    }
    if (scenario === 'pass') {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const tip = git(origin, 'rev-parse', '7-fix-login');
      const run = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
      assert.equal(run.verification.tip, tip);
      assert.equal(run.implementationBaseSha, baseline);
      assert.ok(run.executionId);
      const expectedTier = tier ?? 'mid';
      const expectedModel = MODEL_POLICY[family][expectedTier as 'small' | 'mid' | 'large'];
      assert.equal(run.implementationModel, expectedModel);
      if (copied) {
        assert.equal(expectedModel, 'openai/gpt-6.1-terra');
        assert.ok(run.evidenceDir.startsWith(join(root, '.sandcastle/evidence') + '/'));
        assert.ok(existsSync(join(fake, 'implementer-started')) && existsSync(join(fake, 'verifier-started')));
      }
      assert.equal(run.modelChoice.family, family);
      assert.equal(run.modelChoice.tier, expectedTier);
      assert.equal(run.modelChoice.source, tier ? 'ticket-tier' : 'factory-default');
      assert.equal(run.modelChoice.policyIdentity, 'factory-model-policy-v1');
      assert.equal(run.modelChoice.resolvedModel, run.implementationModel);
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: expectedModel, thinking: 'high' });
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'verifier-agent.json'), 'utf8')), { model: MODEL_POLICY[family].large, thinking: 'high' });
      const proof = JSON.parse(readFileSync(join(proofRoot(state, 'owner/repo', '7', run.verification.id), 'proof.json'), 'utf8'));
      if (copied) {
        assert.match(result.stdout, /implementer openai\/gpt-6\.1-terra/);
        assert.equal(proof.report.verdict, 'PASS');
        assert.equal(proof.tip, tip);
        assert.equal(proof.baseline, baseline);
        assert.equal(proof.executionId, run.executionId);
        assert.ok(proof.artifacts.some((a: { path: string }) => a.path === 'check.txt'));
        assert.equal(readFileSync(join(run.evidenceDir, 'check.txt'), 'utf8'), 'Assertions passed');
      }
      assert.equal(proof.provenance.imageId, `sha256:${'a'.repeat(64)}`);
      assert.equal(proof.provenance.settings.image, 'img', 'configured settings stay comparable for existing-delivery continuation');
      assert.deepEqual(proof.provenance.settings.execution.runtime, { id: runtime.id, dependencies: runtime.manifest.dependencies });
      assert.equal(readFileSync(join(fake, 'implementer-instructions.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nimplementation only');
      assert.equal(readFileSync(join(fake, 'verifier-instructions.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nverification only');
      const implementationPrompt = readFileSync(join(fake, 'implementer-prompt.txt'), 'utf8');
      const verifierPrompt = readFileSync(join(fake, 'verifier-prompt.txt'), 'utf8');
      const inputDir = join(state, 'ticket-inputs', 'owner_repo--7', run.executionId);
      const frozenText = readFileSync(join(inputDir, 'ticket-context.txt'), 'utf8');
      const sources = JSON.parse(readFileSync(join(inputDir, 'ticket-sources.json'), 'utf8'));
      const snapshot = JSON.parse(readFileSync(join(inputDir, 'ticket-context.json'), 'utf8'));
      assert.ok(implementationPrompt.includes(frozenText)); assert.ok(verifierPrompt.includes(frozenText));
      assert.match(frozenText, /Complete parent body with packaging requirements/);
      assert.match(frozenText, /Agreed parent decisions and implementation plan/);
      assert.equal(snapshot.contentHash, proof.requirementsHash); assert.equal(sources.contentHash, run.ticketHash);
      assert.equal(createHash('sha256').update(frozenText).digest('hex'), sources.renderedSha256);
      assert.ok(implementationPrompt.includes('Common {{TICKET}} $(literal) !`shell`\n\nimplementation only'));
      assert.ok(verifierPrompt.includes('Common {{TICKET}} $(literal) !`shell`\n\nverification only'));
      assert.ok(!implementationPrompt.includes('verification only')); assert.ok(!verifierPrompt.includes('implementation only'));
      assert.match(verifierPrompt, /verification\.json/);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.additive.implementation).sort(), ['common.md', 'impl.md']);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.additive.verification).sort(), ['common.md', 'verify.md']);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.templates).sort(), ['prompt.analyze.md','prompt.md','prompt.recover.md','prompt.verify.md']);
      assert.deepEqual(proof.provenance.code, Object.fromEntries(runtime.manifest.files.map(file => [file.path,file.sha256])));
    } else if (['parent-read-failed', 'instruction-missing'].includes(scenario)) {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(existsSync(join(fake, 'implementer-started')), false);
      assert.equal(existsSync(join(fake, 'verifier-started')), false);
      assert.equal(existsSync(join(state, 'owner_repo--7.json')), false, 'input failure creates no stopped run');
      assert.equal(existsSync(join(fake, 'live')), false);
      assert.match(result.stdout + result.stderr, scenario === 'parent-read-failed' ? /parent #90 notes: read-failed/ : /missing.md/);
    } else if (['image-bad', 'setup-bad', 'image-changed'].includes(scenario)) {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(existsSync(join(fake, 'implementer-started')), false);
      assert.equal(existsSync(join(fake, 'verifier-started')), false);
      assert.equal(git(origin, 'branch', '--list', '7-fix-login'), '');
      assert.match(result.stdout + result.stderr, scenario === 'image-changed' ? /Image changed after readiness/ : /readiness hold|provisioning failure/);
      if (scenario === 'setup-bad') {
        const run = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
        assert.match(readFileSync(join(run.evidenceDir, 'setup-browser-preflight.log'), 'utf8'), /Chromium launch/);
        assert.equal(existsSync(join(run.evidenceDir, 'browser-preflight.log')), false);
        assert.equal(existsSync(join(fake, 'live')), false, 'actual sandbox is closed after setup refusal');
      }
    } else {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(git(origin, 'branch', '--list', '7-fix-login'), '', result.stdout + result.stderr);
      const log = readFileSync(join(fake, 'gh.jsonl'), 'utf8');
      assert.ok(!log.includes('"merge"'), result.stdout + result.stderr);
      assert.equal(existsSync(join(fake, 'verifier-started')), !['missing-baseline', 'config-family', 'config-setup', 'runtime-template', 'tier-edit', 'instruction-edit', 'parent-plan'].includes(scenario), result.stdout + result.stderr);
      if (scenario === 'instruction-edit') assert.equal(readFileSync(join(fake, 'frozen-after-edit.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nimplementation only');
      if (['config-family', 'config-setup', 'runtime-template', 'tier-edit'].includes(scenario)) {
        const record = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
        assert.equal(record.modelChoice.family, 'openai'); assert.equal(record.modelChoice.tier, 'mid');
        assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: MODEL_POLICY.openai.mid, thinking: 'high' });
      }
      const reason = ({'parent-plan':/Requirements changed/,'instruction-edit':/inputs changed/,'config-family':/inputs changed/,'config-setup':/inputs changed/,'runtime-template':/mismatch/,'tier-edit':/Requirements changed/,title:/Requirements changed/,body:/Requirements changed/,comment:/Requirements changed/,parent:/parent changed/,closed:/is closed/,excluded:/excluded or needs human/,claim:/claim is no longer held/,dirty:/Verifier changed the branch/,branch:/moved from verified tip/,'missing-baseline':/bad object|missing|invalid|not a valid|unable to read/i,'legacy-prompt':/verification.json/} as Record<string, RegExp>)[scenario];
      assert.match(result.stdout + result.stderr, reason);
    }
}
