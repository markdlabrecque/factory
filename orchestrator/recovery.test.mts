// Recovery attempt bounds (#60): the repair agent is aborted at its deadline or on cancellation, and an attempt's own
// container is found by its worktree mount, removed and confirmed gone without touching other containers. Fake docker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containersGone, readResult, repairWithin, writeResult } from "./recovery.mts";
import type { Docker } from "./recovery.mts";

// An agent run that only ends when its signal aborts, as Sandcastle's run() does.
const hang = (signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));

test("the repair agent is stopped at its deadline or when cancelled; other failures are not disguised", async () => {
  let seen: AbortSignal | undefined;
  const late = await repairWithin(30, new AbortController().signal, (s) => ((seen = s), hang(s)));
  assert.equal(late.ok, false);
  assert.equal((late as { why: string }).why, "timed-out");
  assert.ok(seen!.aborted, "the agent's signal was aborted");

  const cancel = new AbortController();
  setTimeout(() => cancel.abort(new Error("cancelled")), 10);
  assert.equal(((await repairWithin(60_000, cancel.signal, hang)) as { why: string }).why, "cancelled");

  assert.deepEqual(await repairWithin(60_000, new AbortController().signal, async () => 7), { ok: true, value: 7 });
  await assert.rejects(repairWithin(60_000, new AbortController().signal, async () => { throw new Error("image missing"); }), /image missing/);
});

/** A docker with the named containers and their mount sources; `stuck` names survive rm -f; `down` fails every call. */
function fakeDocker(containers: Record<string, string[]>, o: { stuck?: string[]; down?: boolean } = {}) {
  const calls: string[][] = [];
  const docker: Docker = (args) => {
    calls.push(args);
    if (o.down) return { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
    if (args[0] === "ps") return { status: 0, stdout: Object.keys(containers).map((n) => `${n}\n`).join(""), stderr: "" };
    if (args[0] === "rm") { if (!o.stuck?.includes(args[2])) delete containers[args[2]]; return { status: 0, stdout: "", stderr: "" }; }
    const name = args.at(-1)!;
    if (!containers[name]) return { status: 1, stdout: "", stderr: `Error: No such container: ${name}` };
    return { status: 0, stdout: containers[name].map((m) => `${m}\n`).join(""), stderr: "" };
  };
  return { docker, calls, containers };
}

test("only the attempt's own container is removed, and it must be confirmed gone", () => {
  const wt = "/p/.sandcastle/worktrees/7-fix";
  const d = fakeDocker({ "sandcastle-a": [wt, "/p/.sandcastle/evidence"], "sandcastle-b": ["/p/.sandcastle/worktrees/8-other"] });
  assert.deepEqual(containersGone(wt, d.docker), { ok: true, removed: ["sandcastle-a"] });
  assert.deepEqual(Object.keys(d.containers), ["sandcastle-b"]);
  assert.ok(!d.calls.some((c) => c[0] === "rm" && c[2] === "sandcastle-b"), "another ticket's container is never removed");
  assert.deepEqual(containersGone(wt, d.docker), { ok: true, removed: [] });

  const stuck = fakeDocker({ "sandcastle-a": [wt] }, { stuck: ["sandcastle-a"] });
  assert.match((containersGone(wt, stuck.docker) as { reason: string }).reason, /sandcastle-a still present/);
  // An unreachable daemon is not "no containers".
  assert.match((containersGone(wt, fakeDocker({}, { down: true }).docker) as { reason: string }).reason, /could not list containers/);
});

test("an attempt's result file names its report and is ignored when it belongs to another attempt", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "factory-recovery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readResult(dir, 1), undefined);
  writeFileSync(join(dir, "recovery-report.md"), "cause: flaky fixture\n");
  writeResult(dir, 1, "timed-out", "stopped after 15 minutes", "2026-11-12T00:00:00.000Z");
  assert.deepEqual(readResult(dir, 1), { attempt: 1, result: "timed-out", reason: "stopped after 15 minutes", at: "2026-11-12T00:00:00.000Z", report: join(dir, "recovery-report.md") });
  assert.equal(readResult(dir, 2), undefined);
});
