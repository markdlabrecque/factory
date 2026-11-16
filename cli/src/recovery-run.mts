// Recovery requires fresh host/filesystem, complete input matching preparation, and image readiness before admission.
// Only typed read-only ticket refusals permit scanning. Environment holds stop the pass without spending attempts.
// Settlement stays explicit; any preparation or admission failure stops the pass.
import { freezeTicketInput, TicketInputHold } from '../../orchestrator/ticket-input.mts';
import { commandContextSource } from '../../orchestrator/ticket-context-source.mts';
import type { TicketContextSource } from '../../orchestrator/ticket-context.mts';
import type { checkImageCapabilities } from '../../orchestrator/capabilities.mts';
import { readImageConfig } from './image-config.mts';
// #150: carry host-recorded execution and historical implementation baseline into attempt/ownership metadata.
// #137: tracker metadata reads TOML first, without executing legacy project configuration.
// Recovery launcher (slice four, #60, continued by #74 and #75): starts one bounded repair attempt on a jammed ticket and
// settles attempts that ended. The tick's jam confirmation (#61, jam-detect.mts) calls settleRecovery after each completed
// scheduled pass and launchRecovery for a confirmed jam's ticket. Both use the selected complete workflow.
// Validated Factory bundles need no per-project review; project overrides must match host-owned review metadata.
// launchRecovery, in order: read-only holds for any running/unsettled attempt (the caller settles separately), shared
// capacity, claims, budget, workflow review and stopped run; read the ticket's ownership receipt (orchestrator/ownership.mts, keyed by the project's id from its
// checkout and tracker, read from v2 TOML) and check its recorded branch and worktree may be resumed
// (recovery-workspace.mts resumeTarget). A branch only on origin is fetched exactly and created locally without force
// (fetchRecordedBranch), under a receipt that says so, unless a claim protects the ticket. A pre-upgrade run's exact
// branch is adopted into a new receipt; identities a receipt is missing are filled in from Git. Then: check the
// selected workflow is complete and any project-mode review is current (recovery-review.mts);
// choose the attempt's UUID and its exact container
// name (factory-recovery-<uuid>); take capacity, ticket and project together with the attempt's charge in one admission
// record replacement (recovery-claim.mts); record the intent and add the branch's Factory worktree if it is missing
// (`git worktree add`, never a reset); write the host-owned attempt record (orchestrator/recovery.mts, phase `claimed`,
// under <state>/recovery/attempts/, never mounted into a container); then spawn
// saved Node with selected absolute tsx/main paths and --issue/--base/--recover/--attempt-record from the project root,
// detached into its own process group (so cancelling a dispatcher pass or `schedule off` never reaches it, like
// dispatched ticket runs), output appended to .factory/logs/recover-<t>.log, SANDCASTLE_STATE_DIR set to the
// run-state folder. The claim is handed to the child's pid at once; main.mts adopts it and checks the record, run record
// and claim name the same attempt before any side effect.
// settleRecovery first applies any admitted attempt whose charge never reached the recovery record (a launcher crash),
// then finishes the running attempt once its claim's owner process has ended (pid and start identity). The attempt's
// exact container is removed by name and confirmed gone (recovery.mts ownedContainerGone); an attempt with no recorded
// container, or one docker cannot confirm, stays running (unconfirmed), and its recovery claim keeps the ticket, a
// capacity slot and the project however long that takes. Then the outcome comes from the attempt record: `finished`
// gives its outcome; `cleanup-pending` gives its intended outcome now that the container is gone; any other phase means
// the process died (crash reconciliation: `interrupted`, the run record left stopped with a note that the work is
// preserved; a death while delivering says the delivery outcome is unknown and is not replayed). Only after the attempt
// is finished does it release the claim (token-fenced); a crash in between is finished on the next settle. It never
// touches branches, worktrees, commits or evidence, and the budget the attempt spent stays spent (recovery-state.mts).
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { projectWorkflow } from './workflow.mts';
import { acquireRuntimeLease, releaseRuntimeLease, transferRuntimeLease } from './runtime-ownership.mts';
import { ownerOf } from '../../board/admission.mts';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { claimLive, generationOf, keyFor, ownerState, readAdmission, releaseClaim, transferClaim, withAdmission } from '../../board/admission.mts';
import type { AdmissionClaim } from '../../board/admission.mts';
// Launcher patches share the persisted stage writer; settlement is observational, after charge/cleanup locks.
import { observeEvent } from '../../board/execution-events.mts';
import { PARKED, readRuns, TERMINAL, writeRecord } from '../../board/board.mts';
import type { RunState } from '../../board/board.mts';
import { canonicalWorktree, fillReceipt, projectId, readReceipt, receiptFile, recordIntent } from '../../orchestrator/ownership.mts';
import type { Receipt, TrackerIdentity } from '../../orchestrator/ownership.mts';
import { attemptEvidence, attemptGitDir, containerFor, ownedContainerGone, readAttemptRecord, realDocker, writeAttemptRecord } from '../../orchestrator/recovery.mts';
import type { AttemptRecord, RecoveryOutcome } from '../../orchestrator/recovery.mts';
import type { Docker } from '../../orchestrator/recovery.mts';
import type { Paths } from './paths.mts';
import { claimRecovery, DEFAULT_CAP, readRecoveryRuns, replayAdmitted } from './recovery-claim.mts';
import { recoveryCopyProblem } from './recovery-review.mts';
import { attemptProblem, finishAttempt, readRecovery, runningAttempt } from './recovery-state.mts';
import type { Attempt } from './recovery-state.mts';
import { fetchRecordedBranch, resumeTarget } from './recovery-workspace.mts';
import type { RefusalCode } from './recovery-workspace.mts';
import { runStateDir } from './runs.mts';
import {validPreparation} from '../../orchestrator/recovery-analysis-contract.mts';
import type {Preparation} from '../../orchestrator/recovery-analysis-contract.mts';

