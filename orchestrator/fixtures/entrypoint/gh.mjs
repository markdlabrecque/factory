// #153: exact-head REST PR/check/merge state is fixture-owned and rejects unexpected calls.
// #149: dependency failure is injected only for the named provider, never the work ticket.
import { execFileSync } from 'node:child_process';
// Test-only `gh` for the recovery entrypoint smoke test (#74). Answers exactly the calls main.mts --recover and the
// GitHub tracker adapter fixture for one open ticket (#7, description model), records every call to
// $FAKE_STATE/gh.jsonl (with stdin for comments and PR bodies), and exits 2 on anything else.
// $FAKE_MERGED_PR (a JSON PR) is the answer to merged-PR lookups (#87); label writes (tracker.advance) succeed.
import { appendFileSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const state = process.env.FAKE_STATE;
const stdin = args.includes("--body-file") ? readFileSync(0, "utf8") : undefined;
appendFileSync(join(state, "gh.jsonl"), JSON.stringify({ args, stdin }) + "\n");
const ticket = { number: 7, title: "Fix login", body: process.env.FAKE_TICKET_BODY ?? "Model tier: mid\n\nThe login form must work.", state: "OPEN", labels: [{ name: "model:sonnet" }] };
// #150: mutate live requirements only at an explicitly signalled fixture boundary.
const changed = existsSync(join(state, 'changed'));
if (changed && process.env.FAKE_MUTATION === 'title') ticket.title += ' edited';
if (changed && process.env.FAKE_MUTATION === 'closed') ticket.state = 'CLOSED';
const out = (v) => { process.stdout.write(typeof v === "string" ? v : JSON.stringify(v)); process.exit(0); };
const [a, b] = args;
if (a === "label" && b === "list") out(["ready-for-agent", "blocked", "needs-human", "wontfix", "merged", "model:sonnet", "model:opus"].map((name) => ({ name })));
if (a === "issue" && b === "list") out([ticket]);
if (a === "issue" && b === "view" && args[2] === "12" && process.env.FAKE_DEPENDENCY_ERROR) {
  process.stderr.write("authentication failed secret-token"); process.exit(2);
}
if (a === "issue" && b === "view" && args.includes("--json")) out(ticket);
if (a === "issue" && b === "view" && args.includes("--comments")) out(`title:\t${ticket.title}\n--\n${ticket.body}\n`);
if (a === "issue" && b === "comment") out("");
if (a === "api" && b === "graphql") {
  const q = args.find((x) => x.startsWith("query="));
  const repo = {};
  const single = /issue\(number: (\d+)\)/.exec(q);
  const contextParent = process.env.FAKE_CONTEXT_PARENT ? {number:Number(process.env.FAKE_CONTEXT_PARENT)} : null;
  if (single) repo.issue = { parent: changed && process.env.SCENARIO === 'parent' ? {number:9} : contextParent };
  for (const m of q.matchAll(/i(\d+): issue/g)) repo[`i${m[1]}`] = { parent: changed && process.env.SCENARIO === 'parent' ? {number:9} : contextParent, subIssues: { nodes: [] } };
  out({ data: { repository: repo } });
}
// Complete context uses bounded REST reads, not human issue views.
if (a === 'api' && /^repos\/(?:owner\/repo|other\/project)\/issues\/\d+$/.test(b)) {
  const number = Number(b.split('/').at(-1));
  out(number === 90 ? {number,title:'Parent specification',body:'Complete parent body with packaging requirements'} : {...ticket,number});
}
if (a === 'api' && /repos\/(?:owner\/repo|other\/project)\/issues\/\d+\/comments\?/.test(b)) {
  if (b.includes('/90/')) {
    if (process.env.SCENARIO === 'parent-read-failed') process.exit(2);
    out([{id:2,body:changed && process.env.SCENARIO === 'parent-plan' ? 'Changed parent plan' : '<details>Agreed parent decisions and implementation plan</details>',user:{login:'human'},created_at:'2026-01-01',updated_at:'2026-01-01'}]);
  }
  out(changed && process.env.SCENARIO === 'comment' ? [{id:1,body:'Human added requirements',user:{login:'human'},created_at:'2026-01-01',updated_at:'2026-01-01'}] : []);
}
const prFile = join(state, 'opened-pr.json');
if (a === 'api' && args.some(x => x === 'repos/owner/repo/pulls/9')) out(JSON.parse(readFileSync(prFile, 'utf8')));
if (a === 'api' && args.some(x => x.endsWith('/check-runs?per_page=100'))) {
  const pr = JSON.parse(readFileSync(prFile, 'utf8'));
  out([{check_runs:[{name:'ci',head_sha:pr.head.sha,status:'completed',conclusion:'success'}]}]);
}
if (a === 'api' && args.includes('repos/owner/repo/pulls/9/merge')) {
  const pr = JSON.parse(readFileSync(prFile, 'utf8'));
  if (!args.includes(`sha=${pr.head.sha}`)) process.exit(9);
  pr.merged = true; pr.merged_at = new Date().toISOString(); writeFileSync(prFile,JSON.stringify(pr)); out({merged:true});
}
if (a === "api" && args.includes("--paginate")) out([[]]);
if (a === "pr" && b === "list" && args.includes("merged") && process.env.FAKE_MERGED_PR) out([JSON.parse(process.env.FAKE_MERGED_PR)]);
if (a === "pr" && b === "list") out([]);
if (a === "api" && b === "-X" && /\/issues\/\d+\/labels/.test(args[3] ?? "")) out("[]");
if (a === 'pr' && b === 'create') {
  const branch = args[args.indexOf('--head')+1], base = args[args.indexOf('--base')+1];
  const sha = execFileSync('git',['rev-parse',`refs/heads/${branch}`],{encoding:'utf8'}).trim();
  writeFileSync(prFile,JSON.stringify({number:9,state:'open',draft:false,merged:false,mergeable:true,mergeable_state:'clean',head:{sha,ref:branch,repo:{full_name:'owner/repo'}},base:{ref:base,repo:{full_name:'owner/repo'}}}));
  out('https://github.com/owner/repo/pull/9\n');
}
if (a === "pr" && b === "checks") out([{ name: "ci", bucket: "pass" }]);
if (a === "pr" && b === "merge") out("");
process.stderr.write(`fake gh: unexpected call: ${args.join(" ")}\n`);
process.exit(2);
