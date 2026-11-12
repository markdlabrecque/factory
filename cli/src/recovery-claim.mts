// Recovery's atomic claim (slice four, #57). A repair attempt needs three things at once: a slot under the shared
// run cap (counted across every project in the run-state folder, as dispatcher launches are), ownership of the
// affected ticket (no run of it in flight, whether a dispatched launch or another attempt), and its project's single
// recovery slot (no other attempt running there, a confirmed jam that includes the ticket, budget left). claimRecovery
// takes them together under the board's claim lock (claimRun in board/board.mts), checking the project's recovery
// record (recovery-state.mts beginAttempt) last: either the attempt is recorded and the ticket's run record becomes a
// recovery reservation, or nothing changes and the reason is returned. The reservation keeps the record's branch and
// evidence, notes its previous stage under `recovery.from`, and has no `starting` flag, so a claimant that dies leaves
// the record stopped (not deleted) for crash reconciliation. Nothing here launches, signals or reads the tracker.
// The launcher (#74) passes the attempt's UUID, exact container name and attempt-record path, recorded with the attempt
// and (the UUID) on the run record, so the repair process can check it was started for exactly this attempt.
import { claimRun } from '../../board/board.mts';
import type { Paths } from './paths.mts';
import { beginAttempt, finishAttempt } from './recovery-state.mts';
import type { Attempt } from './recovery-state.mts';
import { runStateDir } from './runs.mts';

/** The dispatcher's default cap (SELECT.maxConcurrent in orchestrator/dispatch.mts). */
export const DEFAULT_CAP = 3;

export type RecoveryClaim = { ok: true; attempt: Attempt } | { ok: false; reason: string };

/** Claim capacity, ticket and project ownership for one repair attempt by process `pid`, or nothing. `tracker` is the
 *  project's TRACKER.project, the name its run records carry. */
export function claimRecovery(p: Paths, o: { root: string; tracker: string; ticket: number; pid: number; at: string;
  cap?: number; branch?: string; log?: string; dir?: string; id?: string; container?: string; record?: string }): RecoveryClaim {
  let attempt: Attempt | undefined;
  try {
    const claim = claimRun({
      iid: String(o.ticket), pid: o.pid, cap: o.cap ?? DEFAULT_CAP, project: o.tracker, dir: o.dir ?? runStateDir(p), exclusive: true,
      also: current => {
        attempt = beginAttempt(p, o.root, { ticket: o.ticket, at: o.at, pid: o.pid, branch: o.branch ?? current?.branch, log: o.log,
          id: o.id, container: o.container, record: o.record });
        return {
          note: `recovery attempt ${attempt.seq} starting`, starting: undefined,
          recovery: { attempt: attempt.seq, ...(o.id ? { id: o.id } : {}), ...(current ? { from: { stage: current.stage, note: current.note, stageSince: current.stageSince } } : {}) },
        };
      },
    });
    return claim.ok ? { ok: true, attempt: attempt! } : claim;
  } catch (e) {
    // The attempt was recorded but its run record could not be written: end it rather than leave it running.
    if (attempt) finishAttempt(p, o.root, attempt.seq, { at: o.at, result: 'interrupted', reason: `claim not recorded: ${(e as Error).message}` });
    throw e;
  }
}
