// #149: recovery prerequisite rechecks consume unknown/satisfied/unsatisfied results.
// #150: fresh synthetic reports and execution proof bind repaired tips after confirmed cleanup.
// The recovery attempt lifecycle end to end (#60 acceptance, #74): the real runRecoveryAttempt (recovery.mts) with the
// real owned-sandbox adapter and Git workspace (recovery-sandbox.mts), the real verifier and delivery (handoff.mts) and
// real Git on a synthetic project: committed ticket work, staged/unstaged/untracked input, an unrelated branch and
// earlier evidence. Only external boundaries are stubbed: docker (fixtures/recovery-fakes.mts, which runs a container's
// commands on the host with its mounts), the agent (a shell script per scenario), the tracker/push, and a fake clock
// for the 900000 ms deadline. Unknown docker or host git calls throw. Prerequisite holds (#75) use the real
// handoff.mts prerequisiteHold over a synthetic ticket analysis. The tracker boundary also covers posting failures.
import { fixtureProvenance, verificationCommand, writeVerification } from './fixtures/verification.mts';
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { prerequisiteHold } from "./handoff.mts";
import type { Host, PrerequisiteView } from "./handoff.mts";
import type { Manifest } from "./graph.mts";
import { attemptEvidence, attemptGitDir, containerFor, ownedContainerGone, readAttemptRecord, REPAIR_DEADLINE_MS, runRecoveryAttempt, writeAttemptRecord } from "./recovery.mts";
import type { AttemptRecord, RecoveryContext, RecoveryDeps } from "./recovery.mts";
import { createOwnedSandbox, gitWorkspace, PRIVATE_GIT, WORKSPACE } from "./recovery-sandbox.mts";
import { dockerWorld, fakeClock } from "./fixtures/recovery-fakes.mts";
import type { Hook } from "./fixtures/recovery-fakes.mts";

