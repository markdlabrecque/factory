import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { analyse, analysisWorktree } from "./analyze.mts";
import { PARKED, readRuns, removeRun, setProject, setStage, TERMINAL } from "./board.mts";
import type { BoardRun } from "./board.mts";
import { allLabels, GRAPH, LABELS, TRACKER } from "./config.mts";
import { contentHash, decide, edgesOf, staleReason } from "./graph.mts";
import type { Note } from "./graph.mts";
import { readManifests, removeManifest, writeManifest } from "./manifests.mts";
import * as tracker from "./tracker.mts";
import type { Ticket } from "./tracker.mts";

// Dispatcher: list the tickets that qualify, update the ticket graph, then start one detached
// main.mts run per ticket that is free to go (up to a cap on concurrent runs). Meant to be fired by
// sandcastle-dispatch.timer.
//   node .sandcastle/dispatch.mts --base sal-develop [--max 3] [--dry-run]
// A ticket is free to go when its manifest is current, every ticket it depends on is merged into the
// base or closed, and its files don't overlap a live run (in flight, or MR still open).
// Tickets that aren't free get a "queued" card on the board saying why. A ticket whose run failed
// is not retried every pass: delete its file in the state dir to retry it.

// ---- Selection config: which tickets get a run ----------------------------------------
// Project, milestone and labels live in config.mts. Every option below is optional; leave one unset
// (or empty) to skip that filter. Filters combine with AND. Each maps to a `glab issue list` flag.
const SELECT = {
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
const base = opts.base;
const dry = opts["dry-run"];
const PROJECT = TRACKER.project;
const cap = Number(opts.max ?? SELECT.maxConcurrent);
const here = dirname(fileURLToPath(import.meta.url));
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

await tracker.ensureLabels(allLabels());
setProject(PROJECT);

// ---- capacity ----------------------------------------------------------------
const allRuns = readRuns();
const running = (r: BoardRun) => !TERMINAL.includes(r.stage) && !PARKED.includes(r.stage);
const active = allRuns.filter(running).length;
const room = Math.max(0, cap - active);
log(`${active} active run(s), cap ${cap}`);

// ---- candidates --------------------------------------------------------------
const args = ["issue", "list", "-R", PROJECT, "--opened", "--per-page", "100", "--output", "json", "--order", SELECT.order, "--sort", SELECT.sort];
if (LABELS.ready.length) args.push("--label", LABELS.ready.join(","));
if (LABELS.exclude.length) args.push("--not-label", LABELS.exclude.join(","));
if (TRACKER.milestone) args.push("--milestone", TRACKER.milestone);
if (SELECT.assignee) args.push("--assignee", SELECT.assignee);
if (SELECT.author) args.push("--author", SELECT.author);
if (SELECT.issueType) args.push("--issue-type", SELECT.issueType);
if (SELECT.confidential) args.push("--confidential");
if (SELECT.search) args.push("--search", SELECT.search);
const issues: (Ticket & { assignees?: { username: string }[] })[] = JSON.parse(sh("glab", args));

sh("git", ["fetch", "origin", "--prune"]);
const branches = new Set(
  sh("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"]).split("\n").map((b) => b.replace(/^origin\//, "")),
);
const runs = allRuns.filter((r) => r.project === PROJECT);
const runOf = new Map(runs.map((r) => [Number(r.iid), r]));

const candidates = issues.filter((i) => {
  const r = runOf.get(i.iid);
  if (r && !PARKED.includes(r.stage)) return false; // has a run record that isn't parked
  if ([...branches].some((b) => b.startsWith(`${i.iid}-`))) return false; // already has a branch
  if (SELECT.excludeAssignees.length && i.assignees?.some((a) => SELECT.excludeAssignees.includes(a.username))) return false;
  return true;
});
log(`${issues.length} match the filters, ${candidates.length} not yet started`);

// ---- ticket graph ------------------------------------------------------------
const openMrs = tracker.openMrBranches();
const live = runs.filter((r) => running(r) || (r.stage === "done" && !!r.branch && openMrs.has(r.branch)));
const catalogue = tracker.catalogue();
const catalogueById = new Map(catalogue.map((t) => [t.iid, t]));
const catalogueHash = new Map(catalogue.map((t) => [t.iid, contentHash({ title: t.title, description: t.description })]));
const manifests = readManifests(PROJECT);

// Tickets whose manifest must be current: candidates, plus live runs still on a predicted footprint.
const tracked: Ticket[] = [
  ...candidates,
  ...live.filter((r) => !manifests.get(Number(r.iid))?.actualFootprint).map((r) => catalogueById.get(Number(r.iid))).filter((t): t is Ticket => !!t),
];
const notesOf = new Map<number, Note[]>();
const hashOf = new Map<number, string>();
for (const t of tracked) {
  const n = tracker.notes(t.iid);
  notesOf.set(t.iid, n);
  hashOf.set(t.iid, contentHash({ title: t.title, description: t.description, notes: n }));
}

const stale = tracked
  .map((t) => ({ t, why: staleReason(manifests.get(t.iid), hashOf.get(t.iid)!, catalogueHash) }))
  .filter((s): s is { t: Ticket; why: string } => !!s.why);
const batch = stale.slice(0, GRAPH.maxAnalysesPerPass);
if (stale.length) log(`${stale.length} ticket(s) need analysis; analysing ${batch.length} this pass`);
if (batch.length) {
  const worktree = analysisWorktree(PROJECT, base);
  for (const { t, why } of batch) {
    log(`analysing #${t.iid} (${why})`);
    const prev = manifests.get(t.iid);
    try {
      const m = analyse({
        project: PROJECT, base, worktree, ticket: t, notes: notesOf.get(t.iid)!, catalogue, manifests,
        // A person editing the ticket is how a wrong implementer-reported blocker gets corrected.
        keepImplementerBlockers: !prev?.analyzedAt || why !== "ticket changed",
      });
      writeManifest(m);
      manifests.set(t.iid, m);
      const deps = edgesOf(m).map((e) => `#${e.from}`);
      log(`  depends on ${deps.join(", ") || "nothing"}; footprint ${m.footprint.length} path(s)`);
    } catch (e) {
      log(`  ${(e as Error).message}`);
    }
  }
}

// A blocker is satisfied when its ticket is closed, or its Sandcastle branch is merged into its base.
const satisfiedCache = new Map<number, boolean>();
const satisfied = (iid: number): boolean => {
  if (!satisfiedCache.has(iid)) {
    let ok = false;
    try {
      ok = !catalogueById.has(iid) && tracker.ticket(iid).state === "closed";
    } catch {
      ok = true; // ticket doesn't exist: nothing to wait for; the implementer reports it if it matters
    }
    const r = runOf.get(iid);
    if (!ok && r?.branch) ok = tracker.mergedInto(r.branch, r.base ?? base);
    satisfiedCache.set(iid, ok);
  }
  return satisfiedCache.get(iid)!;
};

const { decisions, dropped } = decide({
  candidates: candidates.map((c) => ({ iid: c.iid, hash: hashOf.get(c.iid)! })),
  manifests,
  satisfied,
  queue: new Set([...candidates.map((c) => c.iid), ...runs.filter((r) => r.stage !== "stopped").map((r) => Number(r.iid))]),
  live: live.map((r) => {
    const m = manifests.get(Number(r.iid));
    return { iid: Number(r.iid), footprint: m?.actualFootprint ?? m?.footprint ?? [] };
  }),
  room,
  ignore: GRAPH.conflictIgnore,
});
for (const e of dropped) log(`cycle: ignoring "#${e.to} depends on #${e.from}" (${e.what}, confidence ${e.confidence})`);

// ---- board -------------------------------------------------------------------
const byIid = new Map(candidates.map((c) => [c.iid, c]));
for (const d of decisions) {
  const c = byIid.get(d.iid)!;
  log(`#${d.iid} ${c.title}: ${d.launch ? (dry ? "would launch (dry run)" : "launching") : d.reason}`);
  if (dry || d.launch) continue;
  const stage = runOf.get(d.iid)?.stage === "waiting" ? "waiting" : "queued";
  setStage(String(d.iid), { stage, title: c.title, ticketUrl: `https://${TRACKER.gitlabHost}/${PROJECT}/-/issues/${d.iid}`, base, note: d.reason });
}
if (!dry) {
  // Parked cards for tickets that left the queue (label removed, closed, out of the milestone).
  for (const r of runs) if (PARKED.includes(r.stage) && !byIid.has(Number(r.iid))) removeRun(r.iid);
  // Manifests of tickets that are gone, once they're old enough not to explain anything.
  const cutoff = Date.now() - GRAPH.pruneAfterDays * 86_400_000;
  const liveIids = new Set(live.map((r) => Number(r.iid)));
  for (const m of manifests.values()) {
    if (!catalogueById.has(m.iid) && !liveIids.has(m.iid) && Date.parse(m.analyzedAt || "1970-01-01") < cutoff) removeManifest(PROJECT, m.iid);
  }
}

// ---- launch ------------------------------------------------------------------
const launch = decisions.filter((d) => d.launch);
if (dry || !launch.length) process.exit(0);
const npx = resolve(dirname(process.execPath), "npx");
const logDir = resolve(here, "logs");
mkdirSync(logDir, { recursive: true });
for (const [n, d] of launch.entries()) {
  const iid = String(d.iid);
  const out = openSync(resolve(logDir, `run-${iid}.log`), "a");
  const child = spawn(existsSync(npx) ? npx : "npx", ["tsx", resolve(here, "main.mts"), "--base", base, "--issue", iid], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  if (n < launch.length - 1) await new Promise((r) => setTimeout(r, SELECT.staggerSeconds * 1000));
}
