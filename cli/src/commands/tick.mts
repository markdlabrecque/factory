// One scheduler tick: the internal command `factory tick`, run by factory-tick.service (not for people to type; it takes
// no flags). It visits the registered projects one after another, in registry order rotated so that a different project
// goes first each tick (rotation(), with state.json's `nextRoot`), and runs one dispatcher pass, the project's own `.sandcastle/dispatch.sh` through runDispatchSh, for each project that
// scheduleBlocker() clears. Each pass runs as `dispatch.sh --max 3` with FACTORY_SCHEDULED=1, the saved PATH, and
// SANDCASTLE_STATE_DIR set to Factory's state folder whatever the caller had set. The dispatcher itself enforces the
// three-slot cap across projects, counting launches not yet on the board (#32). Stdin is inherited: the service has
// none, and a tick started by hand from a terminal keeps the dispatcher's interactive behaviour.
// Global state comes from the service manager only. Before taking the lock, after taking it, and before every
// project, the tick asks the manager: work needs the timer enabled and active. A timer that is off ends the tick, and an
// unreadable manager ends it too (unknown fails closed), exit 1. Missing or malformed launch configuration, registry or
// tick state also ends it without guessing. There is no pass timeout.
// One tick per user (tick-lock.mts). The pass is spawned as the leader of its own process group and recorded in the lock
// the moment it exists, so cancelling can reach its nested children (npx, ticket analysis) and nothing else; ticket
// runs the dispatcher detached are in their own groups and keep going. SIGTERM or SIGINT (what `systemctl stop` sends
// the tick) cancels: the pass group gets SIGTERM, then SIGKILL after the grace period (tick-cancel.mts), no later
// project starts, the pass is recorded `interrupted`, and the tick exits 143. If the group can't be confirmed gone the
// lock stays, so no second pass starts over it, and the tick exits 1.
// A pass whose leader exits while non-detached members of its group are still running (a backgrounded job, a child
// orphaned when the dispatcher died) has that group, and only that group, terminated the same way (SIGTERM, grace,
// SIGKILL). The tick logs it, and the project's state.json reason says `left processes running in its process group,
// terminated` (with `with SIGKILL` when needed). The pass record in the lock is dropped only once the group is empty.
// This is cleanup after the pass ended, never a timeout on a pass that is running. If the group can't be confirmed gone,
// the lock keeps the record, no pass starts over it, the tick exits 1, and state.json keeps what the leader did: `ok`
// or `error` by its exit code, with exit code, finish time and duration, and a reason naming the unconfirmed group
// (`interrupted` is reserved for a cancellation that was requested).
// Rotation: the tick starts at the first opted-in, unpaused project at or after `nextRoot` in registry order (the top of
// the registry when `nextRoot` is unset or no longer registered), and before any pass saves `nextRoot` as the next
// opted-in, unpaused project after it. Only those projects take turns, so one not opted in never hands an extra turn to
// its neighbour. The turn advances even if the tick is cancelled, fails or dies mid-pass, so a project whose pass keeps
// failing cannot hold the front. Every project is still visited in order after the first, and gated individually.
// Observations go to `<state>/scheduler/state.json` (schedule-state.mts): a `running` entry with the pass pid is saved
// before the pass can do anything, and the result, finish time and monotonic duration after it. Bounded timing history
// is #36. Output goes to stdout (the journal). Exit codes: 0 done, 1 a project failed or state unknown, 143 cancelled.
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { Paths } from '../paths.mts';
import { readRegistry } from '../projects.mts';
import type { Project } from '../projects.mts';
import { resolveProject } from '../runs.mts';
import { copyProblem, currentBranch, readScheduleConfig, scheduleBlocker } from '../schedule.mts';
import type { ScheduleConfig, Scheduling } from '../schedule.mts';
import { markInterrupted, readTickState, writeTickState } from '../schedule-state.mts';
import type { ProjectState, TickState } from '../schedule-state.mts';
import { acquireTickLock, passAlive } from '../tick-lock.mts';
import type { HeldLock } from '../tick-lock.mts';
import { terminateGroup } from '../tick-cancel.mts';
import type { CancelOptions } from '../tick-cancel.mts';
import type { ScheduleBackend } from '../platform/scheduler.mts';
import { runDispatchSh } from './dispatch.mts';
import type { ProjectContext } from '../runs.mts';
import type { SpawnOptions } from './dispatch.mts';
/** Runs one pass for a project; resolves to dispatch.sh's exit code. The default is runDispatchSh. */
export type Pass = (ctx: ProjectContext, args: string[], o: Required<Pick<SpawnOptions, 'env' | 'onSpawn'>> & { group: true }) => Promise<number>;
export type TickOptions = {
  backend: ScheduleBackend; pass?: Pass; log?: (line: string) => void; signal?: AbortSignal; cancel?: CancelOptions;
  /** Wall clock (UTC timestamps) and monotonic clock (durations). */
  now?: () => Date; mono?: () => number;
};
export type TickResult = {
  result: 'done' | 'busy' | 'off' | 'unknown' | 'interrupted' | 'failed';
  passes: string[]; skipped: Record<string, string>; errors: Record<string, string>;
  /** Set when a cancellation could not be confirmed: the pass group that is still alive. */
  unconfirmed?: number;
};
export const SCHEDULED_ARGS = ['--max', '3'];
/** The exit code for a tick result. */
export const tickExitCode = (r: TickResult) => r.result === 'interrupted' ? 143 : r.result === 'failed' || r.result === 'unknown' ? 1 : 0;

