// Pure lifecycle evidence permutations plus one disposable real process boundary; HTTP/auth/host exclusion are synthetic, never installed authority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, chmodSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processIdentity, validateProcessEvidence, groupAbsent, confirmOwnedCleanup, readOwnedProcess } from '../src/supervisor-process.mts';
import { createOpenAIDiagnosisBoundary } from '../src/supervisor-openai.mts';
import { prepareRuntimeBundle } from '../src/runtime-bundle.mts';
import { installPackages } from './runtime-fixture.mts';
import { advisoryReservation } from '../src/supervisor-advisory-contract.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { readSupervisor } from '../src/supervisor-state.mts';
import { offlineText } from './supervisor-provider-fixture.mts';

const evidence = { version:1,invocationId:'call',fence:'fence',project:{root:'/fixture/project',tracker:{kind:'github',host:'github.com',project:'owner/repo'}},runtime:'a'.repeat(64),dependencies:'b'.repeat(64),
  deadline:'2026-11-17T00:00:00.000Z',controller:{pid:10,start:'one',group:10,session:10},guard:{pid:20,start:'two',group:20,session:20},worker:{pid:21,start:'three',group:20,session:20} };
test('exact isolated process evidence refuses leader-only, shared-group, missing-start and unknown schema claims',()=>{
  assert.deepEqual(validateProcessEvidence(evidence),evidence);
  for (const mutate of [(v:any)=>{delete v.worker.start;},(v:any)=>{v.worker.group=30;},(v:any)=>{v.guard.session=30;},
    (v:any)=>{v.controller.group=20;},(v:any)=>{v.controller.pid=20;},(v:any)=>{v.worker.pid=20;},(v:any)=>{v.closed=true;},(v:any)=>{v.version=2;}]) {
    const v=structuredClone(evidence); mutate(v); assert.throws(()=>validateProcessEvidence(v));
  }
  assert.equal(groupAbsent(0),false); assert.equal(groupAbsent(-1),false);
  const kill=process.kill;
  try {
    for(const code of ['ESRCH','EPERM','EIO']) {
      process.kill=(()=>{throw Object.assign(Error('synthetic observation'),{code});}) as any;
      assert.equal(groupAbsent(123),code==='ESRCH','only whole-group ESRCH is absence');
    }
  } finally { process.kill=kill; }
  try { assert.equal(groupAbsent(processIdentity(process.pid).group),false); }
  catch(e) { assert.equal(process.platform,'darwin'); assert.match(String(e),/Advisory held: (?:Darwin process\/session probe unavailable|unsupported Darwin process\/session evidence)/); }
  assert.throws(()=>createOpenAIDiagnosisBoundary({runtimeRoot:fileURLToPath(new URL('../src/',import.meta.url)),stateDir:tmpdir()}),/selected flat adapter/);
});

