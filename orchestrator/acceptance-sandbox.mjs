// Trusted sandbox-only driver under a separate-UID root watchdog. Never execute this file on the host.
// Reconstructs a fresh private Git tree from bounded exact objects, runs pinned local setup, then frozen probes.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const plan=JSON.parse(readFileSync('/input/plan.json','utf8'));
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/state',LANG:'C.UTF-8',FACTORY_BASELINE_ROOT:'/work',FACTORY_STATE_ROOT:'/state',FACTORY_ACCEPTANCE_ROOT:'/input/acceptance',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
let used=0;
async function exec(argv,cwd,limit,input){
  if(Date.now()>=plan.deadline)throw Error('Total deadline');
  return new Promise((resolve,reject)=>{
    const child=spawn(argv[0],argv.slice(1),{cwd,env,stdio:[input?'pipe':'ignore','pipe','pipe'],detached:true});
    const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
    const timer=setTimeout(kill,Math.max(1,Math.min(limit.timeoutMs,plan.deadline-Date.now())));
    let stdout=[],stderr=[],count=0,overflow=false;
    const collect=(buf,dest)=>{count+=buf.length;used+=buf.length;if(count>limit.outputBytes||used>plan.bounds.outputBytes){overflow=true;kill();}else dest.push(buf);};
    child.stdout.on('data',b=>collect(b,stdout));child.stderr.on('data',b=>collect(b,stderr));
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',(status,signal)=>{clearTimeout(timer);if(overflow||signal||Date.now()>=plan.deadline)reject(Error('Sandbox output/deadline bound'));else resolve({status,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()});});
    if(input){child.stdin.on('error',()=>{});child.stdin.end(input);}
  });
}
const limit={timeoutMs:plan.bounds.totalMs,outputBytes:plan.bounds.outputBytes};
const git=async(args,input)=>{const r=await exec(['/usr/bin/git',...args],'/work',limit,input);if(r.status!==0)throw Error('Private Git failed');return r.stdout.trim();};
try{
  if(plan.version!==1||!['baseline','candidate'].includes(plan.phase ?? 'baseline')||Date.now()>=plan.deadline)throw Error('Invalid/late plan');
  await git(['init','--quiet']);await git(['unpack-objects'],readFileSync('/input/baseline.pack'));
  writeFileSync('/work/.git/shallow',plan.sha+'\n');await git(['-c','core.hooksPath=/dev/null','checkout','--detach','--force',plan.sha]);
  const verify=async()=>{if(await git(['rev-parse','HEAD'])!==plan.sha)throw Error('Baseline SHA changed');};
  await verify();
  for(const argv of plan.setup){const r=await exec(argv,'/work',limit);if(r.status!==0)throw Error('Synthetic local setup failed');}
  await verify();
  const assertions=[],observations=[];
  for(const probe of plan.contract.probes){
    await verify();
    const r=await exec(probe.argv,'/input/acceptance',probe.bounds);
    const observation={probeId:probe.id,...r};observations.push(observation);
    if(r.status!==0)throw Error('Probe infrastructure failure; nonzero exit is not behavioral red');
    const out=JSON.parse(r.stdout);
    if(out.version!==1||!Array.isArray(out.assertions)||Object.keys(out).sort().join()!=='assertions,version')throw Error('Invalid assertions-v1 output');
    const ids=plan.contract.assertions.filter(a=>a.probeId===probe.id).map(a=>a.id).sort();
    if(out.assertions.map(a=>a.assertionId).sort().join('\0')!==ids.join('\0'))throw Error('Probe assertion inventory mismatch');
    const ref=`${plan.phase ?? 'baseline'}:${plan.executionId}/${probe.id}/${createHash('sha256').update(r.stdout).digest('hex')}`;
    assertions.push(...out.assertions.map(a=>({...a,evidence:[ref]})));
  }
  await verify();
  // Manual/non-transition evidence is NOT inferred from probe strings; absent independent evidence stays a policy hold.
  process.stdout.write(JSON.stringify({version:1,sha:plan.sha,reset:{kind:'project-local-synthetic-v1',executionId:plan.executionId},results:{version:1,phase:plan.phase ?? 'baseline',identity:plan.identity,assertions,evidence:[]},observations}));
}catch(error){process.stderr.write(String(error));process.exitCode=1;}