const ID = "0d9c7c52-6f0e-4b8a-9d55-1c2b3a4d5e6f";
const OTHER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const REPAIR_MODEL = "claude-opus-5-5";
const TICKET_MODEL = "claude-haiku-5-5";
const SETUP_SLOW = "FAKE_SLOW_SETUP";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const hashTree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== "recovery") walk(p); } else out[relative(dir, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
};
const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(what: string, ok: () => boolean) {
  for (let i = 0; i < 400; i++) { if (ok()) return; await tick(); }
  throw new Error(`timed out waiting for ${what}`);
}

const REPORT = (o: Record<string, unknown> = {}) => JSON.stringify({ cause: "flaky fixture", filesChanged: ["fix.txt"],
  tests: [{ command: "npm test", result: "pass" }], canProceed: true, remainingBlockers: [], requiresHostUpdate: false, ...o });
const writeReport = (o?: Record<string, unknown>) => `printf '%s' '${REPORT(o)}' > "$EVIDENCE/recovery-report.json" && echo report > "$EVIDENCE/recovery-report.md"`;
const COMMIT = `printf 'fixed\\n' > fix.txt && git add -A && git -c user.name=r -c user.email=r@r commit -qm repair`;
const PASS = `printf 'VERDICT: PASS\\nlooks right\\n' > "$EVIDENCE/verdict.md" && ${verificationCommand()}`;

type Scenario = {
  repair?: string; verify?: string; clean?: boolean; setup?: { command: string; timeoutMs?: number }[]; hooks?: Record<string, Hook>;
  stuck?: boolean; runFails?: boolean; recheck?: (stage: "verify" | "deliver") => string | undefined; deliver?: () => Promise<{ url: string; merged: boolean }>;
  beforeImport?: (f: Fixture) => void; postFailure?: boolean;
};
type Fixture = ReturnType<typeof fixture>;

function fixture(t: TestContext, s: Scenario = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "factory-runner-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, "site");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "app.txt"), "v1\n");
  git(root, "add", "app.txt");
  git(root, "commit", "-qm", "init");
  const baseSha = git(root, "rev-parse", "HEAD");
  git(root, "branch", "8-other");
  git(root, "branch", "7-fix-login");
  mkdirSync(join(root, ".sandcastle/worktrees"), { recursive: true });
  for (const p of ["prompt.recover.md", "prompt.verify.md"]) copyFileSync(join(import.meta.dirname, p), join(root, ".sandcastle", p));
  const worktree = join(root, ".sandcastle/worktrees/7-fix-login");
  git(root, "worktree", "add", "-q", worktree, "7-fix-login");
  writeFileSync(join(worktree, "app.txt"), "v2\n");
  git(worktree, "commit", "-qam", "half done");
  if (!s.clean) {
    writeFileSync(join(worktree, "staged.txt"), "staged\n");
    git(worktree, "add", "staged.txt");
    writeFileSync(join(worktree, "app.txt"), "v3 unstaged\n");
    writeFileSync(join(worktree, "untracked.txt"), "untracked\n");
  }
  const startSha = git(worktree, "rev-parse", "HEAD");
  const evidenceRoot = join(root, ".sandcastle/evidence/7");
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, "verdict.md"), "VERDICT: FAIL\nold\n");
  writeFileSync(join(evidenceRoot, "blocked.json"), '{"blockers":[]}\n');
  writeFileSync(join(evidenceRoot, "before-1.png"), "old media");
  const logs = join(root, ".sandcastle/logs");
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, "recover-7.log"), "previous log\n");

  const record = join(home, "state/recovery/attempts", `${ID}.json`);
  const rec: AttemptRecord = { version: 1, id: ID, seq: 1, project: "proj", iid: "7", branch: "7-fix-login", base: "main", startSha, worktree,
    container: containerFor(ID), evidence: attemptEvidence(root, "7", ID), gitDir: attemptGitDir(root, ID), phase: "claimed",
    createdAt: "2026-11-12T00:00:00.000Z", updatedAt: "2026-11-12T00:00:00.000Z", events: [{ at: "2026-11-12T00:00:00.000Z", phase: "claimed" }] };
  writeAttemptRecord(record, rec);

  const clock = fakeClock();
  const hooks: Record<string, Hook> = { [SETUP_SLOW]: async () => { clock.advance(20 * 60_000); return { status: 0 }; }, ...s.hooks };
  // An unrelated recovery container and a Sandcastle container mounting the same worktree: never touched.
  const unrelated = [containerFor(OTHER_ID), "sandcastle-1234"];
  const world = dockerWorld({ existing: unrelated, stuck: s.stuck ? new Set([containerFor(ID)]) : undefined, runFails: s.runFails, hooks });
  const models: string[] = [];
  const agentRuns: string[] = [];
  const agent = (model: string) => {
    models.push(model);
    return { env: {}, buildPrintCommand: ({ prompt }: { prompt: string }) => {
      const repair = prompt.startsWith("# Recover ticket");
      agentRuns.push(repair ? "repair" : "verifier");
      return { command: repair ? (s.repair ?? `${COMMIT} && ${writeReport()}`) : (s.verify ?? PASS) };
    } };
  };
  const pushes: string[][] = [];
  const delivered: { sha: string; branch: string }[] = [];
  const comments: string[] = [];
  const stages: Record<string, unknown>[] = [];
  const host: Host = {
    setStage: (_iid, p) => { stages.push(p as Record<string, unknown>); },
    readRuns: () => [],
    live: () => false,
    git: (args) => {
      if (args[0] === "push") { pushes.push(args); return ""; }
      if (args[0] === 'ls-remote') return git(root, 'rev-parse', '7-fix-login');
      if (args[0] === "rev-parse") return git(root, ...args);
      throw new Error(`unexpected host git: ${args.join(" ")}`);
    },
    gitStatus: () => { throw new Error("unexpected gitStatus"); },
    tracker: {
      postVerification: (_iid, _tip, files, body) => {
        if (s.postFailure) throw new Error("attachment upload failed");
        comments.push(body(files.map((f) => `![media](${f})`)));
      },
      openMrBranches: () => new Set(),
      deliver: async (d) => { delivered.push({ sha: d.sha, branch: d.branch }); return s.deliver ? s.deliver() : { url: "https://example.test/pr/9", merged: false }; },
    },
  };
  const cancel = new AbortController();
  const f = {
    home, root, worktree, startSha, baseSha, evidenceRoot, record, clock, world, models, agentRuns, pushes, delivered, comments, stages, cancel, unrelated,
    oldEvidence: hashTree(evidenceRoot),
    refs: () => git(root, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"),
    status: () => git(worktree, "status", "--porcelain", "--untracked-files=all"),
    rec: () => (readAttemptRecord(record) as { record: AttemptRecord }).record,
    run: () => runRecoveryAttempt(ctx, deps),
  };
  const ctx: RecoveryContext = {
    root, record, model: REPAIR_MODEL, title: "Fix login", baseSha,
    proof: { state: join(home, 'state'), executionId: 'execution', requirementsHash: 'c'.repeat(64) },
    provenance: async () => fixtureProvenance, promptArgs: {
      ISSUE_IID: "7", ISSUE_TITLE: "Fix login", TICKET: "ticket text", BASE_BRANCH: "main", BASE_SHA: baseSha, BRANCH: "7-fix-login",
      EVIDENCE_DIR: "/home/agent/evidence/7", CATALOGUE: "(none)", ATTEMPT: "1", ATTEMPT_ID: ID, REPAIR_MINUTES: "15",
    },
    previousRun: { iid: "7", stage: "stopped", note: "exited", implementerModel: TICKET_MODEL }, logs: [join(logs, "recover-7.log")],
    delivery: { ciWaitMinutes: 1, noCiMinutes: 1, autoMerge: false }, cancel: cancel.signal,
  };
  const workspace = { ...gitWorkspace, importRef: (o: Parameters<typeof gitWorkspace.importRef>[0]) => { s.beforeImport?.(f as Fixture); return gitWorkspace.importRef(o); } };
  const deps: RecoveryDeps = {
    clock: clock.clock,
    createSandbox: (spec) => createOwnedSandbox(spec, { image: "img", setup: s.setup ?? [{ command: "true" }], helpers: join(root, ".sandcastle/sandbox"),
      env: { CLAUDE_CODE_OAUTH_TOKEN: "secret-token" }, uid: 1000, gid: 1000, proc: world.proc, root }),
    containerGone: (name) => ownedContainerGone(name, world.docker),
    workspace,
    recheck: s.recheck ?? (() => undefined),
    host,
    setStage: () => {},
    agent,
    log: () => {},
  };
  return f;
}

