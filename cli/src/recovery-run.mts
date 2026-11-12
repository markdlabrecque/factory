// Recovery launcher (slice four, #60): starts one bounded repair attempt on a jammed ticket and settles attempts that
// ended. The jam detector (#61) is to call settleRecovery after each completed pass and launchRecovery for a confirmed
// jam's ticket; nothing calls them yet, so recovery stays inactive.
// launchRecovery, in order: settle the project's running attempt, if any (refusing while it still runs or its container
// is unconfirmed); check the ticket's recorded branch and worktree may be resumed (recovery-workspace.mts resumeTarget);
// check the project's copy has the recovery workflow (main.mts --recover, recovery.mts, handoff.mts, prompt.recover.md;
// factory init does not deliver it yet, #63); take capacity, ticket and project together (recovery-claim.mts); then
// spawn `npx tsx .sandcastle/main.mts --issue <t> --base <b> --recover <attempt>` from the project root, detached into
// its own process group (so cancelling a dispatcher pass never reaches it, like dispatched ticket runs), output appended
// to .sandcastle/logs/recover-<t>.log, SANDCASTLE_STATE_DIR set to the run-state folder. The claim's record is handed
// to the child's pid at once, so the ticket stays owned after the launcher exits. The repair agent's 15-minute bound,
// verification and delivery run in that child (orchestrator/main.mts, orchestrator/recovery.mts).
// settleRecovery finishes the running attempt once its process has ended: the result main.mts wrote
// (<evidence>/recovery-attempt-<n>.json: repaired, failed, timed-out, blocked or interrupted), or `interrupted` when the
// process died without one (crash reconciliation; the record is left stopped with a note that the work is preserved).
// Before finishing it confirms no container of the attempt (one mounting the ticket's worktree) is left, removing any;
// when that cannot be confirmed the attempt stays running, so no new attempt starts. It never touches branches,
// worktrees, commits or evidence, and the budget the attempt spent stays spent (recovery-state.mts).
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { keyFor, PARKED, readRuns, TERMINAL } from '../../board/board.mts';
import type { RunState } from '../../board/board.mts';
import { containersGone, readResult, realDocker, worktreeFor } from '../../orchestrator/recovery.mts';
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

type Common = { root: string; tracker: string; dir?: string; docker?: Docker; at?: string };
export type Settled = { state: 'none' } | { state: 'running'; attempt: Attempt } | { state: 'settled'; attempt: Attempt }
  | { state: 'unconfirmed'; attempt: Attempt; reason: string };
export type Launch = { ok: true; attempt: Attempt; pid: number; branch: string; log: string } | { ok: false; reason: string };

const REQUIRED = ['main.mts', 'recovery.mts', 'handoff.mts', 'prompt.recover.md'];
/** Why the project's .sandcastle copy cannot run a repair, or null. */
export function recoveryCopyProblem(root: string): string | null {
  const dir = join(root, '.sandcastle');
  const missing = REQUIRED.filter(f => !existsSync(join(dir, f)));
  if (!missing.length && !readFileSync(join(dir, 'main.mts'), 'utf8').includes('recover: { type: "string" }')) missing.push('main.mts --recover');
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

/** Finish the project's running attempt if its process has ended; see the file comment. */
export function settleRecovery(p: Paths, o: Common): Settled {
  const dir = o.dir ?? runStateDir(p);
  const a = runningAttempt(readRecovery(p, o.root));
  if (!a) return { state: 'none' };
  // readRuns turns a record whose process died into `stopped`.
  const run = readRuns(dir).find(r => r.project === o.tracker && r.iid === String(a.ticket));
  if (run && run.recovery?.attempt === a.seq && inFlight(run)) return { state: 'running', attempt: a };
  const branch = a.branch ?? run?.branch;
  if (branch) {
    const gone = containersGone(worktreeFor(o.root, branch), o.docker ?? realDocker);
    if (!gone.ok) return { state: 'unconfirmed', attempt: a, reason: `recovery attempt ${a.seq} on #${a.ticket} ended, but its container is not confirmed gone: ${gone.reason}` };
  }
  const evidence = run?.evidenceDir ?? resolve(o.root, '.sandcastle/evidence', String(a.ticket));
  const res = readResult(evidence, a.seq);
  const reason = res?.reason ?? `the repair process exited without finishing (${run?.note ?? 'no run record'}); work preserved on ${branch ?? 'its branch'}`;
  if (!res && run && run.recovery?.attempt === a.seq && run.stage !== 'done') {
    patchRecord(dir, o.tracker, a.ticket, { stage: 'stopped', note: `recovery attempt ${a.seq} interrupted: ${reason}` });
  }
  const done = finishAttempt(p, o.root, a.seq, { at: o.at ?? new Date().toISOString(), result: res?.result ?? 'interrupted', reason,
    ...(res?.report ? { report: res.report } : {}) });
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
  const claim = claimRecovery(p, { root: o.root, tracker: o.tracker, ticket: o.ticket, pid: process.pid, at, cap: o.cap, branch: target.branch, log, dir });
  if (!claim.ok) return claim;
  const seq = claim.attempt.seq;
  const npx = o.npx ?? (existsSync(resolve(dirname(process.execPath), 'npx')) ? resolve(dirname(process.execPath), 'npx') : 'npx');
  const args = ['tsx', '.sandcastle/main.mts', '--issue', String(o.ticket), '--base', target.base, '--recover', String(seq)];
  let pid: number;
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, `\n==== ${at} recovery attempt ${seq} on #${o.ticket} (${target.branch})\n`);
    pid = (o.spawn ?? spawnDetached)(npx, args, { cwd: o.root, env: { ...process.env, SANDCASTLE_STATE_DIR: dir }, log });
  } catch (e) {
    const reason = `recovery attempt ${seq} could not start: ${(e as Error).message}`;
    patchRecord(dir, o.tracker, o.ticket, { stage: 'stopped', note: reason });
    finishAttempt(p, o.root, seq, { at, result: 'interrupted', reason, log });
    return { ok: false, reason };
  }
  // Hand the claim to the repair process, so the ticket stays owned (and counted) while it lives.
  patchRecord(dir, o.tracker, o.ticket, { pid });
  return { ok: true, attempt: claim.attempt, pid, branch: target.branch, log };
}
