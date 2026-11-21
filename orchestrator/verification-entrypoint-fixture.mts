// Execute normal readiness/setup/verifier gates and optionally hand genuine closed custody to public-CLI journeys.
// Uses real Git and fixture-owned agent/Docker/tracker boundaries.
// No Docker daemon, credentials, browser installation, tracker or service manager is used.
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import cp, { execFileSync, spawn, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bindExecution, stageExecutionPackages } from '../cli/test/execution-fixture.mts';
import { buildAssets } from '../cli/src/scaffold.mts';
import { paths } from '../cli/src/paths.mts';
import { Fake, FakeSchedule } from '../cli/src/platform/fake.mts';
import { inspectSupervisorHost } from '../cli/src/supervisor-host.mts';
import { readSupervisor } from '../cli/src/supervisor-state.mts';
import { ADVISORY_PROFILE_ID } from '../cli/src/supervisor-advisory-contract.mts';
import { structuredContextSource } from './ticket-context-source.mts';
import { install } from '../cli/src/commands/install.mts';
import { pathToFileURL } from 'node:url';
import { fixtureReport } from './fixtures/verification.mts';
import { createProof, proofRoot, readProof } from './verification.mts';
import { createHash } from 'node:crypto';
import { MODEL_POLICY } from './model-policy.mts';
import { supervisorHash } from './supervisor-contract.mts';
import { prepareRuntimeBundle, regenerateRuntimeManifest } from '../cli/src/runtime-bundle.mts';
import { addProject } from '../cli/src/projects.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
import { resolveWorkflow } from './workflow.mts';
import { claimSupervisorHold, checkSupervisorHold } from '../cli/src/supervisor-admission.mts';
import { readPayloadCustody, payloadRunClosed } from './payload-custody.mts';
import { readAdmission } from '../board/admission.mts';
import {claimRun} from '../board/board.mts';
import { prepareFixtureFromRuntime } from './fixtures/acceptance-preparation.mts';
import { prepareFixtureBaseline } from './fixtures/acceptance-baseline-preparation.mts';
import { startCandidateHost } from './fixtures/acceptance-candidate-host.mts';