/** Starts the repair process detached, its output appended to `log`; returns its pid or throws. */
export type Spawner = (cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; log: string }) => number;
export const spawnDetached: Spawner = (cmd, args, o) => {
  const out = openSync(o.log, 'a');
  try {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ['ignore', out, out] });
    child.on('error', () => {}); // a failed spawn has no pid; reported below
    if (!child.pid) throw new Error(`could not start ${cmd}`);
    child.unref();
    return child.pid;
  } finally { closeSync(out); }
};

type Common = { root: string; tracker: string; dir?: string; docker?: Docker; at?: string; uuid?: () => string;
  node?: string; path?: string; workflowEnv?: NodeJS.ProcessEnv;
  /** The tracker kind and host for the project's id; read from v2 TOML when not given. */
  identity?: TrackerIdentity };
export type Settled = { state: 'none' } | { state: 'running'; attempt: Attempt } | { state: 'settled'; attempt: Attempt }
  | { state: 'unconfirmed'; attempt: Attempt; reason: string };
export type Launch =
  | { ok: true; kind: 'started'; admitted: true; attempt: Attempt; pid: number; branch: string; log: string }
  | { ok: false; kind: 'ticket-refused'; admitted: false; code: RefusalCode; reason: string }
  | { ok: false; kind: 'project-stopped'; admitted: false; code: string; reason: string; scope?: 'ticket' | 'project' | 'environment' }
  | { ok: false; kind: 'admitted-failed'; admitted: true; attempt: Attempt; reason: string };

const inFlight = (r: RunState) => !TERMINAL.includes(r.stage) && !PARKED.includes(r.stage);

// #137: validate TOML identity without executing legacy project code.
import { loadTomlConfig, tomlIdentity } from '../../orchestrator/project-config.mts';
/** Validate the complete v2 configuration before using its tracker identity. */
export function trackerIdentity(root: string): TrackerIdentity {
  return tomlIdentity(join(root, '.factory'));
}
const recordFile = (dir: string, tracker: string, ticket: number) => join(dir, `${keyFor(String(ticket), tracker)}.json`);
/** Merge `patch` into the ticket's run record (temp file + rename). */
function patchRecord(dir: string, tracker: string, ticket: number, patch: Partial<RunState>) {
  const file = recordFile(dir, tracker, ticket);
  const cur = JSON.parse(readFileSync(file, 'utf8'));
  const at = new Date().toISOString();
  const next = { ...cur, ...patch, updatedAt: at, ...(patch.stage && patch.stage !== cur.stage ? { stageSince: at } : {}) };
  writeRecord(dir, keyFor(String(ticket), tracker), next, 'recovery');
}

