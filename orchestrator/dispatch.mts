// Pinned runtime code launches detached children with independent leases; artifacts stay in the explicit project.
// Only scheduled non-dry passes observe at most ten host CI waits, oldest first, before launches.
import { observeWaitingDelivery, bounded, RetryableDeliveryRead, schedulerAuthorization } from './delivery-followup.mts';
import { validDelivery } from './delivery.mts';
import { readAdmission } from './admission.mts';
// #149: cache full three-state dependency results per pass; unknown reads hold dispatch.
import { dependencyState, type DependencyResult } from "./dependencies.mts";
// #137: TOML completely replaces legacy SELECT; shared selection preserves exhaustive-read semantics.
// #126: description model resolutions are persisted independently of immutable running attempt choices.
import { recordModelResolution } from "./assessment.mts";
import { spawn, execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { analyse, analysisWorktree } from "./analyze.mts";
import { claimDelivery, finishDelivery, claimRun, markMergedOutside, PARKED, queueModelProblem, readRuns, removeRun, reserveRun, setProject, setStage, stateDir, keyFor, TERMINAL } from "./board.mts";
import type { BoardRun } from "./board.mts";
import { context, effectiveConfig, AGENT, allLabels, GRAPH, LABELS, MERGE, SUBTASKS, TRACKER } from "./runtime-config.mts";
import { resolveTicketModel } from "./models.mts";
import { retainRuntime } from './context.mts';
import { contentHash, decide, edgesOf, expandUnits, findJam, staleReason, unitHash } from "./graph.mts";
import type { Note } from "./graph.mts";
import { readManifests, removeManifest, writeManifest } from "./manifests.mts";
import { refreshProject } from "./refresh.mts";
import { selectCandidates, unitEligibility } from "./selection.mts";
import * as tracker from "./tracker.mts";
import type { Ticket } from "./tracker.mts";

// Dispatcher: list the tickets that qualify, update the ticket graph, then start one detached
// main.mts run per ticket that is free to go (up to a cap on concurrent runs). Factory selects
// the complete runtime and launches its dispatcher with an explicit project context.
// A ticket is free to go when its manifest is current, every ticket it depends on is merged into the
// base or closed, and its files don't overlap a live run (in flight, or MR still open).
// Open PRs/MRs reserve footprints even when a blocked auto-merge parks the run as waiting.
// Tickets that aren't free get a "queued" card on the board saying why. A ticket whose run failed
// is not retried every pass: delete its file in the state dir to retry it.
// Each launch is recorded on the board (stage "setup", note "starting", the child's pid) the moment it is spawned,
// so the cap counts it in every later pass, this project's or another's, before main.mts writes its own record.
// Before spawning, each launch is claimed atomically (claimRun in board.mts): the cap is recounted from the board and
// the ticket checked under a shared lock, so a pass running alongside (another project's, a manual one, or a recovery
// attempt) cannot overfill the cap or start the same ticket twice. A refused claim launches nothing. Claims live in the
// admission record (admission.mts, #75): each launch's claim is handed to its child, every normal admission advances the
// project's activity generation, and a project held by a recovery attempt admits nothing.
// With SUBTASKS.enabled (config.mts), a ready issue that has Tasks gets one run per open Task instead.
// Each pass also finishes merged work: a Task whose branch merged into the base is closed, a whole
// ticket moves to LABELS.done, and a parent moves to LABELS.done once all its Tasks are closed.
// Work merged outside Factory (#87): a stopped or parked card (stopped, queued, waiting) whose ticket has a PR/MR merged
// into its base (tracker.mergedPr: from the run's recorded branch, or titled "#N: ...") moves to done with the PR, its
// merge time and "merged outside Factory", keeping its verdict; it is not launched, and its still-open Task is closed or
// ticket moved to LABELS.done as for Factory's own merges. A closed issue alone is never taken as a merge.
// Description tiers resolve through Factory policy; unsupported or conflicting declarations stay queued.
// Existing cards, including deselected parked cards, are retained and reassessed separately (#78, refresh.mts).
// --refresh-only [--ticket <iid>] is the bounded read-only command: with --ticket the board's one-card check, without it
// (#93) every card of this project (up to REFRESH_PER_PASS, oldest assessment first, within GRAPH.maxAnalysesPerPass), for
// projects that are not scheduled. It exits before tracker writes, run-record updates or admission.
// Jam report (slice four self-recovery, #61): when the scheduler's tick sets FACTORY_JAM_REPORT (and FACTORY_PASS_ID),
// a pass that is not a dry run writes there, after the board update and before launching, whether the project is jammed
// (graph.mts findJam: still-ready stopped tickets and the holds behind them, with no run in flight, nothing launched,
// nothing awaiting analysis and a free slot) and, for each jammed or still-ready ticket with a run record, its requirement
// fingerprint (unitHash and labels minus the ones Sandcastle writes). The tick counts it only once the pass exits 0. Manual
// passes are not asked for one. The report changes nothing here; the tick decides what to do with it.

// All filters and launch limits come from validated v2 data. --max overrides only the cap.
const runtimeLease = await retainRuntime(context);
const SELECT = { ...effectiveConfig.selection, ...effectiveConfig.dispatch };

const { values: opts } = parseArgs({
  options: {
    base: { type: "string" },
    max: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "whole-issues": { type: "boolean", default: false }, // one run per ready issue, ignoring Tasks
    "refresh-only": { type: "boolean", default: false },
    ticket: { type: "string" },
  },
});
if (!opts.base && !opts["refresh-only"]) {
  console.error("--base <integration branch> is required");
  process.exit(1);
}
const base = opts.base ?? "main";
const dry = opts["dry-run"];
const subtasks = SUBTASKS.enabled && !opts["whole-issues"];
const PROJECT = TRACKER.project;
const cap = Number(opts.max ?? SELECT.maxConcurrent);
if ((opts.max !== undefined || effectiveConfig) && (!Number.isSafeInteger(cap) || cap <= 0)) throw new Error('--max must be a positive safe integer');
const here = context.runtimeRoot;
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

if (opts["refresh-only"]) {
  if (opts.ticket !== undefined && !/^\d+$/.test(opts.ticket)) throw new Error("--refresh-only takes --ticket <iid> (a number), or no --ticket for the whole project");
  refreshProject({ base, ticket: opts.ticket, subtasks, select: SELECT, log });
  process.exit(0);
}

await tracker.ensureLabels(allLabels());
setProject(PROJECT);

// ---- capacity ----------------------------------------------------------------
const allRuns = readRuns();
const running = (r: BoardRun) => !TERMINAL.includes(r.stage) && !PARKED.includes(r.stage);
const active = allRuns.filter(running).length;
const room = Math.max(0, cap - active);
log(`${active} active run(s), cap ${cap} (source: ${opts.max !== undefined ? '--max' : effectiveConfig ? 'factory.toml dispatch.max_concurrent' : 'legacy SELECT'}); work: ${subtasks ? 'subtasks' : 'issues'} (source: ${opts['whole-issues'] ? '--whole-issues' : effectiveConfig ? 'factory.toml work.units' : 'legacy SUBTASKS'})`);

// ---- merged work -------------------------------------------------------------
// Runs whose MR merged into their base since the last pass: close the Task, or move the ticket on.
const openMrs = tracker.openMrBranches();
for (const r of allRuns) {
  if (r.project !== PROJECT || r.stage !== "done" || !r.branch || r.mergedAt || openMrs.has(r.branch)) continue;
  let checkpoint = r.delivery;
  if (checkpoint) {
    if (!validDelivery(checkpoint)) continue;
    const observed = tracker.observeDelivery(checkpoint);
    if (observed.state !== 'merged' || !observed.mergedAt) continue;
    checkpoint = { ...checkpoint, state: 'merged', reasonCode: 'merged', observedAt: new Date().toISOString(), mergedAt: observed.mergedAt };
  } else if (!tracker.mergedInto(r.branch, r.base ?? base)) continue;
  const what = r.parentIid ? "Task closed" : `moved to ${LABELS.done}`;
  log(`#${r.iid} merged into ${r.base ?? base}: ${dry ? `would be ${what.toLowerCase()} (dry run)` : what}`);
  if (dry) continue;
  if (r.parentIid) tracker.close(Number(r.iid));
  else tracker.advance(Number(r.iid));
  setStage(r.iid, { ...(checkpoint ? { delivery: checkpoint } : {}), mergedAt: checkpoint?.mergedAt ?? new Date().toISOString(), note: `merged; ${what}` });
}

// ---- candidates --------------------------------------------------------------
const ready = tracker.readyList(SELECT);
const parents = selectCandidates(ready, SELECT, tracker.currentUsername);

// Ready issues with Tasks become their open Tasks; an issue whose Tasks are all closed moves on.
const work = tracker.workCatalogue(subtasks);
const { units, advance } = expandUnits(parents.map((p) => p.iid), work.childrenOf, subtasks);
for (const p of advance) {
  log(`#${p}: every Task is closed; ${dry ? `would move to ${LABELS.done} (dry run)` : `moving to ${LABELS.done}`}`);
  if (!dry) tracker.advance(p);
}

// ---- merged outside Factory (#87) ----------------------------------------------
const taskIids = new Set([...work.childrenOf.values()].flat().map((k) => k.iid));
for (const r of allRuns) {
  if (r.project !== PROJECT || r.mergedAt || !(r.stage === "stopped" || PARKED.includes(r.stage))) continue;
  const into = r.base ?? base;
  let pr: (tracker.MergedPr & { checkpoint?: NonNullable<typeof r.delivery> }) | undefined;
  try {
    if (r.delivery) {
      if (!validDelivery(r.delivery) || r.branch && openMrs.has(r.branch)) continue;
      const observed = tracker.observeDelivery(r.delivery);
      if (observed.state !== 'merged' || !observed.mergedAt) continue;
      pr = { number: r.delivery.number, title: r.title ?? '', url: r.delivery.url, mergedAt: observed.mergedAt, matchedBy: 'branch',
        checkpoint: { ...r.delivery, state: 'merged', reasonCode: 'merged', observedAt: new Date().toISOString(), mergedAt: observed.mergedAt } };
    } else pr = tracker.mergedPr(Number(r.iid), r.branch, into);
  } catch (e) {
    log(`#${r.iid}: could not check for a merge outside Factory: ${(e as Error).message}`);
    continue;
  }
  if (!pr) continue;
  log(`#${r.iid} (${r.stage}) merged into ${into} outside Factory by ${pr.url}: ${dry ? "would move to done (dry run)" : "moving to done"}`);
  if (dry) continue;
  if (!markMergedOutside(r.iid, r.stage, pr)) {
    log(`#${r.iid}: left as is; its card changed or a run claimed it meanwhile`);
    continue;
  }
  r.stage = "done"; // this pass must not launch it
  r.mergedAt = pr.mergedAt;
  try {
    if (tracker.ticket(Number(r.iid)).state === "closed") continue;
    if (r.parentIid || taskIids.has(Number(r.iid))) tracker.close(Number(r.iid));
    else tracker.advance(Number(r.iid));
  } catch (e) {
    log(`#${r.iid}: card is done, but the tracker update failed: ${(e as Error).message}`);
  }
}

// Host checkpoints are never adopted by the broad branch/title reconciliation above.
if (!dry && process.env.FACTORY_SCHEDULED === '1' && MERGE.auto) {
  const waits = readRuns().filter(r => r.project === PROJECT && validDelivery(r.delivery) && r.delivery.state === 'ci-waiting')
    .sort((a, b) => a.delivery!.observedAt.localeCompare(b.delivery!.observedAt)).slice(0, 10);
  for (const r of waits) {
    try {
      const message = await observeWaitingDelivery(r, {
        state: stateDir(), workflow: here, inventory: Object.fromEntries(context.manifest.files.map((file: { path: string; sha256: string }) => [file.path, file.sha256])),
        settings: { image: effectiveConfig?.config.image ?? null, model: AGENT.model, thinking: AGENT.thinking ?? null, merge: { auto: MERGE.auto, method: MERGE.method, requiredChecks: MERGE.requiredChecks ?? [] }, ciWaitMinutes: effectiveConfig?.config.ciWaitMinutes ?? null, noPipelineMinutes: effectiveConfig?.config.noPipelineMinutes ?? null, execution: context.identity },
        claim: run => claimDelivery({ iid: run.iid, project: PROJECT, pid: process.pid, cap }),
        finish: (run, token, checkpoint, note) => finishDelivery(stateDir(), PROJECT, run.iid, token, checkpoint, note),
        merge: tracker.mergeExistingDelivery,
        authorize: (run, deadline) => {
          context.assertCurrent();
          tracker.setDeliveryDeadline(deadline);
          const d = run.delivery!;
          if (d.base !== base || bounded('git', ['symbolic-ref', '--short', 'HEAD'], deadline) !== d.base) return 'Current base branch changed';
          const current = readRuns(stateDir(), false).find(x => x.project === PROJECT && x.iid === run.iid);
          const c = readAdmission(stateDir()).claims[keyFor(run.iid, PROJECT)];
          if (current?.claim !== run.claim || current.executionId !== run.executionId || c?.token !== run.claim || c.kind !== 'delivery'
            || current.branch !== run.branch || current.base !== run.base || JSON.stringify(current.delivery) !== JSON.stringify(run.delivery)
            || JSON.stringify(current.verification) !== JSON.stringify(run.verification)) return 'Delivery ownership or checkpoint changed';
          if (bounded('git', ['rev-parse', `refs/heads/${d.branch}`], deadline) !== d.sha || bounded('git', ['ls-remote', '--heads', 'origin', `refs/heads/${d.branch}`], deadline).split(/\s+/)[0] !== d.sha) return 'Local/remote branch changed';
          try {
            const t = tracker.ticket(Number(run.iid));
            if (!['open', 'opened'].includes(t.state ?? '') || (t.labels ?? []).some(l => LABELS.exclude.includes(l) || l === LABELS.needsHuman)) return 'Ticket closed, excluded or needs human review';
            const parent = tracker.parentOf(t.iid);
            if (String(parent ?? '') !== (run.parentIid ?? '')) return 'Ticket parent changed';
            if (parent !== undefined) { const p = tracker.ticket(parent); t.parent = { iid: p.iid, title: p.title, description: p.description }; }
            if (unitHash(t, tracker.notes(t.iid)) !== run.verification?.requirementsHash) return 'Requirements changed; fresh verification or human review required';
            const selected = selectCandidates(tracker.readyList(SELECT), SELECT, tracker.currentUsername);
            if (!selected.some(x => x.iid === (parent ?? t.iid))) return 'Ticket no longer selected';
            return schedulerAuthorization(process.cwd(), d.base, deadline);
          } catch (e) { throw new RetryableDeliveryRead(`Current requirements/eligibility unknown: ${(e as Error).message}`); }
        },
      });
      log(`#${r.iid} delivery: ${message}`);
    } catch (e) { log(`#${r.iid} delivery hold: ${(e as Error).message}`); }
    finally { tracker.setDeliveryDeadline(undefined); }
  }
}

const workById = new Map(work.tickets.map((t) => [t.iid, t]));
const parentById = new Map(parents.map((p) => [p.iid, p]));
const issues = units
  // The catalogue copy is canonical: it carries parent context, so analysis, hashing and dispatch agree.
  .map((u) => workById.get(u.iid) ?? parentById.get(u.iid))
  .filter((t): t is Ticket => !!t && unitEligibility(t, true, LABELS.exclude).status === 'selected');

sh("git", ["fetch", "origin", "--prune"]);
const branches = new Set(
  sh("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"]).split("\n").map((b) => b.replace(/^origin\//, "")),
);
const runs = allRuns.filter((r) => r.project === PROJECT);
const runOf = new Map(runs.map((r) => [Number(r.iid), r]));

const unstarted = issues.filter((i) => {
  const r = runOf.get(i.iid);
  if (r && !PARKED.includes(r.stage)) return false; // has a run record that isn't parked
  if ([...branches].some((b) => b.startsWith(`${i.iid}-`))) return false; // already has a branch
  return true;
});
// Resolve all selected descriptions, including active tickets, without touching their attempt model.
const noModel = new Map<number, string>();
for (const i of issues) {
  const m = dry ? resolveTicketModel(i.description, AGENT.family) : recordModelResolution(
    stateDir(), keyFor(String(i.iid), PROJECT), { iid: String(i.iid), project: PROJECT },
    () => resolveTicketModel(tracker.ticket(i.iid).description, AGENT.family),
  );
  if ("error" in m) noModel.set(i.iid, m.error);
}
const candidates = unstarted.filter((i) => !noModel.has(i.iid));
for (const i of unstarted.filter((u) => noModel.has(u.iid))) {
  log(`#${i.iid} ${i.title}: ${noModel.get(i.iid)}`);
  if (!dry) queueModelProblem(String(i.iid), { title: i.title, ticketUrl: tracker.ticketUrl(i.iid), base, note: noModel.get(i.iid) });
}
log(`${parents.length} ready ticket(s), ${issues.length} unit(s) of work, ${candidates.length} not yet started`);

// ---- ticket graph ------------------------------------------------------------
const live = runs.filter((r) => running(r) || (!!r.branch && openMrs.has(r.branch)));
const catalogue = work.tickets;
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
  hashOf.set(t.iid, unitHash(t, n));
}

const stale = tracked
  .map((t) => ({ t, why: staleReason(manifests.get(t.iid), hashOf.get(t.iid)!, catalogueHash, context.policyIdentity) }))
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

const dependencyCache = new Map<number, DependencyResult>();
const dependency = (iid: number): DependencyResult => {
  if (!dependencyCache.has(iid)) dependencyCache.set(iid, dependencyState(iid, {
    ticket: (id) => catalogueById.get(id) ?? tracker.ticket(id),
    run: (id) => runOf.get(id), mergedInto: tracker.mergedInto, base,
  }));
  return dependencyCache.get(iid)!;
};

const { decisions, dropped } = decide({
  candidates: candidates.map((c) => ({ iid: c.iid, hash: hashOf.get(c.iid)! })),
  policyIdentity: context.policyIdentity,
  manifests,
  dependency,
  queue: new Set([...candidates.map((c) => c.iid), ...runs.filter((r) => r.stage !== "stopped").map((r) => Number(r.iid))]),
  live: live.map((r) => {
    const m = manifests.get(Number(r.iid));
    return { iid: Number(r.iid), footprint: m?.actualFootprint ?? m?.footprint ?? [] };
  }),
  room,
  ignore: GRAPH.conflictIgnore,
});
for (const e of dropped) log(`cycle: ignoring "#${e.to} depends on #${e.from}" (${e.what}, confidence ${e.confidence})`);

// ---- refresh existing cards (#78) ----------------------------------------------------
// This separate analysis store never feeds decide() or writes an execution manifest. Share the per-pass budget,
// including failed analysis attempts. No assessment-store failure may abort the admission path below.
if (!dry) {
  try { refreshProject({ base, subtasks, select: SELECT, budget: Math.max(0, GRAPH.maxAnalysesPerPass - batch.length), log }); }
  catch (e) { log(`assessment refresh: ${(e as Error).message}`); }
}

// ---- board -------------------------------------------------------------------
const byIid = new Map(candidates.map((c) => [c.iid, c]));
for (const d of decisions) {
  const c = byIid.get(d.iid)!;
  log(`#${d.iid} ${c.title}: ${d.launch ? (dry ? "would launch (dry run)" : "launching") : d.reason}`);
  if (dry || d.launch) continue;
  const stage = runOf.get(d.iid)?.stage === "waiting" ? "waiting" : "queued";
  setStage(String(d.iid), { stage, title: c.title, ticketUrl: tracker.ticketUrl(d.iid), base, note: d.reason });
}
if (!dry) {
  // Parked cards that leave selection keep their complete history. They are absent from candidates, so cannot launch.
  // Their current tracker state/selection is recorded by refreshProject, not by rewriting the historical run.
  // Manifests of tickets that are gone, once they're old enough not to explain anything.
  const cutoff = Date.now() - GRAPH.pruneAfterDays * 86_400_000;
  const liveIids = new Set(live.map((r) => Number(r.iid)));
  for (const m of manifests.values()) {
    if (!catalogueById.has(m.iid) && !liveIids.has(m.iid) && Date.parse(m.analyzedAt || "1970-01-01") < cutoff) removeManifest(PROJECT, m.iid);
  }
}

// ---- jam report (scheduled passes only; see the header) --------------------------
const jamReport = process.env.FACTORY_JAM_REPORT;
if (jamReport && !dry) {
  const jam = findJam({
    units: issues.map((i) => {
      const r = runOf.get(i.iid);
      return { iid: i.iid, stage: r?.stage, openPr: !!r?.branch && openMrs.has(r.branch) };
    }),
    decisions,
    active: runs.filter(running).map((r) => Number(r.iid)),
    room,
  });
  const ours = new Set([...LABELS.ready, LABELS.needsHuman, LABELS.done]);
  const jammed = new Set<number>(jam.tickets);
  const watched = issues.filter((i) => jammed.has(i.iid) || ["stopped", "done"].includes(runOf.get(i.iid)?.stage ?? ""));
  const tickets = watched.map((t) => ({
    iid: t.iid,
    content: hashOf.get(t.iid) ?? unitHash(t, tracker.notes(t.iid)),
    labels: (t.labels ?? []).filter((l) => !ours.has(l)),
  }));
  log(jam.tickets.length ? `jam: ${jam.tickets.map((t) => `#${t}`).join(", ")}` : `no jam: ${"none" in jam ? jam.none : ""}`);
  const temp = `${jamReport}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, pass: process.env.FACTORY_PASS_ID ?? "", project: PROJECT, at: new Date().toISOString(), ...jam, observed: tickets }, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, jamReport);
}

// ---- launch ------------------------------------------------------------------
const launch = decisions.filter((d) => d.launch);
if (dry || !launch.length) process.exit(0);
const logDir = context.projectPath('.sandcastle/logs');
mkdirSync(logDir, { recursive: true });
for (const [n, d] of launch.entries()) {
  const iid = String(d.iid);
  const meta = { title: byIid.get(d.iid)!.title, ticketUrl: tracker.ticketUrl(d.iid), base };
  // Held by this pass's pid until the child is spawned; if this pass dies first, readers drop the unstarted claim.
  context.assertCurrent();
  const claim = claimRun({ iid, pid: process.pid, cap, patch: meta });
  if (!claim.ok) {
    log(`#${iid} not launched: ${claim.reason}`);
    if (claim.reason.startsWith("no capacity")) break;
    continue;
  }
  const out = openSync(resolve(logDir, `run-${iid}.log`), "a");
  const childRuntime = runtimeLease.childLease();
  const child = spawn(process.execPath, [context.tsx, context.codePath('main.mts'), "--base", base, "--issue", iid, ...(opts["whole-issues"] ? ["--whole-issues"] : [])], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, ...context.env, FACTORY_RUNTIME_LEASE: childRuntime.token, FACTORY_LAUNCH_CLAIM: claim.run.claim! },
  });
  closeSync(out);
  child.once('error', error => { runtimeLease.releaseChild(childRuntime.token); removeRun(iid, claim.run.claim); log(`Launch failed: ${error.message}`); });
  if (child.pid) runtimeLease.transfer(childRuntime.token, child.pid);
  child.unref();
  // The claim goes to the child (main.mts adopts it); a launch that failed to spawn releases it.
  if (child.pid) reserveRun(iid, child.pid, { ...meta, claim: claim.run.claim });
  else removeRun(iid, claim.run.claim);
  if (n < launch.length - 1) await new Promise((r) => setTimeout(r, SELECT.staggerSeconds * 1000));
}
