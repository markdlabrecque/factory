// Test-only `gh` for the recovery entrypoint smoke test (#74). Answers exactly the calls main.mts --recover and the
// GitHub tracker adapter fixture for one open ticket (#7, description model), records every call to
// $FAKE_STATE/gh.jsonl (with stdin for comments and PR bodies), and exits 2 on anything else.
// $FAKE_MERGED_PR (a JSON PR) is the answer to merged-PR lookups (#87); label writes (tracker.advance) succeed.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const state = process.env.FAKE_STATE;
const stdin = args.includes("--body-file") ? readFileSync(0, "utf8") : undefined;
appendFileSync(join(state, "gh.jsonl"), JSON.stringify({ args, stdin }) + "\n");
const ticket = { number: 7, title: "Fix login", body: process.env.FAKE_TICKET_BODY ?? "**Model:** Sonnet 5.5\n\nThe login form must work.", state: "OPEN", labels: [{ name: "model:sonnet" }] };
const out = (v) => { process.stdout.write(typeof v === "string" ? v : JSON.stringify(v)); process.exit(0); };
const [a, b] = args;
if (a === "label" && b === "list") out(["ready-for-agent", "blocked", "needs-human", "wontfix", "merged", "model:sonnet", "model:opus"].map((name) => ({ name })));
if (a === "issue" && b === "list") out([ticket]);
if (a === "issue" && b === "view" && args.includes("--json")) out(ticket);
if (a === "issue" && b === "view" && args.includes("--comments")) out(`title:\t${ticket.title}\n--\n${ticket.body}\n`);
if (a === "issue" && b === "comment") out("");
if (a === "api" && b === "graphql") {
  const q = args.find((x) => x.startsWith("query="));
  const repo = {};
  for (const m of q.matchAll(/i(\d+): issue/g)) repo[`i${m[1]}`] = { parent: null, subIssues: { nodes: [] } };
  out({ data: { repository: repo } });
}
if (a === "api" && args.includes("--paginate")) out([[]]);
if (a === "pr" && b === "list" && args.includes("merged") && process.env.FAKE_MERGED_PR) out([JSON.parse(process.env.FAKE_MERGED_PR)]);
if (a === "pr" && b === "list") out([]);
if (a === "api" && b === "-X" && /\/issues\/\d+\/labels/.test(args[3] ?? "")) out("[]");
if (a === "pr" && b === "create") out("https://github.com/owner/repo/pull/9\n");
if (a === "pr" && b === "checks") out([{ name: "ci", bucket: "pass" }]);
if (a === "pr" && b === "merge") out("");
process.stderr.write(`fake gh: unexpected call: ${args.join(" ")}\n`);
process.exit(2);
