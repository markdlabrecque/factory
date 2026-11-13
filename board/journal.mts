// The ticket journal (slice 5, #98): manual comments, verdict corrections and archive state for board tickets, shared by
// the CLI (`factory ticket ...`, #99-#102) and the board (#103). It sits beside the run-state store, in
// `<stateDir>/journal/<key>.json` (folder 0700, files 0600, version 1), a subfolder, so the top-level run JSON scan
// (board.mts readRuns, cli/src/runs.mts) never sees it. Manual metadata lives only here: run records stay machine-written,
// so a later stage write cannot erase it, and the original verdict on the run record is never rewritten.
// - A journal is keyed by tracker project and ticket number (`keyFor`, as run records are), and also names both inside;
//   a file whose project or ticket differs (two project names that sanitize to the same key) is refused, never shared.
// - Each event has a stable UUID (also its tracker marker), the ticket identity, a timestamp, an actor and a kind:
//   `comment` (text), `verdict` (the previous effective and the new verdict, the explanation, the run it corrects),
//   `archive` or `restore` (the run that was current). Comments and verdicts carry a tracker `delivery` state; archive and
//   restore never post. A posted event's body ends with `markerFor(id)` (`factory ticket comment`, #99). Events are only appended; delivery state is the one thing updated in place.
// - Projection (`projectTicket`): the effective verdict is the latest correction for the current run, else the run's
//   own verdict; the ticket is archived while its latest archive/restore event is an archive of the current run. So a
//   new execution inherits neither a previous run's corrected verdict nor its archive. The run identity is
//   `runIdentity(run)`; a ticket without a journal projects exactly as its run record reads.
// - Every mutation re-reads the file under a per-ticket lock (`<key>.lock`, created complete and hard-linked into place,
//   naming its holder's pid and start identity; taken over only when that exact process is gone, never by age), then
//   replaces it durably (temp file, fsync, rename). A corrupt or unknown-version journal fails closed and is never
//   overwritten. Concurrent CLI commands and board requests therefore never lose an event.
// - Delivery is serialized per event: `beginDelivery` hands one poster a token and marks the event `posting`; another
//   poster is refused while that owner lives. An attempt that may have reached the tracker (an owner that died while
//   posting, or a failure reported as uncertain) leaves the event `uncertain`, and the next `beginDelivery` says to
//   search for the event's marker before posting again (`factory ticket sync` does, #100). Only the token holder can finish (`finishDelivery`).
// New normal admissions use executionId, with startedAt as the legacy/manual fallback, so retries are distinct.
// Import-safe and dependency-free apart from Node and admission.mts (process identity and durable writes).
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { keyFor, ownerOf, ownerState, writeDurable } from "./admission.mts";
import type { Owner } from "./admission.mts";

export type EventKind = "comment" | "verdict" | "archive" | "restore";
/** Tracker delivery of a comment or verdict event. `uncertain`: an attempt may have posted it; search for the marker first. */
export interface Delivery {
  state: "pending" | "posting" | "uncertain" | "delivered";
  attempts: number;
  lastError?: string;
  remoteId?: string;
  /** While `posting`: the poster process and its token. */
  owner?: Owner;
  token?: string;
  at?: string;
}
export interface JournalEvent {
  id: string;
  kind: EventKind;
  project: string;
  iid: string;
  at: string;
  actor: string;
  /** The run identity (runIdentity) the event applies to. Required for verdict, archive and restore. */
  run?: string;
  /** The comment, or the verdict correction's explanation. */
  text?: string;
  /** Verdict events: the effective verdict before (absent when the run had none) and the new one. */
  verdict?: { from?: string; to: string };
  delivery?: Delivery;
}
export interface Journal { version: 1; project: string; iid: string; events: JournalEvent[] }
export interface Ticket { project: string; iid: string }
/** What projection needs from a run record. */
export interface RunRef { startedAt: string; executionId?: string; verdict?: string }

export const journalDir = (stateDir: string) => join(stateDir, "journal");
const fileOf = (stateDir: string, t: Ticket) => join(journalDir(stateDir), `${keyFor(t.iid, t.project)}.json`);
const now = () => new Date().toISOString();
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

/** The identity of a run record's execution, which verdict corrections and archive state apply to. */
export const runIdentity = (run: RunRef): string => run.executionId ? `execution:${run.executionId}` : `started:${run.startedAt}`;

/** The hidden marker a posted comment or correction carries, so `factory ticket sync` (#100) can find it on the tracker. */
export const markerFor = (id: string) => `<!-- factory-journal:${id} -->`;

