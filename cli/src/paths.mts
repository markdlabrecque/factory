// Factory's paths. FACTORY_HOME substitutes for HOME in isolated tests. `projects` is the project registry
// (projects.mts) and `scheduler` the global scheduler switch (schedule.mts); `tickService`/`tickTimer` are the Linux
// scheduler units and `tickLock` keeps to one tick per user (tick.mts); the project scaffold folder stays `.sandcastle`
// this slice (`.factory` is a later migration).
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export function paths(home = process.env.FACTORY_HOME || homedir()) {
  home = resolve(home);
  const data = join(home, '.local/share/factory');
  return { home, data, app: join(data, 'app'), manifest: join(data, 'manifest.json'),
    bin: join(home, '.local/bin/factory'), config: join(home, '.config/factory'), projects: join(home, '.config/factory/projects.json'),
    scheduler: join(home, '.config/factory/scheduler.json'),
    state: join(home, '.local/state/factory'),
    tickLock: join(home, '.local/state/factory/scheduler.lock'),
    systemd: join(home, '.config/systemd/user/factory-board.service'),
    tickService: join(home, '.config/systemd/user/factory-tick.service'),
    tickTimer: join(home, '.config/systemd/user/factory-tick.timer'),
    launchd: join(home, 'Library/LaunchAgents/com.factory.board.plist') };
}
export type Paths = ReturnType<typeof paths>;
export const boardURL = 'http://127.0.0.1:4444';
export const scaffoldName = '.sandcastle';
/** POSIX shell single-quoting: safe for spaces and apostrophes. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
