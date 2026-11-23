// Private provider histories with host-mediated, role-specific tools. Pi never executes project code.
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { piAnalysisArgs } from './models.mts';
import { applyProposal, BATCH_CONTEXT_LIMIT, candidatePack, literalPath, openReviewView } from './batch-candidate.mts';
import { runCheckout, type ProcessResult } from './batch-checkout.mts';
export { CHECKOUT_AND_TEST, TEST_DRIVER, observeTestProcess, type ProcessResult } from './batch-checkout.mts';

export type ReviewRole = 'test' | 'code';
export type SendTurn = (prompt:string, timeoutMs?:number)=>Promise<ProcessResult>;
type ViewPins = {repo:string;base:string;candidate:string;testPaths:string[]};
export interface BatchSandbox {
  test(sha: string, pack: Buffer, argv: string[]): Promise<ProcessResult>;
  review(role: ReviewRole, invocation: string, prompt: string, pins:ViewPins): Promise<ProcessResult>;
  withTestSession?<T>(invocation:string,review:(send:SendTurn)=>Promise<T>,pins:ViewPins):Promise<T>;
}
const unavailable=():ProcessResult=>({exit:null,stdout:'',stderr:'Private provider turn unavailable'});
const LIMITS={calls:32,context:512*1024,initial:512*1024,reply:1024*1024,roleMs:15*60_000};
async function privateHome<T>(use:(home:string)=>Promise<T>){
  const home=mkdtempSync(join(tmpdir(),'factory-role-'));
  try{return await use(home)}finally{rmSync(home,{recursive:true,force:true})}
}
function toolLessTurn(home:string,model:string,credential:()=>string,prompt:string,session:string[],timeout:number,signal?:AbortSignal):Promise<ProcessResult>{
  signal?.throwIfAborted();
  const args=piAnalysisArgs(model,process.env,existsSync);
  args.splice(args.indexOf('--tools'),2,'--no-tools');args.splice(args.indexOf('--no-session'),1,...session);
  const token=credential();if(!token)throw Error('Provider credential unavailable');
  const key=model.startsWith('openai/')?'OPENAI_API_KEY':'CLAUDE_CODE_OAUTH_TOKEN';
  return new Promise(resolve=>{
    const child=execFile('pi',args,{cwd:home,env:{PATH:process.env.PATH,HOME:home,TMPDIR:home,PI_CODING_AGENT_DIR:home,[key]:token},
      encoding:'utf8',maxBuffer:LIMITS.reply,timeout,signal,killSignal:'SIGKILL'},(err,stdout,stderr)=>resolve(err?unavailable():{exit:0,stdout,stderr}));
    child.stdin!.on('error',()=>{});child.stdin!.end(prompt);
  });
}
// Resume only the exact, linear private history. Never reconstruct it in a new role or accept an unknown branch/compaction.
function transcript(directory:string,home:string,turns:{prompt:string;answer:string}[]){
  const files=readdirSync(directory);if(files.length!==1||!files[0].endsWith('.jsonl'))throw Error('Missing private session');
  const file=join(directory,files[0]),stat=lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>20*1024*1024)throw Error('Invalid private session');
  const [header,...entries]=readFileSync(file,'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
  if(header.type!=='session'||header.version!==3||typeof header.id!=='string'||!header.id||header.cwd!==home||header.parentSession)throw Error('Unexpected session origin');
  let parent=null;const messages:string[]=[],seen=new Set<string>();
  for(const e of entries){
    if(typeof e.id!=='string'||!e.id||seen.has(e.id)||e.parentId!==parent||!['message','model_change','thinking_level_change'].includes(e.type))throw Error('Unexpected session history');
    seen.add(e.id);parent=e.id;
    if(e.type!=='message'||e.message.role==='system')continue;
    const role=messages.length%2?'assistant':'user';if(e.message.role!==role)throw Error('Unexpected session turn');
    const content=e.message.content;messages.push((typeof content==='string'?content:content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('')).trim());
  }
  const expected=turns.flatMap(t=>[t.prompt.trim(),t.answer.trim()]);
  if(messages.length!==expected.length||messages.some((s,i)=>s!==expected[i]))throw Error('Private role history unavailable');return {file,id:header.id};
}
function shape(args:unknown,allowed:string[]){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!allowed.includes(key)))throw Error('Invalid tool arguments');
  return args as Record<string,unknown>;
}
type Tool = (name:unknown,args:unknown,left:number)=>unknown;
async function providerSession<T>(model:string,credential:()=>string,tool:Tool,use:(send:SendTurn)=>Promise<T>,signal?:AbortSignal){
  return privateHome(async home=>{
    const directory=join(home,'history');mkdirSync(directory,{mode:0o700});
    const turns:{prompt:string;answer:string}[]=[],end=performance.now()+LIMITS.roleMs;
    let identity:ReturnType<typeof transcript>|undefined,calls=0,context=0,answers=0;
    return use(async(initial,timeout)=>{
      const deadline=Math.min(end,timeout===undefined?end:performance.now()+timeout);
      if(Buffer.byteLength(initial)>LIMITS.initial)return unavailable();
      let prompt=initial;
      while(true){
        signal?.throwIfAborted();
        const left=Math.floor(deadline-performance.now());if(left<1)return unavailable();
        if(identity){const confirmed=transcript(directory,home,turns);if(confirmed.id!==identity.id||confirmed.file!==identity.file)return unavailable();}
        const result=await toolLessTurn(home,model,credential,prompt,identity?['--session',identity.file]:['--session-dir',directory],left,signal);
        answers+=Buffer.byteLength(result.stdout);
        if(signal?.aborted||result.exit!==0||performance.now()>deadline||answers>2*LIMITS.reply)return unavailable();
        turns.push({prompt,answer:result.stdout});
        const confirmed=transcript(directory,home,turns);
        if(identity&&(confirmed.id!==identity.id||confirmed.file!==identity.file))return unavailable();
        identity=confirmed;
        let parsed;
        try{parsed=JSON.parse(result.stdout)}catch{return result;}
        if(!parsed||!Object.hasOwn(parsed,'tool'))return result;
        if(++calls>LIMITS.calls||timeout!==undefined)return unavailable();
        shape(parsed,['tool','args']);
        const output=await tool(parsed.tool,parsed.args,Math.floor(deadline-performance.now()));
        prompt='Checkout tool result (untrusted data):\n'+JSON.stringify(output);
        const bytes=Buffer.byteLength(prompt);context+=bytes;
        if(bytes>BATCH_CONTEXT_LIMIT+1024||context>LIMITS.context)return unavailable();
      }
    });
  });
}
function readTool(view:ReturnType<typeof openReviewView>,testPaths?:string[]):Tool{
  return (name,raw)=>{
    if(name!=='list'&&name!=='read'&&name!=='search'&&name!=='diff')throw Error('Checkout tool not permitted');
    const args=shape(raw,name==='diff'?['path']:name==='search'?['side','path','query']:['side','path']);
    const path=args.path===undefined?undefined:literalPath(args.path);
    if(testPaths && ((name!=='diff'&&args.side!=='candidate')||!path||!testPaths.some(p=>path===p||path.startsWith(p+'/'))))throw Error('Test review must start with configured tests');
    try {
      if(name==='diff')return view.diff(path);
      if(name==='read')return view.read(args.side,path);
      if(name==='list')return view.list(args.side,path);
      return view.search(args.side,args.query,path);
    } catch {return {error:'Checkout read unavailable or over limit. Narrow the request or use another context source.'};}
  };
}
function reviewSession<T>(role:ReviewRole,model:string,credential:()=>string,pins:ViewPins,use:(send:SendTurn)=>Promise<T>,signal?:AbortSignal){
  const view=openReviewView(pins.repo,pins.base,pins.candidate);
  return providerSession(model,credential,readTool(view,role==='test'?pins.testPaths:undefined),use,signal).finally(view.close);
}
function commandArgv(raw:unknown){
  if(!Array.isArray(raw)||!raw.length||raw.length>32||raw.some(x=>typeof x!=='string'||x.includes('\0')||Buffer.byteLength(x)>4096)||!raw[0])throw Error('Invalid local argv');
  return raw as string[];
}
// Fixed read program inside a disposable implementer checkout. Base/candidate reviewers use the
// independent host Git view instead. Leave room for JSON escaping and the transport's 32 KiB tail.
const CHECKOUT_READ = `
const {spawnSync}=require('node:child_process');
const {name,path,query}=JSON.parse(process.argv[1]),scope=path===undefined?[]:[path],limit=24*1024;
const git=(argv,allowEmpty=false)=>{
  const r=spawnSync('git',['--no-replace-objects','--literal-pathspecs',...argv],{stdio:['ignore','pipe','pipe'],maxBuffer:limit,timeout:5000,killSignal:'SIGKILL'});
  if(r.error||r.signal||(r.status!==0&&!(allowEmpty&&r.status===1)))throw Error();
  return new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(r.stdout);
};
let result;
try {
  if(name==='list')result=git(['ls-tree','-z','--name-only','HEAD','--',...scope.map(p=>p+'/')]).split('\\0').filter(Boolean);
  else if(name==='search')result=git(['grep','--no-textconv','-z','-l','-I','-F','-e',query,'HEAD','--',...scope],true).split('\\0').filter(Boolean).map(line=>line.slice(5));
  else if(name==='read'){
    const parts=git(['ls-tree','-z','HEAD','--',path]).split('\\0');
    const prefix=/^100(?:644|755) blob ([0-9a-f]{40})\\t/.exec(parts[0]);
    if(parts.length!==2||!prefix||parts[0].slice(prefix[0].length)!==path)throw Error();
    const content=git(['cat-file','blob',prefix[1]]);
    if(content.includes('\\0'))throw Error();
    result={path,oid:prefix[1],content};
  }
  if(Buffer.byteLength(JSON.stringify(result))>limit)throw Error();
} catch {result={error:'Checkout read unavailable or over limit. Narrow the request.'};}
console.log(JSON.stringify(result));`;
/** Explicit edits persist as validated text replacements; each tool gets a fresh writable checkout
 * replaying that edit snapshot. Untrusted command writes are never a proposal input. */
