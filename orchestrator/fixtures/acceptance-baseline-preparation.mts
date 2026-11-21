// TEST ONLY independent host preparation: exact private execution grant, real owned runner and engine transport.
// The engine emulates sandbox output; it never executes project/probe argv on the host or supplies admission authority.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {acceptanceHash} from '../acceptance-contract.mts';
import {namespaceTransport} from './acceptance-namespace.mts';

export function prepareFixtureBaseline(runtime: string, cwd: string, env: NodeJS.ProcessEnv, iid=7, base='main', fault=''): import('../acceptance-baseline-admission.mts').BaselineAdmissionIdentity | undefined {
  const output=execFileSync(process.execPath,[import.meta.filename,'--prepare',runtime,String(iid),base,fault],{cwd,env,encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']});
  return output?JSON.parse(output):undefined;
}
if (process.argv[2] === '--prepare') {
  const [runtime,iidText,base,fault='']=process.argv.slice(3), iid=Number(iidText);
  const {context,effectiveConfig,TRACKER}=await import(join(runtime,'runtime-config.mts'));
  const tracker=await import(join(runtime,'tracker.mts'));
  const {freezeTicketInput}=await import(join(runtime,'ticket-input.mts'));
  const {readPreparedAcceptance}=await import(join(runtime,'acceptance-admission.mts'));
  const input=freezeTicketInput(tracker.contextSource,iid), root=join(context.sharedState,'acceptance');
  if (!existsSync(join(root,`baseline-current-${input.hash}.json`))) {
    const bundle=readPreparedAcceptance(context.sharedState,[context.projectRoot,context.runtimeRoot],input);
    const {cancelAcceptanceBaseline}=await import(join(runtime,'acceptance-runner.mts'));
    const owned=join(dirname(context.sharedState),'owned-baselines'); mkdirSync(owned,{mode:0o700,recursive:true});
    const socketPath=join(owned,'engine.sock');
    let labels:any, plan:any, inputs='';
    const real=['acceptance-replay-pass','acceptance-implementer-tamper','acceptance-reset-unsupported'].includes(process.env.SCENARIO ?? '') || iid===7&&!!process.env.FIXTURE_REPLAY_RECORD;
    const closure=join(owned,'baseline-namespace');if(real)mkdirSync(closure,{mode:0o700});
    const execute=real?namespaceTransport(closure):undefined;
    const server=createServer(socket=>{let text='';socket.on('data',bytes=>{
      text+=bytes; if(!text.includes('\n'))return;
      const {args}=JSON.parse(text); let result:any;
      if(args[0]==='info')result={stdout:'fixture-baseline-engine'};
      else if(args[0]==='image')result={stdout:JSON.stringify([{Id:'sha256:'+'a'.repeat(64),RepoDigests:['fixture/baseline@sha256:'+'a'.repeat(64)],Config:{Volumes:null}}])};
      else if(args[0]==='create') {
        labels=Object.fromEntries(args.flatMap((a:string,i:number)=>a==='--label'?[args[i+1].split('=')]:[]));
        const mount=args[args.indexOf('--mount')+1], input=mount.match(/src=([^,]+)/)[1];
        inputs=input;plan=JSON.parse(readFileSync(join(input,'plan.json'),'utf8')); result={stdout:'baseline-container'};
      } else if(args[0]==='inspect') result={stdout:JSON.stringify([{Id:'baseline-container',Config:{Image:'fixture/baseline@sha256:'+'a'.repeat(64),Labels:labels}}])};
      else if(args[0]==='start') {
        if(fault==='cancelled')cancelAcceptanceBaseline(JSON.parse(readFileSync(join(root,`baseline-current-${input.hash}.json`),'utf8')).handle);
        result={stdout:JSON.stringify({version:1,sha:plan.sha,reset:{kind:'project-local-synthetic-v1',executionId:plan.executionId},results:{version:1,phase:'baseline',identity:bundle.manifest.acceptance,assertions:[{assertionId:'A-summary',status:fault==='already-green'?'pass':fault==='unknown'?'unknown':'expected-behavioral-fail',failureId:fault==='already-green'||fault==='unknown'?null:fault==='mismatch'?'wrong-failure':'summary-unavailable-or-wrong',evidence:['fixture-output']},{assertionId:'A-order',status:'pass',failureId:null,evidence:['fixture-output']}],evidence:[]}})};
        if(execute) {
          const state=join(owned,'baseline-state');mkdirSync(state,{mode:0o700});
          const actual=execute(inputs,state);writeFileSync(join(owned,'baseline-driver.json'),JSON.stringify(actual));
          result={stdout:actual.stdout,stderr:actual.stderr,status:actual.status};
        }
      }
      else if(args[0]==='rm') result=fault==='cleanup-uncertain'?{status:1,stderr:'fixture cleanup unavailable'}:{}; else if(args[0]==='ps')result={stdout:fault==='cleanup-uncertain'?'baseline-container':''};
      else { socket.destroy(new Error('Unexpected engine call '+args)); return; }
      socket.end(JSON.stringify(result)+'\n');
    });socket.on('error',()=>{});});
    server.listen(socketPath);await once(server,'listening');
    try {
      const request={stateDir:context.sharedState,ownedRoot:owned,custodyRoot:root,agentMounts:[context.projectRoot,context.runtimeRoot],source:context.projectRoot,
        project:{root:context.projectRoot,tracker:{kind:TRACKER.kind,host:TRACKER.gitlabHost??TRACKER.host,project:TRACKER.project}},iid:String(iid),pointer:bundle.pointer,
        sha:execFileSync('git',['rev-parse',`origin/${base}`],{cwd:context.projectRoot,encoding:'utf8'}).trim(),runtimeRoot:runtime,
        engine:{command:process.execPath,args:[resolve(import.meta.dirname,'acceptance-engine.mjs'),socketPath]},image:'fixture/baseline@sha256:'+'a'.repeat(64),setup:real?[[ '/usr/bin/node','-e',"const fs=require('node:fs');if(fs.existsSync('/state/rows.json'))throw Error('dirty synthetic state');fs.writeFileSync('/state/rows.json',fs.readFileSync('/input/acceptance/fixtures/rows.json'));" ]]:[],
        reset:{kind:'project-local-synthetic-v1',recipe:'Disposable synthetic state only; no external CMS/database'},bounds:{totalMs:15000,outputBytes:1048576,memoryMiB:256,cpus:1,pids:64,diskMiB:128},cap:effectiveConfig.dispatch.maxConcurrent};
      const hostPlan={version:1,request,policyIdentity:context.policyIdentity,configDigest:acceptanceHash(readFileSync(context.projectPath('.factory/factory.toml'),'utf8'))};
      writeFileSync(join(root,`baseline-plan-${input.hash}.json`),JSON.stringify(hostPlan),{mode:0o600});
      const intent={version:1,request,runtime:context.manifest.id,dependencies:context.manifest.dependencies,approval:bundle.manifest.approvalDigest,setup:acceptanceHash(request.setup),reset:acceptanceHash(request.reset)};
      const digest=acceptanceHash(intent), grant={id:'fixture-explicit-execution-grant',intentDigest:digest,expiresAt:Date.now()+300000,
        evidence:[{criterionId:'C-manual',requirement:'independent documentation review',reference:'fixture-independent-review:17'}]};
      writeFileSync(join(root,`execution-authorization-${digest}.json`),JSON.stringify(grant),{mode:0o600,flag:'wx'});
      const {prepareAcceptanceBaselineForTicket}=await import(join(runtime,'acceptance-baseline-admission.mts'));
      try { await prepareAcceptanceBaselineForTicket(iid,base); }
      catch(error) { if(!fault || !String(error).includes('Acceptance baseline hold:'))throw error; }
    } finally {server.close();}
  }
  if(!fault) {
    const {requireAcceptanceBaselineForTicket}=await import(join(runtime,'acceptance-baseline-admission.mts'));
    process.stdout.write(JSON.stringify(await requireAcceptanceBaselineForTicket(iid,base)));
  }
}
