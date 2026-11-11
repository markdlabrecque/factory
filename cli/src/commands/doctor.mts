// Read-only prerequisite checks. Missing linger warns but never changes the host. With the scheduler switch on, the
// tick timer must be running; enabled legacy `sandcastle-dispatch` timers warn (they would double passes) and are
// never touched.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { boardURL } from '../paths.mts';
import type { Paths } from '../paths.mts';
import { readManifest } from '../manifest.mts';
import { run } from '../platform/index.mts';
import { nodeSupported } from './install.mts';
import type { ServiceBackend } from '../platform/index.mts';
import { readScheduler } from '../schedule.mts';
import { legacyAdvice } from './schedule.mts';
export async function doctor(p: Paths, service?: Pick<ServiceBackend, 'schedulerStatus'>) {
  let failures = 0;
  const check = (name: string, ok: boolean, fix: string, warning = false) => {
    console.log(`${ok ? 'PASS' : warning ? 'WARN' : 'FAIL'} ${name}${ok ? '' : `: ${fix}`}`);
    if (!ok && !warning) failures++;
  };
  const available = (name: string) => (process.env.PATH || '').split(':').some(dir => {
    try { run('test', ['-x', join(dir, name)]); return true; } catch { return false; }
  });
  check(`Node ${process.versions.node}`, nodeSupported(), 'Install Node 22.18 or newer');
  for (const names of [['docker'], ['git'], ['glab', 'gh'], ['claude', 'pi']]) check(names.join(' or '), names.some(available), `Install ${names.join(' or ')} and add it to PATH`);
  try {
    if (process.platform === 'linux') run('systemctl', ['--user', 'show-environment']);
    else run('launchctl', ['print', `gui/${process.getuid!()}`]);
    check('User service manager', true, '');
  } catch { check('User service manager', false, 'Log in to a desktop/user session with a working service manager'); }
  if (process.platform === 'linux') {
    let linger = false;
    try { linger = run('loginctl', ['show-user', String(process.getuid!()), '--property=Linger', '--value']) === 'yes'; } catch {}
    check('Linger', linger, `Run loginctl enable-linger ${process.env.USER || ''}`, true);
  }
  try {
    const manifest = readManifest(p);
    check('Manifest', !!manifest, 'Run factory install');
    for (const entry of manifest?.entries || []) check(entry.path, existsSync(entry.path), 'Run factory install to restore missing files');
  } catch (error) { check('Manifest', false, String(error)); }
  let responds = false;
  try { responds = (await fetch(boardURL, { signal: AbortSignal.timeout(3000) })).ok; } catch {}
  check('Board HTTP', responds, 'Run factory board start; check for another service using port 4444');
  try {
    if (readScheduler(p).enabled) {
      let timer = 'unknown';
      try { timer = (await service?.schedulerStatus())?.timer ?? 'unknown'; } catch {}
      check('Scheduler timer', timer === 'active', `the scheduler switch is on but its timer is ${timer}. Run factory schedule on`);
    } else console.log('INFO Scheduler off (factory schedule on to start it)');
  } catch (error) { check('Scheduler switch', false, String(error)); }
  const legacy = legacyAdvice(p);
  check('No legacy dispatcher timers', !legacy.length, legacy.join('\n'), true);
  return failures ? 1 : 0;
}