/** Where the launcher keeps host-owned attempt records. */
export const attemptsDir = (p: Paths) => join(p.recovery, 'attempts');
/** Sandcastle's worktree for `branch`: <root>/.factory/worktrees/<branch with / as ->. */
export const worktreeFor = canonicalWorktree;

/** Recover only a saved exact attempt identity for maintenance, never for launch authorization. */
export function ownedRecoveryTracker(p: Paths, root: string): string | undefined {
  const state = readRecovery(p, root);
  const a = runningAttempt(state) ?? state.attempts.at(-1);
  if (!a?.id || a.container !== containerFor(a.id) || a.record !== join(attemptsDir(p), `${a.id}.json`)) return;
  const saved = readAttemptRecord(a.record);
  if (!saved.ok || saved.record.id !== a.id || saved.record.seq !== a.seq || saved.record.iid !== String(a.ticket) || saved.record.container !== a.container) return;
  // Old paths are accepted only as immutable cleanup identity, never converted or used for a launch.
  const r = saved.record;
  if (!['.factory', '.sandcastle'].some(dir => r.worktree === resolve(root, dir, 'worktrees', r.branch.replaceAll('/', '-')))) return;
  return r.project;
}

/** Finish an already-owned attempt even when project layout policy holds new launches. */
export function settleRecovery(p: Paths, o: Common): Settled {
  try { loadTomlConfig(join(o.root, '.factory')); }
  catch (error) { if (ownedRecoveryTracker(p, o.root) !== o.tracker) throw error; }
  const dir = o.dir ?? runStateDir(p);
  const at = o.at ?? new Date().toISOString();
  const docker = o.docker ?? realDocker;
  // Apply any charge a crashed launcher left only in the admission record, then find the project's recovery claim.
  const claim = withAdmission(dir, tx => {
    replayAdmitted(p, tx, o.root, o.tracker);
    return Object.values(tx.state.claims).find(c => c.kind === 'recovery' && c.project === o.tracker);
  });
  const release = (c: AdmissionClaim) => releaseClaim(dir, keyFor(c.iid, c.project), c.token, 'recovery');
  const a = runningAttempt(readRecovery(p, o.root));
  if (!a) {
    // An attempt already finished whose claim was never released (a crash in between): release it once its container is gone.
    if (claim?.attempt && ownerState(claim.owner) === 'dead' && ownedContainerGone(containerFor(claim.attempt), docker).ok) release(claim);
    return { state: 'none' };
  }
  const mine = claim?.attempt === a.id ? claim : undefined;
  // readRuns turns a record whose process died into `stopped`.
  const run = readRuns(dir).find(r => r.project === o.tracker && r.iid === String(a.ticket));
  const alive = mine ? ownerState(mine.owner) !== 'dead' : !!run && run.recovery?.attempt === a.seq && inFlight(run);
  if (alive) return { state: 'running', attempt: a };
  const unconfirmed = (why: string): Settled => ({ state: 'unconfirmed', attempt: a, reason: `recovery attempt ${a.seq} on #${a.ticket} ended, but ${why}` });
  if (!a.container) return unconfirmed('it has no recorded container identity; nothing is guessed or removed');
  const gone = ownedContainerGone(a.container, docker);
  if (!gone.ok) return unconfirmed(`its container is not confirmed gone: ${gone.reason}`);
  const read = a.record ? readAttemptRecord(a.record) : { ok: false as const, reason: 'no attempt record was named' };
  const branch = a.branch ?? run?.branch;
  let result: RecoveryOutcome = 'interrupted';
  let reason: string;
  if (!read.ok) reason = `the repair process ended without a usable attempt record (${read.reason}); work preserved on ${branch ?? 'its branch'}`;
  else {
    const r = read.record;
    if (r.phase === 'finished' && r.outcome) { result = r.outcome; reason = r.reason ?? r.outcome; }
    else if (r.phase === 'cleanup-pending') { result = r.intended ?? 'failed'; reason = `${r.reason ?? 'cleanup pending'}; container now confirmed gone`; }
    else if (r.phase === 'delivering') reason = `the repair process died while delivering ${r.tip?.slice(0, 8) ?? ''}; the delivery outcome is unknown and is not replayed; check ${branch}'s PR before retrying; work preserved on ${branch}`;
    else reason = `the repair process exited during ${r.phase} (${run?.note ?? 'no run record'}); work preserved on ${branch ?? 'its branch'}`;
    if (r.phase !== 'finished') {
      r.events.push({ at, phase: 'finished', note: 'settled by the launcher' });
      writeAttemptRecord(a.record!, { ...r, phase: 'finished', outcome: result, reason, finishedAt: at, updatedAt: at });
    }
  }
  if (result === 'interrupted' && run && run.recovery?.attempt === a.seq && run.stage !== 'done') {
    patchRecord(dir, o.tracker, a.ticket, { stage: 'stopped', note: `recovery attempt ${a.seq} interrupted: ${reason}` });
  }
  const evidence = read.ok ? read.record.evidence : undefined;
  const report = evidence && existsSync(join(evidence, 'recovery-report.md')) ? join(evidence, 'recovery-report.md') : undefined;
  const done = finishAttempt(p, o.root, a.seq, { at, result, reason, ...(report ? { report } : {}) });
  // The container is confirmed gone and the attempt finished: only now does the claim let go of the ticket, its slot and the project.
  if (mine) release(mine);
  observeSettlement(dir, o.tracker, done, run?.executionId);
  return { state: 'settled', attempt: done };
}

