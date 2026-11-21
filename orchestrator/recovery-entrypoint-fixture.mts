// Shared recovery lifecycle fixture: copied-install acceptance and legacy regression scenarios use isolated fake external boundaries.
import { bindExecution } from '../cli/test/execution-fixture.mts';
import { prepareFixtureAcceptance, prepareFixtureFromRuntime } from './fixtures/acceptance-preparation.mts';
import {preparedFixture} from '../cli/test/prepared-fixture.mts';
import { commandContextSource } from './ticket-context-source.mts';
import {prepareRecovery} from '../cli/src/recovery-prepare.mts';
// Real launcher, selected runtime entrypoint, preparation, verification and settlement run with local Git and fixture-owned SDK, tracker, pi and Docker.
import { verificationCommand } from './fixtures/verification.mts';
import type { TestContext } from 'node:test';
import { Fake } from '../cli/src/platform/fake.mts';
import { install } from '../cli/src/commands/install.mts';
import { stageExecutionPackages } from '../cli/test/execution-fixture.mts';
import { pathToFileURL } from 'node:url';
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {writeAssessment,readAssessment} from '../board/assessment.mts';
import { readAdmission } from "../board/admission.mts";
import { claimRun, readRuns } from "../board/board.mts";
import { projectId, readReceipt, receiptFile } from "./ownership.mts";
import { paths } from "../cli/src/paths.mts";
import { recordReview, WORKFLOW } from "../cli/src/recovery-review.mts";
import { buildAssets } from "../cli/src/scaffold.mts";
import { checkImageCapabilities } from './capabilities.mts';
import { launchRecovery, settleRecovery } from "../cli/src/recovery-run.mts";
import type { Spawner } from "../cli/src/recovery-run.mts";
import { observePass, readRecovery } from "../cli/src/recovery-state.mts";
import { containerFor, readAttemptRecord } from "./recovery.mts";
import type { AttemptRecord, Docker } from "./recovery.mts";
import { readProof } from './verification.mts';

const ID = "5b1f3c2a-9d8e-4f70-8a6b-0c1d2e3f4a5b";
const FIXTURES = join(import.meta.dirname, "fixtures/entrypoint");
const at = (m: number) => new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString();

