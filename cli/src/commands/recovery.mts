// `factory recovery status|reset|review [--project <name|path>] [--json (status)] [--confirm (review)]` (slice four
// self-recovery, #62; review #63).
// status: whether recovery is active in the project (recovery-review.mts recoveryCopyProblem: the copy must have the
// complete recovery workflow, unchanged since it was reviewed), the
// current jam and its confirmation, the running attempt and any recovery claim, each ticket's attempt budget and how it
// was last renewed, recent attempts newest first with their outcome, reason, repair log and retained report (and whether
// those files still exist), renewals and ended episodes. Read-only: it never settles, launches or touches tickets.
// reset: the explicit project reset (recovery-state.mts resetRecovery). Under the admission lock (board/admission.mts),
// so it cannot interleave with a launch, it refuses while recovery is active (a running or unconfirmed attempt, a
// recovery claim, or an admitted attempt whose charge is still pending); otherwise it ends the jam episode, so
// confirmation starts over on later completed passes, and renews every ticket's budget. It never launches anything:
// re-evaluation is left to the normal scheduled passes. Ticket branches, worktrees, run records, logs, reports and
// evidence are untouched; recovery history is kept. Separate from `factory retry`, which clears one failed run.
// review: the explicit review gate for an existing project's hand-made upgrade (orchestrator/ADAPTING.md). Without
// --confirm it only lists each workflow file: missing, or whether it matches Factory's own copy, and whether it changed
// since the last review. With --confirm it records the files as they are now as reviewed (refused while any is missing or
// main.mts lacks --recover --attempt-record), which makes recovery active; any later edit makes it inactive again. It
// never copies or changes project files and launches nothing.
// recoverySummary is also what `factory status` shows (confirmation, attempts and outcomes); a malformed recovery record
// is reported there as a problem, never overwritten.
import { existsSync } from 'node:fs';
import { readAdmission, withAdmission } from '../../../board/admission.mts';
import type { AdmissionClaim } from '../../../board/admission.mts';
import type { Paths } from '../paths.mts';
import { changedSinceReview, missingWorkflow, readReview, recordReview, recoveryCopyProblem, workflowFiles } from '../recovery-review.mts';
import { ATTEMPT_LIMIT, CONFIRM_PASSES, readRecovery, recoveryFile, remainingAttempts, resetRecovery, runningAttempt } from '../recovery-state.mts';
import type { Attempt, Episode, RecoveryState, Renewal } from '../recovery-state.mts';
import { resolveProject, runStateDir } from '../runs.mts';
import type { ProjectContext } from '../runs.mts';
import { age } from '../scheduler-health.mts';

const RECENT = 10;
export type RecoveryOptions = { project?: string; cwd?: string; json?: boolean; confirm?: boolean; now?: number; at?: string };

export type AttemptView = Attempt & { logExists?: boolean; reportExists?: boolean };
export type RecoverySummary = {
  active: boolean; inactiveReason?: string; file: string; problem?: string;
  episode: Episode | null; running: Attempt | null; claim: AdmissionClaim | null;
  budgets: { ticket: number; used: number; remaining: number; renewedAt?: string; renewal?: string }[];
  attempts: AttemptView[]; renewals: Renewal[]; episodes: Episode[];
};

const withFiles = (a: Attempt): AttemptView => ({ ...a, ...(a.log ? { logExists: existsSync(a.log) } : {}), ...(a.report ? { reportExists: existsSync(a.report) } : {}) });

/** The project's recovery picture, newest history first. Never throws for a malformed record or admission file: it is `problem`. */
export function recoverySummary(p: Paths, ctx: ProjectContext): RecoverySummary {
  const copy = recoveryCopyProblem(p, ctx.root);
  const base = { active: !copy, ...(copy ? { inactiveReason: copy } : {}), file: recoveryFile(p, ctx.root) };
  let claim: AdmissionClaim | null = null;
  let problem: string | undefined;
  try { claim = Object.values(readAdmission(runStateDir(p)).claims).find(c => c.kind === 'recovery' && c.project === ctx.tracker) ?? null; }
  catch (e) { problem = (e as Error).message; }
  let s: RecoveryState;
  try { s = readRecovery(p, ctx.root); }
  catch (e) {
    return { ...base, problem: (e as Error).message, episode: null, running: null, claim, budgets: [], attempts: [], renewals: [], episodes: [] };
  }
  const budgets = Object.entries(s.budgets).map(([k, b]) => ({ ticket: Number(k), used: b.used, remaining: remainingAttempts(s, Number(k)),
    ...(b.renewedAt ? { renewedAt: b.renewedAt } : {}), ...(b.renewal ? { renewal: b.renewal } : {}) })).sort((a, b) => a.ticket - b.ticket);
  return { ...base, ...(problem ? { problem } : {}), episode: s.episode ?? null, running: runningAttempt(s) ?? null, claim, budgets,
    attempts: s.attempts.slice(-RECENT).reverse().map(withFiles), renewals: s.renewals.slice(-RECENT).reverse(), episodes: s.episodes.slice(-RECENT).reverse() };
}

