// Runtime-owned independent verification retains browser, immutable-proof and exact-SHA delivery gates; scoped guidance requires fresh candidate analysis.
import { browserPreflight } from './capabilities.mts';
export { browserPreflight, BROWSER_PROBE } from './capabilities.mts';
// #153: persist exact opened PR identity before CI; later delivery results retain the original host proof.
import type { DeliveryCheckpoint } from './delivery.mts';
// #149: recovery holds on shared unknown dependency results and sanitized reasons.
import type { DependencyResult } from "./dependencies.mts";
// #150: only host-frozen structured proof can authorize publication, exact-SHA push and merge.
import { existsSync, rmSync, writeFileSync } from "node:fs";
const {gateProofHold}=await import(existsSync(new URL('./supervisor-gate-apply.mts',import.meta.url))?'./supervisor-gate-apply.mts':'../cli/src/supervisor-gate-apply.mts');
import { readProof, validateEvidence } from './verification.mts';
import type { Identity } from './verification.mts';
import { sha256 } from './verification.mts';
import { ticketContextHash, renderTicketContext } from './ticket-context.mts';
import { resolve } from "node:path";
import { fileURLToPath } from 'node:url';
import type { RunState } from "./board.mts";
import { edgesOf, SANDCASTLE_MARK } from "./graph.mts";
import type { Manifest } from "./graph.mts";
import type { Delivered, Delivery } from "./tracker.mts";

// Browser preflight owns its process group with a Node watchdog, independent of host timeout implementations.
// It kills descendants on deadline and leader exit, and records success only after browser cleanup.
// The hand-off every branch goes through before it leaves the host: the independent verifier, then evidence posted to
// the ticket, then on PASS push and normal delivery (tracker.deliver: an MR on GitLab, a PR merged after CI on GitHub
// with MERGE.auto). Blocked merge gates leave the run waiting for a person. main.mts calls it after its implementer; a recovery run (slice four) calls the same functions after
// its repair agent. Recovery can compare behavior against the validated attempt start, but refuses Git replacement
// refs so proof still names the actual tree. The historical base, PASS gate, push and delivery limits remain unchanged. Two things protect a run
// that reuses a ticket's record and evidence folder (a recovery attempt on a preserved branch): beginVerification
// removes an earlier verdict.md and clears the record's verdict/PR before the verifier starts, so only this run's
// verdict can count and a stale PASS never reads as delivery (cli/src/recovery-state.mts deliveryMarker); and the PR
// description says the branch was repaired by which recovery attempt. prerequisiteHold (#75) is the recovery run's
// recheck, before verification and again before delivery, of the dependency holds the dispatcher's ticket analysis
// records (manifests: analysed requirements and implementer-reported blockers): any prerequisite not yet closed or
// merged, whether in flight or waiting in an open PR, holds the ticket; a missing or out-of-date analysis, or a lookup
// that fails, is unknown and holds it too. Live tracker/Git calls are passed in (Host); the import-safe supervisor
// journal additionally binds scoped frozen proof to its exact amendment. Imports start no worker or external I/O.
// Posting is one adapter operation: GitHub attaches native media, GitLab uploads then comments.
// A posting error retains local evidence and stops before the PASS/no-push and delivery gates. Both verifier paths
// first launch the globally installed browser as the sandbox user and retain a bounded provisioning log.

/** What the hand-off needs from the host: board, tracker and git. main.mts passes the real ones. */
export interface Host {
  setStage(iid: string, patch: Partial<RunState>): void;
  readRuns(): RunState[];
  /** A run whose branch may still merge (board TERMINAL/PARKED rules): its conflicts are listed in the PR. */
  live(run: RunState, openMrs: Set<string>): boolean;
  /** git on the host checkout; throws on failure like execFileSync. */
  git(args: string[]): string;
  /** git returning its exit status instead of throwing (rev-parse --verify, merge-tree). */
  gitStatus(args: string[]): { status: number | null; stdout: string };
  tracker: {
    postVerification(iid: string, tip: string, files: string[], body: (media: string[]) => string): void;
    openMrBranches(): Set<string>;
    deliver(d: Delivery & { waitMinutes: number; noCiMinutes: number; autoMerge: boolean }): Promise<Delivered>;
  };
}

/** The bit of a Sandcastle sandbox the verifier needs. */
export interface VerifierSandbox {
  run(o: { agent: unknown; promptFile: string; promptArgs: Record<string, string>; maxIterations: number; completionSignal: string; name: string }): Promise<{ commits: unknown[] }>;
  exec(cmd: string): Promise<{ stdout: string; stderr?: string; exitCode?: number }>;
  worktreePath?: string;
}

