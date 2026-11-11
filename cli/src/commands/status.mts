// `factory status [--json] [--project <name>]`: the board service's state and URL, then every run of the project
// picked by runs.mts with its stage, how long it has been there, title, branch, verdict, PR and note. A run whose
// process is gone without finishing shows as stopped (read-only; its record is left alone). `--json` prints the same
// data as `{version:1, project, board, runs}`. Shows no timers (slice four) and only one project.
import { boardURL } from '../paths.mts';
import type { Paths } from '../paths.mts';
import type { ServiceBackend } from '../platform/index.mts';
import { projectRuns, resolveProject } from '../runs.mts';
import type { Run } from '../runs.mts';
export type StatusOptions = { project?: string; cwd?: string; json?: boolean; now?: number };

/** `45s`, `12m`, `3h`, `2d` since an ISO time; empty when unknown. */
function age(since: string | undefined, now: number): string {
  const ms = since ? now - Date.parse(since) : NaN;
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

function line(r: Run, now: number): string {
  const extra = [r.title, r.branch && `[${r.branch}]`, r.verdict && `verdict ${r.verdict}`, r.mr, r.note && `- ${r.note}`].filter(Boolean).join('  ');
  return `#${r.iid.padEnd(5)} ${r.stage.padEnd(12)} ${age(r.stageSince, now).padStart(4)}  ${extra}`.trimEnd();
}

export async function status(p: Paths, service: Pick<ServiceBackend, 'status'>, o: StatusOptions = {}): Promise<void> {
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  let state: string;
  try { state = await service.status(); } catch (e) { state = `unknown (${e instanceof Error ? e.message.split('\n')[0] : e})`; }
  const runs = projectRuns(p, ctx);
  if (o.json) {
    console.log(JSON.stringify({ version: 1, project: { name: ctx.name, root: ctx.root, tracker: ctx.tracker }, board: { service: state, url: boardURL }, runs }, null, 2));
    return;
  }
  const now = o.now ?? Date.now();
  console.log(`Board: ${state}  ${boardURL}`);
  console.log(`Project: ${ctx.name} (${ctx.tracker})  ${ctx.root}`);
  if (!runs.length) console.log('No runs yet.');
  else for (const r of runs) console.log(line(r, now));
}
