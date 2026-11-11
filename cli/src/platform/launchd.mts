// macOS user agent. Probe registration before bootout so repeated removal is safe.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { run } from './index.mts';
import type { ServiceBackend, ServiceSpec, ServiceStatus } from './index.mts';
import type { Paths } from '../paths.mts';
export class Launchd implements ServiceBackend {
  readonly domain = `gui/${process.getuid!()}`;
  readonly name = `${this.domain}/com.factory.board`;
  readonly p: Paths;
  constructor(p: Paths) { this.p = p; }
  async install(spec: ServiceSpec) {
    // Unload the old registration before refreshing its plist.
    if (await this.status() !== 'missing') await this.stop();
    const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    let text = readFileSync(new URL('../../templates/com.factory.board.plist', import.meta.url), 'utf8');
    for (const [key, value] of Object.entries({ NODE: spec.node, SERVER: `${spec.app}/board/board-server.mts`, STATE: spec.state })) text = text.replaceAll(`@${key}@`, () => escape(value));
    mkdirSync(dirname(this.p.launchd), { recursive: true });
    writeFileSync(this.p.launchd, text);
    return { kind: 'launchd' as const, label: 'com.factory.board', path: this.p.launchd };
  }
  async enable() { run('launchctl', ['enable', this.name]); }
  async start() {
    if (await this.status() === 'missing') run('launchctl', ['bootstrap', this.domain, this.p.launchd]);
    else run('launchctl', ['kickstart', '-k', this.name]);
  }
  async stop() { if (await this.status() !== 'missing') run('launchctl', ['bootout', this.name]); }
  async status(): Promise<ServiceStatus> {
    // Verify that the user's launchd domain is reachable before treating a failed lookup as missing.
    run('launchctl', ['print', this.domain]);
    try { return run('launchctl', ['print', this.name]).includes('state = running') ? 'active' : 'inactive'; }
    catch { return 'missing'; }
  }
  async remove() { await this.stop(); run('launchctl', ['disable', this.name]); if (existsSync(this.p.launchd)) rmSync(this.p.launchd); }
}
