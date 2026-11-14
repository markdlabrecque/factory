// Offline Docker boundary for entrypoint/shell fixtures. Synthetic owned containers never contact a daemon.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const fixtureImage = `sha256:${'a'.repeat(64)}`;
export function capabilityDocker(args, dir) {
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
    state[name] = { Name: `/${name}`, Id: id, Image: fixtureImage, Config: { Labels: { 'com.factory.preflight': args[args.indexOf('--label') + 1].split('=')[1] } }, State: { Status: 'exited', ExitCode: 0, OOMKilled: false, Error: '' } };
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