/** Asks the service manager whether scheduled work may run. Needs the timer enabled and active; a failed query is unknown. */
export async function schedulingState(backend: ScheduleBackend): Promise<Scheduling> {
  let s;
  try { s = await backend.status(); }
  catch (e) { return { state: 'unknown', reason: `service manager query failed: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}` }; }
  if (s.timer === 'missing') return { state: 'off', reason: 'timer not installed' };
  if (!s.enabled) return { state: 'off', reason: s.timer === 'active' ? 'timer is running but disabled' : 'timer disabled' };
  if (s.timer !== 'active') return { state: 'off', reason: 'timer enabled but not running' };
  return { state: 'on' };
}

/** The environment a scheduled pass gets: the caller's, with the saved PATH, shared state and the scheduled marker. */
export function scheduledEnv(p: Paths, config: ScheduleConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, PATH: config.path, SANDCASTLE_STATE_DIR: p.state, FACTORY_SCHEDULED: '1' };
}

const takesTurns = (x: Project) => !!x.schedule?.enabled;
/** The registry rotated to start at this tick's first project, and the project that goes first next tick. */
export function rotation(projects: Project[], nextRoot: string | undefined): { order: Project[]; nextRoot?: string } {
  const n = projects.length;
  const from = Math.max(0, projects.findIndex(x => x.root === nextRoot));
  const at = (i: number) => projects[(from + i) % n];
  const firstAt = Array.from({ length: n }, (_, i) => i).find(i => takesTurns(at(i)));
  if (firstAt === undefined) return { order: projects.slice(from).concat(projects.slice(0, from)) };
  const order = Array.from({ length: n }, (_, i) => at(firstAt + i));
  return { order, nextRoot: (order.slice(1).find(takesTurns) ?? order[0]).root };
}

