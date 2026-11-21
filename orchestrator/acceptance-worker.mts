// Detached baseline lifecycle owner. All untrusted executable bytes remain in read-only sandbox inputs.
// Ambiguous create, foreign engine/container, crash, late output or cleanup failure retain durable admission.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { acceptanceHash } from './acceptance-contract.mts';
import { copyAcceptanceForRunner, readAcceptanceBundle } from './acceptance-custody.mts';
import { baselineHash, exactBaseline, immutableBaselineFile, privateDirectory, readBaselineSpec, type BaselineHandle } from './acceptance-runner.mts';
const flat=existsSync(new URL('./admission.mts',import.meta.url));
const admission=await import(flat?'./admission.mts':'../board/admission.mts');
const {validateRuntimeBundle}=await import(flat?'./runtime-bundle.mts':'../cli/src/runtime-bundle.mts');

async function main(directory:string):Promise<number>{
  privateDirectory(directory);
  const h=JSON.parse(readFileSync(join(directory,'spec.json'),'utf8')).handle as BaselineHandle;
  if(h.directory!==directory)throw Error('Foreign worker directory');
  const s=readBaselineSpec(h), r=s.intent.request, deadline=s.reservation.deadline;
  const me=admission.ownerOf(process.pid);if(!me.start)throw Error('Worker identity unknown');
  immutableBaselineFile(join(directory,'worker.owner'),JSON.stringify(me));
  const control=new AbortController();
  const cancel=()=>{if(existsSync(join(directory,'cancel.json')))control.abort(Error('Baseline cancelled'));};
  const watcher=watch(directory,cancel);cancel();
  const remaining=()=>deadline-Date.now();
  const timer=setTimeout(()=>control.abort(Error('Total baseline deadline')),Math.max(1,remaining()));
  let bytes=0,engineId='',containerId='',createAttempted=false,createAmbiguous=false,output:any=null,problem='';
  const engine=(args:string[],cleanup=false)=>command(r.engine.command,[...r.engine.args,...args],undefined,cleanup);
  const command=(cmd:string,args:string[],input?:string|Buffer,cleanup=false,dataLimit?:number):Promise<{stdout:Buffer;status:number|null}>=>new Promise((resolve,reject)=>{
    if(remaining()<=0 || !cleanup&&control.signal.aborted)return reject(Error('Baseline cancelled/deadline'));
    const child=spawn(cmd,args,{cwd:r.source,env:{PATH:'/usr/bin:/bin',HOME:directory,LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1'},stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],detached:true});
    let chunks:Buffer[]=[],done=false,dataBytes=0;
    const kill=()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{};};
    const abort=()=>kill();if(!cleanup)control.signal.addEventListener('abort',abort,{once:true});
    const local=setTimeout(kill,Math.max(1,Math.min(remaining(),cleanup?5000:remaining())));
    let failure:Error|undefined;
    const data=(b:Buffer,stdout:boolean)=>{
      if(stdout&&dataLimit!==undefined)dataBytes+=b.length;else bytes+=b.length;
      if(bytes>r.bounds.outputBytes||dataLimit!==undefined&&dataBytes>dataLimit){failure=Error('Baseline output/data bound exceeded');kill();return;}if(stdout)chunks.push(b);
    };
    child.stdout!.on('data',b=>data(b,true));child.stderr!.on('data',b=>data(b,false));
    const finish=(error?:Error,status:number|null=null)=>{if(done)return;done=true;clearTimeout(local);control.signal.removeEventListener('abort',abort);if(error||failure||remaining()<=0||!cleanup&&control.signal.aborted)reject(error??failure??Error('Baseline interrupted/deadline'));else resolve({stdout:Buffer.concat(chunks),status});};
    child.once('error',e=>finish(e));child.once('close',status=>finish(undefined,status));
    if(input!==undefined){child.stdin!.on('error',()=>{});child.stdin!.end(input);}
  });
  const git=async(args:string[],input?:string|Buffer,maxBytes=Math.min(32*1024*1024,r.bounds.memoryMiB*1024*1024/8))=>{
    const out=await command('/usr/bin/git',args,input,false,maxBytes);if(out.status!==0||out.stdout.length>maxBytes)throw Error('Pinned Git preparation failed/bounded');return out.stdout;
  };
  const inspect=async()=>{
    const p=await engine(['inspect',s.reservation.name],true);if(p.status!==0)throw Error('Container inspection unavailable');
    const rows=JSON.parse(p.stdout.toString());if(!Array.isArray(rows)||rows.length!==1)throw Error('Unknown container');
    const c=rows[0],labels=c.Config?.Labels;
    if(c.Id!==containerId||c.Config?.Image!==r.image||labels?.['factory.baseline.execution']!==h.executionId||labels?.['factory.baseline.owner']!==h.ownerId||labels?.['factory.baseline.generation']!==h.generation)throw Error('Foreign container identity; retain hold');
  };
  try{
    admission.withAdmission(h.stateDir,()=>{if(!exactBaseline(admission.readBaselineReservations(h.stateDir).find(b=>b.executionId===h.executionId),h))throw Error('Foreign reservation');});
    const runtime=validateRuntimeBundle(r.runtimeRoot);if(runtime.id!==s.intent.runtime||runtime.dependencies!==s.intent.dependencies)throw Error('Selected runtime changed');
    const bundle=readAcceptanceBundle(r.custodyRoot,r.agentMounts,r.pointer);
    if(bundle.manifest.approvalDigest!==s.intent.approval||acceptanceHash(bundle.contract)!==acceptanceHash(s.contract))throw Error('Frozen bundle changed');
    const info=await engine(['info','--format','{{.ID}}']);engineId=info.stdout.toString().trim();if(info.status!==0||!engineId||engineId.length>256)throw Error('Engine identity unknown');
    const image=await engine(['image','inspect',r.image]);
    const images=JSON.parse(image.stdout.toString());
    if(image.status!==0||images.length!==1||!images[0].RepoDigests?.includes(r.image)||!/^sha256:[a-f0-9]{64}$/.test(images[0].Id)
      ||Object.keys(images[0].Config?.Volumes??{}).length)throw Error('Pinned image missing or declares unbounded external volumes');
    immutableBaselineFile(join(directory,'image.json'),JSON.stringify({id:images[0].Id,digest:r.image}));
    const inputs=join(directory,'inputs');mkdirSync(inputs,{mode:0o700});admission.syncDirectory(directory);
    copyAcceptanceForRunner(r.custodyRoot,r.agentMounts,r.pointer,join(inputs,'acceptance'));
    // Select EXACT tree and commit, not history, refs, hooks, configuration, worktree dirt or shared Git metadata.
    const actual=(await git(['-C',r.source,'rev-parse',`${r.sha}^{commit}`])).toString().trim();if(actual!==r.sha)throw Error('Exact baseline missing');
    const objects=(await git(['-C',r.source,'rev-list','--objects','--no-object-names',`${r.sha}^{tree}`])).toString().trim().split('\n');
    const ids=[r.sha,...objects];if(ids.length>65536||ids.some(id=>!(/^[a-f0-9]{40}$/.test(id))))throw Error('Git inventory bound');
    const sizes=(await git(['-C',r.source,'cat-file','--batch-check=%(objectsize)'],ids.join('\n')+'\n')).toString().trim().split('\n').map(Number);
    if(sizes.length!==ids.length||sizes.some(n=>!Number.isSafeInteger(n)||n<0)||sizes.reduce((a,b)=>a+b,0)>r.bounds.diskMiB*1024*1024/2)throw Error('Git disk bound');
    const pack=await git(['-C',r.source,'pack-objects','--stdout','--no-reuse-delta','--no-reuse-object'],ids.join('\n')+'\n');
    immutableBaselineFile(join(inputs,'baseline.pack'),pack);
    const plan={version:1,executionId:h.executionId,sha:r.sha,deadline,setup:r.setup,reset:r.reset,bounds:r.bounds,contract:bundle.contract,identity:bundle.manifest.acceptance};
    immutableBaselineFile(join(inputs,'plan.json'),JSON.stringify(plan));
    immutableBaselineFile(join(inputs,'acceptance-sandbox.mjs'),readFileSync(join(r.runtimeRoot,'acceptance-sandbox.mjs'),'utf8'));
    if(control.signal.aborted||remaining()<=0)throw Error('Cancelled before create');
    createAttempted=true;
    let created;
    try{created=await engine(['create','--name',s.reservation.name,'--label',`factory.baseline.execution=${h.executionId}`,'--label',`factory.baseline.owner=${h.ownerId}`,'--label',`factory.baseline.generation=${h.generation}`,
      '--network=none','--read-only','--cap-drop=ALL','--cap-add=SETUID','--cap-add=SETGID','--cap-add=SETPCAP','--cap-add=KILL','--security-opt=no-new-privileges','--restart=no','--log-driver=none',
      '--memory',`${r.bounds.memoryMiB}m`,'--memory-swap',`${r.bounds.memoryMiB}m`,'--cpus',String(r.bounds.cpus),'--pids-limit',String(r.bounds.pids),'--shm-size','1m',
      '--user','0:0','--env','HOME=/state','--workdir','/work','--entrypoint','/usr/bin/timeout',
      '--tmpfs',`/work:rw,nosuid,nodev,size=${Math.floor((r.bounds.diskMiB-49)/2)}m,uid=${process.getuid!()},gid=${process.getgid!()}`,'--tmpfs',`/state:rw,nosuid,nodev,size=${Math.ceil((r.bounds.diskMiB-49)/2)}m,uid=${process.getuid!()},gid=${process.getgid!()}`,
      '--tmpfs','/tmp:rw,nosuid,nodev,size=32m,mode=1777','--tmpfs',`/run:rw,nosuid,nodev,size=16m,uid=${process.getuid!()},gid=${process.getgid!()}`,
      '--mount',`type=bind,src=${inputs},dst=/input,readonly`,r.image,'--signal=KILL',`${Math.max(1,remaining())/1000}s`,
      '/usr/bin/setpriv',`--reuid=${process.getuid!()}`,`--regid=${process.getgid!()}`,'--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','/usr/bin/node','/input/acceptance-sandbox.mjs']);}
    catch(e){createAmbiguous=true;throw e;}
    containerId=created.stdout.toString().trim();if(created.status!==0||!/^[A-Za-z0-9._-]+$/.test(containerId)){createAmbiguous=true;throw Error('Ambiguous container creation');}
    immutableBaselineFile(join(directory,'container.json'),JSON.stringify({engineId,containerId,ownerId:h.ownerId,generation:h.generation}));
    await inspect();
    const run=await engine(['start','--attach',containerId]);
    if(run.status!==0)throw Error('Sandbox infrastructure failure');
    immutableBaselineFile(join(directory,'sandbox-output.json'),run.stdout);
    output=JSON.parse(run.stdout.toString());
    if(output.version!==1||output.sha!==r.sha||output.reset?.kind!=='project-local-synthetic-v1'||output.reset?.executionId!==h.executionId)throw Error('Sandbox SHA/reset provenance missing');
  }catch(e){problem=e instanceof Error?e.message:'Unknown lifecycle failure';output=null;}
  let clean=false;
  try{
    // A timed-out create may materialize late in the daemon. An absence observation cannot settle it.
    if(createAmbiguous)throw Error('Ambiguous create remains held');
    if(containerId){
      const identity=await engine(['info','--format','{{.ID}}'],true);if(identity.status!==0||identity.stdout.toString().trim()!==engineId)throw Error('Engine changed');
      await inspect();const rm=await engine(['rm','--force',containerId],true);if(rm.status!==0)throw Error('Exact removal unconfirmed');
      const gone=await engine(['ps','--all','--quiet','--no-trunc','--filter',`id=${containerId}`],true);if(gone.status!==0||gone.stdout.toString().trim())throw Error('Exact container still exists');
    }else if(createAttempted)throw Error('Unknown creation');
    clean=true;
  }catch(e){problem+='; '+(e instanceof Error?e.message:'Cleanup unknown');}
  clearTimeout(timer);watcher.close();
  immutableBaselineFile(join(directory,'outcome.json'),JSON.stringify({problem,cleanup:clean?'confirmed':'unknown',engineId,containerId,outputBytes:bytes}));
  if(!clean)return 2;
  return admission.withAdmission(h.stateDir,()=>{
    const reservations=admission.readBaselineReservations(h.stateDir),current=reservations.find(b=>b.executionId===h.executionId);
    if(!exactBaseline(current,h)||current!.intentDigest!==s.reservation.intentDigest||Date.now()>deadline)return 2;
    const cancelled=existsSync(join(directory,'cancel.json'));
    const receipt={version:1,binding:{executionId:h.executionId,bundleId:r.pointer.id,approvalId:s.approval.id,approvalDigest:s.intent.approval,sha:r.sha,runtime:s.intent.runtime,dependencies:s.intent.dependencies,image:r.image,config:acceptanceHash(r.bounds),setup:s.intent.setup,reset:s.intent.reset,ownerId:h.ownerId},startedAt:s.startedAt,deadline,finishedAt:Date.now(),cleanup:'confirmed',results:cancelled||!output?.results?null:{...output.results,evidence:s.grant.evidence??[]}};
    const provenance={intentDigest:s.reservation.intentDigest,authorizationId:s.grant.id,engineId,containerId,generation:h.generation,reset:output?.reset??null,cancelled,problem,outputDigest:existsSync(join(directory,'sandbox-output.json'))?baselineHash(readFileSync(join(directory,'sandbox-output.json'))):null};
    const body={receipt,provenance};const mac=createHmac('sha256',readFileSync(join(directory,'producer.key'))).update(JSON.stringify(body)).digest('hex');
    const sealed=JSON.stringify({...body,mac});
    immutableBaselineFile(join(directory,'receipt.json'),sealed);
    immutableBaselineFile(join(admission.admissionDir(h.stateDir),`baseline-${h.executionId}.sealed`),JSON.stringify({executionId:h.executionId,ownerId:h.ownerId,generation:h.generation,tokenDigest:baselineHash(h.token),directory:h.directory,receiptDigest:baselineHash(sealed),specDigest:baselineHash(readFileSync(join(directory,'spec.json')))}));
    // Publication before release: a crash between them retains capacity. Never reconstruct release from an old receipt.
    admission.writeBaselineReservations(h.stateDir,reservations.filter(b=>b.executionId!==h.executionId));return 0;
  });
}
if(process.argv[2])main(process.argv[2]).then(code=>{process.exitCode=code;},()=>{process.exitCode=2;});
