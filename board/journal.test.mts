// The ticket journal (#98): events keyed by tracker project and ticket, the effective-verdict and archive projection per
// run, validation that writes nothing, fail-closed reads, concurrent appends from several processes, and per-event
// delivery fencing with uncertain-delivery recovery. Temporary state folders only; no tracker is contacted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { addComment, beginDelivery, correctVerdict, finishDelivery, journalDir, projectTicket, readJournal, setArchived } from "./journal.mts";
import { readRuns } from "./board.mts";

const here = (f: string) => JSON.stringify(new URL(f, import.meta.url).href);
const fixture = (t: any) => {
  const dir = mkdtempSync(resolve(tmpdir(), "journal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const island = { project: "island", iid: "759" };
const failed = { startedAt: "2026-11-01T00:00:00.000Z", verdict: "FAIL" };
const view = (dir: string, run = failed, tk = island) => projectTicket(readJournal(dir, tk), run);
const deadOwner = () => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
  `import { ownerOf } from ${here("./admission.mts")}; console.log(JSON.stringify(ownerOf(process.pid)));`], { encoding: "utf8" }));

test("a ticket without a journal reads exactly as its run record", (t) => {
  const dir = fixture(t);
  assert.deepEqual(view(dir), { original: "FAIL", verdict: "FAIL", archived: false, comments: [], corrections: [], undelivered: [] });
  assert.equal(existsSync(journalDir(dir)), false);
});

test("a correction changes the effective verdict of its run only, keeping the original and the history", (t) => {
  const dir = fixture(t);
  const c = correctVerdict(dir, island, failed, { verdict: "pass", text: "14/14 listing tests passed after the pager fix.", actor: "mark" });
  assert.deepEqual(c.verdict, { from: "FAIL", to: "PASS" });
  const again = correctVerdict(dir, island, failed, { verdict: "FAIL", text: "Pager broke again.", actor: "mark" });
  assert.deepEqual(again.verdict, { from: "PASS", to: "FAIL" });
  const v = view(dir);
  assert.equal(v.original, "FAIL");
  assert.equal(v.verdict, "FAIL");
  assert.equal(v.correction?.id, again.id);
  assert.deepEqual(v.corrections.map((e) => e.id), [c.id, again.id]);
  assert.equal(v.undelivered.length, 2);
  // A new execution inherits neither the correction nor an archive of the earlier run.
  setArchived(dir, island, failed, true, { actor: "mark" });
  const rerun = { startedAt: "2026-11-05T00:00:00.000Z", verdict: "FAIL" };
  const next = view(dir, rerun);
  assert.equal(next.verdict, "FAIL");
  assert.equal(next.correction, undefined);
  assert.equal(next.archived, false);
  // The same ticket number in another project is untouched.
  assert.deepEqual(view(dir, failed, { project: "news", iid: "759" }).corrections, []);
});

test("empty comments and explanations, bad verdicts and missing projects write nothing", (t) => {
  const dir = fixture(t);
  assert.throws(() => addComment(dir, island, { text: "  ", actor: "mark" }), /must not be empty/);
  assert.throws(() => correctVerdict(dir, island, failed, { verdict: "pass", text: "", actor: "mark" }), /must not be empty/);
  assert.throws(() => correctVerdict(dir, island, failed, { verdict: "maybe", text: "why", actor: "mark" }), /pass or fail/);
  assert.throws(() => addComment(dir, { project: "", iid: "759" }, { text: "hi", actor: "mark" }), /tracker project/);
  assert.equal(existsSync(journalDir(dir)), false);
});

test("archive and restore are idempotent and kept out of the run record scan", (t) => {
  const dir = fixture(t);
  writeFileSync(resolve(dir, "island--759.json"), JSON.stringify({ iid: "759", project: "island", stage: "done", ...failed, pid: 1 }));
  assert.equal(setArchived(dir, island, failed, true, { actor: "mark" }).changed, true);
  assert.equal(setArchived(dir, island, failed, true, { actor: "mark" }).changed, false);
  assert.equal(view(dir).archived, true);
  assert.equal(setArchived(dir, island, failed, false, { actor: "mark" }).changed, true);
  assert.equal(setArchived(dir, island, failed, false, { actor: "mark" }).changed, false);
  assert.equal(view(dir).archived, false);
  assert.deepEqual(readJournal(dir, island).events.map((e) => [e.kind, e.delivery]), [["archive", undefined], ["restore", undefined]]);
  assert.deepEqual(readRuns(dir, false).map((r) => r.key), ["island--759"]);
});