export async function normalEntrypointFixture(t: TestContext, scenario: string, family: 'openai' | 'anthropic', tier?: string, copied = false, publicJourney?: (context: any) => Promise<void>, adopted = false) {
    const home = mkdtempSync(join(tmpdir(), 'verification-entry-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const root = join(home, 'site'), origin = join(home, 'origin.git'), p = paths(home), state = copied ? p.state : join(home, 'state'), fake = join(home, 'fake'), bin = join(home, 'bin');
    mkdirSync(fake); mkdirSync(bin);
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(home, 'init', '-q', '--bare', '-b', 'main', origin); git(home, 'clone', '-q', origin, root);
    git(root, 'config', 'user.name', 't'); git(root, 'config', 'user.email', 't@t');
    writeFileSync(join(root, 'app.txt'), 'before'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'init'); git(root, 'push', '-q', 'origin', 'main');
    const baseline = git(root, 'rev-parse', 'main');
    if(scenario==='acceptance-replay-pass')writeFileSync(join(root,'site.rows'),'implementer/source dirt must not be transported');
    const sdk = join(home, 'fixture-sdk');
    cpSync(join(import.meta.dirname, 'fixtures/entrypoint/sandcastle'), sdk, { recursive: true });
    writeFileSync(join(sdk, 'index.mjs'), `
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net'; import tls from 'node:tls'; import http from 'node:http'; import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const denyNetwork = () => { throw Error('Offline normal fixture: outbound network denied'); };
globalThis.fetch = denyNetwork;
net.connect = denyNetwork; net.createConnection = denyNetwork; net.Socket.prototype.connect = denyNetwork;
tls.connect = denyNetwork; http.request = denyNetwork; http.get = denyNetwork; https.request = denyNetwork; https.get = denyNetwork;
syncBuiltinESMExports();
const root = process.cwd(), scenario = process.env.SCENARIO, fake = process.env.FAKE_STATE;
const git = (cwd, args) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();
const readFileSyncBarrier = () => { try { return readFileSync(join(fake, 'release'), 'utf8') === 'yes'; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export const pi = (model, options) => {
  if (Object.keys(options.env ?? {}).some(key => key !== 'OPENAI_API_KEY')) throw Error('Unexpected credential handed to sandbox agent');
  return Object.defineProperty({model, thinking: options.thinking}, 'sessionRoot', {value:options.sessionStorage?.hostSessionsDir});
};
export async function createSandbox(o) {
  if (scenario.startsWith('no-commit-custody')) {
    const { readPayloadCustody } = await import(process.env.FACTORY_RUNTIME_ROOT + '/payload-custody.mts');
    const run = JSON.parse(readFileSync(join(process.env.SANDCASTLE_STATE_DIR,'owner_repo--7.json')));
    const c = readPayloadCustody(process.env.SANDCASTLE_STATE_DIR,run.payloadCustody);
    if (c.sealed || c.payloads.size !== 1 || [...c.payloads.values()][0].container) throw Error('SDK create lacked durable pending custody');
    writeFileSync(join(fake,'custody-before-create'),'pending');
  }
  writeFileSync(join(fake, 'sandbox-options.json'), JSON.stringify(o));
  const worktree = join(root, '.factory/worktrees', o.branch); mkdirSync(join(root, '.factory/worktrees'), {recursive:true});
  git(root, ['worktree', 'add', '-b', o.branch, worktree, o.baseBranch]);
  writeFileSync(join(fake, 'live'), 'yes');
  if (scenario === 'custody-create-error') throw Error('ambiguous SDK create after platform acceptance');
  return {worktreePath:worktree, sandboxId:scenario === 'custody-registration-error' ? undefined : 'fixture-container',
    exec: async cmd => {
      if (cmd.startsWith('command -v playwright')) return scenario === 'setup-bad' ? {stdout:'browser preflight failed: Chromium launch',exitCode:1} : {stdout:'browser preflight OK',exitCode:0};
      if (cmd === 'hostname') return {stdout:'fixture-container',exitCode:0};
      if (scenario === 'continuation-stalled-git' && cmd === 'git rev-parse --verify HEAD' && existsSync(join(fake,'continuation-started'))) {
        setImmediate(() => process.kill(process.pid, 'SIGTERM'));
        return new Promise(() => {});
      }
      if (cmd.includes(' status --porcelain') && scenario === 'no-commit-unknown-worktree') return {stdout:'',exitCode:1};
      return {stdout:execFileSync('sh',['-c',cmd],{cwd:worktree,encoding:'utf8'}),exitCode:0};
    },
    run: async o => {
      if (scenario === 'pass' || scenario === 'readiness-acceptance' || scenario === 'publication' || scenario === 'shared-projects' || scenario === 'project-override') {
        const { executionContext } = await import(process.env.FACTORY_RUNTIME_ROOT + '/context.mts');
        const c = await executionContext();
        writeFileSync(join(fake, o.name + '-identity.json'), JSON.stringify({root:c.runtimeRoot, assets:c.assetRoot, identity:c.identity, templates:c.templates, additive:c.additive}));
      }
      writeFileSync(join(fake, o.name + '-agent.json'), JSON.stringify(o.agent));
      writeFileSync(join(fake, o.name + '-instructions.txt'), o.promptArgs.ADDITIVE_INSTRUCTIONS);
      // Contract stub: mark template shell blocks before a single callback substitution.
      // This deliberately does not claim execution of the real SDK.
      const template = readFileSync(o.promptFile, 'utf8');
      const marked = template.replace(/!\x60([^\x60]*)\x60/g, (_m, command) => '!SDK_MARK\x60' + command + '\x60');
      const rendered = marked.replace(/\\{\\{(\\w+)\\}\\}/g, (match, key) => o.promptArgs[key] ?? match);
      writeFileSync(join(fake, o.name + '-prompt.txt'), rendered);
      const evidence = o.promptArgs.EVIDENCE_DIR.replace('/home/agent/evidence', join(root,'.factory/evidence'));
      if (o.name === 'implementer') {
        writeFileSync(join(fake,'implementer-started'),'yes');
        if (scenario === 'primary-cleanup-error') throw Error('fixture primary error');
        if (scenario === 'publication' && process.env.FIXTURE_BARRIER === 'yes') {
          while (!readFileSyncBarrier()) await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (scenario.startsWith('continuation-')) {
          const executionId = o.promptArgs.EXECUTION_ID;
          const writeOutcome = (turn, status) => writeFileSync(join(evidence, 'implementation-' + turn + '-outcome.json'), JSON.stringify({version:1, executionId, turn, status, reason:'fixture outcome', nextAction:'finish behavior'}));
          const session = join(o.agent.sessionRoot, 'fixture.jsonl'); mkdirSync(o.agent.sessionRoot, {recursive:true});
          const reply = text => writeFileSync(session, JSON.stringify({type:'message',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text}]}}));
          writeOutcome('initial', scenario === 'continuation-false-success' ? 'implemented' : 'incomplete');
          reply('Initial exploration and green baseline');
          if (scenario === 'continuation-wrong-checkout') git(worktree,['switch','-c','wrong-branch']);
          if (scenario === 'continuation-superseded') {
            const file = join(process.env.SANDCASTLE_STATE_DIR,'owner_repo--7.json');
            writeFileSync(file, JSON.stringify({...JSON.parse(readFileSync(file)), executionId:'replacement',note:'replacement owns this run'}));
          }
          return { commits:[], iterations:[{sessionFilePath:session}], resume:async (correction, options) => {
            const { readPayloadCustody } = await import(process.env.FACTORY_RUNTIME_ROOT + '/payload-custody.mts');
            const run = JSON.parse(readFileSync(join(process.env.SANDCASTLE_STATE_DIR,'owner_repo--7.json')));
            const c = readPayloadCustody(process.env.SANDCASTLE_STATE_DIR,run.payloadCustody);
            if (!c.continued || c.binding.executionId !== executionId || c.binding.baseline !== o.promptArgs.BASE_SHA || c.sealed || options.signal.aborted || options.completionSignal.length) throw Error('unsafe continuation arguments');
            if (existsSync(join(fake,'continuation-started'))) throw Error('unexpected third implementation turn');
            writeFileSync(join(fake,'continuation-started'),correction);
            if (scenario === 'continuation-error') throw Error('fixture resume failed');
            if (scenario === 'continuation-stalled') {
              setImmediate(() => process.kill(process.pid, 'SIGTERM'));
              return new Promise(() => {});
            }
            reply('Continuation result');
            if (scenario === 'continuation-exhausted') {
              writeOutcome('continuation', 'incomplete');
              return { commits:[], iterations:[{sessionFilePath:session}], resume:async () => { throw Error('unexpected third implementation turn'); } };
            }
            writeOutcome('continuation', 'implemented');
            writeFileSync(join(worktree,'app.txt'),'after'); git(worktree,['commit','-qam','continued implementation']);
            return { commits:scenario === 'continuation-outside-commit' ? [] : [{sha:git(worktree,['rev-parse','HEAD']).trim()}], iterations:[{sessionFilePath:session}] };
          } };
        }
        if (scenario.startsWith('no-commit')) {
          if (scenario.startsWith('no-commit-custody')) {
            const { readPayloadCustody } = await import(process.env.FACTORY_RUNTIME_ROOT + '/payload-custody.mts');
            const run = JSON.parse(readFileSync(join(process.env.SANDCASTLE_STATE_DIR,'owner_repo--7.json')));
            const c = readPayloadCustody(process.env.SANDCASTLE_STATE_DIR,run.payloadCustody);
            if (c.sealed || [...c.payloads.values()][0].container !== 'fixture-container') throw Error('Actual returned sandbox was not registered');
          }
          if (scenario === 'no-commit-dirty') writeFileSync(join(worktree,'app.txt'),'uncommitted');
          const session = join(o.agent.sessionRoot, 'fixture.jsonl'); mkdirSync(o.agent.sessionRoot, {recursive:true});
          if (scenario !== 'no-commit-unavailable') writeFileSync(session, JSON.stringify({type:'message',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'I cannot implement this safely because the agreed audit, Q&A and plan in comments are unavailable. Inspect /private/context. token=fixture-secret'}]}}));
          if (scenario === 'no-commit-malformed-report') writeFileSync(join(evidence,'blocked.json'),'{');
          if (scenario === 'no-commit-blocked') writeFileSync(join(evidence,'blocked.json'),JSON.stringify({blockers:[{iid:8,what:'dependency',evidence:'open ticket'}]}));
          if (scenario === 'no-commit-stale') {
            const file = join(process.env.SANDCASTLE_STATE_DIR,'owner_repo--7.json');
            const run = JSON.parse(readFileSync(file));
            writeFileSync(file, JSON.stringify({...run, executionId:'new-execution',note:'new execution owns this record',evidenceDir:'new-evidence',stage:'implementing'}));
          }
          return {commits:[], iterations:[{sessionFilePath:session}], stdout:'arbitrary raw log must never be reported'};
        }
        if (scenario === 'acceptance-implementer-tamper') {
          mkdirSync(join(worktree,'probes'));
          const dishonest = {version:1,assertions:['A-summary','A-order'].map(assertionId=>({assertionId,status:'pass',failureId:null}))};
          writeFileSync(join(worktree,'probes/export.mjs'),'process.stdout.write('+JSON.stringify(JSON.stringify(dishonest))+');');
          git(worktree,['add','probes/export.mjs']);
        } else writeFileSync(join(worktree,'app.txt'),'after');
        git(worktree,['commit','-qam','implementation']);
        if (scenario === 'instruction-edit') { writeFileSync(join(root,'common.md'),'changed after invocation'); writeFileSync(join(fake,'frozen-after-edit.txt'),o.promptArgs.ADDITIVE_INSTRUCTIONS); }
        if (scenario === 'config-family') { const file=join(root,'.factory/factory.toml'); writeFileSync(file,readFileSync(file,'utf8').replace('family = "openai"','family = "anthropic"')); }
        if (scenario === 'config-setup') { const file=join(root,'.factory/factory.toml'); writeFileSync(file,readFileSync(file,'utf8').replace('setup = []','setup = [{command="changed setup"}]')); }
        if (scenario === 'runtime-template') writeFileSync(join(process.env.FACTORY_RUNTIME_ROOT,'prompt.verify.md'),'changed verifier');
        if (scenario === 'tier-edit' || scenario === 'parent-plan') writeFileSync(join(fake,'changed'),'yes');
        if (scenario === 'missing-baseline') rmSync(join(root,'.git/objects',${JSON.stringify(baseline.slice(0, 2))},${JSON.stringify(baseline.slice(2))}));
        return {commits:['implementation']};
      }
      if (scenario.startsWith('continuation-') && existsSync(join(fake,'verifier-started'))) throw Error('verifier ran twice');
      writeFileSync(join(fake,'verifier-started'),'yes');
      if (scenario === 'continuation-failed-verification') throw Error('fixture verifier failure');
      writeFileSync(join(evidence,'verdict.md'),'VERDICT: PASS\\nSynthetic checks');
      if (scenario !== 'legacy-prompt') {
        const report = ${JSON.stringify(fixtureReport())};
        if (scenario === 'acceptance-omitted-criterion') report.criteria.pop();
        if (['acceptance-replay-pass','acceptance-manual-evidence-missing'].includes(scenario)) {
          // The independent SDK stub supplies synthetic verifier output, not live browser/human acceptance.
          const frozenCriteria = JSON.parse(o.promptArgs.ACCEPTANCE_CRITERIA);
          const feature = frozenCriteria.find(c => c.id === 'C-feature');
          if (feature?.verificationEvidence.map(o => o.kind).join(',') !== 'browser,interactive') throw Error('Verifier did not receive its original evidence obligations');
          report.criteria[0].obligations = [
            { requirement: 'Summary panel screenshot', observation: 'Synthetic summary panel', evidence: ['after-summary.png'] },
            { requirement: 'Keyboard submission recording', observation: 'Synthetic keyboard submission', evidence: ['after-keyboard.png','after-keyboard.webm'] },
          ];
          report.criteria[2].obligations = [
            { requirement: 'independent documentation review', observation: 'Synthetic scope for host-retained review', evidence: [] },
          ];
          for (const path of report.criteria[0].obligations.flatMap(o => o.evidence)) {
            report.criteria[0].evidence.push(path);
            report.artifacts.push({ path, kind: path.endsWith('.png') ? 'image' : 'video', phase: 'after' });
            // Only container headers and distinct bytes are relevant to this host-policy fixture.
            const header = Buffer.from(path.endsWith('.png') ? '89504e470d0a1a0a' : '1a45dfa3', 'hex');
            writeFileSync(join(evidence,path), Buffer.concat([header, Buffer.from('synthetic fixture: ' + path)]));
          }
        }
        writeFileSync(join(evidence,'verification.json'),JSON.stringify(report));
      }
      writeFileSync(join(evidence,'check.txt'),process.env.FIXTURE_ARTIFACT ?? 'Assertions passed');
      if (scenario === 'dirty') writeFileSync(join(worktree,'app.txt'),'verifier changed tracked output');
      writeFileSync(join(fake,'changed'),'yes');
      if(['pass','readiness-acceptance','publication','shared-projects','project-override','continuation-pass','acceptance-replay-pass','acceptance-manual-evidence-missing','acceptance-replay-unknown','acceptance-replay-infrastructure','acceptance-replay-mismatched-bundle','acceptance-replay-changed-candidate','acceptance-implementer-tamper','acceptance-reset-unsupported'].includes(scenario)) await new Promise(resolve=>{
        const watcher=watch(fake,()=>{if(existsSync(join(fake,'candidate-ready'))){watcher.close();resolve();}});
        writeFileSync(join(fake,'candidate-request'),'host observation requested');
        if(existsSync(join(fake,'candidate-ready'))){watcher.close();resolve();}
      });
      return {commits:[]};
    },
    close: async () => {
      writeFileSync(join(fake,'cleanup-attempted'),'yes');
      writeFileSync(join(fake,'closed'), 'yes');
      if (['sandbox-cleanup', 'no-commit-cleanup-error', 'primary-cleanup-error'].includes(scenario)) throw Error('fixture teardown failed');
      if (scenario !== 'no-commit-unconfirmed-cleanup') rmSync(join(fake,'live'));
      if (scenario === 'no-commit-blocked') git(root,['worktree','remove',worktree]);
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
      assert.deepEqual(readdirSync(join(root, '.factory')).sort(), ['.env', '.env.example', '.gitignore', 'factory-dispatch.sh', 'factory.toml'].sort());
    } else {
      for (const f of buildAssets({ profile: 'personal', repo: 'owner/repo', image: 'img' }, state)) {
        const target = join(root, f.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, f.content, { mode: f.mode });
      }
    }
    const config = join(root, '.factory/factory.toml');
    writeFileSync(config, readFileSync(config, 'utf8').replace('family = "openai"', `family = "${family}"`));
    if (scenario.startsWith('no-commit-custody')) writeFileSync(config,readFileSync(config,'utf8') + `
[supervisor]
enabled = true
max_tokens = 10000000
max_cost_usd = 100
max_calls = 10
[supervisor.diagnosis]
max_tokens = 5000000
max_cost_usd = 50
max_calls = 5
timeout_seconds = 15
[supervisor.review]
max_tokens = 5000000
max_cost_usd = 50
max_calls = 5
timeout_seconds = 600
`);
    const completeAcceptance = scenario === 'readiness-acceptance';
    if (scenario === 'pass' || scenario === 'acceptance-replay-pass' || completeAcceptance || scenario === 'instruction-edit' || scenario === 'publication') {
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
    if (publicJourney) {
      const gh = join(bin,'gh');
      writeFileSync(gh,readFileSync(gh,'utf8').replace('const [a, b] = args;', `const [a, b] = args;
if (!((a === 'label' || a === 'issue' || a === 'pr') && ['list','view','checks'].includes(b) || a === 'api' && !args.some(v => ['POST','PUT','PATCH','DELETE'].includes(v)))) process.exit(90);
`));
    }
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
    if (!copied) for (const name of ['main.mts', 'dispatch.mts', 'prompt.md', 'prompt.verify.md']) writeFileSync(join(root, '.factory', name), 'PROJECT POISON MUST NOT EXECUTE');
    if (copied) {
      assert.equal(runtime.directory, join(p.runtimes, runtime.id));
      assert.equal(runtime.env.FACTORY_RUNTIME_ROOT, runtime.directory);
      assert.equal(runtime.env.FACTORY_RUNTIME_ID, runtime.id);
      for (const name of ['main.mts', 'dispatch.mts', 'project-config.mts', 'prompt.md', 'prompt.verify.md', 'node_modules']) assert.equal(existsSync(join(root, '.factory', name)), false, name);
      for (const name of ['main.mts', 'dispatch.mts', 'project-config.mts', 'prompt.md', 'prompt.verify.md']) writeFileSync(join(root, '.factory', name), 'PROJECT POISON MUST NOT EXECUTE');
      writeFileSync(join(bin, 'npm'), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(fake, 'npm-called'))}, 'unexpected npm'); process.exit(91);\n`, { mode: 0o755 });
    }
    assert.equal(existsSync(join(root, 'node_modules')), false, 'the project never supplies fixture dependencies');
    if (scenario === 'supervisor-held') {
      const hold = claimSupervisorHold(state, { project: { root, tracker: { kind: 'github', host: 'github.com', project: 'owner/repo' } },
        invocationId: 'entrypoint-exclusion', runtimeRoot: runtime.directory,
        rollout: { olderRuntimesQuiesced: true, unmanagedWorkQuiesced: true } });
      const env = { ...runtime.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SANDCASTLE_STATE_DIR: state };
      for (const name of ['main.mts', 'dispatch.mts', 'context-process.mts']) {
        const result = spawnSync(process.execPath, [join(runtime.directory, name), '--issue', '7', '--base', 'main'], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
        assert.notEqual(result.status, 0, name); assert.match(result.stderr, /held by supervisor/, name);
        assert(checkSupervisorHold(state, hold));
      }
      for (const name of ['gh.jsonl', 'docker-calls.jsonl', 'pi-calls', 'live', 'implementer-agent.json'])
        assert.equal(existsSync(join(fake, name)), false, `${name}: no tracker/provider/readiness/container work`);
      assert.equal(existsSync(join(state, 'owner_repo--7.json')), false);
      return;
    }
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
      prepareFixtureFromRuntime(selected.root, root, env);
      prepareFixtureBaseline(selected.root, root, env);
      await startCandidateHost(t,selected.root,root,env);
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
      const beforeState = snapshot(state), beforeEvidence = snapshot(join(root, '.factory/evidence')), beforeFake = snapshot(fake);
      rmSync(join(override, 'verification.mts'));
      const cli = join(p.app, 'cli/bin/factory.mts');
      const refused = spawnSync(process.execPath, [cli, 'run', '7', '--project', root], { cwd: root, encoding: 'utf8', env: { ...env, HOME: home, FACTORY_HOME: home }, timeout: 15000 });
      assert.notEqual(refused.status, 0, refused.stdout + refused.stderr);
      assert.match(refused.stdout + refused.stderr, /Invalid project workflow/);
      assert.match(refused.stdout + refused.stderr, /no Factory fallback is permitted/);
      assert.deepEqual(snapshot(state), beforeState); assert.deepEqual(snapshot(join(root, '.factory/evidence')), beforeEvidence);
      assert.deepEqual(snapshot(fake), beforeFake, 'no tracker, sandbox or agent boundary ran');
      assert.equal(existsSync(join(fake, 'npm-called')), false);
      assert.equal(existsSync(join(root, 'node_modules')), false);
      assert.equal(existsSync(join(root, '.factory/node_modules')), false);
      assert.equal(existsSync(join(root, '.sandcastle')), false, 'supported execution must never create old-layout assets');
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
      assert.deepEqual(readdirSync(join(second, '.factory')).sort(), ['.env', '.env.example', '.gitignore', 'factory-dispatch.sh', 'factory.toml'].sort());
      const secondConfig = join(second, '.factory/factory.toml');
      writeFileSync(secondConfig, readFileSync(secondConfig, 'utf8').replace('family = "openai"', 'family = "anthropic"'));
      for (const [project, label] of [[root, 'first'], [second, 'second']]) {
        const file = join(project, '.factory/factory.toml');
        writeFileSync(file, readFileSync(file, 'utf8').replace('setup = []', `setup = [{command="echo ${label}-setup"}]`) + '\n[instructions]\ncommon = ["common.md"]\nimplementation = ["impl.md"]\nverification = ["verify.md"]\n');
        for (const [name, text] of [['common.md', 'common'], ['impl.md', 'implementer'], ['verify.md', 'verifier']]) writeFileSync(join(project, name), `${label}-${text}`);
        for (const name of ['main.mts', 'dispatch.mts', 'project-config.mts', 'prompt.md', 'prompt.verify.md']) writeFileSync(join(project, '.factory', name), 'PROJECT POISON MUST NOT EXECUTE');
      }
      for (const name of ['docker', 'pi']) cpSync(join(bin, name), join(secondBin, name));
      writeFileSync(join(secondBin, 'npm'), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(secondFake, 'npm-called'))}, 'unexpected npm'); process.exit(91);\n`, { mode: 0o755 });
      writeFileSync(join(secondBin, 'gh'), readFileSync(join(bin, 'gh'), 'utf8').replaceAll('owner/repo', 'other/project'), { mode: 0o755 });
      const launch = async (project: string, fakeDir: string, binDir: string, ticket: string, label: string) => {
        const env = { ...runtime.env, FACTORY_PROJECT_ROOT: project, PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fakeDir, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: ticket, FIXTURE_ARTIFACT: `${label}-artifact` };
        prepareFixtureFromRuntime(runtime.directory, project, env);
        prepareFixtureBaseline(runtime.directory, project, env);
        await startCandidateHost(t,runtime.directory,project,env);
        const child = spawn(process.execPath, [join(runtime.directory, 'main.mts'), '--issue', '7', '--base', 'main'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
        assert.ok(run.evidenceDir.startsWith(join(project, '.factory/evidence') + '/'));
        assert.equal(readFileSync(join(run.evidenceDir, 'check.txt'), 'utf8'), `${label}-artifact`);
        assert.ok(proof.artifacts.some((a: { path: string }) => a.path === 'check.txt'));
        assert.equal(existsSync(join(project, 'node_modules')), false); assert.equal(existsSync(join(project, '.factory/node_modules')), false);
        assert.equal(existsSync(join(fakeDir, 'npm-called')), false);
      }
      return;
    }
    if (scenario === 'publication') {
      assert.ok(copied);
      const env = { ...runtime.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: 'Model tier: mid\nThe login form must work.', FIXTURE_BARRIER: 'yes' };
      prepareFixtureFromRuntime(runtime.directory, root, env);
      prepareFixtureBaseline(runtime.directory, root, env);
      await startCandidateHost(t,runtime.directory,root,env);
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
      git(root, 'worktree', 'remove', '--force', join(root, '.factory/worktrees/7-fix-login'));
      git(root, 'branch', '-D', '7-fix-login');
      rmSync(state, { recursive: true, force: true }); mkdirSync(state, { recursive: true });
      rmSync(join(fake, 'changed'), { force: true });
      prepareFixtureFromRuntime(selected.root, root, { ...env, ...selected.env, FIXTURE_BARRIER: '' });
      prepareFixtureBaseline(selected.root,root,{...env,...selected.env,FIXTURE_BARRIER:''});
      rmSync(join(fake,'candidate-request'),{force:true});rmSync(join(fake,'candidate-ready'),{force:true});
      await startCandidateHost(t,selected.root,root,{...env,...selected.env,FIXTURE_BARRIER:''});
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
      assert.equal(existsSync(join(root, '.factory/node_modules')), false);
      assert.equal(existsSync(join(root, '.sandcastle')), false, 'supported execution must never create old-layout assets');
      return;
    }
    if (scenario === 'instruction-missing') {
      writeFileSync(config, readFileSync(config, 'utf8') + '\n[instructions]\ncommon = ["missing.md"]\n');
    }
    if (scenario === 'no-commit-unavailable') {
      mkdirSync(state, {recursive:true});
      const oldEvidence = join(root,'.factory/evidence/7/old-execution'); mkdirSync(oldEvidence, {recursive:true});
      writeFileSync(join(oldEvidence,'no-commit.json'), JSON.stringify({agentReply:'old explanation must not be reused'}));
      writeFileSync(join(state,'owner_repo--7.json'), JSON.stringify({iid:'7',project:'owner/repo',stage:'stopped',executionId:'old-execution',evidenceDir:oldEvidence,note:'old explanation must not be reused'}));
    }
    const runEnv = { ...runtime.env, GIT_ALLOW_PROTOCOL: 'file', PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state, FAKE_CONTEXT_PARENT: ['pass','acceptance-replay-pass','readiness-acceptance','parent-plan','parent-read-failed'].includes(scenario) ? '90' : '', FAKE_TICKET_BODY: completeAcceptance ? `Model tier: mid\n\n## Full child specification\nPackage the login form using the parent decisions and ordered implementation plan.\n\n## Acceptance\n- Validate empty input without submitting.\n- Preserve the selected return URL.\n- Test keyboard submission.\n\nLiteral task data: {{TICKET}} !\`not a command\` $(not-a-command)` : tier ? `Model tier: ${tier}\nThe login form must work.` : 'The login form must work.',
        FACTORY_FAKE_CAPABILITY: scenario === 'image-bad' ? 'bad' : '', FACTORY_READY_IMAGE: scenario === 'image-changed' ? `sha256:${'b'.repeat(64)}` : '' };
    let preparedBaseline: import('./acceptance-baseline-admission.mts').BaselineAdmissionIdentity | undefined;
    if (!['instruction-missing', 'parent-read-failed', 'image-bad', 'image-changed'].includes(scenario)) {
      prepareFixtureFromRuntime(runtime.directory, root, runEnv);
      preparedBaseline=prepareFixtureBaseline(runtime.directory, root, runEnv);
      await startCandidateHost(t,runtime.directory,root,runEnv);
    }
    const pending=adopted?claimRun({dir:state,project:'owner/repo',iid:'7',pid:process.pid,cap:2,patch:{base:'main',acceptanceBaseline:preparedBaseline,implementationBaseSha:preparedBaseline?.sha}}):undefined;
    if(pending)assert.ok(pending.ok);
    const result = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), '--issue', '7', '--base', 'main'], {
      cwd: root, encoding: 'utf8', env: {...runEnv,...(pending?.ok?{FACTORY_LAUNCH_CLAIM:pending.run.claim}:{})}, timeout: 15000,
    });
    writeFileSync(join(home, 'output.txt'), result.stdout + result.stderr);
    if (copied) {
      assert.equal(existsSync(join(fake, 'npm-called')), false, 'execution must not invoke npm');
      assert.equal(existsSync(join(root, 'node_modules')), false, 'execution must not create project dependencies');
      assert.equal(existsSync(join(root, '.factory/node_modules')), false, 'execution must not fall back to project dependencies');
    }
    if (['custody-create-error','custody-registration-error'].includes(scenario)) {
      assert.notEqual(result.status,0,result.stdout + result.stderr);
      const run = JSON.parse(readFileSync(join(state,'owner_repo--7.json'),'utf8'));
      const c = readPayloadCustody(state,run.payloadCustody);
      assert.equal(c.sealed,false); assert.equal(c.payloads.size,1);
      assert.equal([...c.payloads.values()][0].container,undefined,'ambiguous construction/registration never invents an identity');
      assert.equal(existsSync(join(fake,'live')),true);
      assert.equal(Object.keys(readAdmission(state).entries).length,1,'dead controller retains managed custody');
      assert.equal(existsSync(join(fake,'implementer-started')),false);
      assert.throws(() => claimSupervisorHold(state,{project:{root,tracker:{kind:'github',host:'github.com',project:'owner/repo'}},
        invocationId:'interrupted-producer',runtimeRoot:runtime.directory,savedRun:{key:'owner_repo--7',executionId:run.executionId},
        rollout:{olderRuntimesQuiesced:true,unmanagedWorkQuiesced:true}}),/not quiescent/);
      return;
    }
    if (scenario === 'primary-cleanup-error') {
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(fake, 'closed')), true);
      assert.equal(existsSync(join(fake, 'live')), true);
      assert.equal(existsSync(join(fake, 'verifier-started')), false);
      const run = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
      assert.match(run.note, /fixture primary error/); assert.match(run.note, /fixture teardown failed/);
      assert.equal(git(origin, 'branch', '--list', '7-fix-login'), '');
      return;
    }
    if (scenario.startsWith('continuation-')) {
      const resumed = !['continuation-false-success','continuation-superseded','continuation-wrong-checkout'].includes(scenario);
      const verified = ['continuation-pass','continuation-failed-verification'].includes(scenario);
      const run = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
      assert.equal(result.status, scenario === 'continuation-pass' ? 0 : 1, result.stdout + result.stderr);
      assert.equal(existsSync(join(fake,'continuation-started')), resumed);
      assert.equal(existsSync(join(fake,'verifier-started')), verified);
      assert.equal(existsSync(join(fake,'live')), false);
      const { readPayloadCustody } = await import('./payload-custody.mts');
      const payload = readPayloadCustody(state, run.payloadCustody);
      const stalled = scenario.startsWith('continuation-stalled');
      assert.equal(payload.continued, resumed); assert.equal(payload.sealed, !stalled);
      if (resumed) {
        assert.match(readFileSync(join(run.evidenceDir,'implementation-initial-diagnostic.json'),'utf8'), /Initial exploration and green baseline/);
        assert.match(readFileSync(join(fake,'continuation-started'),'utf8'), /unchanged baseline checks did not implement/);
      }
      if (scenario === 'continuation-pass') {
        const proof = JSON.parse(readFileSync(join(proofRoot(state, 'owner/repo', '7', run.verification.id), 'proof.json'), 'utf8'));
        assert.equal(proof.baseline, baseline); assert.equal(proof.tip, git(origin, 'rev-parse', '7-fix-login'));
        assert.equal(proof.executionId, run.executionId);
      } else {
        assert.equal(run.verification, undefined);
        const remote = spawnSync('git', ['rev-parse', '--verify', 'refs/heads/7-fix-login'], {cwd: origin});
        assert.notEqual(remote.status, 0, 'no branch pushed');
      }
      if (scenario === 'continuation-exhausted') {
        const final = JSON.parse(readFileSync(join(run.evidenceDir,'no-commit.json'),'utf8'));
        assert.match(final.continuation, /continuation-exhausted/); assert.equal(final.agentReply, 'Continuation result');
      }
      if (scenario === 'continuation-error') assert.match(run.note, /continuation-exhausted: fixture resume failed/);
      if (stalled) assert.match(result.stderr, /did not settle; launch and cleanup ownership retained/);
      if (scenario === 'continuation-outside-commit') assert.match(run.note, /resumed SDK commit report disagrees/);
      if (scenario === 'continuation-wrong-checkout') assert.match(run.note, /clean original checkout no longer confirmed/);
      if (scenario === 'continuation-superseded') assert.equal(run.note, 'replacement owns this run');
      return;
    }
    if (scenario.startsWith('no-commit')) {
      if (scenario === 'no-commit-blocked') assert.equal(result.status, 0, result.stdout + result.stderr);
      else assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(existsSync(join(fake, 'closed')), true, `cleanup completed before exit: ${result.stdout}${result.stderr}`);
      assert.equal(existsSync(join(fake, 'live')), ['no-commit-cleanup-error','no-commit-unconfirmed-cleanup'].includes(scenario));
      assert.equal(existsSync(join(fake, 'verifier-started')), false);
      assert.equal(git(origin, 'branch', '--list', '7-fix-login'), '');
      const runFile = join(state, 'owner_repo--7.json');
      const rawRun = readFileSync(runFile,'utf8'), run = JSON.parse(rawRun);
      const custody = readPayloadCustody(state, run.payloadCustody);
      assert.equal(custody.sealed, !['no-commit-cleanup-error','no-commit-unconfirmed-cleanup'].includes(scenario));
      if (!custody.sealed) assert.equal(Object.keys(readAdmission(state).entries).length,1,'uncertain close retains entry despite process exit');
      if (scenario.startsWith('no-commit-custody')) {
        assert.equal(readFileSync(join(fake,'custody-before-create'),'utf8'),'pending');
        assert.deepEqual([...custody.payloads.values()], [{container:'fixture-container',absent:true}]);
        assert.deepEqual(readAdmission(state).entries, {}, 'only sealed actual normal scope releases its managed entry');
        const project = {root,tracker:{kind:'github' as const,host:'github.com',project:'owner/repo'}};
        if (publicJourney) {
          await publicJourney({home,root,p,state,fake,bin,runtime,run,rawRun,project,git});
          return;
        }
        const options = {project,invocationId:'actual-normal-producer',runtimeRoot:runtime.directory,
          savedRun:{key:'owner_repo--7',executionId:run.executionId},rollout:{olderRuntimesQuiesced:true as const,unmanagedWorkQuiesced:true as const}};
        const bytes = '{"stage":"stopped"}';
        writeFileSync(join(state,'legacy.json'),bytes);
        assert.throws(() => claimSupervisorHold(state,options), /unknown run ownership/);
        assert.equal(readFileSync(join(state,'legacy.json'),'utf8'),bytes);
        rmSync(join(state,'legacy.json')); // fixture-only foreign record; target run is never moved or filtered.
        const expected = {project,key:'owner_repo--7',executionId:run.executionId,runtime:{id:runtime.id,dependencies:runtime.manifest.dependencies}};
        assert.equal(payloadRunClosed(state,run,expected),true);
        for (const patch of [{executionId:'successor'},{claim:'stale-fence'},{recovery:{id:'repair'}},{delivery:{state:'ci-waiting'}},{payloadCustody:{version:1,nonce:'missing'}}])
          assert.equal(payloadRunClosed(state,{...run,...patch},expected),false);
        assert.equal(payloadRunClosed(state,run,{...expected,project:{...project,root:home}}),false);
        assert.throws(() => claimSupervisorHold(state,{...options,savedRun:{...options.savedRun,executionId:'stale-execution'}}),/unknown run ownership/);
        // Real normal producer -> exact exclusion -> selected artifact/runtime pins -> complete original collector.
        // The only synthetic surfaces are the existing SDK/platform/tracker boundaries; no provider call is made.
        mkdirSync(p.config,{recursive:true,mode:0o700}); chmodSync(p.config,0o700); chmodSync(state,0o700);
        writeFileSync(p.projects,JSON.stringify({version:1,projects:[{name:'fixture',root,schedule:{enabled:true,branch:'main',since:new Date().toISOString()}}]}));
        const subscription = scenario === 'no-commit-custody';
        const { SUBSCRIPTION_PROFILE_ID } = await import('../cli/src/supervisor-advisory-contract.mts');
        let loginExports = 0;
        const hostAuth = subscription ? {auth:'pi-login' as const,resolveLogin:async () => {
          loginExports++; return 'synthetic-chatgpt-not-a-token';
        }} : {};
        writeFileSync(join(p.config,'supervisor.json'),JSON.stringify({version:1,enabled:true,profile:subscription ? SUBSCRIPTION_PROFILE_ID : ADVISORY_PROFILE_ID,capacity:1,cumulative:{tokens:10000000,cost:100000000,calls:1}}),{mode:0o600});
        const backend = new FakeSchedule(p); backend.enabled=true; backend.timer='active';
        const humanPath=join(fake,'current-human.txt');
        writeFileSync(humanPath,'Complete current human instructions');
        const source = structuredContextSource(project.tracker,({args}) => {
          if (args[1]==='graphql') return JSON.stringify({data:{repository:{issue:{parent:null}}}});
          if (args[1].includes('/comments?')) return '[]';
          return JSON.stringify({number:7,title:'Fix login',body:readFileSync(humanPath,'utf8')});
        });
        const hp={...p,state,runtimeDescriptor:runtime.env.FACTORY_RUNTIME_DESCRIPTOR!,runtimes:dirname(runtime.directory),data:dirname(dirname(runtime.directory))};
        const { prepareSupervisorHost } = await import(pathToFileURL(join(runtime.directory,'supervisor-host.mts')).href);
        const prepared=await prepareSupervisorHost({paths:hp,project,ticket:7,invocationId:options.invocationId,backend,tracker:source,...hostAuth});
        // Disposable synthetic operator attestation only: no installed/actual quiescence assertion.
        const rolloutFile=join(p.config,'supervisor-rollout.json');
        const writeRollout=()=>writeFileSync(rolloutFile,JSON.stringify({version:1,project,...((({host,hostDependencies,selected,dependencies})=>({host,hostDependencies,selected,dependencies}))(prepared.runtime.identity)),
          recordedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),olderRuntimesQuiesced:true,unmanagedWorkQuiesced:true}),{mode:0o600});
        writeRollout();
        assert.equal(prepared.hold,undefined,'read-only preparation does not strand ownership before exact cache reuse');
        assert.equal(prepared.runtime.lease(),undefined);
        assert.equal(prepared.initial.preflightHold,null);
        const rebuilt=await prepared.current();
        assert.equal(rebuilt.input.basis,prepared.initial.input.basis,'rebuilding originals does not recursively include its own freezes or observations');
        writeFileSync(humanPath,readFileSync(humanPath,'utf8')+'\nNew material human instruction');
        const changed=await prepared.current();
        assert.notEqual(changed.input.basis,rebuilt.input.basis,'new current human original changes the material basis');
        assert.equal(prepared.hold,undefined,'read-only preparation has not acquired exclusion');
        const diagnosticFile=join(run.evidenceDir,'no-commit.json'), diagnosticBytes=readFileSync(diagnosticFile,'utf8');
        writeFileSync(diagnosticFile,JSON.stringify({...JSON.parse(diagnosticBytes),executionId:'foreign-execution'}));
        await assert.rejects(prepared.current(),/no-commit original belongs to an unknown\/stale execution/);
        writeFileSync(diagnosticFile,diagnosticBytes);
        backend.enabled=false;
        await assert.rejects(prepared.current(),/global=off/,'fresh existing controls narrow even an already prepared host');
        assert.equal(prepared.hold,undefined,'control failure does not acquire ownership');
        assert.equal(readFileSync(runFile,'utf8'),rawRun,'host preparation preserves the exact raw saved record');
        // Extend this SAME genuine normal producer through the owned worker and pinned SDK. Reuse T04's
        // network-denied SSE preload; no fabricated grant/terminal receipt and no model-semantics claim.
        backend.enabled=true;
        const preloadConfig=join(fake,'advisory-preload.json'), barrier=join(fake,'advisory-network.json');
        writeFileSync(preloadConfig,JSON.stringify({scenario:'complete',barrier,missingUsage:scenario === 'no-commit-custody-unknown-usage',
          diagnosisInput:join(state,'supervisor',supervisorHash(project.root),supervisorHash(options.invocationId),'input.json')}));
        const preload=new URL('../cli/test/supervisor-process-preload.mts',import.meta.url); preload.searchParams.set('config',preloadConfig);
        const originalSpawn=cp.spawn;
        cp.spawn=((command: any,args: any[],opts: any)=> {
          if (String(args[0]).endsWith('supervisor-guard.mjs')) {
            args=['--import',preload.href,...args]; opts={...opts,stdio:[...opts.stdio,'ignore']};
          }
          return originalSpawn(command,args,opts);
        }) as any;
        syncBuiltinESMExports();
        let diagnosis;
        try { diagnosis=await prepared.invoke('sk-synthetic-offline-not-a-secret'); }
        finally { cp.spawn=originalSpawn; syncBuiltinESMExports(); }
        if (scenario === 'no-commit-custody-unknown-usage') {
          assert.equal(diagnosis.state,'human-required',JSON.stringify(diagnosis));
          const reopened = readSupervisor(state,project), key = supervisorHash(options.invocationId);
          assert.equal(reopened.reservations[key].state,'ambiguous');
          assert.equal(reopened.reservations[key].actual,null);
          assert.equal(reopened.advisory?.settlements?.[key],undefined,'uncertainty is not successful settlement');
          assert.equal(Object.keys(reopened.advisory!.sends).length,1);
          assert.match(reopened.humans[reopened.reservations[key].incidentId].nextAction,/Do not retry, reset charges/);
          assert.equal(reopened.humans[reopened.reservations[key].incidentId].delivery.attempts,0);
          assert.equal(checkSupervisorHold(state,prepared.hold!),true,'unknown usage retains exclusion');
          const pin = prepared.runtime.lease()!;
          assert(existsSync(join(hp.runtimes,'.leases',`${pin.token}.json`)),'unknown usage retains runtime pins');
          prepared.runtime.assertCurrent();
          assert.deepEqual(reopened.charged.diagnosis,reopened.reservations[key].reserved,'the full reservation remains charged');
          const again = await prepared.invoke('sk-synthetic-offline-not-a-secret');
          assert.equal(again.state,'held','durable human stop refuses replacement send');
          assert.deepEqual(readSupervisor(state,project).charged,reopened.charged);
          assert.equal(Object.keys(readSupervisor(state,project).advisory!.sends).length,1);
          return;
        }
        assert.equal(diagnosis.state,'proposed',JSON.stringify(diagnosis));
        assert.equal(loginExports,subscription ? 1 : 0,'new subscription call resolves auth once');
        assert.equal(prepared.runtime.identity.profile,subscription ? SUBSCRIPTION_PROFILE_ID : ADVISORY_PROFILE_ID);
        assert(existsSync(barrier),'the actual SDK reached only the network-denied synthetic SSE transport');
        const terminal=readSupervisor(state,project), key=supervisorHash(options.invocationId);
        assert.equal(terminal.advisory?.settlements?.[key]?.disposition,'retained-advice');
        assert.equal(terminal.reservations[key].state,'finished');
        assert(terminal.reservations[key].actual!.tokens>0);
        assert.equal(Object.keys(terminal.advisory!.sends).length,1);
        assert.equal(inspectSupervisorHost(terminal,prepared.hold).state,'settled');
        assert(!checkSupervisorHold(state,prepared.hold!),'known terminal evidence permits exact exclusion release');
        const { reconcileSupervisorHost } = await import(pathToFileURL(join(runtime.directory,'supervisor-host.mts')).href);
        assert.equal((await reconcileSupervisorHost(hp,prepared.hold!,prepared.runtime.lease()!)).released,true,'original receipts make restart closure idempotent');
        const sameHost=await prepared.invoke('sk-synthetic-offline-not-a-secret');
        assert.equal(sameHost.state,'reused',JSON.stringify(sameHost));
        writeRollout(); // Renewal alone must not change material basis or replenish cumulative history.
        const again=await prepareSupervisorHost({paths:hp,project,ticket:7,invocationId:'cached-advice',backend,tracker:source,...hostAuth});
        assert(again.initial.preflightHold,'host maxCalls=1 is already spent');
        const reused=await again.invoke('sk-synthetic-offline-not-a-secret');
        assert.equal(reused.state,'reused',JSON.stringify(reused));
        assert.equal(loginExports,subscription ? 1 : 0,'both same-host and fresh-host cache reuse avoid auth');
        assert.equal(again.hold,undefined,'cache reuse creates no unreleasable exclusion');
        assert.equal(again.runtime.lease(),undefined,'cache reuse creates no paid pin');
        assert.deepEqual(readSupervisor(state,project).charged,terminal.charged);
        assert.equal(Object.keys(readSupervisor(state,project).advisory!.sends).length,1,'unchanged basis performs zero extra sends');
        // Same owned boundary, one final-publication source mutation. No parallel provider matrix.
        const hostFile=join(p.config,'supervisor.json'), larger=JSON.parse(readFileSync(hostFile,'utf8'));
        larger.cumulative.calls=2;writeFileSync(hostFile,JSON.stringify(larger),{mode:0o600});
        writeFileSync(humanPath,readFileSync(humanPath,'utf8')+'\nAuthoritative successor instruction before new bounded call');
        const late=await prepareSupervisorHost({paths:hp,project,ticket:7,invocationId:'final-stale',backend,tracker:source,...hostAuth});
        writeFileSync(preloadConfig,JSON.stringify({scenario:'complete',barrier:join(fake,'late-network.json'),changeOriginal:rolloutFile,
          diagnosisInput:join(state,'supervisor',supervisorHash(project.root),supervisorHash('final-stale'),'input.json')}));
        cp.spawn=((command:any,args:any[],opts:any)=> {
          if(String(args[0]).endsWith('supervisor-guard.mjs')) {args=['--import',preload.href,...args];opts={...opts,stdio:[...opts.stdio,'ignore']};}
          return originalSpawn(command,args,opts);
        }) as any;syncBuiltinESMExports();
        let stale;
        try {stale=await late.invoke('sk-synthetic-offline-not-a-secret');}
        finally {cp.spawn=originalSpawn;syncBuiltinESMExports();}
        assert.equal(stale.state,'human-required',JSON.stringify(stale));
        const final=readSupervisor(state,project), lateKey=supervisorHash('final-stale');
        assert.equal(final.advisory!.settlements![lateKey].disposition,'local-human-required');
        assert(Object.values(final.humans).some(h=>h.proposalId===stale.diagnosticId),'stale owned output has a durable actionable human request');
        assert.equal(Object.values(final.diagnostics!).find(d=>d.reservationId==='final-stale')!.decision,null);
        assert.equal(final.charged.diagnosis.tokens,terminal.charged.diagnosis.tokens*2,'stale usage retains both full reservations');
        assert(!checkSupervisorHold(state,late.hold!),'known stale terminal receipts release only exact exclusion');
        assert.equal(readFileSync(runFile,'utf8'),rawRun,'owned diagnosis never rewrites actual saved run custody');
      }
      if (scenario === 'no-commit-stale') {
        assert.equal(run.executionId, 'new-execution'); assert.equal(run.note, 'new execution owns this record');
        assert.equal(run.evidenceDir, 'new-evidence'); assert.equal(run.stage, 'implementing');
        return;
      }
      assert.equal(run.stage, scenario === 'no-commit-blocked' ? 'waiting' : 'stopped');
      assert.match(run.note, /zero commits/);
      assert.match(run.note, /worktree (clean|dirty|unknown)/);
      assert.match(run.note, /[Ii]nspect ticket context/);
      assert.match(run.note, ['no-commit-blocked','no-commit-malformed-report'].includes(scenario) ? /Existing blocked-report dependency policy only/ : /No automatic retry/);
      assert.match(run.note, scenario === 'no-commit-unavailable' ? /cause unknown/ : /agreed audit, Q&A and plan/);
      if (scenario === 'no-commit-cleanup-error') assert.match(run.note, /fixture teardown failed/);
      if (scenario === 'no-commit-unconfirmed-cleanup') assert.match(run.note, /cleanup ownership retained/);
      const report = JSON.parse(readFileSync(join(run.evidenceDir, 'no-commit.json'), 'utf8'));
      assert.equal(report.worktree, scenario === 'no-commit-dirty' ? 'dirty' : scenario === 'no-commit-unknown-worktree' ? 'unknown' : 'clean');
      assert.equal(report.executionId, run.executionId);
      assert.notEqual(run.executionId, 'old-execution');
      assert.ok(!run.note.includes('old explanation must not be reused'));
      assert.ok(!JSON.stringify(report).includes('fixture-secret'));
      assert.ok(!JSON.stringify(report).includes('/private/context'));
      const calls = readFileSync(join(fake, 'gh.jsonl'), 'utf8');
      assert.ok(!calls.includes('"merge"') && !calls.includes('"close"'));
      assert.equal(calls.includes('"comment"'), scenario === 'no-commit-malformed-report', 'only existing malformed blocked-report policy posts');
      assert.equal(calls.includes('/issues/7/labels'), scenario === 'no-commit-malformed-report', 'no new diagnostic labels');
      return;
    }
    if (scenario === 'pass' || completeAcceptance || scenario === 'acceptance-replay-pass') {
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
        for (const role of ['implementer', 'verifier']) {
          const selected = JSON.parse(readFileSync(join(fake, `${role}-identity.json`), 'utf8'));
          assert.equal(selected.root, runtime.directory);
          assert.equal(selected.assets, join(root, '.factory'), 'execution context loads supported project data separately from runtime code');
          assert.deepEqual(selected.identity.runtime, { id: runtime.id, dependencies: runtime.manifest.dependencies });
        }
        const options = JSON.parse(readFileSync(join(fake, 'sandbox-options.json'), 'utf8'));
        assert.equal(options.branch, '7-fix-login'); assert.equal(options.baseBranch, 'origin/main');
        assert.deepEqual(options.sandbox.mounts, [
          { hostPath: run.evidenceDir, sandboxPath: `/home/agent/evidence/7/${run.executionId}` },
          { hostPath: join(root, '.factory/sandbox'), sandboxPath: '/opt/sandcastle', readonly: true },
        ], 'production passes exact in-layout evidence/helper mounts to the synthetic SDK');
        assert.ok(existsSync(join(root, '.factory/worktrees/7-fix-login')), 'synthetic SDK uses the supported worktree path');
        assert.equal(existsSync(join(root, '.sandcastle')), false);
        assert.ok(run.evidenceDir.startsWith(join(root, '.factory/evidence') + '/'));
        assert.ok(existsSync(join(fake, 'implementer-started')) && existsSync(join(fake, 'verifier-started')));
      }
      assert.equal(run.modelChoice.family, family);
      assert.equal(run.modelChoice.tier, expectedTier);
      assert.equal(run.modelChoice.source, tier ? 'ticket-tier' : 'factory-default');
      assert.equal(run.modelChoice.policyIdentity, 'factory-model-policy-v2');
      assert.equal(run.modelChoice.resolvedModel, run.implementationModel);
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: expectedModel, thinking: 'high' });
      assert.deepEqual(JSON.parse(readFileSync(join(fake, 'verifier-agent.json'), 'utf8')), { model: MODEL_POLICY[family].large, thinking: 'high' });
      const proof = JSON.parse(readFileSync(join(proofRoot(state, 'owner/repo', '7', run.verification.id), 'proof.json'), 'utf8'));
      if (scenario === 'acceptance-replay-pass') {
        assert.ok(proof.candidateReplay,'delivery proof retains authenticated baseline/candidate handles');
        const candidate=JSON.parse(readFileSync(join(fake,'candidate-input.json'),'utf8'));
        const driver=JSON.parse(readFileSync(join(fake,'candidate-driver.json'),'utf8'));
        assert.equal(driver.status,0,driver.stderr);
        assert.equal(candidate.phase,'candidate');assert.equal(candidate.sha,tip);
        assert.equal(JSON.parse(driver.stdout).results.assertions[0].status,'pass');
        const baselineHandle=proof.candidateReplay.baseline;
        t.diagnostic(JSON.stringify({candidateDriver:driver,baselineDriver:JSON.parse(readFileSync(join(dirname(baselineHandle.directory),'baseline-driver.json'),'utf8'))}));
        assert.equal(JSON.parse(readFileSync(join(baselineHandle.directory,'sandbox-output.json'),'utf8')).results.assertions[0].status,'expected-behavioral-fail');
        assert.notEqual(baselineHandle.ownerId,proof.candidateReplay.candidate.ownerId);
        assert.notEqual(baselineHandle.executionId,proof.candidateReplay.candidate.executionId);
        const { project, ticket, executionId, branch, base, requirementsHash } = proof;
        const identity = { project, ticket, executionId, branch, base, baseline, tip, requirementsHash };
        const provenance = proof.provenance;
        const replay = proof.candidateReplay;
        for (const [mutate, reason] of [
          [(r: any) => delete r.criteria[0].obligations, /authoritative evidence obligation.*inventory/],
          [(r: any) => r.criteria[0].obligations[0].requirement = 'Wrong obligation', /missing authoritative evidence obligation/],
          [(r: any) => r.criteria[0].obligations[0].evidence = ['check.txt'], /needs matching browser media/],
          [(r: any) => r.artifacts.find((a: any) => a.path === 'after-summary.png').phase = 'before', /needs matching browser media/],
          [(r: any) => r.criteria[0].obligations[1].evidence = ['after-keyboard.png'], /needs matching interactive media/],
          [(r: any) => r.criteria[0].obligations[1].evidence = ['after-summary.png', 'after-keyboard.webm'], /reuses another obligation/],
          [(r: any) => r.criteria[2].obligations[0].evidence = ['check.txt'], /needs independently authorized manual evidence/],
          [(r: any) => delete r.criteria[2].obligations, /authoritative evidence obligation \(C-manual\).*inventory/],
        ] as const) {
          const report = structuredClone(proof.report);
          mutate(report);
          writeFileSync(join(run.evidenceDir, 'verification.json'), JSON.stringify(report));
          assert.throws(() => createProof(state, run.evidenceDir, identity, provenance, undefined, replay), reason);
        }
        const visual = join(run.evidenceDir, 'after-summary.png');
        const visualBytes = readFileSync(visual);
        writeFileSync(join(run.evidenceDir, 'verification.json'), JSON.stringify(proof.report));
        writeFileSync(visual, 'command output with a misleading extension');
        assert.throws(() => createProof(state, run.evidenceDir, identity, provenance, undefined, replay), /needs matching browser media/);
        writeFileSync(visual, visualBytes);
        assert.throws(() => createProof(state, run.evidenceDir, { ...identity, project: 'foreign/project' }, provenance, undefined, replay), /replay.*project/i);
        assert.throws(() => createProof(state, run.evidenceDir, identity, { ...provenance, imageId: `sha256:${'b'.repeat(64)}` }, undefined, replay), /replay.*image/i);
        const unrelatedAttempt = 'd5135819-dad4-4942-aa99-393592637af8';
        assert.throws(() => createProof(state, run.evidenceDir, { ...identity, attemptId: unrelatedAttempt }, provenance, undefined, replay), /replay.*attempt/i);
        for (const verdict of ['FAIL', 'INCONCLUSIVE']) {
          writeFileSync(join(run.evidenceDir, 'verification.json'), JSON.stringify({ ...proof.report, verdict }));
          writeFileSync(join(run.evidenceDir, 'verdict.md'), `VERDICT: ${verdict}\nSynthetic independent verdict`);
          assert.throws(() => createProof(state, run.evidenceDir, identity, provenance, undefined, replay), /replay.*semantic PASS/i);
        }
        writeFileSync(join(run.evidenceDir, 'verification.json'), JSON.stringify({ ...proof.report, criteria: proof.report.criteria.slice(1) }));
        writeFileSync(join(run.evidenceDir, 'verdict.md'), 'VERDICT: PASS\nSynthetic independent verdict');
        assert.throws(() => createProof(state, run.evidenceDir, identity, provenance, undefined, replay), /authoritative criterion inventory/);
        const accepted = readProof(state, identity, run.verification.id);
        assert.equal(accepted.report.verdict, 'PASS');
        // Even internally consistent hashes are insufficient if the frozen report loses an obligation.
        const frozenReportPath = join(accepted.root, 'verification.json');
        const frozenProofPath = join(accepted.root, 'proof.json');
        const originalFrozen = [frozenReportPath, frozenProofPath].map(path => readFileSync(path));
        const mismatched = structuredClone(proof.report);
        mismatched.criteria[0].obligations[0].evidence = ['check.txt'];
        const malformedReport = JSON.stringify(mismatched);
        for (const path of [frozenReportPath, frozenProofPath]) chmodSync(path, 0o600);
        try {
          writeFileSync(frozenReportPath, malformedReport);
          writeFileSync(frozenProofPath, JSON.stringify({ ...proof, report: mismatched, reportHash: createHash('sha256').update(malformedReport).digest('hex') }));
          assert.throws(() => readProof(state, identity, run.verification.id), /needs matching browser media/);
        } finally {
          for (const [i, path] of [frozenReportPath, frozenProofPath].entries()) {
            writeFileSync(path, originalFrozen[i]); chmodSync(path, 0o400);
          }
        }

        // Same exact proof can authorize observation of the same PR without another producer.
        const { observeWaitingDelivery, RetryableDeliveryRead } = await import(join(runtime.directory, 'delivery-followup.mts'));
        const waiting = { ...run, stage: 'waiting', delivery: { ...run.delivery, state: 'ci-waiting', reasonCode: 'opened' } };
        delete waiting.delivery.mergedAt;
        let observed = 0, checkpoint = waiting.delivery;
        const host = {
          state, workflow: runtime.directory, inventory: provenance.code, settings: provenance.settings,
          claim: r => ({ ok: true, run: { ...r, claim: 'fixture-delivery-claim' } }),
          finish: (_r, _token, next) => { checkpoint = next; return true; },
          authorize: () => undefined,
          merge: async (d, authorize) => {
            assert.equal(d.proofId, run.verification.id);
            assert.equal(d.sha, tip);
            assert.equal(authorize(), undefined);
            return ++observed === 1
              ? { state: 'ci-waiting', reasonCode: 'checks-pending', reason: 'fixture pending' }
              : { state: 'merged', reasonCode: 'merged', reason: 'fixture merged', mergedAt: new Date().toISOString() };
          },
        };
        // A historical criterion-only replay proof is not a same-PR authority upgrade.
        chmodSync(frozenProofPath, 0o600);
        try {
          writeFileSync(frozenProofPath, JSON.stringify({ ...proof, version: 2, policyVersion: 2 }));
          assert.match(await observeWaitingDelivery(waiting, host), /Legacy proof cannot authorize CI continuation/);
          assert.equal(observed, 0);
        } finally { writeFileSync(frozenProofPath, originalFrozen[1]); chmodSync(frozenProofPath, 0o400); }
        const pending = await observeWaitingDelivery(waiting, host);
        assert.match(pending, /Pending CI/);
        assert.equal(checkpoint.state, 'ci-waiting');
        assert.match(await observeWaitingDelivery({ ...waiting, delivery: checkpoint }, host), /Merged/);
        assert.equal(checkpoint.state, 'merged');
        assert.equal(observed, 2);
        for (const changed of [
          { run: { ...waiting, acceptanceBaseline: { ...waiting.acceptanceBaseline, bindingDigest: '0'.repeat(64) } }, host, reason: /original acceptance baseline/i },
          { run: waiting, host: { ...host, settings: { ...host.settings, image: 'changed' } }, reason: /settings changed/i },
          { run: waiting, host: { ...host, inventory: {} }, reason: /workflow proof inputs/i },
          { run: waiting, host: { ...host, authorize: () => 'Requirements changed' }, reason: /Requirements changed/ },
          { run: waiting, host: { ...host, authorize: () => 'Local/remote branch changed' }, reason: /branch changed/ },
        ]) {
          assert.match(await observeWaitingDelivery(changed.run, changed.host), changed.reason);
          assert.equal(checkpoint.state, 'operator-required');
        }
        await observeWaitingDelivery(waiting, { ...host, authorize: () => { throw new RetryableDeliveryRead('tracker unavailable'); } });
        assert.equal(checkpoint.reasonCode, 'transport-unknown');
        assert.equal(checkpoint.state, 'ci-waiting');
        await observeWaitingDelivery(waiting, { ...host, merge: async (_d, authorize) => {
          let scheduler = true;
          const getHold = () => scheduler ? authorize() : 'Scheduler paused during observation';
          assert.equal(getHold(), undefined);
          scheduler = false;
          return { state: 'operator-required', reasonCode: 'authorization', reason: getHold() };
        } });
        assert.equal(checkpoint.state, 'operator-required');
        const planPath = join(state, 'acceptance', `baseline-plan-${requirementsHash}.json`);
        const originalPlan = readFileSync(planPath);
        try {
          writeFileSync(planPath, JSON.stringify({ ...JSON.parse(originalPlan.toString()), configDigest: '0'.repeat(64) }));
          assert.match(await observeWaitingDelivery(waiting, host), /preparation\/config\/approval changed/);
          assert.equal(checkpoint.state, 'operator-required');
        } finally { writeFileSync(planPath, originalPlan); }
        const candidateOutput = join(replay.candidate.directory, 'sandbox-output.json');
        const raw = readFileSync(candidateOutput);
        chmodSync(candidateOutput, 0o600);
        try {
          writeFileSync(candidateOutput, Buffer.concat([raw, Buffer.from('\n')]));
          assert.match(await observeWaitingDelivery(waiting, host), /output.*(changed|integrity|mismatch)/i);
          assert.equal(checkpoint.state, 'operator-required');
        } finally { writeFileSync(candidateOutput, raw); chmodSync(candidateOutput, 0o400); }
        assert.equal(observed, 2);
      }
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
      assert.equal(run.ticketInput.hash, snapshot.contentHash);
      assert.equal(run.ticketInput.renderedSha256, sources.renderedSha256);
      if (completeAcceptance) {
        for (const text of ['## Full child specification', 'Validate empty input without submitting.', 'Preserve the selected return URL.', 'Test keyboard submission.', 'Literal task data: {{TICKET}} !`not a command` $(not-a-command)', 'Decision: ship a self-contained package.', '1. Audit the existing form.', '2. Add validation and keyboard tests.', '3. Record package evidence.']) {
          assert.ok(frozenText.includes(text), text); assert.ok(implementationPrompt.includes(text), text); assert.ok(verifierPrompt.includes(text), text);
        }
        assert.equal(snapshot.parent.iid, 90);
        assert.ok(snapshot.coverage.every((source: {complete: boolean}) => source.complete));
        assert.ok(snapshot.parent.notes.every((note: {url: string}) => note.url.startsWith('https://github.com/owner/repo/issues/90#issuecomment-')));
      }
      assert.ok(implementationPrompt.includes('Common {{TICKET}} $(literal) !`shell`\n\nimplementation only'));
      assert.ok(verifierPrompt.includes('Common {{TICKET}} $(literal) !`shell`\n\nverification only'));
      assert.ok(!implementationPrompt.includes('verification only')); assert.ok(!verifierPrompt.includes('implementation only'));
      assert.match(verifierPrompt, /verification\.json/);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.additive.implementation).sort(), ['common.md', 'impl.md']);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.additive.verification).sort(), ['common.md', 'verify.md']);
      assert.deepEqual(Object.keys(proof.provenance.settings.execution.templates).sort(), ['prompt.analyze.md','prompt.md','prompt.recover.md','prompt.triage.md','prompt.verify.md']);
      assert.deepEqual(proof.provenance.code, Object.fromEntries(runtime.manifest.files.map(file => [file.path,file.sha256])));
    } else if (['parent-read-failed', 'instruction-missing'].includes(scenario)) {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(existsSync(join(fake, 'implementer-started')), false);
      assert.equal(existsSync(join(fake, 'verifier-started')), false);
      assert.equal(existsSync(join(state, 'owner_repo--7.json')), false, 'input failure creates no stopped run');
      assert.equal(existsSync(join(fake, 'live')), false);
      assert.match(result.stdout + result.stderr, scenario === 'parent-read-failed' ? /parent #90 notes: read-failed/ : /missing.md/);
    } else if (scenario.startsWith('sandbox-')) {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(existsSync(join(fake, 'implementer-started')), false, 'no implementer invocation');
      assert.equal(existsSync(join(fake, 'verifier-started')), false, 'no verifier invocation');
      assert.ok(existsSync(join(fake, 'cleanup-attempted')), 'owned cleanup ran before child exited');
      assert.equal(existsSync(join(fake, 'live')), scenario === 'sandbox-cleanup');
      assert.match(result.stderr, /Sandbox readiness/);
      assert.doesNotMatch(result.stderr, /Implementer made no commit/);
      const probe = JSON.parse(readFileSync(join(fake, 'sandbox-probe-input.json'), 'utf8'));
      assert.equal(probe.uid, process.getuid!()); assert.equal(probe.gid, process.getgid!());
      assert.equal(probe.baseline, baseline); assert.equal(probe.tip, baseline);
      assert.ok(probe.evidence.startsWith('/home/agent/evidence/7/'));
      if (scenario === 'sandbox-cleanup') assert.match(result.stderr, /evidence-create-write-rename-remove.*Sandbox close failed: fixture teardown failed.*fixture-container teardown unconfirmed/s);
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
      if (scenario === 'parent-plan') {
        const run = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
        const inputDir = join(state, 'ticket-inputs', 'owner_repo--7', run.executionId);
        const text = readFileSync(join(inputDir, 'ticket-context.txt'), 'utf8');
        const snapshot = JSON.parse(readFileSync(join(inputDir, 'ticket-context.json'), 'utf8'));
        const sources = JSON.parse(readFileSync(join(inputDir, 'ticket-sources.json'), 'utf8'));
        assert.match(text, /Agreed parent decisions and implementation plan/);
        assert.doesNotMatch(text, /Changed parent plan/);
        assert.ok(readFileSync(join(fake, 'implementer-prompt.txt'), 'utf8').includes(text));
        assert.equal(snapshot.contentHash, run.ticketInput.hash);
        assert.equal(createHash('sha256').update(text).digest('hex'), sources.renderedSha256);
        assert.equal(sources.renderedSha256, run.ticketInput.renderedSha256);
        assert.equal(run.verification, undefined, 'stale parent plan produces no independent proof');
      }
      if (scenario === 'instruction-edit') assert.equal(readFileSync(join(fake, 'frozen-after-edit.txt'), 'utf8'), 'Common {{TICKET}} $(literal) !`shell`\n\nimplementation only');
      if (['config-family', 'config-setup', 'runtime-template', 'tier-edit'].includes(scenario)) {
        const record = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
        assert.equal(record.modelChoice.family, 'openai'); assert.equal(record.modelChoice.tier, 'mid');
        assert.deepEqual(JSON.parse(readFileSync(join(fake, 'implementer-agent.json'), 'utf8')), { model: MODEL_POLICY.openai.mid, thinking: 'high' });
      }
      if (['acceptance-implementer-tamper','acceptance-reset-unsupported'].includes(scenario)) {
        const record = JSON.parse(readFileSync(join(state,'owner_repo--7.json'),'utf8'));
        assert.equal(record.verification,undefined,'no accepting proof is published');
        const actual = JSON.parse(readFileSync(join(fake,'candidate-driver.json'),'utf8'));
        if (scenario === 'acceptance-implementer-tamper') {
          assert.ok(git(root,'show','7-fix-login:probes/export.mjs').includes('A-summary'));
          assert.equal(actual.status,0,'the original probe can still execute');
          assert.deepEqual(JSON.parse(actual.stdout).results.assertions.map((a:any)=>[a.assertionId,a.status,a.failureId]),[
            ['A-summary','expected-behavioral-fail','summary-unavailable-or-wrong'],['A-order','pass',null],
          ]);
        } else {
          assert.notEqual(actual.status,0);
          assert.match(actual.stderr,/Synthetic local setup failed/);
          assert.equal(actual.stdout,'','unsupported reset cannot publish an assertion observation');
        }
      }
      if (['acceptance-obligation-omitted', 'acceptance-manual-evidence-missing'].includes(scenario)) {
        const record = JSON.parse(readFileSync(join(state,'owner_repo--7.json'),'utf8'));
        assert.equal(record.verification, undefined, 'no accepting proof is published');
        assert.equal(existsSync(join(fake, 'candidate-input.json')), scenario === 'acceptance-manual-evidence-missing');
      }
      const reason = ({'acceptance-manual-evidence-missing':/Acceptance candidate hold:.*missing-evidence/,'acceptance-implementer-tamper':/Acceptance candidate hold:.*behavior-mismatch/,'acceptance-reset-unsupported':/Acceptance candidate hold:.*invalid-results/,'parent-plan':/Acceptance static hold: missing-preparation/,'instruction-edit':/inputs changed/,'config-family':/inputs changed/,'config-setup':/inputs changed/,'runtime-template':/mismatch/,'tier-edit':/Acceptance static hold: missing-preparation/,title:/Acceptance static hold: missing-preparation/,body:/Acceptance static hold: missing-preparation/,comment:/Acceptance static hold: missing-preparation/,parent:/parent changed/,closed:/is closed/,excluded:/excluded or needs human/,claim:/claim is no longer held/,dirty:/Verifier changed the branch/,branch:/moved from verified tip/,'missing-baseline':/bad object|missing|invalid|not a valid|unable to read/i,'legacy-prompt':/verification.json/,'acceptance-omitted-criterion':/authoritative criterion inventory/,'acceptance-obligation-omitted':/authoritative evidence obligation.*inventory/,'acceptance-missing-replay':/Acceptance candidate hold/,'acceptance-replay-unknown':/Acceptance candidate hold/,'acceptance-replay-infrastructure':/Acceptance candidate hold/,'acceptance-replay-mismatched-bundle':/Acceptance candidate hold/,'acceptance-replay-changed-candidate':/moved from verified tip|tip|branch/i} as Record<string, RegExp>)[scenario];
      assert.match(result.stdout + result.stderr, reason);
    }
}
