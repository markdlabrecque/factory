// Offline Docker boundary for entrypoint/shell fixtures. Synthetic owned containers never contact a daemon.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const fixtureImage = `sha256:${'a'.repeat(64)}`;
export function capabilityDocker(args, dir) {
  // Contract stub only. The actual embedded filesystem program has separate local-Git fixtures.
  if (args[0] === 'exec' && args[2] === 'node' && args[3] === '-e' && args[4]?.includes('const input = JSON.parse(process.argv[1])')) {
    if (args.length !== 6 || !/^(fixture-container|fixture-implementer|factory-recovery-[0-9a-f-]{36})$/.test(args[1])) throw Error('Unexpected sandbox probe identity/arguments');
    const input = JSON.parse(args[5]);
    if (input.uid !== process.getuid() || input.gid !== process.getgid() || !/^[0-9a-f]{40}$/.test(input.baseline) || !input.evidence.startsWith('/home/agent/evidence/')) throw Error('Unexpected probe input');
    writeFileSync(join(dir,'sandbox-probe-input.json'), JSON.stringify(input));
    const fault = process.env.SCENARIO?.startsWith('sandbox-') ? process.env.SCENARIO.slice(8) : process.env.FAKE_SANDBOX_FAULT;
    const operations = ['identity','read-required-file','resolve-baseline-tip','workspace-create-write-rename-remove','evidence-create-write-rename-remove','alternate-index-read-tree','cleanup-owned-probes','preserve-index-status-diffs-refs'];
    if (fault === 'cancel') process.kill(process.ppid, 'SIGTERM');
    const failed = {workspace:3,evidence:4,baseline:2,index:5,cleanup:4}[fault];
    return JSON.stringify({checks:operations.map((operation,i) => ({id:'fixture-'+i,operation,path: i === 4 ? input.evidence : '/home/agent/workspace',status:i === failed ? 'blocked' : 'ready',reason:i === 0 ? 'effective uid='+input.uid+' gid='+input.gid : 'fixture contract '+operation,...(i === failed ? {errno:fault === 'workspace' ? 'EROFS' : fault === 'baseline' ? 'EMISSINGBASELINE' : 'EACCES'} : {})}))});
  }
  if (args[0] === 'image' && args[1] === 'inspect') {
    return args.includes('--format') ? String(process.getuid?.() ?? 1000) : JSON.stringify([{ Id: fixtureImage, Config: { User: String(process.getuid?.() ?? 1000) } }]);
  }
  if (args[0] !== 'container') return;
  const name = args.find(a => a.startsWith('factory-preflight-'));
  const filter = args.find(a => a.startsWith('name=^/factory-preflight-'));
  const id = 'b'.repeat(64);
  if (!name && !filter && !args.includes(id)) return;
  const file = join(dir, 'capability-containers.json');
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (args[1] === 'create') {
    state[name] = { Name: `/${name}`, Id: id, Image: args[args.indexOf('--entrypoint') + 2], Config: { Labels: { 'com.factory.preflight': args[args.indexOf('--label') + 1].split('=')[1] } }, State: { Status: 'exited', ExitCode: 0, OOMKilled: false, Error: '' } };
    writeFileSync(file, JSON.stringify(state));
    return id;
  }
  if (args[1] === 'start') return name;
  if (args[1] === 'inspect') return JSON.stringify([state[name]]);
  if (args[1] === 'logs') return process.env.FACTORY_FAKE_CAPABILITY === 'bad' ? 'browser preflight failed: Chromium launch' : 'browser preflight OK';
  if (args[1] === 'ls') return Object.keys(state).some(n => filter === `name=^/${n}$`) ? id : '';
  if (args[1] === 'rm') { for (const n of Object.keys(state)) if (state[n].Id === args.at(-1)) delete state[n]; writeFileSync(file, JSON.stringify(state)); return id; }
  throw Error('Unexpected offline capability command');
}
