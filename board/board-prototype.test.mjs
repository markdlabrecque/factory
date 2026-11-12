// Branch-only tracker prototype regression tests. Run with node --test board/board-prototype.test.mjs.
// Exercise the embedded demo model and sonar phase without a browser; UI checks are documented in docs/board-design-prototype.md.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./board-prototype.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Stop before DOM reconciliation. Test the actual inline model, not a copy.
const prefix = script.slice(0, script.indexOf('  const rows = new Map();'));
const model = runInNewContext(prefix + '\nreturn { FIX, fixture, ticketAt, visibleQueueReasons, trackerHTML, sonarFrame };\n})();', {
  document: { getElementById() {} },
  matchMedia: () => ({ matches: false }),
});
const ticket = id => model.FIX.find(f => f.id === id);

test('queue reasons hide capacity only when another blocker exists', () => {
  const cap = {code:'docket_full', text:'Docket is full'};
  const dep = {code:'dependency', text:'Waiting for DEMO-241 to ship'};
  const app = {code:'approval', text:'Needs maintainer approval'};
  assert.equal(model.visibleQueueReasons([cap])[0].text,'Docket is full');
  assert.equal(model.visibleQueueReasons([cap,dep,app,dep]).map(r=>r.code).join(','),'dependency,approval');
  assert.equal(model.visibleQueueReasons([])[0].code,'unknown');
  const queued = ticket('DEMO-243');
  assert.equal(model.ticketAt(queued,0).reasons.map(r=>r.code).join(','),'dependency,approval');
  assert.equal(model.ticketAt(queued,51).reasons[0].code,'docket_full');
  assert.equal(model.ticketAt(queued,58).stage,'setup');
});

test('the bright line reaches the current stage, including a blocked stage', () => {
  const active = model.ticketAt(ticket('DEMO-242'),0);
  assert.equal(active.stage,'verifying');
  const track = model.trackerHTML(active);
  assert.equal((track.match(/ connected/g)||[]).length,3);
  assert.equal((track.match(/class="step complete\b/g)||[]).length,3);
  assert.equal((track.match(/aria-current="step"/g)||[]).length,1);
  const blocked = model.ticketAt(ticket('DEMO-246'),0);
  assert.equal(blocked.status,'blocked');
  assert.equal((model.trackerHTML(blocked).match(/ connected/g)||[]).length,2);
  const queued = model.ticketAt(ticket('DEMO-243'),0);
  assert.equal((model.trackerHTML(queued).match(/ connected/g)||[]).length,0);
});

test('sonar expands from the center past the dot, fades and repeats on demo time', () => {
  const start=model.sonarFrame(0), middle=model.sonarFrame(.9), end=model.sonarFrame(1.79);
  assert.equal(start.scale,0);
  assert.equal(middle.scale,1.6);
  assert.ok(end.scale>3 && end.opacity<.01);
  assert.ok(start.opacity>middle.opacity && middle.opacity>end.opacity);
  assert.equal(model.sonarFrame(1.8).scale,0);
  const active=model.trackerHTML(model.ticketAt(ticket('DEMO-242'),0));
  assert.equal((active.match(/class="sonar"/g)||[]).length,1);
  assert.ok(active.includes('class="sonar" aria-hidden="true"'));
  const done=model.trackerHTML(model.ticketAt(ticket('DEMO-242'),100));
  assert.ok(!done.includes('class="sonar"'));
});

test('bounces reset the tracker but keep both stage visits in running totals', () => {
  const f = ticket('DEMO-241');
  const before = model.ticketAt(f,25);
  const after = model.ticketAt(f,27);
  assert.equal(before.stage,'verifying');
  assert.equal(after.stage,'implementing');
  assert.equal(after.bounces.length,1);
  assert.equal((model.trackerHTML(after).match(/ connected/g)||[]).length,2);
  const done = model.ticketAt(f,f.completedAt+10);
  assert.equal(done.visits.implementing,2);
  assert.equal(done.visits.verifying,2);
  assert.equal(done.running,64);
  assert.equal(done.elapsed,68);
  assert.equal((model.trackerHTML(done).match(/ connected/g)||[]).length,5);
});

test('queue, running and blocked intervals partition elapsed time at every second', () => {
  for (const f of model.FIX) {
    for (let time=0; time<120; time++) {
      const t=model.ticketAt(f,time);
      assert.equal(t.running+t.queued+t.blocked,t.elapsed,`${f.id} at ${time}`);
      assert.ok(t.used.every(i=>i.duration>=0));
      if(t.status==='queued') assert.ok(t.reasons.length);
      if(t.status==='done') assert.equal(t.elapsed,f.completedAt-f.queuedAt);
    }
  }
});

test('a hold does not add a stage visit or running time', () => {
  const f=ticket('DEMO-246');
  const first=model.ticketAt(f,0), later=model.ticketAt(f,50);
  assert.equal(first.running,later.running);
  assert.equal(later.blocked-first.blocked,50);
  const done=model.ticketAt(f,f.completedAt);
  assert.equal(done.visits.implementing,1);
  assert.equal(done.blocked,160);
});

test('fixtures cover more than ten completions and dynamic queue admission', () => {
  assert.equal(model.FIX.filter(f=>f.completedAt<=0).length,12);
  assert.equal(model.FIX.filter(f=>model.ticketAt(f,0).status==='queued').length,3);
  assert.equal(model.FIX.filter(f=>model.ticketAt(f,60).status==='queued').length,0);
});
