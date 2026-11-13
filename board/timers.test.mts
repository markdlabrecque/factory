// The scheduler strip's data (#121): the state rules over a fake service manager, one entry per timer, unknown when the manager
// can't be read, and no last-run data. The production adapters are covered in cli/test/schedule-linux.test.mts and
// schedule-macos.test.mts; the HTTP route and the page's DOM in board.test.mts. Disposable HOME only.
// Run with node --test board/timers.test.mts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSchedule } from "../cli/src/platform/fake.mts";
import { home } from "../cli/test/schedule-helpers.mts";
import { readTimers } from "./timers.mts";

const NOW = Date.parse("2026-11-13T12:00:00Z");

test("a timer reads as none, off, scheduled with its next run, or running now", async (t) => {
  const { p } = home(t, "factory-board-timers-");
  const sched = new FakeSchedule(p);
  const states = async () => (await readTimers(p, sched, NOW)).timers.map(({ name, state, nextAt }) => ({ name, state, nextAt }));
  assert.deepEqual(await states(), [{ name: "factory-tick", state: "none", nextAt: undefined }], "not installed");
  sched.timer = "inactive"; sched.tick = "inactive";
  assert.equal((await states())[0].state, "off", "installed, not enabled");
  sched.enabled = true;
  assert.equal((await states())[0].state, "off", "enabled but not running");
  sched.timer = "active"; sched.nextAt = NOW + 240_000;
  assert.deepEqual(await states(), [{ name: "factory-tick", state: "scheduled", nextAt: NOW + 240_000 }]);
  sched.nextAt = undefined;
  assert.deepEqual(await states(), [{ name: "factory-tick", state: "scheduled", nextAt: undefined }], "scheduled with no known next run");
  sched.tick = "active"; sched.nextAt = NOW + 240_000;
  assert.deepEqual(await states(), [{ name: "factory-tick", state: "running", nextAt: undefined }], "a tick is running: no countdown");
  const body = await readTimers(p, sched, NOW);
  assert.equal(body.generatedAt, "2026-11-13T12:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(body), /last|history|duration/i);
});

test("each reported timer gets its own entry, and an unreadable manager is one unknown entry, never off", async (t) => {
  const { p } = home(t, "factory-board-timers-");
  const sched = new FakeSchedule(p);
  sched.timer = "active"; sched.enabled = true; sched.tick = "inactive";
  sched.extraTimers = [{ id: "factory-tick-second.timer", status: { timer: "inactive", enabled: false, tick: "inactive" } }];
  const { timers } = await readTimers(p, sched, NOW);
  assert.deepEqual(timers.map((x) => [x.name, x.state]), [["factory-tick", "scheduled"], ["factory-tick-second", "off"]]);
  sched.fail.add("status");
  const unreadable = await readTimers(p, sched, NOW);
  assert.equal(unreadable.timers.length, 1);
  assert.equal(unreadable.timers[0].state, "unknown");
  assert.match(unreadable.timers[0].reason!, /Simulated status failure/);
});
