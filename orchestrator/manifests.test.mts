// Real manifest-store CAS/publication locking in copied offline fixtures. No live runtime or tracker imports.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildAssets} from '../cli/src/scaffold.mts';

test('two execution preparers race the original digest; only one can publish and later writers cannot be overwritten',async t=>{
  const root=mkdtempSync(join(tmpdir(),'factory-manifest-cas-')),state=join(root,'state');t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const f of buildAssets({profile:'personal',repo:'p/r',image:'fixture'},state)){mkdirSync(dirname(join(root,f.path)),{recursive:true});writeFileSync(join(root,f.path),f.content);}
  const module=pathToFileURL(join(root,'.sandcastle/manifests.mts')).href;
  const manifest={iid:7,project:'p/r',hash:'h',analyzedAt:'fixture',base:'main',baseSha:'a'.repeat(40),provides:[],requires:[],footprint:[],catalogueIids:[],blockerHashes:{},actualFootprint:['saved.ts']};
  const env={...process.env,SANDCASTLE_STATE_DIR:state};
  const original=execFileSync(process.execPath,['--input-type=module','-e',`const s=await import(${JSON.stringify(module)});s.writeManifest(${JSON.stringify(manifest)});process.stdout.write(s.manifestDigest('p/r',7));`],{env,encoding:'utf8'});
  const kids=['a','b'].map(key=>spawn(process.execPath,['--input-type=module','-e',`const s=await import(${JSON.stringify(module)});let ok=false;try{ok=s.publishManifest({...${JSON.stringify(manifest)},recoveryAnalysisKey:${JSON.stringify(key)}},${JSON.stringify(original)});}catch{}process.stdout.write(String(ok));`],{env,stdio:['ignore','pipe','pipe']}));
  const results=await Promise.all(kids.map(async c=>{let out='';c.stdout!.on('data',b=>out+=b);await once(c,'exit');return out;}));
  assert.equal(results.filter(x=>x==='true').length,1,results.join(','));
  const file=join(state,'graph','p_r--7.json'),winner=readFileSync(file,'utf8');
  const lost=execFileSync(process.execPath,['--input-type=module','-e',`const s=await import(${JSON.stringify(module)});process.stdout.write(String(s.publishManifest(${JSON.stringify(manifest)},${JSON.stringify(original)})));`],{env,encoding:'utf8'});
  assert.equal(lost,'false');assert.equal(readFileSync(file,'utf8'),winner);assert.deepEqual(JSON.parse(winner).actualFootprint,['saved.ts']);
});