const tickets = (xs: number[]) => xs.map(x => `#${x}`).join(' ');
/** `#12 #13, seen on 1 of 2 completed passes (since 4m ago)` or `#12, confirmed 3m ago`. */
export function describeJam(e: Episode | null, now: number): string {
  if (!e) return 'none';
  return e.confirmedAt ? `${tickets(e.tickets)}, confirmed ${age(e.confirmedAt, now)} ago`
    : `${tickets(e.tickets)}, seen on ${e.passes.length} of ${CONFIRM_PASSES} completed passes (since ${age(e.startedAt, now)} ago)`;
}
/** `attempt 3 on #12 running for 4m` or `attempt 2 on #12 unresolved 1h ago: reason`. */
export function describeAttempt(a: Attempt, now: number): string {
  if (a.result === 'running') return `attempt ${a.seq} on #${a.ticket} running for ${age(a.startedAt, now)}${a.container ? ` (${a.container})` : ''}`;
  return `attempt ${a.seq} on #${a.ticket} ${a.result} ${age(a.finishedAt ?? a.startedAt, now)} ago${a.reason ? `: ${a.reason}` : ''}`;
}

/** The lines `factory status` shows under the project. */
export function recoveryStatusLines(r: RecoverySummary, name: string, now: number): string[] {
  const why = r.inactiveReason?.includes('no recovery workflow') ? 'no recovery workflow in this copy' : 'workflow not reviewed as it is';
  const out = [`Recovery: ${r.active ? 'active' : `inactive (${why})`}${r.problem ? '' : `, jam: ${describeJam(r.episode, now)}`}`];
  if (r.problem) out.push(`  Problem: ${r.problem}`);
  if (r.running) out.push(`  Running: ${describeAttempt(r.running, now)}`);
  const last = r.attempts.find(a => a.result !== 'running');
  if (last) out.push(`  Last attempt: ${describeAttempt(last, now)}`);
  const spent = r.budgets.filter(b => b.used > 0);
  if (spent.length) out.push(`  Attempts left: ${spent.map(b => `#${b.ticket} ${b.remaining}/${ATTEMPT_LIMIT}`).join(', ')}`);
  if (r.problem || r.running || last || r.episode) out.push(`  Details: factory recovery status --project ${name}`);
  return out;
}

function show(ctx: ProjectContext, r: RecoverySummary, now: number) {
  console.log(`Recovery for ${ctx.name} (${ctx.tracker})  ${ctx.root}`);
  console.log(r.active ? 'State: active' : `State: inactive: ${r.inactiveReason}`);
  if (r.problem) console.log(`Problem: ${r.problem}`);
  console.log(`Jam: ${describeJam(r.episode, now)}`);
  console.log(`Running: ${r.running ? describeAttempt(r.running, now) : 'none'}`);
  if (r.claim) console.log(`Claim: #${r.claim.iid} held since ${r.claim.at} by process ${r.claim.owner.pid}${r.claim.attempt ? ` for attempt ${r.claim.attempt}` : ''}`);
  if (r.budgets.length) {
    console.log('Budgets:');
    for (const b of r.budgets) console.log(`  #${b.ticket}  ${b.remaining} of ${ATTEMPT_LIMIT} attempts left${b.renewal ? `  (renewed by ${b.renewal} ${b.renewedAt})` : ''}`);
  }
  if (r.attempts.length) {
    console.log('Attempts, newest first:');
    for (const a of r.attempts) {
      console.log(`  ${String(a.seq).padEnd(3)} #${String(a.ticket).padEnd(5)} ${a.result.padEnd(17)} ${a.startedAt}${a.finishedAt ? ` -> ${a.finishedAt}` : ''}${a.branch ? `  [${a.branch}]` : ''}`);
      if (a.reason) console.log(`      ${a.reason}`);
      if (a.log) console.log(`      log: ${a.log}${a.logExists ? '' : ' (missing)'}`);
      if (a.report) console.log(`      report: ${a.report}${a.reportExists ? '' : ' (missing)'}`);
    }
  }
  if (r.renewals.length) {
    console.log('Renewals, newest first:');
    for (const x of r.renewals) console.log(`  ${x.at}  ${x.kind}${x.ticket ? ` #${x.ticket}` : ''}${x.detail ? `  ${x.detail}` : ''}`);
  }
  if (r.episodes.length) {
    console.log('Ended jams, newest first:');
    for (const e of r.episodes) console.log(`  ${e.endedAt}  ${e.end}  ${tickets(e.tickets)}${e.confirmedAt ? `  (confirmed ${e.confirmedAt})` : ''}`);
  }
  console.log(`Recovery logs: factory logs <ticket> --recovery --project ${ctx.name}`);
}

/** Why the project's recovery is active now, under the admission lock, or null. */
function activeProblem(s: RecoveryState, claims: AdmissionClaim[], pending: boolean): string | null {
  const running = runningAttempt(s);
  if (running) return `recovery attempt ${running.seq} on #${running.ticket} is running or its container is not yet confirmed gone; the next scheduled pass settles it`;
  if (claims.length) return `a recovery claim holds #${claims[0].iid} (process ${claims[0].owner.pid})`;
  if (pending) return 'an admitted recovery attempt is still being recorded';
  return null;
}

/** `factory recovery review`: list the workflow files; with --confirm, record them as reviewed. */
function review(p: Paths, ctx: ProjectContext, o: RecoveryOptions): number {
  const prior = readReview(p, ctx.root);
  const changed = prior && typeof prior === 'object' ? changedSinceReview(ctx.root, prior) : null;
  console.log(`Recovery workflow in ${ctx.root}/.sandcastle (${ctx.name})`);
  for (const f of workflowFiles(ctx.root)) {
    const notes = !f.present ? ['missing']
      : [f.matchesFactory === null ? 'project-specific' : f.matchesFactory ? "same as Factory's" : "differs from Factory's copy",
        ...(changed ? [changed.includes(f.file) ? 'changed since review' : 'reviewed'] : [])];
    console.log(`  ${f.file.padEnd(22)} ${notes.join(', ')}`);
  }
  const missing = missingWorkflow(ctx.root);
  console.log(prior === null ? 'Review: none recorded' : typeof prior === 'string' ? `Review: ${prior}` : `Review: recorded ${prior.reviewedAt} (${prior.by})`);
  if (missing.length) {
    console.error(`factory: the copy is missing ${missing.join(', ')}. Upgrade it by hand (orchestrator/ADAPTING.md, "Upgrading an existing project for self-recovery"); recovery stays inactive. Nothing was recorded.`);
    return 1;
  }
  if (!o.confirm) {
    console.log(`Recovery is ${recoveryCopyProblem(p, ctx.root) ? 'inactive' : 'active'}. Check these files (with your customizations) against Factory's workflow, then run: factory recovery review --confirm --project ${ctx.name}`);
    return 0;
  }
  recordReview(p, ctx.root, { at: o.at });
  console.log(`Recorded the review: recovery is active for ${ctx.name}. Editing any of these files turns it off until it is reviewed again. Nothing was launched.`);
  return 0;
}

export async function recovery(p: Paths, action: string | undefined, o: RecoveryOptions = {}): Promise<number> {
  if (action !== 'status' && action !== 'reset' && action !== 'review') {
    throw new Error('Usage: factory recovery status|reset|review [--project <name|path>] [--json (status)] [--confirm (review)]');
  }
  const ctx = resolveProject(p, o);
  const now = o.now ?? Date.now();
  if (action === 'review') return review(p, ctx, o);
  if (action === 'status') {
    const r = recoverySummary(p, ctx);
    if (o.json) console.log(JSON.stringify({ version: 1, project: { name: ctx.name, root: ctx.root, tracker: ctx.tracker }, recovery: r }, null, 2));
    else show(ctx, r, now);
    return r.problem ? 1 : 0;
  }
  const at = o.at ?? new Date(now).toISOString();
  const refused = withAdmission(runStateDir(p), tx => {
    const claims = Object.values(tx.state.claims).filter(c => c.kind === 'recovery' && c.project === ctx.tracker);
    const pending = Object.values(tx.state.recovery).some(x => x.pending.some(a => a.root === ctx.root));
    const problem = activeProblem(readRecovery(p, ctx.root), claims, pending);
    if (problem) return problem;
    resetRecovery(p, ctx.root, { at, detail: 'factory recovery reset' });
    return null;
  });
  if (refused) {
    console.error(`factory: reset refused for ${ctx.name}: ${refused}. Nothing changed.`);
    return 1;
  }
  console.log(`Reset recovery for ${ctx.name}: the jam episode ended, so confirmation starts over on later completed passes, and every ticket has ${ATTEMPT_LIMIT} attempts again.`);
  console.log('Nothing was launched; the next scheduled passes re-evaluate the project. Ticket branches, worktrees, run records, logs, reports and evidence are untouched.');
  return 0;
}
