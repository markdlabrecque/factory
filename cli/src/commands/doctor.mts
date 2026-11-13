// Read-only prerequisite checks. Missing linger warns but never changes the host. Once the scheduler's units are in the
// ledger, the service manager's answer is checked (the timer on Linux, the com.factory.tick agent on macOS): enabled and active passes, enabled but stopped fails, running
// but disabled warns, and an unreadable manager fails (unknown is never on). A scheduler that is simply off is
// information, not a failure. Enabled legacy `sandcastle-dispatch` timers warn (they would double passes); doctor never
// touches them and points to `factory legacy retire`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { boardURL } from '../paths.mts';
import type { Paths } from '../paths.mts';
import { readManifest } from '../manifest.mts';
import { run } from '../platform/index.mts';
import { nodeSupported } from './install.mts';
import type { ScheduleBackend } from '../platform/scheduler.mts';
import { isTickEntry } from '../platform/scheduler.mts';
import { legacyAdvice } from './schedule.mts';
export async function doctor(p: Paths, schedule?: Pick<ScheduleBackend, 'status'>) {
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
    if (readManifest(p)?.entries.some(isTickEntry)) {
      let s;
      try { s = await schedule!.status(); } catch (e) { check('Scheduler', false, `the service manager can't be read (${(e as Error).message.split('\n')[0]}), so scheduled work is blocked. Run factory schedule status`); }
      if (s) {
        if (s.enabled && s.timer === 'active') check('Scheduler', true, '');
        else if (s.enabled) check('Scheduler', false, `the timer is enabled but ${s.timer}. Run factory schedule on`);
        else if (s.timer === 'active') check('Scheduler', false, 'the timer is running but not enabled, so ticks do nothing. Run factory schedule off, or on', true);
        else console.log('INFO Scheduler off (factory schedule on to start it)');
      }
    } else console.log('INFO Scheduler not installed (factory schedule on to set it up)');
  } catch (error) { check('Scheduler', false, String(error)); }
  const legacy = legacyAdvice(p);
  check('No legacy dispatcher timers', !legacy.length, legacy.join('\n'), true);
  return failures ? 1 : 0;
}
