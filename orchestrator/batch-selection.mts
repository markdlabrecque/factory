// Fixed-member dependency policy. Tracker closure can satisfy external providers, never a submitted member.
import type { DependencyResult } from './dependencies.mts';
import { edgesOf, type Manifest } from './graph.mts';

export type DeliveryScope = { id:string; repositoryId:string; destinationRef:string; expectedHead:string; members:number[] };
/** Trusted host observer only. A landed result attests that this member's exact delivered commit is in observedHead. */
export type DeliveryObservation = { state:'landed'; batch:string; repositoryId:string; destination:string; observedHead:string; iid:number; commit:string } | {state:'unstarted'|'waiting'|'unknown'|'stopped'; reason:string};
export type DeliveryObserver = (batch:DeliveryScope,iid:number)=>DeliveryObservation;
export const unavailableDelivery:DeliveryObserver = () => ({state:'unknown',reason:'host delivery observation unavailable; reconcile delivery and repeat batch dispatch'});
export function memberDelivery(batch:DeliveryScope,iid:number,observe:DeliveryObserver):DependencyResult {
  if(!batch.members.includes(iid)) return {state:'unknown',reason:'not a saved batch member'};
  const o=observe(batch,iid);
  if(o.state==='landed') return o.batch===batch.id && o.repositoryId===batch.repositoryId && o.destination===batch.destinationRef && o.observedHead===batch.expectedHead && o.iid===iid && /^[a-f0-9]{40}$/.test(o.commit)
    ? {state:'satisfied'} : {state:'unknown',reason:'delivery identity mismatch; reconcile the owned batch'};
  return {state:o.state==='unknown'?'unknown':'unsatisfied',reason:o.reason};
}
export function prerequisiteHold(batch:DeliveryScope, blockers:number[], observe:DeliveryObserver, external:(iid:number)=>DependencyResult):string|undefined {
  const reasons:string[]=[];
  for(const iid of new Set(blockers)) {
    if(!Number.isSafeInteger(iid)||iid<=0) { reasons.push('unresolved blocker identity; correct the recorded dependency');continue; }
    const member=batch.members.includes(iid), fact=member?memberDelivery(batch,iid,observe):external(iid);
    if(fact.state!=='satisfied') reasons.push(`#${iid}${member?'':' (not submitted)'}: ${fact.reason ?? 'prerequisite remains open'}`);
  }
  if(reasons.length) return `Waiting on ${reasons.join('; ')}`;
}

/** Structured local Depends on lines supplement native links. Never reinterpret a foreign reference as a local number. */
export function declaredBlockers(text:string):number[] {
  const ids:number[]=[];
  for(const line of text.split('\n')) {
    const match=/^\s*(?:[-*] )?(?:\*\*)?(?:depends on|blocked by):(?:\*\*)?\s*(.*?)\s*$/i.exec(line);
    if(!match) continue;
    const value=match[1].replace(/\s*\([^()#]*\)\s*/g,' ').trim();
    if(/^(?:none|n\/a|—)$/i.test(value)) continue;
    if(!/^#[1-9]\d*(?:(?:\s*,\s*|\s+and\s+|\s+)#[1-9]\d*)*$/i.test(value)) throw Error('Unresolved Depends on / Blocked by declaration; use local #numbers or native tracker links');
    ids.push(...[...value.matchAll(/#(\d+)/g)].map(m=>Number(m[1])));
  }
  return ids;
}
/** An active reservation made under a different (or unknown) analysis policy cannot exempt other paths. */
export function policyFootprint(reservation:{policyIdentity?:string;footprint?:string[]}|undefined,policyIdentity:string):string[] {
  const paths=reservation?.footprint;
  return policyIdentity && reservation?.policyIdentity===policyIdentity && Array.isArray(paths) && paths.length && paths.every(p=>typeof p==='string' && p.trim()) ? paths : ['*'];
}
const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
const text = (v:unknown):v is string => typeof v==='string';
const localId = (v:unknown) => Number.isSafeInteger(v) && Number(v)>0;
const list = (v:unknown,valid:(item:unknown)=>boolean) => Array.isArray(v) && v.every(valid);
function isManifest(v:unknown):v is Manifest {
  return object(v) && localId(v.iid) && text(v.project) && text(v.hash) && text(v.baseSha) && text(v.base) && text(v.analyzedAt)
    && (v.policyIdentity===undefined || text(v.policyIdentity)) && (v.recoveryAnalysisKey===undefined || text(v.recoveryAnalysisKey))
    && list(v.provides,text) && list(v.footprint,text) && (v.actualFootprint===undefined || list(v.actualFootprint,text))
    && list(v.catalogueIids,localId) && object(v.blockerHashes) && Object.entries(v.blockerHashes).every(([id,h])=>/^[1-9]\d*$/.test(id) && text(h))
    && list(v.requires,r=>object(r) && (r.providedBy===null || localId(r.providedBy)) && text(r.what) && text(r.evidence) && typeof r.confidence==='number' && r.confidence>=0 && r.confidence<=1)
    && (v.implementerBlockers===undefined || list(v.implementerBlockers,r=>object(r) && (r.iid===null || localId(r.iid)) && text(r.what) && text(r.evidence)));
}
export function recordedGraph(m:unknown,project:string,iid:number,hash:string,head:string,policyIdentity:string) {
  if(m===undefined) return {blockers:[],footprint:['*']}; // only an absent record means no prediction
  if(!isManifest(m)) throw Error('Malformed recorded ticket graph; inspect and refresh the manifest before dispatch');
  if(m.iid!==iid || m.project!==project || m.hash!==hash || [...m.requires.map(r=>r.providedBy),...(m.implementerBlockers??[]).map(b=>b.iid)].some(n=>!Number.isSafeInteger(n)||n===iid||Number(n)<=0))
    throw Error('Recorded graph dependencies are stale or unresolved; refresh ticket analysis');
  const paths=m.actualFootprint??m.footprint;
  return {blockers:edgesOf(m).map(e=>e.from),footprint:m.baseSha===head?policyFootprint({policyIdentity:m.policyIdentity,footprint:paths},policyIdentity):['*']};
}
