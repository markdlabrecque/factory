// Offline explicit-control and read-only export tests. All projects, auth-shaped data and backends are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportEvents, startAction, streamKey } from '../../board/execution-events.mts';
import { writeRecord, markMergedOutside, setProject } from '../../board/board.mts';
import { populateCopiedWorkflow } from './copied-workflow-fixture.mts';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { retry } from '../src/commands/retry.mts';
import { ticketArchive, ticketComment, ticketShow, ticketSync, ticketVerdict } from '../src/commands/ticket.mts';
import { recovery } from '../src/commands/recovery.mts';
import { schedule, stopScheduling } from '../src/commands/schedule.mts';
import { setProjectSchedule } from '../src/schedule.mts';
import { telemetry } from '../src/commands/telemetry.mts';
import { update } from '../src/commands/update.mts';
import { saveManifest } from '../src/manifest.mts';
import { appRoot, buildAssets, writeScaffold } from '../src/scaffold.mts';
import { projectFixture } from './workflow-fixture.mts';
import { recordReview } from '../src/recovery-review.mts';
import type { ScheduleBackend } from '../src/platform/scheduler.mts';
const at = '2026-01-01T00:00:00.000Z';
const secret = 'ghp_CREDENTIAL_COMMENT_PROMPT_ERROR_DO_NOT_EXPORT';
function fakeBackend(): ScheduleBackend {
  let enabled = false;
  return { files: [], logHint: '', async install(){}, async enable(){ enabled = true; }, async disable(){ enabled = false; },
    async status(){ return {timer: enabled ? 'active' : 'inactive',tick:'inactive',enabled}; }, async timers(){return [];}, async remove(){} };
}
function fixture(t: any) {
  const home=mkdtempSync(join(tmpdir(),'factory-telemetry-')), p=paths(home), root=join(home,'project');
  const saved=process.env.SANDCASTLE_STATE_DIR; delete process.env.SANDCASTLE_STATE_DIR;
  t.after(()=>{ if(saved===undefined)delete process.env.SANDCASTLE_STATE_DIR;else process.env.SANDCASTLE_STATE_DIR=saved; rmSync(home,{recursive:true,force:true}); });
  mkdirSync(root); execFileSync('git',['init','-qb','main'],{cwd:root});
  execFileSync('git',['-c','user.name=t','-c','user.email=t@t','commit','-qm','init','--allow-empty'],{cwd:root});
  writeScaffold(root,buildAssets({profile:'personal',repo:'owner/repo',image:'fake'},p.state));
  projectFixture(p,root);
  addProject(p,root); mkdirSync(p.state,{recursive:true});
  t.mock.method(console,'log',()=>{}); t.mock.method(console,'error',()=>{}); t.mock.method(console,'warn',()=>{});
  const run=(stage: any='done')=>writeRecord(p.state,'owner_repo--1',{iid:'1',project:'owner/repo',stage,pid:process.pid,startedAt:at,stageSince:at,updatedAt:at,executionId:'execution-one',verdict:'FAIL',note:secret});
  const controls=()=>exportEvents(p.state).events.filter(e=>e.eventKind.startsWith('action-'));
  return {home,p,root,run,controls,o:{cwd:root},sc:join(root,'.sandcastle')};
}
const posted = () => ({status:0,stdout:'{"id":1}',stderr:''});
function pairs(events: ReturnType<typeof exportEvents>['events']) {
  for(const e of events.filter(e=>e.eventKind==='action-requested')) {
    const result=events.filter(r=>r.operationId===e.operationId && r.eventKind==='action-result');
    assert.equal(result.length,1); assert.equal(result[0].action,e.action);
    assert.equal(e.actorIdentity,'unknown'); assert.equal(result[0].actorIdentity,'unknown');
  }
}
function snapshot(dir:string):any {
  return readdirSync(dir).sort().map(n=>{const p=join(dir,n),s=statSync(p);return [n,s.mtimeMs,s.isDirectory()?snapshot(p):readFileSync(p).toString('base64')];});
}

test('explicit retry changed, refused and no-op results preserve command behavior', async t=>{
  const f=fixture(t); f.run('stopped'); await retry(f.p,'1',f.o);
  await assert.rejects(retry(f.p,'1',f.o),/No run record/);
  f.run('waiting'); await assert.rejects(retry(f.p,'1',f.o),/Only a stopped/);
  const events=f.controls(); pairs(events);
  assert.deepEqual(events.filter(e=>e.eventKind==='action-result').map(e=>e.result),['changed','no-op','refused']);
  assert.doesNotMatch(JSON.stringify(events),new RegExp(secret));
});

