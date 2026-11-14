// Admission-time checks are local file reads only. Never run tracker, Git or agents under admission locks.
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { keyFor } from '../../board/admission.mts';
import type { RunState } from '../../board/board.mts';
import { digest, validPreparation } from '../../orchestrator/recovery-analysis-contract.mts';
import type { Preparation, PreparationCode } from '../../orchestrator/recovery-analysis-contract.mts';
export const executionManifestFile = (dir:string,project:string,ticket:number) => join(dir,'graph',`${keyFor(String(ticket),project)}.json`);
/** Resolve Git's loose/packed remote base ref without a subprocess or trusting ticket commands. */
export function localBaseSha(root:string,base:string):string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base) || base.includes('..')) throw Error('Invalid recorded base');
  let gitdir=join(root,'.git');
  if (!statSync(gitdir).isDirectory()) { const match=readFileSync(gitdir,'utf8').match(/^gitdir: (.+)\s*$/); if (!match) throw Error('Unknown Git directory'); gitdir=resolve(root,match[1]); }
  let common=gitdir;
  try { common=resolve(gitdir,readFileSync(join(gitdir,'commondir'),'utf8').trim()); } catch (e) {if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;}
  const ref=`refs/remotes/origin/${base}`;
  try {const value=readFileSync(join(common,ref),'utf8').trim(); if (!/^[a-f0-9]{40,64}$/.test(value)) throw Error('Unknown loose base ref'); return value;}
  catch (e) {if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;}
  const packed=readFileSync(join(common,'packed-refs'),'utf8').split('\n').find(l => l.split(' ')[1]===ref)?.split(' ')[0];
  if (!packed || !/^[a-f0-9]{40,64}$/.test(packed)) throw Error('Local origin base ref missing'); return packed;
}
export type ReadinessRefusal = {reason:string;code:PreparationCode;scope:'ticket'|'project'};
const refuse = (reason:string,code:PreparationCode='changed',scope:'ticket'|'project'='ticket'):ReadinessRefusal => ({reason,code,scope});
export function readinessProblem(o:{root:string;tracker:string;ticket:number;dir:string;preparation?:Preparation},current:RunState|undefined):ReadinessRefusal|undefined {
  const p=o.preparation;
  if (!validPreparation(p) || p.state!=='ready') return refuse('A validated recovery preparation is required','stale');
  if (!current || current.stage!=='stopped') return refuse('Recovery target is no longer stopped');
  if (p.root!==resolve(o.root) || p.project!==o.tracker || p.ticket!==o.ticket || p.base!==current.base) return refuse('Preparation target/base changed');
  try {
    const bytes=readFileSync(executionManifestFile(o.dir,o.tracker,o.ticket),'utf8'),m=JSON.parse(bytes);
    if (digest(bytes)!==p.manifestDigest || m.project!==o.tracker || m.iid!==o.ticket || m.recoveryAnalysisKey!==p.analysisKey
      || m.hash!==p.requirementsHash || m.base!==p.base || m.baseSha!==p.baseSha) return refuse('Preparation execution manifest changed');
    if (localBaseSha(o.root,p.base)!==p.baseSha) return refuse('Preparation local base changed');
  } catch (e) {return refuse(`Preparation identity unavailable: ${e}`,'ownership','project');}
}
