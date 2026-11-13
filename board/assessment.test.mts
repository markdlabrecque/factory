// Current assessments (#78): fail-closed dependencies, separate pending analysis, bounded attempts, store-failure
// isolation, generation-safe requests and an HTTP manual failure with scheduling off. Cross-process interleavings
// fence pending, successful and failed old attempts; stale assessment locks are reclaimed without admission writes.
// All tracker/analyst callbacks are fixtures. No real trackers, agents, Docker or services.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assessed, beginAssessment, pendingRequests, pickRefreshes, publishAssessment, readAssessment, refreshCards, requestRefresh } from "./assessment.mts";
import { ownerOf } from "./admission.mts";
import type { RefreshDeps } from "./assessment.mts";

const facts = (hash: string, state = "open") => ({ title: "T", state, labels: [], hash });
const fixture = (t: any) => {
  const dir = mkdtempSync(resolve(tmpdir(), "assess-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = { key: "p--7", iid: "7", project: "p", stage: "stopped", ticketHash: "old" };
  const record = JSON.stringify({ ...run, verdict: "FAIL", branch: "7-topic", claim: "old-claim", archived: true,
    stageHistory: [{ stage: "implementing", at: "then" }], evidenceDir: "evidence" });
  writeFileSync(resolve(dir, "p--7.json"), record);
  const d: RefreshDeps = {
    dir, project: "p", now: () => "now", read: () => ({ iid: 7, title: "T", description: "new", state: "open", labels: [] }),
    notes: () => [], dependency: () => "satisfied", hash: () => "new", model: () => ({ model: "m" }), log: () => {},
    selection: () => ({ selected: true }), analysisInput: () => "input", analysisBudget: 1,
    analyse: () => ({ requires: [{ providedBy: 3 }] }),
  };
  return { dir, run, record, d, read: () => readAssessment(dir, run.key)! };
};

test("a failed check keeps the last good facts and records the error; a good one clears it", () => {
  const ok = assessed(undefined, { iid: "1", at: "t1", runHash: "a", ticket: facts("a") });
  const bad = assessed(ok, { iid: "1", at: "t2", error: "boom" });
  assert.equal(bad.facts?.checkedAt, "t1");
  assert.equal(bad.error, "boom");
  const again = assessed(bad, { iid: "1", at: "t3", runHash: "a", ticket: facts("b") });
  assert.equal(again.error, undefined);
  assert.equal(again.changed, true);
});

test("a newer request arriving inside analysis survives the older refresh and remains pending", (t) => {
  const f = fixture(t);
  requestRefresh(f.dir, f.run.key, "7", "p");
  f.d.analyse = () => {
    assert.equal(f.read().analysisState, "pending", "published before blocking analysis");
    requestRefresh(f.dir, f.run.key, "7", "p");
    return { requires: [] };
  };
  refreshCards([f.run], f.d);
  assert.equal(f.read().pending, true);
  assert.equal(pendingRequests(f.dir).get(f.run.key)?.length, 1);
  assert.deepEqual(pickRefreshes(["x", f.run.key], pendingRequests(f.dir), new Map(), 1), [f.run.key]);
  refreshCards([f.run], f.d);
  assert.equal(f.read().pending, false);
});

for (const stage of ["stopped", "implementing", "done", "queued", "waiting"]) {
  test(`${stage}: analysis is independently stale, budgeted and read-only`, (t) => {
    const f = fixture(t); f.run.stage = stage;
    refreshCards([f.run], f.d);
    assert.equal(f.read().analysisState, "current");
    f.d.analysisInput = () => "edited comments / parent / dependencies";
    f.d.analysisBudget = 0;
    refreshCards([f.run], f.d);
    assert.equal(f.read().analysisState, "pending");
    assert.equal(f.read().analysis?.input, "input", "last good analysis retained");
    assert.equal(f.read().dependencies, undefined);
    assert.equal(f.read().retryRequired, undefined);
    f.d.analysisBudget = 1;
    f.d.analyse = () => ({ requires: [{ providedBy: 4 }] });
    f.d.dependency = () => "unsatisfied";
    refreshCards([f.run], f.d);
    assert.equal(f.read().analysisState, "current");
    assert.equal(f.read().dependencies?.[0].iid, 4);
    assert.equal(readFileSync(resolve(f.dir, "p--7.json"), "utf8"), f.record);
  });
}

for (const [name, dependencies, state, cleared] of [
  ["unresolved provider", { requires: [{ providedBy: null }, { providedBy: 3 }] }, "satisfied", false],
  ["human-only blocker", { implementerBlockers: [{ iid: null }] }, "satisfied", false],
  ["tracker lookup error", { requires: [{ providedBy: 3 }] }, "unknown", false],
  ["open dependency", { requires: [{ providedBy: 3 }] }, "unsatisfied", false],
  ["closed dependency", { requires: [{ providedBy: 3 }] }, "satisfied", true],
  ["merged dependency", { implementerBlockers: [{ iid: 3 }] }, "satisfied", true],
] as const) {
  test(`cleared blockers fail closed: ${name}; historical FAIL is untouched`, (t) => {
    const f = fixture(t);
    f.d.analyse = () => dependencies as any;
    f.d.dependency = () => state;
    refreshCards([f.run], f.d);
    assert.equal(!!f.read().retryRequired, cleared);
    assert.equal(readFileSync(resolve(f.dir, "p--7.json"), "utf8"), f.record);
  });
}

test("analysis failure preserves last good facts/analysis, marks stale, and clears the retry claim", (t) => {
  const f = fixture(t);
  refreshCards([f.run], f.d);
  f.d.analysisInput = () => "edited";
  f.d.analyse = () => { throw new Error("analysis timed out"); };
  refreshCards([f.run], f.d);
  assert.equal(f.read().analysisState, "error");
  assert.equal(f.read().analysis?.input, "input");
  assert.match(f.read().analysisError!, /timed out/);
  assert.equal(f.read().retryRequired, undefined);
  f.d.read = () => { throw new Error("tracker down"); };
  refreshCards([f.run], f.d);
  assert.equal(f.read().error, "tracker down");
  assert.equal(f.read().facts?.hash, "new");
});

for (const method of ["read", "requests", "write", "clear"] as const) {
  test(`assessment store ${method} failure is isolated and logged`, (t) => {
    const f = fixture(t), logs: string[] = [];
    f.d.log = (s) => logs.push(s);
    f.d.store = { [method]: () => { throw new Error(`${method} denied`); } };
    assert.doesNotThrow(() => refreshCards([f.run], f.d));
    assert.match(logs.join("\n"), new RegExp(`${method} denied`));
    assert.equal(readFileSync(resolve(f.dir, "p--7.json"), "utf8"), f.record);
  });
}

for (const pause of ["before pending", "during analysis", "tracker failure", "analysis failure"] as const) {
  test(`a newer process stays authoritative after an old attempt resumes ${pause}`, (t) => {
    const f = fixture(t);
    requestRefresh(f.dir, f.run.key, "7", "p");
    const newer = () => {
      // This separate process models a manual refresh overtaking a scheduled check. Both use real storage/CAS.
      const script = `
        import { refreshCards, requestRefresh } from ${JSON.stringify(new URL("./assessment.mts", import.meta.url).href)};
        const dir = ${JSON.stringify(f.dir)}, run = ${JSON.stringify(f.run)};
        requestRefresh(dir, run.key, run.iid, run.project);
        refreshCards([run], {
          dir, project: 'p', now: () => 'new-time',
          read: () => ({ iid: 7, title: 'NEW', description: 'edited' }), notes: () => [],
          hash: () => 'new-hash', model: () => ({ model: 'new-model' }),
          selection: () => ({ selected: false }), analysisInput: () => 'new-input',
          analysisBudget: 1, analyse: () => ({ requires: [{ providedBy: 99 }] }),
          dependency: () => 'unsatisfied', log: (m) => { throw new Error(m); },
        });`;
      execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, HOME: f.dir }, timeout: 10_000 });
      assert.equal(f.read().facts?.title, "NEW");
      assert.equal(f.read().pending, false);
      return JSON.stringify(f.read());
    };
    let authoritative = "";
    f.d.hash = () => "old-hash";
    f.d.read = () => {
      if (pause === "before pending" || pause === "tracker failure") authoritative = newer();
      if (pause === "tracker failure") throw new Error("old tracker failure");
      return { iid: 7, title: "OLD", description: "old facts" };
    };
    f.d.analyse = () => {
      authoritative = newer();
      if (pause === "analysis failure") throw new Error("old analysis failure");
      return { requires: [{ providedBy: 3 }] };
    };
    assert.deepEqual(refreshCards([f.run], f.d), [], "superseded attempt publishes nothing");
    assert.equal(JSON.stringify(f.read()), authoritative);
    assert.equal(f.read().facts?.hash, "new-hash");
    assert.equal(f.read().analysis?.input, "new-input");
    assert.equal(f.read().analysisState, "current");
    assert.deepEqual(f.read().dependencies, [{ iid: 99, state: "unsatisfied" }]);
    assert.equal(pendingRequests(f.dir).size, 0);
    assert.equal(readFileSync(resolve(f.dir, "p--7.json"), "utf8"), f.record);
    assert.equal(existsSync(resolve(f.dir, "admission")), false);
  });
}

