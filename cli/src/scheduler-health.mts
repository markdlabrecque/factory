// Scheduler health and timings for `factory status` and `factory schedule status` (#37). Read-only: it asks the service
// manager once and reads state.json, history.json and schedule.json, and never writes, signals or decides anything.
// - Health: whether scheduled work may run (schedulingFrom, the same rule the tick uses: the timer, or the macOS agent,
//   enabled and active; a failed query is unknown, never on), the phase (running, waiting, off, unknown) and a list of
//   problems: an unreadable manager, an enabled job that is not running, a running job that is disabled, an unreadable
//   state, history or launch configuration file, and a tick that is overdue (scheduling on, no tick running, and nothing
//   started or finished for two intervals). A malformed file is reported here instead of failing the command, and is
//   left alone.
// - Timings: summaries of the bounded timing history (schedule-state.mts): how many ticks or passes, how many have a
//   duration, the last, median, 90th percentile (nearest rank) and longest duration, and a count per result. Interrupted
//   entries have no duration and are only counted. This is for a person choosing a future timeout; nothing reads it as one.
import type { Paths } from './paths.mts';
import type { ScheduleBackend, ScheduleStatus } from './platform/scheduler.mts';
import { readScheduleConfig } from './schedule.mts';
import type { Scheduling } from './schedule.mts';
import { emptyTickState, readHistory, readTickState } from './schedule-state.mts';
import type { HistoryEntry, PassHistory, TickHistory, TickState } from './schedule-state.mts';
import { schedulingFrom } from './commands/tick.mts';

/** Ticks come this long after the previous one finished (the timer's OnUnitInactiveSec, the supervisor's wait). */
export const INTERVAL_MS = 5 * 60_000;
export type Phase = 'running' | 'waiting' | 'off' | 'unknown';
export type Health = {
  scheduling: Scheduling; manager: ScheduleStatus | null; unknown?: string; phase: Phase;
  tickState: TickState; history: HistoryEntry[]; lastTick: TickHistory | null; problems: string[];
};
export type TimingSummary = { count: number; timed: number; lastMs?: number; medianMs?: number; p90Ms?: number; maxMs?: number; results: Record<string, number> };

const first = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/** `850ms`, `45s`, `4m12s`, `1h03m`. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
}

/** Durations and result counts of history entries, oldest first. */
export function summarize(entries: Array<{ durationMs?: number; result: string }>): TimingSummary {
  const results: Record<string, number> = {};
  for (const x of entries) results[x.result] = (results[x.result] ?? 0) + 1;
  const timed = entries.filter(x => x.durationMs !== undefined).map(x => x.durationMs!);
  const sorted = [...timed].sort((a, b) => a - b);
  const rank = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
  return { count: entries.length, timed: timed.length, results,
    ...(timed.length ? { lastMs: timed[timed.length - 1], medianMs: rank(0.5), p90Ms: rank(0.9), maxMs: sorted[sorted.length - 1] } : {}) };
}
/** `12 passes, 10 timed: last 2m03s, median 3m00s, p90 5m10s, max 9m00s; 10 ok, 1 error, 1 interrupted` */
export function describeTimings(t: TimingSummary, noun: 'tick' | 'pass'): string {
  const counts = Object.entries(t.results).map(([r, n]) => `${n} ${r}`).join(', ');
  const times = t.timed ? `: last ${formatMs(t.lastMs!)}, median ${formatMs(t.medianMs!)}, p90 ${formatMs(t.p90Ms!)}, max ${formatMs(t.maxMs!)}` : '';
  return `${t.count} ${noun}${t.count === 1 ? '' : noun === 'pass' ? 'es' : 's'}, ${t.timed} timed${times}; ${counts}`;
}

export const tickEntries = (h: HistoryEntry[]) => h.filter((x): x is TickHistory => x.kind === 'tick');
export const passEntries = (h: HistoryEntry[], root: string) => h.filter((x): x is PassHistory => x.kind === 'pass' && x.root === root);

/** `45s`, `12m`, `3h`, `2d` since an ISO time; empty when unknown. */
export function age(since: string | undefined, now: number): string {
  const ms = since ? now - Date.parse(since) : NaN;
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

/** One service-manager query plus the local observation files. Never throws for a malformed file or failed query. */
export async function schedulerHealth(p: Paths, backend: Pick<ScheduleBackend, 'status'>, now = Date.now()): Promise<Health> {
  const problems: string[] = [];
  let manager: ScheduleStatus | null = null;
  let unknown: string | undefined;
  try { manager = await backend.status(); } catch (e) { unknown = first(e); }
  const scheduling: Scheduling = manager ? schedulingFrom(manager) : { state: 'unknown', reason: `service manager query failed: ${unknown}` };
  const job = manager?.loaded !== undefined ? 'supervisor agent' : 'timer';
  if (!manager) problems.push(`the service manager can't be read (${unknown}), so scheduled work is blocked`);
  else if (manager.enabled && manager.timer !== 'active') problems.push(`the ${job} is enabled but not running. Run: factory schedule on`);
  else if (!manager.enabled && manager.timer === 'active') problems.push(`the ${job} is running but not enabled, so ticks skip every project. Run: factory schedule off (or on)`);
  let tickState = emptyTickState();
  try { tickState = readTickState(p); } catch (e) { problems.push(first(e)); }
  let history: HistoryEntry[] = [];
  try { history = readHistory(p); } catch (e) { problems.push(first(e)); }
  try { if (!readScheduleConfig(p) && manager && manager.timer !== 'missing') problems.push('no launch configuration, so ticks stop with an error. Run: factory schedule on'); }
  catch (e) { problems.push(first(e)); }
  const tickRunning = manager?.tick === 'active';
  const latest = Math.max(...[tickState.startedAt, tickState.finishedAt].map(x => (x ? Date.parse(x) : NaN)).filter(Number.isFinite));
  if (scheduling.state === 'on' && !tickRunning && Number.isFinite(latest) && now - latest > 2 * INTERVAL_MS)
    problems.push(`no tick has started or finished for ${age(new Date(latest).toISOString(), now)}; one should come ${INTERVAL_MS / 60_000} minutes after the last. Check the tick log`);
  const phase: Phase = !manager ? 'unknown' : tickRunning ? 'running' : scheduling.state === 'on' ? 'waiting' : 'off';
  const ticks = tickEntries(history);
  return { scheduling, manager, ...(unknown ? { unknown } : {}), phase, tickState, history, lastTick: ticks[ticks.length - 1] ?? null, problems };
}

/** `done 3m ago, took 4m12s`, from the newest tick in the history. */
export function describeTick(t: TickHistory, now: number): string {
  const when = t.finishedAt ? ` ${age(t.finishedAt, now)} ago` : ` (started ${age(t.startedAt, now)} ago)`;
  return `${t.result}${when}${t.durationMs !== undefined ? `, took ${formatMs(t.durationMs)}` : ''}${t.reason ? `: ${t.reason}` : ''}`;
}
