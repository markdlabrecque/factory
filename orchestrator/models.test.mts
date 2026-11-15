// Legacy declarations fail closed; v2 profiles derive Factory-owned model tiers and provider wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyTestRuntime } from '../cli/test/config-fixture.mts';
import { MODEL_POLICY } from './model-policy.mts';
import { disallowedModels, piAnalysisArgs, piEnvFor, subscriptionPreflight, resolveTicketModel } from "./models.mts";

// Run: node --test 'orchestrator/*.test.mts'

const SONNET = "pi-claude-subscription/claude-sonnet-5-5";
const OPUS = "pi-claude-subscription/claude-opus-5-5";
const labels = { sonnet: SONNET, opus: OPUS, "Sonnet 5.5": SONNET };

test("legacy ticket model fields fail closed; examples and prose stay excluded", () => {
  for (const body of ["**Model:** Sonnet 5.5", "Model: SONNET", "**Pi model:** `sonnet`", `**Model**: ${SONNET}`, "Model: sonnet\r\nPi model: Sonnet 5.5"]) {
    const m = resolveTicketModel(body, 'anthropic');
    assert.equal(m.status, "unsupported", body);
    assert.match(m.revision, /^[a-f0-9]{64}$/);
    assert.equal(m.choice, undefined, 'legacy model declarations cannot select a policy model');
  }
  for (const body of ["Use Sonnet 5.5", "Labels: model:sonnet", "> Model: opus", "    Model: opus", "```md\nModel: opus\n```", "~~~\nModel: opus\n~~~", "<!--\nModel: opus\n-->", "<!-- Model: opus -->"]) {
    const resolution = resolveTicketModel(body, 'anthropic');
    assert.equal(resolution.status, 'resolved', body);
    assert.equal(resolution.model, SONNET, body);
    assert.equal(resolution.choice?.tier, 'mid', body);
  }
  assert.equal(resolveTicketModel("```md\n``` example, not a closing fence\nModel: opus\n```", 'anthropic').status, 'resolved');
  for (const body of ["```html\n<!--\n```\nModel: opus", "~~~html\n<!--\n~~~\nModel: opus", "```html <!--\nexample\n```\nModel: sonnet", "~~~html <!--\nexample\n~~~\nModel: sonnet", "Model: unknown", "Model:", "Model: sonnet\nModel: opus", "Model: openai/gpt-6.1-sol"]) {
    assert.equal(resolveTicketModel(body, 'anthropic').status, 'unsupported', body);
  }
  assert.equal(resolveTicketModel('', 'anthropic').choice?.source, 'factory-default');
  assert.notEqual(resolveTicketModel('Model tier: mid', 'anthropic').revision, resolveTicketModel('Model tier: mid\nEdited requirement', 'anthropic').revision);
});

test("only the approved models may be configured", () => {
  assert.equal(disallowedModels(labels, [SONNET, OPUS]), undefined);
  assert.match(disallowedModels(labels, [OPUS, "openai/gpt-5.5"]) ?? "", /gpt-5\.5/);
  assert.equal(disallowedModels({}, ["anything"]), undefined);
});

for (const profile of ['personal', 'client']) {
  test(`${profile} v2 runtime derives agent and analysis models for each family`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'factory-models-'));
    try {
      const text = readFileSync(new URL(`./factory.${profile}.toml`, import.meta.url), 'utf8');
      for (const family of ['openai', 'anthropic'] as const) {
        const moduleUrl = copyTestRuntime(join(dir, family), text.replace('family = "openai"', `family = "${family}"`));
        const c = await import(moduleUrl('runtime-config.mts'));
        assert.deepEqual(c.AGENT, { family, provider: 'pi', model: MODEL_POLICY[family].large, thinking: 'high', modelAliases: MODEL_POLICY[family] });
        assert.equal(c.GRAPH.model, MODEL_POLICY[family].mid);
        assert.equal(disallowedModels(c.AGENT.modelAliases, [c.AGENT.model, c.GRAPH.model]), undefined);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

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
  for (const model of [SONNET, 'openai/gpt-6.1-terra']) {
    const fixed = piAnalysisArgs(model, env, () => true);
    assert.deepEqual(fixed.slice(fixed.indexOf('--thinking'), fixed.indexOf('--thinking') + 2), ['--thinking', 'high']);
  }
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
