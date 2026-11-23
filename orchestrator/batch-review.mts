// Host-only prospective gate: one immutable Git candidate per attempt, independent role receipts and durable per-batch/ticket rejection accounting.
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { frozenTicketIdentity, type FrozenTicketInput } from './ticket-input.mts';
import { candidatePack, prospectiveCommit, requestedContext, validateReviewInputs } from './batch-candidate.mts';
import { proposeImplementation, standardBatchSandbox, type BatchSandbox, type ProcessResult, type ReviewRole, type SendTurn } from './batch-sandbox.mts';
import type { EffectiveConfig } from './project-config.mts';
import { modelForRole } from './model-policy.mts';
import { resolveTicketModel } from './models.mts';

type GateIdentity = {image:string;configDigest:string};
type GateInputs = GateIdentity & {argv:string[];paths:string[]};
export interface BatchAttemptInput extends GateIdentity {
  repo: string; state: string; batch: string; destination: string; expectedHead: string; run: string;
  ticket: FrozenTicketInput; deltaBase: string; deltaTip: string; testArgv: string[]; testPaths: string[]; signal?:AbortSignal;
  // Host reads current ref AND the batch ownership ledger, not worker-reported Git state.
  observeHead(): Promise<{kind:'owned'|'unknown'; head:string}>;
}
/** Standard host composition; overrides must opt into their own contract, never inherit this gate. */
export function runStandardBatchAttempt(input: Omit<BatchAttemptInput,'testArgv'|'testPaths'|keyof GateIdentity>, config: EffectiveConfig, pinnedImage: string, reviewerCredential: () => string) {
  const checks = standardChecks(input,config,pinnedImage);
  return runBatchAttempt({...input,...checks,testArgv:checks.argv,testPaths:checks.paths},
    standardBatchSandbox(pinnedImage,modelForRole(config.AGENT.family,'verification').model,reviewerCredential,input.signal));
}
export function standardChecks(input: Pick<BatchAttemptInput,'ticket'>,config:EffectiveConfig,image:string):GateInputs {
  if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Unverifiable gate inputs: pinned image required');
  if (config.workflow.mode !== 'factory' || !config.config.batchTests) throw Error('Standard batch test configuration required');
  const id = input.ticket.context.identity, tracker = config.TRACKER;
  if (id.kind !== tracker.kind || id.host !== (tracker.gitlabHost ?? tracker.host) || id.project !== tracker.project) throw Error('Ticket does not belong to the pinned project');
  const policy={config,implementation:resolveTicketModel(input.ticket.context.child.description,config.AGENT.family),review:modelForRole(config.AGENT.family,'verification'),
    prompts:[template('implementation'),template('test'),template('code')],
    transport:['batch-checkout.mts','batch-candidate.mts','batch-sandbox.mts','batch-review.mts'].map(name=>createHash('sha256').update(readFileSync(new URL(`./${name}`,import.meta.url))).digest('hex'))};
  return {image,configDigest:createHash('sha256').update(JSON.stringify(policy)).digest('hex'),argv:[...config.config.batchTests.argv],paths:[...config.config.batchTests.paths]};
}
export interface AttemptBinding {
  project: string; batch: string; ticket: number; run: string; attempt: string; destination: string; expectedHead: string;
  requirementsDigest: string; gate:GateInputs; candidate: string; deltaBase: string; deltaTip: string;
}
export type ReviewReceipt = {binding: AttemptBinding; role: ReviewRole; invocation: string; followup?:{invocation:string;assessment:string;paths:string[]}; contextHold?:true; verdict: 'approve'|'reject'|'inconclusive'; reason: string};
export const BATCH_EVIDENCE_VERSION = 'batch-review-v4' as const;
export interface BatchEvidence {
  version: typeof BATCH_EVIDENCE_VERSION; binding: AttemptBinding;
  tests: {binding: AttemptBinding; argv: string[]; exit: number|null; stdout: string; stderr: string};
  reviews: ReviewReceipt[]; status: 'implementation'|'held'|'approved'|'rework'|'rebuild'|'stopped'; reason: string;
}
function openStore(root: string, readOnly = false) {
  if (!readOnly) mkdirSync(root,{recursive:true,mode:0o700});
  if (realpathSync(root) !== resolve(root) || (lstatSync(root).mode & 0o077)) throw Error('Private host gate directory required');
  const path = join(root,'batch-review.sqlite');
  try { const st = lstatSync(path); if (!st.isFile() || st.nlink !== 1) throw Error('Unsafe gate store'); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  const db = new DatabaseSync(path,{readOnly});
  if (readOnly) return db;
  chmodSync(path,0o600);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, scope TEXT NOT NULL, binding TEXT NOT NULL, rejected INTEGER NOT NULL DEFAULT 0, result TEXT);
    CREATE TABLE IF NOT EXISTS ready_deltas (scope TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS occupied ON attempts(scope) WHERE result IS NULL;`);
  return db;
}
function currentEvidence(raw:string):BatchEvidence {
  const evidence=JSON.parse(raw);
  if(evidence.version!==BATCH_EVIDENCE_VERSION) throw Error('Incompatible batch evidence; reconcile');
  const gate=evidence.binding?.gate;
  if(!gate || !/^sha256:[a-f0-9]{64}$/.test(gate.image)||!/^[a-f0-9]{64}$/.test(gate.configDigest)||!Array.isArray(gate.paths)||!gate.paths.length||!Array.isArray(gate.argv)||!gate.argv.length ||
    JSON.stringify(evidence.tests?.argv)!==JSON.stringify(gate.argv)||[evidence.tests,...evidence.reviews].some(r=>JSON.stringify(r?.binding)!==JSON.stringify(evidence.binding)))throw Error('Unverifiable recorded gate inputs');
  return evidence;
}
/** Read the host record, not a payload-provided receipt. A pending/crashed attempt has no evidence. */
export function readBatchEvidence(state: string, attempt: string): BatchEvidence | null {
  const db = openStore(state,true);
  try { const row = db.prepare('SELECT result FROM attempts WHERE id=?').get(attempt); return row?.result ? currentEvidence(String(row.result)) : null; }
  finally { db.close(); }
}
/** Resume discovery. A running/uncertain attempt is a hold, not another allowance or a delivery proof. */
export function latestBatchAttempt(state: string, project: string, batch: string, ticket: number): {binding:AttemptBinding; evidence:BatchEvidence|null} | null {
  const db = openStore(state,true);
  try {
    const row = db.prepare('SELECT id,binding,result FROM attempts WHERE scope=? ORDER BY rowid DESC LIMIT 1').get(JSON.stringify([project,batch,ticket]));
    if(!row)return null;
    const binding=JSON.parse(String(row.binding));
    if(binding.attempt!==row.id || binding.project!==project || binding.batch!==batch || binding.ticket!==ticket)throw Error('Attempt row identity mismatch');
    return {binding,evidence:row.result ? currentEvidence(String(row.result)) : null};
  } finally { db.close(); }
}
export function classifyBatchReview(testsPassed: boolean, reviews: Pick<ReviewReceipt,'role'|'verdict'|'invocation'>[], previousRejections: number): Pick<BatchEvidence,'status'|'reason'> {
  if (!testsPassed) return {status:'implementation',reason:'Candidate tests did not pass'};
  if (reviews.some(r => r.verdict === 'reject')) return previousRejections >= 2
    ? {status:'stopped',reason:'Both review reworks exhausted'} : {status:'rework',reason:'Reviewer rejected this candidate'};
  if (reviews.length !== 2 || !(['test','code'] as const).every(role => reviews.some(r => r.role === role && r.verdict === 'approve')) || reviews[0].invocation === reviews[1].invocation)
    return {status:'held',reason:'Two independent explicit approvals unavailable'};
  return {status:'approved',reason:'Tests and both reviews passed; not delivered'};
}
function verdict(result: ProcessResult): Pick<ReviewReceipt,'verdict'|'reason'> {
  if (result.exit === 0 && Buffer.byteLength(result.stdout) <= 16384) try {
    const r = JSON.parse(result.stdout);
    if (Object.keys(r).sort().join(',') === 'reason,verdict' && ['approve','reject','inconclusive'].includes(r.verdict) && typeof r.reason === 'string' && r.reason.trim() && r.reason.length <= 2000) return r;
  } catch { /* Missing or malformed verdict is not approval. */ }
  return {verdict:'inconclusive', reason:'Reviewer returned no usable verdict'};
}
function contextRequest(result:ProcessResult):{assessment:string;paths:unknown}|undefined {
  if(result.exit!==0 || Buffer.byteLength(result.stdout)>16384)return;
  try {const parsed=JSON.parse(result.stdout);
    if(parsed && typeof parsed==='object' && Object.hasOwn(parsed,'context'))return {assessment:parsed.assessment,paths:Object.keys(parsed).sort().join(',')==='assessment,context' && typeof parsed.assessment==='string' && parsed.assessment.trim() && parsed.assessment.length<=2000?parsed.context:null};
  } catch { /* Normal verdict parser handles unusable output. */ }
}
async function reviewRole(sandbox:BatchSandbox,repo:string,binding:AttemptBinding,role:ReviewRole,initial:string):Promise<ReviewReceipt>{
  const invocation=randomUUID(),identity={binding,role,invocation};
  const hold={...identity,contextHold:true as const,verdict:'inconclusive' as const,reason:'Unusable optional test-context request or response'};
  const assess=async(send:SendTurn,continuable:boolean):Promise<ReviewReceipt>=>{
    const first=await send(initial),request=contextRequest(first);
    if(!request)return {...identity,...verdict(first)};
    if(!continuable)return hold;
    const deadline=performance.now()+60_000, candidate=binding.candidate;
    const implementationContext=requestedContext(repo,candidate,request.paths,deadline);
    const followup={invocation,assessment:request.assessment,paths:implementationContext.map(x=>x.path)};
    const prompt='Final context stage: return a verdict now.\n'+JSON.stringify({candidate,implementationContext});
    const left=Math.floor(deadline-performance.now());if(left<1 || Buffer.byteLength(prompt)>8*1024*1024)return hold;
    // The standard transport kills the child on deadline. Fence injected or late replies too.
    let timer:ReturnType<typeof setTimeout>|undefined;
    const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Review deadline')),left)});
    try {
      const result=verdict(await Promise.race([expired,send(prompt,left)]));
      if(performance.now()>deadline||result.verdict==='inconclusive')return {...hold,followup};
      return {...identity,followup,...result};
    } finally {clearTimeout(timer)}
  };
  try {
    const pins={repo,base:binding.expectedHead,candidate:binding.candidate,testPaths:binding.gate.paths};
    if(role==='test' && sandbox.withTestSession)return await sandbox.withTestSession(invocation,send=>assess(send,true),pins);
    return await assess(prompt=>sandbox.review(role,invocation,prompt,pins),false);
  } catch {return hold}
}
export function batchImplementationPrompt(ticket: FrozenTicketInput) {
  frozenTicketIdentity(ticket);
  return template('implementation') + '\n' + ticket.text;
}
function template(role: 'implementation'|ReviewRole) { return readFileSync(new URL(`./prompt.batch-${role}.md`,import.meta.url),'utf8'); }
/** Entry for one already-admitted member. The caller retains its exclusive admission claim across this call.
 * No worker-provided tip, selection, receipt or publish capability is accepted here. */
export async function runStandardBatchMember(input: Omit<BatchAttemptInput,'deltaBase'|'deltaTip'|'testArgv'|'testPaths'|keyof GateIdentity>, config:EffectiveConfig, image:string, providerCredential:()=>string):Promise<BatchEvidence> {
  input.signal?.throwIfAborted();
  const checks=standardChecks(input,config,image), prompt=batchImplementationPrompt(input.ticket), id=input.ticket.context.identity;
  const project=`${id.kind}://${id.host}/${id.project}`, ticket=input.ticket.context.child.iid;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input.batch) || input.destination!==`refs/heads/factory/batch/${input.batch}` || !input.run?.trim() || !/^[0-9a-f]{40}$/.test(input.expectedHead)) throw Error('Invalid admitted batch identity');
  if(resolve(input.state)===realpathSync(input.repo) || resolve(input.state).startsWith(realpathSync(input.repo)+'/')) throw Error('Gate store must be outside the project');
  const model=resolveTicketModel(input.ticket.context.child.description,config.AGENT.family);
  if(model.status!=='resolved') throw Error('Unresolved batch implementer model');
  const sandbox=standardBatchSandbox(image,modelForRole(config.AGENT.family,'verification').model,providerCredential,input.signal);
  const scope=JSON.stringify([project,input.batch,ticket]);
  type Ready={gate:GateInputs;id:string;run:string;requirements:string;destination:string;previous:string|null;base:string;start:string;tip:string};
  const store=openStore(input.state);
  let ready:Ready|null;
  try {const row=store.prepare('SELECT payload FROM ready_deltas WHERE scope=?').get(scope);ready=row?JSON.parse(String(row.payload)):null}finally{store.close()}
  const prior=latestBatchAttempt(input.state,project,input.batch,ticket);
  if((prior?.evidence && JSON.stringify(prior.evidence.binding)!==JSON.stringify(prior.binding)) || (prior && JSON.stringify(prior.binding.gate)!==JSON.stringify(checks)) || (ready && JSON.stringify(ready.gate)!==JSON.stringify(checks)))throw Error('Changed or unverifiable gate inputs; hold for reconciliation');
  if (prior && (!prior.evidence || prior.binding.requirementsDigest!==input.ticket.hash || prior.binding.destination!==input.destination)) throw Error('Unresolved or changed batch original; reconcile before implementation');
  if(ready && (ready.run!==input.run || ready.requirements!==input.ticket.hash || ready.destination!==input.destination || ready.previous!==(prior?.binding.attempt??null))) throw Error('Changed pending implementation binding; reconcile');
  let previous=prior?.evidence, base=ready?.base??prior?.binding.deltaBase??input.expectedHead, tip=prior?.binding.deltaTip??base;
  // Bounded even if tests never pass or the host repeatedly advances. Only explicit review rejections spend the durable per-member rework budget.
  for(let step=0;step<8;step++) {
    const current=await input.observeHead();
    input.signal?.throwIfAborted();
    if(current.kind!=='owned' || !/^[0-9a-f]{40}$/.test(current.head) || (!step && !ready && !prior && current.head!==input.expectedHead)) throw Error('Expected owned batch head not current');
    if(previous?.status==='stopped' || previous?.status==='held') return previous;
    if(previous?.status==='approved' && previous.binding.run===input.run && previous.binding.expectedHead===current.head) return previous;
    if(!ready && (!previous || previous.status==='implementation' || previous.status==='rework')) {
      const feedback=previous?{attempt:previous.binding.attempt,candidate:previous.binding.candidate,reason:previous.reason,tests:{exit:previous.tests.exit,stdout:previous.tests.stdout,stderr:previous.tests.stderr},reviews:previous.reviews.map(({role,verdict,reason})=>({role,verdict,reason}))}:null;
      const task=prompt+'\nHost proposal input:\n'+JSON.stringify({start:tip,feedback});
      const revised=await proposeImplementation(input.repo,image,tip,model.model,providerCredential,task,input.signal);
      input.signal?.throwIfAborted();
      // Persist the exact immutable result before sampling another head.
      ready={gate:checks,id:randomUUID(),run:input.run,requirements:input.ticket.hash,destination:input.destination,previous:previous?.binding.attempt??null,base,start:tip,tip:revised};
      const db=openStore(input.state);try{db.prepare('INSERT INTO ready_deltas VALUES(?,?)').run(scope,JSON.stringify(ready))}finally{db.close()}
    }
    if(ready)tip=ready.tip;
    previous=await evaluateAttempt({...input,...checks,expectedHead:current.head,deltaBase:base,deltaTip:tip,testArgv:checks.argv,testPaths:checks.paths},
      sandbox,{ready:ready?.id});
    ready=null;
    if(!['implementation','rework','rebuild'].includes(previous.status)) return previous;
  }
  return previous!;
}
export async function runBatchAttempt(input: BatchAttemptInput, sandbox: BatchSandbox): Promise<BatchEvidence> {
  return evaluateAttempt(input,sandbox);
}
async function evaluateAttempt(input:BatchAttemptInput,sandbox:BatchSandbox,member?:{ready?:string}):Promise<BatchEvidence> {
  const {repo,state,batch,destination,run,deltaBase,deltaTip,signal} = input;
  signal?.throwIfAborted();
  let expectedHead=input.expectedHead;
  const {contentHash: requirementsDigest} = frozenTicketIdentity(input.ticket);
  const {identity,child} = input.ticket.context, project = `${identity.kind}://${identity.host}/${identity.project}`, ticket = child.iid;
  const requirements = input.ticket.text, testArgv = [...input.testArgv], testPaths = [...input.testPaths];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(batch) || destination !== `refs/heads/factory/batch/${batch}` || !run?.trim()) throw Error('Invalid batch/run destination identity');
  if (![testArgv,testPaths].every(a => a.length && a.every(s => typeof s === 'string' && s.trim() && !s.includes('\0'))) || testPaths.some(p => p.startsWith(':') || p.startsWith('/') || p.split('/').some(x => !x || x === '..' || x === '.'))) throw Error('Configured test argv and repository-relative test files/directories required');
  if(!/^sha256:[a-f0-9]{64}$/.test(input.image)||!/^[a-f0-9]{64}$/.test(input.configDigest))throw Error('Unverifiable gate inputs');
  const gate={image:input.image,configDigest:input.configDigest,argv:testArgv,paths:testPaths};
  const attempt = randomUUID(), scope = JSON.stringify([project,batch,ticket]);
  if (resolve(state) === realpathSync(repo) || resolve(state).startsWith(realpathSync(repo) + '/')) throw Error('Gate store must be outside the project');
  const initial = await input.observeHead();
  if (initial.kind !== 'owned' || !/^[a-f0-9]{40}$/.test(initial.head) || (!member && initial.head !== expectedHead)) throw Error('Expected owned batch head not current');
  expectedHead=initial.head;
  const db = openStore(state);
  // Git may be slow. Check before construction, then reserve atomically; never hold the database writer during Git/process I/O.
  function available() {
    const row=db.prepare('SELECT payload FROM ready_deltas WHERE scope=?').get(scope);
    if ((row?JSON.parse(String(row.payload)).id:undefined)!==member?.ready) throw Error('Pending implementation belongs to another gate');
    const rejected = Number(db.prepare('SELECT count(*) AS n FROM attempts WHERE scope=? AND rejected=1').get(scope)!.n);
    if (rejected >= 3) throw Error('Both review reworks exhausted');
    const prior = db.prepare('SELECT result FROM attempts WHERE scope=? AND rejected=1 ORDER BY rowid DESC LIMIT 1').get(scope);
    if (prior) {
      const last = (JSON.parse(String(prior.result)) as BatchEvidence).binding;
      if (last.deltaTip === deltaTip && last.expectedHead === expectedHead && last.requirementsDigest === requirementsDigest) throw Error('Rejected delta requires rework');
    }
    if (db.prepare('SELECT id FROM attempts WHERE scope=? AND result IS NULL').get(scope)) throw Error('Prior batch attempt unresolved; hold for reconciliation');
    return rejected;
  }
  try {
    available();
    let candidate='';
    for(let build=0;build<4;build++) {
      let conflict:unknown;try {candidate=prospectiveCommit(repo,expectedHead,deltaBase,deltaTip,attempt)}catch(e){conflict=e}
      if(member){
        const observed=await input.observeHead();
        if(observed.kind!=='owned'||!/^[a-f0-9]{40}$/.test(observed.head))throw Error('Unknown batch movement before testing; retain delta');
        if(observed.head!==expectedHead){candidate='';expectedHead=observed.head;continue}
      }
      if(conflict)throw conflict;
      break;
    }
    if(!candidate)throw Error('Batch head did not stabilize before testing; retain delta');
    db.exec('BEGIN IMMEDIATE');
    const rejected = available();
    const binding = {gate,project,batch,ticket,run,attempt,destination,expectedHead,requirementsDigest,candidate,deltaBase,deltaTip};
    db.prepare('INSERT INTO attempts(id,scope,binding) VALUES(?,?,?)').run(attempt,scope,JSON.stringify(binding));
    if(member?.ready)db.prepare('DELETE FROM ready_deltas WHERE scope=?').run(scope);
    db.exec('COMMIT');
    const observe = async (fn: () => Promise<ProcessResult>) => {
      try { return await fn(); } catch { return {exit:null,stdout:'',stderr:'Host could not observe process completion'}; }
    };
    // Packing can outlast a head observation. If the head already moved, do not even start tests
    // on this candidate. Movement after launch is still fenced by the independent final observation.
    let beforeLaunch:Awaited<ReturnType<BatchAttemptInput['observeHead']>>|undefined;
    const observed = await observe(async()=>{
      const pack=candidatePack(repo,candidate);
      if(member){
        const check=await input.observeHead().catch(()=>({kind:'unknown' as const,head:''}));
        if(check.kind!=='owned' || check.head!==expectedHead){beforeLaunch=check;return {exit:null,stdout:'',stderr:'Batch head no longer current before tests'}}
      }
      signal?.throwIfAborted();
      return sandbox.test(candidate,pack,[...testArgv]);
    });
    const completed=typeof observed?.exit==='number' && Number.isInteger(observed.exit) && observed.exit>=0 && observed.exit<=255 && typeof observed.stdout==='string' && typeof observed.stderr==='string';
    const tests = {binding,argv:testArgv,exit:completed?observed.exit:null,stdout:typeof observed?.stdout==='string'?observed.stdout.slice(-32768):'',stderr:typeof observed?.stderr==='string'?observed.stderr.slice(-32768):''};
    let reviews: ReviewReceipt[] = [], missingMaterial=false;
    const passed = tests.exit === 0;
    if (passed && !signal?.aborted) {
      try {
        validateReviewInputs(repo,expectedHead,candidate,testPaths);
        const pins={requirements,base:expectedHead,candidate,attempt};
        const prompts = {test: template('test')+'\n'+JSON.stringify({...pins,testPaths,tests:{argv:testArgv,exit:tests.exit,stdout:tests.stdout,stderr:tests.stderr}}),
          code: template('code')+'\n'+JSON.stringify(pins)};
        if (Object.values(prompts).some(p=>Buffer.byteLength(p)>8*1024*1024)) throw Error('Review prompt exceeds limit');
        const current=await input.observeHead().catch(()=>({kind:'unknown' as const,head:''}));
        if(current.kind!=='owned'||current.head!==expectedHead)beforeLaunch=current;
        else if(!signal?.aborted) reviews = await Promise.all((['test','code'] as const).map(role=>reviewRole(sandbox,repo,binding,role,prompts[role])));
      } catch { missingMaterial=true; }
    }
    const final = beforeLaunch ?? await input.observeHead().catch(() => ({kind:'unknown',head:''}));
    const outcome: Pick<BatchEvidence,'status'|'reason'> = signal?.aborted ? {status:'held',reason:'Batch gate cancelled'}
      : final.kind !== 'owned' ? {status:'held',reason:'Batch ownership or movement unknown'}
      : final.head !== expectedHead ? {status:'rebuild',reason:'Host advanced batch; construct and recheck on current head'}
      : tests.exit===null ? {status:'held',reason:'Host could not observe completion of the configured test process'}
      : missingMaterial ? {status:'held',reason:'Exact review material missing, unrepresentable or over limit'}
      : classifyBatchReview(passed,reviews,rejected);
    const result: BatchEvidence = {version:BATCH_EVIDENCE_VERSION,binding,tests,reviews,...outcome};
    db.prepare('UPDATE attempts SET rejected=?,result=? WHERE id=? AND result IS NULL').run(Number(['rework','stopped'].includes(outcome.status)),JSON.stringify(result),attempt);
    return result;
  } finally { db.close(); }
}
