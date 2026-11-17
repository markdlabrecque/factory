// Apply one exact reviewed verification-guidance substitution as a host-owned ticket/run-scoped input artifact.
// Never edits a checkout, branch, installed runtime or proof. Intent precedes publication; restart only observes, never replays.
import { constants, existsSync, openSync, closeSync, fstatSync, lstatSync, readFileSync, realpathSync, writeSync, fsyncSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ReviewAuthorization } from './supervisor-review.mts';
import { reviewGateProposal, retainedReviewOutcome } from './supervisor-review.mts';
import { readSupervisor, readSupervisorProjects, commitSupervisor, supervisorHumanHold, supervisorRevisionHold } from './supervisor-state.mts';
import type { SupervisorState } from './supervisor-state.mts';
import { deliverSupervisorRequest } from './supervisor-escalation.mts';
import type { NotificationAdapter } from './supervisor-escalation.mts';
import type { ProjectIdentity, Intent } from '../../orchestrator/supervisor-contract.mts';
import type { Proof } from '../../orchestrator/verification.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { supervisorHash, sourceHash, validateReviewInput, reviewOutcome } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
const { modelForRole } = await import(flat ? './model-policy.mts' : '../../orchestrator/model-policy.mts');
const { canonicalWorktree, readReceipt, receiptFile, projectId, gitCommonDir } = await import(flat ? './ownership.mts' : '../../orchestrator/ownership.mts');
const { ownerOf, ownerState, writeDurable, withAdmissionLock } = await import(flat ? './admission.mts' : '../../board/admission.mts');
const { loadTomlConfig } = await import(flat ? './project-config.mts' : '../../orchestrator/project-config.mts');
const { validateRuntimeBundle } = await import('./runtime-bundle.mts');
export type GateAuthorization = ReviewAuthorization & {
  /** Current host operator/pilot and saved-work ownership observations, never model output. */
  pilotAuthorized: boolean; fence: string; workspace: string; branch: string; exclusive: boolean; runtimeRoot: string;
};
export type GateOptions = { stateDir: string; current(): GateAuthorization; now?: () => number; notifications?: NotificationAdapter };
export type GateResult = { state: 'applied' | 'observed-applied'; applicationId: string; requires: 'fresh-analysis-and-independent-verification' }
  | { state: 'held' | 'human-required'; reason: string };
