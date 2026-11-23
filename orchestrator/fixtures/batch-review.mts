// Synthetic agent/engine boundary: exact container argv, real env/timeout/checkout, and two private Pi doubles rendezvousing before verdicts.
import { chmodSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { CHECKOUT_AND_TEST, TEST_DRIVER, type ReviewRole } from '../batch-sandbox.mts';
export async function installBatchFixture(root:string,testArgv:string[],decide:(role:ReviewRole,prompt:string)=>unknown,implementSource?:string){
  const bin=join(root,'batch-fixture-bin');mkdirSync(bin);
  const entries=join(root,'agent-entries.jsonl');writeFileSync(entries,'');
  const waiting=new Map<ReviewRole,{socket:Socket;prompt:string}>(),sockets=new Set<Socket>();
  const server=createServer(socket=>{
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.setTimeout(8000,()=>socket.destroy());
    let text='';socket.setEncoding('utf8');socket.on('data',chunk=>{
      text+=chunk;if(!text.endsWith('\n'))return;
      const {role,prompt}=JSON.parse(text);
      if(prompt.startsWith('Final context stage:')){socket.end(JSON.stringify(decide(role,prompt))+'\n');return}
      waiting.set(role,{socket,prompt});
      if(waiting.size===2){const pair=[...waiting];waiting.clear();for(const [role,peer] of pair)peer.socket.end(JSON.stringify(decide(role,peer.prompt))+'\n')}
    });
  });
  function stub(name:string,source:string){const path=join(bin,name);writeFileSync(path,`#!${process.execPath}\nconst assert=require('node:assert/strict'),args=process.argv.slice(2);\n`+source);chmodSync(path,0o700)}
  stub('docker',`const pos=args.indexOf('--entrypoint');
    assert.deepEqual(Object.keys(process.env),['PATH']);
    assert.deepEqual(args.slice(0,pos),['run','--rm','--pull=never','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges','--read-only','--tmpfs','/tmp:rw,exec,nosuid,size=1g','--pids-limit=256','--memory=2g','--user=65534:65534','-i']);
    assert.equal(args[pos+1],'/usr/bin/env');assert.match(args[pos+2],/^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(args.slice(pos+3,pos+13),['-i','HOME=/tmp','PATH=/usr/local/bin:/usr/bin:/bin','timeout','--signal=KILL','840s','sh','-c',${JSON.stringify(CHECKOUT_AND_TEST)},'sh']);
    assert.match(args[pos+13],/^[a-f0-9]{40}$/);assert.equal(args[pos+14],${JSON.stringify(TEST_DRIVER)});assert.deepEqual(args.slice(pos+15),${JSON.stringify(testArgv)});
    // Simulate image ENV (not a sanitized child). Run the production entrypoint and every subsequent argument unchanged.
    const r=require('node:child_process').spawnSync(args[pos+1],args.slice(pos+3),{stdio:'inherit',env:{...process.env,OPENAI_API_KEY:'image-sentinel',CLAUDE_CODE_OAUTH_TOKEN:'image-sentinel'}});process.exit(r.status??1);`);
  await new Promise<void>((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
  const close=()=>{for(const socket of sockets)socket.destroy();server.close()};
  try {
    const address=server.address();if(!address||typeof address==='string')throw Error('Missing fixture address');
    stub('pi',`const fs=require('node:fs'),path=require('node:path'),prompt=fs.readFileSync(0,'utf8');
      const entry=prompt.startsWith('# Implement')?'implementer':'reviewer',initial=args.includes('--session-dir'),resume=args.includes('--session');
      const dir=initial?args[10]:null,file=resume?args[10]:initial?path.join(dir,'fixture-session.jsonl'):null;
      const mode=initial?'--session-dir':resume?'--session':'--no-session';
      const base=['-p','--model',args[2],'--thinking','high','--no-tools','--no-extensions','--no-skills','--no-context-files',mode,...(file?[args[10]]:[])];
      const subscription=args[2].startsWith('pi-claude-subscription/');assert.deepEqual(args,subscription?[...base,'-e',args.at(-1)]:base);
      assert.equal(process.env[subscription?'CLAUDE_CODE_OAUTH_TOKEN':'OPENAI_API_KEY'],'fixture-only');assert.equal(process.env.GH_TOKEN,undefined);
      assert.equal(process.cwd(),process.env.HOME);assert.equal(process.env.PI_CODING_AGENT_DIR,process.cwd());assert(!fs.existsSync('.git'));
      const home=process.cwd();fs.appendFileSync(${JSON.stringify(entries)},JSON.stringify({entry,pid:process.pid,home,model:args[2],extension:subscription?args.at(-1):null})+'\\n');
      if(entry==='implementer'){assert.equal(mode,'--no-session');assert.deepEqual(fs.readdirSync(home),[]);${implementSource??"throw Error('Unexpected implementer')"};process.exit(0)}
      const role=initial||resume?'test':'code';if(!resume)assert(prompt.startsWith('# Independent '+(role==='code'?'implementation':role)+' review'));
      if(initial){assert.equal(path.dirname(dir),home);fs.writeFileSync(file,JSON.stringify({type:'session',version:3,id:'fixture',cwd:home})+'\\n')}
      let reason='';if(resume){assert.equal(path.dirname(path.dirname(file)),home);const history=fs.readFileSync(file,'utf8').trim().split('\\n').map(JSON.parse);
        assert.equal(history.length,3);assert(history[1].message.content.startsWith('# Independent test review'));assert(!history[1].message.content.includes('IMPLEMENTATION_ONLY'));
        reason=JSON.parse(history[2].message.content[0].text).assessment;assert(reason);assert(!prompt.includes(reason));}
      const s=require('node:net').connect(${address.port},'127.0.0.1',()=>s.write(JSON.stringify({role,prompt})+'\\n'));let text='';s.on('data',c=>text+=c);
      s.on('end',()=>{const reply=JSON.parse(text);if(resume)reply.reason=reason;if(file){const n=resume?3:1;
        for(const [i,message] of [{role:'user',content:prompt},{role:'assistant',content:[{type:'text',text:JSON.stringify(reply)}]}].entries())fs.appendFileSync(file,JSON.stringify({type:'message',id:String(n+i),parentId:n+i===1?null:String(n+i-1),message})+'\\n');}
        console.log(JSON.stringify(reply));});`);
    return {bin,entries:()=>readFileSync(entries,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)),close};
  }catch(err){close();throw err}
}