/** `pass`/`fail` in any case, as stored on run records (`PASS`/`FAIL`). */
export function normalizeVerdict(v: string): "PASS" | "FAIL" {
  const up = v.trim().toUpperCase();
  if (up !== "PASS" && up !== "FAIL") throw new Error(`Verdict must be pass or fail, got ${JSON.stringify(v)}`);
  return up;
}

function checkTicket(t: Ticket): void {
  if (!t.project?.trim()) throw new Error("A journal needs the ticket's tracker project.");
  if (!/^\d+$/.test(t.iid ?? "")) throw new Error(`Expected a ticket number, got ${JSON.stringify(t.iid)}`);
}

/** The ticket's journal; an empty one when it has none. Throws on a corrupt, unknown-version or mismatched file. */
export function readJournal(stateDir: string, t: Ticket): Journal {
  checkTicket(t);
  const file = fileOf(stateDir, t);
  let j: Journal;
  try {
    j = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    if (missing(e)) return { version: 1, project: t.project, iid: t.iid, events: [] };
    throw new Error(`Ticket journal ${file} is unreadable (${(e as Error).message}); it is never overwritten.`);
  }
  if (j?.version !== 1 || !Array.isArray(j.events)) throw new Error(`Ticket journal ${file} has an unknown format; it is never overwritten.`);
  if (j.project !== t.project || j.iid !== t.iid) throw new Error(`Ticket journal ${file} belongs to ${j.project} #${j.iid}, not ${t.project} #${t.iid}.`);
  return j;
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Run `fn` holding the ticket's journal lock. Taken over only when its holder process is gone. */
function withJournalLock<T>(stateDir: string, t: Ticket, fn: () => T, waitMs = 10_000): T {
  const dir = journalDir(stateDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, `${keyFor(t.iid, t.project)}.lock`);
  const tmp = `${lock}.${process.pid}.${randomUUID().slice(0, 8)}`;
  writeDurable(tmp, JSON.stringify(ownerOf(process.pid)));
  const deadline = Date.now() + waitMs;
  try {
    for (;;) {
      try {
        linkSync(tmp, lock);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      let holder: Owner | undefined, ino = 0;
      try {
        ino = statSync(lock).ino;
        const h = JSON.parse(readFileSync(lock, "utf8"));
        if (Number.isInteger(h?.pid) && h.pid > 0) holder = h;
      } catch (e) {
        if (missing(e)) continue;
      }
      if (holder && ownerState(holder) === "dead") {
        const aside = `${lock}.stale.${randomUUID().slice(0, 8)}`;
        try { renameSync(lock, aside); } catch { continue; }
        if (statSync(aside).ino !== ino) { try { linkSync(aside, lock); } catch { /* a third claimant holds it */ } }
        rmSync(aside, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(holder ? `Ticket journal is locked by process ${holder.pid} (${lock}). Retry shortly.`
          : `Ticket journal lock ${lock} is unreadable; it is never taken over by age. Remove it once no factory process runs.`);
      }
      sleep(10);
    }
  } finally {
    rmSync(tmp, { force: true });
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Read, change and durably replace the ticket's journal under its lock. `fn` returns false to write nothing. */
function mutate<T>(stateDir: string, t: Ticket, fn: (j: Journal) => { write: boolean; value: T }): T {
  checkTicket(t);
  return withJournalLock(stateDir, t, () => {
    const j = readJournal(stateDir, t);
    const r = fn(j);
    if (r.write) writeDurable(fileOf(stateDir, t), JSON.stringify(j, null, 2) + "\n");
    return r.value;
  });
}

const required = (text: string | undefined, what: string) => {
  if (!text?.trim()) throw new Error(`${what} must not be empty.`);
  return text.trim();
};
const base = (t: Ticket, kind: EventKind, actor: string, at?: string) =>
  ({ id: randomUUID(), kind, project: t.project, iid: t.iid, at: at ?? now(), actor: required(actor, "The actor") });
const pending = (): Delivery => ({ state: "pending", attempts: 0 });

/** Save a comment, pending tracker delivery. An empty comment is refused before anything is written. */
export function addComment(stateDir: string, t: Ticket, o: { text: string; actor: string; run?: string; at?: string }): JournalEvent {
  const text = required(o.text, "A comment");
  return mutate(stateDir, t, (j) => {
    const e: JournalEvent = { ...base(t, "comment", o.actor, o.at), ...(o.run ? { run: o.run } : {}), text, delivery: pending() };
    j.events.push(e);
    return { write: true, value: e };
  });
}

/** Correct `run`'s verdict to `verdict` with an explanation, pending tracker delivery. The previous effective verdict
 *  is taken under the lock, so concurrent corrections chain. Refused, writing nothing, without an explanation. */
export function correctVerdict(stateDir: string, t: Ticket, run: RunRef,
  o: { verdict: string; text: string; actor: string; at?: string }): JournalEvent {
  const to = normalizeVerdict(o.verdict);
  const text = required(o.text, "A verdict correction's explanation");
  return mutate(stateDir, t, (j) => {
    const from = projectTicket(j, run).verdict;
    const e: JournalEvent = { ...base(t, "verdict", o.actor, o.at), run: runIdentity(run), text, verdict: { ...(from ? { from } : {}), to },
      delivery: pending() };
    j.events.push(e);
    return { write: true, value: e };
  });
}

/** Archive (true) or restore (false) the ticket as of `run`. Repeating either is a no-op: `event` is then undefined. */
export function setArchived(stateDir: string, t: Ticket, run: RunRef, archived: boolean,
  o: { actor: string; at?: string }): { changed: boolean; event?: JournalEvent } {
  return mutate(stateDir, t, (j) => {
    if (projectTicket(j, run).archived === archived) return { write: false, value: { changed: false } };
    const e: JournalEvent = { ...base(t, archived ? "archive" : "restore", o.actor, o.at), run: runIdentity(run) };
    j.events.push(e);
    return { write: true, value: { changed: true, event: e } };
  });
}

export interface TicketView {
  /** The run record's own verdict, never rewritten. */
  original?: string;
  /** The latest correction for this run, else the original. */
  verdict?: string;
  /** The correction `verdict` comes from, when it is a manual one. */
  correction?: JournalEvent;
  archived: boolean;
  archivedAt?: string;
  comments: JournalEvent[];
  /** Every verdict correction, for any run, oldest first. */
  corrections: JournalEvent[];
  /** Comments and corrections not yet delivered to the tracker. */
  undelivered: JournalEvent[];
}

/** What the journal makes of the ticket whose current run is `run`. Pure. */
export function projectTicket(j: Journal, run: RunRef): TicketView {
  const id = runIdentity(run);
  const corrections = j.events.filter((e) => e.kind === "verdict");
  const correction = corrections.filter((e) => e.run === id).at(-1);
  const toggle = j.events.filter((e) => e.kind === "archive" || e.kind === "restore").at(-1);
  const archived = toggle?.kind === "archive" && toggle.run === id;
  return {
    original: run.verdict,
    verdict: correction?.verdict?.to ?? run.verdict,
    ...(correction ? { correction } : {}),
    archived,
    ...(archived ? { archivedAt: toggle!.at } : {}),
    comments: j.events.filter((e) => e.kind === "comment"),
    corrections,
    undelivered: j.events.filter((e) => e.delivery && e.delivery.state !== "delivered"),
  };
}

export type DeliveryStart =
  | { ok: true; token: string; event: JournalEvent; /** search the tracker for the event's marker before posting */ check: boolean }
  | { ok: false; reason: "delivered" | "busy" | "unknown"; event?: JournalEvent };

/** Take event `id` for posting. Refused when it is already delivered, another live process is posting it, or it is not
 *  a deliverable event of this ticket. */
export function beginDelivery(stateDir: string, t: Ticket, id: string): DeliveryStart {
  return mutate<DeliveryStart>(stateDir, t, (j) => {
    const e = j.events.find((x) => x.id === id);
    const d = e?.delivery;
    if (!e || !d) return { write: false, value: { ok: false, reason: "unknown" } };
    if (d.state === "delivered") return { write: false, value: { ok: false, reason: "delivered", event: e } };
    if (d.state === "posting" && d.owner && ownerState(d.owner) !== "dead") return { write: false, value: { ok: false, reason: "busy", event: e } };
    const check = d.state === "uncertain" || d.state === "posting";
    const token = randomUUID();
    e.delivery = { ...d, state: "posting", attempts: d.attempts + 1, owner: ownerOf(process.pid), token, at: now() };
    return { write: true, value: { ok: true, token, event: e, check } };
  });
}

/** Record the outcome of the attempt holding `token`: the tracker's comment id, or the error and whether the post may
 *  have reached the tracker anyway. Returns false, writing nothing, when that attempt no longer holds the event. */
export function finishDelivery(stateDir: string, t: Ticket, id: string, token: string,
  r: { remoteId: string } | { error: string; uncertain?: boolean }): boolean {
  return mutate(stateDir, t, (j) => {
    const e = j.events.find((x) => x.id === id);
    const d = e?.delivery;
    if (!e || !d || d.state !== "posting" || d.token !== token) return { write: false, value: false };
    const { owner: _o, token: _t, ...rest } = d;
    e.delivery = "remoteId" in r
      ? { ...rest, state: "delivered", remoteId: r.remoteId, lastError: undefined, at: now() }
      : { ...rest, state: r.uncertain ? "uncertain" : "pending", lastError: r.error.slice(0, 500), at: now() };
    return { write: true, value: true };
  });
}
