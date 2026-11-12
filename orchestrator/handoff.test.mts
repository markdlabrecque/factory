import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postAndDeliver, runVerifier } from "./handoff.mts";
import type { Handoff, Host, VerifierSandbox } from "./handoff.mts";

// Run: node --test 'orchestrator/*.test.mts'
// The verify/post/deliver hand-off shared by main.mts and recovery runs, against a fake host (no tracker, git or Docker).

type Rec = Record<string, unknown>;
function fakeHost(record: Rec = {}) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const host: Host = {
    setStage: (_iid, patch) => Object.assign(record, patch),
    readRuns: () => [],
    live: () => true,
    git: (args) => { calls.push(`git ${args.join(" ")}`); return "abc123"; },
    gitStatus: () => ({ status: 0, stdout: "" }),
    tracker: {
      comment: (_iid, body) => { calls.push("comment"); bodies.push(body); },
      uploadEvidence: () => [],
      openMrBranches: () => new Set(),
      deliver: async (d) => { calls.push("deliver"); bodies.push(d.body("CI note")); return { url: "https://example.test/pr/9", merged: false }; },
    },
  };
  return { host, calls, bodies, record };
}
const sandbox = (o: { writes?: string; commits?: number; dir: string }): VerifierSandbox => ({
  run: async () => { if (o.writes) writeFileSync(join(o.dir, "verdict.md"), o.writes); return { commits: Array(o.commits ?? 0).fill("c") }; },
  exec: async (cmd) => ({ stdout: cmd.startsWith("git rev-parse") ? "tip0000001\n" : "" }),
});
const handoff = (dir: string, extra: Partial<Handoff> = {}): Handoff => ({
  iid: "7", project: "o/r", branch: "7-fix", base: "main", baseSha: "base000001", tip: "tip0000001", title: "Fix", evidenceHost: dir,
  origin: { kind: "repaired", attempt: 2 }, ciWaitMinutes: 1, noCiMinutes: 1, autoMerge: false, ...extra,
});

test("a repaired branch is independently verified, posted and delivered like an implemented one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  // The ticket's record still carries an earlier run's PASS and PR (a preserved branch being recovered).
  const { host, calls, bodies, record } = fakeHost({ stage: "setup", verdict: "PASS", mr: "https://example.test/pr/1" });
  assert.equal(await runVerifier(sandbox({ dir, writes: "VERDICT: PASS\nlooks right" }), host, { iid: "7", evidenceHost: dir, agent: {}, promptArgs: {}, tip: "tip0000001" }), undefined);
  const out = await postAndDeliver(handoff(dir), host);
  assert.deepEqual(out, { ok: true, verdict: "PASS", pushed: true, url: "https://example.test/pr/9", merged: false });
  assert.deepEqual(calls, ["comment", "git push -u origin 7-fix", "git rev-parse 7-fix", "deliver"]);
  assert.match(bodies[0], /Repaired by Factory recovery attempt 2, then verified independently/);
  assert.match(bodies[1], /Refs #7\n\nRepaired by Factory recovery attempt 2, then verified independently\. Verdict: \*\*PASS\*\*/);
  assert.equal(record.stage, "done");
  assert.equal(record.mr, "https://example.test/pr/9");
});

test("a stale verdict cannot stand in for this run's verifier", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  writeFileSync(join(dir, "verdict.md"), "VERDICT: PASS\nfrom the earlier run");
  const { host, calls, record } = fakeHost({ stage: "stopped", verdict: "PASS", mr: "https://example.test/pr/1" });
  await runVerifier(sandbox({ dir }), host, { iid: "7", evidenceHost: dir, agent: {}, promptArgs: {}, tip: "tip0000001" });
  assert.equal(existsSync(join(dir, "verdict.md")), false);
  assert.equal(record.verdict, undefined, "an old PASS must not read as delivery while verifying");
  assert.equal(record.mr, undefined);
  const out = await postAndDeliver(handoff(dir), host);
  assert.equal(out.ok, false);
  assert.deepEqual(calls, [], "nothing posted, pushed or delivered");
});

test("a verifier that changes the branch, or a non-PASS verdict, stops before push", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  const { host, calls, record } = fakeHost();
  const refused = await runVerifier(sandbox({ dir, writes: "VERDICT: PASS", commits: 1 }), host, { iid: "7", evidenceHost: dir, agent: {}, promptArgs: {}, tip: "tip0000001" });
  assert.match(refused ?? "", /Verifier changed the branch/);

  writeFileSync(join(dir, "verdict.md"), "VERDICT: FAIL\nbroken");
  const out = await postAndDeliver(handoff(dir, { origin: { kind: "implemented" } }), host);
  assert.equal(out.ok, false);
  assert.deepEqual(calls, ["comment"], "the evidence is posted, nothing pushed");
  assert.equal(record.verdict, "FAIL");
  assert.notEqual(record.stage, "done");
});
