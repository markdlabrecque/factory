// Execute one fixed Pi workflow with durable managed admission before readiness/tracker/model work.
// A pinned leased runtime binds explicit project assets and state; immutable payload custody retains uncertain admission ownership.
// Normal handoff closure is sealed only after the entire implementation/verifier/delivery scope unwinds.
// Current original acceptance and authentic authorized baselines gate direct/adopted claims and recovery adoption.
// Original approved full child/parent bytes bind prompts/evidence; static validity grants no baseline authority.
// Fresh host/project and ticket gates precede work. Image readiness pins construction; setup browser and actual-user filesystem probes precede agents and owned teardown.
// Zero-commit diagnostics attribute Pi replies; only the current host execution can reserve a same-session continuation.
import { browserPreflight, checkImageCapabilities } from './capabilities.mts';
import { AcceptanceAdmissionHold, acceptanceStaticCheck, readPreparedAcceptance } from './acceptance-admission.mts';
import { AcceptanceBaselineHold, acceptanceBaselineCheck, requireAcceptanceBaselineForTicket } from './acceptance-baseline-admission.mts';
import { beginPayloadCustody } from './payload-custody.mts';
import { ownerOf } from './admission.mts';
import { probeSandbox, sandboxReadinessHold, recordSandboxCleanup } from './sandbox-readiness.mts';
import type { ReadinessReport } from './readiness-schema.mts';
// #153: proofs also bind continuation, checkpoint and admission code; upgrades require fresh verification.
// #150: freeze structured verifier evidence after teardown; recheck requirements/claim at every delivery boundary.
// Project-root v2 TOML owns sandbox/CI settings. Ticket choice and runtime/template inputs stay fixed per attempt.
// Provenance covers the complete selected inventory, including local-observation and admission helpers.
// #149: unknown dependency reads hold implementer and recovery work without needs-human labels.
import { dependencyState, type DependencyResult } from "./dependencies.mts";
import { diagnostic, diagnosticText, finalReply, saveDiagnostic, sanitizeReply } from './no-commit.mts';
import { continuationRefusal, outcomeFile, readImplementationOutcome, waitForContinuation, type ImplementationTurn } from './implementation-outcome.mts';
import { performance } from 'node:perf_hooks';
import { recordModelResolution } from "./assessment.mts";
import { createSandbox, pi } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { adoptClaim, keyFor, PARKED, queueModelProblem, readRuns, setProject, setStage, stateDir, TERMINAL } from "./board.mts";
import { claimManagedEntry, readAdmission, releaseManagedEntry } from "./admission.mts";
import { fillReceipt, recordIntent } from "./ownership.mts";
import { freezeTicketInput, saveTicketInput, TicketInputHold, type FrozenTicketInput } from './ticket-input.mts';
import { context, effectiveConfig, AGENT, allLabels, LABELS, MERGE, SUBTASKS, TRACKER } from "./runtime-config.mts";
import { piEnvFor, resolveTicketModel } from "./models.mts";
import { contextHold, retainRuntime } from './context.mts';
import { blockedOutcome, expandUnits, SANDCASTLE_MARK } from "./graph.mts";
import type { ImplementerBlocker } from "./graph.mts";
import { patchManifest, readManifest } from "./manifests.mts";
import { postAndDeliver, prerequisiteHold, runVerifier } from "./handoff.mts";
import { assertProofStoreOutsideMounts, createProof } from './verification.mts';
import type { Provenance } from './verification.mts';
import type { Host } from "./handoff.mts";
import { ownedContainerGone, readAttemptRecord, realClock, realDocker, REPAIR_DEADLINE_MS, REPAIR_MINUTES, runRecoveryAttempt } from "./recovery.mts";
import { createOwnedSandbox, gitWorkspace, readDotEnv, realProc } from "./recovery-sandbox.mts";
import * as tracker from "./tracker.mts";
import { projectLayoutPaths } from './project-layout.mts';
const layout = projectLayoutPaths(context.projectRoot);
const managedEntry = claimManagedEntry(stateDir(), { root: context.projectRoot, tracker: {
  kind: TRACKER.kind, host: TRACKER.gitlabHost ?? TRACKER.host!, project: TRACKER.project } });
let entryCleanupConfirmed = true;
process.on('exit', () => { if (entryCleanupConfirmed) releaseManagedEntry(stateDir(), managedEntry); });

// End-to-end loop for one ticket, launched from the project root through the selected bundle's absolute tsx:
//   <runtime>/main.mts --base <integration-branch> [--issue N] [--no-push]
// 1. branch <iid>-<slug> off origin/<base>   2. implementer run   3. verifier run (screenshots/video + verdict)
// 4. host posts the evidence to the ticket   5. on PASS: push and deliver (tracker adapter).
//    Steps 3-5 live in handoff.mts, shared with recovery runs so a repaired branch is verified and delivered the same way:
//    GitLab: wait for the branch pipeline, open an MR into <base>; never merges.
//    Both trackers support MERGE.auto with required named checks on the pushed SHA (ci.mts).
// Never closes the ticket (the dispatcher closes a Task/sub-issue, or moves a ticket on, once its work
// merges). Every tracker call runs on the host with your glab/gh login; the container has no tracker token.
// Factory policy fixes Pi and thinking. Description tiers select the implementer's model;
// verification and recovery use the family's large model independently of the ticket tier.
//
// Recovery mode (slice four, #60/#74): `main.mts --issue <n> --base <b> --recover <seq> --attempt-record <file>` is
// started only by Factory's recovery launcher (cli/src/recovery-run.mts) after it claimed the ticket and wrote the
// host-owned attempt record. Before any Git or container side effect it checks the record, the claimed run record and
// the arguments name the same project, ticket, branch, base and attempt (seq and UUID), and that the worktree is inside
// .factory/worktrees/. It then runs recovery.mts runRecoveryAttempt with the real boundaries: recovery-sandbox.mts's
// owned container (exact pre-recorded name, private Git metadata, this attempt's evidence only writable; not
// Sandcastle's createSandbox), the repair agent on AGENT.model whatever the ticket's model declaration, a 900000 ms deadline
// from container readiness, the shared verifier and delivery (handoff.mts), and a recheck of the ticket's requirements,
// state, needs-human label, prerequisite holds (handoff.mts prerequisiteHold over the dispatcher's analysis; unknown
// holds) and claim before verifying and before delivering. SIGTERM/SIGINT cancel the attempt (exit 143). The record
// ends `done` (delivered) or `stopped` with the reason; the recovery claim in the admission record (admission.mts, #75)
// is never released here, even with the container's removal unconfirmed: the launcher's settle step releases it once
// the exact container is confirmed gone. It never creates or deletes a branch, labels the ticket or closes it.
// Claims and receipts (#75): a dispatched run adopts the launch claim its record carries (board.mts adoptClaim), so its
// board writes, heartbeat and exit handler are fenced by the claim token, and refuses to start if the claim was
// superseded. Before Sandcastle creates the branch and worktree it writes the ticket's ownership receipt
// (ownership.mts) and fills in the branch's commit once they exist. The normal path keeps its branch-exists protection.

