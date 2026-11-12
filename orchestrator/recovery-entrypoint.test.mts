// Guarded entrypoint smoke test (#74): a claimed, stopped ticket goes from Factory's real launcher (cli/src/recovery-run.mts)
// through the real scaffolded `.sandcastle/main.mts --recover` (built by cli/src/scaffold.mts, plus prompt.recover.md as
// the reviewed upgrade will add it, #63) into runRecoveryAttempt, the owned container, the shared verifier and normal
// delivery, and back through settleRecovery. Only external programs are stubbed, as executables first on the child's
// PATH or a module in the project's node_modules (orchestrator/fixtures/entrypoint): `gh` (tracker), `docker`, and
// @ai-hero/sandcastle (agent providers; its createSandbox and docker() throw if recovery ever touches them). Git is real,
// with a local bare repository as origin. Unknown gh/docker calls exit non-zero. Since #75 it also checks the admission
// claim outlives the repair process until settled, the adopted ownership receipt, the prerequisite recheck against a
// written ticket analysis, and that a dispatched normal run adopts its claim and writes its receipt before Sandcastle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readAdmission } from "../board/admission.mts";
import { claimRun, readRuns } from "../board/board.mts";
import { projectId, readReceipt, receiptFile } from "./ownership.mts";
import { paths } from "../cli/src/paths.mts";
import { buildAssets } from "../cli/src/scaffold.mts";
import { launchRecovery, settleRecovery } from "../cli/src/recovery-run.mts";
import type { Spawner } from "../cli/src/recovery-run.mts";
import { observePass, readRecovery } from "../cli/src/recovery-state.mts";
import { containerFor, readAttemptRecord } from "./recovery.mts";
import type { AttemptRecord, Docker } from "./recovery.mts";

const ID = "5b1f3c2a-9d8e-4f70-8a6b-0c1d2e3f4a5b";
const FIXTURES = join(import.meta.dirname, "fixtures/entrypoint");
const at = (m: number) => new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString();

