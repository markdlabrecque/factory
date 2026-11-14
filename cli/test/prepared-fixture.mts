// Synthetic execution preparation for admission/launcher fixtures. Writes only fixture-owned local files.
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {digest} from '../../orchestrator/recovery-analysis-contract.mts';
import type {Prepared} from '../../orchestrator/recovery-analysis-contract.mts';
import {executionManifestFile,localBaseSha} from '../src/recovery-readiness.mts';
export function preparedFixture(o:{root:string;tracker:string;ticket:number;dir:string;base?:string}):Prepared {
  const base=o.base ?? 'main';let sha:string;
  try{sha=localBaseSha(o.root,base);}catch{sha=existsSync(join(o.root,'.git/HEAD')) ? execFileSync('git',['rev-parse',`refs/heads/${base}`],{cwd:o.root,encoding:'utf8'}).trim() : 'a'.repeat(40);const ref=join(o.root,'.git','refs/remotes/origin',base);mkdirSync(dirname(ref),{recursive:true});writeFileSync(ref,sha+'\n');}
  const file=executionManifestFile(o.dir,o.tracker,o.ticket),key=digest('fixture analysis');
  let previous={};try{previous=JSON.parse(readFileSync(file,'utf8'));}catch{}
  const m={provides:[],requires:[],footprint:[],catalogueIids:[],blockerHashes:{},analyzedAt:'fixture',hash:'requirements',...previous,iid:o.ticket,project:o.tracker,base,baseSha:sha,recoveryAnalysisKey:key};
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(m));
  return {version:1,state:'ready',code:'ready',scope:'ticket',reason:'fixture prepared',root:resolve(o.root),project:o.tracker,ticket:o.ticket,base,baseSha:sha,
    requirementsHash:m.hash,analysisKey:key,manifestDigest:digest(readFileSync(file,'utf8'))};
}
