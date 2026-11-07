import { test } from "node:test";
import assert from "node:assert/strict";
import { ciGate } from "./ci.mts";

// Run: node --test 'orchestrator/*.test.mts'

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
