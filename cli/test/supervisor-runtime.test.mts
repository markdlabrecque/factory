// Cheap filesystem/identity permutations plus one existing real owned-process fixture.
// Pinned SDK imports/child/journal/leases are real; controls/auth/SSE are synthetic and outbound is denied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../src/paths.mts';
import { installedFixture } from './workflow-fixture.mts';
import { factoryToml } from './config-fixture.mts';
import { createSupervisorRuntime, assertAdvisoryRuntimeSource } from '../src/supervisor-runtime.mts';
import { prepareRuntimeBundle, regenerateRuntimeManifest } from '../src/runtime-bundle.mts';
import { installPackages } from './runtime-fixture.mts';
import { denyNetwork } from './supervisor-provider-fixture.mts';
import { acquireAdvisoryRuntimeLease, preflightRuntimeRemoval, withRuntimeLock, releaseRuntimeLease, transferRuntimeLease, releaseAdvisoryRuntimeLease, transferAdvisoryRuntimeLease } from '../src/runtime-ownership.mts';
import { ADVISORY_PROFILE_ID } from '../src/supervisor-advisory-contract.mts';
import { resolveWorkflow } from '../../orchestrator/workflow.mts';

denyNetwork();
const repo = fileURLToPath(new URL('../../',import.meta.url));
function setup(t: any) {
  const root = mkdtempSync(join(tmpdir(),'factory-advisory-runtime-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  const p = paths(join(root,'home')); installedFixture(p);
  const projectRoot = join(root,'project'); mkdirSync(join(projectRoot,'.factory'),{recursive:true});
  mkdirSync(p.state,{recursive:true,mode:0o700});
  writeFileSync(join(projectRoot,'.factory/factory.toml'),factoryToml('owner/repo'));
  return {root,p,projectRoot,options:{paths:p,projectRoot,stateDir:p.state,invocationId:'invocation',fence:'fence'}};
}
test('complete selection pins deduplicated host identity; death, unknown accounting and generic old readers retain protected leases',async t=>{
  const {p,options} = setup(t), runtime = await createSupervisorRuntime(options), lease = runtime.lease();
  assert.equal(lease.version,2); assert.equal(lease.binding.pins.length,1); assert.equal(lease.binding.profile,ADVISORY_PROFILE_ID);
  assert.equal(runtime.boundary.kind,'owned-openai');
  assert.deepEqual(runtime.boundary.reservation,{tokens:1054096,cost:5808792});
  await assert.rejects(runtime.release(),/settlement held/);
  assert.throws(()=>releaseRuntimeLease(p,lease.token),/Invalid runtime lease/);
  assert.throws(()=>transferRuntimeLease(p,lease.token,lease.owner),/Invalid runtime lease/);
  const file = join(p.runtimes,'.leases',`${lease.token}.json`);
  for(const owner of [{pid:process.pid,start:'dead-identity'},{pid:process.pid}]) {
    writeFileSync(file,JSON.stringify({...lease,owner}));
    assert.throws(()=>withRuntimeLock(p,()=>preflightRuntimeRemoval(p)),/Invalid runtime lease/,'V1 GC rejects V2 rather than pruning a dead PID');
    await assert.rejects(releaseAdvisoryRuntimeLease(p,{...lease,owner}),/settlement held/);
  }
  writeFileSync(file,JSON.stringify({...lease,binding:{...lease.binding,fence:'successor-fence'}}));
  assert.throws(runtime.assertCurrent,/ownership changed/);
  rmSync(file); assert.throws(runtime.assertCurrent);
  writeFileSync(file,JSON.stringify(lease));
  await assert.rejects(transferAdvisoryRuntimeLease(p,lease,{} as any));
  assert(existsSync(file));
  const config = join(options.projectRoot,'.factory/factory.toml');
  const original = readFileSync(config);
  writeFileSync(config,original.toString()+'\n[workflow]\nmode = "project"\ndirectory = "missing"\n');
  assert.throws(runtime.assertCurrent);
  writeFileSync(config,original);
  const dep = join(lease.binding.pins[0].root,'node_modules/tsx/dist/cli.mjs'), bytes = readFileSync(dep);
  rmSync(dep); assert.throws(runtime.assertCurrent); writeFileSync(dep,bytes,{mode:0o755});
  writeFileSync(dep,'mutated'); assert.throws(runtime.assertCurrent,/dependencies changed/);
  assert(existsSync(file));
});
test('byte-compatible complete project override pins host and selected; reviewed opaque code is held before selected execution',async t=>{
  const {p,projectRoot,options} = setup(t);
  const host = resolveWorkflow(projectRoot,p.runtimeDescriptor), override = join(projectRoot,'workflow'); cpSync(host.root,override,{recursive:true});
  writeFileSync(join(projectRoot,'.factory/factory.toml'),factoryToml('owner/repo')+'\n[workflow]\nmode = "project"\ndirectory = "workflow"\n');
  const selected = await createSupervisorRuntime(options);
  assert.equal(selected.lease().binding.pins.length,2,'same content identity at distinct owned paths is not lost');
  const target = join(override,'supervisor-openai.mts');
  writeFileSync(target,'throw Error("UNTRUSTED SELECTED CODE EXECUTED");\nexport const createOpenAIDiagnosisBoundary = () => true;\n');
  writeFileSync(join(override,'runtime-manifest.json'),JSON.stringify(regenerateRuntimeManifest(override)));
  assert.equal(resolveWorkflow(projectRoot,p.runtimeDescriptor).mode,'project','normal complete override remains valid');
  assert.throws(()=>assertAdvisoryRuntimeSource(override),/unsupported runtime source/);
  await assert.rejects(createSupervisorRuntime({...options,invocationId:'next'}),/unsupported runtime source/);
  assert.throws(selected.assertCurrent);
  rmSync(join(override,'supervisor-provider/openai-7.19.0.tgz'));
  await assert.rejects(createSupervisorRuntime(options));
});
test('one copied-private runtime lease boundary transfers exact ready child and releases only durable known terminal settlement',async t=>{
  const root = mkdtempSync(join(tmpdir(),'factory-runtime-process-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  const p = paths(join(root,'home'));
  const bundle = prepareRuntimeBundle({sourceRoot:repo,runtimeStore:p.runtimes,install:installPackages});
  const child = spawn(process.execPath,[fileURLToPath(new URL('./supervisor-process-fixture.mts',import.meta.url)),'--controller',root,bundle.directory,'complete','--runtime'],
    {stdio:['ignore','pipe','pipe','ipc'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C'}});
  let stderr=''; child.stderr!.on('data',b=>{stderr+=b;}); child.stdout!.resume();
  const closed=once(child,'close');
  const first=(await once(child,'message'))[0] as any;
  if(first.kind==='error') { await closed; assert.fail(first.error+stderr); }
  assert.equal(first.kind,'inflight',JSON.stringify(first)+stderr);
  const fileDir=join(p.runtimes,'.leases');
  const result=(await once(child,'message'))[0] as any;
  assert.equal((await closed)[0],0,JSON.stringify(result)+stderr);
  assert.equal(result.kind,'result',JSON.stringify(result)); assert.equal(result.cleanup,true);
  assert.deepEqual(result.usage,{tokens:35,cost:220}); assert.deepEqual(result.charge,{tokens:1054096,cost:5808792});
  assert.equal(result.pinned.owner.pid,first.evidence.worker.pid); assert.equal(result.pinned.owner.start,first.evidence.worker.start);
  assert.deepEqual(result.pinned.process,first.evidence);
  assert.equal(existsSync(join(fileDir,`${result.pinned.token}.json`)),false,'actual durable T05 settlement and ESRCH release the exact pin');
  const successor = acquireAdvisoryRuntimeLease(p,bundle.id,{...result.pinned.binding,invocationId:'successor',fence:'successor-fence'});
  await assert.rejects(releaseAdvisoryRuntimeLease(p,result.pinned));
  assert(existsSync(join(fileDir,`${successor.token}.json`)),'stale release cannot release successor');
});
