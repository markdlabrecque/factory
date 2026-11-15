// #153: optional exact-head delivery fixtures permit only SHA-guarded merge, never creation or evidence posts.
// #149: text views and sanitized dependency-error scenarios cover normal blocked entrypoints.
// Read-only gh/glab boundary for #78 refresh/dispatch and #122 open-MR conflict tests.
// All data and exact call logs are fixture-owned. #135: write large capped-selection responses synchronously
// so process.exit cannot truncate JSON still buffered on stdout.
// Reject every mutation and unexpected command, including label creation, comments, issue closes and PR creation.
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from 'node:child_process';
import { join } from "node:path";
const args = process.argv.slice(2), dir = process.env.FAKE_STATE;
appendFileSync(join(dir, "tracker.jsonl"), JSON.stringify(args) + "\n");
const data = JSON.parse(readFileSync(join(dir, "tracker.json"), "utf8"));
const out = (v) => { writeFileSync(1, JSON.stringify(v)); process.exit(0); };
const fail = (s) => { process.stderr.write(s); process.exit(2); };
const isGh = process.env.FAKE_TRACKER === "github";
const ghTicket = (t) => ({ number: t.iid, title: t.title, body: t.description, state: t.state.toUpperCase(), labels: t.labels.map((name) => ({ name })), assignees: [] });
const ticket = (id) => {
  if ((data.errors ?? []).includes(Number(id))) fail(data.errorMessage ?? "tracker auth/network error");
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
if (args[0] === "issue" && args[1] === "view" && !args.includes("--json")) out(ticket(args[2]).description);
if (isGh && args[0] === "issue" && args[1] === "view" && args.includes("--json")) out(ghTicket(ticket(args[2])));
if (isGh && args[0] === "pr" && args[1] === "list") {
  if (args.includes("merged") && (data.mergeErrors ?? []).includes(args[args.indexOf("--head") + 1])) fail("merge lookup transport failure");
  if (args.includes("open")) out((data.openBranches ?? []).map((headRefName) => ({ headRefName })));
  out(args.includes("merged") && (data.merged ?? []).includes(args[args.indexOf("--head") + 1]) ? [{ number: 1 }] : []);
}
if (args[0] === "api" && args[1] === "graphql") {
  const q = args.find((a) => a.startsWith("query="));
  if (isGh) {
    const repository = {};
    const single = /issue\(number: (\d+)\)/.exec(q);
    if (single) repository.issue = {parent:data.parents?.[single[1]] ? {number:data.parents[single[1]]} : null};
    for (const m of q.matchAll(/i(\d+): issue/g)) repository[`i${m[1]}`] = { parent: data.parents?.[m[1]] ? { number: data.parents[m[1]] } : null, subIssues: { nodes: [] } };
    out({ data: { repository } });
  }
  const ids = [...q.matchAll(/"(\d+)"/g)].map((m) => m[1]);
  out({ data: { project: { workItems: { nodes: ids.map((id) => ({ iid: id, workItemType: { name: data.parents?.[id] ? "Task" : "Issue" },
    widgets: [{ parent: data.parents?.[id] ? { iid: String(data.parents[id]) } : null, children: { nodes: [] } }] })) } } } });
}
if (isGh && data.delivery && args[0] === 'api') {
  const d = data.delivery, path = args.find(a => a.startsWith('repos/'));
  if (path === 'repos/owner/repo/pulls/1') out({ number:1, state:'open', draft:false, merged:!!d.merged, merged_at:d.merged?'2026-01-01T00:00:00Z':null, mergeable:true, mergeable_state:'clean', head:{ref:'7-topic',sha:d.sha,repo:{full_name:'owner/repo'}},base:{ref:'main',repo:{full_name:'owner/repo'}} });
  if (path === `repos/owner/repo/commits/${d.sha}/check-runs?per_page=100`) out([{check_runs:[{name:'ci',head_sha:d.sha,status:d.pending?'in_progress':'completed',conclusion:d.pending?null:'success'}]}]);
  if (path === `repos/owner/repo/commits/${d.sha}/statuses?per_page=100`) out([[]]);
  if (path === 'repos/owner/repo/pulls/1/merge' && args.includes('PUT') && args.includes(`sha=${d.sha}`)) {
    data.delivery.merged=true; writeFileSync(join(dir,'tracker.json'),JSON.stringify(data)); out({merged:true});
  }
}
// Bounded structured context pages retain stable source IDs and authors in synthetic notes.
if (args[0] === 'api' && !args.includes('--paginate')) {
  const match = /^(?:repos\/owner\/repo|projects\/1)\/issues\/(\d+)(?:\/(comments|notes)\?)?/.exec(args[1]);
  if (match) {
    if ((data.contextErrors ?? []).includes(Number(match[1]))) fail('structured context read unavailable');
    if (data.workspaceRace && Number(match[1]) === 7 && !match[2]) {
      const counter = join(dir, 'context-reads'), count = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) + 1 : 1;
      writeFileSync(counter, String(count));
      if (count === 2) execFileSync('git', ['branch', '7-ticket-7'], { stdio: 'pipe' });
    }
    const t = ticket(match[1]);
    if (!match[2]) out(isGh ? ghTicket(t) : t);
    out((data.notes?.[match[1]] ?? []).map((n,i) => ({id:i+1,system:false,...n,user:{login:'human'},author:{username:'human'},created_at:'2026-01-01',updated_at:'2026-01-01'})));
  }
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
    if (q.get("state") === "merged" && (data.mergeErrors ?? []).includes(q.get("source_branch"))) fail("merge lookup transport failure");
    if (q.get("state") === "opened") out((data.openBranches ?? []).map((source_branch) => ({ source_branch })));
    out(q.get("state") === "merged" && (data.merged ?? []).includes(q.get("source_branch")) ? [{ iid: 1 }] : []);
  }
}
fail(`unexpected tracker call: ${args.join(" ")}`);
