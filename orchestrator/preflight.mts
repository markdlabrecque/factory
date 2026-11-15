// Validate explicit project/runtime context before subscription preflight. Fixed family models never fall back.
// Hold this process's selected runtime while checking the explicitly loaded provider; never print credentials.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { context, AGENT, GRAPH } from "./runtime-config.mts";
import { retainRuntime } from './context.mts';
import { subscriptionPreflight } from "./models.mts";

await retainRuntime(context);
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 });
const problems = subscriptionPreflight({
  models: [...Object.values(AGENT.modelAliases), AGENT.model, GRAPH.model],
  env: process.env,
  run,
  exists: existsSync,
});
for (const p of problems) console.error(`preflight: ${p}`);
process.exitCode = problems.length ? 1 : 0;