function observeSettlement(dir: string, project: string, a: Attempt, executionId?: string): void {
  observeEvent(dir, { eventId: `${a.id}-settled`, observedAt: a.finishedAt!, project, ticket: String(a.ticket),
    executionId, recoveryAttemptId: a.id, identityComplete: !!executionId, eventKind: 'recovery-settled',
    from: 'running', to: a.result, origin: 'recovery', reasonCode: a.result === 'interrupted' ? 'process-exited' : 'unspecified' });
}

/** Read-only local screening before spending analysis time. Only proven local ticket refusals permit scanning.
 *  Remote fetch/adoption, execution analysis and all ownership mutations happen later, for one selected target. */
export type CandidateInspection = {ok:true} | Extract<Launch,{admitted:false}>;
export function inspectRecoveryCandidate(p:Paths,o:Common & {ticket:number;cap?:number;worktreeDir?:string}):CandidateInspection {
  const stop=(code:string,reason:string):CandidateInspection=>({ok:false,kind:'project-stopped',admitted:false,code,reason});
  try {
    const dir=o.dir??runStateDir(p),config=loadTomlConfig(join(o.root,'.factory'));
    const cap=o.cap??config?.dispatch.maxConcurrent??DEFAULT_CAP;
    if(!Number.isSafeInteger(cap)||cap<=0)return stop('capacity-invalid','Recovery cap must be a positive safe integer');
    const state=readRecovery(p,o.root),admission=readAdmission(dir);
    if(runningAttempt(state)||admission.recovery[o.tracker]?.pending.length||Object.values(admission.claims).some(c=>c.project===o.tracker&&c.kind==='recovery'))
      return stop('unsettled-recovery','Recovery admission or cleanup is unconfirmed; settle it first');
    const problem=attemptProblem(state,o.ticket,generationOf(admission,o.tracker));if(problem)return stop('recovery-held',problem);
    const runs=readRecoveryRuns(dir),busy=new Set([...runs.filter(inFlight).map(r=>r.key),...Object.entries(admission.claims).filter(([,c])=>claimLive(c)).map(([key])=>key)]);
    if(busy.size>=cap)return stop('capacity',`no capacity: ${busy.size} run(s) in flight, cap ${cap}`);
    if(runs.some(r=>r.project===o.tracker&&inFlight(r)))return stop('project-active','project has a run in flight');
    const run=runs.find(r=>r.project===o.tracker&&r.iid===String(o.ticket));
    if(!run||run.stage!=='stopped')return stop('candidate-changed',`#${o.ticket} has no stopped run record`);
    if(Object.values(admission.claims).some(c=>c.project===o.tracker&&claimLive(c)))return stop('project-claimed','project has a live claim');
    const copy=recoveryCopyProblem(p,o.root);if(copy)return stop('workflow-review',copy);
    const identity=o.identity??trackerIdentity(o.root);if(typeof identity==='string')return stop('identity-unavailable',identity);
    const receipt=readReceipt(receiptFile(dir,projectId(o.root,identity),String(o.ticket)));
    const target=resumeTarget(o.root,run,{worktreeDir:o.worktreeDir,receipt});
    if(!target.ok&&!target.remoteOnly)return {...target,admitted:false};
    return {ok:true};
  } catch(e){return stop('validation-uncertain',String(e));}
}

