// #149: prerequisite fixtures use explicit dependency states, with thrown reads still held.
// #150: every successful handoff fixture supplies a frozen host proof, not legacy verdict prose.
import { createProof } from './verification.mts';
import { fixtureProvenance, writeVerification } from './fixtures/verification.mts';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postAndDeliver, prerequisiteHold, runVerifier } from "./handoff.mts";
import type { Manifest } from "./graph.mts";
import type { Handoff, Host, VerifierSandbox } from "./handoff.mts";

// Hand-off tests fake the Node-watchdog preflight; its real process lifecycle is tested separately.
// Run: node --test 'orchestrator/*.test.mts'
// The verify/post/deliver hand-off shared by main.mts and recovery runs, and the prerequisite recheck recovery runs make
// (#75), against a fake host (no tracker, git or Docker). Posting failures stop every verdict before delivery.
// Blocked merge gates park as waiting. The sandbox fake explicitly provisions the browser probe.

type Rec = Record<string, unknown>;
function fakeHost(record: Rec = {}) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const host: Host = {
    setStage: (_iid, patch) => Object.assign(record, patch),
    readRuns: () => [],
    live: () => true,
    git: (args) => { calls.push(`git ${args.join(" ")}`); return 'b'.repeat(40); },
    gitStatus: () => ({ status: 0, stdout: "" }),
    tracker: {
      postVerification: (_iid, _tip, files, body) => { calls.push("comment"); bodies.push(body(files.map((f) => `![media](${f})`))); },
      openMrBranches: () => new Set(),
      deliver: async (d) => { calls.push("deliver"); bodies.push(d.body("CI note")); return { url: "https://example.test/pr/9", merged: false }; },
    },
  };
  return { host, calls, bodies, record };
}
const sandbox = (o: { writes?: string; commits?: number; dir: string }): VerifierSandbox => ({
  run: async () => { if (o.writes) { writeFileSync(join(o.dir, "verdict.md"), o.writes); writeVerification(o.dir, o.writes.split('\n')[0].slice(9)); } return { commits: Array(o.commits ?? 0).fill("c") }; },
  exec: async (cmd) => ({ stdout: cmd.startsWith("git rev-parse") ? "tip0000001\n" : cmd.startsWith("command -v playwright ") ? "browser preflight OK\n" : "" }),
});
const handoff = (dir: string, extra: Partial<Handoff> = {}): Handoff => {
  const state = mkdtempSync(join(tmpdir(), 'handoff-state-'));
  const identity = { project: 'o/r', ticket: '7', executionId: 'execution', branch: '7-fix', base: 'main', baseline: 'a'.repeat(40), tip: 'b'.repeat(40), requirementsHash: 'c'.repeat(64) };
  let proofId = '00000000-0000-0000-0000-000000000000';
  if (existsSync(join(dir, 'verdict.md'))) {
    writeVerification(dir, requireVerdict(dir));
    proofId = createProof(state, dir, identity, fixtureProvenance).id;
  }
  return { iid: '7', project: 'o/r', branch: '7-fix', base: 'main', baseSha: identity.baseline, tip: identity.tip, title: 'Fix', evidenceHost: dir,
    identity, state, proofId, recheck: () => undefined, origin: { kind: 'repaired', attempt: 2 }, ciWaitMinutes: 1, noCiMinutes: 1, autoMerge: false, ...extra };
};
const requireVerdict = (dir: string) => readFileSync(join(dir, 'verdict.md'), 'utf8').split('\n')[0].slice(9);

test("a repaired branch is independently verified, posted and delivered like an implemented one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  // The ticket's record still carries an earlier run's PASS and PR (a preserved branch being recovered).
  const { host, calls, bodies, record } = fakeHost({ stage: "setup", verdict: "PASS", mr: "https://example.test/pr/1" });
  assert.equal(await runVerifier(sandbox({ dir, writes: "VERDICT: PASS\nlooks right" }), host, { iid: "7", evidenceHost: dir, agent: {}, promptArgs: {}, tip: "tip0000001" }), undefined);
  const out = await postAndDeliver(handoff(dir), host);
  assert.deepEqual(out, { ok: true, verdict: "PASS", pushed: true, url: "https://example.test/pr/9", merged: false });
  assert.deepEqual(calls, ['comment', 'git rev-parse refs/heads/7-fix', `git push origin ${'b'.repeat(40)}:refs/heads/7-fix`, 'git ls-remote --heads origin refs/heads/7-fix', 'deliver']);
  assert.match(bodies[0], /Repaired by Factory recovery attempt 2, then verified independently/);
  assert.match(bodies[1], /Refs #7\n\nRepaired by Factory recovery attempt 2, then verified independently\. Verdict: \*\*PASS\*\*/);
  assert.equal(record.stage, "done");
  assert.equal(record.mr, "https://example.test/pr/9");
});