export async function recoveryEntrypointFixture(t: TestContext, scenario: string, tier: string, copied = false) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "factory-entry-")));
  const children: ChildProcess[] = [];
  t.after(() => { for (const c of children) c.kill("SIGKILL"); rmSync(home, { recursive: true, force: true }); });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  // origin, the project checkout and the ticket's recorded branch/worktree with half-done work.
  const origin = join(home, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const root = join(home, "site");
  execFileSync("git", ["clone", "-q", origin, root], { stdio: "ignore" });
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  writeFileSync(join(root, "app.txt"), "v1\n");
  git(root, "add", "app.txt");
  git(root, "commit", "-qm", "init");
  git(root, "push", "-q", "origin", "main");
  git(root, "branch", "7-fix-login");
  git(root, "branch", "8-other");
  const worktree = join(root, ".factory/worktrees/7-fix-login");
  mkdirSync(dirname(worktree), { recursive: true });
  git(root, "worktree", "add", "-q", worktree, "7-fix-login");
  writeFileSync(join(worktree, "app.txt"), "v2\n");
  git(worktree, "commit", "-qam", "half done");
  writeFileSync(join(worktree, "untracked.txt"), "keep me\n");
  const otherRef = git(root, "rev-parse", "8-other");
  const savedStart = git(worktree, 'rev-parse', 'HEAD');

  // The scaffold as factory init writes it, recorded as reviewed the way init records a new scaffold (#63).
  const state = join(home, "runs");
  const sdk = join(home, 'fixture-sdk');
  cpSync(join(FIXTURES, "sandcastle"), sdk, { recursive: true });
  const p = paths(home);
  if (copied) {
    await install(p, new Fake(p), { installPackages: dir => stageExecutionPackages(dir, sdk) });
    const { init } = await import(pathToFileURL(join(p.app, 'cli/src/commands/init.mts')).href);
    await init(p, root, { profile: 'personal', repo: 'owner/repo', image: 'img' });
    assert.deepEqual(readdirSync(join(root, '.factory')).sort(), ['.env', '.env.example', '.gitignore', 'factory-dispatch.sh', 'factory.toml', 'worktrees'].sort());
  } else {
    for (const f of buildAssets({ profile: "personal", repo: "owner/repo", image: "img" }, state)) {
      mkdirSync(dirname(join(root, f.path)), { recursive: true });
      writeFileSync(join(root, f.path), f.content, { mode: f.mode });
    }
  }
  const configPath = join(root, '.factory/factory.toml');
  writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('family = "openai"', copied ? 'family = "openai"' : 'family = "anthropic"') + '\n[instructions]\ncommon = ["common.md"]\nimplementation = ["impl.md"]\nanalysis = ["analysis.md"]\nverification = ["verify.md"]\nrecovery = ["repair.md"]\n');
  for (const [file, text] of Object.entries({ 'common.md': 'COMMON {{TICKET}} !`literal`', 'impl.md': 'IMPLEMENTATION ONLY', 'analysis.md': 'ANALYSIS ONLY', 'verify.md': 'VERIFICATION ONLY', 'repair.md': 'RECOVERY ONLY' })) writeFileSync(join(root, file), text);
  const evidence = join(root, ".factory/evidence/7");
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, "verdict.md"), "VERDICT: FAIL\nold\n");
  const bin = join(home, "bin");
  mkdirSync(bin);
  for (const tool of ["gh", "docker"]) {
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${join(FIXTURES, `${tool}.mjs`)}" "$@"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const fake = join(home, "fake");
  mkdirSync(fake);
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SCENARIO: scenario, FAKE_CONTEXT_PARENT: ['pass','parent-plan'].includes(scenario) ? '90' : '', FAKE_TICKET_BODY: `Model tier: ${tier}\nThe login form must work.`,
    FAKE_SETUP_BROWSER_BAD: scenario === 'setup-bad' ? 'yes' : '',
    FAKE_SANDBOX_FAULT: scenario.startsWith('sandbox-') ? scenario.slice(8) : '',
    FAKE_DEPENDENCY_ERROR: scenario === 'dependency-unknown' ? 'yes' : '',
    FAKE_MUTATION: scenario === 'closed-before' ? 'closed' : scenario === 'title' ? 'title' : '',
    FAKE_REPAIR: `printf 'fixed\\n' > fix.txt && git add -A && git commit -qm repair && printf '%s' '${JSON.stringify({ cause: "missing fix", filesChanged: ["fix.txt", "untracked.txt"], tests: [{ command: "true", result: "pass" }], canProceed: true, remainingBlockers: [], requiresHostUpdate: false })}' > "$EVIDENCE/recovery-report.json" && echo ok > "$EVIDENCE/recovery-report.md"`,
    FAKE_VERIFY: `printf 'VERDICT: PASS\\nverified\\n' > "$EVIDENCE/verdict.md" && ${verificationCommand()}`,
  };
  if (scenario === 'closed-before') env.FAKE_REPAIR += ` && touch '${join(fake, 'changed')}'`;
  if (scenario === 'title' || scenario === 'parent-plan') env.FAKE_VERIFY += ` && touch '${join(fake, 'changed')}'`;
  if (scenario === 'dirty') env.FAKE_VERIFY += ` && echo dirty > app.txt`;
  if (scenario === 'legacy-prompt') env.FAKE_VERIFY = `printf 'VERDICT: PASS\\nlegacy\\n' > "$EVIDENCE/verdict.md"`;
  const docker: Docker = (args) => {
    const r = spawnSync(join(bin, "docker"), args, { encoding: "utf8", env: { ...process.env, ...env } });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  // A stopped run of #7 and a jam confirmed on two passes.
  claimRun({ dir: state, project: "owner/repo", iid: "7", pid: 2 ** 22 + 4321, cap: 99,
    patch: { stage: "stopped", note: "exited", starting: undefined, branch: "7-fix-login", base: "main", ...(copied ? { implementationModel: 'openai/gpt-6.1-terra' } : {}), implementationBaseSha: scenario === 'missing-baseline' ? undefined : git(root, 'rev-parse', 'main'), evidenceDir: evidence } });
  observePass(p, root, { pass: "a", at: at(0), jam: [7] });
  observePass(p, root, { pass: "b", at: at(5), jam: [7] });

  const runtime = bindExecution(root, { ...process.env, ...env, SANDCASTLE_STATE_DIR: state }, { paths: p, sdk, overlays: false, ...(copied ? { sourceRoot: p.app } : {}) });
  assert.equal(existsSync(join(root, 'node_modules')), false, 'the project never supplies fixture dependencies');
  Object.assign(env, runtime.env);
  if (copied) {
    assert.equal(runtime.directory, join(p.runtimes, runtime.id));
    assert.equal(runtime.env.FACTORY_RUNTIME_ROOT, runtime.directory);
    assert.equal(runtime.env.FACTORY_RUNTIME_ID, runtime.id);
    for (const name of ['main.mts', 'recovery.mts', 'prompt.recover.md', 'prompt.verify.md', 'node_modules']) assert.equal(existsSync(join(root, '.factory', name)), false, name);
    writeFileSync(join(bin, 'npm'), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(fake, 'npm-called'))}, 'unexpected'); process.exit(91);\n`, {mode:0o755});
  } else {
    // Legacy review gate remains independent of the selected runtime.
    for (const file of WORKFLOW) {
      const path = join(root, '.factory', file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file === 'main.mts' ? '"attempt-record": { type: "string" }' : 'fixture review');
    }
    recordReview(p, root, { by: 'init' });
  }
  const { loadExecutionContext } = await import('./context.mts');
  const policy = (await loadExecutionContext({ env: runtime.env, cwd: root, moduleRoot: runtime.directory })).policyIdentity;
  // The dispatcher's analysis of #7, with the same explicit runtime context.
  const preparedInput = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `const t = await import(${JSON.stringify(join(runtime.directory, 'tracker.mts'))}); const g = await import(${JSON.stringify(join(runtime.directory, 'ticket-input.mts'))}); process.stdout.write(JSON.stringify(g.freezeTicketInput(t.contextSource, 7)));`],
  { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state } }));
  const hash = preparedInput.hash;
  prepareFixtureAcceptance(state, preparedInput);
  mkdirSync(join(state, "graph"), { recursive: true });
  writeFileSync(join(state, "graph", "owner_repo--7.json"), JSON.stringify({ iid: 7, project: "owner/repo", hash, policyIdentity: policy, analyzedAt: at(1), base: "main", baseSha: "",
    provides: [], requires: scenario === 'dependency-unknown' ? [{ providedBy: 12, what: 'provider', evidence: 'ticket', confidence: 1 }] : [], footprint: ["app.txt"], catalogueIids: [], blockerHashes: {} }));

  // The launcher's own spawn, minus npx/tsx: node runs the scaffolded main.mts directly.
  let child!: ChildProcess;
  const spawner: Spawner = (cmd, args, o) => {
    assert.deepEqual([cmd, args[0], args[1]], [process.execPath, join(runtime.directory, 'node_modules/tsx/dist/cli.mjs'), join(runtime.directory, 'main.mts')]);
    const out = openSync(o.log, "a");
    child = spawn(process.execPath, copied ? args : [join(runtime.directory, 'main.mts'), ...args.slice(2)], { cwd: o.cwd, env: { ...o.env, ...env }, stdio: ["ignore", out, out] });
    children.push(child);
    return child.pid!;
  };
  let preparation=preparedFixture({root,tracker:'owner/repo',ticket:7,dir:state});
  if (scenario==='pass') {
    const file=join(state,'graph','owner_repo--7.json');
    const stale=JSON.parse(readFileSync(file,'utf8'));delete stale.recoveryAnalysisKey;stale.hash='stale';writeFileSync(file,JSON.stringify(stale));
    // A current assessment is observational, never authority to spend a recovery attempt.
    writeAssessment(state,'owner_repo--7',{iid:'7',project:'owner/repo',analysisState:'current',
      facts:{title:'Fix login',state:'open',labels:[],hash,checkedAt:at(5)},analysis:{input:hash,analyzedAt:at(5),requires:[]}});
    const assessment=readAssessment(state,'owner_repo--7');
    assert.equal((await launchRecovery(p,{root,tracker:'owner/repo',ticket:7,dir:state})).ok,false);
    assert.equal(readRecovery(p,root).attempts.length,0);
    const extension=join(home,'subscription-fixture.mjs');writeFileSync(extension,'// fixture only');
    writeFileSync(join(bin,'pi'),`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({provides:['fix'],requires:[],footprint:['app.txt']})));\n`,{mode:0o755});
    const heldInput=await prepareRecovery(p,{root,tracker:'owner/repo',ticket:7,base:'main',dir:state,
      spawn:(node,args,o)=>spawn(node,[join(runtime.directory, args[0].split('/').at(-1)!), ...args.slice(1)],{...o,env:{...o.env,...env,SCENARIO:'parent-read-failed',FACTORY_PI_SUBSCRIPTION_EXTENSION:extension}})});
    assert.equal(heldInput.state,'held',JSON.stringify(heldInput));
    assert.match(heldInput.reason,/parent #90 notes: read-failed/);
    assert.equal(readRecovery(p,root).attempts.length,0,'host-known input failure spends zero attempts');
    assert.equal(existsSync(join(fake,'models.log')),false,'no sandbox agent starts');
    const ready=await prepareRecovery(p,{root,tracker:'owner/repo',ticket:7,base:'main',dir:state,
      spawn:(node,args,o)=>spawn(node,[join(runtime.directory, args[0].split('/').at(-1)!), ...args.slice(1)],{...o,env:{...o.env,...env,FACTORY_PI_SUBSCRIPTION_EXTENSION:extension}})});
    assert.equal(ready.state,'ready',JSON.stringify(ready));if(ready.state!=='ready')throw Error(ready.reason);preparation=ready;
    assert.equal(readRecovery(p,root).attempts.length,0,'preparation did not charge');
    assert.deepEqual(readAssessment(state,'owner_repo--7'),assessment,'execution preparation never rewrites assessment');
    assert.equal(git(root,'rev-parse','7-fix-login'),git(worktree,'rev-parse','HEAD'),'saved implementation preserved');
    assert.equal(readFileSync(join(evidence,'verdict.md'),'utf8'),'VERDICT: FAIL\nold\n');
  }
  let readinessChecked = false;
  const launch = await launchRecovery(p, { root, preparation, tracker: "owner/repo", ticket: 7, dir: state,
    contextSource: commandContextSource({kind:'github',host:'github.com',project:'owner/repo'}, undefined, {...process.env,...env}),
    capabilities: o => {
      readinessChecked = true;
      assert.equal(readRecovery(p, root).attempts.length, 0, 'readiness precedes admission and charge');
      return checkImageCapabilities({ ...o, docker: async args => {
      const r = docker(args); if (r.status !== 0) throw Error('offline Docker failure'); return r.stdout;
    } }); }, docker, spawn: spawner, npx: "npx", uuid: () => ID, at: at(10) });
  assert.equal(readinessChecked, true);
  assert.equal(launch.ok, true, (launch as { reason?: string }).reason);
  const [code] = await once(child, "exit");
  const log = readFileSync(join(root, ".factory/logs/recover-7.log"), "utf8");
  if (scenario !== 'pass') {
    assert.notEqual(code, 0, log);
    assert.equal(git(origin, 'branch', '--list', '7-fix-login'), '', log);
    const expected = ({'missing-baseline':/Missing recorded implementation baseline/,title:/Acceptance static hold: missing-preparation/,'parent-plan':/Acceptance static hold: missing-preparation/,'closed-before':/is closed/,dirty:/Verifier changed the branch/,'legacy-prompt':/verification.json/, 'dependency-unknown':/Dependency information unavailable for #12/, 'setup-bad':/Playwright\/Chromium provisioning failure/} as Record<string, RegExp>)[scenario];
    assert.match(log, scenario.startsWith('sandbox-') ? /[Ss]andbox readiness/ : expected);
    const calls = existsSync(join(fake, 'docker.jsonl')) ? readFileSync(join(fake, 'docker.jsonl'), 'utf8') : '';
    if (scenario === 'missing-baseline') assert.ok(!calls.includes('"run"'), log);
    if (scenario.startsWith('sandbox-')) {
      assert.equal(readRecovery(p, root).budgets[7].used, 1, 'post-container readiness spends exactly the admitted attempt');
      assert.equal(existsSync(join(fake, 'models.log')), false, 'no repair or verifier provider starts');
      const r = readAttemptRecord(join(p.recovery, 'attempts', `${ID}.json`));
      assert.ok(r.ok);
      if (r.ok) {
        assert.equal(r.record.deadline, undefined);
        assert.equal(r.record.phase, scenario === 'sandbox-cleanup' ? 'cleanup-pending' : 'finished');
        assert.equal(existsSync(join(fake, 'containers', `${r.record.container}.json`)), scenario === 'sandbox-cleanup');
        assert.ok(existsSync(join(r.record.evidence, 'input/status.txt')), 'input work preserved');
        assert.ok(existsSync(join(r.record.evidence, 'setup-browser-preflight.log')), 'browser gate still runs first');
        if (scenario === 'sandbox-cleanup') assert.match(r.record.reason!, /evidence-create-write-rename-remove.*not confirmed gone/s);
      }
      const probe = JSON.parse(readFileSync(join(fake,'sandbox-probe-input.json'),'utf8'));
      assert.equal(probe.uid, process.getuid!()); assert.equal(probe.gid, process.getgid!());
      assert.equal(probe.tip, git(worktree, 'rev-parse', 'HEAD'));
    }
    if (scenario === 'setup-bad') {
      assert.equal(readRecovery(p, root).budgets[7].used, 1, 'post-admission setup failures are never refunded');
      assert.equal(existsSync(join(fake, 'models.log')), false, 'no repair or verifier provider starts');
      const r = readAttemptRecord(join(p.recovery, 'attempts', `${ID}.json`));
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.match(readFileSync(join(r.record.evidence, 'setup-browser-preflight.log'), 'utf8'), /Chromium launch/);
        assert.equal(existsSync(join(r.record.evidence, 'browser-preflight.log')), false);
        assert.equal(r.record.deadline, undefined, 'repair deadline has not started');
      }
    }
    return;
  }
  assert.equal(code, 0, log);
  const prompts = readFileSync(join(fake, 'prompts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as string);
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) { assert.ok(prompt.includes('COMMON {{TICKET}} !`literal`')); assert.ok(!prompt.includes('IMPLEMENTATION ONLY')); assert.ok(!prompt.includes('ANALYSIS ONLY')); }
  assert.ok(prompts[0].includes('RECOVERY ONLY')); assert.ok(!prompts[0].includes('VERIFICATION ONLY'));
  assert.ok(prompts[1].includes('VERIFICATION ONLY')); assert.ok(!prompts[1].includes('RECOVERY ONLY'));
  assert.match(prompts[0], /recovery-report\.json/); assert.match(prompts[1], /verification\.json/);

  const record = (readAttemptRecord(join(p.recovery, "attempts", `${ID}.json`)) as { record: AttemptRecord }).record;
  assert.equal(record.outcome, "delivered", record.reason);
  const tip = git(root, "rev-parse", "7-fix-login");
  const baseline = git(root, 'rev-parse', 'main');
  assert.equal(record.startSha, savedStart);
  assert.equal(record.tip, tip);
  assert.ok(prompts[1].includes(`Full ticket scope is always \`${baseline}\` to \`${tip}\``));
  assert.ok(prompts[1].includes(`commit for behavioral comparison only is \`${savedStart}\``));
  assert.match(prompts[1], /first read `\/home\/agent\/evidence\/7\/recovery-report\.json` and `\/home\/agent\/evidence\/7\/recovery-report\.md`/);
  assert.equal(git(origin, "rev-parse", "7-fix-login"), tip, "the exact verified tip was pushed");
  const gh = readFileSync(join(fake, "gh.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).args as string[]);
  // #153: the REST merge API preserves the same exact-head guard as initial/continued delivery.
  const merge = gh.find((a) => a[0] === 'api' && a.includes('repos/owner/repo/pulls/9/merge'))!;
  assert.ok(merge.includes(`sha=${tip}`), 'delivery merged only that tip');
  assert.equal(gh.filter((a) => a[0] === "pr" && a[1] === "create").length, 1);
  // The repair and verifier ran with AGENT.model, not the ticket's model:sonnet label.
  assert.deepEqual([...new Set(readFileSync(join(fake, "models.log"), "utf8").trim().split("\n"))], [copied ? 'pi openai/gpt-6.1-sol' : 'pi pi-claude-subscription/claude-opus-5-5']);
  // Exactly the recorded container; it is gone.
  const dockerCalls = readFileSync(join(fake, "docker.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
  const run = dockerCalls.filter((a) => a[0] === "run");
  assert.equal(run.length, 1);
  assert.equal(run[0][run[0].indexOf("--name") + 1], containerFor(ID));
  assert.ok(dockerCalls.every((a) => a[0] === "run" || a.includes(containerFor(ID))), "every docker call names the attempt's container");
  assert.deepEqual(readdirSync(join(fake, "containers")), []);
  assert.equal(git(root, "rev-parse", "8-other"), otherRef);
  assert.equal(readFileSync(join(evidence, "verdict.md"), "utf8"), "VERDICT: FAIL\nold\n", "earlier evidence kept");
  assert.equal(readFileSync(join(record.evidence, 'history/verdict.md'), 'utf8'), 'VERDICT: FAIL\nold\n', 'history retains the saved verdict');
  assert.match(readFileSync(join(record.evidence, 'verdict.md'), 'utf8'), /VERDICT: PASS/);
  assert.equal(readFileSync(join(worktree, 'untracked.txt'), 'utf8'), 'keep me\n', 'saved untracked work survived repair');
  const runRec = readRuns(state).find((r) => r.iid === "7")!;
  const inputDir = join(state, 'ticket-inputs', 'owner_repo--7', runRec.executionId!, ID);
  const inputText = readFileSync(join(inputDir, 'ticket-context.txt'), 'utf8');
  assert.ok(prompts[0].includes(inputText)); assert.ok(prompts[1].includes(inputText));
  assert.match(inputText, /Complete parent body with packaging requirements/);
  assert.match(inputText, /Agreed parent decisions and implementation plan/);
  const snapshot = JSON.parse(readFileSync(join(inputDir, 'ticket-context.json'), 'utf8'));
  assert.equal(snapshot.contentHash, runRec.verification!.requirementsHash);
  readProof(state, { project: 'owner/repo', ticket: '7', executionId: runRec.executionId!, attemptId: ID,
    branch: '7-fix-login', base: 'main', baseline, tip, requirementsHash: snapshot.contentHash }, runRec.verification!.id);
  if (copied) assert.equal(runRec.implementationModel, 'openai/gpt-6.1-terra');
  assert.deepEqual([runRec.stage, runRec.verdict, runRec.mr], ["done", "PASS", "https://github.com/owner/repo/pull/9"]);

  // The pre-upgrade run's exact branch was adopted into an ownership receipt; the recovery claim holds until settled.
  const receipt = readReceipt(receiptFile(state, projectId(root, { kind: "github", host: "github.com", project: "owner/repo" }), "7"))!;
  assert.deepEqual([receipt.branch, receipt.runId, receipt.worktreePath], ["7-fix-login", ID, realpathSync(worktree)]);
  assert.equal(readAdmission(state).claims["owner_repo--7"]?.attempt, ID, "the claim outlives the repair process until settled");
  const settled = settleRecovery(p, { root, tracker: "owner/repo", dir: state, docker, at: at(30) });
  assert.equal(readAdmission(state).claims["owner_repo--7"], undefined, "settling released the claim");
  assert.equal((settled as { attempt: { result: string } }).attempt.result, "delivered");
  assert.equal(readRecovery(p, root).attempts.filter((a) => a.result === "delivered").length, 1, "consumed attempt recorded once");

  // The guard: the same attempt record cannot start a second run, and nothing touches Docker.
  const before = readFileSync(join(fake, "docker.jsonl"), "utf8").trim().split("\n").length;
  const again = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), "--issue", "7", "--base", "main", "--recover", "1", "--attempt-record", join(p.recovery, "attempts", `${ID}.json`)],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state } });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /not claimed for recovery attempt 1/);
  assert.equal(readFileSync(join(fake, "docker.jsonl"), "utf8").trim().split("\n").length, before);

  // Ordinary runs keep their protection: a normal start of #7 refuses the existing branch and never reaches Docker.
  const normal = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), "--issue", "7", "--base", "main"],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state } });
  assert.equal(normal.status, 1);
  assert.match(normal.stderr, /held: Worktree location already exists: .*7-fix-login/);
  assert.equal(readFileSync(join(fake, "docker.jsonl"), "utf8").trim().split("\n").length, before);

  if (copied) {
    assert.equal(existsSync(join(fake, 'npm-called')), false);
    assert.equal(existsSync(join(root, 'node_modules')), false);
    assert.equal(existsSync(join(root, '.factory/node_modules')), false);
      assert.equal(existsSync(join(root, '.sandcastle')), false, 'supported execution must never create old-layout assets');
    assert.ok(record.evidence.startsWith(join(root, '.factory/evidence/') ));
    return;
  }

  // A dispatched normal run adopts its launch claim and writes its ownership receipt before Sandcastle creates anything
  // (here the stubbed Sandcastle docker() throws, as a crash right after the receipt would leave it); stopping releases the claim.
  const pre = claimRun({ dir: state, project: "owner/repo", iid: "9", pid: process.pid, cap: 99 });
  assert.equal(pre.ok, true);
  prepareFixtureFromRuntime(runtime.directory, root, { ...process.env, ...env, SANDCASTLE_STATE_DIR: state }, 9);
  const n9 = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), "--issue", "9", "--base", "main"],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state } });
  assert.notEqual(n9.status, 0);
  assert.match(n9.stderr, /docker\(\) must not be used/);
  const r9 = readReceipt(receiptFile(state, projectId(root, { kind: "github", host: "github.com", project: "owner/repo" }), "9"))!;
  assert.deepEqual([r9.branch, r9.creationIntent.branch, r9.creationIntent.worktree, r9.branchSha, r9.runId],
    ["9-fix-login", true, true, undefined, (pre as { run: { claim: string } }).run.claim]);
  const rec9 = readRuns(state).find((r) => r.iid === "9")!;
  assert.deepEqual([rec9.stage, rec9.claim], ["stopped", (pre as { run: { claim: string } }).run.claim]);
  assert.equal(readAdmission(state).claims["owner_repo--9"], undefined, "a stopped run released its launch claim");
  assert.equal(rec9.implementationModel, `pi-claude-subscription/${({small:'claude-haiku-5-5',mid:'claude-sonnet-5-5',large:'claude-opus-5-5'} as any)[tier]}`);

  // Direct invalid starts preserve actionable internal state, even if dispatched just before a body edit.
  for (const [n, body, status] of [[10, "Model tier: unknown", "unsupported"], [11, "Model: sonnet", "unsupported"],
    [12, "Model tier: small\nModel tier: large", "conflicting"]] as const) {
    const pending = claimRun({ dir: state, project: "owner/repo", iid: String(n), pid: process.pid, cap: 99 });
    assert.equal(pending.ok, true);
    prepareFixtureFromRuntime(runtime.directory, root, { ...process.env, ...env, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: body }, n);
    const result = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), "--issue", String(n), "--base", "main"],
      { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: body,
        FACTORY_LAUNCH_CLAIM: pending.ok ? pending.run.claim : '' } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Not started/);
    const run = JSON.parse(readFileSync(join(state, `owner_repo--${n}.json`), "utf8"));
    const assessment = JSON.parse(readFileSync(join(state, "assessment", "models", `owner_repo--${n}.json`), "utf8"));
    assert.equal(run.stage, "queued");
    assert.equal(assessment.modelResolution.status, status);
    assert.equal(run.implementationModel, undefined);
    assert.equal(readAdmission(state).claims[`owner_repo--${n}`], undefined);
    assert.equal(git(root, "branch", "--list", `${n}-*`), "");
  }
  prepareFixtureFromRuntime(runtime.directory, root, { ...process.env, ...env, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: 'Model tier: large' }, 10);
  const fixed = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), "--issue", "10", "--base", "main"],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: 'Model tier: large' } });
  assert.match(fixed.stderr, /docker\(\) must not be used/);
  assert.equal(readRuns(state).find(r => r.iid === '10')?.implementationModel, 'pi-claude-subscription/claude-opus-5-5');
  prepareFixtureFromRuntime(runtime.directory, root, { ...process.env, ...env, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: 'No model tier declaration' }, 13);
  const defaulted = spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), '--issue', '13', '--base', 'main'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state, FAKE_TICKET_BODY: 'No model tier declaration' } });
  assert.match(defaulted.stderr, /docker\(\) must not be used/);
  assert.equal(readRuns(state).find(r => r.iid === '13')?.implementationModel, 'pi-claude-subscription/claude-sonnet-5-5');
}
