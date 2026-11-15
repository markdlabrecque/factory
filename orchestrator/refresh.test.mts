// #153: real copied dispatch observes durable CI waits only on authorized scheduled passes.
// #149: dispatch retries unknown dependencies for both trackers without labels or launches.
import { createProof } from './verification.mts';
import { bindExecution, executionSnapshot } from '../cli/test/execution-fixture.mts';
import { modelForRole } from './model-policy.mts';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
// #137: scaffolded fixtures use authoritative TOML for settings, shared-board capacity and CLI overrides.
// #126: dispatch/refresh resolve description models on both trackers, preserving running attempt models.
// #78 integration: real scaffolded dispatcher, adapters, read-only analysis and HTTP board against local Git and
// rejecting gh/glab/analyst/npx fixtures. Covers retained parked cards, edits at every stage, manual refresh without
// scheduling, whole-project --refresh-only (#93), per-pass analysis budget, and admission equivalence when assessment storage fails. No external services.
// #125: a queued card disappears from buildBoardData only after a successful refresh confirms deselection, and returns when reselected.
// #135: capped GitHub selection fails refresh without hiding queued cards or overwriting last-good facts.
// #122: parked runs with open PRs/MRs still reserve conflicting footprints.
// The fixture owns the Pi extension path as well as the pi command, so a developer's installed provider cannot mask CI failures.
// A file-gated analyst deterministically overlaps scheduled/manual dispatch processes and releases the older last.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildAssets } from "../cli/src/scaffold.mts";
import { readAssessment, requestRefresh } from "../board/assessment.mts";
import { unitHash } from "./graph.mts";

