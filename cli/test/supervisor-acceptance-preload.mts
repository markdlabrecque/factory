// TEST ONLY: copied public CLI instrumentation; deny outbound, substitute only HTTP/SSE below the pinned SDK.
// Native pipes expose send and post-parent-fsync human publication; neither is a public capability flag.
import fs from 'node:fs';
import cp from 'node:child_process';
import { dirname } from 'node:path';
import { syncBuiltinESMExports, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { denyNetwork, providerTextStream } from './supervisor-provider-fixture.mts';
const config = JSON.parse(fs.readFileSync(new URL(import.meta.url).searchParams.get('config')!, 'utf8'));
denyNetwork();
// Instrumentation imports above are test-owned. Subsequent production source fallback is forbidden.
registerHooks({resolve(specifier,context,next){
  const result=next(specifier,context);
  if(result.url.startsWith('file:') && fileURLToPath(result.url).startsWith(config.originalSource)
    && !fileURLToPath(result.url).includes('/cli/test/')) throw Error('Original production source access denied');
  return result;
}});
if(process.argv[1]?.endsWith('factory.mts')) {
  try { await import(config.forbiddenOriginal); throw Error('Negative source probe was permitted'); }
  catch(e) { if(!String(e).includes('Original production source access denied')) throw e; }
}
const spawn = cp.spawn;
cp.spawn = ((command:any,args:any[],options:any) => {
  if (String(args[0]).endsWith('supervisor-guard.mjs') || String(args[0]).endsWith('supervisor-runner.mts')) {
    args = ['--import',import.meta.url,...args];
    options = {...options,stdio:[...options.stdio,'ignore',...(config.unknown ? [5,6] : [])]};
  }
  return spawn(command,args,options);
}) as any;
if (process.argv[1]?.endsWith('factory.mts') && config.unknown) {
  const fsync = fs.fsyncSync;
  let published = false;
  fs.fsyncSync = ((fd:number) => {
    fsync(fd); // The real parent-directory fsync MUST finish before this barrier.
    const stat=fs.fstatSync(fd), parent=fs.statSync(dirname(config.journal));
    if (published || !stat.isDirectory() || stat.ino!==parent.ino || stat.dev!==parent.dev) return;
    let journal:any;
    try { journal = JSON.parse(fs.readFileSync(config.journal,'utf8')); } catch { return; }
    if (!Object.values(journal.projects ?? {}).some((s:any)=>Object.keys(s.humans).length)) return;
    published = true;
    process.send!({kind:'durable-human'});
    fs.readSync(4,Buffer.alloc(1),0,1,null); // Controller deliberately killed by parent before CLI return.
  }) as any;
}
syncBuiltinESMExports();
if (process.argv[1]?.endsWith('supervisor-runner.mts')) {
  globalThis.fetch = async (url,init) => {
    if (String(url)!=='https://api.openai.com/v1/responses' || init?.method!=='POST') throw Error('Offline only');
    const payload = JSON.parse(String(init.body));
    fs.appendFileSync(config.trace,JSON.stringify({url:String(url),method:init.method,payload})+'\n',{mode:0o600});
    if (config.unknown) {
      fs.writeSync(5,'sent\n');
      fs.readSync(6,Buffer.alloc(1),0,1,null);
    }
    const dirs = fs.readdirSync(config.inputRoot,{recursive:true}).filter(n=>String(n).endsWith('/input.json'));
    if (dirs.length!==1) throw Error('Expected exactly one genuine frozen input');
    const input=JSON.parse(fs.readFileSync(config.inputRoot+'/'+dirs[0],'utf8'));
    const text=JSON.stringify({version:1,incidentId:input.incidentId,basisHash:input.basis,classification:'expectation',
      rationale:'Synthetic typed wait; inspect complete originals',alternatives:['Ask a human for a material instruction'],
      action:{kind:'wait',expectation:'Await exact human evidence'}});
    return new Response(providerTextStream(text,{missingUsage:config.unknown}),{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req_offline'}});
  };
}
