// Local recovery maintenance and read-only follow-up projection. Settlement retains exact-container and owner fencing.
// Observations describe saved work, not permission to launch: only successful scheduled passes can confirm/admit repair.
// No tracker, dispatcher, refresh, budget renewal, project edit or agent launch happens here. Status uses the same
// projection without settlement or writes. A delivered attempt/PR is outstanding until a host record confirms merge.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyFor, ownerState, readAdmission } from '../../board/admission.mts';
import type { AdmissionClaim } from '../../board/admission.mts';
import { PARKED, TERMINAL } from '../../board/board.mts';
import type { RunState } from '../../board/board.mts';
import { validDelivery } from '../../board/delivery.mts';
import type { Paths } from './paths.mts';
import { settleRecovery } from './recovery-run.mts';
import type { Settled } from './recovery-run.mts';
import { mutateRecovery, readRecovery, remainingAttempts, runningAttempt } from './recovery-state.mts';
import type { Followup, RecoveryState } from './recovery-state.mts';

export type FollowupFacts = { recovery: RecoveryState; runs: RunState[]; claims: AdmissionClaim[];
  owners: Record<string, ReturnType<typeof ownerState>>; paused?: string; settled?: Settled; at: string };

/** Pure projection. Saved observations keep tracked records visible and preserve timestamps, never supply evidence
 *  or admission authority. Owner observations are captured by the caller so projection is deterministic. */
export function projectFollowups(f: FollowupFacts): Record<string, Followup> {
  const out: Record<string, Followup> = {};
  const running = runningAttempt(f.recovery);
  const claim = f.claims.find(c => c.kind === 'recovery');
  const owner = claim ? f.owners[claim.token] ?? 'unknown' : undefined;
  const uncertain = f.settled?.state === 'unconfirmed' ? f.settled.reason
    : claim && (owner !== 'alive' || !running?.id || running.id !== claim.attempt)
      ? 'Recovery ownership or cleanup is not confirmed.'
      : running && !claim ? 'The running attempt has no matching recovery claim.' : undefined;
  const runs = [...f.runs];
  // A held attempt/claim with a missing run is still outstanding, never silently hidden by record removal.
  for (const ticket of [running?.ticket, claim ? Number(claim.iid) : undefined]) {
    if (ticket && !runs.some(r => Number(r.iid) === ticket)) runs.push({ iid: String(ticket), stage: 'stopped' } as RunState);
  }
  for (const r of runs) {
    const ticket = Number(r.iid);
    if (!Number.isSafeInteger(ticket) || ticket < 1) continue;
    const last = f.recovery.attempts.filter(a => a.ticket === ticket).at(-1);
    const merged = !!r.mergedAt || r.delivery?.state === 'merged';
    const relevant = (r.stage === 'stopped' && !!r.branch) || !!r.delivery || !!r.mr || !!last
      || claim?.iid === r.iid || !!f.recovery.followups?.[ticket];
    if (!relevant) continue;
    let state: Followup['state'], reason: string, nextAction: string;
    if (merged) {
      state = 'complete'; reason = 'The local authoritative record confirms merged work.';
      nextAction = 'No recovery follow-up required.';
    } else if (uncertain) {
      state = 'operator-required'; reason = uncertain;
      nextAction = 'Confirm the recorded owner and exact container cleanup; retain the claim until settlement is safe.';
    } else if (running || claim || f.settled?.state === 'running') {
      const activeTicket = running?.ticket ?? claim?.iid ?? (f.settled?.state === 'running' ? f.settled.attempt.ticket : undefined);
      state = 'waiting'; reason = `Recovery on #${activeTicket} is active.`;
      nextAction = 'Wait for local settlement, then a successful scheduled pass will re-evaluate remaining saved work.';
    } else if (f.paused) {
      state = 'paused'; reason = f.paused;
      nextAction = 'An operator must opt in or resume project scheduling; maintenance never changes the pause.';
    } else if (!remainingAttempts(f.recovery, ticket)) {
      state = 'operator-required'; reason = 'The ticket has exhausted its recovery attempt budget.';
      nextAction = 'Needs verified progress, an attributable requirement change, or an explicit operator recovery reset. No automatic reset.';
    } else if (last?.result === 'host-followup' || last?.result === 'ownership-refused') {
      state = 'operator-required'; reason = `Recorded ${last.result}: ${last.reason ?? 'host action remains required'}`;
      nextAction = 'Resolve the recorded host prerequisite or ownership problem; no credentials or product decisions are inferred.';
    } else if (r.delivery || r.mr || last?.result === 'delivered') {
      state = 'operator-required'; reason = `PR opened or delivery handed off, awaiting gates${r.delivery ? `: ${r.delivery.reasonCode}` : ''}. This is not merged completion.`;
      nextAction = 'Follow the normal delivery workflow through independent verification, CI, review and confirmed merge; resolve any operator delivery hold.';
    } else if (f.claims.some(c => f.owners[c.token] !== 'dead')) {
      state = 'waiting'; reason = 'Competing admitted work still owns this project.';
      nextAction = 'Wait for admission to clear; later successful scheduled passes re-evaluate saved work.';
    } else {
      state = 'pending'; reason = 'Saved work remains outstanding for normal recovery re-evaluation.';
      nextAction = 'Wait for successful eligible scheduled passes, fresh analysis and two-pass confirmation; normal ownership, prerequisite and admission gates still apply.';
    }
    const before = f.recovery.followups?.[ticket];
    const changedAt = before?.state === state && before.reason === reason && before.nextAction === nextAction ? before.changedAt : f.at;
    out[ticket] = { state, reason, nextAction, changedAt };
  }
  return out;
}

