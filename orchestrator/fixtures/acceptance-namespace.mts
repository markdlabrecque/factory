// Test-only external-engine transport: execute the unchanged copied sandbox driver in local namespaces.
// No host root, sockets, configuration, credentials or source mounts. Only fixture-private state is writable.
import { copyFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export function namespaceTransport(root:string) {
  const closure=join(root,'executable-closure');mkdirSync(closure,{mode:0o700});
  const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8'};
  const files=new Map<string,string>([['/usr/bin/node',process.execPath],['/usr/bin/git','/usr/bin/git'],['/usr/bin/true','/usr/bin/true']]);
  // Only trusted installed executables are inspected. Freeze their actual ELF dependency closure, not /usr or /.
  for(const binary of [...files.values()]){
    const output=execFileSync('/usr/bin/ldd',[binary],{env,encoding:'utf8',timeout:5000,maxBuffer:65536});
    for(const line of output.split('\n')){
      const path=line.match(/(?:=>\s+|^\s*)(\/[^\s()]+)/)?.[1];
      if(path)files.set(path,path);
      if(line.includes('not found'))throw Error(`Missing local runtime dependency: ${line}`);
    }
  }
  for(const [destination,source] of files){
    const target=join(closure,destination);mkdirSync(dirname(target),{recursive:true,mode:0o700});
    copyFileSync(realpathSync(source),target);
  }
  for(const name of ['input','work','state','tmp','run','proc','dev'])mkdirSync(join(closure,name),{mode:0o700});
  const common=['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--clearenv',
    '--ro-bind',closure,'/','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/run','--tmpfs','/work','--chdir','/work'];
  const execute=(args:string[])=>{
    // Resource guards for this tiny trusted fixture, NOT a claim of Docker/cgroup memory/CPU/PID enforcement.
    const r=spawnSync('/usr/bin/prlimit',['--cpu=10','--fsize=8388608','--nofile=128','--core=0','--',
      '/usr/bin/timeout','--signal=KILL','10s','/usr/bin/bwrap',...common,...args],
      {env,encoding:'utf8',timeout:12000,killSignal:'SIGKILL',maxBuffer:1048576});
    if(r.error)throw r.error;
    return {status:r.status??1,stdout:r.stdout,stderr:r.stderr};
  };
  const capability=execute(['--tmpfs','/state','--','/usr/bin/true']);
  if(capability.status!==0)throw Error(`Namespace capability unavailable (exit ${capability.status}): ${capability.stderr}`);
  return (input:string,state:string,stateWritable=true)=>execute(['--ro-bind',input,'/input',stateWritable?'--bind':'--ro-bind',state,'/state','--','/usr/bin/node','/input/acceptance-sandbox.mjs']);
}