test("dead assessment lock owners are reclaimed and old tokens cannot publish errors", (t) => {
  const f = fixture(t), lock = resolve(f.dir, "assessment", `${f.run.key}.lock`);
  const dead = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `import { ownerOf } from ${JSON.stringify(new URL("./admission.mts", import.meta.url).href)}; console.log(JSON.stringify(ownerOf(process.pid)));`], { encoding: "utf8" }));
  mkdirSync(resolve(f.dir, "assessment"));
  symlinkSync(JSON.stringify(dead), lock);
  const old = beginAssessment(f.dir, f.run.key), current = beginAssessment(f.dir, f.run.key);
  assert.equal(existsSync(resolve(f.dir, "admission")), false);
  assert.equal(publishAssessment(f.dir, f.run.key, old, () => assert.fail("stale error publication")), false);
  assert.equal(publishAssessment(f.dir, f.run.key, current, () => {}), true);
});

test("a live assessment lock times out safely without aborting dispatch", (t) => {
  const f = fixture(t), logs: string[] = [];
  mkdirSync(resolve(f.dir, "assessment"));
  symlinkSync(JSON.stringify(ownerOf(process.pid)), resolve(f.dir, "assessment", `${f.run.key}.lock`));
  f.d.log = (s) => logs.push(s);
  assert.doesNotThrow(() => refreshCards([f.run], f.d));
  assert.match(logs.join("\n"), /Assessment lock busy/);
  assert.equal(readFileSync(resolve(f.dir, "p--7.json"), "utf8"), f.record);
});