test('comment/verdict/archive/restore record metadata, no-op and failed delivery without exporting user content',t=>{
  const f=fixture(t); f.run(); const before=readFileSync(join(f.p.state,'owner_repo--1.json'),'utf8');
  assert.equal(ticketComment(f.p,'1',[secret],{...f.o,actor:secret,exec:posted}),0);
  assert.equal(ticketVerdict(f.p,'1',{...f.o,verdict:'pass',message:secret,actor:secret,exec:posted}),0);
  assert.equal(ticketArchive(f.p,'1',true,f.o),0); assert.equal(ticketArchive(f.p,'1',true,f.o),0);
  assert.equal(ticketArchive(f.p,'1',false,f.o),0);
  assert.equal(ticketComment(f.p,'2',[secret],{...f.o,exec:()=>({status:1,stdout:'',stderr:secret})}),1);
  const events=f.controls(); pairs(events);
  assert.deepEqual(events.filter(e=>e.eventKind==='action-result').map(e=>[e.action,e.result]),[
    ['ticket-comment','changed'],['ticket-verdict','changed'],['ticket-archive','changed'],['ticket-archive','no-op'],['ticket-restore','changed'],['ticket-comment','failed']]);
  assert.doesNotMatch(JSON.stringify(exportEvents(f.p.state)),new RegExp(secret));
  assert.equal(readFileSync(join(f.p.state,'owner_repo--1.json'),'utf8'),before,'original verdict/evidence record is not rewritten');
  const count=f.controls().length; ticketShow(f.p,'1',f.o); ticketSync(f.p,'1',{...f.o,exec:posted});
  assert.equal(f.controls().length,count,'read-only and sync helper paths are not explicit controls');
  f.run('waiting'); assert.throws(()=>ticketArchive(f.p,'1',true,f.o));
  assert.equal(f.controls().at(-1)?.result,'refused');
});

test('only reset and review --confirm emit controls, including missing-workflow refusal',async t=>{
  const f=fixture(t); recordReview(f.p,f.root,{by:'init'});
  await recovery(f.p,'status',f.o); await recovery(f.p,'review',f.o); assert.equal(f.controls().length,0);
  assert.equal(await recovery(f.p,'review',{...f.o,confirm:true}),0);
  assert.equal(await recovery(f.p,'reset',f.o),0);
  rmSync(join(f.root,'.factory-workflow/execution-events.mts'));
  assert.equal(await recovery(f.p,'review',{...f.o,confirm:true}),1);
  pairs(f.controls()); assert.deepEqual(f.controls().filter(e=>e.result).map(e=>[e.action,e.result]),[['recovery-review','changed'],['recovery-reset','changed'],['recovery-review','refused']]);
});

test('explicit schedule global/project on/off pairs exclude shared automatic helpers',async t=>{
  const f=fixture(t), b=fakeBackend();
  // Local refs only. No fetch, remote service or process supervisor.
  execFileSync('git',['remote','add','origin','https://invalid.test/no-network'],{cwd:f.root});
  execFileSync('git',['update-ref','refs/remotes/origin/main','HEAD'],{cwd:f.root});
  saveManifest(f.p,{version:1,installedAt:at,platform:process.platform,entries:[]});
  await schedule(f.p,b,'on',{}); await schedule(f.p,b,'off',{}); await schedule(f.p,b,'off',{});
  await schedule(f.p,b,'on',{project:'project'}); await schedule(f.p,b,'on',{project:'project'}); await schedule(f.p,b,'off',{project:'project'});
  pairs(f.controls()); assert.deepEqual(f.controls().filter(e=>e.result).map(e=>e.result),['changed','changed','no-op','changed','no-op','changed']);
  const count=f.controls().length;
  await stopScheduling(b,f.p); setProjectSchedule(f.p,f.root,false); await schedule(f.p,b,'status',{});
  assert.equal(f.controls().length,count);
  b.disable=async()=>{throw Error(secret);}; await assert.rejects(schedule(f.p,b,'off',{}));
  assert.equal(f.controls().at(-1)?.result,'failed');
  assert.doesNotMatch(JSON.stringify(f.controls()),new RegExp(secret));
});

test('update --apply no-op controls do not turn dry-run or scaffold helpers into operator actions',t=>{
  const f=fixture(t); addProject(f.p,f.root);
  update(f.p,{...f.o,dryRun:true,app:appRoot}); assert.equal(f.controls().length,0);
  rmSync(join(f.sc,'execution-events.mts'));
  update(f.p,{...f.o,apply:true,app:appRoot}); update(f.p,{...f.o,apply:true,app:appRoot});
  pairs(f.controls()); assert.deepEqual(f.controls().filter(e=>e.result).map(e=>e.result),['no-op','no-op']);
  assert.equal(existsSync(join(f.sc,'execution-events.mts')),false);
});

test('an interrupted request has unknown outcome, CLI/board origin never establishes a human',t=>{
  const f=fixture(t);
  startAction(f.p.state,{project:'owner/repo',ticket:'1'},'retry');
  startAction(f.p.state,{project:'owner/repo',ticket:'2'},'ticket-archive','board');
  assert.equal(f.controls().length,2); assert.ok(f.controls().every(e=>e.result===undefined && e.actorIdentity==='unknown'));
});

