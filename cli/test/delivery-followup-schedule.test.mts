// #153: exact trusted read-only status command; fake status only, never a host service manager.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scheduledEnv, refreshEnv } from '../src/commands/tick.mts';
const dir = realpathSync(mkdtempSync(join(tmpdir(),'delivery-auth-')));
for(const f of ['delivery-followup.mts','verification.mts']) copyFileSync(new URL(`../../orchestrator/${f}`,import.meta.url),join(dir,f));
copyFileSync(new URL('../../board/delivery.mts',import.meta.url),join(dir,'delivery.mts'));
const {schedulerAuthorization,bounded}=await import(pathToFileURL(join(dir,'delivery-followup.mts')).href);
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const env={FACTORY_SCHEDULED:'1',FACTORY_CLI_ENTRYPOINT:'/trusted/app/cli/bin/factory.mts',FACTORY_SCHEDULER_NODE:process.execPath};
const status=()=>({version:1,scheduler:{serviceEnabled:true,timerActive:true},projects:[{root:dir,schedule:{enabled:true,branch:'main'},blocker:null}]});
test('authorization uses exact absolute CLI/Node and canonical root; no PATH or shell fallback',()=>{
  let calls=0;
  assert.equal(schedulerAuthorization(dir,'main',Date.now()+30000,env,(node,args)=>{
    calls++; assert.equal(node,process.execPath); assert.deepEqual(args,[env.FACTORY_CLI_ENTRYPOINT,'schedule','status','--project',dir,'--json']); return JSON.stringify(status());
  }),undefined); assert.equal(calls,1);
  for(const e of [{},{...env,FACTORY_SCHEDULED:undefined},{...env,FACTORY_CLI_ENTRYPOINT:'factory'},{...env,FACTORY_SCHEDULER_NODE:'node'}]) assert.ok(schedulerAuthorization(dir,'main',Date.now()+30000,e,()=>{throw Error('must not spawn');}));
});
test('old/malformed CLI, global off/unknown, pause, blocker and base switch refuse merge',()=>{
  const variants:any[]=[{}, {...status(),version:0}, {...status(),scheduler:{serviceEnabled:false,timerActive:true}}, {...status(),scheduler:{serviceEnabled:true,timerActive:null}}, {...status(),projects:[]}, {...status(),projects:[...status().projects,...status().projects]}];
  for(const patch of [{root:'/different'}, {schedule:{enabled:false,branch:'main'}}, {schedule:{enabled:true,branch:'other'}}, {blocker:'branch switched'}, {blocker:undefined}]) variants.push({...status(),projects:[{...status().projects[0],...patch}]});
  for(const s of variants) assert.ok(schedulerAuthorization(dir,'main',Date.now()+30000,env,()=>JSON.stringify(s)));
  assert.ok(schedulerAuthorization(dir,'main',Date.now()+30000,env,()=>'{malformed'));
  assert.ok(schedulerAuthorization(dir,'main',Date.now()+30000,env,()=>{throw Error('cancelled');}));
});
test('authorization is freshly read after observation; pause/cancellation cannot reuse old permission',()=>{
  let paused=false;
  const run=()=>JSON.stringify({...status(),scheduler:{serviceEnabled:!paused,timerActive:true}});
  assert.equal(schedulerAuthorization(dir,'main',Date.now()+30000,env,run),undefined); paused=true;
  assert.ok(schedulerAuthorization(dir,'main',Date.now()+30000,env,run));
  assert.throws(()=>bounded(process.execPath,['-e','process.exit(0)'],Date.now()-1),/deadline/);
});
test('tick overrides inherited untrusted paths; refresh clears all delivery authorization',()=>{
  const paths={state:join(dir,'state')} as any, config={node:process.execPath,path:'/fixture/bin'};
  const scheduled=scheduledEnv(paths,config,{...env,FACTORY_CLI_ENTRYPOINT:'/untrusted',FACTORY_SCHEDULER_NODE:'/untrusted'});
  assert.match(scheduled.FACTORY_CLI_ENTRYPOINT!,/\/cli\/bin\/factory.mts$/); assert.notEqual(scheduled.FACTORY_CLI_ENTRYPOINT,'/untrusted'); assert.equal(scheduled.FACTORY_SCHEDULER_NODE,process.execPath);
  const refresh=refreshEnv(paths,config,scheduled); assert.equal(refresh.FACTORY_SCHEDULED,undefined); assert.equal(refresh.FACTORY_CLI_ENTRYPOINT,undefined); assert.equal(refresh.FACTORY_SCHEDULER_NODE,undefined);
});
