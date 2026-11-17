// Pure scheduling policy and bounded hint collection. No filesystem, model, tracker, timer or service boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supervisorScheduleHold, supervisorWakeups } from '../src/supervisor-schedule.mts';
import type { SupervisorWakeResult } from '../src/supervisor-schedule.mts';
import { supervisorFixture, AT } from './supervisor-fixture.mts';

test('scheduled diagnosis requires current explicit pilot; off/unknown/pause/observe/stop/cancel cannot admit', () => {
  const a = supervisorFixture(); a.snapshot.mode = 'act';
  const control = { mode: 'act' as const, actor: 'uid:1000:operator', at: AT, pilot: true };
  assert.equal(supervisorScheduleHold(a, control, false), undefined);
  for (const patch of [{ registered: false }, { globalAllowed: false }, { globalAllowed: undefined }, { paused: true }, { outsideAdmissionLocks: false }, { policy: { enabled: false } }] as const)
    assert.ok(supervisorScheduleHold({ ...a, ...patch } as typeof a, control, false));
  for (const mode of ['observe','stopped'] as const) {
    assert.ok(supervisorScheduleHold({ ...a, snapshot: { ...a.snapshot, mode } }, control, false));
    assert.ok(supervisorScheduleHold(a, { ...control, mode }, false));
  }
  assert.ok(supervisorScheduleHold(a, undefined, false));
  assert.ok(supervisorScheduleHold(a, { ...control, pilot: false }, false));
  assert.ok(supervisorScheduleHold(a, control, true));
});

test('repeated project event hints coalesce, all supported causes stay nonauthoritative and cancellation drops them', async () => {
  const results: SupervisorWakeResult[] = [];
  const hook = supervisorWakeups(() => undefined, result => results.push(result));
  for (const kind of ['checkpoint','pass-completed','run-failure','gate-refusal','delivery','prerequisites','requirements','owner-response'] as const)
    for (let n = 0; n < 3; n++) hook.enqueue('/a', kind);
  hook.enqueue('/b', 'checkpoint');
  assert.deepEqual(results, []);
  hook.handoff(new AbortController().signal);
  assert.deepEqual(results, [], 'handoff never runs a collector synchronously');
  await hook.settled();
  assert.deepEqual(results.map(r => r.root), ['/a','/b']);
  assert.ok(results.every(r => r.state === 'held' && /No trusted/.test(r.reason)));
  hook.enqueue('/a', 'owner-response'); hook.handoff(AbortSignal.abort()); await hook.settled();
  assert.equal(results.length, 2, 'owner response is not approval/resumption and cancellation admits nothing');
  assert.equal(hook.cancel('/a'), false, 'no safe live handle means no claimed cancellation');
  assert.throws(() => hook.enqueue('relative', 'checkpoint'), /Invalid/);
});