/** Who produced the branch: the normal implementer, or a recovery attempt's repair agent. */
export type Origin = { kind: "implemented" } | { kind: "repaired"; attempt: number };

export const VERIFY_PROMPT = fileURLToPath(new URL('./prompt.verify.md', import.meta.url));

/** Clear what an earlier run of this ticket left that could pass for this run's verdict, then mark the record verifying. */
export function beginVerification(host: Pick<Host, "setStage">, iid: string, evidenceHost: string): void {
  for (const name of ['verdict.md', 'verification.json']) rmSync(resolve(evidenceHost, name), { force: true });
  host.setStage(iid, { stage: "verifying", verdict: undefined, verification: undefined, delivery: undefined, mr: undefined, mergedAt: undefined });
}

const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const rawGit = (sandbox: VerifierSandbox, args: string) => sandbox.exec(`GIT_GRAFT_FILE=/dev/null git --no-replace-objects ${args}`);

async function replacementHold(sandbox: VerifierSandbox): Promise<string | undefined> {
  // A replacement can change the checked tree without changing HEAD or making ordinary status dirty.
  const refs = await rawGit(sandbox, `for-each-ref --count=1 --format='%(refname)' refs/replace`);
  if (refs.exitCode !== 0) return 'Could not rule out Git replacement refs in the recovery workspace';
  if (refs.stdout.trim()) return 'Git replacement refs are not allowed in the recovery workspace';
}

async function recoveryComparisonHold(sandbox: VerifierSandbox, baseline: string, start: string, tip: string): Promise<string | undefined> {
  const git = (args: string) => rawGit(sandbox, args);
  const replacement = await replacementHold(sandbox);
  if (replacement) return replacement;
  for (const [role, sha] of [['implementation baseline', baseline], ['pre-repair start', start], ['repaired tip', tip]]) {
    if (!objectId.test(sha)) return `Invalid recorded ${role} SHA; verifier not started`;
    const object = await git(`rev-parse --verify ${sha}^{commit}`);
    if (object.exitCode !== 0 || object.stdout.trim() !== sha) return `Missing exact ${role} commit ${sha}; verifier not started`;
  }
  if ((await git(`merge-base --is-ancestor ${baseline} ${start}`)).exitCode !== 0
    || (await git(`merge-base --is-ancestor ${start} ${tip}`)).exitCode !== 0) {
    return 'Recorded implementation baseline, pre-repair start and repaired tip do not form the expected ancestry; verifier not started';
  }
  const head = await git('rev-parse --verify HEAD');
  if (head.exitCode !== 0 || head.stdout.trim() !== tip) return 'Verifier workspace HEAD is not the exact repaired tip; verifier not started';
  const status = await git('status --porcelain --untracked-files=all');
  if (status.exitCode !== 0 || status.stdout.trim()) return 'Verifier workspace is not clean against the raw repaired tip; verifier not started';
}

