// Recovery attempt primitives (#60, #74): the repair deadline (including a run that resolves after the deadline or a
// cancellation fired), exact-name container cleanup that never touches another container, the repair report contract,
// and the host-owned attempt record. Fake clock and fake docker; the full lifecycle is in recovery-runner.test.mts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReport, containerFor, ownedContainerGone, readAttemptRecord, repairWithin, writeAttemptRecord } from "./recovery.mts";
import type { AttemptRecord, Docker } from "./recovery.mts";
import { fakeClock } from "./fixtures/recovery-fakes.mts";

const tick = () => new Promise((r) => setImmediate(r));
// An agent run that only ends when its signal aborts, as Sandcastle's run() does.
const hang = (signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));

test("the repair deadline is exactly the given time on the injected clock and is cleared when the run ends", async () => {
  const c = fakeClock();
  let seen: AbortSignal | undefined;
  const p = repairWithin(900_000, new AbortController().signal, (s) => ((seen = s), hang(s)), c.clock);
  c.advance(899_999);
  await tick();
  assert.equal(seen!.aborted, false, "not aborted a millisecond early");
  c.advance(1);
  const r = await p;
  assert.deepEqual([r.ok, (r as { why: string }).why], [false, "timed-out"]);

  const done = fakeClock();
  assert.deepEqual(await repairWithin(900_000, new AbortController().signal, async () => 7, done.clock), { ok: true, value: 7 });
  assert.equal(done.pending(), 0, "the deadline timer is cleared");
  await assert.rejects(repairWithin(900_000, new AbortController().signal, async () => { throw new Error("image missing"); }, fakeClock().clock), /image missing/);
});

test("a repair that resolves after the deadline or a cancellation fired is still stopped, not a success", async () => {
  const c = fakeClock();
  // Ignores its signal and resolves later, like an agent that finished while being killed.
  let release!: () => void;
  const late = repairWithin(1000, new AbortController().signal, () => new Promise((r) => { release = () => r("done"); }), c.clock);
  c.advance(1000);
  release();
  assert.equal(((await late) as { why: string }).why, "timed-out");

  const cancel = new AbortController();
  let release2!: () => void;
  const cancelled = repairWithin(1000, cancel.signal, () => new Promise((r) => { release2 = () => r("done"); }), fakeClock().clock);
  cancel.abort(new Error("SIGTERM"));
  release2();
  assert.equal(((await cancelled) as { why: string }).why, "cancelled");
});

/** Containers by name; `stuck` survive rm -f; `down` makes every call fail. */
function fakeDocker(names: string[], o: { stuck?: string[]; down?: boolean } = {}) {
  const live = new Set(names);
  const calls: string[][] = [];
  const docker: Docker = (args) => {
    calls.push(args);
    if (o.down) return { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
    const name = args.at(-1)!;
    if (args[0] === "rm") { if (!o.stuck?.includes(name)) live.delete(name); return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "container" && args[1] === "inspect") {
      return live.has(name) ? { status: 0, stdout: `/${name}\n`, stderr: "" } : { status: 1, stdout: "", stderr: `Error: No such container: ${name}` };
    }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  };
  return { docker, calls, live };
}

test("only the exactly named attempt container is removed, and it must be confirmed gone", () => {
  const mine = containerFor("11111111-2222-3333-4444-555555555555");
  const other = containerFor("99999999-2222-3333-4444-555555555555");
  const d = fakeDocker([mine, other, "sandcastle-abc"]);
  assert.deepEqual(ownedContainerGone(mine, d.docker), { ok: true, removed: true });
  assert.deepEqual([...d.live].sort(), [other, "sandcastle-abc"].sort());
  assert.ok(d.calls.every((c) => c.at(-1) === mine), "no other container is named in any docker call");
  assert.deepEqual(ownedContainerGone(mine, d.docker), { ok: true, removed: false });

  const stuck = fakeDocker([mine], { stuck: [mine] });
  assert.match((ownedContainerGone(mine, stuck.docker) as { reason: string }).reason, /still present/);
  assert.match((ownedContainerGone(mine, fakeDocker([], { down: true }).docker) as { reason: string }).reason, /could not inspect/);
  assert.match((ownedContainerGone("sandcastle-abc", d.docker) as { reason: string }).reason, /not a recovery attempt's container/);
});

test("the repair report must be complete; blockers and host follow-ups stop the attempt", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "factory-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const good = { cause: "flaky fixture", filesChanged: ["a.ts"], tests: [{ command: "npm test", result: "pass" }], canProceed: true, remainingBlockers: [], requiresHostUpdate: false };
  const write = (r: unknown, md = true) => {
    writeFileSync(join(dir, "recovery-report.json"), typeof r === "string" ? r : JSON.stringify(r));
    if (md) writeFileSync(join(dir, "recovery-report.md"), "report\n"); else rmSync(join(dir, "recovery-report.md"), { force: true });
  };
  assert.equal(checkReport(dir).ok, false, "missing report");
  write("{not json");
  assert.match((checkReport(dir) as { reason: string }).reason, /no readable/);
  write({ ...good, tests: [{ command: "npm test" }] });
  assert.match((checkReport(dir) as { reason: string }).reason, /malformed/);
  write({ ...good, canProceed: "yes" });
  assert.match((checkReport(dir) as { reason: string }).reason, /malformed/);
  write(good, false);
  assert.match((checkReport(dir) as { reason: string }).reason, /recovery-report\.md/);
  write({ ...good, remainingBlockers: [{ iid: 12, what: "API" }] });
  assert.deepEqual([checkReport(dir).ok, (checkReport(dir) as { outcome: string }).outcome], [false, "unresolved"]);
  write({ ...good, canProceed: false });
  assert.equal((checkReport(dir) as { outcome: string }).outcome, "unresolved");
  write({ ...good, requiresHostUpdate: true });
  assert.equal((checkReport(dir) as { outcome: string }).outcome, "host-followup");
  write(good);
  assert.equal(checkReport(dir).ok, true);
});

test("an attempt record is validated and never accepted with a forged container name", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "factory-record-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const id = "11111111-2222-3333-4444-555555555555";
  const rec: AttemptRecord = { version: 1, id, seq: 1, project: "p", iid: "7", branch: "7-x", base: "main", startSha: "a".repeat(40), worktree: "/w",
    container: containerFor(id), evidence: "/e", gitDir: "/g", phase: "claimed", createdAt: "t", updatedAt: "t", events: [] };
  const file = join(dir, "a.json");
  assert.match((readAttemptRecord(file) as { reason: string }).reason, /missing/);
  writeAttemptRecord(file, rec);
  assert.equal(readAttemptRecord(file).ok, true);
  writeAttemptRecord(file, { ...rec, container: "sandcastle-other" });
  assert.equal(readAttemptRecord(file).ok, false);
  writeAttemptRecord(file, { ...rec, version: 2 as 1 });
  assert.equal(readAttemptRecord(file).ok, false);
});
