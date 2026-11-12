import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedOutcome, breakCycles, contentHash, decide, expandUnits, findJam, overlap, pathsOverlap, SANDCASTLE_MARK, staleReason, unitHash } from "./graph.mts";
import type { Edge, Manifest } from "./graph.mts";

// Run: node --test 'orchestrator/*.test.mts'

const manifest = (iid: number, over: Partial<Manifest> = {}): Manifest => ({
  iid, project: "p", hash: `h${iid}`, analyzedAt: "", base: "main", baseSha: "",
  provides: [], requires: [], footprint: [], catalogueIids: [], blockerHashes: {}, ...over,
});
const needs = (from: number, confidence = 0.8) => ({ what: `thing from #${from}`, providedBy: from, evidence: "", confidence });

test("path overlap: files, directories, globs", () => {
  assert.ok(pathsOverlap("web/a.php", "web/a.php"));
  assert.ok(!pathsOverlap("web/a.php", "web/a.php.bak"));
  assert.ok(pathsOverlap("web/modules/foo/", "web/modules/foo/src/X.php"));
  assert.ok(pathsOverlap("web/modules/foo", "web/modules/foo/src/X.php"), "a path without a slash still covers its subtree");
  assert.ok(!pathsOverlap("web/modules/foo", "web/modules/foobar/x.php"));
  assert.ok(pathsOverlap("config/sync/field.field.node.event.*", "config/sync/field.field.node.event.field_date.yml"));
  assert.ok(!pathsOverlap("config/sync/field.field.node.event.*", "config/sync/field.field.node.page.body.yml"));
  assert.ok(pathsOverlap("./web/", "web/x"));
});

test("overlap skips ignored paths", () => {
  assert.deepEqual(overlap(["composer.lock", "web/a.php"], ["composer.lock"], ["composer.lock"]), []);
  assert.deepEqual(overlap(["docs/x.md", "web/a.php"], ["docs/", "web/"], ["docs/"]), ["web/a.php"]);
});

test("content hash ignores Sandcastle and system comments, line endings and labels", () => {
  const base = { title: "Fix header", description: "Line one\nLine two", notes: [{ body: "Use the blue one" }] };
  const h = contentHash(base);
  assert.equal(contentHash({ ...base, description: "Line one\r\nLine two  " }), h);
  assert.equal(contentHash({ ...base, notes: [...base.notes, { body: `## Sandcastle verification: PASS\n${SANDCASTLE_MARK}` }] }), h);
  assert.equal(contentHash({ ...base, notes: [...base.notes, { body: "added ~ready-for-agent label", system: true }] }), h);
  assert.notEqual(contentHash({ ...base, description: "Line one" }), h);
  assert.notEqual(contentHash({ ...base, notes: [{ body: "Use the red one" }] }), h);
});

test("re-analysis triggers", () => {
  const cat = new Map([[1, "c1"], [2, "c2"]]);
  assert.equal(staleReason(undefined, "h", cat), "not analysed yet");
  const m = manifest(1, { hash: "h", catalogueIids: [1, 2], blockerHashes: { 2: "c2" }, requires: [needs(2)] });
  assert.equal(staleReason(m, "h", cat), null);
  assert.equal(staleReason(m, "edited", cat), "ticket changed");
  assert.equal(staleReason(m, "h", new Map([[1, "c1"], [2, "c2-edited"]])), "blocker #2 changed");
  const unresolved = manifest(1, { hash: "h", catalogueIids: [1, 2], requires: [{ ...needs(0), providedBy: null }] });
  assert.equal(staleReason(unresolved, "h", cat), null);
  assert.equal(staleReason(unresolved, "h", new Map([...cat, [3, "c3"]])), "new tickets may provide what it needs");
});

