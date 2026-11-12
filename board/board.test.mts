// Regression tests for the Factory board: appearance settings, the pure run model, the live poller, the
// /api/runs snapshot, the evidence routes (bounded previews, original files, path safety), launch reservations and atomic claims.
// The browser code is loaded from the template's "// <name>:start" … "// <name>:end" sections.
// Run with node --test board/board.test.mts. All state and evidence are temporary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const template = readFileSync(resolve("board/board.template.html"), "utf8");
const section = (name: string) => template.slice(template.indexOf(`// ${name}:start`), template.indexOf(`// ${name}:end`));
function load(name: string, exports: string[], ctx: Record<string, unknown> = {}): any {
  runInNewContext(section(name) + exports.map((e) => `; this.${e} = ${e};`).join(""), ctx);
  return ctx;
}

test("appearance keeps light/dark/system, follows the OS live and survives blocked storage", () => {
  const media = { matches: false, listener: () => {}, addEventListener(_: string, fn: () => void) { this.listener = fn; } };
  const root = { dataset: { mode: "system", theme: "light" } as Record<string, string> };
  const saved: Record<string, string> = {};
  const ctx = load("settings", ["setMode"], { root, window: { matchMedia: () => media }, localStorage: { setItem: (k: string, v: string) => { saved[k] = v; } } });
  ctx.setMode("dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(saved["sandcastle-theme"], "dark");
  ctx.setMode("system");
  assert.equal(root.dataset.theme, "light");
  media.matches = true;
  media.listener();
  assert.equal(root.dataset.theme, "dark");
  ctx.setMode("log"); // an old design name is not a mode
  assert.equal(root.dataset.mode, "system");

  const blocked = load("settings", ["setMode"], { root, window: {}, localStorage: { setItem() { throw new Error("denied"); } } });
  blocked.setMode("light");
  assert.equal(root.dataset.theme, "light");
  // The design picker is gone: no design storage key or renderer branches remain.
  assert.doesNotMatch(template, /sandcastle-design|setDesign|data-design/);
});

test("run model groups every stage, flags attention and rejects unsafe links", () => {
  const m = load("model", ["layout", "summarize", "stageInfo", "matches", "safeHref", "validSnapshot", "shouldPoll", "diffRuns"]);
  const now = Date.parse("2026-11-10T12:00:00Z");
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  const run = (key: string, stage: string, minAgo = 1, extra = {}) => ({ key, iid: key, stage, stageSince: at(minAgo), startedAt: at(minAgo + 5), updatedAt: at(minAgo), ...extra });
  const runs = ["queued", "waiting", "setup", "implementing", "verifying", "posting", "pushing", "ci", "done", "stopped", "mystery"].map((s) => run(`a--${s}`, s));
  runs.push(run("b--1", "implementing", 45), run("c--1", "implementing", 2, { project: "c" }));
  const groups = m.layout(runs, now);
  assert.equal(groups.waiting.map((r: any) => r.stage).sort().join(), "queued,waiting");
  assert.equal(groups.history.map((r: any) => r.stage).sort().join(), "done,stopped");
  assert.equal(groups.active.length, 9);
  assert.equal(groups.active[0].key, "b--1", "a quiet run sorts first");
  assert.equal(m.stageInfo("mystery").label, "mystery");
  assert.equal(m.stageInfo("constructor").unknown, true);
  assert.equal(JSON.stringify(m.summarize(runs, now)), JSON.stringify({ all: 13, active: 9, waiting: 2, attention: 2, done: 1 }));
  assert.equal(m.matches(runs[0], "waiting", "", now), true);
  assert.equal(m.matches(runs[0], "waiting", "c", now), false);

  assert.equal(m.safeHref("javascript:alert(1)", false), null);
  assert.equal(m.safeHref(" JavaScript:alert(1)", false), null);
  assert.equal(m.safeHref("//evil.example/x", false), null);
  assert.equal(m.safeHref("file:///tmp/evidence/", false), null);
  assert.equal(m.safeHref("file:///tmp/evidence/", true), "file:///tmp/evidence/");
  assert.equal(m.safeHref("/evidence/a--1/", false), "/evidence/a--1/");
  assert.equal(m.safeHref("https://github.com/o/r/pull/3", false), "https://github.com/o/r/pull/3");

  assert.equal(m.validSnapshot({ runs: [{ key: "a", stage: "done" }], generatedAt: "x" }), true);
  assert.equal(m.validSnapshot({ runs: [{ stage: "done" }], generatedAt: "x" }), false);
  assert.equal(m.validSnapshot("<html>"), false);
  assert.equal(m.shouldPoll({ runs: [] }, "http:"), true);
  assert.equal(m.shouldPoll({ runs: [] }, "file:"), false);
  assert.equal(m.shouldPoll({ evidence: {} }, "http:"), false);

  const prev = new Map([["a", "setup"], ["b", "ci"], ["gone", "done"]]);
  const d = m.diffRuns(prev, [{ key: "a", stage: "setup" }, { key: "b", stage: "done" }, { key: "new", stage: "queued" }]);
  assert.equal(JSON.stringify(d), JSON.stringify({ added: ["new"], changed: ["b"], removed: ["gone"] }));
});

test("poller keeps one loop, pauses while hidden and keeps last data on failure", async () => {
  const { createPoller } = load("poller", ["createPoller"], { Promise, Error });
  const timers = new Map<number, () => void>();
  let nextId = 0, hidden = false, inFlight = 0, maxInFlight = 0, calls = 0;
  const responses: Array<() => Promise<any>> = [];
  const got: any[] = [], errors: string[] = [];
  const p = createPoller({
    url: "/api/runs", interval: 10_000,
    setTimeout: (fn: () => void) => { timers.set(++nextId, fn); return nextId; },
    clearTimeout: (id: number) => { timers.delete(id); },
    isHidden: () => hidden,
    valid: (d: any) => Array.isArray(d?.runs),
    fetch: async () => {
      calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { return await responses.shift()!(); } finally { inFlight--; }
    },
    onData: (d: any) => got.push(d),
    onError: (e: Error) => errors.push(e.message),
  });
  const ok = (body: any) => async () => ({ ok: true, json: async () => body });
  const fire = async () => { const [id, fn] = [...timers][0]; timers.delete(id); fn(); await new Promise((r) => setTimeout(r, 0)); };

  p.start();
  assert.equal(timers.size, 1);
  responses.push(ok({ runs: [1] }));
  await fire();
  assert.equal(got.length, 1);
  assert.equal(timers.size, 1, "reschedules exactly once");

  responses.push(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await fire();
  responses.push(ok("<html>not json data</html>"));
  await fire();
  assert.deepEqual(errors, ["HTTP 500", "malformed snapshot"]);
  assert.equal(got.length, 1, "failures keep the last good data");
  assert.equal(timers.size, 1);

  hidden = true;
  p.visibilityChanged();
  assert.equal(timers.size, 0, "no polling in a hidden tab");
  hidden = false;
  responses.push(ok({ runs: [2] }));
  p.visibilityChanged();
  p.visibilityChanged(); // a second event while the request is in flight must not start another
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(got.length, 2);
  assert.equal(maxInFlight, 1);
  assert.equal(calls, 4);
  assert.equal(timers.size, 1);
});

test("board, /api/runs and evidence agree and render safely", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "sandcastle-board-test-"));
  const evidence = resolve(dir, "evidence");
  mkdirSync(evidence);
  mkdirSync(resolve(evidence, "not-a-file"));
  writeFileSync(resolve(evidence, "verdict.md"), "PASS\n</script><script>alert('unsafe')</script>");
  writeFileSync(resolve(evidence, "large.log"), "x".repeat(70 * 1024));
  writeFileSync(resolve(evidence, "screen shot.png"), "image bytes");
  writeFileSync(resolve(evidence, "demo.webm"), "video bytes");
  writeFileSync(resolve(evidence, "archive.zip"), "archive bytes");
  writeFileSync(resolve(evidence, ".hidden"), "hidden");
  const now = new Date().toISOString();
  const record = { stage: "done", stageSince: now, startedAt: now, updatedAt: now, pid: process.pid };
  writeFileSync(resolve(dir, "demo--1.json"), JSON.stringify({ ...record, iid: "1", title: "Example $& </script><b>", project: "demo", evidenceDir: evidence }));
  writeFileSync(resolve(dir, "other--1.json"), JSON.stringify({ ...record, iid: "1", title: "Same number, other project", project: "other", stage: "queued" }));
  const child = spawn(process.execPath, [resolve("board/board-server.mts")], {
    env: { ...process.env, SANDCASTLE_STATE_DIR: dir, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const [output] = await once(child.stdout!, "data");
    const base = String(output).match(/http:\/\/[^\s]+/)![0];
    const board = await (await fetch(base)).text();
    assert.match(board, /class="app-nav"/);
    assert.match(board, /id="settings"/);
    assert.doesNotMatch(board, /fonts\.googleapis|sandcastle-refresh|location\.reload/);
    assert.doesNotMatch(board, /<b>/);
    const embedded = JSON.parse(board.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)![1]);
    assert.equal(embedded.runs.find((r: any) => r.key === "demo--1").title, "Example $& </script><b>");

    const api = await fetch(base + "/api/runs");
    assert.match(api.headers.get("content-type")!, /^application\/json/);
    assert.equal(api.headers.get("cache-control"), "no-store");
    const snapshot = await api.json();
    const view = (d: any) => d.runs.map((r: any) => [r.key, r.stage, r.project, r.evidenceUrl]);
    assert.deepEqual(view(snapshot), view(embedded));
    assert.deepEqual(view(snapshot).map((r: any) => r[0]).sort(), ["demo--1", "other--1"]);
    assert.equal(snapshot.runs.find((r: any) => r.key === "demo--1").evidenceUrl, "/evidence/demo--1/");

    const response = await fetch(base + "/evidence/demo--1/");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /class="app-nav"/);
    assert.doesNotMatch(html, /<script>alert/);
    const data = JSON.parse(html.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)![1]);
    const files = data.evidence.files;
    assert.equal(files.length, 5);
    assert.equal(files.find((f: any) => f.name === "large.log").text.length, 64 * 1024);
    assert.equal(files.find((f: any) => f.name === "large.log").truncated, true);
    assert.equal(files.find((f: any) => f.name.endsWith("png")).kind, "image");
    assert.equal(files.find((f: any) => f.name.endsWith("webm")).kind, "video");
    assert.equal(files.find((f: any) => f.name.endsWith("zip")).kind, "file");
    const image = await fetch(base + "/evidence/demo--1/screen%20shot.png");
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(await image.text(), "image bytes");
    assert.equal((await fetch(base + "/evidence/missing/")).status, 404);
    assert.equal((await fetch(base + "/evidence/demo--1/not-a-file")).status, 404);
    assert.equal((await fetch(base + "/evidence/demo--1/%E0%A4%A")).status, 404);
    assert.equal((await fetch(base + "/api/runs/x")).status, 404);
    for (const name of ["verdict.md", "large.log", "screen shot.png", "demo.webm", "archive.zip"]) rmSync(resolve(evidence, name));
    const emptyHtml = await (await fetch(base + "/evidence/demo--1/")).text();
    assert.match(emptyHtml, /"files":\[\]/);
  } finally {
    child.kill();
    await once(child, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an in-progress run shows the last line of its newest agent log; parked and finished runs show none", async () => {
  const { latestActivity } = await import("./board.mts");
  const dir = mkdtempSync(resolve(tmpdir(), "board-activity-"));
  try {
    const logs = resolve(dir, ".sandcastle/logs");
    mkdirSync(logs, { recursive: true });
    writeFileSync(resolve(logs, "feat-implementer.log"), "old\n");
    writeFileSync(resolve(logs, "other-implementer.log"), "not this branch\n");
    writeFileSync(resolve(logs, "feat-verifier.log"), "\u001b[1mStarted\u001b[0m\nRunning the tests now\n\n");
    utimesSync(resolve(logs, "feat-implementer.log"), 1000, 1000); // older than the verifier's log
    const run = { iid: "1", stage: "verifying", branch: "feat", evidenceDir: resolve(dir, ".sandcastle/evidence/1") } as any;
    assert.equal(latestActivity(run)?.activity, "Running the tests now");
    assert.equal(latestActivity({ ...run, stage: "queued" }), undefined);
    assert.equal(latestActivity({ ...run, stage: "done" }), undefined);
    assert.equal(latestActivity({ ...run, branch: "missing" }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a launched run counts as active before its child writes, and vanishes if the child dies unstarted", async () => {
  const board = await import("./board.mts");
  const dir = mkdtempSync(resolve(tmpdir(), "board-reserve-"));
  const cwd = process.cwd();
  const prevState = process.env.SANDCASTLE_STATE_DIR;
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    process.chdir(dir);
    process.env.SANDCASTLE_STATE_DIR = resolve(dir, "state");
    board.setProject("p");
    board.setStage("7", { stage: "queued", title: "Seven", note: "no room" });
    board.reserveRun("7", child.pid!);
    let [run] = board.readRuns();
    assert.equal(run.stage, "setup", "a reservation is in flight, so it counts against the cap");
    assert.equal(run.pid, child.pid);
    assert.equal(run.title, "Seven");
    child.kill();
    await once(child, "exit");
    assert.deepEqual(board.readRuns(), [], "an unstarted launch is forgotten, not stopped, so the next pass retries it");

    // Once the run writes for itself, it owns the record: a later crash is a stopped run as before.
    board.reserveRun("8", process.pid);
    board.setStage("8", { stage: "setup", starting: undefined, pid: 2 ** 22 + 12345 });
    [run] = board.readRuns();
    assert.equal(run.stage, "stopped");
  } finally {
    child.kill();
    process.chdir(cwd);
    if (prevState === undefined) delete process.env.SANDCASTLE_STATE_DIR;
    else process.env.SANDCASTLE_STATE_DIR = prevState;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claims are atomic: concurrent claimants never exceed the cap or take one ticket twice", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "board-claim-"));
  const state = resolve(dir, "state");
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    const board = await import("./board.mts");
    // Another project's run already holds one of two slots.
    board.claimRun({ dir: state, project: "other", iid: "1", pid: sleeper.pid!, cap: 2 });
    assert.equal(board.claimRun({ dir: state, project: "other", iid: "1", pid: sleeper.pid!, cap: 9 }).ok, false, "a ticket in flight is owned");
    // Eight processes race for the last slot, two of them for the same ticket; each lingers between check and write.
    const url = new URL("./board.mts", import.meta.url).href;
    const racers = Array.from({ length: 8 }, (_, n) => {
      const code = `const b = await import(${JSON.stringify(url)}); const c = b.claimRun({ dir: ${JSON.stringify(state)}, project: "p", iid: "${n % 4 === 0 ? 5 : 10 + n}", pid: ${sleeper.pid}, cap: 2, also: () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); } }); process.stdout.write(c.ok ? "won" : c.reason);`;
      const c = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      return once(c, "exit").then(() => out);
    });
    const results = await Promise.all(racers);
    assert.equal(results.filter((r) => r === "won").length, 1, results.join("\n"));
    assert.ok(results.filter((r) => r !== "won").every((r) => /no capacity|already has a run in flight/.test(r)), results.join("\n"));
    assert.equal(board.readRuns(state).filter((r) => r.stage === "setup").length, 2);

    // A refused `also` writes nothing; an accepted one adds its fields over the existing record.
    board.setProject("q");
    const queued = { dir: state, project: "q", iid: "3", pid: sleeper.pid!, cap: 9 };
    assert.deepEqual(board.claimRun({ ...queued, also: () => { throw new Error("project busy"); } }), { ok: false, reason: "project busy" });
    assert.equal(board.readRuns(state).some((r) => r.project === "q"), false);
  } finally {
    sleeper.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