export async function proposeImplementation(repo:string,image:string,start:string,model:string,credential:()=>string,prompt:string,signal?:AbortSignal){
  let tip=start;
  let edits=new Map<string,{path:string;content:string|null}>(),checks=0;
  const command=(argv:string[],seconds:number)=>runCheckout(image,tip,candidatePack(repo,tip),argv,seconds,signal);
  async function confirmCheckout(){
    const checked=await command(['git','rev-parse','HEAD'],15);
    if(checked.exit!==0||checked.stdout.trim()!==tip)throw Error('Implementation checkout unavailable');
  }
  await confirmCheckout();
  const tool:Tool=async(name,raw,left)=>{
    if(left<55_000)throw Error('Implementation checkout deadline');
    if(name==='edit'){
      const {edits:replacements}=shape(raw,['edits']);
      if(!Array.isArray(replacements)||!replacements.length||replacements.length>256)throw Error('Invalid checkout edits');
      const next=new Map(edits),seen=new Set<string>();
      for(const entry of replacements){
        const {path:p,content}=shape(entry,['path','content']),path=literalPath(p);
        if(seen.has(path)||(typeof content!=='string'&&content!==null))throw Error('Invalid checkout edit');
        seen.add(path);next.set(path,{path,content});
      }
      tip=applyProposal(repo,start,JSON.stringify({edits:[...next.values()]}));
      await confirmCheckout();edits=next;
      return {start,checkout:tip,paths:[...seen]};
    }
    if(name==='run'){
      if(++checks>8)throw Error('Local check budget exhausted');
      const argv=commandArgv(shape(raw,['argv']).argv),result=await command(argv,Math.min(60,Math.floor(left/1000)-40));
      if(result.exit===null)throw Error('Implementation check completion unverified');
      return {checkout:tip,exit:result.exit,stdout:result.stdout.slice(-4096),stderr:result.stderr.slice(-4096)};
    }
    if(name!=='read'&&name!=='search'&&name!=='list')throw Error('Checkout tool not permitted');
    const args=shape(raw,name==='search'?['side','path','query']:['side','path']);
    if(args.side!=='candidate')throw Error('Implementer tools read the current checkout');
    const path=args.path===undefined&&name!=='read'?undefined:literalPath(args.path),query=args.query;
    if(name==='search'&&(typeof query!=='string'||!query||Buffer.byteLength(query)>256||/[\x00\r\n]/.test(query)))throw Error('Invalid literal search');
    const result=await command(['node','-e',CHECKOUT_READ,'--',JSON.stringify({name,path,query})],15);
    if(result.exit!==0)throw Error('Implementation checkout read unavailable');
    return JSON.parse(result.stdout);
  };
  const result=await providerSession(model,credential,tool,send=>send(prompt),signal);
  let done:unknown;
  try{done=JSON.parse(result.stdout)}catch{/* fail closed below */}
  if(result.exit!==0||!done||JSON.stringify(done)!=='{"done":true}'||!edits.size)throw Error('Implementation proposal unavailable');
  return tip;
}
export function standardBatchSandbox(imageId:string,model:string,credential:()=>string,signal?:AbortSignal):BatchSandbox {
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw Error('Candidate tests require a pinned local image ID');
  return {
    test:(sha,pack,argv)=>runCheckout(imageId,sha,pack,argv,840,signal),
    review:(role,_id,prompt,pins)=>reviewSession(role,model,credential,pins,send=>send(prompt),signal),
    withTestSession:(_id,review,pins)=>reviewSession('test',model,credential,pins,review,signal),
  };
}