// Sandbox and CI settings are data, never executable project configuration.
const runtimeLease = await retainRuntime(context);
const { projectLaunchReadiness, readinessReason, recordTicketLaunch, recordTicketInput, recordReadinessCheck, ticketWorkspaceProblem, ticketBranch } = await import('./launch-readiness.mts');
const hostReadinessInput = { projectRoot: context.projectRoot, runtimeRoot: context.runtimeRoot, runtimeIdentity: context.manifest.id, runtimeDependencies: context.manifest.dependencies, config: effectiveConfig, stateRoot: stateDir() };
const hostReport = await projectLaunchReadiness(hostReadinessInput);
let inputReport = hostReport;
const hostHold = readinessReason(hostReport);
if (hostHold) { console.error(`project held: ${hostHold}`); process.exit(1); }
const CONFIG = effectiveConfig.config;
const PROJECT = TRACKER.project;
// What the container's Pi run needs depends on its model's provider (models.mts). pi-claude-subscription (the
// personal config) needs nothing from here: the image's Claude Code CLI logs in with CLAUDE_CODE_OAUTH_TOKEN,
// which Sandcastle reads from the project's .factory/.env. The OpenAI family gets a
// per-run token from the host's pi login, handed over as OPENAI_API_KEY for that one run.
function openaiCredential(): string {
  for (const cmd of [["print-bearer-token", "--min-expiry", "50m"], ["print-api-key"]]) {
    const res = spawnSync("pi", ["auth", ...cmd, "--provider", "openai"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  throw Error("pi on the host has no usable OpenAI login. Run pi, then /login, and pick Sign in with ChatGPT.");
}
// Called as each run starts.
const agent = (model: string) =>
  pi(model, { thinking: AGENT.thinking, env: piEnvFor(model, openaiCredential) });

let currentIid: string | undefined;
let finished = false;
let lastMessage = "";
let diagnosticExecutionId: string | undefined;
function fail(msg: string): never {
  lastMessage = msg;
  console.error(msg);
  process.exit(1);
}
// Anything that ends the process before a terminal stage lands on the board as "washed away".
process.on("exit", (code) => {
  if (currentIid && !finished && (!diagnosticExecutionId || readRuns().some(r => r.project === PROJECT && r.iid === currentIid && r.executionId === diagnosticExecutionId))) {
    setStage(currentIid, { stage: "stopped", note: lastMessage || `exited with code ${code}` });
  }
});
const readinessCancel = new AbortController();
const cancelReadiness = () => readinessCancel.abort();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, cancelReadiness);
context.assertCurrent();
const readiness = await checkImageCapabilities({ image: CONFIG.image, uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000,
  stateDir: stateDir(), signal: readinessCancel.signal });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.off(sig, cancelReadiness);
if (!readiness.ok) fail(readiness.reason);
if (process.env.FACTORY_READY_IMAGE && process.env.FACTORY_READY_IMAGE !== readiness.imageId) fail('Image changed after readiness admission; preserve work and retry with the reviewed image.');
const IMAGE = readiness.imageId;
function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}
// The host side of the hand-off (handoff.mts): board, git and tracker.
// Any open PR/MR reserves its branch's conflicts, including blocked automatic merges parked as waiting.
const host: Host = {
  setStage, readRuns,
  live: (r, openMrs) => (!TERMINAL.includes(r.stage) && !PARKED.includes(r.stage)) || (!!r.branch && openMrs.has(r.branch)),
  git: (args) => sh("git", args),
  gitStatus: (args) => {
    const res = spawnSync("git", args, { encoding: "utf8" });
    return { status: res.status, stdout: res.stdout ?? "" };
  },
  tracker,
};

const { values: opts } = parseArgs({
  options: {
    base: { type: "string" },
    issue: { type: "string" },
    "no-push": { type: "boolean", default: false },
    "whole-issues": { type: "boolean", default: false }, // without --issue: pick a ready issue, not one of its Tasks
    recover: { type: "string" }, // recovery attempt number; started by Factory's recovery launcher only
    "attempt-record": { type: "string" }, // the launcher's host-owned record of that attempt
  },
});
if (!opts.base) fail("--base <integration branch> is required (e.g. sal-develop, or sal-redesign for #565 children)");
const recovering = opts.recover !== undefined;
if (recovering) {
  if (!/^[1-9]\d*$/.test(opts.recover!) || !opts.issue || !opts["attempt-record"]) fail("--recover <attempt> needs a positive attempt number, --issue and --attempt-record.");
  if (opts["no-push"]) fail("--recover always delivers normally; --no-push is not allowed with it.");
}
const base = opts.base;
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
// Collection is host-only and fails before a run/agent is created. Later authority checks recollect.
let observedInitialAcceptance = false;
const currentTicketInput = (): FrozenTicketInput => {
  let input: FrozenTicketInput | undefined;
  try {
    input = freezeTicketInput(tracker.contextSource, Number(iid));
    const approved = readPreparedAcceptance(stateDir(), [context.projectRoot, context.runtimeRoot, resolve(stateDir(), 'worktrees')], input).ticket;
    if (!observedInitialAcceptance) recordReadinessCheck(stateDir(), inputReport, acceptanceStaticCheck(approved));
    observedInitialAcceptance = true;
    return approved;
  } catch (error) {
    if (input && error instanceof AcceptanceAdmissionHold) {
      try { recordReadinessCheck(stateDir(), inputReport, acceptanceStaticCheck(input, error)); }
      catch (writeError) { console.error(`Ticket readiness report write failed: ${(writeError as Error).message}`); }
    }
    if (error instanceof TicketInputHold) {
      try { recordTicketInput(stateDir(), inputReport, error); }
      catch (writeError) { console.error(`Ticket readiness report write failed: ${(writeError as Error).message}`); }
    }
    throw error;
  }
};
async function requireBaseline(original?: import('./acceptance-baseline-admission.mts').OriginalBaseline) {
  try {
    const identity = await requireAcceptanceBaselineForTicket(Number(iid), base, original);
    recordReadinessCheck(stateDir(), inputReport, acceptanceBaselineCheck(Number(iid),undefined,undefined,identity));
    return identity;
  } catch(error) {
    if(error instanceof AcceptanceBaselineHold) recordReadinessCheck(stateDir(), inputReport, acceptanceBaselineCheck(Number(iid),error));
    throw error;
  }
}
const frozenInput = currentTicketInput();
recordTicketInput(stateDir(), inputReport, frozenInput);
const parentIid = frozenInput.context.parent?.iid;
const withParent = (t: tracker.Ticket): tracker.Ticket => {
  if (parentIid === undefined) return t;
  const p = frozenInput.context.parent!;
  return { ...t, parent: { iid: p.iid, title: p.title, description: p.description } };
};
if (!recovering) {
  const workspaceHold = ticketWorkspaceProblem(context.projectRoot, ticketBranch(iid, frozenInput.context.child.title));
  recordTicketLaunch(stateDir(), hostReport, Number(iid), workspaceHold);
  if (workspaceHold) fail(`#${iid} held: ${workspaceHold}`);
}
setProject(PROJECT);
let startTicket!: tracker.Ticket;
const picked = recordModelResolution(stateDir(), keyFor(iid, PROJECT), { iid, project: PROJECT }, () => {
  startTicket = { ...withParent(tracker.ticket(Number(iid))), title: frozenInput.context.child.title, description: frozenInput.context.child.description };
  return resolveTicketModel(startTicket.description, AGENT.family);
});
const issue = startTicket;
if ("error" in picked && !recovering) {
  queueModelProblem(iid, { title: startTicket.title, ticketUrl: tracker.ticketUrl(iid), base, note: picked.error }, process.env.FACTORY_LAUNCH_CLAIM);
  fail(`#${iid} ${picked.error} Not started.`);
}
const ticket = frozenInput.text;
// Fresh structured source reads at authority boundaries, never replace the active prompt.
const ticketHash = () => {
  const current = currentTicketInput();
  if (current.hash !== frozenInput.hash) {
    try { recordTicketInput(stateDir(), inputReport, current, frozenInput.hash); }
    catch (error) { console.error(`Ticket readiness report write failed: ${(error as Error).message}`); }
  }
  return { hash: current.hash };
};
const startVersion = { hash: frozenInput.hash };
const inputEvidence = (...parts: string[]) => resolve(stateDir(), 'ticket-inputs', keyFor(iid!, PROJECT), ...parts);
context.assertCurrent();
assertProofStoreOutsideMounts(stateDir(), [resolve(layout.evidence), resolve(layout.helpers), resolve(layout.worktrees), resolve(layout.recovery)]);
const provenance = async (sandbox: { exec(cmd: string): Promise<{ stdout: string }> }, container: string): Promise<Provenance> => {
  // The SDK/host supplies this identity; never trust an agent-controlled hostname or report.
  const name = container;
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw Error('Cannot establish verifier container identity');
  const imageId = sh('docker', ['container', 'inspect', '--format', '{{.Image}}', name]);
  if (imageId !== IMAGE) throw Error('Sandbox image differs from admitted immutable image; fresh readiness required');
  return { imageId, nodeVersion: (await sandbox.exec('node --version')).stdout.trim(),
    code: Object.fromEntries(context.manifest.files.map((file: { path: string; sha256: string }) => [file.path, file.sha256])),
    settings: { image: CONFIG.image, model: AGENT.model, thinking: AGENT.thinking ?? null, merge: { auto: MERGE.auto, method: MERGE.method, requiredChecks: MERGE.requiredChecks ?? [] }, ciWaitMinutes: CONFIG.ciWaitMinutes, noPipelineMinutes: CONFIG.noPipelineMinutes, execution: context.identity } };
};
const catalogue = work.tickets.filter((t) => String(t.iid) !== iid);
const slug = String(issue.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
// ---- recovery mode: one admitted repair attempt (recovery.mts) ------------------------------------------------
if (recovering) {
  const seq = Number(opts.recover);
  const file = resolve(opts["attempt-record"]!);
  const read = readAttemptRecord(file);
  if (!read.ok) fail(`#${iid}: recovery refused: ${read.reason}`);
  const rec = read.record;
  setProject(PROJECT);
  const claimed = readRuns().find((r) => r.project === PROJECT && r.iid === iid);
  const claimOf = () => readAdmission(stateDir()).claims[keyFor(iid!, PROJECT)];
  const admitted = claimOf();
  const owned = (() => { try { const r = relative(realpathSync(layout.worktrees), realpathSync(rec.worktree)); return !!r && !r.startsWith("..") && !r.includes("/"); } catch { return false; } })();
  if (rec.iid !== iid || rec.seq !== seq || rec.project !== PROJECT || rec.base !== base || rec.phase !== "claimed"
    || rec.executionId !== claimed?.executionId || rec.implementationBaseSha !== claimed?.implementationBaseSha
    || (rec.previousEvidence !== undefined && rec.previousEvidence !== (claimed?.evidenceDir || resolve(layout.evidence, iid)))
    || claimed?.recovery?.attempt !== seq || claimed.recovery.id !== rec.id || claimed.branch !== rec.branch || !owned
    || admitted?.kind !== "recovery" || admitted.attempt !== rec.id || admitted.token !== claimed.claim) {
    fail(`#${iid} is not claimed for recovery attempt ${seq} (${rec.id}); only Factory's recovery launcher starts --recover, once per attempt.`);
  }
  if (!claimed?.implementationBaseSha || !claimed.acceptanceBaseline) fail('Acceptance baseline hold: preparation-required; original saved fullscope baseline admission is missing. Preserve work and charges; prepare explicitly.');
  const original = {sha:claimed.implementationBaseSha,admission:claimed.acceptanceBaseline};
  await requireBaseline(original);
  let token: string | undefined;
  try {
    token = adoptClaim(iid);
  } catch (e) {
    fail(`#${iid}: recovery refused: ${(e as Error).message}`);
  }
  sh("git", ["fetch", "origin", base]);
  if (!claimed?.executionId) fail('Legacy run has no execution identity; historical PASS cannot authorize recovery delivery.');
  context.assertScope(Number(iid),claimed.executionId);
  const baseSha = claimed?.implementationBaseSha;
  const baseline = baseSha && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseSha)
    ? spawnSync('git', ['--no-replace-objects', 'rev-parse', '--verify', `${baseSha}^{commit}`], { encoding: 'utf8' }) : undefined;
  if (!baseSha || baseline?.status !== 0 || baseline.stdout.trim() !== baseSha) fail('Missing recorded implementation baseline; preserve this branch for explicit human review or fresh verification with an established historical baseline.');
  currentIid = iid;
  setStage(iid, { stage: "setup", note: `recovery attempt ${seq}: setting up`, base, starting: undefined });
  setInterval(() => { if (!finished) setStage(iid!, {}); }, 60_000).unref();
  console.log(`#${iid} ${issue.title}\n  recovery attempt ${seq} (${rec.id}) on ${rec.branch} at ${rec.startSha.slice(0, 8)}, repair model ${AGENT.model}`);
  const cancel = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => cancel.abort(new Error(`${sig}: recovery attempt cancelled`)));
  mkdirSync(resolve(layout.helpers), { recursive: true });
  const evidenceBox = `/home/agent/evidence/${iid}`;
  const recheck = () => {
    try {context.assertScope(Number(iid),claimed.executionId);} catch(e) {return (e as Error).message;}
    const hold = contextHold(context); if (hold) return hold;
    const now = withParent(tracker.ticket(Number(iid)));
    if (now.state === "closed") return `#${iid} is closed`;
    if (!['open', 'opened'].includes(now.state ?? '')) return `#${iid}'s eligibility is unknown`;
    if (tracker.parentOf(Number(iid)) !== parentIid) return 'Ticket parent changed';
    if ((now.labels ?? []).some(l => l === LABELS.needsHuman || LABELS.exclude.includes(l))) return `#${iid} is excluded or needs human review`;
    try {
      if (ticketHash().hash !== startVersion.hash) return `#${iid}'s requirements changed since the attempt started`;
    } catch (e) { return (e as Error).message; }
    const r = readRuns().find((x) => x.project === PROJECT && x.iid === iid);
    const c = claimOf();
    if (r?.recovery?.id !== rec.id || r.claim !== token || c?.token !== token || c.attempt !== rec.id) return `#${iid}'s claim is no longer held by this attempt`;
    // Dependency and open-PR prerequisite holds, as the dispatcher's analysis records them; unknown holds too.
    const openMrs = tracker.openMrBranches();
    const runOf = (b: number) => readRuns().find((x) => x.project === PROJECT && x.iid === String(b));
    return prerequisiteHold(Number(iid), {
      manifest: readManifest(PROJECT, Number(iid)), hash: startVersion.hash, policyIdentity: context.policyIdentity,
      dependency: (b) => dependencyState(b, { ticket: tracker.ticket, run: runOf, mergedInto: tracker.mergedInto, base }),
      active: (b) => {
        const dep = runOf(b);
        if (dep && !TERMINAL.includes(dep.stage) && !PARKED.includes(dep.stage)) return "a run in flight";
        return dep?.branch && openMrs.has(dep.branch) ? "an open PR" : undefined;
      },
    });
  };
  const inputHold = recheck();
  if (inputHold) fail(inputHold);
  await requireBaseline(original);
  saveTicketInput(inputEvidence(claimed.executionId!, rec.id), frozenInput);
  setStage(iid, { ticketInput: { hash: frozenInput.hash, renderedSha256: frozenInput.textHash, attemptId: rec.id } });
  entryCleanupConfirmed = false;
  runtimeLease.pendingCleanup();
  let recoveryReport: ReadinessReport | undefined;
  const result = await runRecoveryAttempt({
    root: context.projectRoot, record: file, attempt: { id: rec.id, startSha: rec.startSha }, model: AGENT.model, title: String(issue.title), baseSha, parentIid,
    repairPrompt: context.codePath('prompt.recover.md'), verifyPrompt: context.codePath('prompt.verify.md'),
    proof: { state: stateDir(), executionId: claimed.executionId!, requirementsHash: startVersion.hash },
    provenance: (sb) => provenance(sb, rec.container),
    promptArgs: {
      ISSUE_IID: iid, ISSUE_TITLE: String(issue.title), TICKET: ticket, BASE_BRANCH: base, BASE_SHA: baseSha, BRANCH: rec.branch,
      EVIDENCE_DIR: evidenceBox, CATALOGUE: catalogue.map((t) => `- #${t.iid} ${t.title}`).join("\n") || "(none)",
      ATTEMPT: String(seq), ATTEMPT_ID: rec.id, REPAIR_MINUTES: String(REPAIR_MINUTES),
      ADDITIVE_INSTRUCTIONS: context.additive.recovery.text,
    },
    verificationInstructions: context.additive.verification.text,
    previousRun: claimed, logs: [resolve(layout.logs, `recover-${iid}.log`)],
    delivery: { ciWaitMinutes: CONFIG.ciWaitMinutes, noCiMinutes: CONFIG.noPipelineMinutes, autoMerge: MERGE.auto },
    cancel: cancel.signal, deadlineMs: REPAIR_DEADLINE_MS,
  }, {
    clock: realClock,
    createSandbox: (spec) => createOwnedSandbox(spec, {
      image: IMAGE, setup: CONFIG.sandboxSetup, helpers: resolve(layout.helpers), env: readDotEnv(layout.env),
      uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000, proc: realProc, root: process.cwd(),
    }),
    containerGone: (name) => ownedContainerGone(name, realDocker),
    sandboxReadiness: async (sb) => {
      recoveryReport = await probeSandbox({ container: sb.id, state: stateDir(),
        identity: { projectRoot: context.projectRoot, runtimeIdentity: context.manifest.id, configIdentity: context.policyIdentity, contextFingerprint: context.policyIdentity },
        invocationId: rec.id, ticket: iid, baseline: baseSha, tip: rec.startSha, evidence: evidenceBox,
        uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000,
        files: { ...context.additive.recovery.hashes }, signal: cancel.signal });
      inputReport = recoveryReport;
      return sandboxReadinessHold(recoveryReport);
    },
    sandboxCleanup: (confirmed) => { if (recoveryReport) recordSandboxCleanup(stateDir(), recoveryReport, confirmed); },
    workspace: gitWorkspace,
    recheck, host,
    setStage: (patch) => setStage(iid!, patch),
    agent,
    log: (line) => console.log(line),
  });
  if (!result.cleanupPending) { entryCleanupConfirmed = true; runtimeLease.confirmedCleanup(); }
  finished = true;
  // The recovery claim stays in the admission record either way; settleRecovery releases it once the container is confirmed gone.
  if (result.outcome !== "delivered" || result.cleanupPending) {
    setStage(iid, { stage: "stopped", note: `recovery attempt ${seq} ${result.outcome}${result.cleanupPending ? " (cleanup pending)" : ""}: ${result.reason}` });
  }
  console.log(`recovery attempt ${seq}: ${result.outcome}${result.cleanupPending ? " (cleanup pending)" : ""}: ${result.reason}`);
  process.exit(result.outcome === "delivered" && !result.cleanupPending ? 0 : result.outcome === "interrupted" ? 143 : 1);
}

