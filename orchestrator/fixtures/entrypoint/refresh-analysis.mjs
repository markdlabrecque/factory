// Read-only analyst boundary for #78. Assert production tool restrictions and return a dependency named DEP:N in
// requirements, human comments or parent context. A bounded fixture delay exposes pending analysis to HTTP polling.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2), input = readFileSync(0, "utf8"), dir = process.env.FAKE_STATE;
appendFileSync(join(dir, "analysis.jsonl"), JSON.stringify({ args, input }) + "\n");
if (!args.includes("read,grep,find,ls") && !args.includes("Read,Grep,Glob")) throw new Error("unsafe analysis tools");
if (process.env.FAKE_ANALYSIS_DELAY) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ANALYSIS_DELAY)));
const source = input.split("## Ticket")[1]?.split("## Other open tickets")[0] ?? "";
const ids = [...source.matchAll(/DEP:(\d+)/g)].map((m) => Number(m[1]));
const result = { provides: [], requires: [...new Set(ids)].map((providedBy) => ({ providedBy, what: "requirement", evidence: "fixture requirement", confidence: 1 })), footprint: [] };
process.stdout.write(JSON.stringify(process.env.FAKE_TRACKER === "github" ? result : { structured_output: result }));