/** Strict, read-only local run facts. Do not let an unreadable record masquerade as removed work. */
export function followupRuns(dir: string, tracker: string): RunState[] {
  let files: string[];
  try { files = readdirSync(dir); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  const prefix = keyFor('', tracker);
  return files.filter(n => n.startsWith(prefix) && n.endsWith('.json')).map(n => {
    const r = JSON.parse(readFileSync(join(dir, n), 'utf8')) as RunState;
    if (r.project !== tracker || !/^[1-9]\d*$/.test(r.iid)
      || !['queued', 'waiting', 'setup', 'implementing', 'verifying', 'posting', 'pushing', 'ci', 'done', 'stopped'].includes(r.stage)
      || (r.branch !== undefined && typeof r.branch !== 'string')
      || (r.mergedAt !== undefined && (typeof r.mergedAt !== 'string' || !Number.isFinite(Date.parse(r.mergedAt))))
      || (r.delivery !== undefined && !validDelivery(r.delivery))) throw new Error(`Invalid recovery follow-up run record: ${n}`);
    // Observe a dead run as stopped without writing the board's crash reconciliation.
    if (!TERMINAL.includes(r.stage) && !PARKED.includes(r.stage) && ownerState({ pid: r.pid }) === 'dead') {
      return { ...r, stage: 'stopped' as const };
    }
    return r;
  });
}

export type FollowupOptions = { root: string; tracker: string; dir: string; paused?: string; at?: string; settled?: Settled };
const observeOwners = (claims: AdmissionClaim[]) => Object.fromEntries(claims.map(c => [c.token, ownerState(c.owner)]));

/** Current local facts, shared by status and maintenance. Does not probe/remove containers or write any state. */
export function currentFollowups(p: Paths, o: FollowupOptions): Record<string, Followup> {
  const claims = Object.values(readAdmission(o.dir).claims).filter(c => c.project === o.tracker);
  return projectFollowups({ recovery: readRecovery(p, o.root), runs: followupRuns(o.dir, o.tracker),
    claims, owners: observeOwners(claims), paused: o.paused,
    settled: o.settled, at: o.at ?? new Date().toISOString() });
}

/** Persist only changed observations. Missing run records are authoritative removal, not another attempt finishing. */
export function refreshFollowups(p: Paths, o: FollowupOptions): Record<string, Followup> {
  // Read external facts before mutation; read/write failures propagate and leave previous observations intact.
  const runs = followupRuns(o.dir, o.tracker);
  const claims = Object.values(readAdmission(o.dir).claims).filter(c => c.project === o.tracker);
  const owners = observeOwners(claims);
  return mutateRecovery(p, o.root, recovery => {
    const followups = projectFollowups({ recovery, runs, claims, owners, paused: o.paused, settled: o.settled,
      at: o.at ?? new Date().toISOString() });
    const write = JSON.stringify(recovery.followups ?? {}) !== JSON.stringify(followups);
    if (write) recovery.followups = followups;
    return { write, value: followups };
  });
}

/** Called while the tick lock is held, before project pause/dispatch gates. Never confirms a pass or launches work. */
export function maintainRecovery(p: Paths, o: FollowupOptions & { log: (line: string) => void; settle?: typeof settleRecovery }): void {
  // Validate saved observations and local runs before settlement can modify admission or run records.
  readRecovery(p, o.root);
  followupRuns(o.dir, o.tracker);
  const settled = (o.settle ?? settleRecovery)(p, o);
  if (settled.state === 'settled') o.log(`attempt ${settled.attempt.seq} on #${settled.attempt.ticket} ended: ${settled.attempt.result}`);
  refreshFollowups(p, { ...o, settled });
}
