// The tick's observation record, `<state>/scheduler/state.json`: when the current or last tick started and ended,
// which project it is on and the dispatcher pass's pid, and each project's last attempt. It is data about what ran,
// never a switch: whether scheduling is on comes only from the service manager. The tick that holds the tick lock
// is the only writer, and writes are temp-file + rename. A missing file means no attempts. A malformed one throws
// and is left alone (fail closed, never an empty queue). A tick that died mid-pass leaves a `running` entry;
// markInterrupted() turns it into `interrupted` without inventing a finish time or duration.
// Timing history, `<state>/scheduler/history.json` (#36): `{version:1, entries:[...]}`, oldest first, at most
// HISTORY_LIMIT entries (the oldest are dropped). One `tick` entry per tick that took the lock and one `pass` entry per
// dispatcher pass, each with start, end and monotonic duration when known, result and reason; an interrupted or dead
// tick or pass is recorded `interrupted` without an invented finish. Skipped projects and ticks that never took the lock
// are not history. It is observation only: no timeout reads it. Appends are best effort; a malformed file is reported,
// left alone and not appended to, and never stops a tick or a cancellation.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Paths } from './paths.mts';
export type ProjectResult = 'running' | 'ok' | 'skipped' | 'error' | 'interrupted';
export type ProjectState = { attemptedAt: string; finishedAt?: string; durationMs?: number; pid?: number; result: ProjectResult; reason?: string; exitCode?: number };
export type TickState = { version: 1; nextRoot?: string; startedAt?: string; finishedAt?: string; durationMs?: number; pid?: number; currentRoot?: string; projects: Record<string, ProjectState> };
const RESULTS = ['running', 'ok', 'skipped', 'error', 'interrupted'];
const isTime = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const isMs = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isPid = (x: unknown) => Number.isInteger(x) && (x as number) > 0;

export const HISTORY_LIMIT = 1000;
export type TickHistory = { kind: 'tick'; startedAt: string; finishedAt?: string; durationMs?: number; pid?: number;
  result: 'done' | 'failed' | 'interrupted' | 'off' | 'unknown'; reason?: string };
export type PassHistory = { kind: 'pass'; tick?: string; root: string; name?: string; startedAt: string; finishedAt?: string; durationMs?: number;
  pid?: number; result: 'ok' | 'error' | 'interrupted'; exitCode?: number; reason?: string };
export type HistoryEntry = TickHistory | PassHistory;
const TICK_RESULTS = ['done', 'failed', 'interrupted', 'off', 'unknown'];
const PASS_RESULTS = ['ok', 'error', 'interrupted'];
const historyFile = (p: Paths) => `${p.schedulerState}/history.json`;

export const emptyTickState = (): TickState => ({ version: 1, projects: {} });
export function readTickState(p: Paths): TickState {
  const file = `${p.schedulerState}/state.json`;
  if (!existsSync(file)) return emptyTickState();
  let d: any;
  try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error(`Scheduler state is not valid JSON: ${file}. Fix or remove it; Factory will not overwrite it.`); }
  const ok = d?.version === 1 && d.projects && typeof d.projects === 'object' && !Array.isArray(d.projects)
    && (d.startedAt === undefined || isTime(d.startedAt)) && (d.finishedAt === undefined || isTime(d.finishedAt))
    && (d.durationMs === undefined || isMs(d.durationMs)) && (d.pid === undefined || isPid(d.pid))
    && (d.currentRoot === undefined || typeof d.currentRoot === 'string') && (d.nextRoot === undefined || typeof d.nextRoot === 'string')
    && Object.values<any>(d.projects).every(x => isTime(x?.attemptedAt) && RESULTS.includes(x.result)
      && (x.finishedAt === undefined || isTime(x.finishedAt)) && (x.durationMs === undefined || isMs(x.durationMs))
      && (x.pid === undefined || isPid(x.pid)) && (x.reason === undefined || typeof x.reason === 'string')
      && (x.exitCode === undefined || Number.isInteger(x.exitCode)));
  if (!ok) throw new Error(`Unsupported scheduler state: ${file}. Fix or remove it; Factory will not overwrite it.`);
  return d;
}
function writeJson(file: string, s: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(temp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, file); }
  catch (e) { rmSync(temp, { force: true }); throw e; }
}
export const writeTickState = (p: Paths, s: TickState) => writeJson(`${p.schedulerState}/state.json`, s);

/** The timing history, oldest first. Missing is empty; malformed throws. */
export function readHistory(p: Paths): HistoryEntry[] {
  const file = historyFile(p);
  if (!existsSync(file)) return [];
  let d: any;
  try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error(`Scheduler history is not valid JSON: ${file}. Fix or remove it; Factory will not overwrite it.`); }
  const common = (x: any) => isTime(x.startedAt) && (x.finishedAt === undefined || isTime(x.finishedAt)) && (x.durationMs === undefined || isMs(x.durationMs))
    && (x.pid === undefined || isPid(x.pid)) && (x.reason === undefined || typeof x.reason === 'string');
  const ok = d?.version === 1 && Array.isArray(d.entries) && d.entries.every((x: any) => x && typeof x === 'object' && common(x) && (
    x.kind === 'tick' ? TICK_RESULTS.includes(x.result)
    : x.kind === 'pass' && PASS_RESULTS.includes(x.result) && typeof x.root === 'string' && (x.name === undefined || typeof x.name === 'string')
      && (x.tick === undefined || isTime(x.tick)) && (x.exitCode === undefined || Number.isInteger(x.exitCode))));
  if (!ok) throw new Error(`Unsupported scheduler history: ${file}. Fix or remove it; Factory will not overwrite it.`);
  return d.entries;
}
/** Appends to the timing history, keeping the newest `limit` entries. Throws, writing nothing, when the file is malformed. */
export function appendHistory(p: Paths, entries: HistoryEntry[], limit = HISTORY_LIMIT) {
  if (!entries.length) return;
  writeJson(historyFile(p), { version: 1, entries: readHistory(p).concat(entries).slice(-limit) });
}
/** Mark every unfinished entry interrupted, leaving finish time, duration and exit code unknown, and add them to the
 *  history (a tick that never recorded its end, and each pass still `running`). True when anything changed.
 *  A history that can't be appended to is passed to `onHistoryError`; the state file is still fixed. */
export function markInterrupted(p: Paths, reason: string, onHistoryError?: (e: Error) => void): boolean {
  const s = readTickState(p);
  let changed = false;
  const history: HistoryEntry[] = [];
  for (const [root, x] of Object.entries(s.projects)) if (x.result === 'running') {
    x.result = 'interrupted'; x.reason = reason; changed = true;
    history.push({ kind: 'pass', ...(s.startedAt ? { tick: s.startedAt } : {}), root, startedAt: x.attemptedAt, ...(x.pid ? { pid: x.pid } : {}), result: 'interrupted', reason });
  }
  if (s.pid !== undefined && s.startedAt && !s.finishedAt) history.push({ kind: 'tick', startedAt: s.startedAt, pid: s.pid, result: 'interrupted', reason });
  if (s.currentRoot !== undefined || s.pid !== undefined) { delete s.currentRoot; delete s.pid; changed = true; }
  if (changed) writeTickState(p, s);
  try { appendHistory(p, history); } catch (e) { onHistoryError?.(e as Error); }
  return changed;
}
