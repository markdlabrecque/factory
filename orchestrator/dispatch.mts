import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readRuns, TERMINAL } from "./board.mts";

// Dispatcher: list the tickets that qualify, then start one detached main.mts run per ticket
// (up to a cap on concurrent runs). Meant to be fired by sandcastle-dispatch.timer.
//   node .sandcastle/dispatch.mts --base sal-develop [--max 3] [--dry-run]
// Never starts a ticket that already has a run record on the board (any stage, including stopped),
// so a failed run is not retried every pass. Delete its file in the state dir to retry it.

// ---- Selection config: which tickets get a run ----------------------------------------
// Every option below is optional except gitlabHost and project. Leave one unset (or empty) to skip
// that filter. Filters combine with AND. Each maps to a `glab issue list` flag (shown in brackets).
// Keep gitlabHost and project in step with CONFIG in main.mts.
const SELECT = {
  gitlabHost: "git.affinitybridge.com",
  project: "islandhealth/public-site", // path with namespace [-R]

  // -- Labels --
  // Ticket must carry ALL of these [--label]. Example: ["Ready to do", "ready-for-agent"]
  labels: ["Ready to do", "ready-for-agent"],
  // Ticket must carry NONE of these [--not-label]. Example: ["blocked", "needs-human", "wontfix"]
  excludeLabels: ["blocked", "needs-human", "wontfix"],

  // -- People --
  // Only tickets assigned to this username [--assignee]. "@me" means whoever glab is logged in as.
  // Examples: "mark" | "@me" | undefined (any assignee, including unassigned)
  assignee: undefined as string | undefined,
  // Skip tickets assigned to any of these usernames. Applied after the list comes back, so it also
  // catches multi-assignee tickets. Example: ["alice", "bob"]
  excludeAssignees: [] as string[],
  // Only tickets opened by this username [--author]. Example: "mark"
  author: undefined as string | undefined,

  // -- Scope --
  // Only tickets in this milestone [--milestone]. Example: "Sprint 12" | "v2.0"
  milestone: undefined as string | undefined,
  // Ticket type [--issue-type]: "issue" | "incident" | "test_case" | undefined (all types)
  issueType: "issue" as string | undefined,
  // true = only confidential tickets [--confidential]; undefined = both. (There is no "exclude" form.)
  confidential: undefined as boolean | undefined,
  // Free-text match in title and description [--search]. Example: "language switcher"
  search: undefined as string | undefined,

  // -- Order: which tickets are tried first when more qualify than there is room for --
  // [--order] created_at | updated_at | priority | due_date | relative_position | label_priority
  //           | milestone_due | popularity | weight
  order: "created_at",
  // [--sort] "asc" (oldest/lowest first) | "desc"
  sort: "asc",

  // -- Throughput --
  // Cap on runs in flight at once, counted from the board across ALL projects sharing the state
  // dir. A pass starts at most (cap - in flight). Overridden by --max.
  maxConcurrent: 3,
  // Pause between launches within one pass, so runs don't race on git fetch / docker start.
  staggerSeconds: 20,
};

const { values: opts } = parseArgs({
  options: {
    base: { type: "string" },
    max: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!opts.base) {
  console.error("--base <integration branch> is required");
  process.exit(1);
}
const cap = Number(opts.max ?? SELECT.maxConcurrent);
const here = dirname(fileURLToPath(import.meta.url));
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

// ---- capacity ----------------------------------------------------------------
const runs = readRuns();
const active = runs.filter((r) => !TERMINAL.includes(r.stage)).length;
const room = cap - active;
log(`${active} active run(s), cap ${cap}`);
if (room <= 0) process.exit(0);

// ---- candidates --------------------------------------------------------------
const args = ["issue", "list", "-R", SELECT.project, "--opened", "--per-page", "100", "--output", "json", "--order", SELECT.order, "--sort", SELECT.sort];
if (SELECT.labels.length) args.push("--label", SELECT.labels.join(","));
if (SELECT.excludeLabels.length) args.push("--not-label", SELECT.excludeLabels.join(","));
if (SELECT.assignee) args.push("--assignee", SELECT.assignee);
if (SELECT.author) args.push("--author", SELECT.author);
if (SELECT.milestone) args.push("--milestone", SELECT.milestone);
if (SELECT.issueType) args.push("--issue-type", SELECT.issueType);
if (SELECT.confidential) args.push("--confidential");
if (SELECT.search) args.push("--search", SELECT.search);
const issues: { iid: number; title: string; assignees?: { username: string }[] }[] = JSON.parse(sh("glab", args));

sh("git", ["fetch", "origin", "--prune"]);
const branches = new Set(
  sh("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"]).split("\n").map((b) => b.replace(/^origin\//, "")),
);
const seen = new Set(runs.filter((r) => r.project === SELECT.project).map((r) => String(r.iid)));

const eligible = issues.filter((i) => {
  const iid = String(i.iid);
  if (seen.has(iid)) return false; // already has a run record
  if ([...branches].some((b) => b.startsWith(`${iid}-`))) return false; // already has a branch
  if (SELECT.excludeAssignees.length && i.assignees?.some((a) => SELECT.excludeAssignees.includes(a.username))) return false;
  return true;
});
log(`${issues.length} match the filters, ${eligible.length} not yet started; launching up to ${room}`);

// ---- launch ------------------------------------------------------------------
const npx = resolve(dirname(process.execPath), "npx");
const logDir = resolve(here, "logs");
mkdirSync(logDir, { recursive: true });
const batch = eligible.slice(0, room);
for (const [n, i] of batch.entries()) {
  const iid = String(i.iid);
  log(`#${iid} ${i.title}${opts["dry-run"] ? " (dry run)" : ""}`);
  if (opts["dry-run"]) continue;
  const out = openSync(resolve(logDir, `run-${iid}.log`), "a");
  const child = spawn(existsSync(npx) ? npx : "npx", ["tsx", resolve(here, "main.mts"), "--base", opts.base, "--issue", iid], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  if (n < batch.length - 1) await new Promise((r) => setTimeout(r, SELECT.staggerSeconds * 1000));
}
