// Fixtures for the scheduler tests (schedule*.test.mts, scheduler.test.mts). A disposable HOME, synthetic Git projects with
// a bare local `origin` and a pushed `main`, a project dispatcher that is an executable script the test supplies, and a
// stateful `systemctl` or `launchctl` stub (stubs/) to put first on PATH. Nothing here touches a real service manager, tracker,
// Docker or credential; every path is under the temporary HOME.
import type { TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
export const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'ignore' });
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const factoryBin = join(repoRoot, 'cli/bin/factory.mts');

export function home(t: TestContext, prefix = 'factory-sched-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { home: dir, p: paths(dir) };
}
export type RepoOptions = { script?: string; current?: boolean; push?: boolean; register?: boolean };
/** A registered project `<home>/work/<name>` on `main`, with a pushed `main` on a bare origin unless `push` is false. */
export function repo(p: ReturnType<typeof paths>, name: string, o: RepoOptions = {}): string {
  const root = join(p.home, 'work', name);
  mkdirSync(join(root, '.sandcastle'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  if (o.push !== false) {
    const origin = join(p.home, 'origins', `${name}.git`);
    mkdirSync(origin, { recursive: true });
    git(origin, 'init', '-q', '--bare');
    git(root, 'remote', 'add', 'origin', origin);
    git(root, 'push', '-q', 'origin', 'main');
  }
  writeFileSync(join(root, '.sandcastle/dispatch.sh'), o.script ?? '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(root, '.sandcastle/config.mts'), `export const TRACKER = {\n  project: "${name}/${name}",\n};\n`);
  const current = o.current !== false;
  writeFileSync(join(root, '.sandcastle/dispatch.mts'), current ? 'reserveRun(iid, pid);\n' : 'spawn();\n');
  writeFileSync(join(root, '.sandcastle/board.mts'), current ? 'export function reserveRun() {}\n' : '');
  const real = realpathSync(root);
  if (o.register !== false) addProject(p, real);
  return real;
}

/** A command stub (stubs/<name>) on its own directory. `env` is what a child process needs to use it: the stub first on PATH. */
function commandStub(t: TestContext, p: ReturnType<typeof paths>, name: 'systemctl' | 'launchctl', extra: Record<string, string>) {
  const dir = join(p.home, 'stub');
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const stub = join(dirname(fileURLToPath(import.meta.url)), `stubs/${name}`);
  writeFileSync(join(bin, name), readFileSync(stub));
  chmodSync(join(bin, name), 0o755);
  const env: Record<string, string> = { STUB_DIR: dir, ...extra, PATH: `${bin}:${process.env.PATH}` };
  const stateFile = join(dir, 'state.json');
  const log = () => existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const api = {
    dir, bin, env, stateFile,
    calls: (): string[][] => log().filter(c => c.ok || c.injectedFailure).map(c => c.argv.slice(name === 'systemctl' ? 1 : 0)),
    rejected: (): string[][] => log().filter(c => c.rejected).map(c => c.argv),
    fail: (...argvs: string[]) => writeFileSync(join(dir, 'fail'), argvs.join('\n') + '\n'),
    clearFail: () => rmSync(join(dir, 'fail'), { force: true }),
    /** Runs `fn` with the stub's environment applied to this process (restored afterwards), for in-process production-backend tests. */
    async using<T>(fn: () => Promise<T>): Promise<T> {
      const saved: Record<string, string | undefined> = {};
      for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
      try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    },
  };
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return api;
}

/** A stateful `systemctl` stub. `lines()` gives the verbs, one per call, e.g. `disable --now factory-tick.timer`. */
export function systemctlStub(t: TestContext, p: ReturnType<typeof paths>) {
  const base = commandStub(t, p, 'systemctl', { STUB_UNIT_DIR: dirname(p.tickService) });
  const state = () => (existsSync(base.stateFile) ? JSON.parse(readFileSync(base.stateFile, 'utf8')) : { units: {}, reloads: 0 });
  return { ...base,
    lines: () => base.calls().map(a => a.join(' ')),
    state,
    unit: (name: string) => state().units[name] ?? { enabled: false, active: false },
    set: (name: string, patch: Record<string, unknown>) => { const s = state(); s.units[name] = { enabled: false, active: false, ...s.units[name], ...patch }; writeFileSync(base.stateFile, JSON.stringify(s)); },
  };
}

/** A stateful `launchctl` stub. `lines()` gives each call with the user's domain shown as `gui/UID`. `set` patches a label's
 *  state (`disabled`, `loaded`, `running`, `pid` of the job's process for bootout to signal); `setRoot` patches the top level
 *  (`oldFormat` for true/false overrides, `exitTimeoutMs`). */
export function launchctlStub(t: TestContext, p: ReturnType<typeof paths>) {
  const base = commandStub(t, p, 'launchctl', { STUB_AGENT_DIR: dirname(p.tickPlist) });
  const state = () => (existsSync(base.stateFile) ? JSON.parse(readFileSync(base.stateFile, 'utf8')) : { services: {} });
  const write = (s: unknown) => writeFileSync(base.stateFile, JSON.stringify(s));
  const domain = `gui/${process.getuid!()}`;
  return { ...base,
    lines: () => base.calls().map(a => a.join(' ').replaceAll(domain, 'gui/UID')),
    state,
    service: (label = 'com.factory.tick') => ({ disabled: false, loaded: false, running: false, ...state().services?.[label] }),
    set: (label: string, patch: Record<string, unknown>) => { const s = state(); s.services ??= {}; s.services[label] = { disabled: false, loaded: false, running: false, ...s.services[label], ...patch }; write(s); },
    setRoot: (patch: Record<string, unknown>) => write({ services: {}, ...state(), ...patch }),
  };
}

// The held dispatcher. It records its argv, cwd, environment and stdin, starts a nested shell, a nested "analysis"
// process (which has its own child) and a detached "ticket run", writes every pid to held.json, then waits. A project
// whose dispatcher is `quick` just records that it ran and exits.
export const HELD = `import { spawn } from 'node:child_process';
import { existsSync, readlinkSync, writeFileSync, appendFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
appendFileSync(dir + 'ran.log', JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid, stdin: (() => { try { return readlinkSync('/proc/self/fd/0'); } catch { return '?'; } })(),
  env: { PATH: process.env.PATH, SANDCASTLE_STATE_DIR: process.env.SANDCASTLE_STATE_DIR, FACTORY_SCHEDULED: process.env.FACTORY_SCHEDULED, HOME: process.env.HOME } }) + '\\n');
if (existsSync(dir + 'ignore-term')) process.on('SIGTERM', () => {});
const shell = spawn('sh', ['-c', 'sleep 300 & wait'], { stdio: 'ignore' });
const analysis = spawn(process.execPath, ['-e', "require('node:child_process').spawn('sleep', ['300'], { stdio: 'ignore' }); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
const ticket = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
ticket.unref();
writeFileSync(dir + 'held.json', JSON.stringify({ dispatcher: process.pid, shell: shell.pid, analysis: analysis.pid, ticket: ticket.pid }));
setInterval(() => {}, 1000);
`;
export const QUICK = `#!/bin/sh\necho "$@" > "$(dirname "$0")/quick.args"\npwd > "$(dirname "$0")/quick.cwd"\n: > "$(dirname "$0")/ran"\nexit "\${QUICK_EXIT:-0}"\n`;
export const heldScript = (root: string) => { writeFileSync(join(root, '.sandcastle/held.mjs'), HELD); return `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/held.mjs" "$@"\n`; };

export const held = (root: string): Record<'dispatcher' | 'shell' | 'analysis' | 'ticket', number> => JSON.parse(readFileSync(join(root, '.sandcastle/held.json'), 'utf8'));
