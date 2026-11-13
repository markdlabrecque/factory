// Read-only gh/glab boundary for #78 refresh/dispatch tests. All data and exact call logs are fixture-owned.
// Reject every mutation and unexpected command, including label creation, comments, issue closes and PR creation.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2), dir = process.env.FAKE_STATE;
appendFileSync(join(dir, "tracker.jsonl"), JSON.stringify(args) + "\n");
const data = JSON.parse(readFileSync(join(dir, "tracker.json"), "utf8"));
const out = (v) => { process.stdout.write(JSON.stringify(v)); process.exit(0); };
const fail = (s) => { process.stderr.write(s); process.exit(2); };
const isGh = process.env.FAKE_TRACKER === "github";
const ghTicket = (t) => ({ number: t.iid, title: t.title, body: t.description, state: t.state.toUpperCase(), labels: t.labels.map((name) => ({ name })), assignees: [] });
const ticket = (id) => {
  if ((data.errors ?? []).includes(Number(id))) fail("tracker auth/network error");
  const t = data.tickets.find((t) => t.iid === Number(id));
  if (!t) fail("ticket missing");
  return t;
};
const catalogue = data.tickets.filter((t) => t.state !== "closed" && !t.contextOnly);
if (args[0] === "label" && args[1] === "list") out(["ready-for-agent", "Ready to do", "blocked", "needs-human", "wontfix", "merged", "model:sonnet", "model:opus"].map((name) => ({ name })));
if (args[0] === "issue" && args[1] === "list") {
  const ready = data.ready.map(ticket);
  out(isGh ? (args.includes("--search") ? ready : catalogue).map(ghTicket) : ready);
}
if (isGh && args[0] === "issue" && args[1] === "view" && args.includes("--json")) out(ghTicket(ticket(args[2])));
if (isGh && args[0] === "pr" && args[1] === "list") {
  out(args.includes("merged") && (data.merged ?? []).includes(args[args.indexOf("--head") + 1]) ? [{ number: 1 }] : []);
}
if (args[0] === "api" && args[1] === "graphql") {
  const q = args.find((a) => a.startsWith("query="));
  if (isGh) {
    const repository = {};
    for (const m of q.matchAll(/i(\d+): issue/g)) repository[`i${m[1]}`] = { parent: data.parents?.[m[1]] ? { number: data.parents[m[1]] } : null, subIssues: { nodes: [] } };
    out({ data: { repository } });
  }
  const ids = [...q.matchAll(/"(\d+)"/g)].map((m) => m[1]);
  out({ data: { project: { workItems: { nodes: ids.map((id) => ({ iid: id, workItemType: { name: data.parents?.[id] ? "Task" : "Issue" },
    widgets: [{ parent: data.parents?.[id] ? { iid: String(data.parents[id]) } : null, children: { nodes: [] } }] })) } } } });
}
if (isGh && args[0] === "api" && args.includes("--paginate")) {
  const path = args.find((a) => a.startsWith("repos/")), id = path.match(/issues\/(\d+)/)[1];
  out([data.notes?.[id] ?? []]);
}
if (!isGh && args[0] === "api") {
  const path = args[1];
  if (/\/labels\?/.test(path)) out(["Ready to do", "ready-for-agent", "blocked", "needs-human", "wontfix", "merged", "Internal QA"].map((name) => ({ name })));
  if (/\/issues\?/.test(path)) out(catalogue);
  const n = /\/issues\/(\d+)(\/notes)?/.exec(path);
  if (n) out(n[2] ? data.notes?.[n[1]] ?? [] : ticket(n[1]));
  if (/\/merge_requests\?/.test(path)) {
    const q = new URLSearchParams(path.split("?")[1]);
    out(q.get("state") === "merged" && (data.merged ?? []).includes(q.get("source_branch")) ? [{ iid: 1 }] : []);
  }
}
fail(`unexpected tracker call: ${args.join(" ")}`);
