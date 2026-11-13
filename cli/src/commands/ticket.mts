// `factory ticket comment <ticket> <text...> [--project <name|path>]` (slice 5, #99): save a manual comment on a board
// ticket in the shared ticket journal (board/journal.mts, `<state>/journal/`, in the run-state folder), then post it to
// the ticket's tracker. The local save always comes first and is kept whatever the post does, so a comment is never lost
// to a tracker outage. The event is tied to the ticket's current run (`runIdentity`) when it has a run record; a ticket
// with none can still be commented on.
// Posting takes the event with `beginDelivery` (one poster per event) and creates the comment through the project's own
// tracker CLI on the host (`gh api` for TRACKER.kind "github", `glab api` otherwise, with that CLI's own login; kind, host
// and project read from `.sandcastle/config.mts`). The body is the text followed by the event's hidden marker
// (`markerFor`), so a later sync (#100) can find a post whose outcome was lost. The outcome goes to `finishDelivery`:
// `delivered` with the tracker's comment id; `pending` when the post never started (no tracker CLI, unreadable config);
// `uncertain` when the CLI ran and failed or gave no comment id, since it may have posted (sync then searches for the
// marker before posting again). Exit 0 when posted, 1 when saved but not posted. Comments are never edited or deleted.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { addComment, beginDelivery, finishDelivery, markerFor, runIdentity } from '../../../board/journal.mts';
import type { JournalEvent, Ticket } from '../../../board/journal.mts';
import type { Paths } from '../paths.mts';
import { findRun, resolveProject, runStateDir, ticketId } from '../runs.mts';
import type { ProjectContext } from '../runs.mts';

/** Runs a tracker CLI; the shape of spawnSync's result that posting reads. Injected by tests. */
export type Exec = (cmd: string, args: string[]) => { status: number | null; stdout: string; stderr: string; error?: Error };
const realExec: Exec = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error } : {}) };
};
export type TicketOptions = { project?: string; cwd?: string; exec?: Exec; actor?: string };
type Post = { remoteId: string; url?: string } | { error: string; uncertain: boolean };

function actorName(): string {
  if (process.env.USER?.trim()) return process.env.USER.trim();
  try { return userInfo().username || 'unknown'; } catch { return 'unknown'; }
}

/** The tracker CLI call that creates a comment on `iid`, or why none can be made. Never posts. */
export function commentCall(ctx: ProjectContext, iid: string, body: string): { cmd: string; args: string[] } | string {
  let text: string;
  try { text = readFileSync(join(ctx.scaffold, 'config.mts'), 'utf8'); } catch { return `no readable ${ctx.scaffold}/config.mts`; }
  const kind = text.match(/^\s*kind:\s*"([^"]+)"/m)?.[1] ?? 'gitlab';
  const host = text.match(/^\s*(?:gitlabHost|host):\s*"([^"]+)"/m)?.[1] ?? (kind === 'github' ? 'github.com' : undefined);
  if (kind === 'github') {
    return { cmd: 'gh', args: ['api', '--hostname', host!, '-X', 'POST', `repos/${ctx.tracker}/issues/${iid}/comments`, '-f', `body=${body}`] };
  }
  if (!host) return `couldn't read TRACKER.gitlabHost from ${ctx.scaffold}/config.mts`;
  return { cmd: 'glab', args: ['api', '--hostname', host, '-X', 'POST', `projects/${encodeURIComponent(ctx.tracker)}/issues/${iid}/notes`, '-f', `body=${body}`] };
}

function post(ctx: ProjectContext, e: JournalEvent, exec: Exec): Post {
  const call = commentCall(ctx, e.iid, `${e.text}\n\n${markerFor(e.id)}`);
  if (typeof call === 'string') return { error: call, uncertain: false };
  const r = exec(call.cmd, call.args);
  // The CLI never started (not installed): nothing can have been posted.
  if (r.error) return { error: `${call.cmd} could not run: ${r.error.message}`, uncertain: false };
  const why = (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ');
  if (r.status !== 0) return { error: `${call.cmd} exited ${r.status}${why ? `: ${why}` : ''}`, uncertain: true };
  try {
    const c = JSON.parse(r.stdout);
    if (c?.id !== undefined && c.id !== null) return { remoteId: String(c.id), url: c.html_url ?? c.web_url };
  } catch { /* reported below */ }
  return { error: `${call.cmd} succeeded but returned no comment id`, uncertain: true };
}

/** `factory ticket comment`: save locally, then post. Returns the exit code (0 posted, 1 saved but not posted). */
export function ticketComment(p: Paths, ticket: string | undefined, words: string[], o: TicketOptions = {}): number {
  const iid = ticketId(ticket);
  const text = words.join(' ').trim();
  if (!text) throw new Error('Give the comment text: factory ticket comment <ticket> <text>');
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  const dir = runStateDir(p);
  const t: Ticket = { project: ctx.tracker, iid };
  const { run } = findRun(p, ctx, iid, dir);
  const e = addComment(dir, t, { text, actor: o.actor ?? actorName(), ...(run ? { run: runIdentity(run) } : {}) });
  console.log(`Saved the comment on #${iid} in ${ctx.name} (${e.id}).`);
  const start = beginDelivery(dir, t, e.id);
  if (!start.ok) {
    console.log(`Not posted: another process is delivering it (${start.reason}). It stays in the journal.`);
    return 1;
  }
  const r = post(ctx, e, o.exec ?? realExec);
  finishDelivery(dir, t, e.id, start.token, r);
  if ('remoteId' in r) {
    console.log(`Posted to ${ctx.tracker}#${iid}${r.url ? `: ${r.url}` : ` (comment ${r.remoteId})`}.`);
    return 0;
  }
  console.error(`Not posted to ${ctx.tracker}#${iid}: ${r.error}. The comment is kept in the journal`
    + (r.uncertain ? '; the post may have reached the tracker, so a later sync looks for its marker before posting again.' : ' and can be posted later.'));
  return 1;
}

/** `factory ticket <subcommand>`. Only `comment` exists so far. */
export function ticketCommand(p: Paths, sub: string | undefined, ticket: string | undefined, rest: string[], o: TicketOptions = {}): number {
  if (sub === 'comment') return ticketComment(p, ticket, rest, o);
  throw new Error(`Unknown ticket subcommand: ${sub ?? '(none)'}. Use: factory ticket comment <ticket> <text>`);
}
