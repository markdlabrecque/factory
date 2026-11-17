// Cheap original/basis units and one disposable real read-only Git/filesystem boundary; tracker transport is controlled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { collectSupervisorInput, readSupervisorOriginal, supervisorDecisionSources } from '../src/supervisor-input.mts';
import { readinessFixture } from './ticket-readiness-fixture.mts';
import { loadExecutionContext } from '../../orchestrator/context.mts';
import { structuredContextSource } from '../../orchestrator/ticket-context-source.mts';
import { collectSupervisorTicketInput } from '../src/supervisor-facts.mts';
import { saveTicketInput } from '../../orchestrator/ticket-input.mts';
import { emptyAdmission, keyFor, ownerOf } from '../../board/admission.mts';
import { projectId, receiptFile, canonicalWorktree } from '../../orchestrator/ownership.mts';
import { emptySupervisor, transitionSupervisor } from '../src/supervisor-state.mts';
import { reviewFixture } from './supervisor-fixture.mts';
import { sourceHash, supervisorHash } from '../../orchestrator/supervisor-contract.mts';
import { diagnosisBasis } from '../../orchestrator/supervisor.mts';
import { MODEL_POLICY, MODEL_POLICY_ID, AGENT_POLICY } from '../../orchestrator/model-policy.mts';
const at = '2026-11-17T12:00:00.000Z';

