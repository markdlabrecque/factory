// Offline bounded auth-child units: synthetic pipes only, never run Pi or inspect an auth store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolvePiLogin, PI_LOGIN_ARGS, piLoginFailureOf, type PiLoginFailure } from '../src/supervisor-auth.mts';
import { profileForAuth, ADVISORY_PROFILE_ID, SUBSCRIPTION_PROFILE_ID } from '../src/supervisor-advisory-contract.mts';
function fake(pid: number | null = 1234) {
  return Object.assign(new EventEmitter(),{pid:pid ?? undefined,stdout:new PassThrough(),stderr:new PassThrough()});
}
const errno = (code: string) => Object.assign(Error('PRIVATE diagnostic'),{code});
async function refused(p: Promise<string>, stage: PiLoginFailure['stage'], cleanupUnconfirmed = false) {
  await assert.rejects(p,e=>{
    assert.deepEqual(piLoginFailureOf(e),{stage,cleanupUnconfirmed});
    assert.match(String(e),/no fallback or reservation$/);
    assert.doesNotMatch(String(e),/PRIVATE/);
    return true;
  });
}
test('explicit immutable auth selection never falls back and supported Pi command requests OAuth lifetime',()=>{
  assert.equal(profileForAuth(),ADVISORY_PROFILE_ID);assert.equal(profileForAuth('api-key'),ADVISORY_PROFILE_ID);
  assert.equal(profileForAuth('pi-login'),SUBSCRIPTION_PROFILE_ID);assert.throws(()=>profileForAuth('ambient' as any));
  assert.deepEqual(PI_LOGIN_ARGS,['auth','print-bearer-token','--min-expiry','50m','--provider','openai']);
});
test('bounded synthetic child distinguishes exit, output limits, malformed bearer and unknown failures',async t=>{
  t.mock.method(process,'kill',()=>{throw errno('ESRCH');});
  for (const [stdout,code,signal,stage] of [
    ['synthetic.bearer\r\n',0,null,null],['sk-PRIVATE\n',0,null,'malformed-bearer'],['',0,null,'malformed-bearer'],
    ['a\nb\n',0,null,'malformed-bearer'],['bearer with spaces',0,null,'malformed-bearer'],
    ['PRIVATE',1,null,'exit'],['PRIVATE',null,'SIGTERM','exit'],['PRIVATE',null,null,'unknown'],
    ['PRIVATE'.repeat(2500),0,null,'output-limit'],
  ] as const) {
    const child=fake();
    const p=resolvePiLogin(undefined,{start:()=>child as unknown as ChildProcess});
    child.stdout.write(stdout);child.emit('close',code,signal);
    if (stage) await refused(p,stage); else assert.equal(await p,'synthetic.bearer');
  }
});

test('parent bounds timeout, cancellation, stderr and setup/spawn failures without exposing details',async t=>{
  const kill = t.mock.method(process,'kill',()=>{throw errno('ESRCH');});
  for (const [mode,stage] of [['timer','setup'],['timeout','timeout'],['cancel','cancelled'],['stderr','output-limit'],
    ['error','spawn'],['throw','spawn'],['post-start error','unknown']] as const) {
    const child=fake(mode==='error' ? null : 1234), control=new AbortController();let timeout=()=>{}, cwd='';
    const p=resolvePiLogin(control.signal,{start:dir=>{
      cwd=dir;
      if(mode==='throw')throw Error('PRIVATE exception');
      return child as unknown as ChildProcess;
    },timer:(f,ms)=>{
      if(mode==='timer')throw Error('PRIVATE exception');
      assert.equal(ms,20000);timeout=f;return()=>{};
    }});
    if(mode==='timeout')timeout();
    if(mode==='cancel')control.abort('PRIVATE abort reason');
    if(mode==='stderr')child.stderr.write('PRIVATE'.repeat(2000));
    if(mode==='error' || mode==='post-start error')child.emit('error',Error('PRIVATE exception'));
    await refused(p,stage);
    assert.equal(existsSync(cwd),false);
    if(mode!=='throw'){assert.equal(child.stdout.destroyed,true);assert.equal(child.stderr.destroyed,true);}
  }
  assert.equal(kill.mock.callCount(),5,'no group to probe on failed spawn');
  const cancelled=new AbortController();cancelled.abort();
  const start=t.mock.fn();
  await refused(resolvePiLogin(cancelled.signal,{start}),'cancelled');
  assert.equal(start.mock.callCount(),0);
});

test('remaining or unprobeable process group never yields a bearer; killing is not confirmation',async t=>{
  for (const mode of ['remaining','unprobeable','cancelled'] as const) {
    const kill=t.mock.method(process,'kill',(_pid:number,signal:number|string)=>{
      if(mode==='unprobeable')throw errno('EPERM');
      return true;
    });
    try {
      const child=fake(), control=new AbortController();
      const p=resolvePiLogin(control.signal,{start:()=>child as unknown as ChildProcess});
      child.stdout.write('PRIVATE.bearer');
      if(mode==='cancelled')control.abort(); else child.emit('close',0,null);
      await refused(p,mode==='cancelled' ? 'cancelled' : 'cleanup',true);
      assert.deepEqual(kill.mock.calls.map(c=>c.arguments),[[-1234,0],[-1234,'SIGKILL']]);
      assert.equal(child.stdout.destroyed,true);assert.equal(child.stderr.destroyed,true);
    } finally {kill.mock.restore();}
  }
});