test("a claimed stopped ticket is repaired, independently verified and delivered through the real main.mts --recover", async (t) => {
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
  const worktree = join(root, ".sandcastle/worktrees/7-fix-login");
  mkdirSync(dirname(worktree), { recursive: true });
  git(root, "worktree", "add", "-q", worktree, "7-fix-login");
  writeFileSync(join(worktree, "app.txt"), "v2\n");
  git(worktree, "commit", "-qam", "half done");
  writeFileSync(join(worktree, "untracked.txt"), "keep me\n");
  const otherRef = git(root, "rev-parse", "8-other");

  // The scaffold as factory init writes it, plus the recovery prompt the reviewed upgrade adds (#63).
  const state = join(home, "runs");
  for (const f of buildAssets({ profile: "personal", repo: "owner/repo", image: "img" }, state)) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.content, { mode: f.mode });
  }
  cpSync(join(import.meta.dirname, "prompt.recover.md"), join(root, ".sandcastle/prompt.recover.md"));
  cpSync(join(FIXTURES, "sandcastle"), join(root, "node_modules/@ai-hero/sandcastle"), { recursive: true });
  const evidence = join(root, ".sandcastle/evidence/7");
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
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake,
    FAKE_REPAIR: `printf 'fixed\\n' > fix.txt && git add -A && git commit -qm repair && printf '%s' '${JSON.stringify({ cause: "missing fix", filesChanged: ["fix.txt", "untracked.txt"], tests: [{ command: "true", result: "pass" }], canProceed: true, remainingBlockers: [], requiresHostUpdate: false })}' > "$EVIDENCE/recovery-report.json" && echo ok > "$EVIDENCE/recovery-report.md"`,
    FAKE_VERIFY: `printf 'VERDICT: PASS\\nverified\\n' > "$EVIDENCE/verdict.md"`,
  };
  const docker: Docker = (args) => {
    const r = spawnSync(join(bin, "docker"), args, { encoding: "utf8", env: { ...process.env, ...env } });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  // A stopped run of #7 and a jam confirmed on two passes.
  const p = paths(home);
  claimRun({ dir: state, project: "owner/repo", iid: "7", pid: 2 ** 22 + 4321, cap: 99,
    patch: { stage: "stopped", note: "exited", starting: undefined, branch: "7-fix-login", base: "main", evidenceDir: evidence } });
  observePass(p, root, { pass: "a", at: at(0), jam: [7] });
  observePass(p, root, { pass: "b", at: at(5), jam: [7] });

  // The dispatcher's analysis of #7 (no prerequisites), at the ticket's current hash as the scaffolded code computes it.
  const hash = execFileSync(process.execPath, ["--input-type=module", "-e",
    `const t = await import("./.sandcastle/tracker.mts"); const g = await import("./.sandcastle/graph.mts"); process.stdout.write(g.unitHash(t.ticket(7), t.notes(7)));`],
  { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state } });
  mkdirSync(join(state, "graph"), { recursive: true });
  writeFileSync(join(state, "graph", "owner_repo--7.json"), JSON.stringify({ iid: 7, project: "owner/repo", hash, analyzedAt: at(1), base: "main", baseSha: "",
    provides: [], requires: [], footprint: ["app.txt"], catalogueIids: [], blockerHashes: {} }));

  // The launcher's own spawn, minus npx/tsx: node runs the scaffolded main.mts directly.
  let child!: ChildProcess;
  const spawner: Spawner = (cmd, args, o) => {
    assert.deepEqual([cmd, args[0], args[1]], ["npx", "tsx", ".sandcastle/main.mts"]);
    const out = openSync(o.log, "a");
    child = spawn(process.execPath, args.slice(1), { cwd: o.cwd, env: { ...o.env, ...env }, stdio: ["ignore", out, out] });
    children.push(child);
    return child.pid!;
  };
  const launch = launchRecovery(p, { root, tracker: "owner/repo", ticket: 7, dir: state, docker, spawn: spawner, npx: "npx", uuid: () => ID, at: at(10) });
  assert.equal(launch.ok, true, (launch as { reason?: string }).reason);
  const [code] = await once(child, "exit");
  const log = readFileSync(join(root, ".sandcastle/logs/recover-7.log"), "utf8");
  assert.equal(code, 0, log);

  const record = (readAttemptRecord(join(p.recovery, "attempts", `${ID}.json`)) as { record: AttemptRecord }).record;
  assert.equal(record.outcome, "delivered", record.reason);
  const tip = git(root, "rev-parse", "7-fix-login");
  assert.equal(record.tip, tip);
  assert.equal(git(origin, "rev-parse", "7-fix-login"), tip, "the exact verified tip was pushed");
  const gh = readFileSync(join(fake, "gh.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).args as string[]);
  const merge = gh.find((a) => a[0] === "pr" && a[1] === "merge")!;
  assert.equal(merge[merge.indexOf("--match-head-commit") + 1], tip, "delivery merged only that tip");
  assert.equal(gh.filter((a) => a[0] === "pr" && a[1] === "create").length, 1);
  // The repair and verifier ran with AGENT.model, not the ticket's model:sonnet label.
  assert.deepEqual([...new Set(readFileSync(join(fake, "models.log"), "utf8").trim().split("\n"))], ["pi pi-claude-subscription/claude-opus-5-5"]);
  // Exactly the recorded container; it is gone.
  const dockerCalls = readFileSync(join(fake, "docker.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
  const run = dockerCalls.filter((a) => a[0] === "run");
  assert.equal(run.length, 1);
  assert.equal(run[0][run[0].indexOf("--name") + 1], containerFor(ID));
  assert.ok(dockerCalls.every((a) => a[0] === "run" || a.includes(containerFor(ID))), "every docker call names the attempt's container");
  assert.deepEqual(readdirSync(join(fake, "containers")), []);
  assert.equal(git(root, "rev-parse", "8-other"), otherRef);
  assert.equal(readFileSync(join(evidence, "verdict.md"), "utf8"), "VERDICT: FAIL\nold\n", "earlier evidence kept");
  assert.ok(existsSync(join(record.evidence, "verdict.md")) && existsSync(join(record.evidence, "history/verdict.md")));
  const runRec = readRuns(state).find((r) => r.iid === "7")!;
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
  const again = spawnSync(process.execPath, [".sandcastle/main.mts", "--issue", "7", "--base", "main", "--recover", "1", "--attempt-record", join(p.recovery, "attempts", `${ID}.json`)],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state } });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /not claimed for recovery attempt 1/);
  assert.equal(readFileSync(join(fake, "docker.jsonl"), "utf8").trim().split("\n").length, before);

  // Ordinary runs keep their protection: a normal start of #7 refuses the existing branch and never reaches Docker.
  const normal = spawnSync(process.execPath, [".sandcastle/main.mts", "--issue", "7", "--base", "main"],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state } });
  assert.equal(normal.status, 1);
  assert.match(normal.stderr, /Branch 7-fix-login already exists locally or on origin/);
  assert.equal(readFileSync(join(fake, "docker.jsonl"), "utf8").trim().split("\n").length, before);

  // A dispatched normal run adopts its launch claim and writes its ownership receipt before Sandcastle creates anything
  // (here the stubbed Sandcastle docker() throws, as a crash right after the receipt would leave it); stopping releases the claim.
  const pre = claimRun({ dir: state, project: "owner/repo", iid: "9", pid: process.pid, cap: 99 });
  assert.equal(pre.ok, true);
  const n9 = spawnSync(process.execPath, [".sandcastle/main.mts", "--issue", "9", "--base", "main"],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env, SANDCASTLE_STATE_DIR: state } });
  assert.notEqual(n9.status, 0);
  assert.match(n9.stderr, /docker\(\) must not be used/);
  const r9 = readReceipt(receiptFile(state, projectId(root, { kind: "github", host: "github.com", project: "owner/repo" }), "9"))!;
  assert.deepEqual([r9.branch, r9.creationIntent.branch, r9.creationIntent.worktree, r9.branchSha, r9.runId],
    ["9-fix-login", true, true, undefined, (pre as { run: { claim: string } }).run.claim]);
  const rec9 = readRuns(state).find((r) => r.iid === "9")!;
  assert.deepEqual([rec9.stage, rec9.claim], ["stopped", (pre as { run: { claim: string } }).run.claim]);
  assert.equal(readAdmission(state).claims["owner_repo--9"], undefined, "a stopped run released its launch claim");
});
