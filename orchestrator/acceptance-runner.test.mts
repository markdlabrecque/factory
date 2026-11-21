// Owned-runner seam: real private files, Git and admission; engine lifecycle is simulated.
// One namespace transport executes the real copied driver/setup/probe against disposable synthetic state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { acceptanceHash, acceptanceIdentity, type AcceptanceContract } from './acceptance-contract.mts';
import { freezeAcceptanceBundle } from './acceptance-custody.mts';
import { freezeTicketInput } from './ticket-input.mts';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { claimManagedEntry, readAdmission, readBaselineReservations } from '../board/admission.mts';
import { claimRun } from '../board/board.mts';
import { claimSupervisorHold } from '../cli/src/supervisor-admission.mts';
import { reserveAcceptanceBaseline, startAcceptanceBaseline, readAcceptanceBaseline, cancelAcceptanceBaseline } from './acceptance-runner.mts';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { namespaceTransport } from './fixtures/acceptance-namespace.mts';

function fixture(t: any, localDriver = false) {
  const root = mkdtempSync(join(tmpdir(), 'baseline-runner-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = Object.fromEntries(['project','custody','owned','state','runtime'].map(n => [n, join(root,n)]));
  for (const p of Object.values(paths)) mkdirSync(p, { mode: 0o700 });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: paths.project, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  git('init','-q'); git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture');
  writeFileSync(join(paths.project,'setup.mjs'), localDriver ? readFileSync(new URL('./fixtures/acceptance-local-setup.mjs',import.meta.url)) : '// project-local synthetic CMS setup; engine stub never executes this on host\n');
  if(localDriver)writeFileSync(join(paths.project,'export.mjs'),'export const rows = values => [...values];\n');
  git('add','.'); git('commit','-qm','Exact baseline'); const sha = git('rev-parse','HEAD');
  const contract = JSON.parse(readFileSync(new URL('../docs/acceptance-contract.md', import.meta.url),'utf8').match(/```json\n([\s\S]*?)\n```/)![1]) as AcceptanceContract;
  const artifacts = [{path:'probes/export.mjs',bytes:localDriver ? readFileSync(new URL('./fixtures/acceptance-local-probe.mjs',import.meta.url)) : Buffer.from('throw new Error("MUST NOT RUN ON HOST")')},{path:'fixtures/rows.json',bytes:Buffer.from('[1,2]')}];
  const hash = (bytes: Buffer) => { const { createHash } = requireCrypto; return createHash('sha256').update(bytes).digest('hex'); };
  contract.probes[0].bundle[0].sha256=hash(artifacts[0].bytes); contract.fixtures[0].sha256=hash(artifacts[1].bytes);
  if(localDriver)contract.probes[0].argv.push(paths.project); // Known-existing host sentinel; never a mount.
  const ticket = freezeTicketInput({ identity:{kind:'github',host:'github.test',project:'owner/repo'}, ticket:iid=>({bytes:1,value:{iid,title:'Baseline',description:'Exact behavior',url:'https://github.test/owner/repo/issues/7'}}),parentOf:()=>({bytes:1,value:null}),notes:()=>({bytes:1,value:{notes:[],nextPage:null}})},7);
  const pointer=freezeAcceptanceBundle({root:paths.custody,agentMounts:[paths.project],contract,ticket,artifacts,approvals:{lookup:()=>({version:1,id:'review-17',identity:acceptanceIdentity(contract),approvedRevision:1,reviewer:{kind:'human',name:'reviewer@example.invalid'},decision:'approve',semanticAdequacy:true,provenance:'host-store:17',reviewedAt:'2026-11-20T16:00:00.000Z'})}});
  const runtime=prepareRuntimeBundle({sourceRoot:resolve('.'),runtimeStore:paths.runtime,install:installPackages});
  const request={stateDir:paths.state,ownedRoot:paths.owned,custodyRoot:paths.custody,agentMounts:[paths.project],source:paths.project,project:{root:paths.project,tracker:{kind:'github' as const,host:'github.test',project:'owner/repo'}},iid:'7',pointer,sha,runtimeRoot:runtime.directory,engine:{command:'/usr/bin/docker',args:[]},image:'local/baseline@sha256:'+'a'.repeat(64),setup:[['node','setup.mjs']],reset:{kind:'project-local-synthetic-v1' as const,recipe:'Fresh local CMS and database in /state; no external resources'},bounds:{totalMs:60000,outputBytes:1048576,memoryMiB:256,cpus:1,pids:64,diskMiB:128},cap:1};
  const authorization={lookup:(intent: unknown)=>({id:'execution-grant-1',intentDigest:acceptanceHash(intent),expiresAt:Date.now()+60000})};
  return {root,paths,request,authorization,contract,git};
}
import * as requireCrypto from 'node:crypto';

test('baseline requires a separate exact trusted grant and durably competes with normal capacity without a run or recovery charge', async t=>{
  const f=fixture(t);
  assert.throws(()=>reserveAcceptanceBaseline(f.request,{lookup:()=>undefined}),/authorization/i);
  assert.equal(readBaselineReservations(f.paths.state).length,0);
  const handle=reserveAcceptanceBaseline(f.request,f.authorization);
  assert.equal(readBaselineReservations(f.paths.state).length,1);
  assert.deepEqual(readAdmission(f.paths.state).claims,{});
  assert.deepEqual(readAdmission(f.paths.state).recovery,{});
  assert.equal(claimRun({dir:f.paths.state,iid:'8',pid:process.pid,project:'different/repo',cap:1}).ok,false);
  assert.throws(()=>reserveAcceptanceBaseline(f.request,f.authorization),/capacity|held/i);
  assert.ok(handle.executionId);
  assert.throws(()=>claimManagedEntry(f.paths.state,f.request.project),/baseline/);
  assert.throws(()=>claimSupervisorHold(f.paths.state,{project:f.request.project,invocationId:'supervisor-1',runtimeRoot:f.request.runtimeRoot,rollout:{olderRuntimesQuiesced:true,unmanagedWorkQuiesced:true}}),/quiescent/);
});

test('normal and recovery reservations exclude a baseline before it creates separate ownership',t=>{
  for(const kind of ['normal','recovery'] as const){
    const f=fixture(t);const run=claimRun({dir:f.paths.state,iid:'8',pid:process.pid,project:'owner/repo',cap:1,kind,...(kind==='recovery'?{attempt:'real-recovery-claim'}:{})});
    assert.equal(run.ok,true);assert.throws(()=>reserveAcceptanceBaseline(f.request,f.authorization),/held|capacity/);
    assert.equal(readBaselineReservations(f.paths.state).length,0);
  }
});

test('two independent host processes cannot reserve the same last shared baseline capacity slot',async t=>{
  const f=fixture(t);
  const children=[0,1].map(()=>fork(resolve('orchestrator/fixtures/acceptance-controller.mjs'),[new URL('./acceptance-runner.mts',import.meta.url).href,new URL('./acceptance-contract.mts',import.meta.url).href,'reserve'],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']}));
  t.after(()=>children.forEach(c=>c.kill('SIGKILL')));
  await Promise.all(children.map(c=>once(c,'message')));
  const outcomes=children.map(c=>once(c,'message'));children.forEach(c=>c.send(f.request));
  const results=(await Promise.all(outcomes)).map(([v])=>v);
  assert.equal(results.filter(v=>v.handle).length,1);assert.equal(results.filter(v=>v.error).length,1);
  assert.equal(readBaselineReservations(f.paths.state).length,1);
  assert.deepEqual(readAdmission(f.paths.state).recovery,{});
});

async function engine(t: any, f: ReturnType<typeof fixture>, respond: (args:string[], env:any)=>Promise<any>|any) {
  const path=join(f.root,'engine.sock');
  const server=createServer(socket=>{let input='';socket.on('data',async b=>{input+=b;if(!input.includes('\n'))return;const request=JSON.parse(input);input='';try {const result=await respond(request.args,request.env);if(!socket.destroyed)socket.end(JSON.stringify(result)+'\n');}catch(e){socket.destroy(e as Error);}});socket.on('error',()=>{});});
  server.listen(path);await once(server,'listening'); t.after(()=>server.close());
  f.request.engine={command:process.execPath,args:[resolve('orchestrator/fixtures/acceptance-engine.mjs'),path]};
}
function result(f: ReturnType<typeof fixture>){return {version:1,phase:'baseline',identity:acceptanceIdentity(f.contract),assertions:[{assertionId:'A-summary',status:'expected-behavioral-fail',failureId:'summary-unavailable-or-wrong',evidence:['sandbox-output']},{assertionId:'A-order',status:'pass',failureId:null,evidence:['sandbox-output']}],evidence:[]};}

test('owned worker retains a real exact-SHA pack and frozen copies, removes only its engine-owned container, and authenticates retained results',async t=>{
  const f=fixture(t); let name='', labels:any, plan:any; const calls:string[][]=[];
  writeFileSync(join(f.paths.project,'cms-state.json'),'{"db":"implementer-dirty-secret","files":["existing-upload"]}');
  writeFileSync(join(f.paths.project,'setup.mjs'),'throw new Error("DIRTY IMPLEMENTER SETUP MUST NOT RUN")');
  await engine(t,f,(args,env)=>{
    calls.push(args); assert.equal(env.GITHUB_TOKEN,undefined); assert.equal(env.DOCKER_HOST,undefined);
    if(args[0]==='info')return {stdout:'engine-fixture-1'};
    if(args[0]==='image')return {stdout:JSON.stringify([{Id:'sha256:'+'a'.repeat(64),RepoDigests:[f.request.image],Config:{Volumes:null}}])};
    if(args[0]==='create'){
      name=args[args.indexOf('--name')+1]; labels=Object.fromEntries(args.flatMap((a,i)=>a==='--label'?[args[i+1].split('=')]:[]));
      assert.ok(args.includes('--network=none'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('--cap-drop=ALL'));
      assert.ok(args.includes('--bounding-set=-all'));assert.ok(args.includes('/usr/bin/timeout'));assert.ok(args.includes('/usr/bin/setpriv'));
      assert.ok(args.some(a=>a.startsWith('/state:rw,nosuid,nodev,size=')),'CMS database/files state is fresh bounded tmpfs, never an implementer mount');
      const mounts=args.flatMap((a,i)=>a==='--mount'?[args[i+1]]:[]);
      assert.equal(mounts.length,1,'only runner-owned copied inputs are mounted');
      assert.ok(!JSON.stringify(mounts).includes(f.paths.project));assert.ok(!JSON.stringify(mounts).includes(f.paths.custody));
      const input=mounts[0].match(/src=([^,]+)/)![1];plan=JSON.parse(readFileSync(join(input,'plan.json'),'utf8'));
      assert.equal(readFileSync(join(input,'acceptance/probes/export.mjs'),'utf8'),'throw new Error("MUST NOT RUN ON HOST")');
      assert.equal(readFileSync(join(input,'acceptance/fixtures/rows.json'),'utf8'),'[1,2]');
      // Independently unpack the transport with real Git, never executing project/probe code.
      const privateGit=join(f.root,'inspect-git');mkdirSync(privateGit);
      execFileSync('git',['init','-q'],{cwd:privateGit});execFileSync('git',['unpack-objects'],{cwd:privateGit,input:readFileSync(join(input,'baseline.pack'))});
      assert.equal(execFileSync('git',['cat-file','-t',f.request.sha],{cwd:privateGit,encoding:'utf8'}).trim(),'commit');
      assert.match(execFileSync('git',['show',f.request.sha+':setup.mjs'],{cwd:privateGit,encoding:'utf8'}),/project-local synthetic CMS/);
      assert.equal(execFileSync('git',['ls-tree','--name-only',f.request.sha],{cwd:privateGit,encoding:'utf8'}).trim(),'setup.mjs','dirty site/database state is absent from private Git input');
      return {stdout:'container-fixture-1'};
    }
    if(args[0]==='inspect')return {stdout:JSON.stringify([{Id:'container-fixture-1',Config:{Image:f.request.image,Labels:labels}}])};
    if(args[0]==='start')return {stdout:JSON.stringify({version:1,sha:f.request.sha,reset:{kind:'project-local-synthetic-v1',executionId:plan.executionId},results:result(f)})};
    if(args[0]==='rm'){assert.equal(args.at(-1),'container-fixture-1');return {};}
    if(args[0]==='ps')return {stdout:''};
    throw Error('Unexpected engine command '+args);
  });
  const approval=f.authorization;
  const h=reserveAcceptanceBaseline(f.request,{lookup:intent=>({...approval.lookup(intent),evidence:[{criterionId:'C-manual',requirement:'independent documentation review',reference:'host-independent-review:manual-17'}]})});const work=startAcceptanceBaseline(h);
  assert.equal(await work.finished,0);
  assert.equal(readBaselineReservations(f.paths.state).length,0);
  const observed=readAcceptanceBaseline(h);
  assert.equal(observed.receipt.binding.sha,f.request.sha);assert.equal(observed.policy.status,'valid','independently retained manual evidence works alongside changed/preservation assertions');
  assert.equal(observed.receipt.cleanup,'confirmed');assert.ok(calls.some(a=>a[0]==='rm'));
  assert.ok(calls.some(a=>a[0]==='image'),'image volume/digest policy is inspected before creation');
  assert.equal(JSON.parse(readFileSync(join(h.directory,'sandbox-output.json'),'utf8')).sha,f.request.sha,'result references retain the actual bounded output');
  assert.equal(cancelAcceptanceBaseline(h),false,'late cancellation cannot alter an immutable receipt');
  const receipt=join(h.directory,'receipt.json');const seal=JSON.parse(readFileSync(receipt,'utf8'));seal.receipt.binding.sha='f'.repeat(40);chmodSync(receipt,0o600);writeFileSync(receipt,JSON.stringify(seal));
  assert.throws(()=>readAcceptanceBaseline(h),/Unauthenticated/);
});

test('real sandbox driver observes pinned setup/frozen probes twice in fresh state and refuses persistent dirty synthetic state',async t=>{
  const f=fixture(t,true);
  const sourceSetup=Buffer.from('throw Error("DIRTY SOURCE SETUP MUST NEVER EXECUTE")');
  writeFileSync(join(f.paths.project,'setup.mjs'),sourceSetup);
  writeFileSync(join(f.paths.project,'export.mjs'),'export const summary = () => 3;\n');
  writeFileSync(join(f.paths.project,'cms-state.json'),'{"rows":[999],"secret":"implementer dirt"}');
  const before=f.git('status','--porcelain=v1');
  const grant={lookup:(intent:unknown)=>({...f.authorization.lookup(intent),evidence:[{criterionId:'C-manual',requirement:'independent documentation review',reference:'synthetic-host-review:17'}]})};
  const runDriver=namespaceTransport(f.root);
  const states=[join(f.root,'synthetic-state-1'),join(f.root,'synthetic-state-2')];
  for(const state of states)mkdirSync(state,{mode:0o700});
  let input='',invocation=0;
  const runs:ReturnType<typeof runDriver>[]=[];
  await ownedEngine(t,f,(args)=>{
    if(args[0]==='create')input=args[args.indexOf('--mount')+1].match(/src=([^,]+)/)![1];
    if(args[0]==='start'){
      const actual=runDriver(input,states[invocation===1?1:0]);invocation++;
      t.diagnostic(JSON.stringify({namespaceRun:invocation,...actual}));
      assert.deepEqual(readFileSync(join(input,'acceptance/probes/export.mjs')),readFileSync(new URL('./fixtures/acceptance-local-probe.mjs',import.meta.url)));
      assert.equal(readFileSync(join(input,'acceptance/fixtures/rows.json'),'utf8'),'[1,2]');
      runs.push(actual);return actual;
    }
  });
  const outputs:any[]=[];
  for(let run=0;run<2;run++){
    const h=reserveAcceptanceBaseline(f.request,grant);
    assert.equal(await startAcceptanceBaseline(h).finished,0);
    const observed=readAcceptanceBaseline(h);
    assert.equal(observed.policy.status,'valid');
    const output=JSON.parse(readFileSync(join(h.directory,'sandbox-output.json'),'utf8'));
    assert.equal(output.observations?.length,1,'real driver must retain actual probe stdout/stderr, not a synthetic engine result');
    const probe=output.observations[0];
    assert.equal(probe.status,0);
    assert.deepEqual(JSON.parse(probe.stderr),{sha:f.request.sha,seed:[1,2],upload:'seed upload',setup:'pinned setup executed',readOnlyInput:true,hostProjectVisible:false,syntheticOnly:true});
    assert.deepEqual(JSON.parse(probe.stdout),{version:1,assertions:[{assertionId:'A-summary',status:'expected-behavioral-fail',failureId:'summary-unavailable-or-wrong'},{assertionId:'A-order',status:'pass',failureId:null}]});
    assert.equal(output.sha,f.request.sha);assert.equal(output.reset.executionId,h.executionId);
    assert.ok(observed.receipt.results!.assertions.every(a=>a.evidence.every(ref=>ref.startsWith(`baseline:${h.executionId}/P-export/`))));
    outputs.push(output);
  }
  assert.notEqual(outputs[0].reset.executionId,outputs[1].reset.executionId);
  // Reusing the first run's actual dirty site is unsupported, not successful reset or behavioral red.
  const h=reserveAcceptanceBaseline(f.request,grant);
  assert.equal(await startAcceptanceBaseline(h).finished,0);
  const refused=readAcceptanceBaseline(h);
  assert.equal(refused.policy.status,'hold');assert.equal(refused.receipt.results,null);
  assert.equal(refused.receipt.cleanup,'confirmed');
  assert.deepEqual(runs.map(r=>r.status),[0,0,1]);
  assert.equal(runs[2].stderr,'Error: Synthetic local setup failed','real driver refuses failed reset; it intentionally does not forward setup stderr');
  assert.equal(runs[2].stdout,'','setup failure cannot fabricate a reset/assertion envelope');
  assert.equal(readFileSync(join(states[0],'site/rows.json'),'utf8'),'[999]');
  assert.equal(readFileSync(join(states[0],'site/uploads/dirty.txt'),'utf8'),'prior-run dirt');
  assert.equal(readBaselineReservations(f.paths.state).length,0);
  assert.equal(f.git('status','--porcelain=v1'),before);
  assert.deepEqual(readFileSync(join(f.paths.project,'setup.mjs')),sourceSetup);
  assert.equal(f.git('rev-parse','HEAD'),f.request.sha);
});

function deferred<T=void>() { let resolve!: (v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}; }
function waitFile(file:string):Promise<void> {
  if(existsSync(file))return Promise.resolve();
  return new Promise(resolve=>{const watcher=watch(join(file,'..'),()=>{if(existsSync(file)){watcher.close();resolve();}});if(existsSync(file)){watcher.close();resolve();}});
}
async function ownedEngine(t:any,f:ReturnType<typeof fixture>,hook:(args:string[],state:any)=>Promise<any>|any=()=>undefined){
  const state={labels:{} as any,plan:null as any,calls:[] as string[][]};
  await engine(t,f,async(args)=>{
    state.calls.push(args);const custom=await hook(args,state);if(custom!==undefined)return custom;
    if(args[0]==='info')return {stdout:'engine-1'};
    if(args[0]==='image')return {stdout:JSON.stringify([{Id:'sha256:'+'a'.repeat(64),RepoDigests:[f.request.image],Config:{Volumes:null}}])};
    if(args[0]==='create'){
      state.labels=Object.fromEntries(args.flatMap((a,i)=>a==='--label'?[args[i+1].split('=')]:[]));
      const input=args[args.indexOf('--mount')+1].match(/src=([^,]+)/)![1];state.plan=JSON.parse(readFileSync(join(input,'plan.json'),'utf8'));
      return {stdout:'owned-container'};
    }
    if(args[0]==='inspect')return {stdout:JSON.stringify([{Id:'owned-container',Config:{Image:f.request.image,Labels:state.labels}}])};
    if(args[0]==='start')return {stdout:JSON.stringify({version:1,sha:f.request.sha,reset:{kind:'project-local-synthetic-v1',executionId:state.plan.executionId},results:result(f)})};
    if(args[0]==='rm'||args[0]==='ps')return {stdout:''};
    return {status:1};
  });return state;
}

test('authenticated cancellation kills in-flight engine transport, cleans exactly, and cannot publish late green or release another generation',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred<any>();
  await ownedEngine(t,f,args=>{if(args[0]==='start'){entered.resolve();return release.promise;}});
  const h=reserveAcceptanceBaseline(f.request,f.authorization),worker=startAcceptanceBaseline(h);await entered.promise;
  for(const foreign of [{...h,token:'foreign'},{...h,generation:'stale'},{...h,ownerId:'another-owner'}])assert.equal(cancelAcceptanceBaseline(foreign),false);
  assert.equal(readBaselineReservations(f.paths.state).length,1);
  assert.equal(cancelAcceptanceBaseline(h),true);release.resolve({stdout:JSON.stringify({results:result(f)})});
  assert.equal(await worker.finished,0);
  const observed=readAcceptanceBaseline(h);assert.equal(observed.policy.status,'hold');assert.equal(observed.receipt.results,null);
  assert.equal(cancelAcceptanceBaseline(h),false);
  assert.throws(()=>startAcceptanceBaseline(h),/EEXIST/,'the same reservation never retries probes');
});

test('initiating controller death does not end detached lifecycle ownership or release its capacity before exact cleanup',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred<any>();let plan:any;
  await ownedEngine(t,f,(args,state)=>{if(args[0]==='start'){plan=state.plan;entered.resolve();return release.promise;}});
  const controller=fork(resolve('orchestrator/fixtures/acceptance-controller.mjs'),[new URL('./acceptance-runner.mts',import.meta.url).href,new URL('./acceptance-contract.mts',import.meta.url).href],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  controller.stderr!.on('data',b=>process.stderr.write(b));
  t.after(()=>controller.kill('SIGKILL'));await once(controller,'message');controller.send(f.request);
  const [{handle:h}]=await once(controller,'message');await entered.promise;
  controller.kill('SIGKILL');await once(controller,'exit');
  assert.equal(readBaselineReservations(f.paths.state).length,1);
  assert.equal(claimRun({dir:f.paths.state,iid:'8',pid:process.pid,project:'foreign/project',cap:1}).ok,false);
  const published=waitFile(join(h.directory,'receipt.json'));
  release.resolve({stdout:JSON.stringify({version:1,sha:f.request.sha,reset:{kind:'project-local-synthetic-v1',executionId:plan.executionId},results:result(f)})});
  await published;
  // The immutable receipt is published under the same admission lock before capacity release.
  admissionBarrier(f.paths.state);
  assert.equal(readBaselineReservations(f.paths.state).length,0);
  assert.equal(readAcceptanceBaseline(h).receipt.cleanup,'confirmed');
});
function admissionBarrier(dir:string){withAdmission(dir,()=>{});}
import { withAdmission, writeBaselineReservations } from '../board/admission.mts';

test('a late old worker cannot settle or release a successor reservation generation',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred<any>();let plan:any;
  await ownedEngine(t,f,(args,state)=>{if(args[0]==='start'){plan=state.plan;entered.resolve();return release.promise;}});
  const h=reserveAcceptanceBaseline(f.request,f.authorization),worker=startAcceptanceBaseline(h);await entered.promise;
  // Real persisted fencing fault, not a mocked admission or settlement result.
  withAdmission(f.paths.state,()=>{const current=readBaselineReservations(f.paths.state);current[0].generation='successor-generation';writeBaselineReservations(f.paths.state,current);});
  release.resolve({stdout:JSON.stringify({version:1,sha:f.request.sha,reset:{kind:'project-local-synthetic-v1',executionId:plan.executionId},results:result(f)})});
  assert.equal(await worker.finished,2);assert.equal(cancelAcceptanceBaseline(h),false);
  assert.equal(readBaselineReservations(f.paths.state)[0].generation,'successor-generation');
  assert.equal(existsSync(join(h.directory,'receipt.json')),false);
});

test('worker crash, ambiguous creation, foreign engine/owner and exhausted deadline retain durable holds without age release',async t=>{
  for(const mode of ['worker-crash','ambiguous-create','foreign-owner','foreign-engine','late','overflow','image-volume'])await t.test(mode,async t=>{
    const f=fixture(t),entered=deferred(),release=deferred<any>();
    const state=await ownedEngine(t,f,(args,state)=>{
      if(mode==='image-volume'&&args[0]==='image')return {stdout:JSON.stringify([{Id:'sha256:'+'a'.repeat(64),RepoDigests:[f.request.image],Config:{Volumes:{'/var/lib/mysql':{}}}}])};
      if(mode==='ambiguous-create'&&args[0]==='create')return {status:1,stderr:'daemon outcome unknown'};
      if(mode==='foreign-owner'&&args[0]==='inspect')return {stdout:JSON.stringify([{Id:'owned-container',Config:{Image:f.request.image,Labels:{...state.labels,'factory.baseline.owner':'foreign'}}}])};
      if(mode==='foreign-engine'&&args[0]==='info'&&state.calls.filter(a=>a[0]==='info').length>1)return {stdout:'different-engine'};
      if(mode==='overflow'&&args[0]==='start')return {stdout:'x'.repeat(f.request.bounds.outputBytes+1)};
      if(mode==='worker-crash'&&args[0]==='start'){entered.resolve();return release.promise;}
    });
    const h=reserveAcceptanceBaseline(f.request,f.authorization,mode==='late'?Date.now()-60001:Date.now()),worker=startAcceptanceBaseline(h);
    if(mode==='worker-crash'){await entered.promise;process.kill(worker.pid,'SIGKILL');release.resolve({status:1});}
    const code=await worker.finished;
    if(mode==='image-volume'){
      assert.equal(code,0);assert.equal(state.calls.some(a=>a[0]==='create'),false);assert.equal(readAcceptanceBaseline(h).policy.status,'hold');return;
    }
    assert.notEqual(code,0);
    withAdmission(f.paths.state,tx=>tx.commit());
    assert.equal(readBaselineReservations(f.paths.state).length,1,'even a later real admission transaction never reaps a dead/old baseline');
    assert.equal(state.calls.some(a=>a[0]==='rm'),false,'unknown/foreign ownership never gets removal authority');
    assert.throws(()=>readAcceptanceBaseline(h));
    assert.equal(cancelAcceptanceBaseline({...h,generation:'stale'}),false);
    assert.equal(claimRun({dir:f.paths.state,iid:'8',pid:process.pid,project:'foreign/project',cap:1}).ok,false);
  });
});