test("a blocked automatic merge parks the run with its open PR for a person", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  writeFileSync(join(dir, "verdict.md"), "VERDICT: PASS");
  const { host, record } = fakeHost();
  host.tracker.deliver = async () => ({ url: "https://example.test/pr/9", merged: false, blocked: "required check test missing" });
  const result = await postAndDeliver(handoff(dir, { autoMerge: true }), host);
  assert.equal(result.ok, true);
  assert.equal(record.stage, "waiting");
  assert.equal(record.mr, "https://example.test/pr/9");
  assert.match(String(record.note), /Waiting for a person: required check test missing/);
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

test('branch movement, changed requirements, forged identity and remote mismatch never deliver', async () => {
  for (const scenario of ['branch', 'requirements', 'identity', 'remote']) {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
    writeFileSync(join(dir, 'verdict.md'), 'VERDICT: PASS');
    const h = handoff(dir);
    const { host, calls } = fakeHost();
    if (scenario === 'branch') host.git = args => { calls.push(`git ${args.join(' ')}`); return 'different'; };
    if (scenario === 'requirements') h.recheck = () => 'requirements changed';
    if (scenario === 'identity') h.identity.executionId = 'different';
    if (scenario === 'remote') host.git = args => { calls.push(`git ${args.join(' ')}`); return args[0] === 'ls-remote' ? 'different' : h.tip; };
    const out = await postAndDeliver(h, host);
    assert.equal(out.ok, false);
    assert.ok(!calls.includes('deliver'));
    if (scenario !== 'remote') assert.ok(!calls.some(c => c.startsWith('git push')));
  }
});

test("prerequisite holds: an unmet dependency holds, and so does not knowing", () => {
  const m: Manifest = { iid: 7, project: "o/r", hash: "h", analyzedAt: "", base: "main", baseSha: "", provides: [], footprint: [], catalogueIids: [],
    blockerHashes: {}, requires: [{ what: "API", providedBy: 12, evidence: "", confidence: 1 }, { what: "nothing", providedBy: null, evidence: "", confidence: 1 }],
    implementerBlockers: [{ iid: 13, what: "schema", evidence: "" }] };
  const view = (o: { done?: number[]; active?: Record<number, string>; hash?: string; manifest?: Manifest | null; throws?: boolean }) => ({
    manifest: o.manifest === null ? undefined : (o.manifest ?? m), hash: o.hash ?? "h",
    dependency: (i: number) => { if (o.throws) throw new Error("gh failed"); return { state: (o.done ?? []).includes(i) ? "satisfied" as const : "unsatisfied" as const }; },
    active: (i: number) => o.active?.[i],
  });
  assert.equal(prerequisiteHold(7, view({ done: [12, 13] })), undefined);
  assert.equal(prerequisiteHold(7, view({ done: [13], active: { 12: "an open PR" } })), "#7 waits on #12 (an open PR): API");
  assert.equal(prerequisiteHold(7, view({ done: [12] })), "#7 waits on #13: schema", "implementer-reported blockers count");
  assert.match(prerequisiteHold(7, view({ manifest: null }))!, /no ticket analysis/);
  assert.match(prerequisiteHold(7, view({ hash: "other" }))!, /out of date/);
  assert.match(prerequisiteHold(7, view({ throws: true }))!, /unknown: gh failed/);
  assert.match(prerequisiteHold(7, { ...view({}), dependency: () => ({ state: "unknown", reason: "Dependency information unavailable for #12: ticket lookup failed" }) })!, /#7 waits on #12.*information unavailable/);
  assert.equal(prerequisiteHold(7, view({ done: [12, 13] })), undefined, "a later confirmed read releases the hold");
});
