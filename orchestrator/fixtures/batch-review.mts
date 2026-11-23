// Synthetic Docker custody/checkout and private Pi conversation doubles for the standard batch path.
import { chmodSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { CHECKOUT_AND_TEST, TEST_DRIVER, type ReviewRole } from '../batch-sandbox.mts';
export async function installBatchFixture(root:string,testArgv:string[],decide:(role:ReviewRole,prompt:string,output?:unknown)=>unknown,implementSource?:string){
  const bin=join(root,'batch-fixture-bin');mkdirSync(bin);
  const containers=join(bin,'containers');mkdirSync(containers);
  const entries=join(root,'agent-entries.jsonl');writeFileSync(entries,'');
  type Peer={socket:Socket;prompt:string;output?:unknown};
  const waiting=new Map<ReviewRole,Peer>(),sockets=new Set<Socket>();
  const server=createServer(socket=>{
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.setTimeout(8000,()=>socket.destroy());
    let text='';socket.setEncoding('utf8');socket.on('data',chunk=>{
      text+=chunk;if(!text.endsWith('\n'))return;
      const {role,prompt,output}=JSON.parse(text);
      if(prompt.startsWith('Final context stage:')){socket.end(JSON.stringify(decide(role,prompt))+'\n');return}
      waiting.set(role,{socket,prompt,output});
      if(waiting.size===2){const pair=[...waiting];waiting.clear();for(const [role,peer] of pair)peer.socket.end(JSON.stringify(decide(role,peer.prompt,peer.output))+'\n')}
    });
  });
  function stub(name:string,source:string){const path=join(bin,name);writeFileSync(path,`#!${process.execPath}\nconst assert=require('node:assert/strict'),args=process.argv.slice(2);\n`+source);chmodSync(path,0o700)}
  stub('docker',`const pos=args.indexOf('--entrypoint'),fs=require('node:fs'),dir=${JSON.stringify(containers)},path=require('node:path');
    const file=id=>path.join(dir,id),get=id=>JSON.parse(fs.readFileSync(file(id),'utf8'));
    assert.deepEqual(Object.keys(process.env),['PATH']);
    if(args[0]==='create'){
      const name=args[2],owner=name.slice('factory-batch-'.length),id=require('node:crypto').randomBytes(32).toString('hex');
      assert.deepEqual(args.slice(0,pos),['create','--name',name,'--label','factory.batch.checkout='+owner,'--pull=never','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges','--read-only','--tmpfs','/tmp:rw,exec,nosuid,nodev,size=1g','--pids-limit=256','--memory=2g','--cpus=1','--user=65534:65534','--no-healthcheck','--log-driver=none','-i']);
      assert.equal(args[pos+1],'/usr/bin/env');const image=args[pos+2];assert.match(image,/^sha256:[a-f0-9]{64}$/);
      assert.deepEqual(args.slice(pos+3,pos+9),['-i','HOME=/tmp','PATH=/usr/local/bin:/usr/bin:/bin','timeout','--signal=KILL',args[pos+8]]);
      assert.match(args[pos+8],/^\\d+s$/);assert.deepEqual(args.slice(pos+9,pos+13),['sh','-c',${JSON.stringify(CHECKOUT_AND_TEST)},'sh']);
      assert.match(args[pos+13],/^[a-f0-9]{40}$/);assert.equal(args[pos+14],${JSON.stringify(TEST_DRIVER)});
      if(args[pos+8]==='840s')assert.deepEqual(args.slice(pos+15),${JSON.stringify(testArgv)});
      const row={Id:id,Name:'/'+name,Image:image,State:{Status:'created'},Mounts:[],Config:{User:'65534:65534',Labels:{'factory.batch.checkout':owner}},
        HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Tmpfs:{'/tmp':'rw,exec,nosuid,nodev,size=1g'},IpcMode:'private',CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],PidsLimit:256,Memory:2*1024**3,NanoCpus:1e9,LogConfig:{Type:'none'}}};
      if(fs.existsSync(path.join(dir,'../foreign-owner')))row.Config.Labels['factory.batch.checkout']='foreign';
      fs.writeFileSync(file(id),JSON.stringify({row,cmd:args[pos+1],args:args.slice(pos+3)}));console.log(id);
    }else if(args[0]==='container'&&args[1]==='inspect')console.log(JSON.stringify([get(args[2]).row]));
    else if(args[0]==='container'&&args[1]==='ls'){
      for(const id of fs.readdirSync(dir))if(['id='+id,'name=^'+get(id).row.Name+'$'].includes(args.at(-1)))console.log(id);
    }else if(args[0]==='rm'){
      if(fs.existsSync(path.join(dir,'../refuse-cleanup')))process.exit(1);
      fs.unlinkSync(file(args[2]));console.log(args[2]);
    }
    else if(args[0]==='start'){
      const run=get(args[2]);assert.notEqual(run.row.Config.Labels['factory.batch.checkout'],'foreign');
      const r=require('node:child_process').spawnSync(run.cmd,run.args,{stdio:'inherit',env:{...process.env,OPENAI_API_KEY:'image-sentinel',CLAUDE_CODE_OAUTH_TOKEN:'image-sentinel',GH_TOKEN:'image-sentinel'}});process.exit(r.status??1);
    }else throw Error('Unexpected Docker argv: '+args);`);
  await new Promise<void>((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
  const close=()=>{for(const socket of sockets)socket.destroy();server.close()};
  try {
    const address=server.address();if(!address||typeof address==='string')throw Error('Missing fixture address');
    stub('pi',`const fs=require('node:fs'),path=require('node:path'),prompt=fs.readFileSync(0,'utf8');
      const initial=args.includes('--session-dir'),mode=initial?'--session-dir':'--session';
      const file=initial?path.join(args[10],'fixture-session.jsonl'):args[10];
      const base=['-p','--model',args[2],'--thinking','high','--no-tools','--no-extensions','--no-skills','--no-context-files',mode,args[10]];
      const subscription=args[2].startsWith('pi-claude-subscription/');assert.deepEqual(args,subscription?[...base,'-e',args.at(-1)]:base);
      assert.equal(process.env[subscription?'CLAUDE_CODE_OAUTH_TOKEN':'OPENAI_API_KEY'],'fixture-only');assert.equal(process.env.GH_TOKEN,undefined);
      const home=process.cwd();assert.equal(home,process.env.HOME);assert.equal(process.env.PI_CODING_AGENT_DIR,home);assert(!fs.existsSync('.git'));
      assert.equal(path.dirname(path.dirname(file)),home);
      if(initial)fs.writeFileSync(file,JSON.stringify({type:'session',version:3,id:'fixture',cwd:home})+'\\n');
      const history=fs.readFileSync(file,'utf8').trim().split('\\n').slice(1).map(JSON.parse),original=history[0]?.message.content??prompt;
      const entry=original.startsWith('# Implement')?'implementer':'reviewer',role=original.startsWith('# Independent test review')?'test':'code';
      assert(!original.includes('LARGE_IRRELEVANT'));
      fs.appendFileSync(${JSON.stringify(entries)},JSON.stringify({entry,role,pid:process.pid,home,model:args[2],extension:subscription?args.at(-1):null,initial})+'\\n');
      const reply=value=>{
        const n=history.length+1;
        for(const [i,message] of [{role:'user',content:prompt},{role:'assistant',content:[{type:'text',text:JSON.stringify(value)}]}].entries()){
          try{fs.appendFileSync(file,JSON.stringify({type:'message',id:String(n+i),parentId:n+i===1?null:String(n+i-1),message})+'\\n')}catch{}
        }
        console.log(JSON.stringify(value));
      };
      const tool=(tool,args)=>reply({tool,args});
      const output=initial||prompt.startsWith('Final context stage:')?null:JSON.parse(prompt.slice(prompt.indexOf('\\n')+1));
      if(entry==='implementer'){
        const pins=JSON.parse(original.split('Host proposal input:\\n').at(-1));
        if(initial)return tool('search',{side:'candidate',query:'require'});
        if(history.length===2){assert(Array.isArray(output)&&output.length>0);return tool('read',{side:'candidate',path:output[0]});}
        if(history.length===4){assert(output.content.includes('require'));const cmd="const assert=require('node:assert/strict');assert.equal(process.env.GH_TOKEN,undefined);assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);require('node:fs').writeFileSync('scratch','scratch');console.log(require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());";return tool('run',{argv:['node','-e',cmd]});}
        if(history.length===6){assert.equal(output.exit,0);assert.equal(output.stdout.trim(),pins.start);(function(prompt,console){${implementSource??"throw Error('Unexpected implementer')"}})(original,{log:s=>tool('edit',JSON.parse(s))});return;}
        if(history.length===8){assert.equal(output.start,pins.start);assert.notEqual(output.checkout,pins.start);
          return tool('run',{argv:['node','-e',"const fs=require('node:fs'),assert=require('node:assert/strict');assert(!fs.existsSync('scratch'));assert(fs.existsSync(process.argv[1]));console.log(require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());",output.paths[0]]});}
        const editResult=JSON.parse(history[8].message.content.split('\\n').at(-1));assert.equal(output.exit,0);assert.equal(output.stdout.trim(),editResult.checkout);return reply({done:true});
      }
      const pins=JSON.parse(original.slice(original.indexOf('\\n{')+1));
      if(initial){assert.match(pins.candidate,/^[a-f0-9]{40}$/);assert.match(pins.base,/^[a-f0-9]{40}$/);
        if(role==='test'){assert.equal(pins.tests.exit,0);assert.deepEqual(pins.tests.argv,${JSON.stringify(testArgv)});const p=pins.testPaths[0];return tool(p==='tests'?'search':'read',p==='tests'?{side:'candidate',path:p,query:'require'}:{side:'candidate',path:p});}
        return tool('diff',{});
      }
      if(role==='test'&&history.length===2&&Array.isArray(output))return tool('read',{side:'candidate',path:output[0].slice(41)});
      const final=prompt.startsWith('Final context stage:');
      if(!final&&role==='test')assert(output?.content?.includes('require'));
      if(!final&&role==='code')assert(typeof output==='string'&&/^:(?:000000|100644) /m.test(output));
      const s=require('node:net').connect(${address.port},'127.0.0.1',()=>s.write(JSON.stringify({role,prompt:final?prompt:original,output})+'\\n'));let text='';s.on('data',c=>text+=c);
      s.on('end',()=>{const value=JSON.parse(text);if(final){const reason=JSON.parse(history.at(-1).message.content[0].text).assessment;assert(reason);assert(!prompt.includes(reason));value.reason=reason;}reply(value);});`);
    return {bin,containers,entries:()=>readFileSync(entries,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)),close};
  }catch(err){close();throw err}
}
