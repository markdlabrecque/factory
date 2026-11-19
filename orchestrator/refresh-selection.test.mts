// Fail-closed refresh selection, assessment and analysis timeout integration.
import { createProof } from './verification.mts';
import { bindExecution, executionSnapshot } from '../cli/test/execution-fixture.mts';
import { modelForRole } from './model-policy.mts';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildAssets } from "../cli/src/scaffold.mts";
import { readAssessment, requestRefresh } from "../board/assessment.mts";
import { fixtureTicketHash } from './fixtures/ticket-input.mts';

import { assertUnchargedAdmission, FIXTURES, git, ticket, fixture } from "./refresh-fixture.mts";

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
  assertUnchargedAdmission(f.dir);
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
  const config = join(f.root, '.factory/factory.toml');
  writeFileSync(config, f.bytes(config).replace('analysis_timeout_minutes = 10', 'analysis_timeout_minutes = 0.001'));
  f.data.tickets[0].description = "edited DEP:21";
  f.pass(["--refresh-only", "--ticket", "7"], { FAKE_ANALYSIS_DELAY: "3000" });
  assert.equal(f.assessment().analysisState, "error");
  assert.match(f.assessment().analysisError!, /analysis.*failed/);
  assert.deepEqual(f.assessment().analysis, prior);
  assert.equal(f.assessment().facts?.hash, fixtureTicketHash(f.data, 7));
  assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
  assertUnchargedAdmission(f.dir);
});