test("cycles drop their weakest edge", () => {
  const e = (from: number, to: number, confidence: number, source: Edge["source"] = "analysis"): Edge => ({ from, to, confidence, source, what: "", evidence: "" });
  const strong = e(1, 2, 0.9);
  const weak = e(2, 3, 0.4);
  const back = e(3, 1, 0.7);
  const { kept, dropped } = breakCycles([strong, weak, back, e(4, 5, 0.1)]);
  assert.deepEqual(dropped, [weak]);
  assert.equal(kept.length, 3);
  const tie = breakCycles([e(1, 2, 1, "implementer"), e(2, 1, 1, "analysis")]);
  assert.equal(tie.dropped[0].source, "analysis", "an implementer report outranks the analysis on a tie");
});

test("decide: blockers, conflicts, capacity, analysis", () => {
  const manifests = new Map([
    [10, manifest(10, { footprint: ["web/themes/x/"] })],
    [11, manifest(11, { requires: [needs(10)], footprint: ["web/modules/a/"] })],
    [12, manifest(12, { footprint: ["web/themes/x/header.twig"] })],
    [13, manifest(13, { requires: [needs(99)] })],
    [14, manifest(14, { footprint: ["web/modules/b/"] })],
    [15, manifest(15, { footprint: ["web/modules/c/"] })],
  ]);
  const { decisions } = decide({
    candidates: [10, 11, 12, 13, 14, 15, 16].map((iid) => ({ iid, hash: `h${iid}` })),
    manifests,
    satisfied: () => false,
    queue: new Set([10, 11, 12, 13, 14, 15, 16]),
    live: [{ iid: 9, footprint: ["web/modules/b/x.php"] }],
    room: 2,
  });
  const by = new Map(decisions.map((d) => [d.iid, d]));
  assert.ok(by.get(10)!.launch);
  assert.match(reason(by.get(11)), /^waiting on #10: /);
  assert.match(reason(by.get(12)), /^held by #10: web\/themes\/x\/header\.twig/, "a ticket launched earlier in the pass holds its files");
  assert.match(reason(by.get(13)), /#99 \(outside the agent queue\)/);
  assert.match(reason(by.get(14)), /^held by #9: /);
  assert.ok(by.get(15)!.launch);
  assert.equal(reason(by.get(16)), "not analysed yet");
});

test("decide: satisfied blockers release, real diff replaces the prediction, stale manifests wait", () => {
  const manifests = new Map([
    [11, manifest(11, { requires: [needs(10)] })],
    [12, manifest(12, { footprint: ["web/a/"], actualFootprint: ["web/b.php"] })],
    [13, manifest(13, { hash: "old" })],
  ]);
  const { decisions } = decide({
    candidates: [11, 12, 13].map((iid) => ({ iid, hash: `h${iid}` })),
    manifests,
    satisfied: (iid) => iid === 10,
    queue: new Set(),
    live: [{ iid: 9, footprint: ["web/a/x.php"] }],
    room: 5,
  });
  assert.deepEqual(decisions.map((d) => d.launch), [true, true, false]);
});

test("blocked outcome", () => {
  const b = (iid: number | null) => ({ iid, what: "", evidence: "" });
  const open = () => false;
  assert.equal(blockedOutcome(5, [b(7)], open), "wait");
  assert.equal(blockedOutcome(5, [b(7), b(null)], open), "needs-human");
  assert.equal(blockedOutcome(5, [b(7)], (i) => i === 7), "needs-human", "blocked again after the blocker merged");
  assert.equal(blockedOutcome(5, [b(5)], open), "needs-human");
  assert.equal(blockedOutcome(5, [], open), "needs-human");
});

function reason(d: { launch: boolean; reason?: string } | undefined): string {
  assert.ok(d && !d.launch);
  return d.reason!;
}

test("units: tasks replace their parent, closed tasks advance it, whole-issue mode ignores tasks", () => {
  const childrenOf = new Map([
    [1, [{ iid: 11, open: true }, { iid: 12, open: false }, { iid: 13, open: true }]],
    [2, [{ iid: 21, open: false }]],
  ]);
  assert.deepEqual(expandUnits([1, 2, 3], childrenOf, true), {
    units: [{ iid: 11, parent: 1 }, { iid: 13, parent: 1 }, { iid: 3 }],
    advance: [2],
  });
  assert.deepEqual(expandUnits([1, 2, 3], childrenOf, false), { units: [{ iid: 1 }, { iid: 2 }, { iid: 3 }], advance: [] });
});

test("units: a task that is ready along with its parent appears once, with its parent, in either order", () => {
  const childrenOf = new Map([[30, [{ iid: 31, open: true }, { iid: 32, open: true }]]]);
  const want = [{ iid: 31, parent: 30 }, { iid: 32, parent: 30 }];
  assert.deepEqual(expandUnits([30, 31, 32], childrenOf, true).units, want);
  assert.deepEqual(expandUnits([31, 32, 30], childrenOf, true).units, [{ iid: 31, parent: 30 }, { iid: 32, parent: 30 }]);
  assert.deepEqual(expandUnits([31], childrenOf, true).units, [{ iid: 31 }], "child-only: dispatch resolves it from the catalogue");
  assert.deepEqual(expandUnits([30, 31], childrenOf, false).units, [{ iid: 30 }, { iid: 31 }], "whole-issue mode unchanged");
});

test("a task's hash changes when its parent is edited", () => {
  const task = { title: "t", description: "d", parent: { iid: 1, title: "p", description: "v1" } };
  assert.notEqual(unitHash(task), unitHash({ ...task, parent: { ...task.parent, description: "v2" } }));
  assert.equal(unitHash({ title: "t", description: "d" }), contentHash({ title: "t", description: "d" }), "plain tickets keep their old hash");
});

test("project jam: stopped ready tickets and the holds behind them, only when normal work cannot move", () => {
  const held = (iid: number, ...on: number[]) => ({ iid, launch: false as const, reason: `waiting on ${on.map((x) => `#${x}`).join(", ")}`, waitingOn: on });
  const units = [{ iid: 3, stage: "stopped" }, { iid: 5 }, { iid: 6 }, { iid: 8 }];
  const quiet = { units, decisions: [held(5, 3), held(6, 5), held(8, 3, 99)], active: [], room: 3 };
  assert.deepEqual(findJam(quiet).tickets, [3, 5, 6], "#6 waits on #5 waits on stopped #3; #8 also waits on #99, outside the jam");
  // A dependency hold alone, or one on a prerequisite whose PR is open, is not a jam.
  assert.deepEqual(findJam({ ...quiet, units: [{ iid: 3, stage: "stopped", openPr: true }, { iid: 5 }] }).tickets, []);
  assert.deepEqual(findJam({ ...quiet, units: [{ iid: 5 }], decisions: [held(5, 99)] }).tickets, []);
  // Normal work and shared capacity come first.
  assert.match((findJam({ ...quiet, active: [4] }) as { none: string }).none, /in flight: #4/);
  assert.match((findJam({ ...quiet, decisions: [...quiet.decisions, { iid: 9, launch: true }] }) as { none: string }).none, /launched/);
  assert.match((findJam({ ...quiet, decisions: [{ iid: 9, launch: false, reason: "not analysed yet" }] }) as { none: string }).none, /analysis/);
  assert.match((findJam({ ...quiet, room: 0 }) as { none: string }).none, /free slot/);
});

test("decide names the prerequisites a held ticket waits on", () => {
  const manifests = new Map([[2, manifest(2, { requires: [needs(1)] })]]);
  const { decisions } = decide({ candidates: [{ iid: 2, hash: "h2" }], manifests, satisfied: () => false, queue: new Set([1, 2]), live: [], room: 3 });
  assert.deepEqual(decisions, [{ iid: 2, launch: false, reason: "waiting on #1: thing from #1", waitingOn: [1] }]);
});
