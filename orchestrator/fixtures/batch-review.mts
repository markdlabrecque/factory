// Offline PATH boundary for the prospective gate and copied-install journey. Install only for fixture-authored candidate Git objects/test argv.
// Exact command/authority checks guard the synthetic test checkout. Two actual Pi doubles rendezvous on a fixture-owned loopback socket.
import { chmodSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { CHECKOUT_AND_TEST, IMPLEMENT_DELTA, TEST_DRIVER, type ReviewRole } from '../batch-sandbox.mts';
export async function installBatchFixture(root: string, testArgv: string[], decide: (role:ReviewRole, prompt:string) => unknown, implementSource?:string) {
  // Short loopback TCP address also works with deeply nested copied-install fixture roots.
  const waiting = new Map<ReviewRole,{socket:Socket; prompt:string}>();
  const server = createServer(socket=>{
    socket.setTimeout(8000,()=>socket.destroy());
    let text=''; socket.setEncoding('utf8'); socket.on('data',chunk=>{
      text+=chunk; if (!text.endsWith('\n')) return;
      const {role,prompt}=JSON.parse(text);
      if(role==='test' && prompt.includes('\nFinal context stage: return a verdict now.\n')) {socket.end(JSON.stringify(decide(role,prompt))+'\n');return}
      waiting.set(role,{socket,prompt});
      if (waiting.size===2) {
        const pair=[...waiting];waiting.clear();
        for (const [role,peer] of pair) peer.socket.end(JSON.stringify(decide(role,peer.prompt))+'\n');
      }
    });
  });
  await new Promise<void>((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
  const address=server.address(); if (!address || typeof address==='string') throw Error('Missing fixture address');
  const bin=join(root,'batch-fixture-bin'); mkdirSync(bin);
  const entries=join(root,'agent-entries.jsonl');writeFileSync(entries,'');
  function stub(name:string,source:string) {
    const path=join(bin,name);writeFileSync(path,`#!${process.execPath}\nconst assert=require('node:assert/strict'),args=process.argv.slice(2);\n`+source); chmodSync(path,0o700);
  }
  stub('docker',`const pos=args.indexOf('--entrypoint');
    if(args[pos+7]===${JSON.stringify(IMPLEMENT_DELTA)}) {
      assert.deepEqual(args.slice(0,pos),['run','--rm','--pull=never','--cap-drop=ALL','--security-opt=no-new-privileges','--read-only','--tmpfs','/tmp:rw,exec,nosuid,size=1g','--pids-limit=256','--memory=2g','--user=65534:65534','-e',args[pos-2],'-i']);
      const subscription=args[args.indexOf('--model')+1].startsWith('pi-claude-subscription/');
      assert.equal(args[pos-2],subscription?'CLAUDE_CODE_OAUTH_TOKEN':'OPENAI_API_KEY');assert.ok(process.env[args[pos-2]]);
      assert.deepEqual(args.slice(pos,pos+2),['--entrypoint','timeout']);assert.match(args[pos+2],/^sha256:[a-f0-9]{64}$/);
      assert.deepEqual(args.slice(pos+3,pos+7),['--signal=KILL','840s','sh','-c']);assert.equal(args[pos+8],'sh');assert.match(args[pos+9],/^[a-f0-9]{40}$/);
      const r=require('node:child_process').spawnSync('sh',args.slice(pos+6),{stdio:'inherit',env:{PATH:process.env.PATH,TMPDIR:${JSON.stringify(root)},HOME:${JSON.stringify(root)}}});process.exit(r.status??1);
    }
    assert.deepEqual(args.slice(0,pos),['run','--rm','--pull=never','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges','--read-only','--tmpfs','/tmp:rw,exec,nosuid,size=1g','--pids-limit=256','--memory=2g','--user=65534:65534','-e','HOME=/tmp','-i']);
    assert.deepEqual(args.slice(pos,pos+2),['--entrypoint','timeout']);assert.match(args[pos+2],/^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(args.slice(pos+3,pos+9),['--signal=KILL','840s','sh','-c',${JSON.stringify(CHECKOUT_AND_TEST)},'sh']);assert.match(args[pos+9],/^[0-9a-f]{40}$/);
    assert.equal(args[pos+10],${JSON.stringify(TEST_DRIVER)});assert.deepEqual(args.slice(pos+11),${JSON.stringify(testArgv)});
    const r=require('node:child_process').spawnSync('sh',args.slice(pos+6),{stdio:'inherit',env:{PATH:process.env.PATH,TMPDIR:${JSON.stringify(root)},HOME:${JSON.stringify(root)}}});process.exit(r.status??1);`);
  stub('pi',`const fs=require('node:fs'),entry=args.includes('--no-tools')?'reviewer':'implementer';
    fs.appendFileSync(${JSON.stringify(entries)}, JSON.stringify({entry,pid:process.pid,model:args[2],extension:args.includes('-e')?args[args.indexOf('-e')+1]:null})+'\\n');
    if (entry==='implementer') {const prompt=fs.readFileSync(0,'utf8');${implementSource??"throw Error('Unexpected implementer')"};process.exit(0)}
    assert.deepEqual(args.slice(0,10),['-p','--model',args[2],'--thinking','high','--no-tools','--no-extensions','--no-skills','--no-context-files','--no-session']);
    assert.ok(process.env[args[2].startsWith('openai/')?'OPENAI_API_KEY':'CLAUDE_CODE_OAUTH_TOKEN']);
    if (args[2].startsWith('openai/')) assert.equal(args.length,10); else {assert.equal(args.length,12);assert.equal(args[10],'-e')}
    assert.equal(process.cwd(),process.env.HOME);assert.equal(process.env.PI_CODING_AGENT_DIR,process.cwd());assert.equal(process.env.GH_TOKEN,undefined);
    const prompt=require('node:fs').readFileSync(0,'utf8');const role=prompt.startsWith('# Independent test review')?'test':'code';
    const s=require('node:net').connect(${address.port},'127.0.0.1',()=>s.write(JSON.stringify({role,prompt})+'\\n'));s.pipe(process.stdout);`);
  return {bin,entries:()=>readFileSync(entries,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)),close:()=>server.close()};
}
