// Scan stopped candidates once in numeric order; only a typed read-only ticket refusal permits continuation. Recheck
// cancellation, generation, budget, review and run state for every candidate. Local follow-up observations refresh after
// settlement and every launch/refusal. Only fresh successful-pass reports, never snapshots, can confirm/admit recovery.
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
// 4. for a confirmed jam, scans still-stopped jammed tickets with attempts left in numeric order (dependency-held tickets have no
//    work of their own to repair; their stopped prerequisite is the target) and, only when the project's copy has the
//    recovery workflow, reviewed as it is (recovery-review.mts recoveryCopyProblem, #63; otherwise recovery stays inactive
//    and the jam is only recorded), and the
//    caller still allows new work (`mayLaunch`: not cancelled, scheduler still on), launches one attempt
//    (launchRecovery), which rechecks everything under the admission lock.
// A missing report (a dispatcher copy older than #61; nothing is logged), one for another pass or project, or a malformed
// one is not counted.
// Errors are logged and never fail the pass. The report file is the caller's to remove.
import {join} from 'node:path';
import {prepareRecovery} from './recovery-prepare.mts';
import {mutateRecovery} from './recovery-state.mts';
import { appendFileSync,mkdirSync,existsSync, readFileSync } from 'node:fs';
import { generationOf, readAdmission } from '../../board/admission.mts';
import type { Paths } from './paths.mts';
import { refreshFollowups } from './recovery-followup.mts';
import type { Settled } from './recovery-run.mts';
import { recoveryCopyProblem } from './recovery-review.mts';
// Await both analysis preparation and image readiness before atomic claim-and-charge.
import { inspectRecoveryCandidate, launchRecovery, settleRecovery } from './recovery-run.mts';
import { readRecoveryRuns } from './recovery-claim.mts';
import { attemptProblem, deliveryMarker, observePass, observeTicket, readRecovery, remainingAttempts, runningAttempt } from './recovery-state.mts';

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
  signal?: AbortSignal; node?: string; path?: string; workflowEnv?: NodeJS.ProcessEnv;
  inspect?: typeof inspectRecoveryCandidate; prepare?: typeof prepareRecovery;
  settle?: typeof settleRecovery; pauseReason?: () => string | undefined;
  launch?: (...args: Parameters<typeof launchRecovery>) => ReturnType<typeof launchRecovery> | Awaited<ReturnType<typeof launchRecovery>> };

