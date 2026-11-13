// The scheduler strip's data (GET /api/timers): one entry per factory-tick timer the service manager reports, read-only.
// The macOS supervisor agent counts as that timer. State, in this order: not installed is "none"; a tick running now is
// "running"; a disabled, stopped or not-yet-running timer is "off"; otherwise "scheduled", with nextAt (epoch ms) when the
// manager or the supervisor knows it. A manager that can't be read is one "unknown" entry, never off. Legacy
// sandcastle-dispatch timers are never queried. Last-run times, tick history and pass timings are not read or returned.
// Each query has a timeout (scheduler.mts), so a stuck service manager reads as unknown instead of freezing the board.
import { paths } from "../cli/src/paths.mts";
import type { Paths } from "../cli/src/paths.mts";
import { scheduleBackend } from "../cli/src/platform/scheduler.mts";
import type { ScheduleBackend, TimerReport } from "../cli/src/platform/scheduler.mts";

export type TimerState = "running" | "scheduled" | "off" | "none" | "unknown";
export interface TimerEntry { id: string; name: string; state: TimerState; nextAt?: number; reason?: string }

const name = (id: string) => id.replace(/\.timer$/, "").replace(/^com\.factory\.tick$/, "factory-tick");

export function entryFor(report: TimerReport): TimerEntry {
  const { status, nextAt } = report;
  const base = { id: report.id, name: name(report.id) };
  if (status.timer === "missing") return { ...base, state: "none" };
  if (status.tick === "active") return { ...base, state: "running" };
  if (!status.enabled || status.timer !== "active") return { ...base, state: "off" };
  return { ...base, state: "scheduled", ...(nextAt ? { nextAt } : {}) };
}

export async function readTimers(
  p: Paths = paths(), backend: Pick<ScheduleBackend, "timers"> = scheduleBackend(p), now = Date.now(),
): Promise<{ timers: TimerEntry[]; generatedAt: string }> {
  let timers: TimerEntry[];
  try {
    timers = (await backend.timers()).map(entryFor);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200);
    timers = [{ id: "factory-tick.timer", name: "factory-tick", state: "unknown", reason }];
  }
  return { timers, generatedAt: new Date(now).toISOString() };
}
