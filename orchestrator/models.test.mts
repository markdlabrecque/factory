// #126: description parsing, approval, failures and reference model configuration regressions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT as PERSONAL_AGENT, GRAPH as PERSONAL_GRAPH } from "./config.personal.mts";
import { AGENT as CLIENT_AGENT } from "./config.mts";
import { disallowedModels, piAnalysisArgs, piEnvFor, subscriptionPreflight, ticketModel } from "./models.mts";

// Run: node --test 'orchestrator/*.test.mts'

const SONNET = "pi-claude-subscription/claude-sonnet-5-5";
const OPUS = "pi-claude-subscription/claude-opus-5-5";
const labels = { sonnet: SONNET, opus: OPUS, "Sonnet 5.5": SONNET };

test("ticket model: explicit aliases and approved IDs, never labels or prose", () => {
  for (const body of ["**Model:** Sonnet 5.5", "Model: SONNET", "**Pi model:** `sonnet`", `**Model**: ${SONNET}`, "Model: sonnet\r\nPi model: Sonnet 5.5"]) {
    const m = ticketModel(body, labels);
    assert.equal(m.status, "resolved", body);
    assert.equal("model" in m && m.model, SONNET);
    assert.match(m.revision, /^[a-f0-9]{64}$/);
    assert.ok(m.declarations.length);
  }
  for (const body of ["Use Sonnet 5.5", "Labels: model:sonnet", "> Model: opus", "    Model: opus", "```md\nModel: opus\n```", "~~~\nModel: opus\n~~~", "<!--\nModel: opus\n-->", "<!-- Model: opus -->"]) {
    assert.equal(ticketModel(body, labels).status, "missing", body);
  }
  assert.equal(ticketModel("```md\n``` example, not a closing fence\nModel: opus\n```", labels).status, "missing");
  assert.equal(ticketModel("```html\n<!--\n```\nModel: opus", labels).status, "resolved");
  assert.equal(ticketModel("~~~html\n<!--\n~~~\nModel: opus", labels).status, "resolved");
  assert.equal(ticketModel("```html <!--\nexample\n```\nModel: sonnet", labels).status, "resolved");
  assert.equal(ticketModel("~~~html <!--\nexample\n~~~\nModel: sonnet", labels).status, "resolved");
  assert.equal(ticketModel("Model: unknown", labels).status, "unsupported");
  assert.equal(ticketModel("Model:", labels).status, "unsupported");
  assert.equal(ticketModel("Model: sonnet\nModel: opus", labels).status, "conflicting");
  assert.equal(ticketModel("Model: openai/gpt-6.1-sol", labels).status, "unsupported");
  assert.equal(ticketModel("", {}).status, "missing", "no fixed fallback even with no aliases");
  assert.notEqual(ticketModel("Model: sonnet", labels).revision, ticketModel("Model: sonnet\nEdited requirement", labels).revision);
});

test("only the approved models may be configured", () => {
  assert.equal(disallowedModels(labels, [SONNET, OPUS]), undefined);
  assert.match(disallowedModels(labels, [OPUS, "openai/gpt-5.5"]) ?? "", /gpt-5\.5/);
  assert.equal(disallowedModels({}, ["anything"]), undefined);
});

test("personal reference config: aliases, verifier and analysis models, provider", () => {
  assert.equal(PERSONAL_AGENT.modelAliases["Sonnet 5.5"], SONNET);
  assert.equal(PERSONAL_AGENT.modelAliases["Opus 5.5"], OPUS);
  assert.equal(PERSONAL_AGENT.model, OPUS);
  assert.equal(PERSONAL_GRAPH.model, SONNET);
  assert.equal(PERSONAL_AGENT.provider, "pi");
  assert.equal(disallowedModels(PERSONAL_AGENT.modelAliases, [PERSONAL_AGENT.model, PERSONAL_GRAPH.model]), undefined);
  assert.match(disallowedModels(PERSONAL_AGENT.modelAliases, ["openai/gpt-6.1-sol", PERSONAL_GRAPH.model]) ?? "", /gpt-6\.1-sol/, "a stray fixed model is rejected");
});

test("client reference config keeps Claude Code, fixed verifier and explicit aliases", () => {
  assert.equal(CLIENT_AGENT.provider, "claude");
  assert.equal(CLIENT_AGENT.modelAliases.opus, CLIENT_AGENT.model);
});

test("container env: subscription models need no OpenAI credential; openai models still mint one", () => {
  const mint = () => {
    throw new Error("must not ask for an OpenAI credential");
  };
  assert.deepEqual(piEnvFor(SONNET, mint), {});
  assert.deepEqual(piEnvFor(OPUS, mint), {});
  assert.deepEqual(piEnvFor("openai/gpt-6.1-sol", () => "tok"), { OPENAI_API_KEY: "tok" });
});

test("host analysis loads only the provider extension, explicitly", () => {
  const env = { HOME: "/h" };
  const args = piAnalysisArgs(SONNET, env, () => true);
  assert.ok(args.includes("--no-extensions"));
  assert.deepEqual(args.slice(args.indexOf("-e")), ["-e", "/h/.pi/agent/extensions/pi-claude-subscription/index.ts"]);
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", SONNET]);
  assert.equal(piAnalysisArgs(SONNET, { HOME: "/h", FACTORY_PI_SUBSCRIPTION_EXTENSION: "/x/index.ts" }, () => true).at(-1), "/x/index.ts");
  assert.throws(() => piAnalysisArgs(SONNET, env, () => false), /extension not found/);
  assert.ok(!piAnalysisArgs("openai/gpt-6.1-sol", env, () => false).includes("-e"));
});

test("subscription preflight checks claude and the provider, never OpenAI or a credential", () => {
  const calls: string[] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd === "claude") return '{ "loggedIn": true }';
    return "provider model\npi-claude-subscription claude-sonnet-5-5\npi-claude-subscription claude-opus-5-5\n";
  };
  const base = { models: [SONNET, OPUS, OPUS], env: { HOME: "/h" }, exists: () => true };
  assert.deepEqual(subscriptionPreflight({ ...base, run }), []);
  assert.ok(calls.every((c) => !/openai|token|api-key/i.test(c)), calls.join("\n"));
  assert.deepEqual(subscriptionPreflight({ ...base, models: ["openai/gpt-6.1-sol"], run: () => { throw new Error("unused"); } }), []);
  assert.match(subscriptionPreflight({ ...base, exists: () => false, run })[0], /extension not found/);
  const loggedOut = (cmd: string, args: string[]) => (cmd === "claude" ? '{ "loggedIn": false }' : run(cmd, args));
  assert.match(subscriptionPreflight({ ...base, run: loggedOut }).join("\n"), /claude auth login/);
  const noOpus = (cmd: string, args: string[]) => (cmd === "claude" ? run(cmd, args) : "pi-claude-subscription claude-sonnet-5-5");
  assert.match(subscriptionPreflight({ ...base, run: noOpus }).join("\n"), /claude-opus-5-5/);
});
