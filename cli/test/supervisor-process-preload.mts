// TEST ONLY: inject offline HTTP beneath unchanged real guard/runner/adapter; native/global outbound is permanently denied.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { denyNetwork, providerTextStream } from './supervisor-provider-fixture.mts';
const config = JSON.parse(readFileSync(new URL(import.meta.url).searchParams.get('config')!, 'utf8'));
denyNetwork();
const original = cp.spawn;
cp.spawn = ((command: any, args: any[], options: any) => {
  // Pass only test instrumentation plus an extra observation pipe, never a production bypass/environment selector.
  if (String(args[0]).endsWith('supervisor-runner.mts')) {
    args = ['--import', import.meta.url, ...args]; options = { ...options, stdio: [...options.stdio,4] };
  }
  return original(command,args,options);
}) as any;
syncBuiltinESMExports();
if (process.argv[1]?.endsWith('supervisor-runner.mts')) {
  globalThis.fetch = async (url, init) => {
    if (String(url) !== 'https://api.openai.com/v1/responses' || init?.method !== 'POST') throw Error('Offline only');
    if (config.scenario !== 'complete') {
      // A real descendant in the inherited owned group, with explicit IPC readiness and no timer/sleep.
      const child = original(process.execPath,['--input-type=module','-e',"process.on('message',()=>{}); process.send({ready:true});"],
        { stdio: ['ignore','ignore','ignore','ipc',4], env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C' } });
      await once(child,'message');
      writeFileSync(config.barrier,JSON.stringify({ descendant: child.pid }));
      await new Promise(() => {});
    }
    writeFileSync(config.barrier,JSON.stringify({ descendant: null }));
    return new Response(providerTextStream(), { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_offline' } });
  };
}