/** Assertions every failed attempt must satisfy: nothing pushed or delivered, the input and old evidence intact, the
 *  branch and the unrelated branch unchanged, and no container but the attempt's own ever removed. */
function assertPreserved(f: Fixture, o: { input?: string; refs?: string } = {}) {
  assert.deepEqual(f.pushes, [], "nothing pushed");
  assert.deepEqual(f.delivered, [], "nothing delivered");
  assert.deepEqual(hashTree(f.evidenceRoot), f.oldEvidence, "earlier evidence untouched");
  if (o.input !== undefined) assert.equal(f.status(), o.input, "worktree input unchanged");
  if (o.refs !== undefined) assert.equal(f.refs(), o.refs, "branch refs unchanged");
  for (const u of f.unrelated) assert.ok(f.world.live.has(u), `${u} untouched`);
  assert.ok(f.world.syncCalls.every((c) => c.at(-1) === containerFor(ID)), "only the attempt's own container is ever named");
}

test("a committed repair is verified separately and the exact tip delivered; attempt recorded once", async (t) => {
  const f = fixture(t, { setup: [{ command: SETUP_SLOW }] });
  const otherRef = git(f.root, "rev-parse", "8-other");
  const r = await f.run();
  assert.equal(r.outcome, "delivered", r.reason);
  const rec = f.rec();
  // Deadline: exactly 900000 ms, started after the (20-minute) setup, cleared before verification.
  assert.equal(rec.deadline!.ms, REPAIR_DEADLINE_MS);
  assert.equal(Date.parse(rec.deadline!.startedAt) - Date.UTC(2026, 10, 12), 20 * 60_000, "deadline starts after setup");
  const verifying = rec.events.find((e) => e.phase === "verifying")!;
  assert.ok(rec.deadline!.clearedAt! <= verifying.at, "deadline cleared before the verifier");
  assert.deepEqual(f.agentRuns, ["repair", "verifier"]);
  assert.deepEqual([...new Set(f.models)], [REPAIR_MODEL], "repair and verifier use AGENT.model, never the ticket's model");
  // Exact tip: imported by CAS, pushed and delivered.
  const tip = git(f.root, "rev-parse", "7-fix-login");
  assert.notEqual(tip, f.startSha);
  assert.equal(git(f.root, "merge-base", "--is-ancestor", f.startSha, tip), "");
  assert.equal(rec.tip, tip);
  assert.deepEqual(f.delivered, [{ sha: tip, branch: "7-fix-login" }]);
  assert.deepEqual(f.pushes, [['push', 'origin', `${tip}:refs/heads/7-fix-login`]]);
  assert.deepEqual(rec.delivery, { tip, ok: true, url: "https://example.test/pr/9" });
  assert.match(f.comments[0], /Repaired by Factory recovery attempt 1/);
  assert.equal(git(f.root, "rev-parse", "8-other"), otherRef, "unrelated branch untouched");
  assert.equal(f.status(), "", "host worktree index matches the delivered tip");
  // Outcome written once, container gone, unrelated containers untouched, old evidence kept.
  assert.equal(rec.events.filter((e) => e.phase === "finished").length, 1);
  assert.equal(rec.outcome, "delivered");
  assert.ok(!f.world.live.has(containerFor(ID)));
  for (const u of f.unrelated) assert.ok(f.world.live.has(u));
  assert.deepEqual(hashTree(f.evidenceRoot), f.oldEvidence);
  // This attempt's artifacts.
  for (const a of ["recovery-context.json", "previous-run.json", "previous-logs/recover-7.log", "history/verdict.md", "history/blocked.json",
    "history/before-1.png", "input/status.txt", "input/staged.diff", "recovery-report.json", "recovery-report.md", "verdict.md", "repair.log"]) {
    assert.ok(existsSync(join(rec.evidence, a)), `${a} kept in the attempt's evidence`);
  }
  // A record is never run twice.
  await assert.rejects(f.run(), /already started/);
});

