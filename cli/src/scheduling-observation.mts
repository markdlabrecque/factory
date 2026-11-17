// Shared read-only service-manager observation. Explicit diagnosis and scheduled dispatch use identical global controls.
import type { ScheduleBackend, ScheduleStatus } from './platform/scheduler.mts';
import type { Scheduling } from './schedule.mts';
/** Asks the service manager whether scheduled work may run. A failed query is unknown, never permission. */
export async function schedulingState(backend: Pick<ScheduleBackend, 'status'>): Promise<Scheduling> {
  let s;
  try { s = await backend.status(); }
  catch (e) { return { state: 'unknown', reason: `service manager query failed: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}` }; }
  return schedulingFrom(s);
}
export function schedulingFrom(s: ScheduleStatus): Scheduling {
  if (s.timer === 'missing') return { state: 'off', reason: 'timer not installed' };
  if (!s.enabled) return { state: 'off', reason: s.timer === 'active' ? 'timer is running but disabled' : 'timer disabled' };
  if (s.timer !== 'active') return { state: 'off', reason: 'timer enabled but not running' };
  return { state: 'on' };
}
