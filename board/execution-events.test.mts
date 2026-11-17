// Offline immutable-store, crash, lock, export and persisted-writer contract tests in disposable roots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent, exportEvents, observeRun, streamKey, validTime, supervisorOutcomeMetrics } from './execution-events.mts';
import type { ProducerEvent } from './execution-events.mts';
import { afterAdmission, ownerOf, withAdmission } from './admission.mts';
import { claimRun, readRuns, writeRecord } from './board.mts';
const at = '2026-01-01T00:00:00.000Z';
const payload = (patch: Partial<ProducerEvent> = {}): ProducerEvent => ({ eventId: randomUUID(), observedAt: at, project: 'owner/repo', ticket: '1', identityComplete: false, eventKind: 'stage-changed', from: 'setup', to: 'implementing', reasonCode: 'unspecified', origin: 'runner', ...patch });
function fixture(t: any) { const d = mkdtempSync(join(tmpdir(),'execution-events-')); t.after(() => rmSync(d,{recursive:true,force:true})); return d; }
const moduleURL = new URL('./execution-events.mts', import.meta.url).href;
function child(script: string): Promise<void> {
  return new Promise((resolve,reject) => { const p = spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']}); let stderr=''; p.stderr.on('data',b=>stderr+=b); p.on('error',reject); p.on('exit',code=>code===0?resolve():reject(Error(stderr || `exit ${code}`))); });
}
const eventFiles = (d: string, p = 'owner/repo', ticket = '1') => join(d,'telemetry',streamKey(p,ticket));

test('concurrent process writers serialize one stream and retain distinct canonical identities', async t => {
  const dir = fixture(t);
  const writer = join(eventFiles(dir), '.writer'); mkdirSync(writer, { recursive: true, mode: 0o700 });
  writeFileSync(join(writer, 'lock'), JSON.stringify({ pid: 2147483647, start: 'dead-owner' }));
  await Promise.all(Array.from({length:6},(_,i)=>child(`import {appendEvent} from ${JSON.stringify(moduleURL)}; for(let n=0;n<6;n++) appendEvent(${JSON.stringify(dir)},{...${JSON.stringify(payload())},eventId:'writer-${i}-'+n},{waitMs:10000});`)));
  const r = exportEvents(dir); assert.deepEqual(r.diagnostics,[]); assert.equal(r.events.length,36);
  assert.deepEqual(r.events.map(e=>e.sequence),Array.from({length:36},(_,i)=>i+1));
  for (const [project,ticket] of [['a/b','1'],['a_b','1'],['a/b','2']] as const) appendEvent(dir,payload({project,ticket}));
  assert.equal(readdirSync(join(dir,'telemetry')).length,4);
  assert.equal(statSync(eventFiles(dir)).mode & 0o777,0o700);
  const file = readdirSync(eventFiles(dir)).find(n=>n.endsWith('.json'))!;
  assert.equal(statSync(join(eventFiles(dir),file)).mode & 0o777,0o600);
});

test('identical ID retry preserves assigned sequence/time; changed producer data is rejected', t => {
  const d=fixture(t), p=payload(); const a=appendEvent(d,p);
  assert.deepEqual(appendEvent(d,{...p}),a);
  assert.throws(()=>appendEvent(d,{...p,to:'verifying'}),/Conflicting/);
  assert.equal(exportEvents(d).events.length,1);
});

test('crash before publication leaves only ignored temporary content; crash after publication is replayable', t => {
  const d=fixture(t), p=payload();
  for(const point of ['afterSync','afterPublish']) {
    const result=spawnSync(process.execPath,['--input-type=module','-e',`import {appendEvent} from ${JSON.stringify(moduleURL)}; appendEvent(${JSON.stringify(d)},${JSON.stringify(p)},{${point}:()=>process.exit(73)});`]);
    assert.equal(result.status,73);
    if(point==='afterSync') assert.equal(exportEvents(d).events.length,0);
  }
  assert.equal(exportEvents(d).events.length,1);
  assert.equal(appendEvent(d,p).sequence,1);
  assert.equal(appendEvent(d,payload()).sequence,2);
  assert.deepEqual(exportEvents(d).diagnostics,[]);
});

test('dead owners can be reclaimed; live and unknown owners are never stolen by age', t => {
  for(const [owner,blocked] of [[{pid:2147483647,start:'gone'},false],[ownerOf(process.pid),true],[{pid:process.pid},true],[{},true]] as const) {
    const d=fixture(t), lock=join(eventFiles(d),'.writer'); mkdirSync(lock,{recursive:true});
    writeFileSync(join(lock,'lock'),JSON.stringify(owner));
    if(blocked) assert.throws(()=>appendEvent(d,payload(),{waitMs:0}),/locked|unreadable/);
    else assert.equal(appendEvent(d,payload(),{waitMs:100}).sequence,1);
  }
});

test('an abandoned reclaim guard fails closed rather than racing a replacement writer', t => {
  const d = fixture(t), writer = join(eventFiles(d), '.writer'); mkdirSync(writer, { recursive: true });
  writeFileSync(join(writer, 'lock.reap'), JSON.stringify({ pid: 2147483647 }));
  assert.throws(() => appendEvent(d, payload(), { waitMs: 0 }), /busy/);
  assert.equal(exportEvents(d).events.length, 0);
});

test('snapshot export ignores temps and is byte/mtime read-only, with observed-time filters', async t => {
  const d=fixture(t); appendEvent(d,payload()); appendEvent(d,payload({observedAt:'2026-02-01T00:00:00Z'}));
  writeFileSync(join(eventFiles(d),'.incomplete.tmp'),'secret partial');
  function snapshot(root:string):any { return readdirSync(root).sort().map(n=>{ const p=join(root,n),s=statSync(p); return [n,s.mtimeMs,s.isDirectory()?snapshot(p):readFileSync(p,'utf8')]; }); }
  const before=snapshot(d);
  assert.equal(exportEvents(d,{project:'owner/repo',ticket:'1',since:'2026-01-15T00:00:00Z'}).events.length,1);
  assert.deepEqual(snapshot(d),before);
  assert.equal(exportEvents(join(d,'missing')).events.length,0); assert.equal(existsSync(join(d,'missing')),false);
  assert.throws(()=>exportEvents(d,{ticket:'1'}));
  for(const bad of ['yesterday','2026-02-30T00:00:00Z','2026-01-01','2026-01-01T24:00:00Z']) assert.equal(validTime(bad),false);
  let ended = false;
  const writing = child(`import {appendEvent} from ${JSON.stringify(moduleURL)}; for(let n=0;n<20;n++) appendEvent(${JSON.stringify(d)},{...${JSON.stringify(payload())},eventId:'concurrent-'+n},{waitMs:10000});`).finally(() => { ended = true; });
  while (!ended) {
    assert.deepEqual(exportEvents(d).diagnostics, []);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  await writing;
  assert.deepEqual(exportEvents(d).diagnostics,[]);
});

test('clock rollback never reorders a stream and cross-stream merge remains deterministic', t => {
  const d = fixture(t);
  const first = appendEvent(d, payload()), second = appendEvent(d, payload());
  const path = join(eventFiles(d), `${String(second.sequence).padStart(12, '0')}-${second.eventId}.json`);
  writeFileSync(path, JSON.stringify({ ...second, recordedAt: '2020-01-01T00:00:00Z' }));
  appendEvent(d, payload({ project: 'other/repo' }));
  const report = exportEvents(d);
  assert.deepEqual(report.events.filter(e => e.streamKey === first.streamKey).map(e => e.sequence), [1, 2]);
  assert.deepEqual(exportEvents(d), report);
});

test('corrupt, unsupported, foreign and sequence-anomalous data are diagnosed, not overwritten', t => {
  for(const kind of ['corrupt','version','foreign','sequence']) {
    const d=fixture(t), e=appendEvent(d,payload()); const folder=eventFiles(d), name=readdirSync(folder).find(n=>n.endsWith('.json'))!;
    if(kind==='corrupt') writeFileSync(join(folder,name),'credential-like broken JSON');
    else { const patch=kind==='version'?{version:99}:kind==='foreign'?{project:'foreign/repo'}:{sequence:2}; writeFileSync(join(folder,name),JSON.stringify({...e,...patch})); }
    const r=exportEvents(d); assert.ok(r.diagnostics.length); assert.equal(r.events.length,0);
    assert.throws(()=>appendEvent(d,payload()));
    assert.doesNotMatch(JSON.stringify(r),/credential-like|foreign\/repo/);
  }
});

test('observations wait until authoritative locks are released, including a later authoritative error', t => {
  const d=fixture(t);
  assert.throws(()=>withAdmission(d,()=>{
    observeRun(d,{}, {project:'owner/repo',iid:'1',stage:'setup',executionId:'one',updatedAt:at});
    assert.equal(existsSync(join(d,'telemetry')),false);
    afterAdmission(()=>assert.equal(existsSync(join(d,'admission','lock')),false));
    throw Error('after persisted mutation');
  }));
  assert.equal(exportEvents(d).events.length,2);
});

test('persisted run transitions preserve normal/recovery identities, avoid heartbeat duplicates and reconcile crashes', t => {
  const d=fixture(t);
  const a=claimRun({dir:d,project:'owner/repo',iid:'1',pid:process.pid,cap:3}); assert.equal(a.ok,true); if(!a.ok)return;
  const r=a.run; writeRecord(d,'owner_repo--1',{...r,updatedAt:at});
  writeRecord(d,'owner_repo--1',{...r,stage:'waiting',note:'raw secret',queueReasons:[{code:'dependency-unknown',text:'secret comment'}],updatedAt:at});
  const parked={...r,stage:'waiting' as const,note:'second raw secret',updatedAt:at};
  writeRecord(d,'owner_repo--1',parked); writeRecord(d,'owner_repo--1',parked);
  writeRecord(d,'owner_repo--1',{...r,recovery:{attempt:1,id:'attempt-one'},stage:'setup',updatedAt:at});
  writeRecord(d,'owner_repo--1',{...r,recovery:{attempt:1,id:'attempt-one'},stage:'verifying',pid:2147483647,starting:undefined,updatedAt:at});
  readRuns(d);
  const events=exportEvents(d).events;
  assert.equal(events.filter(e=>e.eventKind==='execution-admitted').length,1);
  assert.equal(events.filter(e=>e.eventKind==='recovery-admitted').length,1);
  assert.equal(events.filter(e=>e.eventKind==='parked-reason-changed').length,1);
  assert.ok(events.some(e=>e.origin==='reconciliation' && e.reasonCode==='process-exited'));
  assert.ok(events.every(e=>e.executionId===r.executionId));
  assert.doesNotMatch(JSON.stringify(events),/secret/);
});

test('fresh normal admissions keep original verdict/evidence but get new identities, not stale repair identities', t => {
  const d = fixture(t);
  const first = claimRun({ dir: d, project: 'owner/repo', iid: '1', pid: 2147483647, cap: 3,
    patch: { stage: 'stopped', verdict: 'FAIL', evidenceDir: '/synthetic/evidence' } });
  assert.equal(first.ok, true); if (!first.ok) return;
  writeRecord(d, 'owner_repo--1', { ...first.run, recovery: { attempt: 1, id: 'old-repair' } });
  const second = claimRun({ dir: d, project: 'owner/repo', iid: '1', pid: process.pid, cap: 3 });
  assert.equal(second.ok, true); if (!second.ok) return;
  assert.notEqual(first.run.executionId, second.run.executionId);
  assert.equal(second.run.recovery, undefined);
  assert.equal(second.run.verdict, 'FAIL'); assert.equal(second.run.evidenceDir, '/synthetic/evidence');
  assert.equal(exportEvents(d).events.filter(e => e.eventKind === 'execution-admitted').length, 2);
});

test('invalid legacy observation metadata or diagnostic failure cannot change a persisted writer result', t => {
  const d = fixture(t); t.mock.method(console, 'warn', () => { throw Error('diagnostic unavailable'); });
  assert.doesNotThrow(() => writeRecord(d, 'owner_repo--1', { project: 'owner/repo', iid: '1', stage: 'waiting', updatedAt: at,
    queueReasons: 'malformed legacy data' } as any));
  assert.equal(JSON.parse(readFileSync(join(d, 'owner_repo--1.json'), 'utf8')).stage, 'waiting');
});

test('supervisor telemetry attributes bounded IDs and known/unknown usage, never approval/activity as progress', t => {
  const d = fixture(t), hash = 'a'.repeat(64);
  const event = payload({ eventKind: 'supervisor-observed', from: undefined, to: 'observe', supervisor: { projectId: hash, incidentId: hash, proposalId: hash, hostOutcomeId: hash, outcome: 'observed', usage: null, intervention: false } });
  appendEvent(d,event);
  appendEvent(d,payload({ eventKind: 'supervisor-observed', from: undefined, to: 'review-complete', supervisor: { projectId: hash, incidentId: hash, proposalId: hash, reviewId: hash, hostOutcomeId: hash, outcome: 'approved', role: 'review', usage: { tokens: 15, cost: 123 }, intervention: false } }));
  appendEvent(d,payload({ eventKind: 'supervisor-observed', from: undefined, to: 'resolve-human', supervisor: { projectId: hash, incidentId: hash, hostOutcomeId: hash, outcome: 'resolved', usage: null, intervention: true } }));
  const events = exportEvents(d).events;
  assert.equal(events[0].supervisor!.usage,null);
  assert.deepEqual(events[1].supervisor!.usage,{tokens:15,cost:123});
  const metrics = supervisorOutcomeMetrics(events,[{ticket:1,kind:'agent-activity',at:'2026-01-01T00:01:00.000Z'}]);
  assert.equal(metrics.observedInterventions,1); assert.equal(metrics.incidents[0].timeToConfirmedProgressMs,null);
  const retained = Array.from({length:260},(_,i) => ({ ...events[0], supervisor: { ...events[0].supervisor!, incidentId:i.toString(16).padStart(64,'0'), outcome:'refused' as const } }));
  assert.equal(supervisorOutcomeMetrics(retained,[]).incidents.length,128);
  assert.equal(supervisorOutcomeMetrics(retained,[],128).pagination.collections.incidents.after,4);
  assert.equal(supervisorOutcomeMetrics(retained,[],256).refusedActions.length,4);
  assert.equal(supervisorOutcomeMetrics(events,[{ticket:2,kind:'host-confirmed-merge',at:'2026-01-01T00:01:00.000Z'}]).incidents[0].timeToConfirmedProgressMs,null);
  assert.equal(supervisorOutcomeMetrics(events,[{ticket:1,kind:'host-confirmed-merge',at:'2026-01-01T00:01:00.000Z'}]).incidents[0].timeToConfirmedProgressMs,60000);
  for (const usage of [{tokens:-1,cost:0},{tokens:0,cost:Infinity},{tokens:0,cost:0,secret:'no'}]) assert.throws(() => appendEvent(d,{...event,eventId:randomUUID(),supervisor:{...event.supervisor!,usage}}),/Invalid supervisor/);
  assert.throws(() => appendEvent(d,{...event,eventId:randomUUID(),supervisor:{...event.supervisor!,proposalId:'token=secret'}}),/Invalid supervisor/);
});

test('recorder failure after normal admission leaves ownership, generation, stage and result unchanged', t => {
  const d=fixture(t); writeFileSync(join(d,'telemetry'),'not a directory');
  const r=claimRun({dir:d,project:'owner/repo',iid:'1',pid:process.pid,cap:1}); assert.equal(r.ok,true);
  assert.equal(readRuns(d,false)[0].stage,'setup');
  assert.equal(claimRun({dir:d,project:'other/repo',iid:'2',pid:process.pid,cap:1}).ok,false);
});
