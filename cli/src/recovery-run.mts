// #137: tracker metadata reads TOML first, without executing legacy project configuration.
// Recovery launcher (slice four, #60, continued by #74 and #75): starts one bounded repair attempt on a jammed ticket and
// settles attempts that ended. The tick's jam confirmation (#61, jam-detect.mts) calls settleRecovery after each completed
// scheduled pass and launchRecovery for a confirmed jam's ticket, only when the project's copy has the recovery workflow
// and a person has reviewed it as it is (recovery-review.mts recoveryCopyProblem, #63), so recovery stays inactive until
// that copy is complete and reviewed.
// launchRecovery, in order: settle the project's running attempt, if any (refusing while it still runs or its container
// is unconfirmed); read the ticket's ownership receipt (orchestrator/ownership.mts, keyed by the project's id from its
// checkout and tracker, read from .sandcastle/config.mts) and check its recorded branch and worktree may be resumed
// (recovery-workspace.mts resumeTarget). A branch only on origin is fetched exactly and created locally without force
// (fetchRecordedBranch), under a receipt that says so, unless a claim protects the ticket. A pre-upgrade run's exact
// branch is adopted into a new receipt; identities a receipt is missing are filled in from Git. Then: check the
// project's copy has the complete recovery workflow and that it is unchanged since it was reviewed (recovery-review.mts;
// factory init delivers and records it for a new scaffold, #63); choose the attempt's UUID and its exact container
// name (factory-recovery-<uuid>); take capacity, ticket and project together with the attempt's charge in one admission
// record replacement (recovery-claim.mts); record the intent and add the branch's Factory worktree if it is missing
// (`git worktree add`, never a reset); write the host-owned attempt record (orchestrator/recovery.mts, phase `claimed`,
// under <state>/recovery/attempts/, never mounted into a container); then spawn
// `npx tsx .sandcastle/main.mts --issue <t> --base <b> --recover <seq> --attempt-record <file>` from the project root,
// detached into its own process group (so cancelling a dispatcher pass or `schedule off` never reaches it, like
// dispatched ticket runs), output appended to .sandcastle/logs/recover-<t>.log, SANDCASTLE_STATE_DIR set to the
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
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { claimLive, keyFor, ownerState, readAdmission, releaseClaim, transferClaim, withAdmission } from '../../board/admission.mts';
import type { AdmissionClaim } from '../../board/admission.mts';
import { PARKED, readRuns, TERMINAL } from '../../board/board.mts';
import type { RunState } from '../../board/board.mts';
import { fillReceipt, projectId, readReceipt, receiptFile, recordIntent } from '../../orchestrator/ownership.mts';
import type { Receipt, TrackerIdentity } from '../../orchestrator/ownership.mts';
import { attemptEvidence, attemptGitDir, containerFor, ownedContainerGone, readAttemptRecord, realDocker, writeAttemptRecord } from '../../orchestrator/recovery.mts';
import type { AttemptRecord, RecoveryOutcome } from '../../orchestrator/recovery.mts';
import type { Docker } from '../../orchestrator/recovery.mts';
import type { Paths } from './paths.mts';
import { claimRecovery, replayAdmitted } from './recovery-claim.mts';
import { recoveryCopyProblem } from './recovery-review.mts';
import { finishAttempt, readRecovery, runningAttempt } from './recovery-state.mts';
import type { Attempt } from './recovery-state.mts';
import { fetchRecordedBranch, resumeTarget } from './recovery-workspace.mts';
import { runStateDir } from './runs.mts';

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
  /** The tracker kind and host for the project's id; read from .sandcastle/config.mts when not given. */
  identity?: TrackerIdentity };
export type Settled = { state: 'none' } | { state: 'running'; attempt: Attempt } | { state: 'settled'; attempt: Attempt }
  | { state: 'unconfirmed'; attempt: Attempt; reason: string };
export type Launch = { ok: true; attempt: Attempt; pid: number; branch: string; log: string } | { ok: false; reason: string };

const inFlight = (r: RunState) => !TERMINAL.includes(r.stage) && !PARKED.includes(r.stage);

