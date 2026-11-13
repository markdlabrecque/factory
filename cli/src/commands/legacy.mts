// `factory legacy status [--json]` and `factory legacy retire` (#95): the explicit way off install-dispatch.sh's per-project
// `sandcastle-dispatch@<name>.timer` units (and an old single-project `sandcastle-dispatch.timer`).
// - `status` is read-only. It lists each enabled legacy timer (a link in `~/.config/systemd/user/timers.target.wants`), the
//   checkout its env file (`~/.config/sandcastle/dispatch/<name>.env`, SANDCASTLE_REPO) names, and whether that checkout is
//   a registered Factory project and opted in. It calls no service manager.
// - `retire` is the only Factory command that touches a legacy unit. For each enabled legacy timer it runs exactly
//   `systemctl --user disable --now <timer>`, checks that the timer's link is gone, and only then removes that instance's
//   env file, as `install-dispatch.sh --uninstall` does. It never stops a `sandcastle-dispatch@<name>.service` (a pass
//   already started finishes on its own; ticket runs it launched keep going), never deletes the template units
//   `sandcastle-dispatch@.service|.timer` (slice six retires the installer) and touches no other unit. A failed timer
//   keeps its env file and is reported; the others are still retired; the command exits 1. Running it again is safe.
//   It does not register, opt in or arm anything: it prints `factory project add` for unregistered checkouts and leaves
//   `factory schedule on` to you.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Paths } from '../paths.mts';
import { run } from '../platform/index.mts';
import { canonicalRoot, readRegistry } from '../projects.mts';
import { legacyTimers } from './schedule.mts';

export type LegacyTimer = { timer: string; name: string | null; envFile: string | null; repo: string | null;
  project: { name: string; scheduled: boolean } | null };

const wantsDir = (p: Paths) => join(dirname(p.systemd), 'timers.target.wants');
const envDir = (p: Paths) => join(p.home, '.config/sandcastle/dispatch');

/** Every enabled legacy timer, with the checkout its env file names and that checkout's Factory registration. */
export function legacyInventory(p: Paths): LegacyTimer[] {
  const registered = (() => { try { return readRegistry(p).projects; } catch { return []; } })();
  return legacyTimers(p).map(timer => {
    const name = timer.match(/^sandcastle-dispatch@(.+)\.timer$/)?.[1] ?? null;
    const file = name ? join(envDir(p), `${name}.env`) : null;
    const envFile = file && existsSync(file) ? file : null;
    let repo = envFile ? readFileSync(envFile, 'utf8').match(/^SANDCASTLE_REPO="?([^"\n]*)"?$/m)?.[1] ?? null : null;
    if (repo && existsSync(repo)) { try { repo = canonicalRoot(repo); } catch { /* not a checkout now: shown as recorded */ } }
    const found = repo ? registered.find(x => x.root === repo) : undefined;
    return { timer, name, envFile, repo, project: found ? { name: found.name, scheduled: !!found.schedule?.enabled } : null };
  });
}

const where = (t: LegacyTimer) => t.repo
  ? `${t.repo}  ${t.project ? `Factory project ${t.project.name} (${t.project.scheduled ? 'opted in' : 'not opted in'})` : 'not registered with Factory'}`
  : t.name ? 'no env file, checkout unknown' : 'old single-project timer';

export function legacy(p: Paths, action: string | undefined, o: { json?: boolean } = {}): number {
  if (action === 'status') {
    const timers = legacyInventory(p);
    if (o.json) { console.log(JSON.stringify({ version: 1, timers }, null, 2)); return 0; }
    if (!timers.length) { console.log('No legacy dispatcher timers are enabled.'); return 0; }
    console.log('Enabled legacy dispatcher timers (they run passes alongside factory schedule):');
    for (const t of timers) console.log(`  ${t.timer}  ${where(t)}`);
    console.log('Retire them with: factory legacy retire');
    return 0;
  }
  if (action !== 'retire') throw new Error('Usage: factory legacy status [--json] | factory legacy retire');
  if (o.json) throw new Error('--json applies to legacy status');
  const timers = legacyInventory(p);
  if (!timers.length) { console.log('No legacy dispatcher timers are enabled. Nothing to retire.'); return 0; }
  let failed = 0;
  for (const t of timers) {
    try {
      run('systemctl', ['--user', 'disable', '--now', t.timer]);
      if (existsSync(join(wantsDir(p), t.timer))) throw new Error('its timers.target.wants link is still there after disable');
    } catch (e) {
      failed++;
      console.error(`Could not retire ${t.timer}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}. Its env file is kept.`);
      continue;
    }
    if (t.envFile) rmSync(t.envFile, { force: true });
    console.log(`Retired ${t.timer}${t.envFile ? ` and removed ${t.envFile}` : ''}.`);
    if (t.repo && !t.project) console.log(`  ${t.repo} is not registered with Factory. Register it with: factory project add ${t.repo}`);
  }
  console.log('A legacy pass already running finishes on its own, and ticket runs keep going. The template units sandcastle-dispatch@.service and @.timer stay; they are harmless with no instance enabled.');
  if (failed) { console.error(`${failed} legacy timer(s) could not be retired. Run factory legacy retire again, or disable them with systemctl --user disable --now <timer>.`); return 1; }
  console.log('Factory\'s scheduler is unchanged. Opt projects in with factory schedule on --project <name>, then turn it on with factory schedule on.');
  return 0;
}
