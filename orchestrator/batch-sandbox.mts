// Tool-less provider turns have private homes and data-only inputs. Only the credential-free, network-disabled test container executes a project.
import { execFile, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { piAnalysisArgs } from './models.mts';

export type ProcessResult = { exit: number | null; stdout: string; stderr: string };
export type ReviewRole = 'test' | 'code';
export type SendTurn = (prompt:string, timeoutMs?:number)=>Promise<ProcessResult>;
export interface BatchSandbox {
  test(sha: string, pack: Buffer, argv: string[]): Promise<ProcessResult>;
  review(role: ReviewRole, invocation: string, prompt: string): Promise<ProcessResult>;
  withTestSession?<T>(invocation:string,review:(send:SendTurn)=>Promise<T>):Promise<T>;
}
const unavailable=():ProcessResult=>({exit:null,stdout:'',stderr:'Private provider turn unavailable'});
// Keep setup/transport failure distinct from the configured child exiting nonzero. The parent observes
// close of the transport AND a matching terminal trailer/status from the test driver, never test prose.
export const TEST_DRIVER = `const {spawnSync}=require('node:child_process');
const [cmd,...args]=process.argv.slice(1); const r=spawnSync(cmd,args,{stdio:'inherit'});
if(r.error||r.signal||!Number.isInteger(r.status))process.exit(120);
require('node:fs').writeSync(2,'\\nFACTORY-TEST-COMPLETE '+r.status+'\\n');process.exit(r.status===0?0:42);`;
export function observeTestProcess(command:string,args:string[],input:Buffer,timeoutMs=15*60_000):Promise<ProcessResult> {
  return new Promise(resolve=>{
    const child=spawn(command,args,{cwd:'/',env:{PATH:process.env.PATH},stdio:['pipe','pipe','pipe']});
    const tail=(old:Buffer,chunk:Buffer)=>chunk.length>=32768?Buffer.from(chunk.subarray(-32768)):Buffer.concat([old.subarray(-Math.min(old.length,32768-chunk.length)),chunk]);
    const textTail=(bytes:Buffer)=>{const utf8=Buffer.from(bytes.toString());let at=Math.max(0,utf8.length-32768);while((utf8[at]&0xc0)===0x80)at++;return utf8.toString('utf8',at)};
    let out:Buffer=Buffer.alloc(0),err:Buffer=Buffer.alloc(0),unavailable=false;
    child.stdout.on('data',(b:Buffer)=>{out=tail(out,b)});child.stderr.on('data',(b:Buffer)=>{err=tail(err,b)});
    child.on('error',()=>{unavailable=true});child.stdin.on('error',()=>{unavailable=true});child.stdin.end(input);
    const timer=setTimeout(()=>{unavailable=true;child.kill('SIGKILL');child.stdout.destroy();child.stderr.destroy();child.stdin.destroy()},timeoutMs);
    child.once('close',(code,signal)=>{
      clearTimeout(timer);const text=textTail(err), trailer=/\nFACTORY-TEST-COMPLETE (\d{1,3})\n$/.exec(text);
      const status=trailer?Number(trailer[1]):null;
      const complete=!unavailable && !signal && status!==null && status<=255 && code===(status===0?0:42);
      resolve({exit:complete?status:null,stdout:textTail(out),stderr:complete?text.slice(0,trailer!.index):text});
    });
  });
}
// The trusted shell sees only host argv and a shallow pack. Checkout/setup failure cannot be reported as a green test.
export const CHECKOUT_AND_TEST = `set -eu
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
umask 077
work=$(mktemp -d); trap 'rm -rf -- "$work"' EXIT; cd "$work"
git init -q --template= .
printf '%s\\n' "$1" >.git/shallow
git unpack-objects -q
git -c advice.detachedHead=false checkout -q --detach "$1"
test "$(git rev-parse HEAD)" = "$1"
driver=$2; shift 2
node -e "$driver" -- "$@"`;

async function privateHome<T>(use:(home:string)=>Promise<T>){
  const home=mkdtempSync(join(tmpdir(),'factory-role-'));
  try{return await use(home)}finally{rmSync(home,{recursive:true,force:true})}
}
function toolLessTurn(home:string,model:string,credential:()=>string,prompt:string,session:string[],timeout=15*60_000):Promise<ProcessResult>{
  if(Buffer.byteLength(prompt)>8*1024*1024)throw Error('Provider input exceeds limit');
  const args=piAnalysisArgs(model,process.env,existsSync);
  args.splice(args.indexOf('--tools'),2,'--no-tools');args.splice(args.indexOf('--no-session'),1,...session);
  const token=credential();if(!token)throw Error('Provider credential unavailable');
  const key=model.startsWith('openai/')?'OPENAI_API_KEY':'CLAUDE_CODE_OAUTH_TOKEN';
  return new Promise(resolve=>{
    const child=execFile('pi',args,{cwd:home,env:{PATH:process.env.PATH,HOME:home,TMPDIR:home,PI_CODING_AGENT_DIR:home,[key]:token},
      encoding:'utf8',maxBuffer:1024*1024,timeout,killSignal:'SIGKILL'},(err,stdout,stderr)=>resolve(err?unavailable():{exit:0,stdout,stderr}));
    child.stdin!.on('error',()=>{});child.stdin!.end(prompt);
  });
}
export async function proposeImplementation(model:string,credential:()=>string,prompt:string){
  const result=await privateHome(home=>toolLessTurn(home,model,credential,prompt,['--no-session']));
  if(result.exit!==0)throw Error('Implementation proposal unavailable');return result.stdout;
}
// Only continue the actual private Pi history. Missing, compacted, branched or otherwise unrecognized histories cannot decide a verdict.
function transcript(directory:string,home:string,turns:{prompt:string;answer:string}[]){
  const files=readdirSync(directory);if(files.length!==1||!files[0].endsWith('.jsonl'))throw Error('Missing private session');
  const file=join(directory,files[0]),stat=lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>20*1024*1024)throw Error('Invalid private session');
  const [header,...entries]=readFileSync(file,'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
  if(header.type!=='session'||header.version!==3||typeof header.id!=='string'||!header.id||header.cwd!==home||header.parentSession)throw Error('Unexpected session origin');
  let parent=null;const messages:string[]=[];
  for(const e of entries){
    if(!e.id||e.parentId!==parent||!['message','model_change','thinking_level_change'].includes(e.type))throw Error('Unexpected session history');parent=e.id;
    if(e.type!=='message'||e.message.role==='system')continue;
    const role=messages.length%2?'assistant':'user';if(e.message.role!==role)throw Error('Unexpected session turn');
    const content=e.message.content;messages.push((typeof content==='string'?content:content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('')).trim());
  }
  const expected=turns.flatMap(t=>[t.prompt.trim(),t.answer.trim()]);
  if(messages.length!==expected.length||messages.some((s,i)=>s!==expected[i]))throw Error('Private review history unavailable');return {file,id:header.id};
}
export function standardBatchSandbox(imageId:string,model:string,credential:()=>string):BatchSandbox {
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw Error('Candidate tests require a pinned local image ID');
  return {
    test:(sha,pack,argv)=>observeTestProcess('docker',['run','--rm','--pull=never','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--read-only','--tmpfs','/tmp:rw,exec,nosuid,size=1g','--pids-limit=256','--memory=2g','--user=65534:65534',
      '-i','--entrypoint','/usr/bin/env',imageId,'-i','HOME=/tmp','PATH=/usr/local/bin:/usr/bin:/bin','timeout','--signal=KILL','840s','sh','-c',CHECKOUT_AND_TEST,'sh',sha,TEST_DRIVER,...argv],pack),
    review:(_role,_id,prompt)=>privateHome(home=>toolLessTurn(home,model,credential,prompt,['--no-session'])),
    withTestSession:(_id,review)=>privateHome(async home=>{
      const directory=join(home,'history');mkdirSync(directory,{mode:0o700});const turns:{prompt:string;answer:string}[]=[];
      return review(async(prompt,timeout)=>{
        if(turns.length>=2)return unavailable();
        const resume=turns.length?transcript(directory,home,turns):null;
        const result=await toolLessTurn(home,model,credential,prompt,resume?['--session',resume.file]:['--session-dir',directory],timeout);
        if(result.exit===0){
          turns.push({prompt,answer:result.stdout});
          if(resume){const final=transcript(directory,home,turns);if(final.file!==resume.file||final.id!==resume.id)return unavailable()}
        }
        return result;
      });
    }),
  };
}
