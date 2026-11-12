// Jam confirmation after normal dispatch (slice four self-recovery, #61). The scheduler's tick (commands/tick.mts) gives
// every scheduled pass its own pass id and report file (FACTORY_PASS_ID, FACTORY_JAM_REPORT); the project's dispatcher
// writes there what it saw after its normal work (orchestrator/dispatch.mts, graph.mts findJam): the jammed tickets, or
// why there is no jam, and the requirement fingerprint of each jammed or still-ready ticket with a run record. Only once
// the pass has exited 0, without cancellation, does the tick call afterPass, which:
// 1. settles the project's recovery attempt (recovery-run.mts settleRecovery). While one runs, or its container is not
//    confirmed gone, the pass is not counted at all: the attempt holds the project, so it is neither a jam nor progress.
// 2. observes each reported ticket (recovery-state.mts observeTicket, with deliveryMarker of its run record), so a human
//    requirement change or verified delivery renews that ticket's spent budget.
// 3. counts the pass (observePass, with the project's admission activity generation): the same jam on two consecutive
//    completed passes, with no normal admission between them, is confirmed; a pass with no jam ends the episode.
// 4. for a confirmed jam, picks the lowest still-stopped jammed ticket with attempts left (dependency-held tickets have no
//    work of their own to repair; their stopped prerequisite is the target) and, only when the project's copy has the
//    recovery workflow, reviewed as it is (recovery-review.mts recoveryCopyProblem, #63; otherwise recovery stays inactive
//    and the jam is only recorded), and the
//    caller still allows new work (`mayLaunch`: not cancelled, scheduler still on), launches one attempt
//    (launchRecovery), which rechecks everything under the admission lock.
// A missing report (a dispatcher copy older than #61; nothing is logged), one for another pass or project, or a malformed
// one is not counted.
// Errors are logged and never fail the pass. The report file is the caller's to remove.
import { existsSync, readFileSync } from 'node:fs';
import { generationOf, readAdmission } from '../../board/admission.mts';
import { readRuns } from '../../board/board.mts';
import type { Paths } from './paths.mts';
import { recoveryCopyProblem } from './recovery-review.mts';
import { launchRecovery, settleRecovery } from './recovery-run.mts';
import { attemptProblem, deliveryMarker, observePass, observeTicket, readRecovery } from './recovery-state.mts';

export type JamReport = { version: 1; pass: string; project: string; at: string; tickets: number[]; reasons?: Record<string, string>;
  none?: string; observed: { iid: number; content: string; labels: string[] }[] };

const isIid = (x: unknown) => Number.isInteger(x) && (x as number) > 0;
/** The pass's report, null when there is none (a dispatcher copy older than #61), or why it cannot be counted. */
export function readJamReport(file: string, pass: string, project: string): JamReport | string | null {
  if (!existsSync(file)) return null;
  let d: any;
  try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { return `jam report ${file} is not valid JSON`; }
  const ok = d?.version === 1 && typeof d.pass === 'string' && typeof d.project === 'string' && typeof d.at === 'string' && !Number.isNaN(Date.parse(d.at))
    && Array.isArray(d.tickets) && d.tickets.every(isIid) && Array.isArray(d.observed)
    && d.observed.every((t: any) => isIid(t?.iid) && typeof t.content === 'string' && Array.isArray(t.labels) && t.labels.every((l: unknown) => typeof l === 'string'));
  if (!ok) return `jam report ${file} is malformed`;
  if (d.pass !== pass) return `jam report is for pass ${d.pass}, not ${pass}`;
  if (d.project !== project) return `jam report is for ${d.project}, not ${project}`;
  return d;
}

export type AfterPassOptions = { root: string; tracker: string; name: string; pass: string; report: string; dir: string;
  mayLaunch: () => Promise<boolean>; log: (line: string) => void; now?: () => Date;
  settle?: typeof settleRecovery; launch?: typeof launchRecovery };

/** Settle, observe, confirm and maybe launch for one completed pass; see the file comment. Never throws. */
export async function afterPass(p: Paths, o: AfterPassOptions): Promise<void> {
  const say = (line: string) => o.log(`recovery ${o.name}: ${line}`);
  const now = () => (o.now ?? (() => new Date()))().toISOString();
  try {
    const settled = (o.settle ?? settleRecovery)(p, { root: o.root, tracker: o.tracker, dir: o.dir, at: now() });
    if (settled.state === 'settled') say(`attempt ${settled.attempt.seq} on #${settled.attempt.ticket} ended: ${settled.attempt.result}`);
    if (settled.state === 'running') return say(`attempt ${settled.attempt.seq} on #${settled.attempt.ticket} is running; pass not counted`);
    if (settled.state === 'unconfirmed') return say(`${settled.reason}; pass not counted`);
    const report = readJamReport(o.report, o.pass, o.tracker);
    if (report === null) return; // an older dispatcher copy: recovery is not evaluated, quietly
    if (typeof report === 'string') return say(`${report}; pass not counted`);
    const runs = readRuns(o.dir).filter(r => r.project === o.tracker);
    const runOf = (t: number) => runs.find(r => r.iid === String(t));
    for (const t of report.observed) {
      const renewed = observeTicket(p, o.root, { ticket: t.iid, at: report.at, content: t.content, labels: t.labels, delivery: deliveryMarker(runOf(t.iid)) });
      if (renewed) say(`#${t.iid} budget renewed (${renewed.kind}: ${renewed.detail})`);
    }
    const generation = generationOf(readAdmission(o.dir), o.tracker);
    const episode = observePass(p, o.root, { pass: o.pass, at: report.at, jam: report.tickets, generation });
    if (!episode) return;
    const jam = episode.tickets.map(t => `#${t}`).join(', ');
    if (!episode.confirmedAt) return say(`jam on ${jam} seen (${episode.passes.length} of 2 passes)`);
    const state = readRecovery(p, o.root);
    const stopped = episode.tickets.filter(t => runOf(t)?.stage === 'stopped');
    const target = stopped.find(t => !attemptProblem(state, t, generation));
    if (target === undefined) {
      return say(`jam on ${jam} confirmed; ${stopped.length ? attemptProblem(state, stopped[0], generation) : 'no stopped ticket with recorded work to repair'}`);
    }
    const copy = recoveryCopyProblem(p, o.root);
    if (copy) return say(`jam on ${jam} confirmed; not repairing: ${copy}`);
    if (!(await o.mayLaunch())) return say(`jam on ${jam} confirmed; not repairing: scheduled work was stopped`);
    const launched = (o.launch ?? launchRecovery)(p, { root: o.root, tracker: o.tracker, ticket: target, dir: o.dir, at: now() });
    say(launched.ok ? `jam on ${jam} confirmed; attempt ${launched.attempt.seq} on #${target} started (pid ${launched.pid}, log ${launched.log})`
      : `jam on ${jam} confirmed; attempt on #${target} not started: ${launched.reason}`);
  } catch (e) {
    say(`not evaluated: ${(e as Error).message.split('\n')[0]}`);
  }
}