// Recovery has exited using its fixed role default. Normal work has no model/provider fallback.
// This lexical scope owns every normal launch handoff, including post-teardown delivery.
let custody: ReturnType<typeof beginPayloadCustody> | undefined;
let normalExit = 0;
let implementationOperations = 0;
async function normalRun(): Promise<void> {
function fail(msg: string): never { lastMessage = msg; throw Error(msg); }
if ('error' in picked) fail(`#${iid} ${picked.error} Not started.`);
const implementerModel = picked.model;
const branch = `${iid}-${slug}`;
const admissionReport = await projectLaunchReadiness({ ...hostReadinessInput, base });
inputReport = admissionReport;
const lateHold = readinessReason(admissionReport) ?? ticketWorkspaceProblem(context.projectRoot, branch);
if (lateHold) {
  if (!readinessReason(admissionReport)) recordTicketLaunch(stateDir(), admissionReport, Number(iid), lateHold);
  fail(`#${iid} held before admission: ${lateHold}`);
}

sh("git", ["fetch", "origin", base]);
const baseSha = sh("git", ["rev-parse", `origin/${base}`]);
if (sh("git", ["branch", "--list", branch]) || sh("git", ["ls-remote", "--heads", "origin", branch])) {
  fail(`Branch ${branch} already exists locally or on origin; preserve saved work and inspect this ticket's workspace.`);
}
// Static authority must survive host readiness and Git I/O before ANY claim/adoption.
if (ticketHash().hash !== startVersion.hash) fail('Ticket-input changed before admission; retry collection before launch');
const pendingRun=readRuns().find(r=>r.project===PROJECT && r.iid===iid);
if(process.env.FACTORY_LAUNCH_CLAIM && (!pendingRun?.acceptanceBaseline || !pendingRun.implementationBaseSha)) throw new AcceptanceBaselineHold('preparation-required');
const dispatchedOriginal=process.env.FACTORY_LAUNCH_CLAIM && pendingRun?.acceptanceBaseline && pendingRun.implementationBaseSha
  ? {sha:pendingRun.implementationBaseSha,admission:pendingRun.acceptanceBaseline} : undefined;
const acceptanceBaseline = await requireBaseline(dispatchedOriginal);
if (acceptanceBaseline.sha !== baseSha) throw new AcceptanceBaselineHold('changed-input');
setProject(PROJECT);
// Adopt dispatch ownership or atomically acquire a normal claim for a tokenless manual run.
let claimToken: string | undefined;
try {
  claimToken = adoptClaim(iid, stateDir(), effectiveConfig.dispatch.maxConcurrent);
} catch (e) {
  fail(`#${iid} not started: ${(e as Error).message}`);
}
currentIid = iid;
const executionId = claimToken ?? randomUUID();
context.assertScope(Number(iid),executionId);
// Recheck after claim adoption without silently substituting different prompt bytes.
if (ticketHash().hash !== startVersion.hash) fail('Ticket-input changed during admission; retry collection before launch');
saveTicketInput(inputEvidence(executionId), frozenInput);
setStage(iid, {
  title: String(issue.title), ticketUrl: tracker.ticketUrl(iid), branch, base, stage: "setup", startedAt: new Date().toISOString(), note: "",
  implementationModel: implementerModel, modelChoice: picked.choice,
  implementationBaseSha: baseSha, acceptanceBaseline, verification: undefined,
  executionId,
  evidenceDir: resolve(layout.evidence, iid, executionId), ticketHash: startVersion.hash,
  ticketInput: { hash: frozenInput.hash, renderedSha256: frozenInput.textHash }, verdict: undefined, mr: undefined,
  parentIid: parentIid === undefined ? undefined : String(parentIid), mergedAt: undefined,
  starting: undefined, // this run now owns the record the dispatcher reserved at launch
});
entryCleanupConfirmed = false;
runtimeLease.pendingCleanup();
custody = beginPayloadCustody(stateDir(), {
  project: { root: context.projectRoot, tracker: { kind: TRACKER.kind, host: (TRACKER.gitlabHost ?? TRACKER.host!).toLowerCase(), project: PROJECT } },
  key: keyFor(iid!, PROJECT), ticket: iid!, executionId, claim: claimToken!,
  runtime: { id: context.manifest.id, dependencies: context.manifest.dependencies },
  entry: managedEntry, lease: runtimeLease.token, owner: ownerOf(process.pid), baseline: baseSha, ticketHash: startVersion.hash,
});
setStage(iid, { payloadCustody: custody.pointer });
// Heartbeat so the board can tell a long agent run from a dead process.
setInterval(() => { if (!finished) setStage(iid!, {}); }, 60_000).unref();
console.log(`#${iid} ${issue.title}\n  branch ${branch} from origin/${base} (${baseSha.slice(0, 8)}), implementer ${implementerModel}`);

// ---- sandbox: one container + one site install shared by both runs -------------
const evidenceHost = resolve(layout.evidence, iid, executionId);
const evidenceBox = `/home/agent/evidence/${iid}/${executionId}`;
mkdirSync(evidenceHost, { recursive: true });
mkdirSync(resolve(layout.helpers), { recursive: true }); // mounted read-only at /opt/sandcastle; empty unless the project adds helpers
// A relaunched ticket (it was waiting on a blocker) must not pick up the last run's reports.
for (const f of ["blocked.json", "verdict.md"]) rmSync(resolve(evidenceHost, f), { force: true });

/** blocked.json from the implementer: tickets (or things) it needs that aren't merged yet. */
function readBlocked(): ImplementerBlocker[] | undefined {
  const file = resolve(evidenceHost, "blocked.json");
  if (!existsSync(file)) return undefined;
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')).blockers;
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

// Recheck after remote reads and host setup. A race here is explicit; no branch/worktree is adopted or removed.
const creationHold = ticketWorkspaceProblem(context.projectRoot, branch);
if (creationHold) {
  try { recordTicketLaunch(stateDir(), admissionReport, Number(iid), creationHold); }
  catch (error) { console.error(`Ticket readiness report write failed: ${(error as Error).message}`); }
  fail(`#${iid} workspace creation race: ${creationHold}`);
}
// The ownership receipt says what this run is about to create, before Sandcastle creates it (ownership.mts).
const tracked = TRACKER as { kind?: string; host?: string; gitlabHost?: string; project: string };
const receipt = recordIntent(stateDir(), {
  root: process.cwd(), tracker: { kind: tracked.kind ?? "gitlab", host: tracked.host ?? tracked.gitlabHost ?? "", project: PROJECT },
  ticket: iid, branch, base, implementationBaseSha: baseSha, runId: claimToken ?? randomUUID(), branchToCreate: true, worktreeToCreate: true,
});
context.assertCurrent();
entryCleanupConfirmed = false;
runtimeLease.pendingCleanup();
// Persist before invoking the SDK: a rejected/ambiguous create is still pending custody.
const payloadCreation = custody.pendingCreation();
const sandbox = await createSandbox({
  branch,
  baseBranch: `origin/${base}`,
  sandbox: docker({
    imageName: IMAGE,
    mounts: [
      { hostPath: evidenceHost, sandboxPath: evidenceBox },
      { hostPath: resolve(layout.helpers), sandboxPath: "/opt/sandcastle", readonly: true },
    ],
  }),
  hooks: {
    sandbox: {
      onSandboxReady: CONFIG.sandboxSetup,
    },
  },
});

custody.register(payloadCreation, sandbox);

const promptArgs = {
  ISSUE_IID: iid,
  ISSUE_TITLE: String(issue.title),
  TICKET: ticket,
  BASE_BRANCH: base,
  BASE_SHA: baseSha,
  BRANCH: branch,
  EVIDENCE_DIR: evidenceBox,
  CATALOGUE: catalogue.map((t) => `- #${t.iid} ${t.title}`).join("\n") || "(none)",
};

const recheck = () => {
  const hold = contextHold(context); if (hold) return hold;
  const nowParent = tracker.parentOf(Number(iid));
  if (nowParent !== parentIid) return 'Ticket parent changed; fresh verification required';
  const now = withParent(tracker.ticket(Number(iid)));
  if (now.state === 'closed') return `#${iid} is closed`;
  if (!['open', 'opened'].includes(now.state ?? '')) return `#${iid}'s eligibility is unknown`;
  if ((now.labels ?? []).some(l => l === LABELS.needsHuman || LABELS.exclude.includes(l))) return 'Ticket is excluded or needs human review';
  try {
    if (ticketHash().hash !== startVersion.hash) return 'Requirements changed; preserve code and evidence for fresh verification or explicit human review';
  } catch (e) { return (e as Error).message; }
  const record = readRuns().find(r => r.project === PROJECT && r.iid === iid);
  if (record?.executionId !== executionId || record.branch !== branch) return 'Execution identity changed';
  try {context.assertScope(Number(iid),executionId);} catch(e) {return (e as Error).message;}
  if (record.claim !== claimToken || readAdmission(stateDir()).claims[keyFor(iid!, PROJECT)]?.token !== claimToken) return 'Expected launch claim is no longer held';
  return undefined;
};
let verifiedProvenance: Provenance | undefined;
let verifierContainer = '';
let verificationRefusal: string | undefined;
let tip = "";
let blockers: ImplementerBlocker[] | undefined;
let sandboxReport: ReadinessReport | undefined;
let sandboxFailure: string | undefined;
const sandboxCancel = new AbortController();
const cancelSandbox = () => sandboxCancel.abort();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, cancelSandbox);
let noCommitMessage: string | undefined;
let noCommitSuperseded = false;
const diagnosticSessions = resolve(layout.diagnosticSessions, executionId);
try {
  const actualBase = sh('git', ['rev-parse', `refs/heads/${branch}`]);
  if (actualBase !== baseSha) throw Error('Branch creation baseline changed; refusing unverifiable implementation');
  fillReceipt(receipt, { branchSha: actualBase, worktreeAt: new Date().toISOString() });
  // Custom setup may break a previously good image. This log is not verifier evidence.
  const setupHold = await browserPreflight(sandbox, evidenceHost, 30000, 'setup-browser-preflight.log');
  if (setupHold) { lastMessage = setupHold; throw Error(setupHold); }
  sandboxReport = await probeSandbox({ container: sandbox.sandboxId ?? '', state: stateDir(),
    identity: { projectRoot: context.projectRoot, runtimeIdentity: context.manifest.id, configIdentity: context.policyIdentity, contextFingerprint: context.policyIdentity },
    invocationId: executionId, ticket: iid, baseline: baseSha, tip: baseSha, evidence: evidenceBox,
    uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000,
    files: { ...context.additive.implementation.hashes }, signal: sandboxCancel.signal });
  inputReport = sandboxReport;
  const sandboxHold = sandboxReadinessHold(sandboxReport);
  if (sandboxHold) throw Error(sandboxHold);
  sandboxCancel.signal.throwIfAborted();
  // ---- 1. implementer ----------------------------------------------------------
  setStage(iid, { stage: "implementing" });
  const implementer = pi(implementerModel, { thinking: AGENT.thinking, env: piEnvFor(implementerModel, openaiCredential), sessionStorage: { hostSessionsDir: diagnosticSessions } });
  // The first turn keeps its existing idle limit. Resume may only spend the remainder of one
  // such window measured from the first start; a long, productive first turn earns no resume.
  const deadline = performance.now() + 600_000;
  const initial = await sandbox.run({
    agent: implementer,
    promptFile: context.codePath('prompt.md'),
    promptArgs: { ...promptArgs, ADDITIVE_INSTRUCTIONS: context.additive.implementation.text,
      EXECUTION_ID: executionId, IMPLEMENTATION_OUTCOME_FILE: outcomeFile('initial') },
    maxIterations: 1,
    completionSignal: [], // Wait for natural process exit, never force-complete on an agent marker.
    name: 'implementer', signal: sandboxCancel.signal,
  });
  const runImplementationBoundary = async <T,>(signal: AbortSignal, start: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    implementationOperations++;
    const work = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return start();
    }).finally(() => { implementationOperations--; });
    return waitForContinuation(work, signal);
  };
  const implementationExec = async (command: string, signal = sandboxCancel.signal) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(Error('implementation Git probe timed out')), 30_000);
    try { return await runImplementationBoundary(AbortSignal.any([signal, timeout.signal]), () => sandbox.exec(command)); }
    finally { clearTimeout(timer); }
  };
  const observeTip = async (signal?: AbortSignal) => {
    const head = await implementationExec('git rev-parse --verify HEAD', signal);
    const sha = head.stdout.trim();
    if (head.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(sha) || [baseSha, sha].some(id => spawnSync('git', ['cat-file', '-e', `${id}^{commit}`]).status !== 0)) {
      throw Error('Missing historical verification baseline or tip Git object; verifier not started. Preserve work for restored-baseline verification or explicit human review.');
    }
    if (sh('git', ['rev-parse', '--verify', `refs/heads/${branch}`]) !== sha || spawnSync('git', ['merge-base', '--is-ancestor', baseSha, sha]).status !== 0) {
      throw Error('Implementation tip does not match the owned branch and original baseline; verifier not started.');
    }
    return sha;
  };
  const ownedCheckout = async (signal: AbortSignal) => {
    const ref = await implementationExec('git symbolic-ref -q HEAD', signal);
    return ref.exitCode === 0 && ref.stdout.trim() === `refs/heads/${branch}`;
  };
  const statusArgs = ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none'];
  const worktreeState = async (signal = sandboxCancel.signal): Promise<'dirty' | 'clean' | 'unknown'> => {
    try {
      const status = await implementationExec(`git ${statusArgs.join(' ')}`, signal);
      if (status.exitCode === 0) return status.stdout.trim() ? 'dirty' : 'clean';
    } catch { signal.throwIfAborted(); /* An unreadable fact otherwise stays unknown. */ }
    return 'unknown';
  };
  const observeZeroCommit = async (result: typeof initial, turn: ImplementationTurn, signal?: AbortSignal) => {
    const dependency = readBlocked();
    const worktree = await worktreeState(signal);
    const outcome = readImplementationOutcome(evidenceHost, executionId, turn);
    const report = diagnostic(executionId, worktree, dependency !== undefined, finalReply(result, diagnosticSessions), result.logFilePath);
    return { report, outcome, dependency };
  };
  tip = await observeTip();
  sandboxCancel.signal.throwIfAborted();
  if ((tip === baseSha) !== (initial.commits.length === 0)) throw Error('SDK commit report disagrees with the owned Git baseline; verifier not started.');
  if (tip === baseSha) {
    diagnosticExecutionId = executionId;
    let attempt = await observeZeroCommit(initial, 'initial');
    const resume = initial.resume;
    let refusal = continuationRefusal({ outcome: attempt.outcome, worktree: attempt.report.worktree,
      dependencyReport: attempt.dependency !== undefined, zeroCommits: initial.commits.length === 0,
      replyCaptured: !!attempt.report.agentReply, canResume: typeof resume === 'function',
      cancelled: sandboxCancel.signal.aborted, remainingMs: deadline - performance.now() });
    if (!refusal && resume) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(Error('shared implementation time expired')), Math.max(0, deadline - performance.now()));
      const signal = AbortSignal.any([sandboxCancel.signal, timeout.signal]);
      try {
        try {
          if (!(await ownedCheckout(signal)) || await observeTip(signal) !== baseSha || await worktreeState(signal) !== 'clean') {
            refusal = 'continuation refused: clean original checkout no longer confirmed';
          }
          const hold = refusal ? undefined : recheck();
          const hostCheckout = ['-C', sandbox.worktreePath];
          if (hold) refusal = `continuation refused: ${sanitizeReply(hold)}`;
          if (!refusal && (sh('git', [...hostCheckout, 'symbolic-ref', '-q', 'HEAD']) !== `refs/heads/${branch}`
            || sh('git', [...hostCheckout, 'rev-parse', 'HEAD']) !== baseSha || sh('git', [...hostCheckout, ...statusArgs]) || readBlocked() !== undefined)) {
            refusal = 'continuation refused: host checkout or dependency report changed';
          }
          if (!refusal && (signal.aborted || deadline - performance.now() < 1)) refusal = 'continuation refused: cancellation or shared implementation time exhausted';
          if (!refusal) {
            saveDiagnostic(evidenceHost, { ...attempt.report, outcome: attempt.outcome, evidence: 'implementation-initial-diagnostic.json',
              automaticAction: 'Initial turn only; the host may reserve one same-session continuation.' });
            custody.reserveImplementationContinuation(payloadCreation);
          }
        } catch { refusal = 'continuation refused: eligibility, diagnostic or durable reservation unavailable'; }
        if (!refusal) {
          noCommitMessage = 'Initial implementation made zero commits; see implementation-initial-diagnostic.json. Continuation reserved; final Git state unconfirmed.';
          try {
            if (deadline - performance.now() < 1) throw Error('shared implementation time expired before resume');
            const continued = await runImplementationBoundary(signal, () => resume(
              `Continue this same ticket. Exploration and unchanged baseline checks did not implement it. Make the smallest focused change, run targeted checks and commit it, or report a concrete blocker. Follow the same outcome schema with executionId ${executionId}, turn continuation, and write it to ${evidenceBox}/${outcomeFile('continuation')}. Return normally; do not emit a completion marker.`,
              { name: 'implementer-continuation', signal, completionSignal: [] },
            ));
            tip = await observeTip(signal);
            const commits = sh('git', ['rev-list', `${baseSha}..${tip}`]).split('\n').filter(Boolean).sort();
            if (!(await ownedCheckout(signal)) || JSON.stringify(commits) !== JSON.stringify(continued.commits.map(c => c.sha).sort())) {
              throw Error('resumed SDK commit report disagrees with the owned checkout and original Git baseline');
            }
            if (tip === baseSha) {
              attempt = await observeZeroCommit(continued, 'continuation', signal);
              refusal = 'continuation-exhausted: no commits against the original baseline';
            }
            signal.throwIfAborted();
            noCommitMessage = undefined;
          } catch (error) {
            throw Error(`continuation-exhausted: ${sanitizeReply(error instanceof Error ? error.message : String(error))}`);
          }
        }
      } finally { clearTimeout(timer); }
    }
    if (tip === baseSha) {
      blockers = attempt.dependency;
      const report = { ...attempt.report, outcome: attempt.outcome, continuation: refusal };
      noCommitMessage = diagnosticText(report);
      try { saveDiagnostic(evidenceHost, report); }
      catch { noCommitMessage = diagnosticText(report, false) + ' Diagnostic evidence publication unavailable.'; }
      lastMessage = noCommitMessage;
      const current = readRuns().find(r => r.project === PROJECT && r.iid === iid);
      noCommitSuperseded = current?.executionId !== executionId || current.claim !== claimToken;
      if (noCommitSuperseded) finished = true; // Never overwrite a newer execution on exit.
      else setStage(iid, { note: noCommitMessage });
    }
  }
  sandboxCancel.signal.throwIfAborted();
  if (tip !== baseSha) {
    // The real diff replaces the predicted footprint for conflict checks from now on.
    patchManifest(PROJECT, Number(iid), { actualFootprint: sh("git", ["diff", "--name-only", `${baseSha}...${tip}`]).split("\n").filter(Boolean) });

    // ---- 2. verifier (handoff.mts) -----------------------------------------------
    verificationRefusal = recheck();
    if (!verificationRefusal) {
      sh('git', ['cat-file', '-e', `${baseSha}^{commit}`]);
      sh('git', ['cat-file', '-e', `${tip}^{commit}`]);
      verifierContainer = sandbox.sandboxId ?? '';
      verifiedProvenance = await provenance(sandbox, verifierContainer);
      verificationRefusal = await runVerifier(sandbox, { setStage }, { iid, evidenceHost, agent: agent(AGENT.model), promptArgs: { ...promptArgs, ADDITIVE_INSTRUCTIONS: context.additive.verification.text }, tip });
    }
  }
} catch (error) {
  sandboxFailure = error instanceof Error ? error.message : String(error);
} finally {
  const cleanup = await custody.close(payloadCreation, sandbox);
  // Container absence does not close the still-running normal delivery/launch scope.
  if (cleanup.reason) sandboxFailure = [sandboxFailure, noCommitMessage ? sanitizeReply(cleanup.reason) : cleanup.reason].filter(Boolean).join('; ');
  if (sandboxReport) {
    try { recordSandboxCleanup(stateDir(), sandboxReport, cleanup.confirmed); }
    catch (error) { sandboxFailure = [sandboxFailure, `Readiness cleanup publication failed: ${(error as Error).message}`].filter(Boolean).join('; '); }
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.off(sig, cancelSandbox);
}
if (implementationOperations) sandboxFailure = [sandboxFailure, 'Implementation SDK or Git work did not settle; launch and cleanup ownership retained'].filter(Boolean).join('; ');
if (sandboxFailure) fail([noCommitMessage, sandboxFailure].filter(Boolean).join(' '));
if (verificationRefusal) fail(verificationRefusal);
if (noCommitMessage) {
  const current = readRuns().find(r => r.project === PROJECT && r.iid === iid);
  noCommitSuperseded ||= current?.executionId !== executionId || current.claim !== claimToken;
  noCommitSuperseded ||= readAdmission(stateDir()).claims[keyFor(iid!, PROJECT)]?.token !== claimToken;
  if (noCommitSuperseded) { finished = true; fail('No-commit execution was superseded; diagnostic retained only under its original execution.'); }
}
if (noCommitMessage && !blockers) fail(noCommitMessage);

// ---- implementer reported a missing prerequisite ----------------------------------
if (blockers) {
  const dependency = (b: number) => dependencyState(b, {
    ticket: tracker.ticket,
    run: (id) => readRuns().find((r) => r.project === PROJECT && r.iid === String(id)),
    mergedInto: tracker.mergedInto, base,
  });
  const what = blockers.map((b) => `${b.iid != null ? `#${b.iid}` : "no ticket"}: ${b.what}`).join("; ");
  const dependencyCache = new Map<number, DependencyResult>();
  const outcome = blockedOutcome(Number(iid), blockers, (b) => {
    if (!dependencyCache.has(b)) dependencyCache.set(b, dependency(b));
    return dependencyCache.get(b)!;
  });
  if (outcome === "needs-human") {
    tracker.addLabel(Number(iid), LABELS.needsHuman);
    tracker.comment(iid, [
      `## Sandcastle: blocked`,
      `The implementer couldn't do this ticket, and the blocker isn't one Sandcastle can wait for (no open ticket provides it, or that ticket is already merged or closed). Labelled \`${LABELS.needsHuman}\`.`,
      ...blockers.map((b) => `- ${b.iid != null ? `#${b.iid}` : "No ticket"}: ${b.what}. ${b.evidence}`),
      SANDCASTLE_MARK,
    ].join("\n\n"));
    fail(`${noCommitMessage ?? ''} Blocked (${what}); labelled ${LABELS.needsHuman}.`);
  }
  patchManifest(PROJECT, Number(iid), { implementerBlockers: blockers });
  // Remove the empty branch so the dispatcher can relaunch the ticket once the blocker merges.
  try {
    sh("git", ["branch", "-D", branch]);
  } catch {
    fail(`${noCommitMessage ?? ''} Blocked (${what}), but branch ${branch} could not be deleted (worktree left behind?). Delete it to let the ticket run again.`);
  }
  finished = true;
  setStage(iid, { stage: "waiting", note: `${noCommitMessage ?? ''} implementer: needs ${what}${[...dependencyCache.values()].some((r) => r.state === "unknown") ? "; dependency information unavailable, will retry" : ""}` });
  console.log(`#${iid} waits on ${what}. The dispatcher relaunches it once that is merged.`);
  return;
}

// ---- 3. post evidence to the ticket (host-side) -----------------------------------
setStage(iid, { stage: "posting" });
const identity = { project: PROJECT, ticket: iid, executionId, branch, base, baseline: baseSha, tip, requirementsHash: startVersion.hash };
const frozen = createProof(stateDir(), evidenceHost, identity, verifiedProvenance!);
setStage(iid, { verification: { id: frozen.id, tip, requirementsHash: startVersion.hash } });
// ---- 3-4. post evidence, then on PASS push and deliver (handoff.mts) ----------------
const outcome = await postAndDeliver({
  iid, project: PROJECT, branch, base, baseSha, tip, title: String(issue.title), evidenceHost, parentIid, origin: { kind: "implemented" },
  identity, proofId: frozen.id, state: stateDir(), recheck,
  noPush: opts["no-push"], ciWaitMinutes: CONFIG.ciWaitMinutes, noCiMinutes: CONFIG.noPipelineMinutes, autoMerge: MERGE.auto,
}, host);
if (!outcome.ok) fail(outcome.reason);
finished = true;
if (!outcome.pushed) {
  console.log(`--no-push: stopping. Branch ${branch} is ready locally.`);
  return;
}
const next = parentIid === undefined ? `moves #${iid} to ${LABELS.done}` : `closes Task #${iid}`;
console.log(outcome.merged ? `Merged after CI passed. The next dispatcher pass ${next}.` : `Not merged. Once you merge it, the dispatcher ${next}.`);
}
try { await normalRun(); }
catch (error) { normalExit = 1; lastMessage = (error as Error).message; console.error(lastMessage); }
finally {
  if (custody) {
    try {
      // Deadline/cancellation may beat SDK work or a Git probe; container absence alone cannot settle that call.
      if (implementationOperations) throw Error('Implementation SDK or Git work did not settle; launch and cleanup ownership retained');
      custody.finish(); // No payload or launch continuation remains in this scope.
      entryCleanupConfirmed = true;
      runtimeLease.confirmedCleanup();
    } catch (error) {
      normalExit = 1; console.error(`Normal payload custody held: ${(error as Error).message}`);
      // Never repair, release a lease or infer cleanup from controller death.
    }
  }
}
// Preserve complete-workflow module continuation; active handles still retain entry/lease ownership until actual exit.
process.exitCode = normalExit;