export async function tick(p: Paths, o: TickOptions): Promise<TickResult> {
  const log = o.log ?? (line => console.log(line));
  const wall = o.now ?? (() => new Date());
  const mono = o.mono ?? (() => performance.now());
  const signal = o.signal ?? new AbortController().signal;
  const out: TickResult = { result: 'done', passes: [], skipped: {}, errors: {} };
  const secs = (from: number) => `${Math.round((mono() - from) / 1000)}s`;
  const stop = (result: TickResult['result'], line: string): TickResult => { log(line); return { ...out, result }; };
  const gate = async (): Promise<TickResult | null> => {
    const s = await schedulingState(o.backend);
    if (s.state === 'off') return stop('off', `tick skipped: scheduler is off (${s.reason})`);
    if (s.state === 'unknown') return stop('unknown', `tick skipped: scheduler state unknown (${s.reason})`);
    return null;
  };
  const early = await gate();
  if (early) return early;
  const lock = acquireTickLock(p);
  if ('busy' in lock) return stop('busy', `tick skipped: ${lock.busy}`);
  let keepLock = false;
  const startedMono = mono();
  try {
    const again = await gate();
    if (again) return again;
    const config = readScheduleConfig(p);
    if (!config) throw new Error(`No launch configuration (${p.scheduleConfig}). Run factory schedule on.`);
    // We hold the lock, so no tick is running: anything still marked running is left over from one that died.
    if (markInterrupted(p, 'the tick that started it ended without finishing')) log('recovered state from an interrupted tick');
    const state: TickState = readTickState(p);
    state.startedAt = wall().toISOString();
    delete state.finishedAt; delete state.durationMs;
    state.pid = process.pid;
    const turn = rotation(readRegistry(p).projects, state.nextRoot);
    if (turn.nextRoot) state.nextRoot = turn.nextRoot; else delete state.nextRoot;
    writeTickState(p, state);
    log(`tick start${turn.order.length && turn.nextRoot ? `: ${turn.order[0].name} first` : ''}`);
    let cancelled = false;
    for (const { root } of turn.order) {
      if (signal.aborted) { cancelled = true; break; }
      const stopNow = await gate();
      if (stopNow) { out.result = stopNow.result; break; }
      if (signal.aborted) { cancelled = true; break; }
      // Read again for each project: an opt-out or removal during the tick applies from here on.
      const project = readRegistry(p).projects.find(x => x.root === root);
      if (!project) continue;
      const attempt = wall().toISOString();
      const record = (s: ProjectState) => { state.projects[root] = s; writeTickState(p, state); };
      const skip = (reason: string) => { log(`skip ${project.name}: ${reason}`); out.skipped[project.name] = reason; record({ attemptedAt: attempt, result: 'skipped', reason }); };
      const exists = existsSync(root);
      const reason = scheduleBlocker({ state: 'on' }, project, exists, exists ? currentBranch(root) : null) ?? (exists ? copyProblem(root) : null);
      if (reason) { skip(reason); continue; }
      let ctx: ProjectContext;
      try { ctx = resolveProject(p, { project: root }); } catch (e) { skip((e as Error).message); continue; }
      log(`pass ${project.name} (${project.schedule!.branch}): start`);
      const from = mono();
      state.currentRoot = root;
      record({ attemptedAt: attempt, result: 'running' });
      const result = await runPass(p, o, lock, ctx, project, root, config, state, signal, log);
      const entry = state.projects[root];
      entry.finishedAt = wall().toISOString();
      entry.durationMs = Math.max(0, Math.round(mono() - from));
      delete state.currentRoot;
      if (result.unconfirmed !== undefined) {
        // The lock stays so no pass starts over a live group. What the leader did is still recorded as observed: an exit
        // code gives ok or error with its finish and duration; `interrupted` is only for a cancellation that was requested.
        const alive = `process group ${result.unconfirmed} is still running`;
        if (result.code === undefined) { delete entry.finishedAt; delete entry.durationMs; }
        else entry.exitCode = result.code;
        if (result.cancelled) { entry.result = 'interrupted'; entry.reason = `cancellation unconfirmed: ${alive}`; }
        else {
          entry.result = result.code === 0 ? 'ok' : 'error';
          entry.reason = `${result.code !== 0 ? `exit ${result.code}; ` : ''}termination of leftover processes unconfirmed: ${alive}`;
          out.errors[project.name] = entry.reason;
        }
        writeTickState(p, state);
        keepLock = true; out.unconfirmed = result.unconfirmed;
        log(`pass ${project.name}: termination unconfirmed, ${alive}; scheduler lock kept`);
        return { ...out, result: 'failed' };
      }
      if (result.cancelled) { entry.result = 'interrupted'; entry.reason = 'cancelled'; }
      else if (result.error) { entry.result = 'error'; entry.reason = result.error; out.errors[project.name] = result.error; }
      else {
        entry.result = result.code === 0 ? 'ok' : 'error';
        const reasons: string[] = [];
        if (result.code !== 0) { reasons.push(`exit ${result.code}`); out.errors[project.name] = `exit ${result.code}`; }
        if (result.leftover) reasons.push(`left processes running in its process group, terminated${result.leftover.escalated ? ' with SIGKILL' : ''}`);
        if (reasons.length) entry.reason = reasons.join('; ');
      }
      if (result.code !== undefined) entry.exitCode = result.code;
      writeTickState(p, state);
      lock.clearPass();
      out.passes.push(project.name);
      log(`pass ${project.name}: ${result.error ? `failed: ${result.error}` : `exit ${result.code}`} after ${secs(from)}${result.cancelled ? ' (cancelled)' : ''}${result.leftover ? ' (leftover processes terminated)' : ''}`);
      if (result.cancelled) cancelled = true;
    }
    state.finishedAt = wall().toISOString();
    state.durationMs = Math.max(0, Math.round(mono() - startedMono));
    delete state.pid; delete state.currentRoot;
    writeTickState(p, state);
    if (cancelled || signal.aborted) return stop('interrupted', `tick interrupted after ${secs(startedMono)}`);
    if (out.result !== 'done') return stop(out.result, `tick stopped after ${secs(startedMono)}: scheduler is no longer on`);
    if (Object.keys(out.errors).length) out.result = 'failed';
    log(`tick end: ${out.passes.length} passes, ${Object.keys(out.skipped).length} skipped, ${Object.keys(out.errors).length} failed, ${secs(startedMono)}`);
    return out;
  } finally { if (!keepLock) lock.release(); }
}

