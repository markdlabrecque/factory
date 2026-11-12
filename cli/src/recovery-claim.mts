// Recovery's atomic claim (slice four, #57; admission record since #75). A repair attempt needs three things at once: a
// slot under the shared run cap (counted across every project in the run-state folder, as dispatcher launches are),
// ownership of the affected ticket (no claim or run of it in flight), and its whole project (no other run of it in flight,
// no other attempt, a confirmed jam that includes the ticket, at the project's current activity generation, with budget
// left). claimRecovery takes them under the admission record's one lock (board/admission.mts, board.mts admitRun):
// 1. replay: any attempt this project's admission record admitted whose charge never reached the recovery record (the
//    claimant crashed between the two writes) is applied now, by attempt UUID, so it is charged exactly once;
// 2. the shared checks plus recovery-state.mts attemptProblem (read-only), then one replacement of the admission record
//    holding the recovery claim (token, owner, attempt UUID) and its charge (the project's admitted counter and a pending
//    entry for the attempt);
// 3. the charge applied to the recovery record (beginAttempt, idempotent by UUID) and the pending entry cleared;
// 4. the ticket's run record written as a recovery reservation carrying the claim token, keeping its branch and evidence,
//    noting its previous stage under `recovery.from`, with no `starting` flag.
// Either all of step 2 is committed or nothing is. A crash after it leaves a recovery claim that only the launcher's
// settle step releases (cli/src/recovery-run.mts, after the attempt's exact container is confirmed gone); an error
// after it is thrown, never refunded. Nothing here launches, signals or reads the tracker.
import { generationOf, keyFor, withAdmission } from '../../board/admission.mts';
import type { AdmissionTx } from '../../board/admission.mts';
import { admitRun, writeRecord } from '../../board/board.mts';
import type { Paths } from './paths.mts';
import { attemptProblem, beginAttempt, readRecovery } from './recovery-state.mts';
import type { Attempt } from './recovery-state.mts';
import { runStateDir } from './runs.mts';

/** The dispatcher's default cap (SELECT.maxConcurrent in orchestrator/dispatch.mts). */
export const DEFAULT_CAP = 3;

export type RecoveryClaim = { ok: true; attempt: Attempt; token: string } | { ok: false; reason: string };

/** Apply the charges of attempts `tracker`'s admission record admitted but the recovery record of `root` never got
 *  (inside withAdmission). Each is recorded once, by UUID, and then cleared from `pending`. */
export function replayAdmitted(p: Paths, tx: AdmissionTx, root: string, tracker: string): void {
  const r = tx.state.recovery[tracker];
  if (!r?.pending.some(a => a.root === root)) return;
  for (const a of r.pending.filter(x => x.root === root)) {
    beginAttempt(p, root, { ticket: Number(a.iid), at: a.at, id: a.id, branch: a.branch, log: a.log, container: a.container, record: a.record, replay: true });
    r.pending = r.pending.filter(x => x.id !== a.id);
    tx.commit();
  }
}

/** Claim capacity, ticket and project ownership for one repair attempt by process `pid`, or nothing. `tracker` is the
 *  project's TRACKER.project, the name its run records carry; `id` the attempt's UUID. */
export function claimRecovery(p: Paths, o: { root: string; tracker: string; ticket: number; pid: number; at: string; id: string;
  cap?: number; branch?: string; log?: string; dir?: string; container?: string; record?: string;
  /** Test hook: runs after the claim and charge are committed, before the charge is applied (a crash point). */
  afterCommit?: () => void }): RecoveryClaim {
  const dir = o.dir ?? runStateDir(p);
  return withAdmission(dir, tx => {
    replayAdmitted(p, tx, o.root, o.tracker);
    const generation = generationOf(tx.state, o.tracker);
    const a = admitRun(tx, dir, {
      iid: String(o.ticket), pid: o.pid, cap: o.cap ?? DEFAULT_CAP, project: o.tracker, kind: 'recovery', attempt: o.id,
      also: () => {
        const problem = attemptProblem(readRecovery(p, o.root), o.ticket, generation);
        if (problem) throw new Error(problem);
      },
    });
    if (!a.ok) return a;
    const branch = o.branch ?? a.current?.branch;
    const r = tx.state.recovery[o.tracker] ??= { admitted: 0, pending: [] };
    r.admitted++;
    r.pending.push({ id: o.id, iid: String(o.ticket), root: o.root, at: o.at, ...(branch ? { branch } : {}), ...(o.log ? { log: o.log } : {}),
      ...(o.container ? { container: o.container } : {}), ...(o.record ? { record: o.record } : {}) });
    tx.commit(); // the claim and its charge, in one replacement
    o.afterCommit?.();
    const attempt = beginAttempt(p, o.root, { ticket: o.ticket, at: o.at, pid: o.pid, branch, log: o.log, id: o.id, container: o.container,
      record: o.record, replay: true });
    r.pending = r.pending.filter(x => x.id !== o.id);
    tx.commit();
    const c = a.current;
    writeRecord(dir, keyFor(String(o.ticket), o.tracker), {
      ...a.run, note: `recovery attempt ${attempt.seq} starting`, starting: undefined,
      recovery: { attempt: attempt.seq, id: o.id, ...(c ? { from: { stage: c.stage, note: c.note, stageSince: c.stageSince } } : {}) },
    });
    return { ok: true, attempt, token: a.token };
  });
}