test("the owned container mounts only this attempt's evidence writable and private Git with only the ticket's branch", async (t) => {
  const f = fixture(t);
  await f.run();
  const run = f.world.runs[0];
  assert.equal(run.name, containerFor(ID));
  assert.ok(run.args.includes(`factory.recovery.attempt=${ID}`));
  const rec = f.rec();
  const writable = run.mounts.filter((m) => !m.ro).map((m) => [m.host, m.box]);
  assert.deepEqual(writable, [[f.worktree, WORKSPACE], [rec.gitDir, PRIVATE_GIT], [rec.evidence, "/home/agent/evidence/7"]]);
  const ro = run.mounts.filter((m) => m.ro).map((m) => m.box);
  for (const p of ["recovery-context.json", "previous-run.json", "previous-logs", "history", "input"]) assert.ok(ro.includes(`/home/agent/evidence/7/${p}`), `${p} read-only`);
  assert.ok(ro.includes(`${WORKSPACE}/.git`) && ro.includes("/opt/sandcastle"));
  const common = git(f.root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  assert.ok(run.mounts.every((m) => !m.host.startsWith(common) && !m.host.includes("docker.sock") && m.host !== f.evidenceRoot), "no common Git dir, socket or other evidence");
  assert.ok(!run.args.some((a) => a.includes("secret-token")), "credential values never on docker's arguments");
  assert.ok(run.args.includes("CLAUDE_CODE_OAUTH_TOKEN"));
  // The private metadata holds only the ticket's branch.
  assert.equal(git(f.root, "--git-dir", rec.gitDir, "for-each-ref", "--format=%(refname)"), "refs/heads/7-fix-login");
  assert.equal(git(f.root, "--git-dir", rec.gitDir, "remote"), "");
});

test("setup longer than 15 minutes and a slow verifier never time the repair out", async (t) => {
  // Two 20-minute setup steps and a 40-minute verifier on the fake clock; the repair itself is quick.
  const f: Fixture = fixture(t, { setup: [{ command: SETUP_SLOW }, { command: SETUP_SLOW }], verify: "FAKE_SLOW_VERIFY", hooks: {
    FAKE_SLOW_VERIFY: async () => {
      f.clock.advance(40 * 60_000);
      writeFileSync(join(f.rec().evidence, "verdict.md"), "VERDICT: PASS\nslow but fine\n");
      writeVerification(f.rec().evidence);
      return { status: 0 };
    },
  } });
  const out = await f.run();
  assert.equal(out.outcome, "delivered", out.reason);
  const rec = f.rec();
  assert.equal(Date.parse(rec.deadline!.startedAt) - Date.UTC(2026, 10, 12), 40 * 60_000, "deadline starts after both setup steps");
  assert.ok(Date.parse(rec.finishedAt!) - Date.parse(rec.deadline!.startedAt) >= 40 * 60_000, "the verifier ran well past 15 minutes");
});

test("at the deadline the repair is aborted, its container removed and confirmed gone, and nothing verified or delivered", async (t) => {
  const f = fixture(t, { repair: "exec sleep 30" });
  const input = f.status(), refs = f.refs();
  const r = f.run();
  await until("repairing", () => f.rec().phase === "repairing");
  f.clock.advance(REPAIR_DEADLINE_MS - 1);
  await tick();
  assert.equal(f.rec().phase, "repairing", "still running a millisecond before the deadline");
  f.clock.advance(1);
  const done = await r;
  assert.equal(done.outcome, "timed-out");
  assert.equal(done.cleanupPending, false);
  assert.deepEqual(f.agentRuns, ["repair"], "no verifier");
  assert.ok(!f.world.live.has(containerFor(ID)));
  assertPreserved(f, { input, refs });
  assert.equal(f.rec().outcome, "timed-out");
});

test("cancellation (SIGTERM) during repair or setup interrupts the attempt and preserves everything", async (t) => {
  const f = fixture(t, { repair: "exec sleep 30" });
  const input = f.status(), refs = f.refs();
  const r = f.run();
  await until("repairing", () => f.rec().phase === "repairing");
  f.cancel.abort(new Error("SIGTERM"));
  const done = await r;
  assert.equal(done.outcome, "interrupted");
  assertPreserved(f, { input, refs });

  const g = fixture(t, { setup: [{ command: "FAKE_SIGNAL" }], hooks: { FAKE_SIGNAL: async () => { g.cancel.abort(new Error("SIGTERM")); return { status: 0 }; } } });
  const out = await g.run();
  assert.equal(out.outcome, "interrupted");
  assert.deepEqual(g.agentRuns, [], "no repair after a signal during setup");
  assert.ok(!g.world.live.has(containerFor(ID)));
  assertPreserved(g);
});

test('even a valid verifier cannot publish proof before confirmed teardown', async t => {
  const f = fixture(t, { stuck: true });
  const result = await f.run();
  assert.equal(result.cleanupPending, true);
  assert.equal(f.agentRuns.includes('verifier'), true);
  assert.equal(existsSync(join(f.home, 'state/verification')), false, 'no host proof while a verifier may still run');
  assert.deepEqual(f.pushes, []);
  assert.deepEqual(f.delivered, []);
});

test("cleanup that cannot be confirmed keeps the attempt cleanup-pending and returns failure", async (t) => {
  const f = fixture(t, { repair: "exec sleep 30", stuck: true });
  const r = f.run();
  await until("repairing", () => f.rec().phase === "repairing");
  f.clock.advance(REPAIR_DEADLINE_MS);
  const done = await r;
  assert.equal(done.cleanupPending, true);
  const rec = f.rec();
  assert.equal(rec.phase, "cleanup-pending");
  assert.equal(rec.intended, "timed-out");
  assert.equal(rec.outcome, undefined, "not presented as finished");
  assertPreserved(f);
});

test("setup failure and container creation failure end the attempt failed with the creation intent recorded", async (t) => {
  const f = fixture(t, { setup: [{ command: "exit 3" }] });
  const out = await f.run();
  assert.equal(out.outcome, "failed");
  assert.match(out.reason, /setup step failed/);
  const rec = f.rec();
  assert.ok(rec.events.some((e) => e.phase === "setup" && e.note === `creating ${containerFor(ID)}`), "intent recorded before create");
  assert.ok(!f.world.live.has(containerFor(ID)));
  assertPreserved(f);

  const g = fixture(t, { runFails: true });
  const out2 = await g.run();
  assert.equal(out2.outcome, "failed");
  assert.match(out2.reason, /docker run failed/);
  assertPreserved(g);
});

// The recheck main.mts builds: the dispatcher's analysis says #7 needs #12. At admission #12 was merged; `state` is what
// the tracker says at each recheck.
const needs12: Manifest = { iid: 7, project: "o/r", hash: "h7", analyzedAt: "", base: "main", baseSha: "", provides: [], footprint: [], catalogueIids: [12],
  blockerHashes: {}, requires: [{ what: "the API", providedBy: 12, evidence: "ticket says so", confidence: 0.9 }] };
const prereqs = (state: Partial<Record<"verify" | "deliver", "merged" | "open-pr" | "in-flight" | "unknown" | "no-analysis">>) => (st: "verify" | "deliver") => {
  const now = state[st] ?? "merged";
  const view: PrerequisiteView = {
    manifest: now === "no-analysis" ? undefined : needs12, hash: "h7",
    dependency: () => ({ state: now === "unknown" ? "unknown" : now === "merged" ? "satisfied" : "unsatisfied" }),
    active: () => (now === "open-pr" ? "an open PR" : now === "in-flight" ? "a run in flight" : undefined),
  };
  return prerequisiteHold(7, view);
};

for (const [name, s, outcome, verifierRan] of [
  ["a missing report", { repair: COMMIT }, "unresolved", false],
  ["a malformed report", { repair: `${COMMIT} && echo '{"cause":1}' > "$EVIDENCE/recovery-report.json" && echo r > "$EVIDENCE/recovery-report.md"` }, "unresolved", false],
  ["unresolved blockers", { repair: `${COMMIT} && ${writeReport({ canProceed: false, remainingBlockers: [{ iid: 12, what: "API" }] })}` }, "unresolved", false],
  ["a host follow-up", { repair: `${COMMIT} && ${writeReport({ requiresHostUpdate: true })}` }, "host-followup", false],
  ["uncommitted repair output", { repair: `echo more > extra.txt && ${writeReport()}` }, "unresolved", false],
  ["a FAIL verdict", { verify: `printf 'VERDICT: FAIL\\nbroken\\n' > "$EVIDENCE/verdict.md"` }, "failed", true],
  ["no verdict", { verify: "true" }, "failed", true],
  ["a verifier that changes the branch", { verify: `echo x > v.txt && git add v.txt && git -c user.name=v -c user.email=v@v commit -qm v && ${PASS}` }, "failed", true],
  ["changed requirements before verification", { recheck: (st: string) => (st === "verify" ? "requirements changed" : undefined) }, "unresolved", false],
  ["changed requirements before delivery", { recheck: (st: string) => (st === "deliver" ? "requirements changed" : undefined) }, "unresolved", true],
  ["a dependency hold added after admission (before verification)", { recheck: prereqs({ verify: "in-flight" }) }, "unresolved", false],
  ["an open-PR prerequisite appearing before delivery", { recheck: prereqs({ deliver: "open-pr" }) }, "unresolved", true],
  ["unknown prerequisites before delivery", { recheck: prereqs({ deliver: "unknown" }) }, "unresolved", true],
  ["a missing ticket analysis before verification", { recheck: prereqs({ verify: "no-analysis" }) }, "unresolved", false],
] as [string, Scenario, string, boolean][]) {
  test(`${name} never pushes or delivers`, async (t) => {
    const f = fixture(t, s);
    const out = await f.run();
    assert.equal(out.outcome, outcome, out.reason);
    assert.equal(f.agentRuns.includes("verifier"), verifierRan);
    assertPreserved(f);
    assert.equal(f.rec().outcome, outcome);
  });
}

test("an attachment posting failure stops a real recovery attempt and keeps its local evidence", async (t) => {
  const f = fixture(t, { postFailure: true });
  const out = await f.run();
  assert.equal(out.outcome, "failed", out.reason);
  assert.match(out.reason ?? "", /Verification posting failed.*Evidence retained/);
  assert.deepEqual(f.agentRuns, ["repair", "verifier"]);
  assertPreserved(f);
  assert.deepEqual(f.comments, []);
  assert.ok(existsSync(join(f.rec().evidence, "verdict.md")));
  assert.notEqual(f.rec().outcome, "delivered");
});

test("a no-change transient repair verifies and delivers the existing committed tip", async (t) => {
  const f = fixture(t, { clean: true, repair: writeReport({ filesChanged: [], cause: "CI runner flaked" }) });
  const refs = f.refs();
  const out = await f.run();
  assert.equal(out.outcome, "delivered", out.reason);
  assert.deepEqual(f.agentRuns, ["repair", "verifier"]);
  assert.equal(f.refs(), refs, "no import needed");
  assert.deepEqual(f.delivered, [{ sha: f.startSha, branch: "7-fix-login" }]);
});

test("pre-existing dirty input the repair leaves uncommitted is preserved and blocks delivery", async (t) => {
  const f = fixture(t, { repair: writeReport() });
  const input = f.status(), refs = f.refs();
  const out = await f.run();
  assert.equal(out.outcome, "unresolved");
  assert.match(out.reason, /never committed by Factory/);
  assertPreserved(f, { input, refs });
  // The staged/unstaged/untracked split survives into the container's view, unchanged.
  assert.equal(readFileSync(join(f.rec().evidence, "input/status.txt"), "utf8").trim(), input);
});

test("a branch that moved on the host is never overwritten; the repair's commits stay in the attempt's Git metadata", async (t) => {
  const f = fixture(t, { beforeImport: (fx) => git(fx.worktree, "commit", "-q", "--allow-empty", "-m", "someone else") });
  const out = await f.run();
  assert.equal(out.outcome, "failed");
  assert.match(out.reason, /no longer points at the recorded/);
  const rec = f.rec();
  assert.equal(git(f.root, "log", "-1", "--format=%s", "7-fix-login"), "someone else");
  assert.equal(git(f.root, "--git-dir", rec.gitDir, "log", "-1", "--format=%s", rec.tip!), "repair");
  assert.deepEqual(f.delivered, []);
});

test("an ambiguous delivery is recorded as failed and never retried", async (t) => {
  let calls = 0;
  const f = fixture(t, { deliver: async () => { calls++; throw new Error("socket hang up"); } });
  const out = await f.run();
  assert.equal(out.outcome, "failed");
  assert.equal(calls, 1);
  assert.equal(f.rec().delivery?.ok, false);
});

test("a worktree whose HEAD moved since the claim is refused before any container or Git side effect", async (t) => {
  const f = fixture(t);
  git(f.worktree, "commit", "-q", "--allow-empty", "-m", "moved");
  const out = await f.run();
  assert.equal(out.outcome, "ownership-refused");
  assert.deepEqual(f.world.runs, []);
  assert.ok(!existsSync(f.rec().gitDir));
  assertPreserved(f);
});