test("board renders without assessments when directory reads fail", async (t) => {
  const f = fixture(t), old = process.env.SANDCASTLE_STATE_DIR;
  process.env.SANDCASTLE_STATE_DIR = f.dir;
  t.after(() => { if (old === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = old; });
  writeFileSync(resolve(f.dir, "assessment"), "not a directory");
  const { buildBoardData } = await import("./board.mts");
  const data = buildBoardData("http");
  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0].assessment, undefined);
});

test("manual HTTP refresh with scheduling off records a missing-root failure; header gate and run preserved", async (t) => {
  const { spawn } = await import("node:child_process"), { once } = await import("node:events");
  const f = fixture(t);
  const child = spawn(process.execPath, [resolve("board/board-server.mts")], {
    cwd: f.dir, env: { ...process.env, FACTORY_HOME: f.dir, SANDCASTLE_STATE_DIR: f.dir, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const [out] = await once(child.stdout!, "data"), base = String(out).match(/http:\/\/[^\s]+/)![0];
    assert.equal((await fetch(`${base}/api/refresh/p--7`)).status, 405);
    assert.equal((await fetch(`${base}/api/refresh/p--7`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/api/refresh/p--7`, { method: "POST", headers: { "x-factory-refresh": "1" } })).status, 202);
    const api = await (await fetch(`${base}/api/runs`)).json();
    assert.match(api.runs[0].assessment.error, /Project root not found/);
    assert.equal(api.runs[0].assessment.pending, false);
    assert.equal(readFileSync(resolve(f.dir, "p--7.json"), "utf8"), f.record);
  } finally { child.kill(); await once(child, "exit"); }
});