test('recorder failure cannot change explicit command success, refusal, cleanup helper or failed exit behavior',async t=>{
  const f=fixture(t); writeFileSync(join(f.p.state,'telemetry'),'broken');
  f.run('stopped'); await retry(f.p,'1',f.o); await assert.rejects(retry(f.p,'1',f.o));
  assert.equal(await recovery(f.p,'reset',f.o),0);
  assert.equal(ticketComment(f.p,'2',[secret],{...f.o,exec:()=>({status:1,stdout:'',stderr:secret})}),1);
  await stopScheduling(fakeBackend(),f.p);
  assert.equal(existsSync(join(f.p.state,'owner_repo--1.json')),false);
});

test('outside merge and changed-requirements observations do not fabricate control actions or legacy execution IDs',t=>{
  const f=fixture(t); f.run('waiting'); setProject('owner/repo');
  const cwd = process.cwd(); process.chdir(f.root);
  process.env.SANDCASTLE_STATE_DIR = f.p.state;
  try { assert.equal(markMergedOutside('1','waiting',{number:3,url:'https://invalid.test/pr/3',mergedAt:at,matchedBy:'branch'},f.p.state),true); }
  finally { process.chdir(cwd); delete process.env.SANDCASTLE_STATE_DIR; }
  writeRecord(f.p.state,'owner_repo--3',{iid:'3',project:'owner/repo',stage:'waiting',pid:process.pid,startedAt:at,stageSince:at,updatedAt:at,queueReasons:[{code:'requirements-changed',text:secret}]});
  const report=exportEvents(f.p.state); assert.equal(f.controls().length,0);
  assert.equal(report.coverage,'observed-only'); assert.ok(report.identityGaps>0);
  assert.ok(report.events.some(e=>e.reasonCode==='merged')); assert.ok(report.events.some(e=>e.reasonCode==='requirements-changed' && e.executionId===undefined));
});

test('JSON/JSONL schema, filters, missing history and corrupt data retain read-only parseable diagnostics',t=>{
  const f=fixture(t); f.run(); const lines:string[]=[]; t.mock.method(console,'log',(s:string)=>lines.push(s));
  const before=snapshot(f.home);
  assert.equal(telemetry(f.p,'export'),0); const jsonl=lines.splice(0).map(s=>JSON.parse(s));
  assert.equal(jsonl[0].type,'metadata'); assert.equal(jsonl[0].coverage,'observed-only'); assert.equal(jsonl[1].type,'event');
  assert.equal(telemetry(f.p,'export',{project:'project',ticket:'1',format:'json',since:at}),0);
  const json=JSON.parse(lines.pop()!); assert.equal(json.version,1); assert.equal(json.events.length,2);
  assert.deepEqual(snapshot(f.home),before);
  for(const o of [{ticket:'1'},{project:'missing',ticket:'0'},{since:'2026-02-30T00:00:00Z'},{format:'csv'}]) assert.throws(()=>telemetry(f.p,'export',o));
  assert.deepEqual(snapshot(f.home),before,'invalid arguments have no filesystem effects');
  const folder=join(f.p.state,'telemetry',streamKey('owner/repo','1'));
  writeFileSync(join(folder,'broken.json'),secret);
  assert.equal(telemetry(f.p,'export',{format:'json'}),1); const damaged=JSON.parse(lines.pop()!);
  assert.ok(damaged.diagnostics.length); assert.equal(damaged.events.length,2); assert.doesNotMatch(JSON.stringify(damaged),new RegExp(secret));
  rmSync(join(f.p.state,'telemetry'),{recursive:true});
  assert.equal(telemetry(f.p,'export',{format:'json'}),0); assert.equal(JSON.parse(lines.pop()!).events.length,0);
  assert.equal(existsSync(join(f.p.state,'telemetry')),false);
});

test('real CLI parses telemetry without contacting projects, services, auth or a tracker',t=>{
  const f=fixture(t); f.run();
  const env={...process.env,FACTORY_HOME:f.home,SANDCASTLE_STATE_DIR:f.p.state};
  const invoke=(...args:string[])=>spawnSync(process.execPath,[new URL('../bin/factory.mts',import.meta.url).pathname,'telemetry','export',...args],{env,encoding:'utf8'});
  const a=invoke(); assert.equal(a.status,0,a.stderr); assert.equal(JSON.parse(a.stdout.split('\n')[0]).type,'metadata');
  const b=invoke('--project','project','--ticket','1','--format','json'); assert.equal(b.status,0,b.stderr); assert.equal(JSON.parse(b.stdout).events.length,2);
  for(const args of [['--ticket','1'],['--format','no'],['--since','tomorrow'],['extra']]) assert.equal(invoke(...args).status,1);
});
