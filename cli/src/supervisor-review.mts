// Explicit exact-proposal independent review: fresh tool-free Pi process, host reservation/provenance and atomic human stop.
// No scheduler, gate edit, verifier PASS, delivery approval, provider fallback or live default paid adapter.
import { existsSync, readFileSync, mkdirSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { ReviewInput, IndependentReview, HumanRequest, HostOutcome } from '../../orchestrator/supervisor-contract.mts';
import type { SupervisorPolicy } from '../../orchestrator/supervisor-policy.mts';
import type { ModelFamily } from '../../orchestrator/model-policy.mts';
import type { Resources, Event, SupervisorState } from './supervisor-state.mts';
import { readSupervisor, commitSupervisor, supervisorRevisionHold } from './supervisor-state.mts';
import { deliverSupervisorRequest } from './supervisor-escalation.mts';
import type { NotificationAdapter, NotificationAuthorization } from './supervisor-escalation.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { supervisorHash, validateReviewInput, reviewOutcome } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
const { reviewContext, reviewContextHold, parseGateReview, REVIEW_OUTPUT_BYTES } = await import(flat ? './gate-review.mts' : '../../orchestrator/gate-review.mts');
const { supervisorCallHold } = await import(flat ? './supervisor-policy.mts' : '../../orchestrator/supervisor-policy.mts');
const { modelForRole } = await import(flat ? './model-policy.mts' : '../../orchestrator/model-policy.mts');
const { piAnalysisArgs } = await import(flat ? './models.mts' : '../../orchestrator/models.mts');
const { ownerOf, writeDurable } = await import(flat ? './admission.mts' : '../../board/admission.mts');
export type ReviewAuthorization = {
  input: ReviewInput; proposer: string; family: ModelFamily; policy: SupervisorPolicy;
  registered: boolean; globalAllowed: boolean; paused: boolean; outsideAdmissionLocks: boolean;
  shared: Resources; capacity: number; notification: NotificationAuthorization;
};
/** Trusted adapter must enforce all-in provider token/cost ceilings after controller death, use EXACT supplied fresh
 * argv/environment/cwd/stdin and fixed model, and bound owned-group termination. No shipped Pi adapter demonstrates
 * those provider ceilings; without one this worker durably escalates rather than launching a paid process. */
export type ReviewBoundary = {
  model: string; reservation: Resources; pricingKnown: boolean; accountingKnown: boolean; enforceable: boolean;
  start(command: 'pi', argv: string[], options: { cwd: string; detached: true; env: Record<string,string>; input: string; deadline: string; maxOutputBytes: number; reservation: Resources }): ChildProcess;
  terminate(child: ChildProcess): Promise<boolean>;
  usage(child: ChildProcess | undefined): Resources | null;
};
export type ReviewOptions = {
  stateDir: string; current(): ReviewAuthorization; boundary?: ReviewBoundary; notifications?: NotificationAdapter;
  signal?: AbortSignal; now?: () => number; subscriptionExtension?: string;
  timer?: (callback: () => void, ms: number) => () => void;
};
const held = (reason: string): HostOutcome => ({ version: 1, state: 'held', reason });
const same = (a: unknown,b: unknown) => supervisorHash(a) === supervisorHash(b);
const positive = (r: Resources) => r && Number.isSafeInteger(r.tokens) && r.tokens > 0 && Number.isSafeInteger(r.cost) && r.cost > 0;
function hostHold(a: ReviewAuthorization): string | undefined {
  validateReviewInput(a.input);
  if (a.input.snapshot.mode !== 'act' || a.policy?.enabled !== true || !a.registered || !a.globalAllowed || a.paused || !a.outsideAdmissionLocks) return 'Current host mode/off/pause/lock holds independent review';
  if (!['openai','anthropic'].includes(a.family) || !a.proposer?.trim() || !positive(a.shared) || !Number.isSafeInteger(a.capacity) || a.capacity <= 0) return 'Unknown host identity/family/shared limits';
}
function totals(s: SupervisorState, kind?: 'review') {
  const rs = Object.values(s.reservations).filter(r => !kind || r.kind === kind);
  return { tokens: rs.reduce((n,r) => n+r.reserved.tokens,0), costUsd: rs.reduce((n,r) => n+r.reserved.cost,0)/1_000_000, calls: rs.length };
}
/** Explicit call only, outside admission locks. Even success is review admissibility, never application authority. */
export async function reviewGateProposal(o: ReviewOptions): Promise<HostOutcome> {
  const now = o.now ?? Date.now, iso = () => new Date(now()).toISOString();
  const timer = o.timer ?? ((f,ms) => { const t = setTimeout(f,ms); return () => clearTimeout(t); });
  try {
    const a = structuredClone(o.current()), hold = hostHold(a); if (hold) return held(hold);
    const { input } = a, { proposal: p, snapshot } = input, project = snapshot.project;
    const rel = relative(resolve(project.root),resolve(o.stateDir));
    if (!rel || !rel.startsWith('..') && !rel.startsWith('/')) return held('Private host journal must be outside project/agent mounts');
    let s = readSupervisor(o.stateDir,project);
    const commit = (event: Event) => { s = commitSupervisor(o.stateDir,project,s.revision,event); };
    if (!s.proposals[p.id] || !same(s.proposals[p.id],p)) return held('Exact proposal must already be retained by host');
    const m = s.incidents[p.incidentId];
    const notify = () => deliverSupervisorRequest({ stateDir: o.stateDir, project, incidentId: p.incidentId, adapter: o.notifications,
      current: () => { const fresh = o.current(); return { ...fresh.notification, mode: fresh.input.snapshot.mode }; }, now });
    const existing = s.humans[p.incidentId];
    if (existing) { if (!s.resolutions?.[p.incidentId]) notify(); return { version: 1, state: 'human-required', reason: existing.reason, scope: existing.scope }; }
    if (m.superseded || m.denied || Object.entries(s.incidents).some(([id,x]) => (x.denied || x.incident.state === 'human-required') && !s.resolutions?.[id]
        && !(id === p.incidentId && p.change.category === 'factory-policy' && !x.denied))
      || Object.keys(s.humans).some(id => !s.resolutions?.[id])) return held('Retained denial/human/supersession holds review');
    // An explicit revision resolution is exact; abandonment cannot silently permit another formulation.
    if (supervisorRevisionHold(s,p.id)) return held('No exact local operator permission for revised proposal');
    const previous = Object.values(s.reviews).find(r => r.proposalId === p.id);
    if (previous) {
      const completion=s.reviewCompletions?.[supervisorHash(previous.id)];
      const reservation=s.reservations[supervisorHash(previous.invocationId)];
      if (!completion || reservation?.state !== 'finished' || reservation.actual === null || completion.policy !== snapshot.material.policy || completion.proposer !== a.proposer)
        return held('Audit-only/unknown review completion cannot approve or relaunch');
      const expected=join(o.stateDir,'supervisor',supervisorHash(project.root),supervisorHash(previous.invocationId),'input.json');
      if(completion.inputRef!==expected)return held('Retained review originals escaped host-owned location');
      const fd=openSync(expected,constants.O_RDONLY|constants.O_NOFOLLOW);let retained:any;
      try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>32*1024*1024)return held('Unknown/oversized retained review originals');retained=JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
      if(!same(validateReviewInput(retained.input),input)||retained.identity.invocationId!==previous.invocationId||retained.identity.reviewer!==previous.reviewer
        ||retained.identity.model!==previous.model||retained.identity.policy!==completion.policy)return held('Retained review provenance/originals changed');
      return reviewOutcome(input,previous,{ now: iso(),currentInputHash: supervisorHash(input), invocationId: previous.invocationId,
        proposer:a.proposer,reviewer:previous.reviewer,model:modelForRole(a.family,'gateReview').model,denied:m.denied });
    }
    const invocationId = randomUUID(), reviewer = `gate-review:${randomUUID()}`, fence = randomUUID();
    const inputHash = supervisorHash(input), stamp = (kind: string) => `${invocationId}:${kind}`;
    const request = (reason: HumanRequest['reason'], question: string, evidence: string[]): HumanRequest => ({ version:1, id:`human:${p.incidentId}`,project,
      scope: reason === 'factory-wide' ? { kind:'project' } : p.scope, incidentId:p.incidentId,proposalId:p.id,reason,question:question.slice(0,4000),evidence,
      nextAction:'Inspect original context and retained review/accounting. Use factory supervisor resolve with the exact incident/request/proposal to abandon or permit one different material proposal and fresh independent review; never reset budgets or treat notification as approval.',
      delivery:{state:'pending',attempts:0},stop:'required' });
    const escalate = (reason: HumanRequest['reason'], why: string): HostOutcome => {
      const h=request(reason,why,snapshot.sources.map(x=>x.locator));
      commit({id:stamp('human'),at:iso(),kind:'human',request:h}); notify();
      return {version:1,state:'human-required',reason,scope:h.scope};
    };
    if (p.change.category === 'factory-policy') return escalate('factory-wide','Required Factory-wide change cannot be applied by supervisor; operator decision required');
    const contextHold = reviewContextHold(input);
    if (contextHold) return escalate('authority-uncertain',contextHold);
    if (p.change.expiresAt <= iso()) return escalate('authority-uncertain','Exact proposal expired');
    if (o.signal?.aborted) return held('Review cancelled before reservation');
    const b=o.boundary, model=modelForRole(a.family,'gateReview').model;
    if (!b || b.model !== model || b.enforceable !== true || !positive(b.reservation)) return escalate('missing-primitive','Fixed Large provider-enforceable all-in ceilings/accounting boundary unavailable; no paid process launched');
    const preflight=supervisorCallHold(a.policy,'review',{registered:a.registered,mode:snapshot.mode,globalAllowed:a.globalAllowed,pricingKnown:b.pricingKnown,
      accountingKnown:b.accountingKnown && !Object.values(s.reservations).some(r=>r.state !== 'finished'),project:totals(s),role:totals(s,'review'),
      reservation:{tokens:b.reservation.tokens,costUsd:b.reservation.cost/1_000_000,calls:1},diagnosisCalls:m.incident.diagnosisCalls,
      activeDecisions:Object.values(s.reservations).filter(r=>r.state !== 'finished').length});
    const limits=a.policy.limits;
    if (preflight || !limits) return escalate('authority-uncertain',preflight ?? 'Missing finite review limits');
    const owner=ownerOf(process.pid); if (!owner.start) return held('Unknown host controller PID/start');
    const identity={invocationId,reviewer,model,policy:snapshot.material.policy};
    let argv:string[];
    try { argv=piAnalysisArgs(model,{FACTORY_PI_SUBSCRIPTION_EXTENSION:o.subscriptionExtension},existsSync); }
    catch(e) { return escalate('missing-primitive',`Fixed-family invocation unavailable: ${String(e)}`); }
    argv.splice(argv.indexOf('--tools'),2,'--no-tools');
    const prompt=readFileSync(new URL(flat?'./prompt.gate-review.md':'../../orchestrator/prompt.gate-review.md',import.meta.url),'utf8')+'\n\n'+JSON.stringify(reviewContext(input,identity));
    const dir=join(o.stateDir,'supervisor',supervisorHash(project.root),supervisorHash(invocationId));
    // Cwd/home are empty and separate from host audit files, proposer workspace, prior process and reviewer context.
    const cwd=join(dir,'isolated'); mkdirSync(cwd,{recursive:true,mode:0o700});
    const inputRef=join(dir,'input.json'); writeDurable(inputRef,JSON.stringify({input,identity,prompt})+'\n');
    const startedAt=iso(),deadline=new Date(now()+limits.review.timeoutSeconds*1000).toISOString();
    try { commit({id:stamp('reserve'),at:startedAt,kind:'reserve',limits:{project:{tokens:limits.maxTokens,cost:Math.floor(limits.maxCostUsd*1_000_000)},shared:a.shared,
      capacity:a.capacity,reviewCalls:limits.review.maxCalls,reviewTimeoutMs:limits.review.timeoutSeconds*1000},
      reservation:{id:invocationId,incidentId:p.incidentId,kind:'review',owner,fence,at:startedAt,deadline,reserved:b.reservation,actual:null,state:'active',reviewId:null}}); } catch(e) { return escalate('authority-uncertain',`Reservation held: ${String(e)}`); }
    let child: ChildProcess|undefined, stdout='',stderr='',confirmed=true,reason='Authorization changed before spawn';
    let ok=false,actual:Resources|null=null;
    const fresh = () => { const current=o.current(); return !hostHold(current) && same(current,a) && !o.signal?.aborted && now()<Date.parse(deadline); };
    try {
      if (fresh()) {
        child=b.start('pi',argv,{cwd,detached:true,env:{PATH:process.env.PATH??'',HOME:cwd,PI_CODING_AGENT_DIR:cwd},input:prompt,deadline,maxOutputBytes:REVIEW_OUTPUT_BYTES,reservation:b.reservation});
        writeDurable(join(dir,'process.json'),JSON.stringify({invocationId,reviewer,model,policy:identity.policy,controller:owner,pid:child.pid??null,fence,deadline})+'\n');
        const result=await new Promise<{ok:boolean;reason:string;confirmed:boolean}>(accept=>{
          let done=false,out=Buffer.alloc(0),err=Buffer.alloc(0),cancelTimer=()=>{},cleanup:Promise<boolean>|undefined;
          const clean=()=>cleanup??=(async()=>{try{return await b.terminate(child!);}catch{return false;}})();
          const finish=async(success:boolean,why:string)=>{if(done)return;done=true;cancelTimer();o.signal?.removeEventListener('abort',abort);
            const gone=await clean();stdout=out.toString('utf8');stderr=err.toString('utf8');accept({ok:success,reason:why,confirmed:gone});};
          const abort=()=>{void finish(false,'Review cancelled');};
          cancelTimer=timer(()=>{void finish(false,'Review timeout');},Math.max(0,Date.parse(deadline)-now()));
          child!.stdout?.on('data',chunk=>{if(done)return;const bytes=Buffer.from(chunk),overflow=out.length+bytes.length>REVIEW_OUTPUT_BYTES;
            out=Buffer.concat([out,bytes.subarray(0,REVIEW_OUTPUT_BYTES-out.length)]);if(overflow)void finish(false,'Review output overflow');});
          child!.stderr?.on('data',chunk=>{if(!done)err=Buffer.concat([err,Buffer.from(chunk)]).subarray(0,8188);});
          child!.once('error',e=>{void finish(false,`Review process failed: ${e.message}`);});
          child!.once('exit',()=>{void clean();});
          child!.once('close',code=>{void finish(code===0,code===0?'Process complete; output requires validation':`Review exit ${code}`);});
          o.signal?.addEventListener('abort',abort,{once:true});if(o.signal?.aborted)abort();
        });
        ({ok,reason,confirmed}=result);
      }
    } catch(e) {reason=String(e);if(child){try{confirmed=await b.terminate(child);}catch{confirmed=false;}}}
    try{actual=b.usage(child);}catch{actual=null;}
    if(actual && (!Number.isSafeInteger(actual.tokens)||actual.tokens<0||!Number.isSafeInteger(actual.cost)||actual.cost<0||actual.tokens>b.reservation.tokens||actual.cost>b.reservation.cost))actual=null;
    let review:IndependentReview={version:1,id:`review:${invocationId}`,inputHash,proposalId:p.id,invocationId,reviewer,model,startedAt,completedAt:iso(),disposition:'inconclusive',reason:reason.slice(0,4000)||'Unknown review failure'};
    if(ok && confirmed && actual!==null) {
      try { review=parseGateReview(stdout,input,identity,startedAt,iso());
        // A strict denial remains a denial even if authority changed while running; stale approval never survives.
        if(review.disposition==='approve' && !fresh()) throw Error('Authorization/material context changed, cancelled or expired');
      } catch(e){review={...review,disposition:'inconclusive',reason:String(e).slice(0,4000)};}
    } else if(!confirmed||actual===null) review.reason='Unknown cleanup/accounting; charge and capacity retained';
    const h=review.disposition==='approve'?null:request(review.disposition==='deny'?'review-denied':'authority-uncertain',review.reason,[inputRef,join(dir,'result.json')]);
    writeDurable(join(dir,'result.json'),JSON.stringify({review,identity,stdout,stderr,confirmed,actual})+'\n');
    s=readSupervisor(o.stateDir,project);
    commit({id:stamp('complete'),at:review.completedAt,kind:'review-complete',review,reservationId:invocationId,fence,owner,actual,processConfirmed:confirmed,request:h,provenance:{inputRef,policy:identity.policy,proposer:a.proposer}});
    if(h){notify();return{version:1,state:'human-required',reason:h.reason,scope:h.scope};}
    if(!fresh())return held('Host authorization/material context changed after review publication; no usable approval');
    return reviewOutcome(input,review,{now:iso(),currentInputHash:supervisorHash(o.current().input),invocationId,proposer:a.proposer,reviewer,model,denied:s.incidents[p.incidentId].denied});
  } catch(e){return held(String(e));}
}
