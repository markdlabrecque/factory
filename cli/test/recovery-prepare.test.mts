// Fixture-owned Node helpers exercise the real bounded subprocess/group protocol, without agents or trackers.
import { execFileSync } from 'node:child_process';
import { projectFixture } from './workflow-fixture.mts';
import { factoryToml } from './config-fixture.mts';
import {test} from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {paths} from '../src/paths.mts';
import {prepareRecovery} from '../src/recovery-prepare.mts';
import {recordReview,WORKFLOW} from '../src/recovery-review.mts';
import {preparedFixture} from './prepared-fixture.mts';
import {groupAlive} from '../src/tick-lock.mts';
function fixture(t:TestContext){
  const home=mkdtempSync(join(tmpdir(),'factory-preparation-')),root=join(home,'project'),sc=join(root,'.factory-workflow'),p=paths(home);
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  for(const f of WORKFLOW.filter(f=>!['package.json','package-lock.json'].includes(f))){mkdirSync(dirname(join(sc,f)),{recursive:true});writeFileSync(join(sc,f),'');}
  mkdirSync(join(root,'.sandcastle'),{recursive:true});
  writeFileSync(join(root,'.sandcastle/factory.toml'),factoryToml('proj'));
  writeFileSync(join(sc,'main.mts'),'"attempt-record": { type: "string" }');
  const git = (args:string[]) => execFileSync('git', args, {cwd:root,stdio:'pipe'});
  git(['init','-b','main']); git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--allow-empty','-m','base']);
  git(['update-ref','refs/remotes/origin/main','HEAD']);
  const o={root,tracker:'proj',ticket:7,base:'main',dir:p.state,setupTimeoutMs:2000};
  const prepared=preparedFixture(o);
  const helper=(code:string,minutes='1')=>{writeFileSync(join(sc,'recovery-analysis.mts'),code);writeFileSync(join(sc,'config-read.mts'),`process.stdout.write(${JSON.stringify(minutes)});`);projectFixture(p,root);recordReview(p,root);};
  helper(`process.stdout.write(${JSON.stringify(JSON.stringify(prepared))});`);
  return {p,o,helper,prepared,sc};
}
test('success runs reviewed copied helper under saved Node/PATH/shared state and confirms both groups',async t=>{
  const f=fixture(t);const seen:any[]=[];
  const {spawn}=await import('node:child_process');
  const result=await prepareRecovery(f.p,{...f.o,node:process.execPath,path:process.env.PATH,spawn:(node,args,o)=>{seen.push({node,args,o});return spawn(node,args,o);}});
  assert.deepEqual(result,f.prepared);assert.equal(seen.length,2);assert.ok(seen.every(x=>x.node===process.execPath&&x.o.detached&&x.o.env.SANDCASTLE_STATE_DIR===f.o.dir));
  assert.equal(readdirSync(f.p.recovery).filter(x=>x.startsWith('prepare-')).length,0);
});
for(const [name,code] of [['malformed',`process.stdout.write('not json');`],['wrong protocol',`process.stdout.write('{"version":1,"state":"ready"}');`],['oversize',`process.stdout.write('x'.repeat(20000));`]]) test(`${name} cannot authorize repair`,async t=>{
  const f=fixture(t);f.helper(code);assert.notEqual((await prepareRecovery(f.p,f.o)).state,'ready');
});
test('missing or changed/unreviewed helper refuses without any subprocess',async t=>{
  const f=fixture(t);rmSync(join(f.sc,'recovery-analysis.mts'));let calls=0;
  const result=await prepareRecovery(f.p,{...f.o,spawn:()=>{calls++;throw Error('not allowed');}});assert.equal(result.scope,'project');assert.equal(result.code,'config');assert.equal(calls,0);
});
test('timeout and cancellation terminate only the owned group',async t=>{
  const f=fixture(t);f.helper('setInterval(()=>{},1000);','0.0001');
  const timed=await prepareRecovery(f.p,f.o);assert.equal(timed.code,'timeout');
  const controller=new AbortController();f.helper('setInterval(()=>{},1000);');
  const timer=setTimeout(()=>controller.abort(),100);t.after(()=>clearTimeout(timer));
  const cancelled=await prepareRecovery(f.p,{...f.o,signal:controller.signal});assert.equal(cancelled.code,'timeout');
});
test('leader exit cleans descendants with redirected pipes before returning ready',async t=>{
  const f=fixture(t);let pid:number|undefined;
  f.helper(`import {spawn} from 'node:child_process';spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}).unref();process.stdout.write(${JSON.stringify(JSON.stringify(f.prepared))});`);
  const {spawn}=await import('node:child_process');
  const result=await prepareRecovery(f.p,{...f.o,spawn:(node,args,o)=>{const c=spawn(node,args,o);pid=c.pid;return c;}});
  assert.equal(result.state,'ready');assert.ok(pid);assert.equal(groupAlive(pid!),false);
});
test('unconfirmed cleanup persists a project-wide ownership stop and never starts another preparer',async t=>{
  const f=fixture(t);const result=await prepareRecovery(f.p,{...f.o,terminate:async()=>({confirmed:false,escalated:true})});
  assert.equal(result.code,'ownership');assert.equal(result.scope,'project');let calls=0;
  const again=await prepareRecovery(f.p,{...f.o,spawn:()=>{calls++;throw Error('not allowed');}});assert.equal(again.code,'ownership');assert.equal(calls,0);
});
test('helper-reported dirty workspace holds project across later passes',async t=>{
  const f=fixture(t);f.helper(`process.stdout.write(${JSON.stringify(JSON.stringify({version:1,state:'held',code:'ownership',scope:'project',reason:'Dirty workspace preserved at fixture path'}))});`);
  assert.equal((await prepareRecovery(f.p,f.o)).code,'ownership');
  let calls=0;const next=await prepareRecovery(f.p,{...f.o,spawn:()=>{calls++;throw Error('must not spawn');}});
  assert.equal(next.code,'ownership');assert.equal(calls,0);
});

test('already aborted preparation spawns nothing',async t=>{
  const f=fixture(t),c=new AbortController();c.abort();let calls=0;
  const result=await prepareRecovery(f.p,{...f.o,signal:c.signal,spawn:()=>{calls++;throw Error('not allowed');}});assert.equal(result.code,'timeout');assert.equal(calls,0);
});