/** Run the independent verifier on `tip` in the run's sandbox. Returns why the result can't be used, or undefined. */
export async function runVerifier(sandbox: VerifierSandbox, host: Pick<Host, "setStage">,
  o: { iid: string; evidenceHost: string; agent: unknown; promptArgs: Record<string, string>; tip: string; promptFile?: string;
    /** Host-retained original criterion IDs; candidate/repair reports cannot select this inventory. */
    criterionIds?: readonly string[];
    /** Only the owned recovery runner sets this, from the admitted attempt and historical baseline. */
    recoveryComparison?: { baseline: string; start: string };
    execution?: { context: import('./context.mts').ExecutionContext; runId: string; manifest: Manifest; requirementsHash: string; input?: import('./ticket-input.mts').FrozenTicketInput } }): Promise<string | undefined> {
  const current = () => {
    const e=o.execution;if(!e)return;
    e.context.assertScope(Number(o.iid),e.runId);e.context.assertCurrent();
    const gate=e.context.identity.gate;
    if (gate && (e.manifest.policyIdentity!==e.context.policyIdentity || e.manifest.hash!==e.requirementsHash || e.manifest.baseSha!==o.tip
      || e.manifest.iid!==Number(o.iid) || e.manifest.project!==e.context.config.TRACKER.project)) throw Error('Scoped gate correction requires fresh exact-candidate execution analysis');
    if(gate && (e.requirementsHash!==gate.ticketInput || !e.input || ticketContextHash(e.input.context)!==gate.ticketInput || e.input.hash!==gate.ticketInput
      || sha256(e.input.text)!==e.input.textHash || renderTicketContext(e.input.context)!==e.input.text || o.promptArgs.TICKET!==e.input.text
      || o.promptArgs.ADDITIVE_INSTRUCTIONS!==e.context.additive.verification.text || sandbox.worktreePath!==gate.workspace || o.tip!==gate.candidate
      || o.promptFile!==undefined && o.promptFile!==e.context.codePath('prompt.verify.md'))) throw Error('Scoped verifier requires exact reviewed input, owned candidate and corrected instructions');
  };
  try {current();} catch(e) {return (e as Error).message;}
  if(o.execution?.context.identity.gate && ['verdict.md','verification.json'].some(name=>existsSync(resolve(o.evidenceHost,name))))
    return 'Scoped gate correction requires a fresh evidence directory; retain previous FAIL/INCONCLUSIVE/proof';
  beginVerification(host, o.iid, o.evidenceHost);
  const preflight = await browserPreflight(sandbox, o.evidenceHost);
  if (preflight) return preflight;
  const comparison = o.recoveryComparison;
  if (comparison) {
    const hold = await recoveryComparisonHold(sandbox, comparison.baseline, comparison.start, o.tip);
    if (hold) return hold;
  }
  const ver = await sandbox.run({
    agent: o.agent,
    promptFile: o.execution?.context.identity.gate ? o.execution.context.codePath('prompt.verify.md') : o.promptFile ?? VERIFY_PROMPT,
    promptArgs: { ...o.promptArgs, TIP_SHA: o.tip, RECOVERY_START_SHA: comparison?.start ?? '(none)',
      ACCEPTANCE_CRITERIA: o.criterionIds === undefined ? '(not supplied; evaluate every original ticket requirement)' : JSON.stringify(o.criterionIds),
      ...(comparison ? { BASE_SHA: comparison.baseline } : {}) },
    maxIterations: 1,
    completionSignal: "<promise>COMPLETE</promise>",
    name: "verifier",
  });
  if (comparison) {
    const hold = await replacementHold(sandbox);
    if (hold) return `${hold}; not posting or pushing`;
  }
  const headResult = comparison ? await rawGit(sandbox, 'rev-parse --verify HEAD') : await sandbox.exec('git rev-parse HEAD');
  const dirtyResult = comparison ? await rawGit(sandbox, 'status --porcelain --untracked-files=all') : await sandbox.exec('git status --porcelain');
  const ok = (result: { exitCode?: number }) => result.exitCode === 0 || (!comparison && result.exitCode === undefined);
  if (!ok(headResult) || !ok(dirtyResult)) return 'Verifier immutability checks could not be completed; not posting or pushing';
  const after = headResult.stdout.trim();
  const dirty = dirtyResult.stdout.trim();
  if (ver.commits.length || after !== o.tip || dirty) {
    return `Verifier changed the branch (commits=${ver.commits.length}, head=${after.slice(0, 8)}, dirty=${!!dirty}). Not posting or pushing; inspect ${sandbox.worktreePath ?? "the worktree"}.`;
  }
  try { current(); validateEvidence(o.evidenceHost, o.criterionIds); }
  catch (e) { return `${(e as Error).message}. Retain evidence in ${o.evidenceHost}; custom verifier prompts must be explicitly upgraded to write verification.json (policy 1).`; }
  return undefined;
}

export interface Handoff {
  iid: string;
  project: string;
  /** Host-owned identity and proof, never obtained from agent reports. */
  identity: Identity;
  proofId: string;
  /** Original host inventory retained through freezing and each delivery authorization. */
  criterionIds?: readonly string[];
  state: string;
  /** Fail closed: undefined means authorized; a reason or exception refuses the operation. */
  recheck: () => string | undefined;
  branch: string;
  base: string;
  baseSha: string;
  tip: string;
  title: string;
  evidenceHost: string;
  parentIid?: number;
  origin: Origin;
  /** Markdown said in the PR when the ticket changed during the run; "" when it did not. */
  staleNote?: string;
  noPush?: boolean;
  ciWaitMinutes: number;
  noCiMinutes: number;
  autoMerge: boolean;
}

export type Outcome =
  | { ok: true; verdict: "PASS"; pushed: false; note: string }
  | { ok: true; verdict: "PASS"; pushed: true; url: string; merged: boolean }
  | { ok: false; verdict?: string; reason: string };

/** Steps 3 and 4: post the verifier's evidence to the ticket, then on PASS push and deliver. Leaves the record `done`
 *  with verdict and PR on success; on failure returns the reason (the caller ends the run, as `stopped`). */