type PassOutcome = { code?: number; error?: string; unconfirmed?: number; cancelled?: boolean; leftover?: { escalated: boolean } };
/** Runs one pass and cancels it if `signal` aborts. The pass group is recorded in the lock and the state file at spawn. */
async function runPass(p: Paths, o: TickOptions, lock: HeldLock, ctx: ProjectContext, project: Project, root: string, config: ScheduleConfig,
  state: TickState, signal: AbortSignal, log: (line: string) => void): Promise<PassOutcome> {
  const pass: Pass = o.pass ?? ((c, args, spawnOptions) => runDispatchSh(p, c, args, spawnOptions));
  let pid: number | undefined;
  let cancelling: Promise<{ confirmed: boolean }> | undefined;
  let leftoverTerm: Promise<{ confirmed: boolean; escalated: boolean }> | undefined;
  const cancel = () => {
    if (pid === undefined || cancelling || leftoverTerm) return;
    log(`pass ${project.name}: cancelling process group ${pid}`);
    cancelling = terminateGroup(pid, o.cancel);
  };
  const onSpawn = (spawned: number) => {
    pid = spawned;
    lock.recordPass(root, spawned);
    state.projects[root].pid = spawned;
    writeTickState(p, state);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const done = pass(ctx, SCHEDULED_ARGS, { env: scheduledEnv(p, config), onSpawn, group: true });
    if (signal.aborted) cancel();
    const code = await done;
    if (cancelling) return (await cancelling).confirmed ? { code, cancelled: true } : { code, unconfirmed: pid, cancelled: true };
    // The leader has exited. Members still in its group are this pass's own orphans (a backgrounded job, or a child left
    // when the dispatcher died mid-analysis); ticket runs are detached into their own groups and are not in it. Keeping
    // them recorded would block every later tick behind a process nobody watches, so they get the cancellation sequence
    // (SIGTERM, grace, SIGKILL, that group only). This is cleanup after the pass ended, not a pass timeout.
    if (pid !== undefined && lock.info.pass && passAlive(lock.info.pass)) {
      log(`pass ${project.name}: exited but left processes running in its process group ${pid}; terminating that group only`);
      leftoverTerm = terminateGroup(pid, o.cancel);
      const r = await leftoverTerm;
      return r.confirmed ? { code, leftover: { escalated: r.escalated } } : { code, unconfirmed: pid };
    }
    return { code };
  } catch (e) {
    if (cancelling && !(await cancelling).confirmed) return { unconfirmed: pid, cancelled: true };
    return { error: (e as Error).message, cancelled: !!cancelling };
  } finally { signal.removeEventListener('abort', cancel); }
}
