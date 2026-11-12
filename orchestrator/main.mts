import { createSandbox, claudeCode, pi } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { PARKED, readRuns, setProject, setStage, TERMINAL } from "./board.mts";
import { parentText } from "./analyze.mts";
import { AGENT, allLabels, GRAPH, LABELS, MERGE, SUBTASKS, TRACKER } from "./config.mts";
import { disallowedModels, piEnvFor, ticketModel } from "./models.mts";
import { blockedOutcome, expandUnits, SANDCASTLE_MARK, unitHash } from "./graph.mts";
import type { ImplementerBlocker } from "./graph.mts";
import { patchManifest } from "./manifests.mts";
import { postAndDeliver, runVerifier } from "./handoff.mts";
import type { Host } from "./handoff.mts";
import { containersGone, realDocker, REPAIR_MINUTES, REPAIR_PROMPT, repairWithin, worktreeFor, writeResult } from "./recovery.mts";
import type { RepairResult } from "./recovery.mts";
import * as tracker from "./tracker.mts";

// End-to-end loop for one ticket (run from the repo root):
//   npx tsx .sandcastle/main.mts --base sal-develop [--issue 695] [--no-push]
// 1. branch <iid>-<slug> off origin/<base>   2. implementer run   3. verifier run (screenshots/video + verdict)
// 4. host posts the evidence to the ticket   5. on PASS: push and deliver (tracker adapter).
//    Steps 3-5 live in handoff.mts, shared with recovery runs so a repaired branch is verified and delivered the same way:
//    GitLab: wait for the branch pipeline, open an MR into <base>; never merges.
//    GitHub: open a PR into <base>; with MERGE.auto, merge it once every CI check passes (ci.mts).
// Never closes the ticket (the dispatcher closes a Task/sub-issue, or moves a ticket on, once its work
// merges). Every tracker call runs on the host with your glab/gh login; the container has no tracker token.
// The agent (Claude Code or Pi) comes from AGENT in config.mts. The implementer's model is AGENT.model, or
// with AGENT.modelLabels the one the ticket's model label names (models.mts); the verifier always uses AGENT.model.
//
// Recovery mode (slice four, #60): `main.mts --issue <n> --base <b> --recover <attempt>` is started only by Factory's
// recovery launcher (cli/src/recovery-run.mts), after it claimed the ticket for that attempt. Instead of a new branch it
// resumes the ticket's recorded branch (and Sandcastle's existing worktree for it, dirty files included), runs the
// repair agent (prompt.recover.md, AGENT.model) for at most REPAIR_MINUTES after the container is ready and set up, then
// the same verifier and delivery as step 3-5 (handoff.mts, origin "repaired"). A timeout or SIGTERM aborts the agent,
// closes the sandbox and confirms this attempt's container is gone; commits, dirty work and evidence are kept. Earlier
// evidence stays (an old blocked.json is renamed, previous-run.json keeps the record as claimed). The attempt's result
// goes to <evidence>/recovery-attempt-<n>.json (recovery.mts) for the launcher to record; the record ends `done`
// (delivered) or `stopped`. It never creates or deletes a branch, labels the ticket or closes it.

