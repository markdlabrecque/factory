import { test } from "node:test";
import assert from "node:assert/strict";
import { ciGate, missingChecks } from "./ci.mts";

// Shared GitHub/GitLab gate, including required names. Run: node --test 'orchestrator/*.test.mts'

test("required checks must be present and pass, not skip or match a substring", () => {
  for (const checks of [[], [{ name: "test", bucket: "skipping" }], [{ name: "test-other", bucket: "pass" }]]) {
    assert.notEqual(ciGate(checks, ["test"]), "pass");
    assert.deepEqual(missingChecks(checks, ["test"]), ["test"]);
  }
  assert.equal(ciGate([{ name: "test", bucket: "pass" }], ["test"]), "pass");
  assert.equal(ciGate([{ name: "test", bucket: "pass" }, { name: "other", bucket: "fail" }], ["test"]), "fail");
});

const b = (...buckets: string[]) => buckets.map((bucket) => ({ bucket }));

test("CI gate: only passing checks merge", () => {
  assert.equal(ciGate(b("pass", "skipping")), "pass");
  assert.equal(ciGate(b("pass", "fail")), "fail");
  assert.equal(ciGate(b("pending", "cancel")), "fail", "a cancelled check fails even while others run");
  assert.equal(ciGate(b("pass", "pending")), "pending");
  assert.equal(ciGate(b("pass", "neutral")), "pending", "an unknown bucket never counts as passing");
});

test("CI gate: no checks, or only skipped ones, is not a pass", () => {
  assert.equal(ciGate([]), "none");
  assert.equal(ciGate(b("skipping", "skipping")), "none");
});