export async function postAndDeliver(h: Handoff, host: Host): Promise<Outcome> {
  const { iid, branch, base, tip } = h;
  host.setStage(iid, { stage: "posting" });
  const authorize = (): string | undefined => {
    try {
      if (h.identity.project !== h.project || h.identity.ticket !== iid || h.identity.tip !== tip || h.identity.baseline !== h.baseSha || h.identity.branch !== branch || h.identity.base !== base) return 'handoff identity mismatch';
      const frozen = readProof(h.state, h.identity, h.proofId, h.criterionIds);
      const gateHold=gateProofHold(h.state,frozen.proof);if(gateHold)return gateHold;
      return h.recheck();
    } catch (e) { return `Verification authorization failed: ${(e as Error).message}`; }
  };
  const refusal = authorize();
  if (refusal) return { ok: false, reason: refusal };
  const frozen = readProof(h.state, h.identity, h.proofId, h.criterionIds);
  const { verdictText } = frozen;
  const verdict = frozen.report.verdict;
  const repaired = h.origin.kind === "repaired" ? `Repaired by Factory recovery attempt ${h.origin.attempt}, then verified independently.` : "";

  const media = (label: string) => frozen.artifacts.filter(a => a.phase === label && a.kind !== 'command-output').map(a => a.path);
  const shown = [...media('before'), ...media('after'), ...media('check')];
  try {
    host.tracker.postVerification(iid, tip, shown.map((f) => resolve(frozen.root, f)), (markdown) => {
      const uploaded = new Map(markdown.map((md, i) => [shown[i], md]));
      const section = (label: string, title: string) => {
        const items = media(label).map((f) => `**${f}**\n\n${uploaded.get(f)}`);
        return items.length ? `### ${title}\n\n${items.join("\n\n")}` : "";
      };
      return [
        `## Sandcastle verification: ${verdict}`,
        `Branch \`${branch}\` @ \`${tip.slice(0, 8)}\` (from \`${base}\` @ \`${h.baseSha.slice(0, 8)}\`). Synthetic data.`,
        repaired,
        verdictText.replace(/^VERDICT:.*\n?/, ""),
        section("before", "Before"),
        section("after", "After"),
        section("check", "Checks"),
        SANDCASTLE_MARK,
      ].filter(Boolean).join("\n\n");
    });
  } catch (e) {
    return { ok: false, verdict, reason: `Verification posting failed: ${(e as Error).message}. Evidence retained in ${h.evidenceHost}; nothing pushed or delivered. Check tracker CLI upload support and repository permissions before retrying.` };
  }
  console.log(`Evidence posted to #${iid} (verdict ${verdict}).`);
  host.setStage(iid, { verdict });

  if (verdict !== "PASS") return { ok: false, verdict, reason: `Verdict ${verdict}: branch ${branch} kept locally, not pushed. Review the ticket comment.` };
  if (h.noPush) {
    const note = "--no-push: branch ready locally";
    host.setStage(iid, { stage: "done", note });
    return { ok: true, verdict, pushed: false, note };
  }

  host.setStage(iid, { stage: "pushing" });
  try {
    const refused = authorize();
    if (refused) return { ok: false, verdict, reason: refused };
    if (host.git(['rev-parse', `refs/heads/${branch}`]).trim() !== tip) return { ok: false, verdict, reason: `Local branch ${branch} moved from verified tip; nothing pushed.` };
    host.git(["push", "origin", `${tip}:refs/heads/${branch}`]);
    const remote = host.git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).trim().split(/\s+/)[0];
    if (remote !== tip) return { ok: false, verdict, reason: 'Remote branch does not match verified tip; not delivering.' };
  } catch (e) {
    return { ok: false, verdict, reason: `Push of ${branch} failed: ${(e as Error).message}` };
  }
  const sha = tip;

  // Exact conflicts with the other live Sandcastle branches, so you know which MR to merge first.
  const openMrs = host.tracker.openMrBranches();
  const conflicts = host.readRuns()
    .filter((r) => r.project === h.project && r.iid !== iid && r.branch && host.live(r, openMrs))
    .filter((r) => host.gitStatus(["rev-parse", "--verify", "--quiet", r.branch!]).status === 0)
    .flatMap((r) => {
      const res = host.gitStatus(["merge-tree", "--write-tree", "--name-only", "--no-messages", branch, r.branch!]);
      if (res.status !== 1) return [];
      const files = [...new Set(res.stdout.trim().split("\n").slice(1).filter(Boolean))];
      return [`- #${r.iid} (\`${r.branch}\`${r.mr ? `, ${r.mr}` : ""}): ${files.map((f) => `\`${f}\``).join(", ")}`];
    });
  const body = (ciNote: string) => [
    h.parentIid === undefined ? `Refs #${iid}` : `Refs #${iid} (Task of #${h.parentIid})`,
    repaired
      ? `${repaired} Verdict: **${verdict}** (evidence in the ticket comment).`
      : `Implemented and verified by Sandcastle. Verdict: **${verdict}** (evidence in the ticket comment).`,
    ciNote,
    h.staleNote ?? "",
    conflicts.length ? `**Conflicts with other open Sandcastle work.** Merge one, then rebase the other:\n\n${conflicts.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  let delivered: Delivered;
  let checkpoint: DeliveryCheckpoint | undefined;
  try {
    delivered = await host.tracker.deliver({
      onOpened: identity => {
        checkpoint = { ...identity, version: 1, proofId: h.proofId, project: h.project, ticket: iid, executionId: h.identity.executionId,
          state: h.autoMerge ? 'ci-waiting' : 'operator-required', reasonCode: h.autoMerge ? 'opened' : 'authorization', observedAt: new Date().toISOString() };
        host.setStage(iid, { delivery: checkpoint, mr: identity.url });
      },
      branch, base, sha, title: `#${iid}: ${h.title}`, body, onStage: (stage) => host.setStage(iid, { stage }),
      beforeMerge: () => {
        const refused = authorize();
        if (refused) return refused;
        const remote = host.git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).trim().split(/\s+/)[0];
        return remote === tip ? undefined : 'Remote branch moved from verified tip';
      },
      waitMinutes: h.ciWaitMinutes, noCiMinutes: h.noCiMinutes, autoMerge: h.autoMerge,
    });
  } catch (e) {
    return { ok: false, verdict, reason: (e as Error).message };
  }
  if (checkpoint) {
    const mergedAt = delivered.merged ? delivered.mergedAt ?? new Date().toISOString() : undefined;
    checkpoint = { ...checkpoint, state: delivered.merged ? 'merged' : delivered.state === 'ci-waiting' ? 'ci-waiting' : 'operator-required',
      reasonCode: delivered.merged ? 'merged' : delivered.reasonCode ?? 'merge-restricted', observedAt: new Date().toISOString(), ...(mergedAt ? { mergedAt } : {}) };
  }
  host.setStage(iid, {
    ...(checkpoint ? { delivery: checkpoint } : {}),
    stage: delivered.blocked ? "waiting" : "done", mr: delivered.url,
    note: delivered.blocked ? `${delivered.state === 'ci-waiting' ? 'Pending CI' : 'Waiting for a person'}: ${delivered.blocked}` : delivered.merged ? "merged after CI passed" : "",
  });
  return { ok: true, verdict, pushed: true, url: delivered.url, merged: delivered.merged };
}

