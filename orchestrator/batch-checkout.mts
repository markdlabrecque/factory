// Host-owned disposable Docker checkout transport for both proposal checks and the independent gate test.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export type ProcessResult = { exit: number | null; stdout: string; stderr: string };
// Require both the trusted driver's terminal record and its matching transport exit status.
export const TEST_DRIVER = `const {spawnSync}=require('node:child_process');
const [cmd,...args]=process.argv.slice(1); const r=spawnSync(cmd,args,{stdio:['ignore','inherit','inherit']});
if(r.error||r.signal||!Number.isInteger(r.status))process.exit(120);
require('node:fs').writeSync(2,'\\nFACTORY-TEST-COMPLETE '+r.status+'\\n');process.exit(r.status===0?0:42);`;
export function observeTestProcess(command:string,args:string[],input:Buffer,timeoutMs=15*60_000,cancel?:AbortSignal):Promise<ProcessResult> {
  return new Promise(resolve=>{
    if(cancel?.aborted){resolve({exit:null,stdout:'',stderr:'Checkout cancelled'});return;}
    const child=spawn(command,args,{cwd:'/',env:{PATH:process.env.PATH},stdio:['pipe','pipe','pipe']});
    const tail=(old:Buffer,chunk:Buffer)=>chunk.length>=32768?Buffer.from(chunk.subarray(-32768)):Buffer.concat([old.subarray(-Math.min(old.length,32768-chunk.length)),chunk]);
    const textTail=(bytes:Buffer)=>{const utf8=Buffer.from(bytes.toString());let at=Math.max(0,utf8.length-32768);while((utf8[at]&0xc0)===0x80)at++;return utf8.toString('utf8',at)};
    let out:Buffer=Buffer.alloc(0),err:Buffer=Buffer.alloc(0),unavailable=false;
    child.stdout.on('data',(b:Buffer)=>{out=tail(out,b)});child.stderr.on('data',(b:Buffer)=>{err=tail(err,b)});
    child.on('error',()=>{unavailable=true});child.stdin.on('error',()=>{unavailable=true});child.stdin.end(input);
    const stop=()=>{unavailable=true;child.kill('SIGKILL');child.stdout.destroy();child.stderr.destroy();child.stdin.destroy()};
    cancel?.addEventListener('abort',stop,{once:true});
    const timer=setTimeout(stop,timeoutMs);
    child.once('close',(code,signal)=>{
      clearTimeout(timer);cancel?.removeEventListener('abort',stop);const text=textTail(err), trailer=/\nFACTORY-TEST-COMPLETE (\d{1,3})\n$/.exec(text);
      const status=trailer?Number(trailer[1]):null;
      const complete=!unavailable && !signal && status!==null && status<=255 && code===(status===0?0:42);
      resolve({exit:complete?status:null,stdout:textTail(out),stderr:complete?text.slice(0,trailer!.index):text});
    });
  });
}
export const CHECKOUT_AND_TEST = `set -eu
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_ALLOW_PROTOCOL=
umask 077
work=$(mktemp -d); trap 'rm -rf -- "$work"' EXIT; cd "$work"
git init -q --template=
printf '%s\\n' "$1" >.git/shallow
git unpack-objects -q
git -c advice.detachedHead=false checkout -q --detach "$1"
test "$(git rev-parse HEAD)" = "$1"
driver=$2; shift 2
node -e "$driver" -- "$@"`;
const tmpfs='rw,exec,nosuid,nodev,size=1g';
const label='factory.batch.checkout';
function docker(args:string[]) {
  return new Promise<string>((ok,no)=>execFile('docker',args,{cwd:'/',env:{PATH:process.env.PATH},timeout:10_000,
    killSignal:'SIGKILL',maxBuffer:128*1024},(err,stdout)=>err?no(Error(`Docker ${args[0]} unavailable`)):ok(stdout.trim())));
}
export async function runCheckout(image:string,sha:string,pack:Buffer,argv:string[],seconds:number,cancel?:AbortSignal):Promise<ProcessResult>{
  cancel?.throwIfAborted();
  if(!/^sha256:[0-9a-f]{64}$/.test(image)||!/^[0-9a-f]{40}$/.test(sha)||seconds<1||seconds>840||!Number.isInteger(seconds))throw Error('Invalid checkout pins');
  const owner=randomUUID(),name=`factory-batch-${owner}`;
  const find=async(filter=`name=^/${name}$`)=>{
    const id=await docker(['container','ls','-aq','--no-trunc','--filter',filter]);
    if(id&&!/^[0-9a-f]{64}$/.test(id))throw Error('Unverifiable checkout identity');
    return id;
  };
  async function owned(id:string){
    const rows=JSON.parse(await docker(['container','inspect',id]));
    const row=rows[0];
    if(rows.length!==1||row?.Id!==id||row.Name!==`/${name}`||row.Config?.Labels?.[label]!==owner)throw Error('Cannot verify checkout ownership');
    return row;
  }
  let created='';
  try {
    created=await docker(['create','--name',name,'--label',`${label}=${owner}`,'--pull=never','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--read-only','--tmpfs',`/tmp:${tmpfs}`,'--pids-limit=256','--memory=2g','--cpus=1','--user=65534:65534','--no-healthcheck','--log-driver=none',
      '-i','--entrypoint','/usr/bin/env',image,'-i','HOME=/tmp','PATH=/usr/local/bin:/usr/bin:/bin','timeout','--signal=KILL',`${seconds}s`,'sh','-c',CHECKOUT_AND_TEST,'sh',sha,TEST_DRIVER,...argv]);
    if(!/^[0-9a-f]{64}$/.test(created))throw Error('Unverifiable checkout creation');
    const row=await owned(created), host=row.HostConfig;
    if(row.Image!==image||row.State?.Status!=='created'||row.Mounts?.length!==0||host.NetworkMode!=='none'||!host.ReadonlyRootfs||host.Privileged||
        row.Config.User!=='65534:65534'||host.Tmpfs?.['/tmp']!==tmpfs||Object.keys(host.Tmpfs).length!==1||
        host.PidMode||host.IpcMode!=='private'||host.UTSMode||host.UsernsMode==='host'||host.Devices?.length||host.DeviceRequests?.length||host.CapAdd?.length||
        JSON.stringify(host.CapDrop)!=='["ALL"]'||JSON.stringify(host.SecurityOpt)!=='["no-new-privileges"]'||
        host.PidsLimit!==256||host.Memory!==2*1024**3||host.NanoCpus!==1e9||host.LogConfig?.Type!=='none') throw Error('Cannot verify checkout isolation');
    const result=await observeTestProcess('docker',['start','-ai',created],pack,(seconds+10)*1000,cancel);
    cancel?.throwIfAborted();return result;
  } finally {
    // Failed create/attach is not proof of absence. Never delete a container by name or without its private ownership label.
    const named=await find(),id=/^[0-9a-f]{64}$/.test(created)?created:undefined;
    const byId=id?await find(`id=${id}`):'';
    if(id&&named!==byId)throw Error('Checkout identity changed; cleanup refused');
    if(named){
      if(id&&named!==id)throw Error('Checkout identity changed; cleanup refused');
      await owned(named);
      if(await docker(['rm','-fv',named])!==named||await find(`id=${named}`)||await find())throw Error('Checkout cleanup unverified');
    }
  }
}
