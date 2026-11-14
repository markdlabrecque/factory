// #149: dependency reads never infer success from errors, missing data or malformed states.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencyState, type DependencyView } from "./dependencies.mts";
const throws = () => { throw new Error("404 auth token=secret transport rate-limit"); };
const view: DependencyView = { ticket: () => ({ state: "open" }), run: () => undefined, mergedInto: () => false, base: "main" };
for (const [name, change, state] of [
  ["closed", { ticket: () => ({ state: "closed" }), run: throws }, "satisfied"],
  ["open without run", {}, "unsatisfied"],
  ["GitLab opened", { ticket: () => ({ state: "opened" }) }, "unsatisfied"],
  ["merged", { run: () => ({ branch: "12-topic", base: "stable" }), mergedInto: (b: string, base: string) => { assert.equal(b, "12-topic"); assert.equal(base, "stable"); return true; } }, "satisfied"],
  ["unmerged", { run: () => ({ branch: "12-topic" }) }, "unsatisfied"],
  ["unrecognized state despite merge", { ticket: () => ({ state: "deleted" }), mergedInto: () => true }, "unknown"],
  ["missing response", { ticket: () => undefined }, "unknown"],
  ["missing state", { ticket: () => ({}) }, "unknown"],
  ["ticket exception including 404", { ticket: throws }, "unknown"],
  ["run exception", { run: throws }, "unknown"],
  ["merge exception", { run: () => ({ branch: "12-topic" }), mergedInto: throws }, "unknown"],
] as const) test(name, () => {
  const result = dependencyState(12, { ...view, ...change });
  assert.equal(result.state, state);
  if (state === "unknown") {
    assert.match(result.reason!, /#12/);
    assert.doesNotMatch(result.reason!, /secret|token|404|auth/);
  }
});
test("a later read recovers without changing the ticket", () => {
  let failed = true;
  const v = { ...view, ticket: () => { if (failed) return throws(); return { state: "closed" }; } };
  assert.equal(dependencyState(12, v).state, "unknown");
  failed = false;
  assert.equal(dependencyState(12, v).state, "satisfied");
});
