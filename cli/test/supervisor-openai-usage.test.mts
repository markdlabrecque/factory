// Cheap raw-accounting permutations, one private persistence/journal boundary. All provider metadata is synthetic; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, chmodSync, symlinkSync, linkSync, lstatSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { providerUsage, captureProviderEvidence, persistProviderUsage, readProviderUsage, providerResources } from '../src/supervisor-openai-usage.mts';
import { SUBSCRIPTION_PROFILE_ID, validateProviderUsageReceipt } from '../src/supervisor-advisory-contract.mts';
import { commitSupervisor, authorizeAdvisorySend, readSupervisor } from '../src/supervisor-state.mts';
import { ownerOf, withAdmissionLock } from '../../board/admission.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { usageFixture } from './supervisor-usage-fixture.mts';
test('subscription known usage remains known over both soft output and cumulative admission targets; API invoice is not applicable', () => {
  const f = usageFixture(undefined,undefined,SUBSCRIPTION_PROFILE_ID), u=f.raw.terminal.response.usage;
  assert.equal(f.g.reserved.cost,0);
  const known=providerUsage(f.g,f.a,f.raw);
  assert.deepEqual(known.resources,{tokens:35,cost:0});
  assert.equal(known.costKind,'subscription-api-invoice-not-applicable');
  u.output_tokens=2_000_000; u.total_tokens=u.input_tokens+u.output_tokens;
  const over=providerUsage(f.g,f.a,f.raw);
  assert.equal(over.state,'known'); assert.equal(over.resources!.tokens,2_000_025);
  assert.equal(over.usage!.reasoning,8); assert.equal(over.cachePolicy,'provider-managed');
  delete (u as any).output_tokens;
  const unknown=providerUsage(f.g,f.a,f.raw);
  assert.equal(unknown.state,'unknown');assert.equal(unknown.resources,null);assert.equal(unknown.costKind,null);
});
test('raw explicit counters, not normalized Pi defaults, establish known conservative derived resources', () => {
  const f = usageFixture(), r = providerUsage(f.g,f.a,f.raw);
  assert.equal(r.state,'known'); assert.deepEqual(r.resources,{ tokens: 35, cost: 220 }); assert.equal(r.usage!.reasoning,8);
  assert.equal(r.costKind,'derived-upper-micro-usd'); assert.equal(r.price,'terra-standard-2026-11-17-v1');
  assert.equal(r.serviceTier,'default'); assert.equal(r.cachePolicy,'explicit-unmarked');
  assert.equal(JSON.stringify(f.raw).includes('Not a valid diagnosis'),false, 'raw retention excludes text/output');
  assert.equal(JSON.stringify(f.raw).includes('999999'),false, 'normalized Pi counters are not evidence');
  const zero = structuredClone(f.raw); zero.terminal.response.usage.output_tokens = 0; zero.terminal.response.usage.output_tokens_details.reasoning_tokens = 0;
  zero.terminal.response.usage.total_tokens = 25; assert.deepEqual(providerUsage(f.g,f.a,zero).resources,{tokens:25,cost:138});
  const cached = structuredClone(f.raw); cached.terminal.response.usage.input_tokens_details.cached_tokens = 5;
  assert.equal(providerUsage(f.g,f.a,cached).state,'known'); assert.equal(providerUsage(f.g,f.a,cached).resources!.cost,220, 'upper profile charge does not claim actual discounted invoice');
  assert.equal(Object.hasOwn(f.raw.terminal.response.usage.input_tokens_details,'cache_write_tokens_details'),false);
  const retention = structuredClone(f.raw); retention.terminal.response.usage.input_tokens_details.cache_write_tokens_details = { ttl_30m_tokens:0,ttl_12h_tokens:0 };
  assert.equal(providerUsage(f.g,f.a,retention).state,'known', 'optional retention breakdown agrees with explicit write=0');
});
test('missing, inconsistent, unsafe and over-reservation counters remain unknown, never known zero', () => {
  const f = usageFixture();
  const mutations = [
    (u: any) => { delete u.input_tokens; }, (u: any) => { u.input_tokens = 0; }, (u: any) => { delete u.input_tokens_details.cached_tokens; },
    (u: any) => { delete u.input_tokens_details.cache_write_tokens; }, (u: any) => { u.input_tokens_details.cache_write_tokens = 1; },
    (u: any) => { u.input_tokens_details.cached_tokens = 26; }, (u: any) => { u.input_tokens_details.cache_write_tokens_details = { ttl_30m_tokens:1,ttl_12h_tokens:0 }; },
    (u: any) => { u.total_tokens = 34; }, (u: any) => { delete u.output_tokens_details.reasoning_tokens; },
    (u: any) => { u.output_tokens_details.reasoning_tokens = 11; }, (u: any) => { u.output_tokens = -1; },
    (u: any) => { u.input_tokens = 1_050_001; u.total_tokens = u.input_tokens + u.output_tokens; },
    (u: any) => { u.output_tokens = 4097; u.total_tokens = u.input_tokens + u.output_tokens; },
    (u: any) => { u.output_tokens = Number.MAX_SAFE_INTEGER; u.total_tokens = u.output_tokens + 25; },
    (u: any) => { u.output_tokens = 1.2; }, (u: any) => { u.extra_charge_tokens = 1; },
    (u: any) => { u.input_tokens_details.cache_write_tokens_details = {}; }, (u: any) => { u.output_tokens_details = {}; },
  ];
  for (const mutate of mutations) {
    const raw = structuredClone(f.raw); mutate(raw.terminal.response.usage); const r = providerUsage(f.g,f.a,raw);
    assert.equal(r.state,'unknown'); assert.equal(r.resources,null); assert.equal(r.usage,null); assert.equal(r.costKind,null);
  }
});
test('exact association, stream completeness, terminal status and service policy are independent of advice validity', () => {
  const f = usageFixture();
  for (const mutate of [
    (r:any) => {r.grantId='b'.repeat(64);}, (r:any) => {r.authorization='b'.repeat(64);}, (r:any) => {r.response=null;},
    (r:any) => {r.response.requestId=null;}, (r:any) => {r.terminal.response.id='foreign';},
    (r:any) => {r.terminal.response.model='other';}, (r:any) => {r.terminal.response.service_tier='priority';},
    (r:any) => {r.streamComplete=false;}, (r:any) => {r.terminalProblem='ambiguous';}, (r:any) => {r.terminal=null;},
    (r:any) => {r.terminal.type='response.incomplete';}, (r:any) => {r.version=2;},
  ]) { const raw=structuredClone(f.raw); mutate(raw); assert.equal(providerUsage(f.g,f.a,raw).state,'unknown'); }
  const incomplete=structuredClone(f.raw); incomplete.terminal.type='response.incomplete'; incomplete.terminal.response.status='incomplete';
  incomplete.terminal.response.incomplete_details={reason:'max_output_tokens'};
  const truncated=providerUsage(f.g,f.a,incomplete); assert.equal(truncated.state,'known'); assert.equal(truncated.terminalStatus,'incomplete');
  const failed=structuredClone(f.raw); failed.terminal.type='response.failed'; failed.terminal.response.status='failed';
  const failure=providerUsage(f.g,f.a,failed); assert.equal(failure.state,'unknown'); assert.equal(failure.terminalStatus,'failed');
  const r=providerUsage(f.g,f.a,f.raw); for(const delta of [{price:'unknown'},{resources:{tokens:35,cost:1}},{rawHash:'b'.repeat(64)},{usage:null}])
    assert.throws(()=>validateProviderUsageReceipt({...r,...delta},f.g,f.a));
  const ambiguous=captureProviderEvidence({...f.result,terminalProblem:'duplicate'}); assert.equal(providerUsage(f.g,f.a,ambiguous).resources,null);
});
test('one atomic private raw/scalar publication reopens idempotently, rejects corruption/links and never alters charges', async t => {
  const root=mkdtempSync(join(tmpdir(),'factory-provider-usage-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  const projectRoot=join(root,'project'), stateDir=join(root,'state'); mkdirSync(projectRoot,{mode:0o700}); mkdirSync(stateDir,{mode:0o700});
  const child=spawn(process.execPath,['-e','process.on("message",()=>process.exit(0));process.send("ready");'],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:'/usr/bin:/bin',HOME:root}}), closed=once(child,'close');
  try {
    await once(child,'message'); const f=usageFixture(ownerOf(child.pid!),projectRoot), owner=ownerOf(process.pid), g=f.g;
    const reservation={id:g.invocationId,incidentId:g.incidentId,kind:'diagnosis' as const,owner,fence:g.fence,at:f.at,deadline:g.deadline,
      reserved:g.reserved,actual:null,state:'active' as const,reviewId:null};
    let s=commitSupervisor(stateDir,g.project,0,{id:'observe',at:f.at,kind:'observe',facts:f.facts,snapshotHash:f.h,reason:'synthetic frozen originals'});
    s=commitSupervisor(stateDir,g.project,s.revision,{id:'reserve',at:f.at,kind:'reserve-advisory',reservation,policy:f.registration,controls:f.controls,
      limits:{project:{tokens:10_000_000,cost:100_000_000},shared:{tokens:10_000_000,cost:100_000_000},capacity:1,reviewCalls:5,reviewTimeoutMs:600_000}});
    s=commitSupervisor(stateDir,g.project,s.revision,{id:'register',at:f.at,kind:'register-advisory-worker',reservationId:g.invocationId,fence:g.fence,owner,grant:g});
    const a=authorizeAdvisorySend(stateDir,g.project,s.revision,{at:f.at,reservationId:g.invocationId,fence:g.fence,grantId:g.id,worker:g.owner,payload:f.h,policy:f.registration,controls:f.controls});
    assert.deepEqual(a,f.a); const before=readSupervisor(stateDir,g.project);
    assert.equal(providerResources(stateDir,g,a),null); assert.equal(readProviderUsage(stateDir,g,a).state,'unknown');
    assert.equal(existsSync(join(stateDir,'supervisor/usage')),false,'read does not create private evidence directories');
    const expected=join(stateDir,'supervisor/usage',supervisorHash(g.project),supervisorHash(g.invocationId),'terminal.json');
    const originalSync=fs.fsyncSync, stateInode=lstatSync(stateDir).ino;
    fs.fsyncSync=((fd:any)=>{ const st=fs.fstatSync(fd); if(st.isDirectory() && st.ino===stateInode) throw Object.assign(Error('injected ancestor fsync failure'),{code:'EIO'}); return originalSync(fd); }) as any;
    syncBuiltinESMExports();
    try { assert.throws(()=>persistProviderUsage(stateDir,g,a,f.raw),/ancestor fsync/); assert.equal(existsSync(expected),false,'new containing entries must sync before publication'); }
    finally { fs.fsyncSync=originalSync; syncBuiltinESMExports(); }
    fs.fsyncSync=((fd:any)=>{ if(fs.fstatSync(fd).isDirectory() && existsSync(expected)) throw Object.assign(Error('injected directory fsync failure'),{code:'EIO'}); return originalSync(fd); }) as any;
    syncBuiltinESMExports();
    try {
      assert.throws(()=>persistProviderUsage(stateDir,g,a,f.raw),/fsync failure/);
      assert.equal(existsSync(expected),true,'rename visibility is not successful durability');
      assert.equal(providerResources(stateDir,g,a),null,'directory sync failure cannot yield known resources');
    } finally { fs.fsyncSync=originalSync; syncBuiltinESMExports(); }
    const {file,receipt}=persistProviderUsage(stateDir,g,a,f.raw), original=readFileSync(file,'utf8');
    assert.equal(receipt.state,'known'); assert.equal(lstatSync(file).mode&0o777,0o600); assert.deepEqual(providerResources(stateDir,g,a),{tokens:35,cost:220});
    assert.deepEqual(persistProviderUsage(stateDir,g,a,f.raw).receipt,receipt); assert.equal(readFileSync(file,'utf8'),original);
    let retainedWriter:any;
    withAdmissionLock(dirname(file),write=>{
      retainedWriter=write; assert.throws(()=>write(join(projectRoot,'outside'),original),/lock scope/);
      const changed=join(dirname(file),'namespace-change'); mkdirSync(changed,{mode:0o700});
      assert.throws(()=>write(file,original),/lock scope/,'prepared writer rejects a changed namespace'); rmSync(changed,{recursive:true});
    });
    assert.throws(()=>retainedWriter(file,original),/lock scope/,'writer lease ends with the synchronous lock');
    assert.equal(readFileSync(file,'utf8'),original); assert.deepEqual(readdirSync(projectRoot),[]);
    const lockDir=join(dirname(file),'admission'); rmSync(lockDir,{recursive:true}); symlinkSync(projectRoot,lockDir,'dir');
    assert.throws(()=>persistProviderUsage(stateDir,g,a,f.raw),/lock directory/); assert.deepEqual(readdirSync(projectRoot),[],'unsafe lock path writes nothing into project');
    rmSync(lockDir); mkdirSync(lockDir,{mode:0o700});
    const other=structuredClone(f.raw); other.terminal.response.usage.total_tokens=34;
    assert.throws(()=>persistProviderUsage(stateDir,g,a,other),/differs/); assert.equal(readFileSync(file,'utf8'),original);
    writeFileSync(file,'{bad'); assert.equal(providerResources(stateDir,g,a),null); assert.throws(()=>persistProviderUsage(stateDir,g,a,f.raw)); assert.equal(readFileSync(file,'utf8'),'{bad');
    for (const mutate of [(r:any)=>{r.raw.terminal.response.usage.total_tokens=34;}, (r:any)=>{r.receipt.resources.cost=1;}]) {
      const corrupted=JSON.parse(original); mutate(corrupted); writeFileSync(file,JSON.stringify(corrupted));
      assert.equal(providerResources(stateDir,g,a),null); assert.throws(()=>persistProviderUsage(stateDir,g,a,f.raw));
    }
    writeFileSync(file,Buffer.alloc(90_000,32)); assert.equal(providerResources(stateDir,g,a),null); assert.throws(()=>persistProviderUsage(stateDir,g,a,f.raw));
    writeFileSync(file,original); chmodSync(file,0o644); assert.equal(providerResources(stateDir,g,a),null); chmodSync(file,0o600);
    const link=join(root,'hardlink'); linkSync(file,link); assert.equal(providerResources(stateDir,g,a),null); rmSync(link);
    const folder=dirname(file), saved=folder+'-saved'; renameSync(folder,saved); symlinkSync(saved,folder,'dir');
    assert.equal(providerResources(stateDir,g,a),null); assert.throws(()=>persistProviderUsage(stateDir,g,a,f.raw)); rmSync(folder); renameSync(saved,folder);
    rmSync(file); symlinkSync(join(root,'missing'),file); assert.equal(providerResources(stateDir,g,a),null);
    assert.throws(()=>persistProviderUsage(stateDir,g,a,f.raw)); assert.equal(lstatSync(file).isSymbolicLink(),true); rmSync(file);
    const unknown=persistProviderUsage(stateDir,g,a,other); assert.equal(unknown.receipt.state,'unknown'); assert.equal(providerResources(stateDir,g,a),null);
    assert.deepEqual(readSupervisor(stateDir,g.project),before,'receipt writes do not refund, release, finish, notify or authorize');
    assert.equal(Object.values(before.reservations)[0].state,'active'); assert.equal(before.charged.diagnosis.cost,g.reserved.cost);
    assert.equal(supervisorHash(receipt.usage),supervisorHash({input:25,cacheRead:0,cacheWrite:0,output:10,reasoning:8,total:35}));
  } finally { if(child.connected) child.send('exit',()=>{}); await closed; }
});
