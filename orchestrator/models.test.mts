import { test } from "node:test";
import assert from "node:assert/strict";
import { disallowedModels, ticketModel } from "./models.mts";

// Run: node --test 'orchestrator/*.test.mts'

const labels = { "model:sol": "openai/gpt-6.1-sol", "model:luna": "openai/gpt-6-luna" };

test("ticket model: exactly one model label is required", () => {
  assert.deepEqual(ticketModel(["ready-for-agent", "model:luna"], labels, "x"), { model: "openai/gpt-6-luna" });
  assert.ok("error" in ticketModel(["ready-for-agent"], labels, "x"));
  assert.ok("error" in ticketModel(["model:sol", "model:luna"], labels, "x"));
  assert.deepEqual(ticketModel([], {}, "fixed"), { model: "fixed" }, "no model labels configured: the fixed model");
});

test("only the labelled models may be configured", () => {
  assert.equal(disallowedModels(labels, ["openai/gpt-6.1-sol"]), undefined);
  assert.match(disallowedModels(labels, ["openai/gpt-6.1-sol", "openai/gpt-5.5"]) ?? "", /gpt-5\.5/);
  assert.equal(disallowedModels({}, ["anything"]), undefined);
});
