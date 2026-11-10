// Factory's first-slice paths. FACTORY_HOME substitutes for HOME in isolated tests.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export function paths(home = process.env.FACTORY_HOME || homedir()) {
  home = resolve(home);
  const data = join(home, '.local/share/factory');
  return { home, data, app: join(data, 'app'), manifest: join(data, 'manifest.json'),
    bin: join(home, '.local/bin/factory'), config: join(home, '.config/factory'),
    state: join(home, '.local/state/factory'),
    systemd: join(home, '.config/systemd/user/factory-board.service'),
    launchd: join(home, 'Library/LaunchAgents/com.factory.board.plist') };
}
export type Paths = ReturnType<typeof paths>;
export const boardURL = 'http://127.0.0.1:4444';
