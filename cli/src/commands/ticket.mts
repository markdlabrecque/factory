// #137: validated TOML metadata is authoritative for tracker kind/host/project before journal writes.
// `factory ticket comment <ticket> <text...> [--project <name|path>]` (slice 5, #99): save a manual comment on a board
// ticket in the shared ticket journal (board/journal.mts, `<state>/journal/`, in the run-state folder), then post it to
// the ticket's tracker. The local save always comes first and is kept whatever the post does, so a comment is never lost
// to a tracker outage. The event is tied to the ticket's current run (`runIdentity`) when it has a run record; a ticket
// with none can still be commented on.
// Posting takes the event with `beginDelivery` (one poster per event) and creates the comment through the project's own
// tracker CLI on the host (`gh api` for TRACKER.kind "github", `glab api` otherwise, with that CLI's own login; kind, host
// and project read from `.sandcastle/config.mts`). The body is the text followed by the event's hidden marker
// (`markerFor`), so `ticket sync` can find a post whose outcome was lost. The outcome goes to `finishDelivery`:
// `delivered` with the tracker's comment id; `pending` when the post never started (no tracker CLI, unreadable config);
// `uncertain` when the CLI ran and failed or gave no comment id, since it may have posted (sync then searches for the
// marker before posting again). Exit 0 when posted, 1 when saved but not posted. Comments are never edited or deleted.
// `factory ticket sync [ticket] [--project <name|path>]` (#100): deliver every comment and verdict correction the
// project's journals (or one ticket's) still hold undelivered, through the same `deliver` path. Duplicate protection:
// an event whose earlier attempt may have posted (`check` from `beginDelivery`: uncertain, or its poster died while
// posting) is first searched for by its marker in the ticket's full comment list (`gh api --paginate` / `glab api
// --paginate`, read-only); a match is recorded as delivered with that comment's id and nothing is posted, and a search
// that cannot complete posts nothing and leaves the event uncertain. Pending events (nothing can have posted) are posted
// directly. Another project's journal, a delivered event and one a live process is posting are left alone. A verdict
// correction posts as "Verdict corrected from X to Y." with its explanation and marker (`bodyFor`). Exit 0 when nothing
// is left undelivered, else 1.
// Verdict changes create one deliverable correction event with the prior/new verdict and run reference.
// archive/restore validate under admission through board/tickets.mts; archived/show read journal projections,
// including original/effective verdicts, full event history and outstanding tracker delivery. No run is rewritten.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { keyFor } from '../../../board/admission.mts';
import { addComment, beginDelivery, correctVerdict, finishDelivery, journalDir, markerFor, normalizeVerdict, projectTicket, readJournal, runIdentity } from '../../../board/journal.mts';
import type { JournalEvent, Ticket } from '../../../board/journal.mts';
import { archiveTicket } from '../../../board/tickets.mts';
import type { Paths } from '../paths.mts';
import { findRun, projectRuns, resolveProject, runStateDir, ticketId } from '../runs.mts';
import type { ProjectContext } from '../runs.mts';

/** Runs a tracker CLI; the shape of spawnSync's result that posting reads. Injected by tests. */
export type Exec = (cmd: string, args: string[]) => { status: number | null; stdout: string; stderr: string; error?: Error };
const realExec: Exec = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error } : {}) };
};
export type TicketOptions = { project?: string; cwd?: string; exec?: Exec; actor?: string; verdict?: string; message?: string; json?: boolean };
type Post = { remoteId: string; url?: string } | { error: string; uncertain: boolean };

function actorName(): string {
  if (process.env.USER?.trim()) return process.env.USER.trim();
  try { return userInfo().username || 'unknown'; } catch { return 'unknown'; }
}

// #137: TOML metadata validates before journal/tracker writes; legacy remains text-only.
import { tomlIdentity } from '../../../orchestrator/project-config.mts';
type Tracker = { kind: 'github' | 'gitlab'; host: string };