/** What prerequisiteHold reads, from the host: the ticket's analysis and live lookups. */
export interface PrerequisiteView {
  /** The dispatcher's analysis of the ticket (its manifest), if any. */
  manifest: Manifest | undefined;
  /** Complete included child/parent source hash, matching the frozen agent input, to reject stale analysis. */
  hash: string;
  policyIdentity?: string;
  /** Shared dependency evidence. Unknown and thrown reads both hold recovery. */
  dependency(iid: number): DependencyResult;
  /** Why prerequisite `iid` is still active (a run in flight, an open PR), or undefined. May throw: unknown. */
  active(iid: number): string | undefined;
}

/** Why ticket `iid` is held by a prerequisite (or by not knowing its prerequisites), or undefined when it is free. */
export function prerequisiteHold(iid: number, v: PrerequisiteView): string | undefined {
  try {
    if (!v.manifest) return `#${iid} has no ticket analysis, so its prerequisites are unknown`;
    if (v.policyIdentity !== undefined && v.manifest.policyIdentity !== v.policyIdentity) return `#${iid}'s execution policy changed; fresh analysis required`;
    if (v.manifest.hash !== v.hash) return `#${iid}'s ticket analysis is out of date, so its prerequisites are unknown`;
    for (const e of edgesOf(v.manifest)) {
      if (e.to !== iid) continue;
      const result = v.dependency(e.from);
      if (result.state === "satisfied") continue;
      if (result.state === "unknown") return `#${iid} waits on #${e.from}: ${result.reason ?? "dependency information unavailable"}`;
      const why = v.active(e.from);
      return `#${iid} waits on #${e.from}${why ? ` (${why})` : ""}: ${e.what}`;
    }
    return undefined;
  } catch (e) {
    return `#${iid}'s prerequisites are unknown: ${(e as Error).message}`;
  }
}
