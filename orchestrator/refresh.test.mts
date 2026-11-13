// #78 integration: real scaffolded dispatcher, adapters, read-only analysis and HTTP board against local Git and
// rejecting gh/glab/analyst/npx fixtures. Covers retained parked cards, edits at every stage, manual refresh without
// scheduling, per-pass analysis budget, and admission equivalence when assessment storage fails. No external services.
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
const ticket = (iid: number, extra = {}) => ({ iid, title: `Ticket ${iid}`, description: "Requirement DEP:20", state: "open", labels: ["ready-for-agent", "model:sonnet"], ...extra });
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
    const m = { iid, project: "owner/repo", hash: unitHash({ ...ti, ...(p ? { parent: p } : {}) }, data.notes[iid]), analyzedAt: new Date().toISOString(),
      base: "main", baseSha: "", provides: [], requires: [], footprint: [], actualFootprint: [], catalogueIids: data.tickets.filter((t: any) => !t.contextOnly).map((t: any) => t.iid), blockerHashes: {} };
    writeFileSync(join(dir, "graph", `${key(iid)}.json`), JSON.stringify(m));
  };
  const pass = (args: string[] = [], extra = {}) => {
    save();
    const r = spawnSync(node, [".sandcastle/dispatch.mts", "--base", "main", ...args], { cwd: root, encoding: "utf8", env: { ...env, ...extra }, timeout: 20_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r;
  };
  const bytes = (path: string) => existsSync(path) ? readFileSync(path, "utf8") : "absent";
  return { home, root, dir, fake, env, data, save, key, record, manifest, pass, bytes, node, assessment: (iid = 7) => readAssessment(dir, key(iid))! };
}

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
  const config = join(f.root, ".sandcastle/config.mts");
  writeFileSync(config, f.bytes(config).replace("analysisTimeoutMinutes: 10", "analysisTimeoutMinutes: 0.001"));
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
  for (const [key, value] of Object.entries(f.env)) if (value !== undefined) process.env[key] = value;
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
    const older = spawn(f.node, [".sandcastle/dispatch.mts", "--base", "main", ...(olderManual ? ["--refresh-only", "--ticket", "7"] : [])], {
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
  const older = spawn(f.node, [".sandcastle/dispatch.mts", "--refresh-only", "--ticket", "7", "--base", "main"], {
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
