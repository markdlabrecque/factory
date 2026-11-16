// Admission rechecks stopped state and the validated work snapshot under the shared lock. Strict recovery reads never reconcile or hide malformed run records.
// #137: recovery uses the TOML dispatch cap against the shared board; absent TOML keeps the legacy default.
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
// Exact preparation identity is checked under admission/publication locks before an attempt is charged.
import {executionManifestFile,readinessProblem} from './recovery-readiness.mts';
import type {ReadinessRefusal} from './recovery-readiness.mts';
import type {Preparation,PreparationCode} from '../../orchestrator/recovery-analysis-contract.mts';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import type { RunState } from '../../board/board.mts';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
import { generationOf, keyFor, withAdmission, withAdmissionLock } from '../../board/admission.mts';
import type { AdmissionTx } from '../../board/admission.mts';
import { admitRun, readRuns, writeRecord } from '../../board/board.mts';
import type { Paths } from './paths.mts';
import { attemptProblem, beginAttempt, readRecovery } from './recovery-state.mts';
import type { Attempt } from './recovery-state.mts';
import { runStateDir } from './runs.mts';

/** The dispatcher's default cap (SELECT.maxConcurrent in orchestrator/dispatch.mts). */
export const DEFAULT_CAP = 3;

export type RecoveryClaim = { ok: true; attempt: Attempt; token: string } | { ok: false; reason: string; code?: PreparationCode; scope?: 'ticket'|'project' };

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

/** Recovery must not reconcile runs or silently skip malformed shared records during candidate validation. */
export function readRecoveryRuns(dir: string) {
  let files: string[];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  for (const file of files) {
    const r = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!r || typeof r.iid !== 'string' || typeof r.stage !== 'string' || typeof r.startedAt !== 'string') {
      throw new Error(`malformed shared run record ${file}`);
    }
  }
  const runs = readRuns(dir, false);
  if (runs.length !== files.length) throw new Error('unreadable or malformed shared run records; recovery held');
  return runs;
}

/** Identity of the recorded work validated before preparation. Admission must still see this exact work. */
export const recoveryWork = (r: RunState) => JSON.stringify([r.iid, r.project, r.branch, r.base, r.evidenceDir,
  r.startedAt, r.executionId, r.implementationBaseSha, r.claim, r.recovery]);

/** Claim capacity, ticket and project ownership for one repair attempt by process `pid`, or nothing. `tracker` is the
 *  project's TRACKER.project, the name its run records carry; `id` the attempt's UUID. */
export function claimRecovery(p: Paths, o: { root: string; tracker: string; ticket: number; pid: number; at: string; id: string;
  preparation?: Preparation;
  cap?: number; branch?: string; log?: string; dir?: string; container?: string; record?: string;
  expected?: RunState; generation?: number; episode?: string; validate?: () => void;
  /** Test hook: runs after the claim and charge are committed, before the charge is applied (a crash point). */
  afterCommit?: () => void }): RecoveryClaim {
  const toml = loadTomlConfig(join(o.root, '.factory'));
  const cap = o.cap ?? toml?.dispatch.maxConcurrent ?? DEFAULT_CAP;
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('Recovery cap must be a positive safe integer');
  const dir = o.dir ?? runStateDir(p);
  return withAdmission(dir, tx => {
    let entered=false;
    try { return withAdmissionLock(`${executionManifestFile(dir,o.tracker,o.ticket)}.publication`, () => {
    entered=true;
    replayAdmitted(p, tx, o.root, o.tracker);
    const generation = generationOf(tx.state, o.tracker);
    const problem = attemptProblem(readRecovery(p, o.root), o.ticket, generation);
    if (problem) return { ok: false, reason: problem };
    if (o.episode !== undefined && readRecovery(p, o.root).episode?.id !== o.episode) return { ok: false, reason: 'confirmed episode changed before admission' };
    // Inspect the stored stage before admitRun's normal dead-process reconciliation can rewrite it.
    const before = readRecoveryRuns(dir).find(r => r.project === o.tracker && r.iid === String(o.ticket));
    if (!before || before.stage !== 'stopped') return { ok: false, reason: `#${o.ticket} already has a run in flight or is no longer stopped (${before?.stage ?? 'missing'})` };
    if (o.expected && recoveryWork(before) !== recoveryWork(o.expected)) return { ok: false, reason: 'candidate recorded work changed before admission' };
    let readinessRefused:ReadinessRefusal|undefined;
    const a = admitRun(tx, dir, {
      iid: String(o.ticket), pid: o.pid, cap, project: o.tracker, kind: 'recovery', attempt: o.id,
      also: current => {
        const stored = readRecoveryRuns(dir).find(r => r.project === o.tracker && r.iid === String(o.ticket));
        if (!stored || stored.stage !== 'stopped' || recoveryWork(stored) !== recoveryWork(before)) throw new Error('candidate recorded work changed before admission');
        const problem = attemptProblem(readRecovery(p, o.root), o.ticket, generation);
        if (problem) throw new Error(problem);
        if (!current || current.stage !== 'stopped') throw new Error('candidate is no longer stopped');
        if (o.branch && current.branch !== o.branch || o.expected && recoveryWork(current) !== recoveryWork(o.expected)) {
          throw new Error('candidate recorded work changed before admission');
        }
        if (o.generation !== undefined && generation !== o.generation) throw new Error('project generation changed before admission');
        const readiness=readinessProblem({...o,dir},current);
        if(readiness){readinessRefused=readiness;throw new Error(readiness.reason);}
        o.validate?.();
      },
    });
    if (!a.ok) return readinessRefused ? {...a,...readinessRefused} : a;
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
    },0); } catch(e) {
      if(entered)throw e;
      return {ok:false,code:'ownership',scope:'project',reason:`Execution manifest publication ownership unavailable: ${e}`};
    }
  });
}