/** The project's tracker kind and host from `.sandcastle/config.mts`, or why it can't be read. */
function trackerOf(ctx: ProjectContext): Tracker | string {
  const toml = tomlIdentity(ctx.scaffold);
  if (toml) return toml;
  let text: string;
  try { text = readFileSync(join(ctx.scaffold, 'config.mts'), 'utf8'); } catch { return `no readable ${ctx.scaffold}/config.mts`; }
  const kind = text.match(/^\s*kind:\s*"([^"]+)"/m)?.[1] ?? 'gitlab';
  const host = text.match(/^\s*(?:gitlabHost|host):\s*"([^"]+)"/m)?.[1] ?? (kind === 'github' ? 'github.com' : undefined);
  if (kind === 'github') return { kind, host: host! };
  if (!host) return `couldn't read TRACKER.gitlabHost from ${ctx.scaffold}/config.mts`;
  return { kind: 'gitlab', host };
}
const commentsPath = (ctx: ProjectContext, tr: Tracker, iid: string) => tr.kind === 'github'
  ? `repos/${ctx.tracker}/issues/${iid}/comments` : `projects/${encodeURIComponent(ctx.tracker)}/issues/${iid}/notes`;
const cliOf = (tr: Tracker) => (tr.kind === 'github' ? 'gh' : 'glab');

/** The tracker CLI call that creates a comment on `iid`, or why none can be made. Never posts. */
export function commentCall(ctx: ProjectContext, iid: string, body: string): { cmd: string; args: string[] } | string {
  const tr = trackerOf(ctx);
  if (typeof tr === 'string') return tr;
  return { cmd: cliOf(tr), args: ['api', '--hostname', tr.host, '-X', 'POST', commentsPath(ctx, tr, iid), '-f', `body=${body}`] };
}

/** The tracker CLI call that lists every comment on `iid` (all pages), or why none can be made. Read-only. */
export function listCall(ctx: ProjectContext, iid: string): { cmd: string; args: string[] } | string {
  const tr = trackerOf(ctx);
  if (typeof tr === 'string') return tr;
  return { cmd: cliOf(tr), args: ['api', '--hostname', tr.host, '--paginate', `${commentsPath(ctx, tr, iid)}?per_page=100`] };
}

/** The JSON values in `text` one after another (`--paginate` prints one array per page). Throws on anything else. */
export function parseConcatenated(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0, inString = false, escaped = false, start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') { if (depth++ === 0) start = i; }
    else if (c === ']' || c === '}') { if (--depth === 0) out.push(JSON.parse(text.slice(start, i + 1))); }
    else if (depth === 0 && !/\s/.test(c)) throw new Error(`unexpected ${JSON.stringify(c)} in the tracker's reply`);
  }
  if (depth !== 0 || inString) throw new Error("the tracker's reply was cut short");
  return out;
}

/** The tracker body for a comment or verdict correction: its text, then its hidden marker. */
export function bodyFor(e: JournalEvent): string {
  const head = e.kind === 'verdict' && e.verdict
    ? `Manual verdict correction from ${e.verdict.from ?? 'no verdict'} to ${e.verdict.to}.\nRun: ${e.run ?? 'unknown'}.\n\n` : '';
  return `${head}${e.text ?? ''}\n\n${markerFor(e.id)}`;
}

