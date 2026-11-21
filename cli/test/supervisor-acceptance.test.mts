// Offline copied-public-CLI controls, capability audit and advisory wiring journeys.
// Unsupported action journeys remain blocked; provider/platform responses are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, chmodSync, readdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readinessFixture } from './ticket-readiness-fixture.mts';
import { install } from './runtime-fixture.mts';
import { Fake } from '../src/platform/fake.mts';
import { record } from '../src/manifest.mts';
import { resolveWorkflow } from '../../orchestrator/workflow.mts';
import { projectFixture } from './workflow-fixture.mts';
import { supervisorFixture, AT } from './supervisor-fixture.mts';
import { commitSupervisor, readSupervisor, supervisorFile } from '../src/supervisor-state.mts';
import { ownerOf, readAdmission } from '../../board/admission.mts';
import { normalEntrypointFixture } from '../../orchestrator/verification-entrypoint-fixture.mts';
import { ADVISORY_PROFILE_ID, SUBSCRIPTION_PROFILE_ID } from '../src/supervisor-advisory-contract.mts';
import { supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('copied public supervisor refuses activation; selected runtime and complete overrides cannot manufacture capabilities', async t => {
  const f = readinessFixture(t);
  // The shared readiness helper already published this fixture-owned runtime.
  record(f.p, { kind: 'dir', path: f.p.runtimes });
  record(f.p, { kind: 'file', path: f.p.runtimeDescriptor });
  await install(f.p, new Fake(f.p)); // Disposable copied app only; injected package and service boundaries.
  const env = { ...f.runtime.env, FACTORY_HOME: f.home, SANDCASTLE_STATE_DIR: f.p.state,
    PATH: `${f.bin}:${process.env.PATH}`, HOME: f.home };
  // Reject the managed tracker wrapper too; no live tracker/model/service fallback is permitted.
  for (const name of ['gh-axi', 'gh', 'op'])
    writeFileSync(join(f.bin, name), readFileSync(join(f.bin, 'pi')), { mode: 0o755 });
  const cli = (args: string[]) => spawnSync(process.execPath, [join(f.p.app, 'cli/bin/factory.mts'), ...args, '--project', f.root],
    { cwd: f.root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  const run = (code: string) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code],
      { cwd: f.root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  };
  writeFileSync(join(f.root, 'saved.md'), 'saved operator work\n'); f.git('add', 'saved.md');
  writeFileSync(join(f.root, 'saved.md'), 'dirty operator work\n');
  const work = () => ({ status: f.git('status', '--porcelain=v1'), refs: f.git('show-ref'),
    index: f.git('diff', '--cached'), dirty: readFileSync(join(f.root, 'saved.md'), 'utf8') });
  const original = work(), base = readFileSync(f.config, 'utf8');
  for (const family of ['openai', 'anthropic'] as const) {
    // Configured-family contracts only: no semantic model or provider-enforcement claim.
    const config = base + `\n[agent]\nfamily = "${family}"\n`;
    writeFileSync(f.config, config);
    for (const action of ['status', 'explain']) {
      const result = cli(['supervisor', action, '--json']); assert.equal(result.status, 0, result.stderr);
      const view = JSON.parse(result.stdout); assert.equal(view.mode, 'observe');
      assert.equal(view.hostDecision.actionAuthorized, false);
    }
    assert.equal(existsSync(supervisorFile(f.p.state)), false, 'public reads create no journal');
    let selected = resolveWorkflow(f.root, f.p.runtimeDescriptor);
    const contracts = run(`const {modelForRole}=await import(${JSON.stringify(join(selected.root, 'model-policy.mts'))});
      const {loadTomlConfig}=await import(${JSON.stringify(join(selected.root, 'project-config.mts'))});
      const config=loadTomlConfig(${JSON.stringify(join(f.root, '.factory'))});
      console.log(JSON.stringify({policy:config.supervisor,family:config.AGENT.family,
        diagnosis:modelForRole(config.AGENT.family,'supervisor'),review:modelForRole(config.AGENT.family,'gateReview')}));`);
    assert.equal(contracts.family, family);
    assert.deepEqual(contracts.policy, { enabled: false });
    assert.equal(contracts.diagnosis.tier, 'mid'); assert.equal(contracts.review.tier, 'large');
    assert.notEqual(contracts.diagnosis.model, contracts.review.model);
    // Exercise the actual selected transport without a host binding, exactly as default tick constructs it.
    const hints = run(`const {supervisorWakeups}=await import(${JSON.stringify(join(selected.root, 'supervisor-schedule.mts'))});
      const results=[]; const hook=supervisorWakeups(()=>undefined,r=>results.push(r));
      hook.enqueue(${JSON.stringify(f.root)},'checkpoint'); hook.handoff(new AbortController().signal); await hook.settled(); console.log(JSON.stringify(results));`);
    assert.equal(hints[0].state, 'held'); assert.match(hints[0].reason, /No trusted supervisor/);
    assert.equal(existsSync(supervisorFile(f.p.state)), false);
    const finite = `\n[supervisor]\nenabled = true\nmax_tokens = 1000\nmax_cost_usd = 1\nmax_calls = 10\n[supervisor.diagnosis]\nmax_tokens = 100\nmax_cost_usd = 0.1\nmax_calls = 2\ntimeout_seconds = 30\n[supervisor.review]\nmax_tokens = 100\nmax_cost_usd = 0.1\nmax_calls = 2\ntimeout_seconds = 30\n`;
    writeFileSync(f.config, config + finite);
    const refused = cli(['supervisor', 'mode', 'act', '--pilot', '--confirm']);
    assert.equal(refused.status, 1); assert.match(refused.stderr, /activation unavailable/i);
    assert.equal(existsSync(supervisorFile(f.p.state)), false, 'explicit opt-in cannot bypass installed refusal');
    projectFixture(f.p, f.root); selected = resolveWorkflow(f.root, f.p.runtimeDescriptor);
    assert.equal(selected.mode, 'project'); assert.equal(selected.root, join(f.root, '.factory-workflow'));
    const opaque = cli(['supervisor', 'mode', 'act', '--pilot', '--confirm']);
    assert.equal(opaque.status, 1); assert.match(opaque.stderr, /opaque project workflow/);
    rmSync(join(selected.root, 'supervisor-schedule.mts'));
    assert.throws(() => resolveWorkflow(f.root, f.p.runtimeDescriptor), /no Factory fallback/);
    rmSync(selected.root, { recursive: true });
  }
  writeFileSync(f.config, base);
  assert.deepEqual(work(), original, 'all refusal/inspection paths preserve dirty work, index and refs');

  // Seed an exact owned reservation through the real journal API, not a fictitious installed worker.
  // This tests public cross-process stop honesty, not paid launch/cancellation or act admission.
  const a = supervisorFixture(f.root), project = a.snapshot.project;
  const commit = (event: any) => commitSupervisor(f.p.state, project, readSupervisor(f.p.state, project).revision, event);
  const observed = commit({ id: 'acceptance-observe', at: AT, kind: 'observe', facts: a.facts, snapshotHash: 'a'.repeat(64), reason: 'Synthetic retained worker observation' });
  commit({ id: 'acceptance-reserve', at: AT, kind: 'reserve', reservation: { id: 'acceptance-worker', incidentId: Object.keys(observed.incidents)[0], kind: 'diagnosis',
    owner: ownerOf(process.pid), fence: 'acceptance-fence', at: AT, deadline: '2026-11-17T12:01:00.000Z', reserved: { tokens: 10, cost: 10 }, actual: null, state: 'active', reviewId: null },
    limits: { project: { tokens: 100, cost: 100 }, shared: { tokens: 100, cost: 100 }, capacity: 1, reviewCalls: 1, reviewTimeoutMs: 60000 } });
  const before = readSupervisor(f.p.state, project);
  const stopped = cli(['supervisor', 'stop']); assert.equal(stopped.status, 1); assert.match(stopped.stdout, /cancellation\/accounting is pending/);
  const after = readSupervisor(f.p.state, project); assert.equal(after.control?.mode, 'stopped');
  assert.deepEqual(after.reservations, before.reservations); assert.deepEqual(after.charged, before.charged);
  const bytes = readFileSync(supervisorFile(f.p.state), 'utf8');
  const restarted = cli(['supervisor', 'status', '--json']); assert.equal(restarted.status, 0, restarted.stderr);
  const legacy = JSON.parse(restarted.stdout); assert.equal(legacy.cancellation.pendingTotal, 1);
  assert.deepEqual(legacy.owners[0].transport,{state:'unknown',reason:'missing-or-invalid-transport-observation'});
  assert.equal(readFileSync(supervisorFile(f.p.state), 'utf8'), bytes);
  assert.deepEqual(work(), original);
  assert.equal(existsSync(join(f.fake, 'unexpected.jsonl')), false);
  assert.equal(existsSync(join(f.fake, 'image-calls.jsonl')), false);
});

async function journey(t:any, unknown:boolean) {
  await normalEntrypointFixture(t,'no-commit-custody-public','openai','mid',true,async c=>{
    const {home,root,p,state,fake,bin,runtime,project,run,git,rawRun}=c;
    mkdirSync(p.config,{recursive:true,mode:0o700}); chmodSync(p.config,0o700); chmodSync(state,0o700);
    writeFileSync(p.projects,JSON.stringify({version:1,projects:[{name:'fixture',root,schedule:{enabled:true,branch:'main',since:new Date().toISOString()}}]}));
    writeFileSync(join(p.config,'supervisor.json'),JSON.stringify({version:1,enabled:true,profile:unknown ? SUBSCRIPTION_PROFILE_ID : ADVISORY_PROFILE_ID,capacity:1,cumulative:{tokens:10000000,cost:100000000,calls:1}}),{mode:0o600});
    // Synthetic user-approved expiring record, read through the default production source, NOT installed quiescence proof.
    writeFileSync(join(p.config,'supervisor-rollout.json'),JSON.stringify({version:1,project,host:runtime.id,hostDependencies:runtime.manifest.dependencies,
      selected:runtime.id,dependencies:runtime.manifest.dependencies,recordedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),
      olderRuntimesQuiesced:true,unmanagedWorkQuiesced:true}),{mode:0o600});
    const calls=join(fake,'public-programs.jsonl');
    writeFileSync(join(bin,'systemctl'),`#!${process.execPath}
import {appendFileSync} from 'node:fs';
const a=process.argv.slice(2);appendFileSync(${JSON.stringify(calls)},JSON.stringify({program:'systemctl',args:a})+'\\n');
if(a[0]!=='--user'||a[1]!=='show')process.exit(90);
console.log('LoadState=loaded\\nActiveState='+ (a[2].endsWith('.timer')?'active':'inactive')+'\\nUnitFileState=enabled');
`,{mode:0o755});
    // Replace normal-stage tracker with strict read-only complete-originals transport, recording every query.
    writeFileSync(join(bin,'gh'),`#!${process.execPath}
import {appendFileSync} from 'node:fs';const a=process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)},JSON.stringify({program:'gh',args:a})+'\\n');
if(a[0]!=='api'||a.some(v=>['POST','PATCH','PUT','DELETE'].includes(v)))process.exit(90);
if(a[1]==='graphql'){console.log(JSON.stringify({data:{repository:{issue:{parent:null}}}}));}
else if(a[1].includes('/comments')) console.log('[]');
else if(a[1].includes('/issues/7'))console.log(JSON.stringify({number:7,title:'Fix login',body:'Complete current human instruction: inspect retained no-commit evidence.'}));
else process.exit(90);
`,{mode:0o755});
    cpSync(join(bin,'gh'),join(bin,'gh-axi'));
    for(const name of ['docker','op','pi','npm']) writeFileSync(join(bin,name),`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(calls)},JSON.stringify({program:${JSON.stringify(name)},args:process.argv.slice(2)})+'\\n');process.exit(90);\n`,{mode:0o755});
    if(unknown) writeFileSync(join(bin,'pi'),`#!${process.execPath}
import {appendFileSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(calls)},JSON.stringify({program:'pi',args})+'\\n');
if(JSON.stringify(args)!==JSON.stringify(['auth','print-bearer-token','--min-expiry','50m','--provider','openai']))process.exit(90);
const journal=JSON.parse(readFileSync(${JSON.stringify(supervisorFile(state))},'utf8'));
if(Object.values(journal.projects).some(s=>Object.keys(s.reservations).length))process.exit(91);
console.log('synthetic-chatgpt-not-a-token');
`,{mode:0o755});
    // Deliberately retain both staged and unstaged work and an untracked file before diagnosis.
    writeFileSync(join(root,'staged.txt'),'staged original'); git(root,'add','staged.txt');
    writeFileSync(join(root,'app.txt'),'dirty original'); writeFileSync(join(root,'untracked.txt'),'untracked original');
    const worktree=join(root,'.factory/worktrees',run.branch);
    const preservation=()=>({status:git(root,'status','--porcelain=v1','--untracked-files=all'),refs:git(root,'show-ref'),index:readFileSync(join(root,'.git/index')).toString('base64'),
      worktrees:git(root,'worktree','list','--porcelain'),worktreeStatus:git(worktree,'status','--porcelain=v1','--untracked-files=all'),worktreeIndex:readFileSync(git(worktree,'rev-parse','--git-path','index')).toString('base64'),worktreeApp:readFileSync(join(worktree,'app.txt'),'utf8'),
      app:readFileSync(join(root,'app.txt'),'utf8'),staged:readFileSync(join(root,'staged.txt'),'utf8'),untracked:readFileSync(join(root,'untracked.txt'),'utf8'),run:readFileSync(join(state,'owner_repo--7.json'),'utf8')});
    const before=preservation(); assert.equal(before.run,rawRun);
    const trace=join(fake,'requests.jsonl'), config=join(fake,'public-preload.json');
    writeFileSync(config,JSON.stringify({unknown,trace,inputRoot:join(state,'supervisor',supervisorHash(root)),journal:supervisorFile(state),
      originalSource:fileURLToPath(new URL('../../',import.meta.url)),forbiddenOriginal:new URL('../src/paths.mts',import.meta.url).href}));
    const preload=new URL('./supervisor-acceptance-preload.mts',import.meta.url);preload.searchParams.set('config',config);
    const cli=join(p.app,'cli/bin/factory.mts');
    const env={HOME:home,FACTORY_HOME:home,PATH:`${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,LANG:'C',OPENAI_API_KEY:'sk-synthetic-offline-not-a-secret'};
    const evidence:any={executable:process.execPath,instrumentation:['--import',preload.href],source:p.app,runtime:runtime.directory,runtimeId:runtime.id,dependencies:runtime.manifest.dependencies,commands:[],synthetic:['read-only tracker/service replies','expiring operator assertion','HTTP SSE and usage; not remote enforcement, invoice or model quality']};
    const command=(...args:string[])=>{
      const argv=[cli,'supervisor',...args,'--project',root,...(unknown && args[0]==='diagnose' ? ['--auth','pi-login'] : [])];
      const r=spawnSync(process.execPath,['--import',preload.href,...argv],{env,cwd:root,encoding:'utf8',timeout:15000});
      evidence.commands.push({argv,status:r.status,stdout:r.stdout,stderr:r.stderr});
      return r;
    };
    if(!unknown){
      const r=command('diagnose','7','--json'); assert.equal(r.status,0,r.stdout+r.stderr);
      const first=JSON.parse(r.stdout);assert.equal(first.state,'proposed');assert.equal(first.recommendation.authority,'advice-only');
      assert.deepEqual(first.transport,{state:'observed',observation:{outcome:'http-response',status:200,requestId:'req_offline'}});
      assert.doesNotMatch(r.stdout,/sk-synthetic-offline-not-a-secret|synthetic-secret/);
      assert.equal(first.recommendation.nextStep.kind,'wait');assert.match(first.recommendation.rationale,/Synthetic typed wait/);
      const terminal=readSupervisor(state,project), charge=structuredClone(terminal.charged);
      const reservation=Object.values(terminal.reservations)[0];assert.equal(reservation.state,'finished');assert.deepEqual(reservation.actual,{tokens:35,cost:220});
      assert.equal(Object.values(terminal.advisory!.settlements!)[0].disposition,'retained-advice');
      assert.equal(Object.keys(readAdmission(state).supervisorHolds).length,0);
      const leases=join(p.runtimes,'.leases');assert.equal(existsSync(leases)?readdirSync(leases).length:0,0);
      const journalBytes=readFileSync(supervisorFile(state));
      const transportFile=join(state,'supervisor','usage',supervisorHash(project),supervisorHash(first.invocationId),'transport.json');
      const transportBytes=readFileSync(transportFile);
      for(const action of ['status','explain']) {
        const r=command(action,'--json');assert.equal(r.status,0,r.stdout+r.stderr);const view=JSON.parse(r.stdout);
        assert.deepEqual(view.proposedNextAction.recommendation,first.recommendation);
        assert.deepEqual(view.owners.find((v:any)=>v.id===first.invocationId).transport,first.transport);
        assert.deepEqual(view.diagnostics.find((v:any)=>v.invocationId===first.invocationId).transport,first.transport);
      }
      assert.deepEqual(readFileSync(supervisorFile(state)),journalBytes);assert.deepEqual(readFileSync(transportFile),transportBytes);
      writeFileSync(transportFile,'{malformed');
      for(const action of ['status','explain']) {
        const r=command(action,'--json');assert.equal(r.status,0,r.stdout+r.stderr);const view=JSON.parse(r.stdout);
        assert.deepEqual(view.owners.find((v:any)=>v.id===first.invocationId).transport,{state:'unknown',reason:'missing-or-invalid-transport-observation'});
        assert.deepEqual(view.diagnostics.find((v:any)=>v.invocationId===first.invocationId).transport,{state:'unknown',reason:'missing-or-invalid-transport-observation'});
      }
      assert.equal(readFileSync(transportFile,'utf8'),'{malformed');assert.deepEqual(readFileSync(supervisorFile(state)),journalBytes);
      writeFileSync(transportFile,transportBytes);
      const {buildSupervisorData}=await import(pathToFileURL(join(p.app,'board/supervisor.mts')).href);
      const board=await buildSupervisorData(state,0,{registry:p.projects,read:async()=>JSON.parse(command('status','--json').stdout)});
      assert.deepEqual(board.projects[0].status!.proposedNextAction!.recommendation,first.recommendation);
      const again=command('diagnose','7','--json');assert.equal(again.status,0,again.stdout+again.stderr);
      const reused=JSON.parse(again.stdout);assert.equal(reused.state,'reused');assert.equal(reused.diagnosticId,first.diagnosticId);assert.deepEqual(reused.basis,first.basis);
      assert.deepEqual(reused.transport,{state:'unknown',reason:'missing-or-invalid-transport-observation'},'a new invocation cannot inherit the prior request observation');
      assert.deepEqual(readSupervisor(state,project).charged,charge);assert.equal(Object.keys(readAdmission(state).supervisorHolds).length,0);
      assert.equal(existsSync(leases)?readdirSync(leases).length:0,0,'unchanged fresh diagnosis creates no runtime pin');
      assert.equal(Object.keys(readSupervisor(state,project).reservations).length,1,'unchanged fresh diagnosis creates no reservation');
    }else{
      const argv=[cli,'supervisor','diagnose','7','--project',root,'--json','--auth','pi-login'];
      const child=spawn(process.execPath,['--import',preload.href,...argv],{env,cwd:root,stdio:['ignore','pipe','pipe','ipc','pipe','pipe','pipe']});
      t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
      let stdout='',stderr='';child.stdout!.on('data',b=>stdout+=b);child.stderr!.on('data',b=>stderr+=b);
      const closed=once(child,'close');
      await Promise.race([once(child.stdio[5] as any,'data'),closed.then(()=>{throw Error('CLI ended before real send: '+stdout+stderr);})]);
      const sent=readSupervisor(state,project);assert.equal(Object.keys(sent.advisory!.sends).length,1);assert.equal(Object.values(sent.reservations)[0].state,'active');
      const stopped=command('stop');assert.equal(stopped.status,1,stopped.stdout+stopped.stderr);assert.match(stopped.stdout,/pending/);
      const pending=JSON.parse(command('status','--json').stdout);assert.equal(pending.cancellation.pendingTotal,1);
      const denied=command('diagnose','7','--json');assert.notEqual(denied.status,0);assert.equal(Object.keys(readSupervisor(state,project).advisory!.sends).length,1);
      const human=once(child,'message');(child.stdio[6] as any).write('x');
      const message=await Promise.race([human,closed.then(()=>{throw Error('CLI ended before durable human barrier: '+stdout+stderr);})]);
      assert.equal(message[0].kind,'durable-human');
      child.kill('SIGKILL');await closed;
      evidence.commands.push({argv,signal:child.signalCode,stdout,stderr,barrier:'after real parent-directory fsync of human journal'});
      const retained=readSupervisor(state,project), reservation=Object.values(retained.reservations)[0];
      assert.equal(reservation.actual,null);assert.notEqual(reservation.state,'finished');assert.deepEqual(retained.charged,sent.charged);
      assert.equal(retained.charged.diagnosis.tokens,reservation.reserved.tokens,'unknown usage retains the full token debit');
      assert.equal(retained.charged.diagnosis.cost,reservation.reserved.cost,'unknown usage retains the full cost debit');
      assert.equal(Object.keys(readAdmission(state).supervisorHolds).length,1);
      assert.ok(readdirSync(join(p.runtimes,'.leases')).length>0);
      assert.equal(Object.keys(retained.humans).length,1);assert.equal(Object.values(retained.humans)[0].delivery.attempts,0);
      const restart=JSON.parse(command('status','--json').stdout);assert.equal(restart.humanRequests.length,1);assert.equal(restart.cancellation.pendingTotal,1);
      const replacement=command('diagnose','7','--json');assert.notEqual(replacement.status,0);
      const managed=spawnSync(process.execPath,[cli,'run','7','--project',root],{env,cwd:root,encoding:'utf8',timeout:15000});
      evidence.commands.push({argv:[cli,'run','7','--project',root],status:managed.status,stdout:managed.stdout,stderr:managed.stderr});
      assert.notEqual(managed.status,0);assert.match(managed.stdout+managed.stderr,/held by supervisor/);
      assert.deepEqual(readSupervisor(state,project).charged,sent.charged);
    }
    assert.equal(readFileSync(trace,'utf8').trim().split('\n').length,1,'only one actual serialized request');
    assert.equal(Object.keys(readSupervisor(state,project).advisory!.sends).length,1);
    assert.deepEqual(preservation(),before,'dirty work, index, refs and exact saved normal execution preserved');
    evidence.journal=JSON.parse(readFileSync(supervisorFile(state),'utf8'));evidence.admission=readAdmission(state);
    const retainFiles=(directory:string)=>existsSync(directory)?Object.fromEntries(readdirSync(directory,{recursive:true,withFileTypes:true}).filter(d=>d.isFile()).map(d=>{
      const file=join(d.parentPath,d.name);return [file,readFileSync(file).toString('base64')];})):{};
    evidence.originalsAndOwnership=retainFiles(join(state,'supervisor'));
    evidence.runtimePins=retainFiles(join(p.runtimes,'.leases'));
    evidence.normalCustody=retainFiles(join(state,'payload-custody'));
    evidence.sourceFallback='Production import resolution denied against original repository; explicit negative import rejected in every public CLI process';
    evidence.manifest=runtime.manifest;
    const originals=Object.entries(evidence.originalsAndOwnership).filter(([name])=>name.endsWith('/originals.json')).map(([,bytes])=>JSON.parse(Buffer.from(bytes as string,'base64').toString()));
    assert.ok(originals.length>1,'fresh production collection rebuilt full originals');
    const prior=originals.map(o=>o.snapshot.sources.filter((s:any)=>s.role==='prior-decisions'));
    for(const sources of prior) assert.deepEqual(sources,prior[0],'cached output never becomes an authoritative prior decision');
    evidence.authoritativePriorSet=prior[0];
    assert.ok(evidence.normalCustody && Object.keys(evidence.normalCustody).length>0);
    evidence.request=JSON.parse(readFileSync(trace,'utf8'));
    assert.equal(evidence.request.payload.model,'gpt-6.1-terra');
    assert.equal(evidence.request.payload.stream,true);
    assert.equal(evidence.request.payload.store,false);
    assert.equal(evidence.request.payload.truncation,'disabled');
    assert.equal(evidence.request.payload.max_output_tokens,unknown ? undefined : 4096);
    if(unknown){assert.deepEqual(evidence.request.payload.reasoning,{effort:'high',summary:'auto'});assert.equal(Object.hasOwn(evidence.request.payload,'prompt_cache_options'),false);assert.equal(Object.values(readSupervisor(state,project).reservations)[0].reserved.cost,0);}
    evidence.programs=readFileSync(calls,'utf8');evidence.preservation=before;
    evidence.normalTrackerCalls=readFileSync(join(fake,'gh.jsonl'),'utf8');
    assert.equal(/"program":"(?:docker|op|npm)"/.test(evidence.programs),false,'no forbidden program invoked');
    assert.equal(evidence.programs.trim().split('\n').map((s:string)=>JSON.parse(s)).filter((v:any)=>v.program==='pi').length,unknown ? 1 : 0,'only explicit new subscription invocation exports synthetic auth');
    const artifact=process.env.FACTORY_270_EVIDENCE;
    if(artifact){mkdirSync(artifact,{recursive:true});writeFileSync(join(artifact,unknown?'journey-b.json':'journey-a.json'),JSON.stringify(evidence,null,2));}
    t.diagnostic(JSON.stringify({copiedCLI:cli,runtime:runtime.id,journey:unknown?'B':'A',requests:1,artifact:artifact??'not retained'}));
  });
}
// These journeys include the shared normal-entrypoint fixture before the public CLI calls.
test('copied public diagnosis retains non-executing advice and unchanged fresh CLI reuses it without another charge', {timeout:480_000},t=>journey(t,false));
test('copied public stop retains owned pending work and durable human request across controller loss with unknown usage', {timeout:480_000},t=>journey(t,true));
