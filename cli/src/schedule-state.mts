// The tick's observation record, `<state>/scheduler/state.json`: when the current or last tick started and ended,
// which project it is on and the dispatcher pass's pid, and each project's last attempt. It is data about what ran,
// never a switch: whether scheduling is on comes only from the service manager. The tick that holds the tick lock
// is the only writer, and writes are temp-file + rename. A missing file means no attempts. A malformed one throws
// and is left alone (fail closed, never an empty queue). A tick that died mid-pass leaves a `running` entry;
// markInterrupted() turns it into `interrupted` without inventing a finish time or duration.
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
export function writeTickState(p: Paths, s: TickState) {
  const file = `${p.schedulerState}/state.json`;
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(temp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, file); }
  catch (e) { rmSync(temp, { force: true }); throw e; }
}
/** Mark every unfinished entry interrupted, leaving finish time, duration and exit code unknown. True when anything changed. */
export function markInterrupted(p: Paths, reason: string): boolean {
  const s = readTickState(p);
  let changed = false;
  for (const x of Object.values(s.projects)) if (x.result === 'running') { x.result = 'interrupted'; x.reason = reason; changed = true; }
  if (s.currentRoot !== undefined || s.pid !== undefined) { delete s.currentRoot; delete s.pid; changed = true; }
  if (changed) writeTickState(p, s);
  return changed;
}