test("a corrupt, foreign or unknown-version journal fails closed and is never overwritten", (t) => {
  const dir = fixture(t), file = resolve(journalDir(dir), "island--759.json");
  mkdirSync(journalDir(dir), { recursive: true });
  for (const text of ["{oops", JSON.stringify({ version: 2, events: [] }), JSON.stringify({ version: 1, project: "is/land", iid: "759", events: [] })]) {
    writeFileSync(file, text);
    assert.throws(() => addComment(dir, island, { text: "hi", actor: "mark" }), /never overwritten|belongs to/);
    assert.equal(readFileSync(file, "utf8"), text);
  }
});

test("concurrent writers from several processes keep every event", async (t) => {
  const dir = fixture(t);
  const script = `import { addComment } from ${here("./journal.mts")};
    for (let i = 0; i < 10; i++) addComment(${JSON.stringify(dir)}, { project: "island", iid: "759" }, { text: "c" + process.argv[1] + "-" + i, actor: "w" });`;
  await Promise.all([0, 1, 2, 3].map((n) => new Promise<void>((ok, fail) => {
    const c = spawn(process.execPath, ["--input-type=module", "-e", script, String(n)], { stdio: "inherit" });
    c.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`writer ${n} exited ${code}`))));
  })));
  const texts = view(dir).comments.map((e) => e.text).sort();
  assert.equal(texts.length, 40);
  assert.equal(new Set(readJournal(dir, island).events.map((e) => e.id)).size, 40);
  assert.deepEqual(readdirSync(journalDir(dir)), ["island--759.json"]);
});

test("delivery is serialized per event; an abandoned or uncertain post asks for a marker search first", (t) => {
  const dir = fixture(t);
  const e = addComment(dir, island, { text: "Re-verification passed.", actor: "mark" });
  const first = beginDelivery(dir, island, e.id);
  assert.ok(first.ok && !first.check);
  assert.deepEqual(beginDelivery(dir, island, e.id), { ok: false, reason: "busy", event: readJournal(dir, island).events[0] });
  assert.equal(finishDelivery(dir, island, e.id, first.token, { error: "timeout", uncertain: true }), true);
  assert.equal(finishDelivery(dir, island, e.id, first.token, { remoteId: "1" }), false, "a finished attempt cannot finish again");
  let d = readJournal(dir, island).events[0].delivery!;
  assert.equal(d.state, "uncertain");
  assert.equal(d.lastError, "timeout");

  const second = beginDelivery(dir, island, e.id);
  assert.ok(second.ok && second.check);
  // Its poster dies mid-post: the next one takes over and is told to search first.
  const j = JSON.parse(readFileSync(resolve(journalDir(dir), "island--759.json"), "utf8"));
  j.events[0].delivery.owner = deadOwner();
  writeFileSync(resolve(journalDir(dir), "island--759.json"), JSON.stringify(j));
  const third = beginDelivery(dir, island, e.id);
  assert.ok(third.ok && third.check);
  assert.equal(finishDelivery(dir, island, e.id, second.ok ? second.token : "", { remoteId: "x" }), false);
  assert.equal(finishDelivery(dir, island, e.id, third.token, { remoteId: "4242" }), true);
  d = readJournal(dir, island).events[0].delivery!;
  assert.deepEqual([d.state, d.remoteId, d.attempts, d.lastError, d.owner], ["delivered", "4242", 3, undefined, undefined]);
  assert.equal(beginDelivery(dir, island, e.id).ok, false);
  assert.deepEqual(view(dir).undelivered, []);
});

test("a journal lock held by a dead process is taken over", (t) => {
  const dir = fixture(t);
  mkdirSync(journalDir(dir), { recursive: true });
  writeFileSync(resolve(journalDir(dir), "island--759.lock"), JSON.stringify(deadOwner()));
  addComment(dir, island, { text: "hi", actor: "mark" });
  assert.equal(view(dir).comments.length, 1);
  assert.equal(existsSync(resolve(journalDir(dir), "island--759.lock")), false);
});