test('complete current saved execution freezes originals without modifying checkout or tracker', { timeout: 120000 }, async t => {
  const f = readinessFixture(t); mkdirSync(f.p.state,{recursive:true,mode:0o700}); chmodSync(f.p.state,0o700);
  const output = join(f.home,'originals'); mkdirSync(output,{mode:0o700});
  const c = await loadExecutionContext({env:f.runtime.env,cwd:f.root,moduleRoot:f.runtime.directory});
  let human = 'Original human instruction', changed = false, second = false; const requests: string[][] = [];
  const source = structuredContextSource({kind:'github',host:'github.com',project:'owner/repo'}, ({args},budget) => {
    assert(budget.timeoutMs > 0 && budget.maxBytes > 0); requests.push(args);
    assert.equal(args[0],'api'); assert(!args.includes('--method'),'zero tracker writes');
    const endpoint=args[1];
    if(endpoint==='graphql') return JSON.stringify({data:{repository:{issue:{parent:{number:90}}}}});
    const iid=endpoint.includes('/90')?90:7;
    if(!endpoint.includes('comments')) return JSON.stringify({number:iid,title:`Ticket ${iid}`,body:'Complete original body'});
    const page=Number(endpoint.match(/page=(\d+)$/)![1]);
    if(page===1) { if(iid===7 && changed) {second=!second;} return JSON.stringify(Array.from({length:100},(_,n)=>({id:iid*1000+n+1,body:n===0 && iid===7?human+(changed&&second?' changed':''):`Original comment ${n}`,user:{login:'human'},created_at:at,updated_at:at}))); }
    return JSON.stringify(page===2?[{id:iid*1000+101,body:'Last page original',user:{login:'human'},created_at:at,updated_at:at}]:[]);
  });
  const input = collectSupervisorTicketInput(source,7).input;
  const executionId='saved-execution', sha=f.git('rev-parse','HEAD'), evidence=join(f.root,'.factory','evidence','7');
  mkdirSync(evidence,{recursive:true}); writeFileSync(join(evidence,'verdict.md'),'VERDICT: FAIL\nOriginal failure detail\n');
  const run={project:'owner/repo',iid:'7',executionId,implementationBaseSha:sha,branch:'main',base:'main',stage:'stopped',evidenceDir:evidence,
    ticketInput:{hash:input.hash,renderedSha256:input.textHash}};
  const runFile=join(f.p.state,`${keyFor('7','owner/repo')}.json`); writeFileSync(runFile,JSON.stringify(run));
  saveTicketInput(join(f.p.state,'ticket-inputs',keyFor('7','owner/repo'),executionId),input);
  const receipt=receiptFile(f.p.state,projectId(f.root,source.identity),'7'); mkdirSync(join(receipt,'..'),{recursive:true});
  writeFileSync(receipt,JSON.stringify({version:1,projectId:projectId(f.root,source.identity),projectRoot:f.root,ticket:'7',branch:'main',base:'main',implementationBaseSha:sha,
    worktreePath:canonicalWorktree(f.root,'main'),runId:executionId,createdAt:at,updatedAt:at,creationIntent:{branch:false,worktree:false,at},gitCommonDir:f.git('rev-parse','--path-format=absolute','--git-common-dir')}));
  const admission=emptyAdmission(); admission.generations['owner/repo']=1;
  mkdirSync(join(f.p.state,'admission'),{recursive:true}); const admissionFile=join(f.p.state,'admission','state.json'); writeFileSync(admissionFile,JSON.stringify(admission));
  writeFileSync(join(f.root,'dirty.txt'),'preserved dirty original'); f.git('add','dirty.txt'); writeFileSync(join(f.root,'dirty.txt'),'preserved unstaged original');
  const before=()=>({status:f.git('status','--porcelain=v1'),index:sourceHash(readFileSync(join(f.root,'.git','index')).toString('hex')),refs:f.git('show-ref'),dirty:readFileSync(join(f.root,'dirty.txt'),'utf8')});
  const initial=before();
  const options={context:c,registry:f.p.projects,ticket:7,observedAt:at,output,tracker:source};
  const a=collectSupervisorInput(options), frozen=JSON.parse(readFileSync(join(a.directory,'originals.json'),'utf8'));
  assert.equal(diagnosisBasis(frozen.snapshot),a.basis); assert.equal(frozen.snapshot.material.policy,supervisorHash({MODEL_POLICY_ID,MODEL_POLICY,AGENT_POLICY,bindings:frozen.bindings}));
  assert.equal(frozen.snapshot.material.admissionGeneration,supervisorHash(frozen.bindings.ownership));
  const saved=JSON.parse(frozen.bindings.run), manifest=JSON.parse(frozen.bindings.runtimeManifest);
  assert.deepEqual(frozen.snapshot.material,{runId:saved.executionId,base:saved.base,baseline:saved.implementationBaseSha,tip:frozen.bindings.tip,
    runtime:manifest.id,dependencies:manifest.dependencies,settings:supervisorHash(frozen.bindings.settings),
    policy:supervisorHash({MODEL_POLICY_ID,MODEL_POLICY,AGENT_POLICY,bindings:frozen.bindings}),ticketInput:frozen.ticketInput.hash,admissionGeneration:supervisorHash(frozen.bindings.ownership)});
  for(const s of frozen.snapshot.sources) assert.equal(sourceHash(s.text),s.sha256);
  assert.equal(statSync(a.directory).mode&0o777,0o700); assert.equal(statSync(join(a.directory,'originals.json')).mode&0o777,0o600);
  assert(a.snapshot.sources.find(s=>s.role==='human-planning')!.text.includes('Last page original'));
  assert(requests.some(a=>a[1].includes('/90/comments?')&&a[1].endsWith('page=2')));
  // Own hold/publication does not enter material originals or the authoritative prior-decision set.
  mkdirSync(join(f.p.state,'supervisor'),{recursive:true}); const state=emptySupervisor(a.snapshot.project); state.revision=1; state.events[supervisorHash('own-publication')]=supervisorHash('event'); state.history=[{event:'own-publication',at,kind:'observe'}];
  writeFileSync(join(f.p.state,'supervisor','state.json'),JSON.stringify({version:1,projects:{[supervisorHash(f.root)]:state}}));
  const b=collectSupervisorInput({...options,observedAt:'2026-11-17T12:00:01.000Z'}); assert.equal(b.basis,a.basis);
  human='Genuine new human material decision'; const next=collectSupervisorInput({...options,observedAt:'2026-11-17T12:00:02.000Z'}); assert.notEqual(next.basis,a.basis);
  changed=true; assert.throws(()=>collectSupervisorInput({...options,observedAt:'2026-11-17T12:00:03.000Z'}),/Ticket-input hold/); changed=false;
  writeFileSync(runFile,JSON.stringify({...run,executionId:undefined})); assert.throws(()=>collectSupervisorInput(options),/legacy/); writeFileSync(runFile,JSON.stringify(run));
  unlinkSync(runFile); assert.throws(()=>collectSupervisorInput(options),/ENOENT/); writeFileSync(runFile,JSON.stringify(run));
  writeFileSync(join(evidence,'verdict.md'),'x'.repeat(262145)); assert.throws(()=>collectSupervisorInput(options),/oversized/);
  unlinkSync(join(evidence,'verdict.md')); assert.throws(()=>collectSupervisorInput(options),/no complete saved failure/);
  writeFileSync(join(evidence,'verdict.md'),'VERDICT: FAIL\nOriginal failure detail\n');
  symlinkSync(runFile,join(f.home,'alias')); assert.throws(()=>readSupervisorOriginal(join(f.home,'alias')),/aliased/);
  assert.throws(()=>collectSupervisorInput({...options,context:{...c,config:{...c.config,workflow:{mode:'project',directory:'override'}}} as any}),/override collection is unsupported/);
  const savedTextFile=join(f.p.state,'ticket-inputs',keyFor('7','owner/repo'),executionId,'ticket-context.txt');
  const savedText=readFileSync(savedTextFile); writeFileSync(savedTextFile,'Stale rendered original'); assert.throws(()=>collectSupervisorInput(options),/saved execution ticket-input originals are missing\/stale/); writeFileSync(savedTextFile,savedText);
  admission.entries['new-managed-owner']={id:'new-managed-owner',project:a.snapshot.project,owner:ownerOf(process.pid)};
  writeFileSync(admissionFile,JSON.stringify(admission)); assert.throws(()=>collectSupervisorInput(options),/retains project ownership/,'new ownership without generation change revalidates exclusion'); delete admission.entries['new-managed-owner'];
  writeFileSync(admissionFile,JSON.stringify({...admission,version:1})); assert.throws(()=>collectSupervisorInput(options),/legacy admission/);
  assert.deepEqual(before(),initial,'dirty bytes, index and refs unchanged for successful and refused collection');
});

