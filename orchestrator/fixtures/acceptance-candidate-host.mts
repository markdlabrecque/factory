// TEST ONLY independent host preparer and external engine boundary for the real normal verification entrypoint.
// The parent provisions exact grants after observing the candidate; the SDK can only signal/wait, never approve.
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,watch,renameSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import type {TestContext} from 'node:test';
import {acceptanceHash} from '../acceptance-contract.mts';
import {namespaceTransport} from './acceptance-namespace.mts';
export async function startCandidateHost(t:TestContext,runtime:string,cwd:string,env:NodeJS.ProcessEnv) {
  if(!['pass','readiness-acceptance','publication','shared-projects','project-override','continuation-pass','acceptance-replay-pass','acceptance-replay-unknown','acceptance-replay-infrastructure','acceptance-replay-mismatched-bundle','acceptance-replay-changed-candidate'].includes(env.SCENARIO!))return;
  const child=spawn(process.execPath,[import.meta.filename,'--host',runtime],{cwd,env,stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr!.on('data',b=>stderr+=b);
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error('Candidate host failed: '+stderr);})]);
}
if(process.argv[2]==='--host') {
  const runtime=process.argv[3],fake=process.env.FAKE_STATE!,scenario=process.env.SCENARIO!;
  const {context}=await import(join(runtime,'runtime-config.mts'));
  const {candidateRequestForTicket}=await import(join(runtime,'acceptance-baseline-admission.mts'));
  const root=join(context.sharedState,'acceptance');
  const tracker=await import(join(runtime,'tracker.mts'));
  const {freezeTicketInput}=await import(join(runtime,'ticket-input.mts'));
  const input=freezeTicketInput(tracker.contextSource,7);
  const planFile=join(root,`baseline-plan-${input.hash}.json`),baselinePlan=JSON.parse(readFileSync(planFile,'utf8'));
  const socketPath=baselinePlan.request.engine.args.at(-1);
  let labels:any,plan:any,inputs='';
  const real=scenario==='acceptance-replay-pass';
  const closure=real?join(fake,'candidate-namespace'):'';
  if(real)mkdirSync(closure,{mode:0o700});
  const execute=real?namespaceTransport(closure):undefined;
  const server=createServer(socket=>{let text='';socket.on('data',bytes=>{
    text+=bytes;if(!text.includes('\n'))return;
    const {args}=JSON.parse(text);let result:any={};
    if(args[0]==='info')result={stdout:'fixture-baseline-engine'};
    else if(args[0]==='image')result={stdout:JSON.stringify([{Id:'sha256:'+'a'.repeat(64),RepoDigests:[baselinePlan.request.image],Config:{Volumes:null}}])};
    else if(args[0]==='create') {
      labels=Object.fromEntries(args.flatMap((a:string,i:number)=>a==='--label'?[args[i+1].split('=')]:[]));
      inputs=args[args.indexOf('--mount')+1].match(/src=([^,]+)/)[1];
      plan=JSON.parse(readFileSync(join(inputs,'plan.json'),'utf8'));
      writeFileSync(join(fake,'candidate-input.json'),JSON.stringify(plan));
      result={stdout:'candidate-container'};
    } else if(args[0]==='inspect')result={stdout:JSON.stringify([{Id:'candidate-container',Config:{Image:baselinePlan.request.image,Labels:labels}}])};
    else if(args[0]==='start') {
      if(scenario==='acceptance-replay-infrastructure') result={status:1,stderr:'external engine unavailable'};
      else if(execute) {const state=join(fake,'candidate-state');mkdirSync(state,{mode:0o700});const actual=execute(inputs,state);writeFileSync(join(fake,'candidate-driver.json'),JSON.stringify(actual));result={stdout:actual.stdout,stderr:actual.stderr,status:actual.status};}
      else result={stdout:JSON.stringify({version:1,sha:plan.sha,reset:{kind:'project-local-synthetic-v1',executionId:plan.executionId},results:{version:1,phase:'candidate',identity:scenario==='acceptance-replay-mismatched-bundle'?{...plan.identity,contractDigest:'0'.repeat(64)}:plan.identity,assertions:[{assertionId:'A-summary',status:scenario==='acceptance-replay-unknown'?'unknown':'pass',failureId:null,evidence:['external-engine-output']},{assertionId:'A-order',status:'pass',failureId:null,evidence:['external-engine-output']}],evidence:[]}})};
    } else if(args[0]==='ps') {
      if(scenario==='acceptance-replay-changed-candidate')execFileSync('git',['update-ref','refs/heads/7-fix-login',baselinePlan.request.sha,plan.sha],{cwd:context.projectRoot});
      result={stdout:''};socket.once('close',()=>{clearTimeout(timeout);watcher.close();server.close();});}
    else if(args[0]!=='rm')throw Error('Unexpected engine command '+args);
    socket.end(JSON.stringify(result)+'\n');
  });});
  server.listen(socketPath);await once(server,'listening');
  const timeout=setTimeout(()=>process.exit(2),20000);
  let started=false;
  const watcher=watch(fake,async()=>{
    if(started||!existsSync(join(fake,'candidate-request')))return;started=true;
    try {
      const run=JSON.parse(readFileSync(join(context.sharedState,'owner_repo--7.json'),'utf8'));
      const {readPayloadCustody}=await import(join(runtime,'payload-custody.mts'));
      const custody=readPayloadCustody(context.sharedState,run.payloadCustody);
      // request builder is nonexecuting; actual reserve later authenticates CLOSED payload and current owner.
      const tip=execFileSync('git',['rev-parse',run.branch],{cwd:context.projectRoot,encoding:'utf8'}).trim();
      const workflow={key:custody.binding.key,executionId:run.executionId,claim:run.claim,entry:custody.binding.entry,custody:run.payloadCustody,baseline:run.implementationBaseSha,bindingDigest:run.acceptanceBaseline.bindingDigest};
      const request=await candidateRequestForTicket(7,'main',{sha:run.implementationBaseSha,admission:run.acceptanceBaseline},tip,workflow);
      const intent={version:1,request,runtime:context.manifest.id,dependencies:context.manifest.dependencies,approval:input&&JSON.parse(readFileSync(join(root,`prepared-${input.hash}.json`),'utf8')).approvalDigest,setup:acceptanceHash(request.setup),reset:acceptanceHash(request.reset)};
      const digest=acceptanceHash(intent);
      if(scenario!=='acceptance-missing-replay')writeFileSync(join(root,`execution-authorization-${digest}.json`),JSON.stringify({id:'fixture-independent-candidate-grant',intentDigest:digest,expiresAt:Date.now()+300000,evidence:[
        {criterionId:'C-feature',requirement:'independent replay transcript',reference:'fixture-host-reviewed-protocol:feature'},
        {criterionId:'C-preserve',requirement:'independent replay transcript',reference:'fixture-host-reviewed-protocol:preserve'},
        {criterionId:'C-manual',requirement:'independent documentation review',reference:'fixture-independent-review:17'},
      ]}),{mode:0o600,flag:'wx'});
      writeFileSync(join(fake,'candidate-ready.tmp'),'ready');renameSync(join(fake,'candidate-ready.tmp'),join(fake,'candidate-ready'));
    } catch(error){writeFileSync(join(fake,'candidate-host-error'),String(error));writeFileSync(join(fake,'candidate-ready'),'host failed');process.stderr.write(String(error));process.exit(2);}
  });
  process.on('SIGTERM',()=>{clearTimeout(timeout);watcher.close();server.close();process.exit(0);});
  process.send?.('ready');process.disconnect?.();
}
