// Recovery launcher (slice four, #60, continued by #74): starts one bounded repair attempt on a jammed ticket and
// settles attempts that ended. The jam detector (#61) is to call settleRecovery after each completed pass and
// launchRecovery for a confirmed jam's ticket; nothing calls them yet, so recovery stays inactive.
// launchRecovery, in order: settle the project's running attempt, if any (refusing while it still runs or its container
// is unconfirmed); check the ticket's recorded branch and worktree may be resumed (recovery-workspace.mts resumeTarget);
// check the project's copy has the recovery workflow (main.mts --recover, recovery.mts, recovery-sandbox.mts,
// handoff.mts, prompt.recover.md; factory init does not deliver the prompt yet, #63); choose the attempt's UUID and its
// exact container name (factory-recovery-<uuid>); take capacity, ticket and project together (recovery-claim.mts),
// recording UUID, container and attempt-record path with the attempt; add the branch's Factory worktree if it is
// missing (`git worktree add`, never a reset); write the host-owned attempt record (orchestrator/recovery.mts, phase
// `claimed`, under <state>/recovery/attempts/, never mounted into a container); then spawn
// `npx tsx .sandcastle/main.mts --issue <t> --base <b> --recover <seq> --attempt-record <file>` from the project root,
// detached into its own process group (so cancelling a dispatcher pass or `schedule off` never reaches it, like
// dispatched ticket runs), output appended to .sandcastle/logs/recover-<t>.log, SANDCASTLE_STATE_DIR set to the
// run-state folder. The claim's record is handed to the child's pid at once, so the ticket stays owned after the
// launcher exits. The child checks the record, run record and claim name the same attempt before any side effect.
// settleRecovery finishes the running attempt once its process has ended. First the attempt's exact container is
// removed by name and confirmed gone (recovery.mts ownedContainerGone); an attempt with no recorded container, or one
// docker cannot confirm, stays running (unconfirmed), so no new attempt starts and nothing else is removed. Then the
// outcome comes from the attempt record: `finished` gives its outcome; `cleanup-pending` gives its intended outcome now
// that the container is gone; any other phase means the process died (crash reconciliation: `interrupted`, the run
// record left stopped with a note that the work is preserved; a death while delivering says the delivery outcome is
// unknown and is not replayed). It never touches branches, worktrees, commits or evidence, and the budget the attempt
// spent stays spent (recovery-state.mts).
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { keyFor, PARKED, readRuns, TERMINAL } from '../../board/board.mts';
import type { RunState } from '../../board/board.mts';
import { attemptEvidence, attemptGitDir, containerFor, ownedContainerGone, readAttemptRecord, realDocker, writeAttemptRecord } from '../../orchestrator/recovery.mts';
import type { AttemptRecord, RecoveryOutcome } from '../../orchestrator/recovery.mts';
import type { Docker } from '../../orchestrator/recovery.mts';
import type { Paths } from './paths.mts';
import { claimRecovery } from './recovery-claim.mts';
import { finishAttempt, readRecovery, runningAttempt } from './recovery-state.mts';
import type { Attempt } from './recovery-state.mts';
import { resumeTarget } from './recovery-workspace.mts';
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

type Common = { root: string; tracker: string; dir?: string; docker?: Docker; at?: string; uuid?: () => string };
export type Settled = { state: 'none' } | { state: 'running'; attempt: Attempt } | { state: 'settled'; attempt: Attempt }
  | { state: 'unconfirmed'; attempt: Attempt; reason: string };
export type Launch = { ok: true; attempt: Attempt; pid: number; branch: string; log: string } | { ok: false; reason: string };

const REQUIRED = ['main.mts', 'recovery.mts', 'recovery-sandbox.mts', 'handoff.mts', 'prompt.recover.md'];
/** Why the project's .sandcastle copy cannot run a repair, or null. */
export function recoveryCopyProblem(root: string): string | null {
  const dir = join(root, '.sandcastle');
  const missing = REQUIRED.filter(f => !existsSync(join(dir, f)));
  if (!missing.length && !readFileSync(join(dir, 'main.mts'), 'utf8').includes('"attempt-record": { type: "string" }')) missing.push('main.mts --recover --attempt-record');
  return missing.length
    ? `the project's .sandcastle copy has no recovery workflow (missing ${missing.join(', ')}); recovery stays inactive until the copy is upgraded`
    : null;
}

