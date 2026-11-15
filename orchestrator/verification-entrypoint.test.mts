// Execute normal readiness/setup/verifier gates with real Git and fixture-owned agent/Docker/tracker boundaries.
// No Docker daemon, credentials, browser installation, tracker or service manager is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bindExecution } from '../cli/test/execution-fixture.mts';
import { buildAssets } from '../cli/src/scaffold.mts';
import { fixtureReport } from './fixtures/verification.mts';
import { proofRoot } from './verification.mts';
import { MODEL_POLICY } from './model-policy.mts';

const cases = [
  ...['pass', 'instruction-edit', 'title', 'body', 'comment', 'parent', 'closed', 'excluded', 'claim', 'dirty', 'branch', 'missing-baseline', 'legacy-prompt', 'image-bad', 'setup-bad', 'image-changed', 'config-family', 'config-setup', 'runtime-template', 'tier-edit'].map(scenario => ({ scenario, family: 'openai' as const, tier: undefined as string | undefined })),
  ...(['openai', 'anthropic'] as const).flatMap(family => ['small', 'mid', 'large'].map(tier => ({ scenario: 'pass', family, tier }))),
  { scenario: 'pass', family: 'anthropic' as const, tier: undefined },
];
for (const { scenario, family, tier } of cases) {
  test(`normal entrypoint ${scenario} ${family}/${tier ?? 'default'}: only the proven tip may leave`, t => {
    const home = mkdtempSync(join(tmpdir(), 'verification-entry-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const root = join(home, 'site'), origin = join(home, 'origin.git'), state = join(home, 'state'), fake = join(home, 'fake'), bin = join(home, 'bin');
    mkdirSync(fake); mkdirSync(bin);
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(home, 'init', '-q', '--bare', '-b', 'main', origin); git(home, 'clone', '-q', origin, root);
    git(root, 'config', 'user.name', 't'); git(root, 'config', 'user.email', 't@t');
    writeFileSync(join(root, 'app.txt'), 'before'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'init'); git(root, 'push', '-q', 'origin', 'main');
    const baseline = git(root, 'rev-parse', 'main');
    for (const f of buildAssets({ profile: 'personal', repo: 'owner/repo', image: 'img' }, state)) {
      const p = join(root, f.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.content, { mode: f.mode });
    }
    const config = join(root, '.sandcastle/factory.toml');
    writeFileSync(config, readFileSync(config, 'utf8').replace('family = "openai"', `family = "${family}"`));
    if (scenario === 'pass' || scenario === 'instruction-edit') {
      writeFileSync(join(root, 'common.md'), 'Common {{TICKET}} $(literal) !`shell`');
      writeFileSync(join(root, 'impl.md'), 'implementation only');
      writeFileSync(join(root, 'verify.md'), 'verification only');
      writeFileSync(config, readFileSync(config, 'utf8') + '\n[instructions]\ncommon = ["common.md"]\nimplementation = ["impl.md"]\nverification = ["verify.md"]\n');
    }
    const sdk = join(home, 'fixture-sdk');
    cpSync(join(import.meta.dirname, 'fixtures/entrypoint/sandcastle'), sdk, { recursive: true });
    writeFileSync(join(sdk, 'index.mjs'), `
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd(), scenario = process.env.SCENARIO, fake = process.env.FAKE_STATE;
const git = (cwd, args) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();
export const pi = (model, options) => ({model, thinking: options.thinking});
export async function createSandbox(o) {
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
        writeFileSync(join(worktree,'app.txt'),'after'); git(worktree,['commit','-qam','implementation']);
        if (scenario === 'instruction-edit') { writeFileSync(join(root,'common.md'),'changed after invocation'); writeFileSync(join(fake,'frozen-after-edit.txt'),o.promptArgs.ADDITIVE_INSTRUCTIONS); }
        if (scenario === 'config-family') { const file=join(root,'.sandcastle/factory.toml'); writeFileSync(file,readFileSync(file,'utf8').replace('family = "openai"','family = "anthropic"')); }
        if (scenario === 'config-setup') { const file=join(root,'.sandcastle/factory.toml'); writeFileSync(file,readFileSync(file,'utf8').replace('setup = []','setup = [{command="changed setup"}]')); }
        if (scenario === 'runtime-template') writeFileSync(join(process.env.FACTORY_RUNTIME_ROOT,'prompt.verify.md'),'changed verifier');
        if (scenario === 'tier-edit') writeFileSync(join(fake,'changed'),'yes');
        if (scenario === 'missing-baseline') rmSync(join(root,'.git/objects',${JSON.stringify(baseline.slice(0, 2))},${JSON.stringify(baseline.slice(2))}));
        return {commits:['implementation']};
      }
      writeFileSync(join(fake,'verifier-started'),'yes');
      writeFileSync(join(evidence,'verdict.md'),'VERDICT: PASS\\nSynthetic checks');
      if (scenario !== 'legacy-prompt') writeFileSync(join(evidence,'verification.json'),${JSON.stringify(JSON.stringify(fixtureReport()))});
      writeFileSync(join(evidence,'check.txt'),'Assertions passed');
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
const out = capabilityDocker(a, process.env.FAKE_STATE);
if (out !== undefined) { console.log(out); process.exit(0); }
if (a[0] !== 'container' || a[1] !== 'inspect') process.exit(90);
if (!fs.existsSync(path.join(process.env.FAKE_STATE,'live'))) { console.error('No such container'); process.exit(1); }
console.log('sha256:'+'a'.repeat(64));
`, { mode: 0o755 });
    writeFileSync(join(bin, 'pi'), '#!/bin/sh\n[ "$1" = auth ] || exit 90\nprintf "fixture-token\\n"\n', { mode: 0o755 });
    const runtime = bindExecution(root, process.env, { sdk, overlays: false });
    for (const name of ['main.mts', 'dispatch.mts', 'prompt.md', 'prompt.verify.md']) writeFileSync(join(root, '.sandcastle', name), 'PROJECT POISON MUST NOT EXECUTE');
    assert.equal(existsSync(join(root, 'node_modules')), false, 'the project never supplies fixture dependencies');
    const result = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), '--issue', '7', '--base', 'main'], {
      cwd: root, encoding: 'utf8', env: { ...runtime.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: tier ? `Model tier: ${tier}\nThe login form must work.` : 'The login form must work.',
        FACTORY_FAKE_CAPABILITY: scenario === 'image-bad' ? 'bad' : '', FACTORY_READY_IMAGE: scenario === 'image-changed' ? `sha256:${'b'.repeat(64)}` : '' }, timeout: 15000,
    });
    writeFileSync(join(home, 'output.txt'), result.stdout + result.stderr);
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
      assert.equal(run.modelChoice.family, family);
      assert.equal(run.modelChoice.tier, expectedTier);
      assert.equal(run.modelChoice.source, tier ? 'ticket-tier' : 'factory-default');
      assert.equal(run.modelChoice.policyIdentity, 'factory-model-policy-v1');
      assert.equal(run.modelChoice.resolvedModel, run.implementationModel);
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: expectedModel, thinking: 'high' });
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'verifier-agent.json'), 'utf8')), { model: MODEL_POLICY[family].large, thinking: 'high' });
      const proof = JSON.parse(readFileSync(join(proofRoot(state, 'owner/repo', '7', run.verification.id), 'proof.json'), 'utf8'));
      assert.equal(proof.provenance.imageId, `sha256:${'a'.repeat(64)}`);
      assert.equal(proof.provenance.settings.image, 'img', 'configured settings stay comparable for existing-delivery continuation');
      assert.deepEqual(proof.provenance.settings.execution.runtime, { id: runtime.id, dependencies: runtime.manifest.dependencies });
      assert.equal(readFileSync(join(fake, 'implementer-instructions.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nimplementation only');
      assert.equal(readFileSync(join(fake, 'verifier-instructions.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nverification only');
      const implementationPrompt = readFileSync(join(fake, 'implementer-prompt.txt'), 'utf8');
      const verifierPrompt = readFileSync(join(fake, 'verifier-prompt.txt'), 'utf8');
      assert.ok(implementationPrompt.includes('Common {{TICKET}} $(literal) !`shell`\n\nimplementation only'));
      assert.ok(verifierPrompt.includes('Common {{TICKET}} $(literal) !`shell`\n\nverification only'));
      assert.ok(!implementationPrompt.includes('verification only')); assert.ok(!verifierPrompt.includes('implementation only'));
      assert.match(verifierPrompt, /verification\.json/);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.additive.implementation).sort(), ['common.md', 'impl.md']);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.additive.verification).sort(), ['common.md', 'verify.md']);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.templates).sort(), ['prompt.analyze.md','prompt.md','prompt.recover.md','prompt.verify.md']);
      assert.deepEqual(proof.provenance.code, Object.fromEntries(runtime.manifest.files.map(file => [file.path,file.sha256])));
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
      assert.equal(existsSync(join(fake, 'verifier-started')), !['missing-baseline', 'config-family', 'config-setup', 'runtime-template', 'tier-edit', 'instruction-edit'].includes(scenario), result.stdout + result.stderr);
      if (scenario === 'instruction-edit') assert.equal(readFileSync(join(fake, 'frozen-after-edit.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nimplementation only');
      if (['config-family', 'config-setup', 'runtime-template', 'tier-edit'].includes(scenario)) {
        const record = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
        assert.equal(record.modelChoice.family, 'openai'); assert.equal(record.modelChoice.tier, 'mid');
        assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: MODEL_POLICY.openai.mid, thinking: 'high' });
      }
      const reason = ({'instruction-edit':/inputs changed/,'config-family':/inputs changed/,'config-setup':/inputs changed/,'runtime-template':/mismatch/,'tier-edit':/Requirements changed/,title:/Requirements changed/,body:/Requirements changed/,comment:/Requirements changed/,parent:/parent changed/,closed:/is closed/,excluded:/excluded or needs human/,claim:/claim is no longer held/,dirty:/Verifier changed the branch/,branch:/moved from verified tip/,'missing-baseline':/bad object|missing|invalid|not a valid|unable to read/i,'legacy-prompt':/verification.json/} as Record<string, RegExp>)[scenario];
      assert.match(result.stdout + result.stderr, reason);
    }
  });
}