// ---- Project config: the block to edit when adapting this to another project ----------
// Tracker, agent, merge policy, milestone and labels live in config.mts. (Also adapt sandbox/bootstrap-site.sh, the
// Environment section of prompt.md, and the fixture advice in prompt.verify.md. See ADAPTING.md.)
const CONFIG = {
  image: "sandcastle-islandhealth", // factory:image - `factory init --image` replaces the value
  ciWaitMinutes: 30, // give up waiting for CI after this long
  // No CI seen in this time: GitLab opens the MR anyway; with MERGE.auto the PR is not merged.
  noPipelineMinutes: 5,
  // Runs in order inside the container once it is up; the working directory is the worktree.
  // factory:sandbox-setup:start - `factory init` replaces everything up to the :end tag with an empty list
  sandboxSetup: [
    { command: "cd /home/agent/workspace && composer install --no-interaction --prefer-dist", timeoutMs: 20 * 60_000 },
    { command: "start-web.sh /home/agent/workspace/web", sudo: true },
    { command: "/opt/sandcastle/bootstrap-site.sh", timeoutMs: 10 * 60_000 },
  ],
  // factory:sandbox-setup:end
};
const PROJECT = TRACKER.project;
const IMAGE = CONFIG.image;
// What the container's Pi run needs depends on its model's provider (models.mts). pi-claude-subscription (the
// personal config) needs nothing from here: the image's Claude Code CLI logs in with CLAUDE_CODE_OAUTH_TOKEN,
// which Sandcastle reads from .sandcastle/.env itself. Only an `openai/` model (a custom config) gets a
// per-run token from the host's pi login, handed over as OPENAI_API_KEY for that one run.
function openaiCredential(): string {
  for (const cmd of [["print-bearer-token", "--min-expiry", "50m"], ["print-api-key"]]) {
    const res = spawnSync("pi", ["auth", ...cmd, "--provider", "openai"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  fail("pi on the host has no usable OpenAI login. Run pi, then /login, and pick Sign in with ChatGPT.");
}
// Called as each run starts.
const agent = (model: string) =>
  AGENT.provider === "pi" ? pi(model, { thinking: AGENT.thinking, env: piEnvFor(model, openaiCredential) }) : claudeCode(model);

let currentIid: string | undefined;
let finished = false;
let lastMessage = "";
// Recovery mode: the attempt number, its evidence folder once known, and whether its result has been written.
let recoverAttempt: number | undefined;
let recoverEvidence: string | undefined;
let resultWritten = false;
function fail(msg: string): never {
  lastMessage = msg;
  console.error(msg);
  process.exit(1);
}
/** Recovery mode: write the attempt's result, leave the record stopped with the reason, and exit. */
function endAttempt(result: RepairResult, msg: string, code = 1): never {
  if (recoverEvidence && recoverAttempt !== undefined) writeResult(recoverEvidence, recoverAttempt, result, msg);
  resultWritten = true;
  lastMessage = msg;
  console.error(msg);
  process.exit(code);
}
// Anything that ends the process before a terminal stage lands on the board as "washed away".
process.on("exit", (code) => {
  if (recoverEvidence && recoverAttempt !== undefined && !finished && !resultWritten) {
    writeResult(recoverEvidence, recoverAttempt, "failed", lastMessage || `exited with code ${code}`);
  }
  if (currentIid && !finished) setStage(currentIid, { stage: "stopped", note: lastMessage || `exited with code ${code}` });
});
function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

const { values: opts } = parseArgs({
  options: {
    base: { type: "string" },
    issue: { type: "string" },
    "no-push": { type: "boolean", default: false },
    "whole-issues": { type: "boolean", default: false }, // without --issue: pick a ready issue, not one of its Tasks
    recover: { type: "string" }, // recovery attempt number; started by Factory's recovery launcher only
  },
});
if (!opts.base) fail("--base <integration branch> is required (e.g. sal-develop, or sal-redesign for #565 children)");
if (opts.recover !== undefined) {
  if (!/^[1-9]\d*$/.test(opts.recover) || !opts.issue) fail("--recover <attempt> needs a positive attempt number and --issue.");
  if (opts["no-push"]) fail("--recover always delivers normally; --no-push is not allowed with it.");
  recoverAttempt = Number(opts.recover);
}
const base = opts.base;
if (MERGE.auto && (TRACKER as { kind?: string }).kind !== "github" && !opts["no-push"]) fail('MERGE.auto needs TRACKER.kind "github" (config.mts).');
const badModels = disallowedModels(AGENT.modelLabels, [AGENT.model, GRAPH.model]);
if (badModels) fail(badModels);
await tracker.ensureLabels(allLabels());

// ---- pick the ticket -------------------------------------------------------
const subtasks = SUBTASKS.enabled && !opts["whole-issues"];
const work = tracker.workCatalogue(subtasks);
let iid = opts.issue;
if (!iid) {
  const first = expandUnits(tracker.readyList().map((i) => i.iid), work.childrenOf, subtasks).units[0];
  if (!first) fail(`No open issues or Tasks labelled ${LABELS.ready.join(" + ")}.`);
  iid = String(first.iid);
}
// A Task gets its parent issue as context; whole tickets have none.
const parentIid = tracker.parentOf(Number(iid));
const withParent = (t: tracker.Ticket): tracker.Ticket => {
  if (parentIid === undefined) return t;
  const p = tracker.ticket(parentIid);
  return { ...t, parent: { iid: p.iid, title: p.title, description: p.description } };
};
const startTicket = withParent(tracker.ticket(Number(iid)));
const issue = startTicket;
const picked = ticketModel(startTicket.labels ?? [], AGENT.modelLabels, AGENT.model);
if ("error" in picked) fail(`#${iid} ${picked.error}. Not started.`);
const implementerModel = picked.model;
const ticket = [tracker.viewText(Number(iid)), parentText(startTicket)].filter(Boolean).join("\n\n");
// The version of the ticket this run builds from; compared again before the MR opens.
const ticketHash = (t = withParent(tracker.ticket(Number(iid)))) => ({ hash: unitHash(t, tracker.notes(Number(iid))), description: t.description });
const startVersion = ticketHash(startTicket);
const catalogue = work.tickets.filter((t) => String(t.iid) !== iid);
const slug = String(issue.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
setProject(PROJECT);
// Recovery resumes the record's branch, which the launcher already checked (recovery-workspace.mts) and claimed.
const claimed = recoverAttempt === undefined ? undefined : readRuns().find((r) => r.project === PROJECT && r.iid === iid);
if (recoverAttempt !== undefined && (claimed?.recovery?.attempt !== recoverAttempt || !claimed.branch)) {
  fail(`#${iid} is not claimed for recovery attempt ${recoverAttempt}; only Factory's recovery launcher starts --recover.`);
}
const branch = claimed?.branch ?? `${iid}-${slug}`;

sh("git", ["fetch", "origin", base]);
const baseSha = sh("git", ["rev-parse", `origin/${base}`]);
if (claimed) {
  if (!sh("git", ["branch", "--list", branch])) fail(`Recorded branch ${branch} no longer exists locally; recovery does not restart from scratch.`);
} else if (sh("git", ["branch", "--list", branch]) || sh("git", ["ls-remote", "--heads", "origin", branch])) {
  fail(`Branch ${branch} already exists locally or on origin; delete it or pick another ticket.`);
}
currentIid = iid;
if (claimed) {
  recoverEvidence = resolve(".sandcastle/evidence", iid);
  // Take over the claimed record: keep its branch, evidence and history; this process now holds it.
  setStage(iid, { stage: "setup", note: `recovery attempt ${recoverAttempt}: setting up`, base, starting: undefined });
} else {
  setStage(iid, {
    title: String(issue.title), ticketUrl: tracker.ticketUrl(iid), branch, base, stage: "setup", startedAt: new Date().toISOString(), note: "",
    evidenceDir: resolve(".sandcastle/evidence", iid), ticketHash: startVersion.hash, verdict: undefined, mr: undefined,
    parentIid: parentIid === undefined ? undefined : String(parentIid), mergedAt: undefined,
    starting: undefined, // this run now owns the record the dispatcher reserved at launch
  });
}
// Heartbeat so the board can tell a long agent run from a dead process.
setInterval(() => { if (!finished) setStage(iid!, {}); }, 60_000).unref();
console.log(`#${iid} ${issue.title}\n  branch ${branch} from origin/${base} (${baseSha.slice(0, 8)}), implementer ${implementerModel}`);

// ---- sandbox: one container + one site install shared by both runs -------------
const evidenceHost = resolve(".sandcastle/evidence", iid);
const evidenceBox = `/home/agent/evidence/${iid}`;
mkdirSync(evidenceHost, { recursive: true });
mkdirSync(resolve(".sandcastle/sandbox"), { recursive: true }); // mounted read-only at /opt/sandcastle; empty unless the project adds helpers
if (claimed) {
  // Keep earlier evidence: the record as claimed, and an old blocked.json under another name so only the repair
  // agent's own blocked.json counts. verdict.md is cleared by beginVerification just before the verifier.
  writeFileSync(resolve(evidenceHost, "previous-run.json"), JSON.stringify(claimed, null, 2) + "\n");
  const oldBlocked = resolve(evidenceHost, "blocked.json");
  if (existsSync(oldBlocked)) renameSync(oldBlocked, resolve(evidenceHost, `blocked.before-recovery-${recoverAttempt}.json`));
  rmSync(resolve(evidenceHost, `recovery-attempt-${recoverAttempt}.json`), { force: true });
} else {
  // A relaunched ticket (it was waiting on a blocker) must not pick up the last run's reports.
  for (const f of ["blocked.json", "verdict.md"]) rmSync(resolve(evidenceHost, f), { force: true });
}

/** blocked.json from the implementer: tickets (or things) it needs that aren't merged yet. */
function readBlocked(): ImplementerBlocker[] | undefined {
  const file = resolve(evidenceHost, "blocked.json");
  if (!existsSync(file)) return undefined;
  try {
    const list = JSON.parse(readFileSync(file, "utf8")).blockers;
    if (!Array.isArray(list)) return [];
    return list.map((b: Partial<ImplementerBlocker>) => ({
      iid: Number.isInteger(b.iid) ? (b.iid as number) : null,
      what: String(b.what ?? ""),
      evidence: String(b.evidence ?? ""),
    }));
  } catch {
    return []; // unreadable report: blockedOutcome sends it to a person
  }
}

// Recovery mode: SIGTERM (Factory cancelling the attempt) aborts the repair agent, or, outside it, closes the sandbox
// and confirms this attempt's container is gone before exiting 143. Work on the branch and in the worktree is kept.
const cancel = new AbortController();
let owned: { close(): Promise<unknown>; worktreePath: string } | undefined;
let inRepair = false;
/** Close this attempt's sandbox and confirm no container mounting the ticket's worktree is left; returns any problem. */
async function closeOwned(): Promise<string | undefined> {
  const worktree = owned?.worktreePath ?? worktreeFor(process.cwd(), branch);
  let problem: string | undefined;
  try {
    await owned?.close();
  } catch (e) {
    problem = `sandbox close failed: ${(e as Error).message}`;
  }
  owned = undefined;
  const gone = containersGone(worktree, realDocker);
  return gone.ok ? problem : [problem, gone.reason].filter(Boolean).join("; ");
}
async function stopAttempt(result: RepairResult, msg: string, code = 1): Promise<never> {
  const problem = await closeOwned();
  endAttempt(result, problem ? `${msg} (${problem})` : msg, code);
}
const preserved = `work preserved on ${branch}`;
if (claimed) {
  process.on("SIGTERM", () => {
    cancel.abort(new Error("cancelled"));
    if (!inRepair) void stopAttempt("interrupted", `recovery attempt ${recoverAttempt} cancelled; ${preserved}`, 143);
  });
}

const sandbox = await createSandbox({
  branch,
  baseBranch: `origin/${base}`,
  sandbox: docker({
    imageName: IMAGE,
    mounts: [
      { hostPath: resolve(".sandcastle/evidence"), sandboxPath: "/home/agent/evidence" },
      { hostPath: resolve(".sandcastle/sandbox"), sandboxPath: "/opt/sandcastle", readonly: true },
    ],
  }),
  hooks: {
    sandbox: {
      onSandboxReady: CONFIG.sandboxSetup,
    },
  },
});

const promptArgs = {
  ISSUE_IID: iid,
  ISSUE_TITLE: String(issue.title),
  TICKET: ticket,
  BASE_BRANCH: base,
  BASE_SHA: baseSha,
  BRANCH: branch,
  EVIDENCE_DIR: evidenceBox,
  CATALOGUE: catalogue.map((t) => `- #${t.iid} ${t.title}`).join("\n") || "(none)",
  ...(claimed ? { ATTEMPT: String(recoverAttempt), REPAIR_MINUTES: String(REPAIR_MINUTES) } : {}),
};

let tip = "";
let blockers: ImplementerBlocker[] | undefined;
if (claimed) {
  // ---- 1R. repair agent: at most REPAIR_MINUTES, counted from here (the container is ready and set up) --------
  owned = sandbox;
  if (cancel.signal.aborted) await stopAttempt("interrupted", `recovery attempt ${recoverAttempt} cancelled during setup; ${preserved}`, 143);
  setStage(iid, { stage: "implementing", note: `recovery attempt ${recoverAttempt}: repairing (at most ${REPAIR_MINUTES} min)` });
  inRepair = true;
  const repair = await repairWithin(REPAIR_MINUTES * 60_000, cancel.signal, (signal) => sandbox.run({
    agent: agent(AGENT.model),
    promptFile: REPAIR_PROMPT,
    promptArgs,
    maxIterations: 1,
    completionSignal: "<promise>COMPLETE</promise>",
    name: "repair",
    signal,
  })).catch(async (e) => stopAttempt("failed", `recovery attempt ${recoverAttempt}: repair agent failed: ${(e as Error).message}; ${preserved}`));
  inRepair = false;
  if (!repair.ok) {
    if (repair.why === "cancelled") await stopAttempt("interrupted", `recovery attempt ${recoverAttempt} cancelled; ${preserved}`, 143);
    await stopAttempt("timed-out", `recovery attempt ${recoverAttempt}: repair agent stopped after ${REPAIR_MINUTES} minutes; ${preserved}`);
  }
  if (readBlocked()) await stopAttempt("blocked", `recovery attempt ${recoverAttempt}: the repair agent reported a blocker (blocked.json, recovery-report.md); ${preserved}`);
  if ((await sandbox.exec("git status --porcelain")).stdout.trim()) {
    await stopAttempt("failed", `recovery attempt ${recoverAttempt}: uncommitted changes are left in the worktree, so there is no tip to verify; ${preserved}`);
  }
  tip = (await sandbox.exec("git rev-parse HEAD")).stdout.trim();
  if (sh("git", ["rev-list", "--count", `${baseSha}..${tip}`]) === "0") {
    await stopAttempt("failed", `recovery attempt ${recoverAttempt}: ${branch} has no commits beyond origin/${base}; nothing to verify`);
  }
  patchManifest(PROJECT, Number(iid), { actualFootprint: sh("git", ["diff", "--name-only", `${baseSha}...${tip}`]).split("\n").filter(Boolean) });
  // ---- 2R. the same independent verifier (handoff.mts) ---------------------------------------
  const refused = await runVerifier(sandbox, { setStage }, { iid, evidenceHost, agent: agent(AGENT.model), promptArgs, tip });
  if (refused) await stopAttempt("failed", `recovery attempt ${recoverAttempt}: ${refused}`);
  const problem = await closeOwned();
  if (problem) endAttempt("failed", `recovery attempt ${recoverAttempt}: ${problem}; not delivering`);
} else {
  try {
    // ---- 1. implementer ----------------------------------------------------------
    setStage(iid, { stage: "implementing" });
    const impl = await sandbox.run({
      agent: agent(implementerModel),
      promptFile: "./.sandcastle/prompt.md",
      promptArgs,
      maxIterations: 1,
      completionSignal: "<promise>COMPLETE</promise>",
      name: "implementer",
    });
    if (!impl.commits.length) {
      blockers = readBlocked();
      if (!blockers) fail(`Implementer made no commit for #${iid} (no change needed, or blocked). See ${impl.logFilePath ?? "logs"}. Nothing pushed.`);
    } else {
      tip = (await sandbox.exec("git rev-parse HEAD")).stdout.trim();
      // The real diff replaces the predicted footprint for conflict checks from now on.
      patchManifest(PROJECT, Number(iid), { actualFootprint: sh("git", ["diff", "--name-only", `${baseSha}...${tip}`]).split("\n").filter(Boolean) });

      // ---- 2. verifier (handoff.mts) -----------------------------------------------
      const refused = await runVerifier(sandbox, { setStage }, { iid, evidenceHost, agent: agent(AGENT.model), promptArgs, tip });
      if (refused) fail(refused);
    }
  } finally {
    await sandbox.close();
  }
}

// ---- implementer reported a missing prerequisite ----------------------------------
if (blockers) {
  const satisfied = (b: number) => {
    const t = tracker.ticket(b);
    if (t.state === "closed") return true;
    const run = readRuns().find((r) => r.project === PROJECT && r.iid === String(b));
    return !!run?.branch && tracker.mergedInto(run.branch, run.base ?? base);
  };
  const what = blockers.map((b) => `${b.iid != null ? `#${b.iid}` : "no ticket"}: ${b.what}`).join("; ");
  const outcome = blockedOutcome(Number(iid), blockers, (b) => {
    try {
      return satisfied(b);
    } catch {
      return true; // no such ticket: nothing to wait for
    }
  });
  if (outcome === "needs-human") {
    tracker.addLabel(Number(iid), LABELS.needsHuman);
    tracker.comment(iid, [
      `## Sandcastle: blocked`,
      `The implementer couldn't do this ticket, and the blocker isn't one Sandcastle can wait for (no open ticket provides it, or that ticket is already merged or closed). Labelled \`${LABELS.needsHuman}\`.`,
      ...blockers.map((b) => `- ${b.iid != null ? `#${b.iid}` : "No ticket"}: ${b.what}. ${b.evidence}`),
      SANDCASTLE_MARK,
    ].join("\n\n"));
    fail(`Blocked (${what}); labelled ${LABELS.needsHuman}.`);
  }
  patchManifest(PROJECT, Number(iid), { implementerBlockers: blockers });
  // Remove the empty branch so the dispatcher can relaunch the ticket once the blocker merges.
  try {
    sh("git", ["branch", "-D", branch]);
  } catch {
    fail(`Blocked (${what}), but branch ${branch} could not be deleted (worktree left behind?). Delete it to let the ticket run again.`);
  }
  finished = true;
  setStage(iid, { stage: "waiting", note: `implementer: needs ${what}` });
  console.log(`#${iid} waits on ${what}. The dispatcher relaunches it once that is merged.`);
  process.exit(0);
}

// ---- 3. post evidence to the ticket (host-side) -----------------------------------
setStage(iid, { stage: "posting" });
// Ticket edited since the run started? Still finish (you review every MR), but say so.
const endVersion = ticketHash();
let staleNote = "";
if (endVersion.hash !== startVersion.hash) {
  const dir = mkdtempSync(resolve(tmpdir(), "sandcastle-"));
  writeFileSync(resolve(dir, "built-from"), `${startVersion.description}\n`);
  writeFileSync(resolve(dir, "current"), `${endVersion.description}\n`);
  const diff = spawnSync("git", ["diff", "--no-index", "--no-color", "built-from", "current"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  rmSync(dir, { recursive: true, force: true });
  staleNote = [
    "**Built from an older version of the ticket.** It was edited while this run was in progress, so check the change against the current text.",
    diff ? `Description changes:\n\n\`\`\`diff\n${diff}\n\`\`\`` : "The description is unchanged; the title or comments changed.",
  ].join("\n\n");
  setStage(iid, { note: "built from an older ticket version" });
}
// ---- 3-4. post evidence, then on PASS push and deliver (handoff.mts) ----------------
const host: Host = {
  setStage, readRuns,
  live: (r, openMrs) => (!TERMINAL.includes(r.stage) && !PARKED.includes(r.stage)) || (r.stage === "done" && openMrs.has(r.branch!)),
  git: (args) => sh("git", args),
  gitStatus: (args) => {
    const res = spawnSync("git", args, { encoding: "utf8" });
    return { status: res.status, stdout: res.stdout ?? "" };
  },
  tracker,
};
const outcome = await postAndDeliver({
  iid, project: PROJECT, branch, base, baseSha, tip, title: String(issue.title), evidenceHost, parentIid,
  origin: claimed ? { kind: "repaired", attempt: recoverAttempt! } : { kind: "implemented" },
  staleNote, noPush: opts["no-push"], ciWaitMinutes: CONFIG.ciWaitMinutes, noCiMinutes: CONFIG.noPipelineMinutes, autoMerge: MERGE.auto,
}, host);
if (!outcome.ok) {
  if (claimed) endAttempt("failed", `recovery attempt ${recoverAttempt}: ${outcome.reason}`);
  fail(outcome.reason);
}
if (claimed) {
  writeResult(recoverEvidence!, recoverAttempt!, "repaired", outcome.pushed ? `verified and delivered: ${outcome.url}` : undefined);
  resultWritten = true;
}
finished = true;
if (!outcome.pushed) {
  console.log(`--no-push: stopping. Branch ${branch} is ready locally.`);
  process.exit(0);
}
const next = parentIid === undefined ? `moves #${iid} to ${LABELS.done}` : `closes Task #${iid}`;
console.log(outcome.merged ? `Merged after CI passed. The next dispatcher pass ${next}.` : `Not merged. Once you merge it, the dispatcher ${next}.`);