const inFlight = (r: RunState) => !TERMINAL.includes(r.stage) && !PARKED.includes(r.stage);
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
  const dir = o.dir ?? runStateDir(p);
  const at = o.at ?? new Date().toISOString();
  const a = runningAttempt(readRecovery(p, o.root));
  if (!a) return { state: 'none' };
  // readRuns turns a record whose process died into `stopped`.
  const run = readRuns(dir).find(r => r.project === o.tracker && r.iid === String(a.ticket));
  if (run && run.recovery?.attempt === a.seq && inFlight(run)) return { state: 'running', attempt: a };
  const unconfirmed = (why: string): Settled => ({ state: 'unconfirmed', attempt: a, reason: `recovery attempt ${a.seq} on #${a.ticket} ended, but ${why}` });
  if (!a.container) return unconfirmed('it has no recorded container identity; nothing is guessed or removed');
  const gone = ownedContainerGone(a.container, o.docker ?? realDocker);
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
  return { state: 'settled', attempt: done };
}

/** Start one repair attempt on `ticket`, or say why not; see the file comment. */
export function launchRecovery(p: Paths, o: Common & { ticket: number; cap?: number; spawn?: Spawner; worktreeDir?: string; npx?: string }): Launch {
  const dir = o.dir ?? runStateDir(p);
  const at = o.at ?? new Date().toISOString();
  const prior = settleRecovery(p, { ...o, at });
  if (prior.state === 'running') return { ok: false, reason: `Recovery attempt ${prior.attempt.seq} on #${prior.attempt.ticket} is still running.` };
  if (prior.state === 'unconfirmed') return { ok: false, reason: prior.reason };
  const run = readRuns(dir).find(r => r.project === o.tracker && r.iid === String(o.ticket));
  if (!run) return { ok: false, reason: `#${o.ticket} has no run record; recovery repairs only recorded work` };
  const target = resumeTarget(o.root, run, { worktreeDir: o.worktreeDir });
  if (!target.ok) return target;
  if (!target.base) return { ok: false, reason: `#${o.ticket}: its run record names no base branch` };
  const copy = recoveryCopyProblem(o.root);
  if (copy) return { ok: false, reason: copy };

  const log = join(o.root, '.sandcastle/logs', `recover-${o.ticket}.log`);
  const id = (o.uuid ?? randomUUID)();
  const container = containerFor(id);
  const record = join(attemptsDir(p), `${id}.json`);
  const claim = claimRecovery(p, { root: o.root, tracker: o.tracker, ticket: o.ticket, pid: process.pid, at, cap: o.cap, branch: target.branch, log, dir,
    id, container, record });
  if (!claim.ok) return claim;
  const seq = claim.attempt.seq;
  const npx = o.npx ?? (existsSync(resolve(dirname(process.execPath), 'npx')) ? resolve(dirname(process.execPath), 'npx') : 'npx');
  const args = ['tsx', '.sandcastle/main.mts', '--issue', String(o.ticket), '--base', target.base, '--recover', String(seq), '--attempt-record', record];
  let pid: number;
  try {
    // The branch's Factory worktree, added without any reset when it is missing (resumeTarget accepted the branch).
    const worktree = target.worktree?.path ?? worktreeFor(o.root, target.branch);
    if (!target.worktree) execFileSync('git', ['worktree', 'add', '--quiet', worktree, target.branch], { cwd: o.root, stdio: ['ignore', 'ignore', 'pipe'] });
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
    finishAttempt(p, o.root, seq, { at, result: 'interrupted', reason, log });
    if (existsSync(record)) {
      const r = readAttemptRecord(record);
      if (r.ok) writeAttemptRecord(record, { ...r.record, phase: 'finished', outcome: 'interrupted', reason, finishedAt: at, updatedAt: at });
    }
    return { ok: false, reason };
  }
  // Hand the claim to the repair process, so the ticket stays owned (and counted) while it lives.
  patchRecord(dir, o.tracker, o.ticket, { pid });
  return { ok: true, attempt: claim.attempt, pid, branch: target.branch, log };
}
