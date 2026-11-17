// Cheap rollout schema permutations and one disposable real-filesystem boundary. Never installed quiescence evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync, linkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readSupervisorRollout, validateRolloutAttestation, assertRolloutWindow } from '../src/supervisor-rollout.mts';
const h='a'.repeat(64), now=Date.parse('2026-11-17T00:00:00.000Z');
const binding={project:{root:'/fixture',tracker:{kind:'github' as const,host:'github.com',project:'owner/repo'}},host:h,hostDependencies:h,selected:h,dependencies:h};
const record={version:1, ...binding, recordedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),olderRuntimesQuiesced:true,unmanagedWorkQuiesced:true};
test('strict operator data binds structured project and both runtime/dependency identities with a finite nonfuture window',()=>{
  assert.deepEqual(validateRolloutAttestation(record,binding,now),record);
  const pin={identity:h,expiresAt:record.expiresAt};
  assert.doesNotThrow(()=>assertRolloutWindow(pin,record.recordedAt,3600000));
  assert.throws(()=>assertRolloutWindow(pin,record.recordedAt,3600001),/insufficient/);
  assert.throws(()=>assertRolloutWindow(pin,record.recordedAt,Infinity),/insufficient/);
  for(const patch of [{version:2},{olderRuntimesQuiesced:false},{unmanagedWorkQuiesced:false},{recordedAt:new Date(now+1).toISOString()},
    {expiresAt:new Date(now).toISOString()},{recordedAt:new Date(now-86400001).toISOString()},{expiresAt:new Date(now+86400001).toISOString()},
    {recordedAt:'yesterday'},{expiresAt:'forever'},{enabled:true},{budget:20},{mode:'act'},{approval:true},{apiKey:'synthetic'},
    {project:{...binding.project,root:'/foreign'}},{project:{...binding.project,tracker:{...binding.project.tracker,host:'foreign'}}},
    ...['host','hostDependencies','selected','dependencies'].map(k=>({[k]:'b'.repeat(64)}))])
    assert.throws(()=>validateRolloutAttestation({...record,...patch},binding,now),JSON.stringify(patch));
});
test('public default reader refuses unsafe filesystem data and renewal changes only its control pin',t=>{
  const home=mkdtempSync(join(tmpdir(),'factory-rollout-')); t.after(()=>rmSync(home,{recursive:true,force:true}));
  const config=join(home,'private'), root=join(home,'project'); mkdirSync(config,{mode:0o700});mkdirSync(root);
  const file=join(config,'supervisor-rollout.json');
  const expected={...binding,project:{...binding.project,root}};
  const data={...record,project:expected.project};
  const read=(at=now)=>readSupervisorRollout(config,expected,[root],at);
  const save=(value:any=data)=>{rmSync(file,{force:true});writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value),{mode:0o600});};
  assert.throws(()=>read(),/ENOENT/); save(); const first=read(); assert.equal(first.expiresAt,data.expiresAt);
  assert.deepEqual(read(),first,'stable reread');
  const getuid=process.getuid!;
  try { process.getuid=()=>getuid()+1; assert.throws(()=>read(),/current-owner/); }
  finally { process.getuid=getuid; }
  assert.throws(()=>read(now+3600000),/expired/);
  for(const mode of [0o644,0o400,0o660,0o1600]) {chmodSync(file,mode);assert.throws(()=>read(),/0600/);} chmodSync(file,0o600);
  chmodSync(config,0o750);assert.throws(()=>read(),/0700/);chmodSync(config,0o700);
  const alias=join(home,'alias');symlinkSync(config,alias);assert.throws(()=>readSupervisorRollout(alias,expected,[root],now),/canonical/);
  const other=join(home,'other');writeFileSync(other,JSON.stringify(data),{mode:0o600});rmSync(file);symlinkSync(other,file);assert.throws(()=>read());
  rmSync(file);linkSync(other,file);assert.throws(()=>read(),/unlinked/);
  save('{');assert.throws(()=>read());save(Buffer.from([0xff]));assert.throws(()=>read(),/encoded data/);
  save(' '.repeat(16385));assert.throws(()=>read(),/bounded/);
  rmSync(file);mkdirSync(file);assert.throws(()=>read(),/regular/);rmSync(file,{recursive:true});
  execFileSync('mkfifo',[file],{timeout:15000});assert.throws(()=>read(),/regular/);rmSync(file);
  save();assert.throws(()=>readSupervisorRollout(config,expected,[home],now),/mount/);
  const replacement=join(config,'replacement');writeFileSync(replacement,JSON.stringify(data),{mode:0o600});renameSync(replacement,file);
  assert.notEqual(read().identity,first.identity,'replacement invalidates an inflight pin even with identical content');
  save({...data,expiresAt:new Date(now+7200000).toISOString()});assert.notEqual(read().identity,first.identity,'renewal creates a new control identity');
});