// #137: validate TOML identity without executing legacy project code.
import { loadTomlConfig, tomlIdentity } from '../../orchestrator/project-config.mts';
/** The project's tracker identity from TOML, else safe legacy text. */
export function trackerIdentity(root: string): TrackerIdentity | string {
  const toml = tomlIdentity(join(root, '.sandcastle'));
  if (toml) return toml;
  let text: string;
  try { text = readFileSync(join(root, '.sandcastle/config.mts'), 'utf8'); } catch { return `no readable .sandcastle/config.mts in ${root}`; }
  const kind = text.match(/^\s*kind:\s*"([^"]+)"/m)?.[1];
  const host = text.match(/^\s*(?:gitlabHost|host):\s*"([^"]+)"/m)?.[1];
  const project = text.match(/^\s*project:\s*"([^"]+)"/m)?.[1];
  return kind && host && project ? { kind, host, project } : `couldn't read TRACKER kind, host and project from ${root}/.sandcastle/config.mts`;
}
const recordFile = (dir: string, tracker: string, ticket: number) => join(dir, `${keyFor(String(ticket), tracker)}.json`);
/** Merge `patch` into the ticket's run record (temp file + rename). */
function patchRecord(dir: string, tracker: string, ticket: number, patch: Partial<RunState>) {
  const file = recordFile(dir, tracker, ticket);
  const cur = JSON.parse(readFileSync(file, 'utf8'));
  const at = new Date().toISOString();
  const next = { ...cur, ...patch, updatedAt: at, ...(patch.stage && patch.stage !== cur.stage ? { stageSince: at } : {}) };
  writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${file}.${process.pid}.tmp`, file);
}

/** Where the launcher keeps host-owned attempt records. */
export const attemptsDir = (p: Paths) => join(p.recovery, 'attempts');
/** Sandcastle's worktree for `branch`: <root>/.sandcastle/worktrees/<branch with / as ->. */
export const worktreeFor = (root: string, branch: string) => resolve(root, '.sandcastle/worktrees', branch.replaceAll('/', '-'));

/** Finish the project's running attempt if its process has ended; see the file comment. */
export function settleRecovery(p: Paths, o: Common): Settled {
  loadTomlConfig(join(o.root, '.sandcastle')); // validate before admission writes or Docker, even with an explicit identity
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
  return { state: 'settled', attempt: done };
}

/** Start one repair attempt on `ticket`, or say why not; see the file comment. */
export function launchRecovery(p: Paths, o: Common & { ticket: number; cap?: number; spawn?: Spawner; worktreeDir?: string; npx?: string;
  /** Test hook: runs after the claim and charge are committed, before the charge is applied (a crash point). */
  afterCommit?: () => void }): Launch {
  const dir = o.dir ?? runStateDir(p);
  const at = o.at ?? new Date().toISOString();
  const docker = o.docker ?? realDocker;
  const prior = settleRecovery(p, { ...o, at });
  if (prior.state === 'running') return { ok: false, reason: `Recovery attempt ${prior.attempt.seq} on #${prior.attempt.ticket} is still running.` };
  if (prior.state === 'unconfirmed') return { ok: false, reason: prior.reason };
  const run = readRuns(dir).find(r => r.project === o.tracker && r.iid === String(o.ticket));
  if (!run) return { ok: false, reason: `#${o.ticket} has no run record; recovery repairs only recorded work` };
  const identity = o.identity ?? trackerIdentity(o.root);
  if (typeof identity === 'string') return { ok: false, reason: `#${o.ticket}: ${identity}; ownership cannot be checked` };
  const receiptPath = receiptFile(dir, projectId(o.root, identity), String(o.ticket));
  const id = (o.uuid ?? randomUUID)();
  let receipt: Receipt | null;
  try { receipt = readReceipt(receiptPath); } catch (e) { return { ok: false, reason: `#${o.ticket}: ${(e as Error).message}` }; }
  let target = resumeTarget(o.root, run, { worktreeDir: o.worktreeDir, receipt });
  if (!target.ok && target.remoteOnly && run.branch) {
    // Fetch the exact recorded branch, under a receipt saying so, unless a claim protects the ticket.
    const held = readAdmission(dir).claims[keyFor(String(o.ticket), o.tracker)];
    if (held && claimLive(held)) return { ok: false, reason: `#${o.ticket} is claimed (${held.kind}, process ${held.owner.pid}); not fetching its branch` };
    const contains = receipt?.branchSha;
    recordIntent(dir, { root: o.root, tracker: identity, ticket: String(o.ticket), branch: run.branch, base: run.base, runId: id, at,
      branchToCreate: true, worktreeToCreate: false, ...(contains ? { branchSha: contains } : {}) });
    const fetched = fetchRecordedBranch(o.root, run.branch, { contains });
    if (!fetched.ok) return { ok: false, reason: `#${o.ticket}: ${fetched.reason}` };
    receipt = fillReceipt(receiptPath, { branchSha: fetched.sha });
    target = resumeTarget(o.root, run, { worktreeDir: o.worktreeDir, receipt });
  }
  if (!target.ok) return target;
  if (!target.base) return { ok: false, reason: `#${o.ticket}: its run record names no base branch` };
  const copy = recoveryCopyProblem(p, o.root);
  if (copy) return { ok: false, reason: copy };
  // A pre-upgrade run's exact branch is adopted; identities a crash left unrecorded are filled from what Git shows.
  if (target.adopt) {
    recordIntent(dir, { root: o.root, tracker: identity, ticket: String(o.ticket), branch: target.branch, base: target.base, runId: id, at,
      branchToCreate: false, worktreeToCreate: false, branchSha: target.tip, ...(target.worktree ? { worktreeAt: at } : {}) });
  } else if (target.reconcile) {
    fillReceipt(receiptPath, { ...(target.reconcile.branchSha ? { branchSha: target.reconcile.branchSha } : {}), ...(target.reconcile.worktreeAt ? { worktreeAt: at } : {}) });
  }

  const log = join(o.root, '.sandcastle/logs', `recover-${o.ticket}.log`);
  const container = containerFor(id);
  const record = join(attemptsDir(p), `${id}.json`);
  const claim = claimRecovery(p, { root: o.root, tracker: o.tracker, ticket: o.ticket, pid: process.pid, at, cap: o.cap, branch: target.branch, log, dir,
    id, container, record, afterCommit: o.afterCommit });
  if (!claim.ok) return claim;
  const key = keyFor(String(o.ticket), o.tracker);
  const seq = claim.attempt.seq;
  const npx = o.npx ?? (existsSync(resolve(dirname(process.execPath), 'npx')) ? resolve(dirname(process.execPath), 'npx') : 'npx');
  const args = ['tsx', '.sandcastle/main.mts', '--issue', String(o.ticket), '--base', target.base, '--recover', String(seq), '--attempt-record', record];
  let pid: number;
  try {
    // The branch's Factory worktree, added without any reset when it is missing (resumeTarget accepted the branch),
    // after a receipt says this attempt is about to create it.
    const worktree = target.worktree?.path ?? worktreeFor(o.root, target.branch);
    if (!target.worktree) {
      const cur = readReceipt(receiptPath);
      recordIntent(dir, { root: o.root, tracker: identity, ticket: String(o.ticket), branch: target.branch, base: target.base, runId: id, at,
        branchToCreate: false, worktreeToCreate: true, branchSha: cur?.branchSha ?? target.tip });
      execFileSync('git', ['worktree', 'add', '--quiet', worktree, target.branch], { cwd: o.root, stdio: ['ignore', 'ignore', 'pipe'] });
      fillReceipt(receiptPath, { worktreeAt: at });
    }
    const rec: AttemptRecord = { version: 1, id, seq, project: o.tracker, iid: String(o.ticket), branch: target.branch, base: target.base,
      startSha: target.tip, worktree, container, evidence: attemptEvidence(o.root, String(o.ticket), id), gitDir: attemptGitDir(o.root, id),
      phase: 'claimed', createdAt: at, updatedAt: at, events: [{ at, phase: 'claimed' }] };
    writeAttemptRecord(record, rec);
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, `\n==== ${at} recovery attempt ${seq} on #${o.ticket} (${target.branch})\n`);
    pid = (o.spawn ?? spawnDetached)(npx, args, { cwd: o.root, env: { ...process.env, SANDCASTLE_STATE_DIR: dir }, log });
  } catch (e) {
    const reason = `recovery attempt ${seq} could not start: ${(e as Error).message}`;
    patchRecord(dir, o.tracker, o.ticket, { stage: 'stopped', note: reason });
    if (existsSync(record)) {
      const r = readAttemptRecord(record);
      if (r.ok) writeAttemptRecord(record, { ...r.record, phase: 'finished', outcome: 'interrupted', reason, finishedAt: at, updatedAt: at });
    }
    finishAttempt(p, o.root, seq, { at, result: 'interrupted', reason, log });
    // Nothing was started, so its container cannot exist; release once docker confirms that (else the next settle does).
    if (ownedContainerGone(container, docker).ok) releaseClaim(dir, key, claim.token, 'recovery');
    return { ok: false, reason };
  }
  // Hand the claim to the repair process, so the ticket stays owned (and counted) while it lives.
  transferClaim(dir, key, claim.token, pid, process.pid);
  patchRecord(dir, o.tracker, o.ticket, { pid });
  return { ok: true, attempt: claim.attempt, pid, branch: target.branch, log };
}