const FIXTURES = join(import.meta.dirname, "fixtures/entrypoint");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
// Selected fixtures use v2 model tiers. No model label is required.
const ticket = (iid: number, extra = {}) => ({ iid, title: `Ticket ${iid}`, description: "Model tier: mid\nRequirement DEP:20", state: "open", labels: ["ready-for-agent"], ...extra });
function fixture(t: any, kind = "github") {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "factory-refresh-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const origin = join(home, "origin.git"), root = join(home, "site"), dir = join(home, "runs"), bin = join(home, "bin"), fake = join(home, "fake");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, root], { stdio: "ignore" });
  git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  git(root, "push", "-q", "origin", "main");
  for (const f of buildAssets({ profile: kind === "github" ? "personal" : "client", repo: "owner/repo", image: "img", host: "git.example.test", projectId: 1 }, dir)) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.content, { mode: f.mode });
  }
  const configPath = join(root, '.sandcastle/factory.toml');
  writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('family = "openai"', 'family = "anthropic"'));
  for (const p of [bin, fake, dir, join(dir, "graph"), join(dir, "admission")]) mkdirSync(p, { recursive: true });
  // A fixture-local Node path makes dispatch select our npx rather than the host's. It records the launch only.
  const node = join(bin, "node");
  try { linkSync(process.execPath, node); } catch { copyFileSync(process.execPath, node); chmodSync(node, 0o755); }
  for (const tool of ["gh", "glab", "pi", "claude"]) {
    const script = tool === "gh" || tool === "glab" ? "refresh-tracker.mjs" : "refresh-analysis.mjs";
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${node}" "${join(FIXTURES, script)}" "$@"\n`, { mode: 0o755 });
  }
  writeFileSync(join(bin, "npx"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$FAKE_STATE/launches"\nsleep 1\n`, { mode: 0o755 });
  const extension = join(fake, "subscription-extension.ts");
  // Only its existence is checked by production argument construction; the stub must never load a real provider.
  writeFileSync(extension, 'throw new Error("Fixture extension must not execute");\n');
  const env = { ...process.env, HOME: home, FACTORY_HOME: home, SANDCASTLE_STATE_DIR: dir, FAKE_STATE: fake, FAKE_TRACKER: kind,
    FACTORY_PI_SUBSCRIPTION_EXTENSION: extension, PATH: `${bin}:/usr/bin:/bin` };
  const runtime = bindExecution(root, env, { install: dir => {
    writeFileSync(join(dir, 'node_modules/tsx/dist/cli.mjs'), `import {appendFileSync,writeFileSync} from 'node:fs'; writeFileSync(process.env.FAKE_STATE+'/launch-context',JSON.stringify({project:process.env.FACTORY_PROJECT_ROOT,runtime:process.env.FACTORY_RUNTIME_ROOT,id:process.env.FACTORY_RUNTIME_ID})); appendFileSync(process.env.FAKE_STATE+'/launches',process.argv.slice(2).join(' ')+'\\n'); await new Promise(r=>setTimeout(r,1000));`);
  } });
  Object.assign(env, runtime.env);
  const snapshot = executionSnapshot(runtime, root);
  // Temporary caller bridge for Board routing, which is owned by the next task.
  writeFileSync(join(root, '.sandcastle/dispatch.mts'), `await import(${JSON.stringify(join(runtime.directory, 'dispatch.mts'))});`);
  const data: any = { tickets: [ticket(7), ticket(20, { description: "Provider", labels: [] }), ticket(21, { description: "New provider", labels: [] })], ready: [7], notes: {}, parents: {} };
  const save = () => writeFileSync(join(fake, "tracker.json"), JSON.stringify(data));
  const key = (iid: number) => `owner_repo--${iid}`;
  const record = (iid: number, stage: string) => {
    const r = { iid: String(iid), project: "owner/repo", title: `old ${iid}`, stage, pid: process.pid, base: "main", verdict: "FAIL", branch: `${iid}-topic`,
      ticketHash: "old", archivedAt: "then", correction: "kept", stageSince: "2026-01-01", startedAt: "2026-01-01", updatedAt: "2026-01-01",
      stageHistory: [{ stage: "queued", at: "2026-01-01" }, { stage, at: "2026-01-02" }], evidenceDir: "/old/evidence", claim: "historical" };
    writeFileSync(join(dir, `${key(iid)}.json`), JSON.stringify(r));
    return readFileSync(join(dir, `${key(iid)}.json`), "utf8");
  };
  const manifest = (iid: number) => {
    const ti = data.tickets.find((x: any) => x.iid === iid), p = data.parents[iid] && data.tickets.find((x: any) => x.iid === data.parents[iid]);
    const m = { iid, project: "owner/repo", policyIdentity: snapshot.policyIdentity, hash: unitHash({ ...ti, ...(p ? { parent: p } : {}) }, data.notes[iid]), analyzedAt: new Date().toISOString(),
      base: "main", baseSha: "", provides: [], requires: [], footprint: [], actualFootprint: [], catalogueIids: data.tickets.filter((t: any) => !t.contextOnly).map((t: any) => t.iid), blockerHashes: {} };
    writeFileSync(join(dir, "graph", `${key(iid)}.json`), JSON.stringify(m));
  };
  const pass = (args: string[] = [], extra = {}) => {
    save();
    const r = spawnSync(node, [join(runtime.directory, 'dispatch.mts'), "--base", "main", ...args], { cwd: root, encoding: "utf8", env: { ...env, ...extra }, timeout: 20_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    if (/launching/.test(r.stdout) && !/not launched/.test(r.stdout)) {
      const deadline = Date.now() + 2000;
      while (!existsSync(join(fake, 'launches')) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    return r;
  };
  const bytes = (path: string) => existsSync(path) ? readFileSync(path, "utf8") : "absent";
  return { home, root, dir, fake, env, runtime, snapshot, data, save, key, record, manifest, pass, bytes, node, assessment: (iid = 7) => readAssessment(dir, key(iid))! };
}

for (const changedInstructions of [false, true]) test(`scheduled copied dispatch: ${changedInstructions ? 'changed instructions revoke existing proof' : 'pending then green uses same proof/PR'}`, async t => {
  const f = fixture(t), sc = join(f.root, '.sandcastle');
  writeFileSync(join(f.root, 'authority.md'), 'original authority');
  const configPath = join(sc, 'factory.toml');
  writeFileSync(configPath, f.bytes(configPath) + '\n[instructions]\ncommon = ["authority.md"]\n');
  const snapshot = executionSnapshot(f.runtime, f.root);
  f.data.tickets[0].description = 'Model tier: mid\nDeliver this behavior';
  f.data.openBranches = ['7-topic']; f.manifest(7);
  git(f.root,'branch','7-topic'); git(f.root,'push','-q','origin','7-topic');
  const tip = git(f.root,'rev-parse','7-topic');
  const cfg = { ...snapshot.config, AGENT: { model: modelForRole('anthropic', 'verification').model, thinking: 'high' } };
  const evidence = join(f.home,'evidence'); mkdirSync(evidence);
  writeFileSync(join(evidence,'verdict.md'),'VERDICT: PASS\n'); writeFileSync(join(evidence,'out.txt'),'verified');
  writeFileSync(join(evidence,'verification.json'),JSON.stringify({version:1,verdict:'PASS',changeKind:'feature',evidenceKind:'command',interactive:false,criteria:[{requirement:'behavior',result:'pass',evidence:['out.txt']}],artifacts:[{path:'out.txt',kind:'command-output',phase:'check'}],limitations:[]}));
  const code = Object.fromEntries(f.runtime.manifest.files.map(file => [file.path, file.sha256]));
  const settings = {image:cfg.config.image,model:cfg.AGENT.model,thinking:cfg.AGENT.thinking??null,merge:{auto:cfg.MERGE.auto,method:cfg.MERGE.method,requiredChecks:cfg.MERGE.requiredChecks??[]},ciWaitMinutes:cfg.config.ciWaitMinutes,noPipelineMinutes:cfg.config.noPipelineMinutes,execution:snapshot.identity};
  const hash = unitHash(f.data.tickets[0], []);
  const identity = {project:'owner/repo',ticket:'7',executionId:'execution',branch:'7-topic',base:'main',baseline:tip,tip,requirementsHash:hash};
  const proof = createProof(f.dir,evidence,identity,{imageId:`sha256:${'a'.repeat(64)}`,nodeVersion:'v22',settings,code});
  const at = new Date().toISOString(), path = join(f.dir,`${f.key(7)}.json`);
  writeFileSync(path,JSON.stringify({iid:'7',project:'owner/repo',stage:'waiting',stageSince:at,startedAt:at,updatedAt:at,pid:process.pid,executionId:'execution',branch:'7-topic',base:'main',implementationBaseSha:tip,verdict:'PASS',verification:{id:proof.id,tip,requirementsHash:hash},delivery:{version:1,kind:'github',host:'github.com',repository:'owner/repo',number:1,url:'https://github.com/owner/repo/pull/1',branch:'7-topic',base:'main',sha:tip,project:'owner/repo',ticket:'7',executionId:'execution',proofId:proof.id,state:'ci-waiting',reasonCode:'opened',observedAt:at}}));
  f.data.delivery={sha:tip,pending:true};
  const cli = join(f.home,'trusted-cli.mjs');
  writeFileSync(cli,`import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(f.fake,'status-calls'))},JSON.stringify(process.argv.slice(2))+'\\n'); console.log(JSON.stringify({version:1,scheduler:{serviceEnabled:true,timerActive:true},projects:[{root:${JSON.stringify(f.root)},schedule:{enabled:true,branch:'main'},blocker:null}]}));`);
  const scheduled={FACTORY_SCHEDULED:'1',FACTORY_CLI_ENTRYPOINT:cli,FACTORY_SCHEDULER_NODE:process.execPath};
  f.pass(); f.pass(['--refresh-only'],scheduled); f.pass(['--dry-run'],scheduled);
  assert.equal(f.bytes(join(f.fake,'status-calls')),'absent');
  f.pass([],scheduled); assert.equal(JSON.parse(f.bytes(path)).delivery.state,'ci-waiting');
  if (changedInstructions) writeFileSync(join(f.root, 'authority.md'), 'changed authority');
  f.data.delivery.pending=false; f.pass([],scheduled);
  if (changedInstructions) {
    const calls = f.bytes(join(f.fake,'tracker.jsonl')).split('\n').filter(Boolean).map(s => JSON.parse(s));
    assert.ok(!calls.some(a => a.includes('repos/owner/repo/pulls/1/merge')), 'changed inputs cannot authorize the existing proof');
    assert.notEqual(JSON.parse(f.bytes(path)).delivery.state, 'merged');
    return;
  }
  const done=JSON.parse(f.bytes(path)); assert.equal(done.delivery.state,'merged'); assert.equal(done.stage,'done'); assert.equal(done.verification.id,proof.id); assert.equal(done.verdict,'PASS');
  const calls=f.bytes(join(f.fake,'tracker.jsonl')).split('\n').filter(Boolean).map(s=>JSON.parse(s));
  assert.equal(calls.filter(a=>a.includes('repos/owner/repo/pulls/1/merge')).length,1);
  assert.ok(!calls.some(a=>a.includes('create')||a.includes('comment')||a.includes('--undo'))); assert.equal(f.bytes(join(f.fake,'launches')),'absent');
  assert.ok(f.bytes(join(f.fake,'status-calls')).split('\n').filter(Boolean).every(s=>JSON.stringify(JSON.parse(s))===JSON.stringify(['schedule','status','--project',f.root,'--json'])));
});

for (const kind of ["github", "gitlab"]) {
  test(`${kind}: unknown implementer dependencies hold dispatch and recover without ticket edits`, t => {
    const f = fixture(t, kind);
    f.data.tickets[0].description = "Model tier: mid\nRequirement DEP:20";
    f.record(7, "queued");
    // A provider outside the open catalogue must be read, never presumed satisfied.
    f.data.tickets[1].contextOnly = true;
    f.data.errors = [20];
    f.manifest(7);
    const path = join(f.dir, "graph", `${f.key(7)}.json`);
    const manifest = JSON.parse(f.bytes(path));
    manifest.implementerBlockers = [{ iid: 20, what: "provider", evidence: "implementer report" }];
    writeFileSync(path, JSON.stringify(manifest));
    const held = f.pass();
    assert.match(held.stdout, /#20.*information unavailable/);
    assert.equal(existsSync(join(f.fake, "launches")), false);
    assert.equal(JSON.parse(f.bytes(join(f.dir, `${f.key(7)}.json`))).stage, "queued");
    assert.equal(f.assessment().dependencies?.find(d => d.iid === 20)?.state, "unknown");
    f.data.errors = [];
    f.data.tickets[1].state = "closed";
    f.pass();
    assert.match(f.bytes(join(f.fake, "launches")), /--issue 7/);
    assert.equal(f.assessment().dependencies?.find(d => d.iid === 20)?.state, "satisfied");
    const calls = f.bytes(join(f.fake, "tracker.jsonl"));
    assert.doesNotMatch(calls, /"(?:edit|comment|close|create)"/);
  });

  test(`${kind}: failed merge reads hold an open dependency until a later qualifying merge`, t => {
    const f = fixture(t, kind);
    f.data.tickets[0].description = "Model tier: mid\nRequirement DEP:20";
    f.record(7, "queued"); f.record(20, "waiting"); f.manifest(7);
    const path = join(f.dir, "graph", `${f.key(7)}.json`), manifest = JSON.parse(f.bytes(path));
    manifest.implementerBlockers = [{ iid: 20, what: "provider", evidence: "missing" }];
    writeFileSync(path, JSON.stringify(manifest));
    f.data.mergeErrors = ["20-topic"];
    assert.match(f.pass().stdout, /#20.*information unavailable/);
    assert.equal(existsSync(join(f.fake, "launches")), false);
    assert.equal(f.assessment().dependencies?.find(d => d.iid === 20)?.state, "unknown");
    f.data.mergeErrors = []; f.data.merged = ["20-topic"];
    f.pass();
    assert.match(f.bytes(join(f.fake, "launches")), /--issue 7/);
  });

  test(`${kind}: implementer lookup errors persist waitable blockers without needs-human`, t => {
    const f = fixture(t, kind);
    f.data.tickets[0].description = "Model tier: mid\nRequirement DEP:20";
    f.data.tickets[1].contextOnly = true;
    f.data.errors = [20];
    f.save();
    writeFileSync(join(dirname(f.node), 'docker'), `#!${process.execPath}\nimport { capabilityDocker } from ${JSON.stringify(join(import.meta.dirname, 'fixtures/capability-docker.mjs'))}; const a = process.argv.slice(2); if (a[0] === 'container' && a[1] === 'inspect' && a[2] === 'fixture-container') { console.error('No such container'); process.exit(1); } const out = capabilityDocker(a, process.env.FAKE_STATE); if (out === undefined) process.exit(90); console.log(out);`, { mode: 0o755 });
    const module = join(f.root, "node_modules/@ai-hero/sandcastle");
    mkdirSync(join(module, "sandboxes"), { recursive: true });
    writeFileSync(join(module, "package.json"), JSON.stringify({ type: "module", exports: { ".": "./index.mjs", "./sandboxes/docker": "./sandboxes/docker.mjs" } }));
    writeFileSync(join(module, "sandboxes/docker.mjs"), "export const docker = (options) => options;\n");
    writeFileSync(join(module, "index.mjs"), `
      import { execFileSync } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      export const pi = () => ({}), claudeCode = pi;
      export const createSandbox = async ({branch, baseBranch, sandbox}) => {
        execFileSync('git', ['branch', branch, baseBranch]);
        return { sandboxId:'fixture-container', close: async () => {}, exec: async () => ({stdout:'browser preflight OK',exitCode:0}), run: async () => {
          writeFileSync(sandbox.mounts[0].hostPath + '/blocked.json', JSON.stringify({blockers: [{iid:20, what:'provider', evidence:'missing API'}]}));
          return {commits: []};
        }};
      };
    `);
    const mainRuntime = bindExecution(f.root, f.env, { overlays: false });
    for (const errorMessage of ["authentication failed secret-token", "rate limit exceeded secret-token", "transport timeout secret-token"]) {
      f.data.errorMessage = errorMessage; f.save();
      const r = spawnSync(f.node, [join(mainRuntime.directory, 'main.mts'), "--issue", "7", "--base", "main"], { cwd: f.root, env: mainRuntime.env, encoding: "utf8", timeout: 20_000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const record = JSON.parse(f.bytes(join(f.dir, `${f.key(7)}.json`)));
      assert.equal(record.stage, "waiting");
      assert.match(record.note, /dependency information unavailable/);
      assert.doesNotMatch(record.note, /secret-token/);
      const manifest = JSON.parse(f.bytes(join(f.dir, "graph", `${f.key(7)}.json`)));
      assert.equal(manifest.implementerBlockers[0].iid, 20);
      assert.equal(git(f.root, "branch", "--list", "7-*"), "");
    }
    assert.doesNotMatch(f.bytes(join(f.fake, "tracker.jsonl")), /"(?:edit|comment|close|create)"/);
    f.data.errors = []; f.data.tickets[1].state = "closed";
    f.pass();
    assert.match(f.bytes(join(f.fake, "launches")), /--issue 7/);
  });

  test(`${kind}: TOML cap counts other projects and CLI cap/work overrides report their sources`, t => {
    const f = fixture(t, kind);
    f.data.tickets[0].description = 'Model tier: mid';
    const path = join(f.root, '.sandcastle/factory.toml');
    writeFileSync(path, f.bytes(path).replace('max_concurrent = 3', 'max_concurrent = 1').replace('units = "subtasks"', 'units = "issues"'));
    writeFileSync(join(f.dir, 'another_project--99.json'), JSON.stringify({
      iid: '99', project: 'another/project', stage: 'implementing', pid: process.pid,
    }));
    f.manifest(7);
    const held = f.pass(['--dry-run']);
    assert.match(held.stdout, /1 active run\(s\), cap 1 \(source: factory\.toml dispatch\.max_concurrent\)/);
    assert.match(held.stdout, /work: issues \(source: factory\.toml work\.units\)/);
    assert.doesNotMatch(held.stdout, /would launch/);
    const overridden = f.pass(['--dry-run', '--max', '2', '--whole-issues']);
    assert.match(overridden.stdout, /cap 2 \(source: --max\)/);
    assert.match(overridden.stdout, /work: issues \(source: --whole-issues\)/);
    assert.match(overridden.stdout, /#7 .*would launch/);
    assert.equal(existsSync(join(f.fake, 'launches')), false);
  });

  test(`${kind}: description failures queue without model labels, edits refresh the choice but not the attempt`, (t) => {
    const f = fixture(t, kind);
    f.data.tickets = [ticket(7, { description: "Model tier: unknown" }), ticket(8, { description: "Model: sonnet" }),
      ticket(9, { description: "Model tier: small\nModel tier: large" })];
    f.data.ready = [7, 8, 9];
    f.pass();
    for (const [n, status] of [[7, "unsupported"], [8, "unsupported"], [9, "conflicting"]] as const) {
      assert.equal(JSON.parse(f.bytes(join(f.dir, `${f.key(n)}.json`))).stage, "queued");
      assert.equal(f.assessment(n).modelResolution?.status, status);
      assert.ok(f.assessment(n).modelResolution?.revision);
    }
    assert.equal(existsSync(join(f.fake, "launches")), false);
    const original = JSON.parse(f.record(7, "implementing"));
    original.implementationModel = "attempt-original-model";
    writeFileSync(join(f.dir, `${f.key(7)}.json`), JSON.stringify(original));
    f.data.tickets[0].description = "Model tier: mid\nNew requirements";
    f.pass(["--refresh-only", "--ticket", "7"]);
    const resolved = f.assessment().modelResolution!;
    assert.equal(resolved.status, "resolved");
    assert.deepEqual(resolved.declarations, ["mid"]);
    assert.notEqual(resolved.revision, undefined);
    assert.deepEqual(JSON.parse(f.bytes(join(f.dir, `${f.key(7)}.json`))), original);
    f.data.tickets[0].description = "Model tier: large";
    f.pass(["--refresh-only", "--ticket", "7"]);
    assert.notEqual(f.assessment().modelResolution!.revision, resolved.revision);
    assert.notDeepEqual(f.assessment().modelResolution, resolved);
    assert.deepEqual(JSON.parse(f.bytes(join(f.dir, `${f.key(7)}.json`))), original);
    f.data.tickets[1].description = 'No declaration defaults to mid';
    f.manifest(8);
    f.pass();
    assert.equal(f.assessment(8).modelResolution?.status, 'resolved');
    assert.equal(f.assessment(8).modelResolution?.choice?.tier, 'mid');
    assert.equal(f.assessment(8).modelResolution?.choice?.source, 'factory-default');
    assert.equal(JSON.parse(f.bytes(join(f.dir, `${f.key(8)}.json`))).stage, 'setup', 'an edited valid declaration becomes dispatchable without a model label');
  });
}

test('refresh analyzes with frozen analysis instructions and invalidates the cache when bytes change', t => {
  const f = fixture(t); f.record(7, 'stopped');
  for (const [name, text] of Object.entries({ common: 'COMMON {{TICKET}} !`literal`', analysis: 'ANALYSIS ONLY', implementation: 'IMPLEMENTATION ONLY', verification: 'VERIFICATION ONLY', recovery: 'RECOVERY ONLY' })) writeFileSync(join(f.root, `${name}.md`), text);
  const config = join(f.root, '.sandcastle/factory.toml');
  writeFileSync(config, f.bytes(config) + '\n[instructions]\ncommon = ["common.md"]\nanalysis = ["analysis.md"]\nimplementation = ["implementation.md"]\nverification = ["verification.md"]\nrecovery = ["recovery.md"]\n');
  const calls = () => f.bytes(join(f.fake, 'analysis.jsonl')).trim().split('\n').map(line => JSON.parse(line));
  f.pass(['--refresh-only', '--ticket', '7']);
  assert.equal(f.assessment().analysisState, 'current', f.assessment().analysisError);
  const first = calls()[0].input;
  assert.match(first, /COMMON \{\{TICKET\}\} !`literal`/); assert.match(first, /ANALYSIS ONLY/);
  for (const role of ['IMPLEMENTATION', 'VERIFICATION', 'RECOVERY']) assert.ok(!first.includes(`${role} ONLY`));
  assert.match(first, /Reply with one JSON object/);
  f.pass(['--refresh-only', '--ticket', '7']);
  assert.equal(calls().length, 1, 'unchanged cache is reused');
  writeFileSync(join(f.root, 'analysis.md'), 'ANALYSIS CHANGED');
  f.pass(['--refresh-only', '--ticket', '7']);
  assert.equal(calls().length, 2, 'changed bytes require another real analysis');
  assert.match(calls()[1].input, /ANALYSIS CHANGED/);
  assert.match(first, /ANALYSIS ONLY/, 'captured invocation retains frozen text');
});

test("refresh fixtures override a missing inherited Pi extension with their own stub boundary", (t) => {
  const old = process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION;
  process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION = "/fixture-missing-provider/index.ts";
  t.after(() => {
    if (old === undefined) delete process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION;
    else process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION = old;
  });
  const f = fixture(t); f.record(7, "stopped");
  assert.equal(f.env.FACTORY_PI_SUBSCRIPTION_EXTENSION, join(f.fake, "subscription-extension.ts"));
  f.pass(["--refresh-only", "--ticket", "7"]);
  assert.equal(f.assessment().analysisState, "current", f.assessment().analysisError);
  const calls = f.bytes(join(f.fake, "analysis.jsonl")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf("-e") + 1], f.env.FACTORY_PI_SUBSCRIPTION_EXTENSION);
});

for (const kind of ["github", "gitlab"]) {
  test(`${kind}: a waiting automatic merge still reserves its open branch footprint`, (t) => {
    const f = fixture(t, kind);
    f.data.tickets = [ticket(7, { description: "Model tier: mid\nCandidate" }), ticket(8, { description: "Model tier: mid\nParked merge" })];
    f.data.ready = [7];
    f.data.openBranches = ["8-topic"];
    f.record(8, "waiting");
    for (const iid of [7, 8]) {
      f.manifest(iid);
      const path = join(f.dir, "graph", `${f.key(iid)}.json`);
      const m = JSON.parse(readFileSync(path, "utf8"));
      m.footprint = m.actualFootprint = ["shared.mts"];
      writeFileSync(path, JSON.stringify(m));
    }
    const result = f.pass();
    assert.equal(f.bytes(join(f.fake, "launches")), "absent", result.stdout + result.stderr);
    assert.match(result.stdout, /overlap|conflict|shared\.mts/i);
    assert.equal(JSON.parse(f.bytes(join(f.dir, `${f.key(8)}.json`))).stage, "waiting");
  });

  test(`${kind}: closed, deselected, excluded and out-of-milestone parked cards retain history and never launch`, (t) => {
    const f = fixture(t, kind);
    f.data.tickets = [ticket(7, { state: "closed" }), ticket(8, { labels: [] }), ticket(9, { labels: ["blocked"] }), ticket(10)];
    f.data.ready = [];
    const records = [7, 8, 9, 10].map((iid, n) => f.record(iid, n % 2 ? "waiting" : "queued"));
    const report = join(f.home, "jam.json");
    f.pass([], { FACTORY_JAM_REPORT: report, FACTORY_PASS_ID: "pass" });
    for (const [n, iid] of [7, 8, 9, 10].entries()) {
      assert.equal(f.bytes(join(f.dir, `${f.key(iid)}.json`)), records[n]);
      assert.equal(f.assessment(iid).facts?.selected, false);
    }
    assert.match(f.assessment(7).facts!.selectionReason!, /Closed/);
    assert.match(f.assessment(9).facts!.selectionReason!, /Excluded/);
    assert.equal(existsSync(join(f.fake, "launches")), false);
    assert.deepEqual(JSON.parse(f.bytes(report)).tickets, [], "retained deselected cards do not cause jams");
    assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
  });

  test(`${kind}: requirements, human comments and parent edits reassess stopped, active and completed cards without changing execution`, (t) => {
    const f = fixture(t, kind);
    f.data.tickets.push(ticket(30, { description: "parent context", contextOnly: true }));
    f.data.parents[7] = 30;
    const admission = join(f.dir, "admission/state.json");
    writeFileSync(admission, '{"preserve":"admission"}');
    for (const stage of ["stopped", "implementing", "done"]) {
      const record = f.record(7, stage); f.manifest(7);
      const mf = join(f.dir, "graph", `${f.key(7)}.json`), manifest = f.bytes(mf);
      for (const change of ["requirements", "comments", "parent"]) {
        f.data.tickets[0].description = "requirements" === change ? `Requirement DEP:21 (${stage})` : "Requirement";
        f.data.notes[7] = change === "comments" ? [{ body: `human DEP:21 (${stage})` }] : [];
        f.data.tickets.find((t: any) => t.iid === 30).description = change === "parent" ? `parent DEP:21 (${stage})` : "parent";
        // Exercise both scheduled refresh and the manual command against identical isolation assertions.
        f.pass(change === "comments" ? [] : ["--refresh-only", "--ticket", "7"]);
        const a = f.assessment();
        assert.equal(a.analysisState, "current");
        assert.deepEqual(a.dependencies?.map((b) => [b.iid, b.state]), [[21, "unsatisfied"]]);
        assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
        assert.equal(f.bytes(mf), manifest, "assessment never replaces the admission manifest");
        assert.equal(f.bytes(admission), '{"preserve":"admission"}');
      }
    }
    assert.equal(existsSync(join(f.fake, "launches")), false);
    const args = f.bytes(join(f.fake, "tracker.jsonl"));
    assert.doesNotMatch(args, /"create"|"POST"|"edit"|"comment"|"close"/);
  });

  test(`${kind}: manual HTTP refresh executes with scheduling off and exposes pending analysis`, async (t) => {
    const f = fixture(t, kind), record = f.record(7, "stopped");
    f.save();
    mkdirSync(join(f.home, ".config/factory"), { recursive: true });
    writeFileSync(join(f.home, ".config/factory/projects.json"), JSON.stringify({ version: 1, projects: [{ root: f.root, name: "site", schedule: { enabled: false } }] }));
    const server = spawn(process.execPath, [resolve("board/board-server.mts")], {
      cwd: f.home, env: { ...f.env, PORT: "0", FAKE_ANALYSIS_DELAY: "400" }, stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const [output] = await once(server.stdout!, "data"), url = String(output).match(/http:\/\/[^\s]+/)![0];
      const post = () => fetch(`${url}/api/refresh/${f.key(7)}`, { method: "POST", headers: { "x-factory-refresh": "1" } });
      assert.equal((await post()).status, 202);
      let pending = false, current = false;
      for (let i = 0; i < 150; i++) {
        const data = await (await fetch(`${url}/api/runs`)).json(), a = data.runs[0].assessment;
        pending ||= a?.analysisState === "pending";
        if (a?.analysisState === "current" && !a.pending) { current = true; break; }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(pending, "polling sees distinct pending-analysis state");
      assert.ok(current, JSON.stringify(f.assessment()));
      assert.equal(f.assessment().facts?.title, "Ticket 7");
      assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
      assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
      assert.equal(existsSync(join(f.fake, "launches")), false);
    } finally { server.kill(); await once(server, "exit"); }
  });
}

for (const kind of ["github", "gitlab"]) {
  test(`${kind}: dependency assessment is fail-closed for unresolved, human-only and lookup errors; closed/merged need explicit retry`, (t) => {
    const f = fixture(t, kind);
    const record = f.record(7, "stopped"); f.record(20, "done");
    const graph = join(f.dir, "graph", `${f.key(7)}.json`);
    for (const mode of ["unresolved", "human", "error", "closed", "merged"]) {
      f.data.errors = mode === "error" ? [20] : [];
      f.data.merged = mode === "merged" ? ["20-topic"] : [];
      f.data.tickets[0].description = mode === "unresolved" ? "DEP:99" : `DEP:20 ${mode}`;
      f.data.tickets[1].state = mode === "closed" ? "closed" : "open";
      f.manifest(7);
      const mf = JSON.parse(f.bytes(graph));
      mf.requires = [{ providedBy: 20, what: "historical requirement", evidence: "old", confidence: 1 }];
      mf.implementerBlockers = mode === "human" ? [{ iid: null, what: "human approval", evidence: "old" }] : [];
      writeFileSync(graph, JSON.stringify(mf));
      const before = f.bytes(graph);
      f.pass(["--refresh-only", "--ticket", "7"]);
      assert.equal(!!f.assessment().retryRequired, mode === "closed" || mode === "merged", mode);
      if (mode === "error" || mode === "unresolved") assert.equal(f.assessment().dependencies?.[0].state, "unknown", mode);
      assert.equal(f.bytes(graph), before);
      assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
    }
  });
}

test("refresh-only without --ticket reassesses every card of the project and nothing else (#93)", (t) => {
  const f = fixture(t);
  f.data.tickets.push(ticket(8), ticket(9));
  const records = new Map([[7, "stopped"], [8, "done"], [9, "waiting"]].map(([iid, stage]) => [iid as number, f.record(iid as number, stage as string)]));
  const other = join(f.dir, "other_repo--7.json"), otherRecord = JSON.stringify({ iid: "7", project: "other/repo", stage: "stopped", pid: process.pid, base: "main" });
  writeFileSync(other, otherRecord);
  f.pass(["--refresh-only"]);
  for (const [iid, record] of records) {
    assert.equal(f.assessment(iid).analysisState, "current", `#${iid} assessed`);
    assert.equal(f.bytes(join(f.dir, `${f.key(iid)}.json`)), record, `#${iid} run record untouched`);
  }
  assert.equal(readAssessment(f.dir, "other_repo--7"), undefined, "another project's card is not touched");
  assert.equal(f.bytes(other), otherRecord);
  assert.equal(existsSync(join(f.fake, "launches")), false);
  assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
  assert.doesNotMatch(f.bytes(join(f.fake, "tracker.jsonl")), /"create"|"POST"|"edit"|"comment"|"close"/);
});

test("#125: a refreshed deselected queued card leaves the board, keeps its record and returns when reselected", async (t) => {
  const f = fixture(t), record = f.record(7, "queued");
  const saved = process.env.SANDCASTLE_STATE_DIR;
  process.env.SANDCASTLE_STATE_DIR = f.dir;
  t.after(() => { if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const { buildBoardData } = await import("../board/board.mts");
  const shown = () => buildBoardData("http").runs.some((r) => r.key === f.key(7));
  f.data.ready = []; f.data.errors = [7];
  f.pass(["--refresh-only", "--ticket", "7"]);
  assert.ok(f.assessment().error);
  assert.equal(f.assessment().facts, undefined);
  assert.equal(shown(), true, "a failed refresh without confirmed deselection removes nothing");
  f.data.errors = [];
  f.pass(["--refresh-only", "--ticket", "7"]);
  assert.equal(f.assessment().facts?.selected, false);
  assert.equal(shown(), false, "confirmed deselection hides the queued card");
  assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record, "the raw run record is retained untouched");
  f.data.ready = [7];
  f.pass(["--refresh-only", "--ticket", "7"]);
  assert.equal(f.assessment().facts?.selected, true);
  assert.equal(shown(), true, "restored selection brings the card back");
  assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
  assert.equal(existsSync(join(f.fake, "launches")), false);
});

test("#135: capped GitHub selection preserves queued cards and last-good facts", async (t) => {
  const f = fixture(t), record = f.record(7, "queued");
  const saved = process.env.SANDCASTLE_STATE_DIR;
  process.env.SANDCASTLE_STATE_DIR = f.dir;
  t.after(() => { if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const { buildBoardData } = await import("../board/board.mts");
  f.pass(["--refresh-only", "--ticket", "7"]);
  const facts = f.assessment().facts;
  assert.equal(facts?.selected, true);
  // A Search-sized response that omits our still-eligible ticket is not proof of deselection.
  const others = Array.from({ length: 1000 }, (_, i) => ticket(100 + i));
  f.data.tickets.push(...others);
  f.data.ready = others.map((x) => x.iid);
  for (const args of [["--refresh-only", "--ticket", "7"], ["--refresh-only"]]) {
    f.pass(args);
    assert.match(f.assessment().error!, /Selection is unknown/);
    assert.deepEqual(f.assessment().facts, facts);
    assert.ok(buildBoardData("http").runs.some((r) => r.key === f.key(7)));
    assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
  }
  f.data.ready = [];
  f.pass(["--refresh-only", "--ticket", "7"]);
  assert.equal(f.assessment().facts?.selected, false);
  assert.equal(buildBoardData("http").runs.some((r) => r.key === f.key(7)), false);
});

test("refresh-only rejects a malformed --ticket", (t) => {
  const f = fixture(t); f.save();
  const r = spawnSync(f.node, [join(f.runtime.directory, 'dispatch.mts'), "--refresh-only", "--ticket", "x"], { cwd: f.root, encoding: "utf8", env: f.env, timeout: 20_000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--ticket <iid>/);
});

test("refresh-only does not reconcile or delete records whose process has died", (t) => {
  const f = fixture(t); f.record(7, "implementing");
  const path = join(f.dir, `${f.key(7)}.json`), r = JSON.parse(f.bytes(path));
  r.pid = 2 ** 22 + 4321; r.starting = true;
  writeFileSync(path, JSON.stringify(r));
  const before = f.bytes(path);
  f.pass(["--refresh-only", "--ticket", "7"]);
  assert.equal(f.assessment().analysisState, "current");
  assert.equal(f.bytes(path), before);
});

test("analysis timeout is recorded without changing execution or losing the last good analysis", (t) => {
  const f = fixture(t), record = f.record(7, "stopped");
  f.pass(["--refresh-only", "--ticket", "7"]);
  const prior = f.assessment().analysis;
  // #137: new fixtures use TOML authoritatively, so changing stale legacy code has no effect.
  const config = join(f.root, '.sandcastle/factory.toml');
  writeFileSync(config, f.bytes(config).replace('analysis_timeout_minutes = 10', 'analysis_timeout_minutes = 0.001'));
  f.data.tickets[0].description = "edited DEP:21";
  f.pass(["--refresh-only", "--ticket", "7"], { FAKE_ANALYSIS_DELAY: "3000" });
  assert.equal(f.assessment().analysisState, "error");
  assert.match(f.assessment().analysisError!, /analysis.*failed/);
  assert.deepEqual(f.assessment().analysis, prior);
  assert.equal(f.assessment().facts?.hash, unitHash(f.data.tickets[0]));
  assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
  assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
});

test("manual worker has a bounded process group and coalesces overlapping requests per card", async (t) => {
  const f = fixture(t), record = f.record(7, "stopped");
  // A deliberately hung project command, not a tracker/agent. It stands in for an adapter blocked in network I/O.
  writeFileSync(join(f.root, ".sandcastle/dispatch.mts"), `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.FAKE_STATE + '/hung-command', String(process.pid) + '\\n');\nawait new Promise(r => setTimeout(r, 60000));\n`);
  const env = { ...process.env };
  const hung = bindExecution(f.root, f.env);
  for (const [key, value] of Object.entries(hung.env)) if (value !== undefined) process.env[key] = value;
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
  requestRefresh(f.dir, f.key(7), "7", "owner/repo");
  const a = readAssessment(f.dir, f.key(7))!;
  const { writeAssessment } = await import("../board/assessment.mts");
  writeAssessment(f.dir, f.key(7), { ...a, projectRoot: f.root });
  const { executeRefresh } = await import("../board/refresh-worker.mts");
  const first = executeRefresh(f.key(7), 200), second = executeRefresh(f.key(7), 200);
  assert.equal(first, second, "same card shares its in-flight worker");
  await first;
  assert.match(f.assessment().error!, /timed out/);
  assert.equal(f.assessment().pending, false);
  const pids = f.bytes(join(f.fake, "hung-command")).trim().split("\n");
  assert.equal(pids.length, 1);
  assert.throws(() => process.kill(Number(pids[0]), 0));
  assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
  assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
});

test('a running dispatcher keeps bundle A for detached children after descriptor B publication', async t => {
  const f = fixture(t), gate = join(f.fake, 'replacement-gate');
  f.data.tickets = [ticket(7, { description: 'Implement this change' })]; f.save();
  writeFileSync(join(f.home, 'bin/pi'), `#!/bin/sh\ntouch '${gate}.ready'\nwhile [ ! -f '${gate}.release' ]; do sleep 0.02; done\nexec '${f.node}' '${join(FIXTURES, 'refresh-analysis.mjs')}' "$@"\n`, { mode: 0o755 });
  const child = spawn(f.node, [join(f.runtime.directory, 'dispatch.mts'), '--base', 'main'], { cwd: f.root, env: f.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', s => { output += s; }); child.stderr.on('data', s => { output += s; });
  const finished = once(child, 'close');
  t.after(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} });
  const deadline = Date.now() + 10000;
  while (!existsSync(`${gate}.ready`) && child.exitCode === null && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  assert.ok(existsSync(`${gate}.ready`), output);
  const source = join(f.runtime.staging, 'source'), store = dirname(f.runtime.directory);
  writeFileSync(join(source, 'cli/templates/project/prompt.md'), 'Bundle B implementation prompt');
  const b = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: store, install: installPackages });
  const paths = { data: dirname(store), runtimes: store, runtimeDescriptor: join(dirname(store), 'runtime.json') } as any;
  withRuntimeLock(paths, () => { recordRuntimeOwnership(paths, b.id); writeRuntimeDescriptor(paths, b.id); });
  writeFileSync(`${gate}.release`, '');
  const [code] = await finished; assert.equal(code, 0, output);
  const launched = join(f.fake, 'launch-context'), limit = Date.now() + 3000;
  while (!existsSync(launched) && Date.now() < limit) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(JSON.parse(f.bytes(launched)), { project: f.root, runtime: f.runtime.directory, id: f.runtime.id });
  assert.match(f.bytes(join(f.fake, 'launches')), new RegExp(`${f.runtime.id}/main\\.mts`));
  assert.equal(existsSync(join(f.root, '.sandcastle/logs/run-7.log')), true);
  assert.equal(existsSync(join(f.runtime.directory, 'logs')), false);
  assert.equal(JSON.parse(readFileSync(paths.runtimeDescriptor, 'utf8')).id, b.id);
});

for (const olderManual of [false, true]) {
  test(`out-of-order ${olderManual ? "manual then scheduled" : "scheduled then manual"} refresh keeps newer facts and analysis`, async (t) => {
    const f = fixture(t), record = f.record(7, "stopped"), gate = join(f.fake, "gate");
    f.save();
    // Only the older process has the gate variable. The newer analyst runs to completion before we release it.
    writeFileSync(join(f.home, "bin/pi"), `#!/bin/sh
if [ -n "$REFRESH_TEST_GATE" ]; then
  touch "$REFRESH_TEST_GATE.ready"
  while [ ! -f "$REFRESH_TEST_GATE.release" ]; do sleep 0.02; done
fi
exec "${f.node}" "${join(FIXTURES, "refresh-analysis.mjs")}" "$@"
`, { mode: 0o755 });
    const older = spawn(f.node, [join(f.runtime.directory, 'dispatch.mts'), "--base", "main", ...(olderManual ? ["--refresh-only", "--ticket", "7"] : [])], {
      cwd: f.root, detached: true, env: { ...f.env, REFRESH_TEST_GATE: gate }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    older.stdout.on("data", (s) => { output += s; }); older.stderr.on("data", (s) => { output += s; });
    const closed = once(older, "close");
    t.after(() => { try { process.kill(-older.pid!, "SIGKILL"); } catch { /* group already gone */ } });
    const deadline = Date.now() + 10_000;
    while (!existsSync(`${gate}.ready`) && older.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(existsSync(`${gate}.ready`), `older analysis paused: ${output}`);
    assert.equal(f.assessment().analysisState, "pending");
    assert.equal(f.assessment().facts?.title, "Ticket 7");
    f.data.tickets[0].title = "Edited NEW ticket";
    f.data.tickets[0].description = "Edited DEP:21";
    requestRefresh(f.dir, f.key(7), "7", "owner/repo");
    f.pass(olderManual ? [] : ["--refresh-only", "--ticket", "7"]);
    const authoritative = f.assessment();
    assert.equal(authoritative.facts?.title, "Edited NEW ticket");
    assert.equal(authoritative.analysisState, "current");
    assert.equal(authoritative.pending, false);
    assert.deepEqual(authoritative.dependencies?.map((b) => b.iid), [21]);
    writeFileSync(`${gate}.release`, "");
    const [code] = await closed;
    assert.equal(code, 0, output);
    assert.deepEqual(f.assessment(), authoritative, "older completion cannot overwrite or erase the newer result");
    assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
    assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
    assert.equal(existsSync(join(f.fake, "launches")), false);
  });
}

test("an older catalogue failure cannot overwrite a newer process's successful assessment", async (t) => {
  const f = fixture(t), record = f.record(7, "stopped"), gate = join(f.fake, "catalogue-gate");
  f.save();
  writeFileSync(join(f.home, "bin/gh"), `#!/bin/sh
if [ -n "$REFRESH_TEST_GATE" ] && [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  touch "$REFRESH_TEST_GATE.ready"
  while [ ! -f "$REFRESH_TEST_GATE.release" ]; do sleep 0.02; done
  echo 'old catalogue failure' >&2
  exit 2
fi
exec "${f.node}" "${join(FIXTURES, "refresh-tracker.mjs")}" "$@"
`, { mode: 0o755 });
  const older = spawn(f.node, [join(f.runtime.directory, 'dispatch.mts'), "--refresh-only", "--ticket", "7", "--base", "main"], {
    cwd: f.root, detached: true, env: { ...f.env, REFRESH_TEST_GATE: gate }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  older.stdout.on("data", (s) => { output += s; }); older.stderr.on("data", (s) => { output += s; });
  const closed = once(older, "close");
  t.after(() => { try { process.kill(-older.pid!, "SIGKILL"); } catch { /* group already gone */ } });
  const deadline = Date.now() + 10_000;
  while (!existsSync(`${gate}.ready`) && older.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.ok(existsSync(`${gate}.ready`), `older catalogue paused: ${output}`);
  f.data.tickets[0].title = "Newer facts before catalogue error";
  requestRefresh(f.dir, f.key(7), "7", "owner/repo");
  f.pass(["--refresh-only", "--ticket", "7"]);
  const authoritative = f.assessment();
  assert.equal(authoritative.analysisState, "current");
  assert.equal(authoritative.pending, false);
  writeFileSync(`${gate}.release`, "");
  const [code] = await closed;
  assert.equal(code, 0, output);
  assert.match(output, /old catalogue failure/);
  assert.deepEqual(f.assessment(), authoritative);
  assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
  assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
});

test("a superseded manual worker timeout cannot overwrite a newer scheduled result", async (t) => {
  const f = fixture(t), record = f.record(7, "stopped"), gate = join(f.fake, "worker-gate");
  f.save();
  writeFileSync(join(f.home, "bin/pi"), `#!/bin/sh
if [ -n "$REFRESH_TEST_GATE" ]; then
  touch "$REFRESH_TEST_GATE.ready"
  while [ ! -f "$REFRESH_TEST_GATE.release" ]; do sleep 0.02; done
fi
exec "${f.node}" "${join(FIXTURES, "refresh-analysis.mjs")}" "$@"
`, { mode: 0o755 });
  const env = { ...process.env };
  Object.assign(process.env, f.env, { REFRESH_TEST_GATE: gate });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
  requestRefresh(f.dir, f.key(7), "7", "owner/repo");
  const { writeAssessment } = await import("../board/assessment.mts");
  writeAssessment(f.dir, f.key(7), { iid: "7", project: "owner/repo", projectRoot: f.root });
  const { executeRefresh } = await import("../board/refresh-worker.mts");
  const job = executeRefresh(f.key(7), 3000);
  try {
    const deadline = Date.now() + 2500;
    while (!existsSync(`${gate}.ready`) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(existsSync(`${gate}.ready`), "manual child reached its pending analysis using the worker's token");
    assert.equal(f.assessment().analysisState, "pending");
    f.data.tickets[0].title = "Newer scheduled title";
    f.data.tickets[0].description = "new DEP:21";
    f.pass();
    const authoritative = f.assessment();
    assert.equal(authoritative.facts?.title, "Newer scheduled title");
    assert.equal(authoritative.analysisState, "current");
    assert.equal(authoritative.pending, false);
    await job;
    assert.deepEqual(f.assessment(), authoritative, "the worker's timeout error is fenced too");
    assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
    assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
  } finally { await job; }
});

test("analysis is bounded by GRAPH.maxAnalysesPerPass across execution and assessment", (t) => {
  const f = fixture(t);
  f.data.tickets = [...Array(7)].map((_, i) => ticket(i + 1)); f.data.ready = [];
  for (let i = 1; i <= 7; i++) f.record(i, "stopped");
  f.pass();
  assert.equal(f.bytes(join(f.fake, "analysis.jsonl")).trim().split("\n").length, 5);
  assert.equal([...Array(7)].filter((_, i) => f.assessment(i + 1).analysisState === "pending").length, 2);
});

test("assessment read, write/rename and request-removal failures preserve eligible launches and admission", (t) => {
  const results: any[] = [];
  for (const failure of ["healthy", "read", "write", "rename", "remove"]) {
    const f = fixture(t); f.record(8, "stopped"); f.data.tickets.push(ticket(8)); f.manifest(7);
    // Ensure no analysis is necessary to make the same #7 launch decision in every scenario.
    const dir = join(f.dir, "assessment"), refresh = join(f.dir, "refresh");
    if (failure === "read") writeFileSync(dir, "not a directory");
    if (failure === "write") symlinkSync(join(f.home, "missing-parent", "assessment"), dir);
    if (failure === "rename") mkdirSync(join(dir, `${f.key(8)}.json`), { recursive: true });
    if (failure === "remove") {
      mkdirSync(refresh); mkdirSync(join(refresh, `${f.key(8)}.json`));
    }
    const pass = f.pass();
    assert.match(pass.stdout, /#7 Ticket 7: launching/);
    if (failure !== "healthy") assert.match(pass.stdout + pass.stderr, /assessment store/);
    const admission = JSON.parse(f.bytes(join(f.dir, "admission/state.json")));
    results.push({ generations: admission.generations, keys: Object.keys(admission.claims), launch: /#7 Ticket 7: launching/.test(pass.stdout) });
  }
  for (const r of results) assert.deepEqual(r, results[0]);
});
