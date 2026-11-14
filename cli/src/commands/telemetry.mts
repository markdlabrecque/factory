// Read-only local event export. No locks, reconciliation, directory creation, control observation or output file.
import { exportEvents, validTime } from '../../../board/execution-events.mts';
import type { Paths } from '../paths.mts';
import { resolveProject, runStateDir } from '../runs.mts';
export type TelemetryOptions = { project?: string; ticket?: string; since?: string; format?: string; cwd?: string };
export function telemetry(p: Paths, sub: string | undefined, o: TelemetryOptions = {}): number {
  if (sub !== 'export') throw Error('Usage: factory telemetry export [--project <name|path>] [--ticket <iid>] [--since <ISO-8601>] [--format json|jsonl]');
  if (o.format !== undefined && !['json','jsonl'].includes(o.format)) throw Error('--format must be json or jsonl');
  if (o.ticket !== undefined && (!o.project || !/^[1-9]\d*$/.test(o.ticket) || !Number.isSafeInteger(Number(o.ticket)))) throw Error('A positive --ticket requires --project');
  if (o.since !== undefined && !validTime(o.since)) throw Error('--since requires an ISO-8601 timestamp with timezone');
  const project = o.project ? resolveProject(p, o).tracker : undefined;
  const report = exportEvents(runStateDir(p), { project, ticket: o.ticket, since: o.since });
  if (o.format === 'json') console.log(JSON.stringify(report));
  else {
    const { events, ...metadata } = report;
    console.log(JSON.stringify({ type: 'metadata', ...metadata }));
    for (const event of events) console.log(JSON.stringify({ type: 'event', ...event }));
  }
  return report.diagnostics.length ? 1 : 0;
}
