// Factory's paths. FACTORY_HOME substitutes for HOME in isolated tests. `projects` is the project registry
// (projects.mts). `scheduleConfig` is the scheduler's launch configuration (PATH and Node, schedule.mts); it never says
// whether scheduling is on, because the service manager owns that. `schedulerState` holds the tick's own files:
// state.json and history.json (schedule-state.mts), tick.lock (tick-lock.mts), jam/ (each scheduled pass's jam report, removed after the pass; jam-detect.mts) and, on
// macOS, tick.log (the supervisor's output) and next-tick.json (when the supervisor's next tick is due, next-tick.mts).
// `recovery` holds each project's self-recovery record: jam episodes, confirmation and repair attempts (recovery-state.mts).
// `tickService`/`tickTimer` are the Linux scheduler units; `tickPlist` is the macOS scheduler's launch agent.
// The project scaffold folder stays `.sandcastle` this slice (`.factory` is a later migration).
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export function paths(home = process.env.FACTORY_HOME || homedir()) {
  home = resolve(home);
  const data = join(home, '.local/share/factory');
  const state = join(home, '.local/state/factory');
  return { home, data, app: join(data, 'app'), manifest: join(data, 'manifest.json'),
    bin: join(home, '.local/bin/factory'), config: join(home, '.config/factory'), projects: join(home, '.config/factory/projects.json'),
    scheduleConfig: join(home, '.config/factory/schedule.json'),
    state,
    schedulerState: join(state, 'scheduler'),
    recovery: join(state, 'recovery'),
    tickLock: join(state, 'scheduler/tick.lock'),
    tickLog: join(state, 'scheduler/tick.log'),
    nextTick: join(state, 'scheduler/next-tick.json'),
    systemd: join(home, '.config/systemd/user/factory-board.service'),
    tickService: join(home, '.config/systemd/user/factory-tick.service'),
    tickTimer: join(home, '.config/systemd/user/factory-tick.timer'),
    launchd: join(home, 'Library/LaunchAgents/com.factory.board.plist'),
    tickPlist: join(home, 'Library/LaunchAgents/com.factory.tick.plist') };
}
export type Paths = ReturnType<typeof paths>;
export const boardURL = 'http://127.0.0.1:4444';
export const scaffoldName = '.sandcastle';
/** POSIX shell single-quoting: safe for spaces and apostrophes. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
