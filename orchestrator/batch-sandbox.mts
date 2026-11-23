// Fresh mount-free implementation/test containers and tool-less reviewer processes. No host Git metadata, tracker credentials or delivery callbacks.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { piAnalysisArgs } from './models.mts';

export type ProcessResult = { exit: number | null; stdout: string; stderr: string };
export type ReviewRole = 'test' | 'code';
export interface BatchSandbox {
  test(sha: string, pack: Buffer, argv: string[]): Promise<ProcessResult>;
  review(role: ReviewRole, invocation: string, prompt: string, timeoutMs?: number): Promise<ProcessResult>;
}
// Keep setup/transport failure distinct from the configured child exiting nonzero. The parent observes
// close of the transport AND a matching terminal trailer/status from the test driver, never test prose.
export const TEST_DRIVER = `const {spawnSync}=require('node:child_process');
const [cmd,...args]=process.argv.slice(1); const r=spawnSync(cmd,args,{stdio:'inherit'});
if(r.error||r.signal||!Number.isInteger(r.status))process.exit(120);
require('node:fs').writeSync(2,'\\nFACTORY-TEST-COMPLETE '+r.status+'\\n');process.exit(r.status===0?0:42);`;
export function observeTestProcess(command:string,args:string[],input:Buffer,timeoutMs=15*60_000):Promise<ProcessResult> {
  return new Promise(resolve=>{
    const child=spawn(command,args,{cwd:'/',stdio:['pipe','pipe','pipe']});
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
work=$(mktemp -d); cd "$work"
git init -q --template= .
printf '%s\\n' "$1" >.git/shallow
git unpack-objects -q
git -c advice.detachedHead=false checkout -q --detach "$1"
test "$(git rev-parse HEAD)" = "$1"
driver=$2; shift 2
exec node -e "$driver" -- "$@"`;
// First stdin line is the bounded base64 prompt; remaining bytes are only the supplied commit/tree pack.
export const IMPLEMENT_DELTA = `set -eu
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME=Factory GIT_COMMITTER_NAME=Factory GIT_AUTHOR_EMAIL=factory@localhost GIT_COMMITTER_EMAIL=factory@localhost
umask 077
IFS= read -r prompt
export HOME=$(mktemp -d); work=$(mktemp -d); cd "$work"
printf '%s' "$prompt" | base64 -d > "$HOME/task"
git init -q --template= .; printf '%s\\n' "$1" >.git/shallow; git unpack-objects -q
git -c advice.detachedHead=false checkout -q --detach "$1"
start=$1; shift
pi "$@" < "$HOME/task" >/dev/null
test -z "$(git status --porcelain --untracked-files=all)"
git merge-base --is-ancestor "$start" HEAD
tip=$(git rev-parse HEAD); printf '%s ' "$tip"; git cat-file commit "$tip" | base64 -w0; printf '\\n'
git diff --binary --full-index --no-ext-diff --no-textconv --no-renames --ignore-submodules=none "$start" HEAD --`;
export async function implementInContainer(image:string, model:string, credential:() => string, start:string, pack:Buffer, prompt:string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || !/^[a-f0-9]{40}$/.test(start) || Buffer.byteLength(prompt)>8*1024*1024) throw Error('Invalid implementation input');
  const subscription=model.startsWith('pi-claude-subscription/'), key=subscription?'CLAUDE_CODE_OAUTH_TOKEN':'OPENAI_API_KEY';
  const token=credential(); if (!token) throw Error('Implementation provider credential unavailable');
  const result=await run('docker',['run','--rm','--pull=never','--cap-drop=ALL','--security-opt=no-new-privileges',
    '--read-only','--tmpfs','/tmp:rw,exec,nosuid,size=1g','--pids-limit=256','--memory=2g','--user=65534:65534','-e',key,
    '-i','--entrypoint','timeout',image,'--signal=KILL','840s','sh','-c',IMPLEMENT_DELTA,'sh',start,'-p','--model',model,'--thinking','high','--no-extensions','--no-session',
    ...(subscription?['-e','/home/agent/.pi/agent/extensions/pi-claude-subscription/index.ts']:[])],
    Buffer.concat([Buffer.from(Buffer.from(prompt).toString('base64')+'\n'),pack]),'/',{...process.env,[key]:token});
  if(result.exit!==0) throw Error('Batch implementation process failed; no candidate');
  const split=result.stdout.indexOf('\n');
  const header=/^([a-f0-9]{40}) ([A-Za-z0-9+/=]+)$/.exec(result.stdout.slice(0,split));
  if(!header || header[2].length>65536) throw Error('Invalid implementation commit header');
  const commit=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(header[2],'base64'));
  return {tip:header[1],commit,patch:result.stdout.slice(split+1)};
}
function run(cmd: string, args: string[], input: Buffer | string, cwd: string, env?: NodeJS.ProcessEnv, timeout=15*60_000): Promise<ProcessResult> {
  return new Promise(resolve => {
    const child = execFile(cmd, args, {cwd, env, encoding:'utf8', maxBuffer:1024*1024, timeout, killSignal:'SIGKILL'}, (err,out,log) => {
      resolve({exit: err ? typeof err.code === 'number' ? err.code : null : 0, stdout:out, stderr:log});
    });
    child.stdin!.on('error', () => {}); child.stdin!.end(input);
  });
}
export function standardBatchSandbox(imageId: string, reviewModel: string, reviewerCredential: () => string): BatchSandbox {
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('Candidate tests require a pinned local image ID');
  return {
    test: (sha, pack, argv) => observeTestProcess('docker',['run','--rm','--pull=never','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--read-only','--tmpfs','/tmp:rw,exec,nosuid,size=1g','--pids-limit=256','--memory=2g','--user=65534:65534','-e','HOME=/tmp',
      '-i','--entrypoint','timeout',imageId,'--signal=KILL','840s','sh','-c',CHECKOUT_AND_TEST,'sh',sha,TEST_DRIVER,...argv],pack),
    async review(_role, _id, prompt, timeoutMs) {
      const cwd = mkdtempSync(join(tmpdir(),'factory-role-'));
      try {
        const args = piAnalysisArgs(reviewModel, process.env, existsSync);
        args.splice(args.indexOf('--tools'),2,'--no-tools');
        const credential = reviewerCredential();
        if (!credential) throw Error('Reviewer provider credential unavailable');
        const key = reviewModel.startsWith('openai/') ? 'OPENAI_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN';
        return await run('pi',args,prompt,cwd,{PATH:process.env.PATH, HOME:cwd, TMPDIR:cwd, PI_CODING_AGENT_DIR:cwd, [key]:credential},timeoutMs);
      } finally { rmSync(cwd,{recursive:true,force:true}); }
    },
  };
}
