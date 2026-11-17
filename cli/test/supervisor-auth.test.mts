// Offline bounded auth-child units: synthetic pipes only, never run Pi or inspect an auth store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolvePiLogin, PI_LOGIN_ARGS } from '../src/supervisor-auth.mts';
import { profileForAuth, ADVISORY_PROFILE_ID, SUBSCRIPTION_PROFILE_ID } from '../src/supervisor-advisory-contract.mts';
function fake() { return Object.assign(new EventEmitter(),{pid:2147483647,stdout:new PassThrough(),stderr:new PassThrough()}); }
test('explicit immutable auth selection never falls back and supported Pi command requests OAuth lifetime',()=>{
  assert.equal(profileForAuth(),ADVISORY_PROFILE_ID);assert.equal(profileForAuth('api-key'),ADVISORY_PROFILE_ID);
  assert.equal(profileForAuth('pi-login'),SUBSCRIPTION_PROFILE_ID);assert.throws(()=>profileForAuth('ambient' as any));
  assert.deepEqual(PI_LOGIN_ARGS,['auth','print-bearer-token','--min-expiry','50m','--provider','openai']);
});
test('one bounded synthetic OAuth child accepts only a single non-sk bearer; failures never expose output',async()=>{
  for(const [value,code,ok] of [['synthetic.bearer\n',0,true],['sk-wrong-route\n',0,false],['',0,false],['a\nb\n',0,false],['bearer with spaces',0,false],['secret',1,false],['x'.repeat(16387),0,false]] as const){
    const child=fake();
    const p=resolvePiLogin(undefined,{start:()=>child as any});
    child.stdout.write(value);child.emit('close',code);
    if(ok) assert.equal(await p,'synthetic.bearer'); else await assert.rejects(p,e=>String(e)==='Error: Advisory held: Pi login handoff unavailable, cancelled or malformed; no fallback');
  }
});
test('parent timeout/cancel/stderr overflow/spawn failure are bounded sanitized refusals',async()=>{
  for(const mode of ['timeout','cancel','stderr','error','throw']){
    const child=fake(), control=new AbortController();let timeout=()=>{};
    const p=resolvePiLogin(control.signal,{start:()=>{if(mode==='throw')throw Error('secret exception');return child as any;},timer:(f,ms)=>{assert.equal(ms,20000);timeout=f;return()=>{};}});
    if(mode==='timeout')timeout();if(mode==='cancel')control.abort();if(mode==='stderr')child.stderr.write('secret'.repeat(2000));if(mode==='error')child.emit('error',Error('secret exception'));
    await assert.rejects(p,/^Error: Advisory held: Pi login handoff unavailable, cancelled or malformed; no fallback$/);
    if(mode!=='throw'){assert.equal(child.stdout.destroyed,true);assert.equal(child.stderr.destroyed,true);}
  }
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(resolvePiLogin(cancelled.signal,{start:()=>{throw Error('must not start');}}),/no fallback/);
});