test('one owned copied process integration: normal receipt, explicit terminate, child deadline, actual controller death and inherited descendant cleanup', async t=>{
  const root=mkdtempSync(join(tmpdir(),'factory-process-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bundle=prepareRuntimeBundle({sourceRoot:fileURLToPath(new URL('../../',import.meta.url)),runtimeStore:join(root,'runtime'),install:installPackages});
  for(const scenario of ['complete','terminate','deadline','controller-loss','pre-handoff-loss']) {
    const dir=join(root,scenario); mkdirSync(dir);
    const child=spawn(process.execPath,[fileURLToPath(new URL('./supervisor-process-fixture.mts',import.meta.url)),'--controller',dir,bundle.directory,scenario],
      {stdio:['ignore','pipe','pipe','ipc'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C'}});
    let stderr=''; child.stderr!.on('data',b=>{stderr+=b.toString();}); child.stdout!.resume();
    const closed=once(child,'close'), first=(await once(child,'message'))[0] as any;
    if(process.platform==='darwin' && first.kind==='error') {
      assert.match(first.error,/Advisory held: (?:Darwin process\/session probe unavailable|unsupported Darwin process\/session evidence|not an isolated anchored group)/);
      assert.equal((await closed)[0],1);
      t.diagnostic('Darwin lifecycle capability explicitly held before handoff; no positive Darwin proof');
      return;
    }
    assert.equal(first.kind,'inflight',JSON.stringify(first)+stderr);
    assert.deepEqual(readOwnedProcess(first.stateDir,first.grant),first.evidence);
    if(!['complete','pre-handoff-loss'].includes(scenario)) assert.ok(first.descendant>0,'real descendant ready before lifecycle event');
    if(['terminate','controller-loss','pre-handoff-loss'].includes(scenario)) child.send({continue:true});
    if(!['controller-loss','pre-handoff-loss'].includes(scenario)) {
      const result=(await once(child,'message'))[0] as any;
      assert.equal(result.kind,'result',JSON.stringify(result)+stderr);
      assert.equal(result.sends,1); assert.deepEqual(result.charge,advisoryReservation(),'no release/refund/legacy finish');
      assert.equal(result.again,result.cleanup,'terminate is idempotent');
      if(scenario==='complete') { assert.equal(result.output,offlineText,'actual SDK/runner output drains before guard cleanup'); assert.deepEqual(result.usage,{tokens:35,cost:220}); assert.equal(result.cleanup,true); }
      else assert.equal(result.usage,null,'missing terminal remains full-charge unknown');
    }
    const [code]=await closed; assert.equal(code,0,stderr);
    if(scenario==='pre-handoff-loss') assert.equal(Object.keys(readSupervisor(first.stateDir,first.grant.project).advisory!.sends).length,0,'controller loss before registration/handoff cannot send');
    // Extra TEST-ONLY inherited pipe supplies an exit barrier, NOT cleanup proof. Observe the entire group independently.
    const absent=groupAbsent(first.evidence.guard.group);
    t.diagnostic(`${scenario}: entire group ${absent ? 'observed absent' : 'present/unknown; ownership held'}`);
    const reopened=confirmOwnedCleanup(first.stateDir,first.grant);
    // Observations are not atomic with each other: a reaper may remove zombies between these calls.
    // Any positive reopen must retain a strict whole-group receipt, never infer absence from the pipe barrier.
    if(reopened) {
      const cleanup=JSON.parse(readFileSync(join(first.stateDir,'supervisor/process',supervisorHash(first.grant.project),supervisorHash(first.grant.invocationId),'cleanup.json'),'utf8'));
      assert.equal(cleanup.state,'absent'); assert.equal(cleanup.group,first.evidence.guard.group); assert.equal(cleanup.process,supervisorHash(first.evidence));
    }
    if(scenario==='complete') {
      const file=join(first.stateDir,'supervisor/process',supervisorHash(first.grant.project),supervisorHash(first.grant.invocationId),'process.json'), original=readFileSync(file);
      chmodSync(file,0o644); assert.equal(confirmOwnedCleanup(first.stateDir,first.grant),false); chmodSync(file,0o600);
      writeFileSync(file,'{}'); assert.equal(confirmOwnedCleanup(first.stateDir,first.grant),false); writeFileSync(file,original);
      unlinkSync(file); symlinkSync(join(dir,'absent'),file); assert.equal(confirmOwnedCleanup(first.stateDir,first.grant),false);
      unlinkSync(file); writeFileSync(file,original,{mode:0o600});
      assert.equal(confirmOwnedCleanup(first.stateDir,first.grant),true,'valid immutable evidence reopens; no repair occurs in the reader');
    }
    if(!absent && process.platform==='linux') {
      // Linux may retain killed orphan zombies until its reaper runs. No sleeps/retries or fabricated group absence.
      for(const pid of [first.evidence.guard.pid,first.evidence.worker.pid,first.descendant].filter(Boolean)) {
        try { const stat=readFileSync(`/proc/${pid}/stat`,'utf8'); assert.equal(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0],'Z'); }
        catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
      }
    }
  }
});
