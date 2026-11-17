// Passive parked-card preservation and explicit Board refresh integration.
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

import { emptyAdmission, readAdmission } from '../board/admission.mts';
import { assertUnchargedAdmission, FIXTURES, git, ticket, fixture } from "./refresh-fixture.mts";

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
    assertUnchargedAdmission(f.dir);
  });

  test(`${kind}: requirements, human comments and parent edits reassess stopped, active and completed cards without changing execution`, (t) => {
    const f = fixture(t, kind);
    f.data.tickets.push(ticket(30, { description: "parent context", contextOnly: true }));
    f.data.parents[7] = 30;
    const admission = join(f.dir, "admission/state.json");
    // Valid saved accounting is preserved; corrupt stores now correctly refuse all effecting managed entries.
    const preserved = { ...emptyAdmission(), generations: { saved: 5 }, recovery: { saved: { admitted: 2, pending: [] } } };
    writeFileSync(admission, JSON.stringify(preserved));
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
        assert.deepEqual(readAdmission(f.dir), preserved, 'only transient managed entry ownership changes; accounting stays exact');
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
      assertUnchargedAdmission(f.dir);
      assert.equal(existsSync(join(f.fake, "launches")), false);
    } finally { server.kill(); await once(server, "exit"); }
  });
}

