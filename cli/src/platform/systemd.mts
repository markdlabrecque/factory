// Linux user service. Removal also handles an already-missing unit file.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { run } from './index.mts';
import type { ServiceBackend, ServiceSpec, ServiceStatus } from './index.mts';
import type { Paths } from '../paths.mts';
export class Systemd implements ServiceBackend {
  readonly p: Paths;
  constructor(p: Paths) { this.p = p; }
  async install(spec: ServiceSpec) {
    const quote = (s: string) => '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
    let text = readFileSync(new URL('../../templates/factory-board.service', import.meta.url), 'utf8');
    for (const [key, value] of Object.entries({ NODE: spec.node, SERVER: `${spec.app}/board/board-server.mts`, STATE: `SANDCASTLE_STATE_DIR=${spec.state}` })) text = text.replaceAll(`@${key}@`, () => quote(key === 'STATE' ? value : value.replaceAll('$', () => '$$')));
    mkdirSync(dirname(this.p.systemd), { recursive: true });
    writeFileSync(this.p.systemd, text);
    return { kind: 'systemd' as const, unit: 'factory-board.service', path: this.p.systemd };
  }
  async enable() { run('systemctl', ['--user', 'daemon-reload']); run('systemctl', ['--user', 'enable', 'factory-board.service']); }
  async start() { run('systemctl', ['--user', 'restart', 'factory-board.service']); }
  async stop() { run('systemctl', ['--user', 'stop', 'factory-board.service']); }
  async status(): Promise<ServiceStatus> {
    const state = run('systemctl', ['--user', 'show', 'factory-board.service', '--property=LoadState,ActiveState']);
    if (state.includes('LoadState=not-found')) return 'missing';
    return state.includes('ActiveState=active') ? 'active' : 'inactive';
  }
  async remove() {
    if (await this.status() !== 'missing') await this.stop();
    try { run('systemctl', ['--user', 'disable', 'factory-board.service']); }
    catch (error) { if (existsSync(this.p.systemd)) throw error; }
    if (existsSync(this.p.systemd)) rmSync(this.p.systemd);
    run('systemctl', ['--user', 'daemon-reload']);
  }
}