type Application = { version: 1; intent: Intent; authorization: GateAuthorization; beforeHash: string; afterHash: string; receiptHash: string; controlHash: string };
const same = (a: unknown,b: unknown) => supervisorHash(a) === supervisorHash(b);
const demand = (ok: unknown, why: string): void => { if (!ok) throw Error(`Gate application held: ${why}`); };
const git = (cwd: string,...args: string[]) => execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const applicationId = (proposalId: string) => `gate:${proposalId}`;
function directory(state: string,p: ProjectIdentity,id: string) {
  const parts=['supervisor',supervisorHash(p.root),'applications',supervisorHash(id)];let path=state;
  for(const part of parts) {
    path=join(path,part);
    if(existsSync(path)) {
      const stat=lstatSync(path);
      demand(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid?.()&&(stat.mode&0o022)===0&&realpathSync(path)===path,'unsafe host artifact directory');
    }
  }
  return path;
}
function privateState(state: string, root: string) {
  demand(resolve(state)===state && realpathSync(state)===state && state!==root && !state.startsWith(root+'/') && !root.startsWith(state+'/'), 'host journal must be canonical and outside project/agent mounts');
  demand(lstatSync(state).uid===process.getuid?.() && (lstatSync(state).mode&0o022)===0,'host journal ownership/permissions unknown');
}
function hostHold(a: GateAuthorization, at: string) {
  validateReviewInput(a.input);
  demand(a.input.snapshot.mode==='act' && a.policy.enabled===true && a.pilotAuthorized===true && a.registered===true && a.globalAllowed===true
    && a.paused===false && a.outsideAdmissionLocks===true && a.exclusive===true && !!a.fence && a.fence===a.input.snapshot.material.admissionGeneration,
  'current pilot/operator/act/fence/owned-work authorization absent');
  demand(a.input.proposal.change.expiresAt>at,'effect expired');
}
/** Pure necessary refusal matrix. Passing is not permission to publish: actual originals, physical scope and CAS follow. */
export function gateApplyHold(a: GateAuthorization,s: SupervisorState,at: string): string | undefined {
  try {
    hostHold(a,at);const p=a.input.proposal;
    demand(same(s.project,p.project),'project mismatch');
    demand(s.control?.mode==='act'&&s.control.pilot===true,'current durable operator act/pilot authorization absent');
    demand(p.change.category!=='factory-policy','Factory-wide scope requires human escalation');
    demand(!supervisorHumanHold(s)&&!supervisorRevisionHold(s,p.id),'retained human/denial/revision hold');
    demand(!s.incidents[p.incidentId]?.superseded && s.proposals[p.id] && same(s.proposals[p.id],p),'exact current host proposal absent');
    const r=Object.values(s.reviews).find(r=>r.proposalId===p.id),c=r&&s.reviewCompletions?.[supervisorHash(r.id)],reservation=r&&s.reservations[supervisorHash(r.invocationId)];
    demand(r&&c&&c.policy===a.input.snapshot.material.policy&&c.proposer===a.proposer&&reservation?.state==='finished'&&reservation.actual!==null,'independent host review completion absent');
    const result=reviewOutcome(a.input,r!,{now:at,currentInputHash:supervisorHash(a.input),invocationId:r!.invocationId,proposer:a.proposer,reviewer:r!.reviewer,model:modelForRole(a.family,'gateReview').model,denied:s.incidents[p.incidentId].denied});
    demand(result.state==='review-approved','current exact input/proposal independent approval absent');
  } catch(e){return String(e);}
}
function readOwned(path: string) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const s=fstatSync(fd);demand(s.isFile()&&s.nlink===1&&s.uid===process.getuid?.()&&s.size<=4*1024*1024,'unknown/oversized owned file');return readFileSync(fd,'utf8');}finally{closeSync(fd);}
}
function contained(root: string,path: string) {
  demand(resolve(root)===root&&realpathSync(root)===root,'noncanonical source root');
  let at=root;
  for(const part of path.split('/')) {at=join(at,part);const s=lstatSync(at);demand(!s.isSymbolicLink()&&s.uid===process.getuid?.(),'unsafe source path/owner');}
  demand(realpathSync(at)===at&&lstatSync(at).isFile()&&lstatSync(at).nlink===1,'aliased or nonregular source');return at;
}
/** This is the entire executable consumer inventory: one configured verification-only Markdown document. */
function actualInputs(a: GateAuthorization) {
  const p=a.input.proposal,root=p.project.root,m=a.input.snapshot.material;
  demand(realpathSync(root)===root&&realpathSync(a.workspace)===a.workspace&&a.workspace===canonicalWorktree(root,a.branch),'workspace is not exact canonical owned worktree');
  demand(/^\d+-[a-z0-9][a-z0-9-]*$/.test(a.branch)&&a.branch.startsWith(`${p.change.owner.ticket}-`),'foreign branch');
  demand(git(a.workspace,'rev-parse','--show-toplevel')===a.workspace&&git(a.workspace,'symbolic-ref','--short','HEAD')===a.branch&&gitCommonDir(a.workspace)===gitCommonDir(root),'Git worktree/branch/common identity changed');
  const manifest=validateRuntimeBundle(a.runtimeRoot);
  demand(realpathSync(a.runtimeRoot)===a.runtimeRoot&&manifest.id===m.runtime&&manifest.dependencies===m.dependencies,'selected runtime/Factory constraints changed');
  const config=loadTomlConfig(join(root,'.factory')), {source,sources,warnings,...settings}=config;
  demand(sourceHash(JSON.stringify(settings))===m.settings&&same(config.supervisor,a.policy)&&config.AGENT.family===a.family
    &&config.TRACKER.kind===p.project.tracker.kind&&config.TRACKER.project===p.project.tracker.project&&(config.TRACKER.host??config.TRACKER.gitlabHost)===p.project.tracker.host,'actual settings/policy/project changed since independent review');
  const lists=config.instructions,path=p.change.path;
  demand(lists.verification.includes(path)&&!Object.entries(lists).some(([role,paths])=>role!=='verification'&&(paths as string[]).includes(path)),'unsupported effect: only configured verification-only guidance');
  demand(path.endsWith('.md')&&!path.startsWith('.factory/')&&!path.startsWith('.factory-workflow/')&&!['AGENTS.md','CLAUDE.md'].includes(path),'protected or unsupported guidance target');
  // All configured original instructions, not just the target, must be present in the independently reviewed originals.
  const originalHashes: {[path:string]:string}={};
  for(const path of new Set(Object.values(lists).flat())) {
    const file=contained(root,path),bytes=readOwned(file);
    demand(a.input.snapshot.sources.some(s=>(s.role==='guidelines'||s.role==='gate')&&s.locator===file&&s.status==='complete'&&s.text===bytes),'actual guideline bytes changed or absent from review');
    originalHashes[path]=sourceHash(bytes);
    if(path===p.change.path)demand(bytes===p.change.before&&readOwned(contained(a.workspace,path))===bytes,'exact source/worktree preimage changed; preserve dirty work');
  }
  return {candidate:git(a.workspace,'rev-parse','HEAD'),originalHashes};
}
function receipt(o: GateOptions,a: GateAuthorization) {
  const p=a.input.proposal,r=readReceipt(receiptFile(o.stateDir,projectId(p.project.root,p.project.tracker),String(p.change.owner.ticket)));
  demand(r&&r.projectRoot===p.project.root&&r.projectId===projectId(p.project.root,p.project.tracker)&&r.gitCommonDir===gitCommonDir(p.project.root)
    &&r.runId===p.change.owner.runId&&r.branch===a.branch&&r.worktreePath===a.workspace&&r.worktreeAt&&r.branchSha&&r.implementationBaseSha===a.input.snapshot.material.baseline,'exact retained run ownership/baseline receipt required');return r;
}
function retained(o: GateOptions,a: GateAuthorization,id: string): Application {
  const r=JSON.parse(readOwned(join(directory(o.stateDir,a.input.snapshot.project,id),'intent.json'))) as Application;
  demand(r.version===1&&r.intent.id===id&&same(r.authorization,a)&&r.intent.inputHash===supervisorHash(a.input)
    &&r.beforeHash===sourceHash(a.input.proposal.change.before)&&r.afterHash===sourceHash(a.input.proposal.change.after)&&r.receiptHash===supervisorHash(receipt(o,a))&&r.controlHash===supervisorHash(readSupervisor(o.stateDir,a.input.snapshot.project).control??null),'retained intent/material/receipt/operator fence changed');return r;
}
/** Explicit source API only. No scheduler, host-checkout/branch edit, command execution, commit, retry or delivery. */
export async function applyReviewedGate(o: GateOptions): Promise<GateResult> {
  const now=o.now??Date.now,iso=()=>new Date(now()).toISOString();
  try {
    const a=structuredClone(o.current()),p=a.input.proposal,project=p.project;
    hostHold(a,iso());privateState(o.stateDir,project.root);
    let s=readSupervisor(o.stateDir,project);
    demand(s.control?.mode==='act'&&s.control.pilot===true,'current durable operator act/pilot authorization absent');
    const human=(why: string,wide=false): GateResult => {
      if(!s.humans[p.incidentId])s=commitSupervisor(o.stateDir,project,s.revision,{id:`apply-human:${p.id}`,at:iso(),kind:'human',request:{version:1,id:`human:${p.incidentId}`,project,
        scope:{kind:'project'},incidentId:p.incidentId,proposalId:p.id,reason:wide?'factory-wide':'authority-uncertain',question:why.slice(0,4000),evidence:a.input.snapshot.sources.map(x=>x.locator),
        nextAction:'Inspect retained originals and owned work. Use exact local operator resolution; do not weaken Factory or replay an ambiguous correction.',delivery:{state:'pending',attempts:0},stop:'required'}});
      deliverSupervisorRequest({stateDir:o.stateDir,project,incidentId:p.incidentId,current:()=>{const fresh=o.current();return {...fresh.notification,mode:fresh.input.snapshot.mode};},adapter:o.notifications,now});return {state:'human-required',reason:why};
    };
    if(p.change.category==='factory-policy')return human('Factory-wide correction requires a human',true);
    const refusal=gateApplyHold(a,s,iso());if(refusal)return {state:'held',reason:refusal};
    // Never launch or shop for reviewers: the cached branch validates retained originals/host process completion.
    const reviewed=await reviewGateProposal({stateDir:o.stateDir,current:()=>o.current(),now});
    if(reviewed.state!=='review-approved')return {state:'held',reason:'Current independent host completion does not approve exact inputs'};
    try {
      actualInputs(a);
      const {loadExecutionContext}=await import(flat?'./context.mts':'../../orchestrator/context.mts');
      const base=await loadExecutionContext({cwd:project.root,moduleRoot:a.runtimeRoot,env:{FACTORY_PROJECT_ROOT:project.root,FACTORY_RUNTIME_ROOT:a.runtimeRoot,
        FACTORY_RUNTIME_ID:a.input.snapshot.material.runtime,FACTORY_RUNTIME_DEPENDENCIES:a.input.snapshot.material.dependencies,SANDCASTLE_STATE_DIR:o.stateDir}});
      demand(base.policyIdentity===a.input.snapshot.material.policy,'actual execution policy differs from independently reviewed context');
    }catch(e){return human(String(e));}
    const r=receipt(o,a),id=applicationId(p.id),key=supervisorHash(id),dir=directory(o.stateDir,project,id),recordFile=join(dir,'intent.json'),artifact=join(dir,'source.md');
    return withAdmissionLock(join(o.stateDir,'supervisor-gate',supervisorHash(project.root)),()=>{
      s=readSupervisor(o.stateDir,project);demand(!gateApplyHold(a,s,iso()),'current journal approval/authority changed');const existing=s.intents[key];
      if(existing) {
        const rec=retained(o,a,id);demand(same(existing.intent,rec.intent),'journal/retained intent mismatch');
        if(existing.outcome==='pending'||existing.outcome==='unknown') {
          demand(ownerState(existing.owner)==='dead','live/unknown prior applicator owner; preserve work');
          let outcome:'observed-applied'|'observed-not-applied'|'unknown'='unknown',hash='missing';
          try {hash=sourceHash(readOwned(artifact));if(hash===rec.afterHash)outcome='observed-applied';}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')outcome='observed-not-applied';}
          s=commitSupervisor(o.stateDir,project,s.revision,{id:`${id}:observe:${s.revision}`,at:iso(),kind:'reconcile-intent',intentId:id,outcome,evidence:[recordFile,`artifact:${hash}`]});
        }
        demand(s.intents[key].outcome==='observed-applied'&&sourceHash(readOwned(artifact))===rec.afterHash,'ambiguous/not-applied intent requires human resolution, never replay');
        return {state:'observed-applied',applicationId:id,requires:'fresh-analysis-and-independent-verification'} as GateResult;
      }
      demand(!Object.values(s.intents).some(x=>x.outcome==='pending'||x.outcome==='unknown'),'another pending/ambiguous gate intent holds project');
      demand(actualInputs(a).candidate===a.input.snapshot.material.tip,'candidate changed; fresh independent review required');
      demand(same(o.current(),a),'current authorization/material/fence changed');hostHold(o.current(),iso());
      const owner=ownerOf(process.pid);demand(owner.start,'controller PID/start unknown');
      const intent:Intent={version:1,id,project,scope:p.scope,incidentId:p.incidentId,proposalId:p.id,inputHash:reviewed.inputHash,reviewId:reviewed.reviewId,runId:p.change.owner.runId,fence:a.fence,expiresAt:p.change.expiresAt,state:'proposed'};
      const rec:Application={version:1,intent,authorization:a,beforeHash:sourceHash(p.change.before),afterHash:sourceHash(p.change.after),receiptHash:supervisorHash(r),controlHash:supervisorHash(s.control)};
      if(existsSync(recordFile))demand(same(JSON.parse(readOwned(recordFile)),rec),'orphan intent differs; never overwrite');else writeDurable(recordFile,JSON.stringify(rec)+'\n');
      s=commitSupervisor(o.stateDir,project,s.revision,{id:`${id}:intent`,at:iso(),kind:'intent',intent,owner});
      // Publication is to host-owned storage only, never to a path writable by workspace/sandbox writers.
      // O_EXCL is the CAS: a crash or ambiguous result cannot truncate/replace any pre-existing artifact.
      demand(same(o.current(),a),'late authorization/material/fence change');hostHold(o.current(),iso());
      demand(actualInputs(a).candidate===a.input.snapshot.material.tip&&same(receipt(o,a),r),'late workspace/material change');
      demand(readSupervisor(o.stateDir,project).revision===s.revision,'journal CAS changed before publication');
      const fd=openSync(artifact,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      try {writeSync(fd,p.change.after);fsyncSync(fd);}finally{closeSync(fd);}
      const d=openSync(dir,constants.O_RDONLY);try{fsyncSync(d);}finally{closeSync(d);}
      demand(sourceHash(readOwned(artifact))===rec.afterHash,'partial/changed artifact publication; observation required, never replay');
      s=commitSupervisor(o.stateDir,project,s.revision,{id:`${id}:complete`,at:iso(),kind:'complete-intent',intentId:id,fence:a.fence,owner,evidence:[recordFile,artifact,`sha256:${rec.afterHash}`]});
      return {state:'applied',applicationId:id,requires:'fresh-analysis-and-independent-verification'};
    },-1);
  } catch(e){return {state:'held',reason:String(e)};}
}
/** Explicit scoped input capability. It cannot edit, resume, verify or deliver a run. */
export type GateConsumption = { options: GateOptions; applicationId: string; ticket: number; runId: string };
export function gateInstructionSource(c: GateConsumption) {
  const o=c.options,a=structuredClone(o.current()),p=a.input.proposal;
  privateState(o.stateDir,p.project.root);hostHold(a,new Date((o.now??Date.now)()).toISOString());
  demand(c.applicationId===applicationId(p.id)&&c.ticket===p.change.owner.ticket&&c.runId===p.change.owner.runId,'consumer ticket/run scope mismatch');
  const s=readSupervisor(o.stateDir,p.project),m=s.intents[supervisorHash(c.applicationId)];
  demand(!gateApplyHold(a,s,new Date((o.now??Date.now)()).toISOString())&&m?.outcome==='observed-applied','application not positively observed or currently held');
  demand(retainedReviewOutcome(o.stateDir,a,s,new Date((o.now??Date.now)()).toISOString()).state==='review-approved','retained independent review originals/provenance no longer approve');
  const rec=retained(o,a,c.applicationId),actual=actualInputs(a);
  demand(same(m.intent,rec.intent)&&sourceHash(readOwned(join(directory(o.stateDir,p.project,c.applicationId),'source.md')))===rec.afterHash,'journal/artifact/retained intent mismatch');
  return {path:p.change.path,before:p.change.before,after:p.change.after,originalHashes:actual.originalHashes,identity:{applicationId:c.applicationId,ticket:c.ticket,runId:c.runId,afterHash:rec.afterHash,
    projectRoot:p.project.root,workspace:a.workspace,branch:a.branch,base:a.input.snapshot.material.base,baseline:a.input.snapshot.material.baseline,ticketInput:a.input.snapshot.material.ticketInput,
    candidate:actual.candidate,inputHash:rec.intent.inputHash,reviewId:rec.intent.reviewId,fence:a.fence,expiresAt:p.change.expiresAt}};
}
/** Proof binding is independent of a caller's recheck closure: a valid amended context cannot launder old same-SHA proof. */
export function gateProofHold(stateDir: string,proof: Proof): string | undefined {
  try {
    const candidates=readSupervisorProjects(stateDir).flatMap(s=>Object.values(s.intents).filter(m=>m.intent.id.startsWith('gate:')&&s.project.tracker.project===proof.project
      &&m.intent.scope.kind==='ticket'&&String(m.intent.scope.ticket)===proof.ticket&&m.intent.runId===proof.executionId).map(m=>({s,m})));
    const execution=proof.provenance.settings.execution as {gate?:unknown;additive?:{verification?:{[path:string]:string}}}|undefined;
    if(!candidates.length){demand(!execution?.gate,'proof references an unknown gate application');return;}
    demand(candidates.length===1,'ambiguous project/run gate proof scope');
    const {s,m}=candidates[0],i=m.intent;
    demand(s.control?.mode==='act'&&s.control.pilot===true&&m.outcome==='observed-applied'&&!supervisorHumanHold(s)&&!supervisorRevisionHold(s,i.proposalId),'gate publication/operator authority remains held');
    const recordFile=join(directory(stateDir,s.project,i.id),'intent.json');
    const raw=JSON.parse(readOwned(recordFile)) as Application,rec=retained({stateDir,current:()=>raw.authorization},raw.authorization,i.id);
    demand(same(rec.intent,i)&&sourceHash(readOwned(join(directory(stateDir,s.project,i.id),'source.md')))===rec.afterHash,'gate artifact/intent changed');
    const a=rec.authorization,material=a.input.snapshot.material;
    demand(proof.baseline===material.baseline&&proof.base===material.base&&proof.branch===a.branch&&proof.requirementsHash===material.ticketInput,'proof changed reviewed baseline/base/branch/requirements');
    demand(same(execution?.gate??null,{applicationId:i.id,ticket:Number(proof.ticket),runId:proof.executionId,afterHash:rec.afterHash,candidate:proof.tip,
      projectRoot:s.project.root,workspace:a.workspace,branch:a.branch,base:material.base,baseline:material.baseline,ticketInput:material.ticketInput,
      inputHash:i.inputHash,reviewId:i.reviewId,fence:i.fence,expiresAt:i.expiresAt})&&execution?.additive?.verification?.[rec.authorization.input.proposal.change.path]===rec.afterHash,
      'proof lacks exact amended execution identity; fresh analysis and independent verification required');
  }catch(e){return String(e);}
}
/** Normal unamended contexts must not silently deliver using pre-correction policy/proof. Other tickets/runs are untouched. */
export function gateScopeHold(stateDir: string,project: ProjectIdentity,ticket: number,runId: string|undefined,application?: string): string | undefined {
  const s=readSupervisor(stateDir,project);
  const relevant=Object.values(s.intents).filter(m=>m.intent.id.startsWith('gate:')&&m.intent.scope.kind==='ticket'&&m.intent.scope.ticket===ticket&&(!runId||m.intent.runId===runId));
  if(relevant.some(m=>m.intent.id!==application||m.outcome!=='observed-applied'))return 'Scoped gate correction requires its exact amended context, fresh analysis and independent verification';
}
