// `factory status [--json] [--project <name>]`: the board service's state and URL, then every run of the project
// picked by runs.mts with its stage, how long it has been there, title, branch, verdict, PR and note. A run whose
// process is gone without finishing shows as stopped (read-only; its record is left alone). `--json` prints the same
// data as `{version:1, project, board, runs}`, plus `scheduler` and `schedule` when a scheduler backend is given (the CLI
// always gives one). Only one project.
// Scheduler health and timings (#37, scheduler-health.mts): the service manager's answer (on, off or unknown with the
// reason; a failed query is never on), whether a tick is running, the last tick and tick timings from the history, health
// problems and enabled legacy timers; then this project's switch and branch, why it would not get a pass (or `ready`), its
// last pass from state.json, and its pass timings and most recent passes from the history. Read-only; a malformed
// scheduler file is shown as a problem, not an error.
import { existsSync } from 'node:fs';
import { boardURL } from '../paths.mts';
import type { Paths } from '../paths.mts';
import type { ServiceBackend } from '../platform/index.mts';
import { projectRuns, resolveProject } from '../runs.mts';
import type { Run, ProjectContext } from '../runs.mts';
import type { ScheduleBackend } from '../platform/scheduler.mts';
import { currentBranch, scheduleBlocker } from '../schedule.mts';
import type { ProjectState } from '../schedule-state.mts';
import { age, describeTick, describeTimings, formatMs, passEntries, schedulerHealth, summarize, tickEntries } from '../scheduler-health.mts';
import { legacyAdvice, legacyTimers } from './schedule.mts';
export type StatusOptions = { project?: string; cwd?: string; json?: boolean; now?: number; schedule?: Pick<ScheduleBackend, 'status' | 'logHint'> };
const RECENT = 5;

function line(r: Run, now: number): string {
  const extra = [r.title, r.branch && `[${r.branch}]`, r.verdict && `verdict ${r.verdict}`, r.mr, r.note && `- ${r.note}`].filter(Boolean).join('  ');
  return `#${r.iid.padEnd(5)} ${r.stage.padEnd(12)} ${age(r.stageSince, now).padStart(4)}  ${extra}`.trimEnd();
}

export async function status(p: Paths, service: Pick<ServiceBackend, 'status'>, o: StatusOptions = {}): Promise<void> {
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  let state: string;
  try { state = await service.status(); } catch (e) { state = `unknown (${e instanceof Error ? e.message.split('\n')[0] : e})`; }
  const runs = projectRuns(p, ctx);
  const now = o.now ?? Date.now();
  const sched = o.schedule ? await scheduling(p, o.schedule, ctx, now) : null;
  if (o.json) {
    console.log(JSON.stringify({ version: 1, project: { name: ctx.name, root: ctx.root, tracker: ctx.tracker }, board: { service: state, url: boardURL },
      ...(sched ? { scheduler: sched.scheduler, schedule: sched.schedule } : {}), runs }, null, 2));
    return;
  }
  console.log(`Board: ${state}  ${boardURL}`);
  if (sched) for (const l of sched.text.scheduler) console.log(l);
  console.log(`Project: ${ctx.name} (${ctx.tracker})  ${ctx.root}`);
  if (sched) for (const l of sched.text.schedule) console.log(l);
  if (!runs.length) console.log('No runs yet.');
  else for (const r of runs) console.log(line(r, now));
}

/** `ok (exit 0) 3m ago, took 2m03s`, `running for 2m (pid 123)`, `skipped 1m ago: checkout missing`. */
function lastPass(l: ProjectState, now: number): string {
  if (l.result === 'running') return `running for ${age(l.attemptedAt, now)}${l.pid ? ` (pid ${l.pid})` : ''}`;
  const exit = l.exitCode !== undefined ? ` (exit ${l.exitCode})` : '';
  const took = l.durationMs !== undefined ? `, took ${formatMs(l.durationMs)}` : '';
  return `${l.result}${exit} ${age(l.finishedAt ?? l.attemptedAt, now)} ago${took}${l.reason ? `: ${l.reason}` : ''}`;
}

async function scheduling(p: Paths, backend: Pick<ScheduleBackend, 'status' | 'logHint'>, ctx: ProjectContext, now: number) {
  const h = await schedulerHealth(p, backend, now);
  const m = h.manager;
  const ticks = summarize(tickEntries(h.history));
  const legacy = legacyTimers(p);
  const scheduler = { state: h.scheduling.state, ...(h.scheduling.reason ? { reason: h.scheduling.reason } : {}), phase: h.phase,
    enabled: m ? m.enabled : null, timer: m ? m.timer : 'unknown', tick: m ? m.tick : 'unknown', ...(m?.loaded !== undefined ? { loaded: m.loaded } : {}),
    lastTick: h.lastTick, ticks, problems: h.problems, legacyTimers: legacy, logHint: backend.logHint };
  const exists = existsSync(ctx.root);
  const blocker = scheduleBlocker(h.scheduling, ctx, exists, exists ? currentBranch(ctx.root) : null);
  const last = h.tickState.projects[ctx.root] ?? null;
  const passes = passEntries(h.history, ctx.root);
  const timings = summarize(passes);
  const recent = passes.slice(-RECENT).reverse();
  const opt = ctx.schedule;
  const sw = opt ? (opt.enabled ? 'on' : 'paused') : 'off';
  const schedule = { switch: sw, ...(opt ? { branch: opt.branch } : {}), blocker, last, timings, recent };

  const running = h.phase === 'running' ? `, a tick is running${h.tickState.startedAt && !h.tickState.finishedAt ? ` (for ${age(h.tickState.startedAt, now)})` : ''}`
    : h.phase === 'waiting' ? ', waiting for the next tick' : '';
  const text = { scheduler: [`Scheduler: ${h.scheduling.state}${h.scheduling.reason ? ` (${h.scheduling.reason})` : ''}${running}`], schedule: [] as string[] };
  if (h.lastTick) text.scheduler.push(`  Last tick: ${describeTick(h.lastTick, now)}`);
  if (ticks.count) text.scheduler.push(`  Tick timings: ${describeTimings(ticks, 'tick')}`);
  for (const x of h.problems) text.scheduler.push(`  Problem: ${x}`);
  for (const l of legacyAdvice(p)) text.scheduler.push(`  ${l}`);
  if (h.problems.length) text.scheduler.push(`  Tick log: ${backend.logHint}`);
  text.schedule.push(`Schedule: ${sw}${opt ? ` (${opt.branch})` : ''}, ${blocker ?? 'ready'}`);
  if (last) text.schedule.push(`  Last pass: ${lastPass(last, now)}`);
  if (timings.count) {
    text.schedule.push(`  Pass timings: ${describeTimings(timings, 'pass')}`, `  Recent passes, newest first:`);
    for (const x of recent) text.schedule.push(`    ${x.startedAt}  ${x.result.padEnd(11)} ${x.durationMs !== undefined ? formatMs(x.durationMs) : '-'}${x.exitCode !== undefined ? `  exit ${x.exitCode}` : ''}${x.reason ? `  ${x.reason}` : ''}`);
  }
  return { scheduler, schedule, text };
}
