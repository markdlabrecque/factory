// Offline preparation/CAS tests. Synthetic manifests and inputs, no runtime config, trackers, agents or Git.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareRecoveryAnalysis,recoveryAnalysisKey} from './recovery-analysis.mts';
import type {Inputs,PreparationDeps} from './recovery-analysis.mts';
import {digest} from './recovery-analysis-contract.mts';
import {unitHash} from './graph.mts';
import type {Manifest} from './graph.mts';
function fixture() {
  let input:Inputs={ticket:{iid:7,title:'Work',description:'Do it',state:'open'},notes:[{body:'human'}],catalogue:[],knownProviders:[],base:'main',baseSha:'a'.repeat(40),
    model:'model',provider:'pi',prompt:'analyze',schema:'v1',providerDescriptions:[],blockers:[{iid:8,what:'API',evidence:'needed'}]};
  let manifest:Manifest={iid:7,project:'p',hash:'old',analyzedAt:'before',base:'main',baseSha:'b'.repeat(40),provides:[],requires:[],footprint:[],catalogueIids:[],blockerHashes:{},actualFootprint:['saved.ts'],implementerBlockers:input.blockers};
  let calls=0,cleanups=0;
  const d:PreparationDeps={project:'p',root:'/fixture',base:'main',ticket:7,read:()=>structuredClone(input),manifest:()=>manifest,
    manifestDigest:()=>digest(JSON.stringify(manifest)),analyse:i=>{calls++;return {...manifest,hash:unitHash(i.ticket,i.notes),baseSha:i.baseSha};},
    publish:(m,expected)=>{if(expected!==d.manifestDigest())return false;manifest=m;return true;},dependency:()=>({state:'satisfied'}),cleanup:()=>{cleanups++;}};
  return {d,get input(){return input;},set input(i){input=i;},get manifest(){return manifest;},set manifest(m){manifest=m;},get calls(){return calls;},get cleanups(){return cleanups;}};
}
test('old stopped work prepares once; identical execution key reuses and preserves saved metadata',()=>{
  const f=fixture(); assert.equal(prepareRecoveryAnalysis(f.d).state,'ready'); assert.equal(f.calls,1);
  const before=structuredClone(f.manifest);assert.equal(prepareRecoveryAnalysis(f.d).state,'ready');assert.equal(f.calls,1);
  assert.deepEqual(f.manifest,before);assert.deepEqual(f.manifest.actualFootprint,['saved.ts']);assert.deepEqual(f.manifest.implementerBlockers,f.input.blockers);assert.equal(f.cleanups,2);
});
for(const field of ['ticket','parent','notes','catalogue','provider','providerDescriptions','knownProviders','base','baseSha','model','prompt','schema','blockers']) test(`${field} invalidates preparation key`,()=>{
  const f=fixture();const key=recoveryAnalysisKey(f.input);
  switch(field){
    case 'ticket':f.input.ticket.description+=' edited';break;
    case 'parent':f.input.ticket.parent={iid:1,title:'parent',description:'edit'};break;
    case 'notes':f.input.notes.push({body:'new human note'});break;
    case 'catalogue':f.input.catalogue.push({iid:8,title:'provider',description:'changed'});break;
    case 'providerDescriptions':f.input.providerDescriptions=['different provider description'];break;
    case 'knownProviders':f.input.knownProviders.push({iid:8,title:'old provider',description:'closed',state:'closed'});break;
    case 'blockers':f.input.blockers=[];break;
    default:(f.input as any)[field]+='changed';
  }
  assert.notEqual(recoveryAnalysisKey(f.input),key);
});
test('analysis failure and changing inputs preserve last good manifest and cleanup invocation',()=>{
  const f=fixture(),saved=structuredClone(f.manifest);f.d.analyse=()=>{throw Error('analysis failed');};
  assert.equal(prepareRecoveryAnalysis(f.d).code,'analysis-failed');assert.deepEqual(f.manifest,saved);
  f.d.analyse=i=>{f.input.ticket.title='edited during analysis';return {...saved,hash:unitHash(i.ticket,i.notes)};};
  assert.equal(prepareRecoveryAnalysis(f.d).code,'changed');assert.deepEqual(f.manifest,saved);assert.equal(f.cleanups,2);
});
test('different-key publication winner cannot be overwritten; same fresh winner can be reused',()=>{
  const f=fixture();f.d.publish=m=>{f.manifest={...m,recoveryAnalysisKey:'newer-key'};return false;};
  assert.equal(prepareRecoveryAnalysis(f.d).code,'changed');assert.equal(f.manifest.recoveryAnalysisKey,'newer-key');
  f.d.publish=m=>{f.manifest=m;return false;};assert.equal(prepareRecoveryAnalysis(f.d).state,'ready');
});
for (const state of ['unsatisfied','unknown'] as const) test(`${state} dependency holds without publication`,()=>{
  const f=fixture(),before=structuredClone(f.manifest);f.d.dependency=()=>({state,reason:'prerequisite unavailable'});
  assert.equal(prepareRecoveryAnalysis(f.d).code,state==='unsatisfied'?'unmet-dependency':'unknown-dependency');assert.deepEqual(f.manifest,before);
});
test('unlinked human prerequisites cannot authorize readiness',()=>{
  const f=fixture();f.input.blockers=[{iid:null,what:'operator decision',evidence:'human only'}];f.manifest.implementerBlockers=f.input.blockers;
  assert.equal(prepareRecoveryAnalysis(f.d).code,'unknown-dependency');
});
test('cleanup uncertainty overrides success and preserves ownership',()=>{
  const f=fixture(),before=structuredClone(f.manifest);f.d.cleanup=()=>'/fixture/worktree is dirty; preserved';const r=prepareRecoveryAnalysis(f.d);assert.equal(r.code,'ownership');assert.equal(r.scope,'project');assert.deepEqual(f.manifest,before);
});
test('analysis timeout and tracker/config failures are typed and leave last-good bytes alone',()=>{
  const f=fixture(),before=structuredClone(f.manifest);f.d.analyse=()=>{throw Error('analysis failed: timed out');};
  assert.equal(prepareRecoveryAnalysis(f.d).code,'timeout');assert.deepEqual(f.manifest,before);
  f.d.read=()=>{throw Error('tracker unavailable');};const result=prepareRecoveryAnalysis(f.d);assert.equal(result.code,'config');assert.equal(result.scope,'project');assert.deepEqual(f.manifest,before);
});

test('closed named dependency retains identity and still requires reliable live evidence',()=>{
  const f=fixture();f.input.knownProviders=[{iid:8,title:'API',description:'delivered',state:'closed'}];
  assert.equal(prepareRecoveryAnalysis(f.d).state,'ready');assert.equal(f.manifest.implementerBlockers?.[0].iid,8);
  f.d.dependency=()=>{throw Error('tracker unavailable');};const r=prepareRecoveryAnalysis(f.d);assert.equal(r.code,'unknown-dependency');assert.equal(r.scope,'project');
});