/** Start one prepared repair attempt on `ticket`, or say why not; see the file comment. */
export async function launchRecovery(p: Paths, o: Common & { ticket: number; preparation?: Preparation; cap?: number; spawn?: Spawner; worktreeDir?: string; npx?: string;
  signal?: AbortSignal; mayLaunch?: () => Promise<boolean>; capabilities?: typeof checkImageCapabilities; contextSource?: TicketContextSource;
  /** Test hook: runs after the claim and charge are committed, before the charge is applied (a crash point). */
  afterCommit?: () => void }): Promise<Launch> {
  const dir = o.dir ?? runStateDir(p);
  const at = o.at ?? new Date().toISOString();
  const docker = o.docker ?? realDocker;
  const stop = (code: string, reason: string, scope: 'ticket' | 'project' | 'environment' = 'project'): Launch => ({ ok: false, kind: 'project-stopped', admitted: false, code, reason, scope });
  if (!validPreparation(o.preparation) || o.preparation.state !== 'ready') return stop('stale', 'A validated recovery preparation is required; no attempt charged');
  const allowed = async () => !o.signal?.aborted && (!o.mayLaunch || await o.mayLaunch()) && !o.signal?.aborted;
  let committed = false;
  let admissionStarted = false;
  let id: string | undefined;
  try {
  if (!(await allowed())) return stop('scheduled-stopped', 'Scheduled recovery was stopped.');
  const workflow = projectWorkflow(p, o.root, o.workflowEnv);
  const hostInput = { projectRoot: o.root, runtimeRoot: workflow.root, runtimeIdentity: workflow.id, runtimeDependencies: workflow.manifest.dependencies, config: workflow.config, stateRoot: dir, base: o.preparation.base, signal: o.signal };
  const { projectLaunchReadiness, readinessReason, recordTicketInput } = await import('../../orchestrator/launch-readiness.mts');
  const config = workflow.config;
  const cap = o.cap ?? config?.dispatch.maxConcurrent ?? DEFAULT_CAP;
  if (!Number.isSafeInteger(cap) || cap <= 0) return stop('capacity-invalid', 'Recovery cap must be a positive safe integer');
  // No settlement here: even reconciliation/cleanup writes would invalidate a read-only refusal.
  const state = readRecovery(p, o.root);
  const active = runningAttempt(state);
  if (active) return stop('active-recovery', `Recovery attempt ${active.seq} on #${active.ticket} is still running or its container is not confirmed gone; settle it first.`);
  const admission = readAdmission(dir);
  if (admission.recovery[o.tracker]?.pending.length || Object.values(admission.claims).some(c => c.project === o.tracker && c.kind === 'recovery')) {
    return stop('unsettled-recovery', 'Recovery admission or cleanup is unconfirmed; settle it first');
  }
  const generation = generationOf(admission, o.tracker);
  const problem = attemptProblem(state, o.ticket, generation);
  if (problem) return stop('recovery-held', problem);
  const runs = readRecoveryRuns(dir);
  const busy = new Set([...runs.filter(inFlight).map(r => r.key),
    ...Object.entries(admission.claims).filter(([, c]) => claimLive(c)).map(([key]) => key)]);
  if (busy.size >= cap) return stop('capacity', `no capacity: ${busy.size} run(s) in flight, cap ${cap}`);
  if (runs.some(r => r.project === o.tracker && inFlight(r))) return stop('project-active', 'project has a run in flight');
  const run = runs.find(r => r.project === o.tracker && r.iid === String(o.ticket));
  if (!run || run.stage !== 'stopped') return stop('candidate-changed', `#${o.ticket} has no stopped run record; recovery repairs only recorded work`);
  if (Object.values(admission.claims).some(c => c.project === o.tracker && claimLive(c))) return stop('project-claimed', 'project has a live claim');
  const copy = recoveryCopyProblem(p, o.root);
  if (copy) return stop('workflow-review', copy);
  const identity = o.identity ?? trackerIdentity(o.root);
  if (typeof identity === 'string') return stop('identity-unavailable', `#${o.ticket}: ${identity}; ownership cannot be checked`);
  const receiptPath = receiptFile(dir, projectId(o.root, identity), String(o.ticket));
  id = (o.uuid ?? randomUUID)();
  let receipt: Receipt | null;
  try { receipt = readReceipt(receiptPath); } catch (e) { return stop('ownership-unreadable', `#${o.ticket}: ${(e as Error).message}`); }
  let target = resumeTarget(o.root, run, { worktreeDir: o.worktreeDir, receipt });
  if (!target.ok && !target.remoteOnly) return { ...target, admitted: false };
  const hostHold = readinessReason(await projectLaunchReadiness(hostInput));
  if (hostHold) return stop('host-readiness', hostHold, 'environment');
  if (!target.ok && target.remoteOnly && run.branch) {
    // Fetch the exact recorded branch, under a receipt saying so, unless a claim protects the ticket.
    const held = readAdmission(dir).claims[keyFor(String(o.ticket), o.tracker)];
    if (held && claimLive(held)) return stop('candidate-claimed', `#${o.ticket} is claimed (${held.kind}, process ${held.owner.pid}); not fetching its branch`);
    const contains = receipt?.branchSha;
    recordIntent(dir, { root: o.root, tracker: identity, ticket: String(o.ticket), branch: run.branch, base: run.base, runId: id, at,
      implementationBaseSha: run.implementationBaseSha,
      branchToCreate: true, worktreeToCreate: false, ...(contains ? { branchSha: contains } : {}) });
    const fetched = fetchRecordedBranch(o.root, run.branch, { contains });
    if (!fetched.ok) return stop('branch-preparation', `#${o.ticket}: ${fetched.reason}`);
    receipt = fillReceipt(receiptPath, { branchSha: fetched.sha });
    target = resumeTarget(o.root, run, { worktreeDir: o.worktreeDir, receipt });
    if (!target.ok) return stop('branch-preparation', target.reason);
  }
  if (!target.ok) return { ...target, admitted: false };
  if (!target.base) return stop('validation-uncertain', 'validated target has no base');
  // A pre-upgrade run's exact branch is adopted; identities a crash left unrecorded are filled from what Git shows.
  if (target.adopt) {
    recordIntent(dir, { root: o.root, tracker: identity, ticket: String(o.ticket), branch: target.branch, base: target.base, runId: id, at,
      implementationBaseSha: run.implementationBaseSha,
      branchToCreate: false, worktreeToCreate: false, branchSha: target.tip, ...(target.worktree ? { worktreeAt: at } : {}) });
  } else if (target.reconcile) {
    fillReceipt(receiptPath, { ...(target.reconcile.branchSha ? { branchSha: target.reconcile.branchSha } : {}), ...(target.reconcile.worktreeAt ? { worktreeAt: at } : {}) });
  }

  if (!(await allowed())) return stop('scheduled-stopped', 'Scheduled recovery was stopped.');
  const image = readImageConfig(o.root);
  if (!image.ok) return stop('image-config-unknown', image.reason, 'environment');
  const selectedCapabilities = o.capabilities ?? (await import(pathToFileURL(workflow.entrypoints.capabilities).href)).checkImageCapabilities;
  const readiness = await selectedCapabilities({ image: image.image, uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000,
    stateDir: dir, signal: o.signal });
  if (!readiness.ok) return stop('image-readiness', readiness.reason, 'environment');
  if (!(await allowed())) return stop('scheduled-stopped', 'Scheduled recovery was stopped during readiness.');

  const lateReport = await projectLaunchReadiness(hostInput);
  const lateHostHold = readinessReason(lateReport);
  if (lateHostHold) return stop('host-readiness', lateHostHold, 'environment');
  if (!(await allowed())) return stop('scheduled-stopped', 'Scheduled recovery was stopped during host readiness.');
  const tracker = config.TRACKER;
  const source = o.contextSource ?? commandContextSource({ kind: tracker.kind, host: tracker.host ?? tracker.gitlabHost!, project: tracker.project }, tracker.projectId,
    { ...process.env, ...o.workflowEnv, PATH: o.path ?? process.env.PATH });
  try {
    const input = freezeTicketInput(source, o.ticket);
    recordTicketInput(dir, lateReport, input, o.preparation.requirementsHash);
    if (input.hash !== o.preparation.requirementsHash) return stop('ticket-input', 'Included ticket or parent sources changed since recovery preparation; prepare again on the next pass.', 'ticket');
  } catch (error) {
    if (!(error instanceof TicketInputHold)) throw error;
    recordTicketInput(dir, lateReport, error);
    return stop('ticket-input', error.message, 'ticket');
  }
  if (!(await allowed())) return stop('scheduled-stopped', 'Scheduled recovery was stopped during ticket input readiness.');
  const log = join(o.root, '.factory/logs', `recover-${o.ticket}.log`);
  const container = containerFor(id);
  const record = join(attemptsDir(p), `${id}.json`);
  const validated = target;
  admissionStarted = true;
  const claim = claimRecovery(p, { root: o.root, tracker: o.tracker, ticket: o.ticket, pid: process.pid, at, cap: o.cap, branch: target.branch, log, dir,
    id, container, record, preparation:o.preparation, expected: run, generation, episode: state.episode?.id,
    validate: () => {
      if (o.signal?.aborted) throw new Error('Scheduled recovery was cancelled before admission');
      const currentImage = readImageConfig(o.root);
      if (!currentImage.ok || currentImage.image !== image.image) throw new Error('Image configuration changed during readiness; not admitted');
      projectWorkflow(p, o.root, workflow.env);
      const changed = recoveryCopyProblem(p, o.root);
      if (changed) throw new Error(changed);
      const fresh = resumeTarget(o.root, run, { worktreeDir: o.worktreeDir, receipt: readReceipt(receiptPath) });
      if (!fresh.ok) throw new Error(fresh.reason);
      if (fresh.tip !== validated.tip || fresh.worktree?.path !== validated.worktree?.path) throw new Error('workspace changed before admission');
    },
    afterCommit: () => { committed = true; o.afterCommit?.(); } });
  if (!claim.ok) return stop(claim.code ?? 'admission-rejected', claim.reason,claim.scope);
  const key = keyFor(String(o.ticket), o.tracker);
  const seq = claim.attempt.seq;
  const args = [workflow.tsx, workflow.entrypoints.main, '--issue', String(o.ticket), '--base', target.base, '--recover', String(seq), '--attempt-record', record];
  let runtimeToken: string | undefined;
  let pid: number;
  try {
    // The branch's Factory worktree, added without any reset when it is missing (resumeTarget accepted the branch),
    // after a receipt says this attempt is about to create it.
    const worktree = target.worktree?.path ?? worktreeFor(o.root, target.branch);
    if (!target.worktree) {
      const cur = readReceipt(receiptPath);
      recordIntent(dir, { root: o.root, tracker: identity, ticket: String(o.ticket), branch: target.branch, base: target.base, runId: id, at,
        implementationBaseSha: run.implementationBaseSha,
        branchToCreate: false, worktreeToCreate: true, branchSha: cur?.branchSha ?? target.tip });
      execFileSync('git', ['worktree', 'add', '--quiet', worktree, target.branch], { cwd: o.root, stdio: ['ignore', 'ignore', 'pipe'] });
      fillReceipt(receiptPath, { worktreeAt: at });
    }
    const rec: AttemptRecord = { version: 1, id, seq, project: o.tracker, iid: String(o.ticket), branch: target.branch, base: target.base,
      implementationBaseSha: run.implementationBaseSha, executionId: run.executionId, telemetryState: dir,
      startSha: target.tip, worktree, container, evidence: attemptEvidence(o.root, String(o.ticket), id), gitDir: attemptGitDir(o.root, id),
      phase: 'claimed', createdAt: at, updatedAt: at, events: [{ at, phase: 'claimed' }] };
    writeAttemptRecord(record, rec);
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, `\n==== ${at} recovery attempt ${seq} on #${o.ticket} (${target.branch})\n`);
    projectWorkflow(p, o.root, workflow.env);
    runtimeToken = acquireRuntimeLease(p, workflow.env.FACTORY_HOST_RUNTIME_ID).token;
    pid = (o.spawn ?? spawnDetached)(o.node ?? process.execPath, args, { cwd: o.root, env: { ...process.env, ...workflow.env, PATH: o.path ?? process.env.PATH, FACTORY_RUNTIME_LEASE: runtimeToken, SANDCASTLE_STATE_DIR: dir, FACTORY_READY_IMAGE: readiness.imageId }, log });
  } catch (e) {
    if (runtimeToken) releaseRuntimeLease(p, runtimeToken);
    const reason = `recovery attempt ${seq} could not start: ${(e as Error).message}`;
    patchRecord(dir, o.tracker, o.ticket, { stage: 'stopped', note: reason });
    if (existsSync(record)) {
      const r = readAttemptRecord(record);
      if (r.ok) writeAttemptRecord(record, { ...r.record, phase: 'finished', outcome: 'interrupted', reason, finishedAt: at, updatedAt: at });
    }
    const done = finishAttempt(p, o.root, seq, { at, result: 'interrupted', reason, log });
    // Nothing was started, so its container cannot exist; release once docker confirms that (else the next settle does).
    if (ownedContainerGone(container, docker).ok) releaseClaim(dir, key, claim.token, 'recovery');
    observeSettlement(dir, o.tracker, done, run.executionId);
    return { ok: false, kind: 'admitted-failed', admitted: true, attempt: readRecovery(p, o.root).attempts.find(a => a.id === id) ?? claim.attempt, reason };
  }
  // Once spawned, uncertain handoff retains ownership and the charged attempt for settlement.
  transferRuntimeLease(p, runtimeToken!, ownerOf(pid), workflow.env.FACTORY_HOST_RUNTIME_ID);
  // Hand the claim to the repair process, so the ticket stays owned (and counted) while it lives.
  transferClaim(dir, key, claim.token, pid, process.pid);
  patchRecord(dir, o.tracker, o.ticket, { pid });
  return { ok: true, kind: 'started', admitted: true, attempt: claim.attempt, pid, branch: target.branch, log };
  } catch (e) {
    const reason = (e as Error).message;
    if (admissionStarted && !committed) {
      // Even an error returning from the atomic transaction must not disguise a committed charge as a free stop.
      const admitted = readAdmission(dir);
      committed = Object.values(admitted.claims).some(c => c.attempt === id) ||
        !!admitted.recovery[o.tracker]?.pending.some(a => a.id === id) ||
        readRecovery(p, o.root).attempts.some(a => a.id === id);
    }
    if (committed) {
      // A crash after the atomic commit is charged, even if claimRecovery did not return its attempt yet.
      withAdmission(dir, tx => replayAdmitted(p, tx, o.root, o.tracker));
      const attempt = readRecovery(p, o.root).attempts.find(a => a.id === id);
      if (!attempt) throw e; // uncertain committed state is a stopping exception, never a free refusal
      return { ok: false, kind: 'admitted-failed', admitted: true, attempt, reason };
    }
    return stop('launch-uncertain', reason);
  }
}