test('audited human resolution is authoritative with original bytes and never clears the retained human hold',()=>{
  const f=reviewFixture(), project=f.input.snapshot.project, p=f.input.proposal;
  let state=emptySupervisor(project);
  const apply=(event: any)=>{state=transitionSupervisor(state,{id:`event-${state.revision}`,at,...event},{ownerState:()=> 'dead'});};
  apply({kind:'observe',facts:f.authorization.facts,snapshotHash:p.snapshotHash,reason:'Original evidence'});
  apply({kind:'proposal',proposal:p});
  apply({kind:'human',request:{version:1,id:'held-request',project,scope:p.scope,incidentId:p.incidentId,proposalId:p.id,reason:'authority-uncertain',question:'Original human question',evidence:['fixture:original'],nextAction:'Inspect original evidence',delivery:{state:'pending',attempts:0},stop:'required'}});
  const raw=()=>JSON.stringify({version:1,projects:{[supervisorHash(project.root)]:state}},null,2);
  const before=supervisorDecisionSources(raw(),project,236,at);
  apply({kind:'resolve-human',incidentId:p.incidentId,requestId:'held-request',proposalId:p.id,actor:'local-human',reason:'Preserve original run; abandon this advice',nextProposalId:null});
  const after=supervisorDecisionSources(raw(),project,236,at);
  assert.notDeepEqual(after,before); assert.equal(after.length,1); assert.equal(JSON.parse(after[0].text).reason,'Preserve original run; abandon this advice');
  assert(raw().includes(after[0].text),'exact decision bytes, not a summary or reserialization');
  assert.equal(state.incidents[p.incidentId].incident.state,'human-required');
});

test('no decisions is explicit, mutable publication/counters are not authoritative sources',()=>{
  const project={root:'/fixture/project',tracker:{kind:'github' as const,host:'github.com',project:'owner/repo'}};
  const s=emptySupervisor(project), wrap=()=>JSON.stringify({version:1,projects:{[supervisorHash(project.root)]:s}});
  const before=supervisorDecisionSources(wrap(),project,7,at); assert.equal(before[0].status,'not-applicable');
  s.revision++; s.events[supervisorHash('publication')]=supervisorHash('event'); s.history.push({event:'publication',at,kind:'observe'});
  assert.deepEqual(supervisorDecisionSources(wrap(),project,7,at),before);
});