/** Settle, observe, confirm and maybe launch for one completed pass; see the file comment. Never throws. */
export async function afterPass(p: Paths, o: AfterPassOptions): Promise<void> {
  const say = (line: string) => o.log(`recovery ${o.name}: ${line}`);
  const now = () => (o.now ?? (() => new Date()))().toISOString();
  let settled: Settled | undefined;
  try {
    settled = (o.settle ?? settleRecovery)(p, { root: o.root, tracker: o.tracker, dir: o.dir, at: now() });
    refreshFollowups(p, { ...o, at: now(), settled, paused: o.pauseReason?.() });
    if (settled.state === 'settled') say(`attempt ${settled.attempt.seq} on #${settled.attempt.ticket} ended: ${settled.attempt.result}`);
    if (settled.state === 'running') return say(`attempt ${settled.attempt.seq} on #${settled.attempt.ticket} is running; pass not counted`);
    if (settled.state === 'unconfirmed') return say(`${settled.reason}; pass not counted`);
    const report = readJamReport(o.report, o.pass, o.tracker);
    if (report === null) return; // an older dispatcher copy: recovery is not evaluated, quietly
    if (typeof report === 'string') return say(`${report}; pass not counted`);
    const runs = readRecoveryRuns(o.dir).filter(r => r.project === o.tracker);
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
    const stopped = [...new Set(episode.tickets)].filter(t => runOf(t)?.stage === 'stopped').sort((a, b) => a - b);
    for (const target of stopped) {
      if (!(await o.mayLaunch())) return say(`jam on ${jam} confirmed; not repairing: scheduled work was stopped`);
      // mayLaunch is async. Read everything again after it, not before the scheduler/cancellation check.
      if (generationOf(readAdmission(o.dir), o.tracker) !== generation) return say('project-stopped generation-changed: normal admission changed the confirmed generation');
      const current = readRecoveryRuns(o.dir).find(r => r.project === o.tracker && r.iid === String(target));
      if (!current || current.stage !== 'stopped') return say(`project-stopped candidate-changed: #${target} is no longer stopped`);
      const state = readRecovery(p, o.root);
      if (state.episode?.id !== episode.id) return say('project-stopped episode-changed: confirmed jam changed during scan');
      const problem = attemptProblem(state, target, generation);
      if (problem) {
        if (!runningAttempt(state) && state.episode?.id === episode.id && state.episode.confirmedAt &&
            state.episode.generation === episode.generation && state.episode.tickets.includes(target) && !remainingAttempts(state, target)) {
          say(`#${target} not repairing: ${problem}`);
          continue; // only this ticket's exhausted budget is skippable
        }
        return say(`project-stopped recovery-held: ${problem}`);
      }
      const copy = recoveryCopyProblem(p, o.root);
      if (copy) return say(`jam on ${jam} confirmed; not repairing: ${copy}`);
      const inspected=(o.inspect??inspectRecoveryCandidate)(p,{root:o.root,tracker:o.tracker,ticket:target,dir:o.dir});
      if(!inspected.ok){
        if(inspected.kind==='ticket-refused'){say(`#${target} ticket-refused ${inspected.code}: ${inspected.reason}`);continue;}
        return say(`project-stopped ${inspected.code}: #${target}: ${inspected.reason}`);
      }
      const prepared=await (o.prepare??prepareRecovery)(p,{root:o.root,tracker:o.tracker,ticket:target,base:current.base??'',dir:o.dir,signal:o.signal,node:o.node,path:o.path,workflowEnv:o.workflowEnv});
      mutateRecovery(p,o.root,s=>{s.preparation={at:now(),ticket:target,state:prepared.state,code:prepared.code,reason:prepared.reason,scope:prepared.scope};return {write:true,value:undefined};});
      if(prepared.state!=='ready'){
        mkdirSync(join(o.root,'.sandcastle/logs'),{recursive:true});
        appendFileSync(join(o.root,'.sandcastle/logs',`recover-${target}.log`),`${now()} preparation ${prepared.code}: ${prepared.reason}\n`);
        return say(`jam on ${jam} confirmed; preparation ${prepared.code} (${prepared.scope} hold): ${prepared.reason}; no attempt charged`);
      }
      if(!(await o.mayLaunch()))return say(`jam on ${jam} confirmed; preparation complete but scheduled work was stopped; no attempt charged`);
      const launched = await (o.launch ?? launchRecovery)(p, { root: o.root, tracker: o.tracker, ticket: target, dir: o.dir, at: now(), preparation: prepared, mayLaunch: o.mayLaunch, signal: o.signal, node: o.node, path: o.path, workflowEnv: o.workflowEnv });
      refreshFollowups(p, { ...o, at: now(), paused: o.pauseReason?.() });
      switch (launched.kind) {
        case 'ticket-refused':
          say(`#${target} ticket-refused ${launched.code}: ${launched.reason}`);
          return; // analysis has run for this selected target; never scan after preparation
        case 'started':
          return say(`jam on ${jam} confirmed; attempt ${launched.attempt.seq} on #${target} started (pid ${launched.pid}, log ${launched.log})`);
        case 'admitted-failed':
          return say(`admitted-failed: attempt ${launched.attempt.seq} on #${target}: ${launched.reason}`);
        case 'project-stopped':
          return say(`project-stopped ${launched.code}: #${target}: ${launched.reason}`);
        default: {
          const unexpected: never = launched;
          throw new Error(`unknown launch outcome: ${JSON.stringify(unexpected)}`);
        }
      }
    }
    say(`jam on ${jam} confirmed; no stopped candidate admitted (${stopped.length} considered)`);
  } catch (e) {
    say(`not evaluated: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    try { refreshFollowups(p, { ...o, at: now(), settled, paused: o.pauseReason?.() }); }
    catch (e) { say(`follow-up not recorded: ${(e as Error).message.split('\n')[0]}`); }
  }
}