function post(ctx: ProjectContext, e: JournalEvent, exec: Exec): Post {
  const call = commentCall(ctx, e.iid, bodyFor(e));
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

/** Search the ticket's tracker comments for the event's marker: the comment's id when found, null when the full list
 *  was read and holds none, or why the search couldn't be completed. */
function findPosted(ctx: ProjectContext, e: JournalEvent, exec: Exec): { remoteId: string } | null | string {
  const call = listCall(ctx, e.iid);
  if (typeof call === 'string') return call;
  const r = exec(call.cmd, call.args);
  if (r.error) return `${call.cmd} could not run: ${r.error.message}`;
  if (r.status !== 0) return `${call.cmd} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`;
  const marker = markerFor(e.id);
  try {
    for (const page of parseConcatenated(r.stdout)) {
      if (!Array.isArray(page)) return `${call.cmd} returned something other than a comment list`;
      const hit = page.find((c) => typeof c?.body === 'string' && c.body.includes(marker) && c.id != null);
      if (hit) return { remoteId: String(hit.id) };
    }
  } catch (err) {
    return `couldn't read the comment list: ${(err as Error).message}`;
  }
  return null;
}

export type Delivered = { state: 'posted' | 'found'; remoteId: string; url?: string }
  | { state: 'busy' | 'delivered' | 'unknown' }
  | { state: 'failed'; error: string; uncertain: boolean };

/** Deliver one journal event to the tracker, at most once. Takes the event with `beginDelivery`; when an earlier
 *  attempt may have posted it (`check`), first searches the ticket's comments for its marker and records a match
 *  instead of posting; a search that can't complete posts nothing and leaves the event uncertain. */
export function deliver(ctx: ProjectContext, dir: string, t: Ticket, id: string, exec: Exec): Delivered {
  const start = beginDelivery(dir, t, id);
  if (!start.ok) return { state: start.reason };
  if (start.check) {
    const found = findPosted(ctx, start.event, exec);
    if (typeof found === 'string') {
      const error = `not posted: an earlier attempt may have posted it and the marker search failed (${found})`;
      finishDelivery(dir, t, id, start.token, { error, uncertain: true });
      return { state: 'failed', error, uncertain: true };
    }
    if (found) {
      finishDelivery(dir, t, id, start.token, found);
      return { state: 'found', remoteId: found.remoteId };
    }
  }
  const r = post(ctx, start.event, exec);
  finishDelivery(dir, t, id, start.token, r);
  return 'remoteId' in r ? { state: 'posted', ...r } : { state: 'failed', ...r };
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
  const r = deliver(ctx, dir, t, e.id, o.exec ?? realExec);
  if (r.state === 'posted' || r.state === 'found') {
    console.log(`Posted to ${ctx.tracker}#${iid}${'url' in r && r.url ? `: ${r.url}` : ` (comment ${r.remoteId})`}.`);
    return 0;
  }
  if (r.state !== 'failed') {
    console.log(`Not posted: another process is delivering it (${r.state}). It stays in the journal.`);
    return 1;
  }
  console.error(`Not posted to ${ctx.tracker}#${iid}: ${r.error}. The comment is kept in the journal`
    + (r.uncertain ? '; the post may have reached the tracker, so `factory ticket sync` looks for its marker before posting again.' : '; `factory ticket sync` posts it later.'));
  return 1;
}

/** The ticket numbers with a journal in this project, from the journal file names (`keyFor`), sorted. */
function journaledTickets(dir: string, tracker: string): string[] {
  const prefix = keyFor('0', tracker).slice(0, -1);
  let names: string[];
  try { names = readdirSync(journalDir(dir)); } catch { return []; }
  return names.filter((n) => n.startsWith(prefix) && /^\d+\.json$/.test(n.slice(prefix.length)))
    .map((n) => n.slice(prefix.length, -'.json'.length)).sort((a, b) => Number(a) - Number(b));
}

/** `factory ticket sync [ticket]`: deliver every comment and verdict correction still undelivered in the project's
 *  journals (or one ticket's), at most once each. Returns 0 when nothing is left undelivered, else 1. */
export function ticketSync(p: Paths, ticket: string | undefined, o: TicketOptions = {}): number {
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  const dir = runStateDir(p);
  const exec = o.exec ?? realExec;
  const iids = ticket === undefined ? journaledTickets(dir, ctx.tracker) : [ticketId(ticket)];
  let posted = 0, found = 0, left = 0;
  for (const iid of iids) {
    const t: Ticket = { project: ctx.tracker, iid };
    let events: JournalEvent[];
    try {
      events = readJournal(dir, t).events.filter((e) => e.delivery && e.delivery.state !== 'delivered');
    } catch (err) {
      // Another project whose name sanitizes to the same key owns this file: not ours to sync.
      if (ticket === undefined && /belongs to/.test((err as Error).message)) continue;
      console.error(`#${iid}: ${(err as Error).message}`);
      left++;
      continue;
    }
    for (const e of events) {
      const r = deliver(ctx, dir, t, e.id, exec);
      const what = `#${iid} ${e.kind} ${e.id}`;
      if (r.state === 'posted') { posted++; console.log(`${what}: posted${r.url ? `: ${r.url}` : ` (comment ${r.remoteId})`}.`); }
      else if (r.state === 'found') { found++; console.log(`${what}: already on the tracker (comment ${r.remoteId}); not posted again.`); }
      else if (r.state === 'delivered') { /* delivered meanwhile by another process */ }
      else if (r.state === 'failed') { left++; console.error(`${what}: ${r.error}${r.uncertain ? ' (may have posted; the next sync checks its marker first)' : ''}.`); }
      else { left++; console.log(`${what}: skipped, ${r.state === 'busy' ? 'another process is posting it' : 'no longer in the journal'}.`); }
    }
  }
  console.log(`Synced ${ctx.name}: ${posted} posted, ${found} found already posted, ${left} left undelivered.`);
  return left ? 1 : 0;
}

/** Correct the current run, save locally, then use the same delivery and sync fencing as comments. */
export function ticketVerdict(p: Paths, ticket: string | undefined, o: TicketOptions = {}): number {
  const iid = ticketId(ticket);
  const verdict = normalizeVerdict(o.verdict ?? '');
  if (!o.message?.trim()) throw new Error('A verdict correction requires a non-empty --message explanation.');
  const ctx = resolveProject(p, o);
  const dir = runStateDir(p);
  const { run } = findRun(p, ctx, iid, dir);
  if (!run || run.project !== ctx.tracker || run.iid !== iid || !run.startedAt) {
    throw new Error(`No matching run for #${iid} in ${ctx.name}.`);
  }
  const t = { project: ctx.tracker, iid };
  const e = correctVerdict(dir, t, run, { verdict, text: o.message, actor: o.actor ?? actorName() });
  const r = deliver(ctx, dir, t, e.id, o.exec ?? realExec);
  if (r.state === 'posted' || r.state === 'found' || r.state === 'delivered') {
    console.log(`Saved manual correction on #${iid}: ${e.verdict?.from ?? 'no verdict'} to ${verdict}, run ${e.run}; posted to tracker.`);
    return 0;
  }
  console.error(`Saved locally; ${ctx.tracker} sync pending. ${r.state === 'failed' ? r.error : r.state}. Run factory ticket sync ${iid}.`);
  return 1;
}

/** Archive or restore only after re-reading and validating the raw current record under admission. */
export function ticketArchive(p: Paths, ticket: string | undefined, archived: boolean, o: TicketOptions = {}): number {
  const iid = ticketId(ticket);
  const ctx = resolveProject(p, o);
  const r = archiveTicket(runStateDir(p), { project: ctx.tracker, iid }, archived, o.actor ?? actorName());
  console.log(`#${iid}: ${r.changed ? '' : 'already '}${archived ? 'archived' : 'restored'}; run data preserved.`);
  return 0;
}

/** Show manual history even when archived. JSON is also available for scripts. */
export function ticketShow(p: Paths, ticket: string | undefined, o: TicketOptions = {}): number {
  const iid = ticketId(ticket);
  const ctx = resolveProject(p, o);
  const dir = runStateDir(p);
  const j = readJournal(dir, { project: ctx.tracker, iid });
  const found = findRun(p, ctx, iid, dir).run;
  const run = found?.project === ctx.tracker && found.iid === iid && found.startedAt ? found : undefined;
  if (!run && !j.events.length) throw new Error(`No run or journal for #${iid} in ${ctx.name}.`);
  const view = projectTicket(j, run ?? { startedAt: '' });
  const data = { project: ctx.tracker, iid, run, ...view, manuallyCorrected: !!view.correction, history: j.events };
  if (o.json) console.log(JSON.stringify(data, null, 2));
  else {
    console.log(`${ctx.name} #${iid}: ${view.archived ? 'archived' : 'not archived'}`);
    console.log(`Original verdict: ${view.original ?? 'none'}; effective verdict: ${view.verdict ?? 'none'}${view.correction ? ' (manually corrected)' : ''}`);
    console.log(`Run: ${run ? runIdentity(run) : 'none'}; pending tracker posts: ${view.undelivered.length}`);
    for (const e of j.events) console.log(`${e.at} ${e.actor} ${e.kind}${e.verdict ? ` ${e.verdict.from ?? 'none'} -> ${e.verdict.to}` : ''}${e.run ? ` [${e.run}]` : ''}${e.text ? `: ${e.text}` : ''}${e.delivery ? ` [${e.delivery.state}${e.delivery.lastError ? `: ${e.delivery.lastError}` : ''}]` : ''}`);
  }
  return 0;
}

export function ticketArchived(p: Paths, o: TicketOptions = {}): number {
  const ctx = resolveProject(p, o);
  const dir = runStateDir(p);
  const rows = projectRuns(p, ctx, dir).flatMap(run => {
    const view = projectTicket(readJournal(dir, { project: ctx.tracker, iid: run.iid }), run);
    return view.archived ? [{ project: ctx.tracker, iid: run.iid, title: run.title, run: runIdentity(run), archivedAt: view.archivedAt, originalVerdict: view.original, verdict: view.verdict }] : [];
  });
  if (o.json) console.log(JSON.stringify(rows, null, 2));
  else if (!rows.length) console.log(`No archived tickets in ${ctx.name}.`);
  else for (const row of rows) console.log(`#${row.iid} ${row.title ?? ''} (${row.verdict ?? 'no verdict'}, archived ${row.archivedAt})`);
  return 0;
}

/** Dispatch ticket commands, rejecting misplaced options before any mutation. */
export function ticketCommand(p: Paths, sub: string | undefined, ticket: string | undefined, rest: string[], o: TicketOptions = {}): number {
  if (o.json && sub !== 'show' && sub !== 'archived') throw new Error('--json applies only to ticket show or archived');
  if (o.verdict !== undefined && sub !== 'verdict') throw new Error('--verdict applies only to ticket verdict');
  if (o.message !== undefined && sub !== 'comment' && sub !== 'verdict') throw new Error('--message applies only to ticket comment or verdict');
  if (sub === 'comment') {
    if (o.message !== undefined && rest.length) throw new Error('Use comment text or --message, not both');
    return ticketComment(p, ticket, o.message !== undefined ? [o.message] : rest, o);
  }
  if (sub === 'verdict') {
    if (rest.length) throw new Error('Use --verdict pass|fail --message <explanation>');
    return ticketVerdict(p, ticket, o);
  }
  if (sub === 'archived') {
    if (ticket || rest.length) throw new Error('Unexpected arguments: factory ticket archived');
    return ticketArchived(p, o);
  }
  if (sub === 'archive' || sub === 'restore' || sub === 'show') {
    if (rest.length) throw new Error(`Unexpected arguments: factory ticket ${sub} <ticket>`);
    return sub === 'show' ? ticketShow(p, ticket, o) : ticketArchive(p, ticket, sub === 'archive', o);
  }
  if (sub === 'sync') {
    if (rest.length) throw new Error('Unexpected arguments: factory ticket sync [ticket]');
    return ticketSync(p, ticket, o);
  }
  throw new Error(`Unknown ticket subcommand: ${sub ?? '(none)'}. Use: factory ticket comment|sync|verdict|archive|archived|show|restore`);
}
