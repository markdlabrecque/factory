// Disposable controller fixture: unchanged copied production boundary and journal; synthetic controls/auth/HTTP only.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, watch, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { supervisorFixture } from './supervisor-fixture.mts';
import { usageFixture } from './supervisor-usage-fixture.mts';
import { diagnosisGrant } from '../src/supervisor-advisory-contract.mts';
import { commitSupervisor, readSupervisor, incidentIdentity } from '../src/supervisor-state.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { diagnosisBasis } from '../../orchestrator/supervisor.mts';
import { ownerOf } from '../../board/admission.mts';
import { denyNetwork } from './supervisor-provider-fixture.mts';

if (process.argv[2] === '--controller') {
  denyNetwork();
  const [root,runtimeRoot,scenario] = process.argv.slice(3), configFile = join(root,'preload.json'), barrier = join(root,'network.json');
  writeFileSync(configFile,JSON.stringify({ scenario, barrier }));
  const preload = new URL('./supervisor-process-preload.mts',import.meta.url); preload.searchParams.set('config',configFile);
  const original = cp.spawn;
  cp.spawn = ((command: any, args: any[], options: any) => {
    if (String(args[0]).endsWith('supervisor-guard.mjs')) {
      args = ['--import',preload.href,...args]; options = { ...options, stdio: [...options.stdio,1] };
    }
    return original(command,args,options);
  }) as any;
  syncBuiltinESMExports();
  try {
    const { createOpenAIDiagnosisBoundary } = await import(pathToFileURL(join(runtimeRoot,'supervisor-openai.mts')).href);
    const manifest = JSON.parse(readFileSync(join(runtimeRoot,'runtime-manifest.json'),'utf8'));
    const stateDir = join(root,'state'); mkdirSync(stateDir,{mode:0o700});
    const { snapshot,facts } = supervisorFixture(join(root,'project')); mkdirSync(snapshot.project.root);
    snapshot.material.runtime = manifest.id; snapshot.material.dependencies = manifest.dependencies;
    const f = usageFixture(ownerOf(process.pid) as any,snapshot.project.root), at = f.at;
    const incidentId = incidentIdentity(snapshot.project,facts), owner = ownerOf(process.pid);
    const deadline = new Date(Date.now() + (scenario === 'deadline' ? 3000 : 60000)).toISOString();
    const reservation = { id:'invocation',incidentId,kind:'diagnosis',owner,fence:'fence',at,deadline,reserved:f.g.reserved,actual:null,state:'active',reviewId:null };
    let state = commitSupervisor(stateDir,snapshot.project,0,{id:'observe',at,kind:'observe',facts,snapshotHash:supervisorHash(snapshot),reason:'offline'});
    state = commitSupervisor(stateDir,snapshot.project,state.revision,{id:'reserve',at,kind:'reserve-advisory',reservation:reservation as any,policy:f.registration,controls:f.controls,
      limits:{project:{tokens:10_000_000,cost:100_000_000},shared:{tokens:10_000_000,cost:100_000_000},capacity:1,reviewCalls:5,reviewTimeoutMs:600000}});
    const boundary = createOpenAIDiagnosisBoundary({runtimeRoot,stateDir});
    const handle = await boundary.start({project:snapshot.project,invocationId:'invocation',fence:'fence',deadline,maxOutputBytes:65536});
    const { id: _id, ...body } = f.g;
    const grant = diagnosisGrant({...body,project:snapshot.project,ticket:snapshot.scope.ticket,runId:facts.runId,incidentId,
      basis:diagnosisBasis(snapshot),runtime:manifest.id,dependencies:manifest.dependencies,owner:{pid:handle.process.evidence.worker.pid,start:handle.process.evidence.worker.start},deadline} as any);
    if (scenario === 'pre-handoff-loss') {
      process.send!({kind:'inflight',grant,stateDir,evidence:handle.process.evidence,descendant:null});
      await once(process,'message'); process.exit(0);
    }
    state = commitSupervisor(stateDir,snapshot.project,state.revision,{id:'register',at:new Date().toISOString(),kind:'register-advisory-worker',reservationId:'invocation',fence:'fence',owner,grant});
    const watcher = watch(root);
    const sent = new Promise<void>(accept => watcher.on('change',(_event,name) => { if (name === 'network.json') { watcher.close(); accept(); } }));
    let output = '';
    handle.process.child.stdout!.on('data',(b: Buffer)=>{ output += b.toString(); });
    const closed = once(handle.process.child,'close');
    handle.handoff({grant,snapshot,policy:f.registration,controls:f.controls,apiKey:'sk-synthetic-offline-not-a-secret'});
    await sent;
    const report = { grant, stateDir, evidence:handle.process.evidence, ...JSON.parse(readFileSync(barrier,'utf8')) };
    process.send!({kind:'inflight',...report});
    if (scenario === 'controller-loss') {
      await once(process,'message'); process.exit(0); // Actual controller death, not a simulated provider or terminate callback.
    }
    if (scenario === 'terminate') { await once(process,'message'); await handle.terminate(); }
    else await closed;
    const cleanup = await handle.terminate(), again = await handle.terminate(), usage = handle.usage();
    const journal = readSupervisor(stateDir,snapshot.project);
    process.send!({kind:'result',cleanup,again,usage,output,charge:journal.charged.diagnosis,sends:Object.keys(journal.advisory!.sends).length},()=>process.disconnect());
  } catch (e) { process.send!({kind:'error',error:String(e)},()=>process.exit(1)); }
}
