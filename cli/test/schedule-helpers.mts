// Fixtures for the scheduler tests (schedule*.test.mts, scheduler.test.mts). A disposable HOME, synthetic Git projects with
// a bare local `origin` and a pushed `main`, a project dispatcher that is an executable script the test supplies, and a
// stateful `systemctl` stub (stubs/systemctl) to put first on PATH. Nothing here touches a real service manager, tracker,
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

/** A stateful `systemctl` stub on its own directory. `env` is what a child process needs to use it: the stub first on PATH. */
export function systemctlStub(t: TestContext, p: ReturnType<typeof paths>) {
  const dir = join(p.home, 'stub');
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const stub = join(dirname(fileURLToPath(import.meta.url)), 'stubs/systemctl');
  writeFileSync(join(bin, 'systemctl'), readFileSync(stub));
  chmodSync(join(bin, 'systemctl'), 0o755);
  const unitDir = dirname(p.tickService);
  const env = { STUB_DIR: dir, STUB_UNIT_DIR: unitDir, PATH: `${bin}:${process.env.PATH}` };
  const stateFile = join(dir, 'state.json');
  const api = {
    dir, bin, env,
    calls: (): string[][] => existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.ok || c.injectedFailure).map(c => c.argv.slice(1)) : [],
    rejected: (): string[][] => existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.rejected).map(c => c.argv) : [],
    /** `systemctl` verbs, one per call, e.g. `disable --now factory-tick.timer`. */
    lines: () => api.calls().map(a => a.join(' ')),
    state: () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { units: {}, reloads: 0 }),
    unit: (name: string) => api.state().units[name] ?? { enabled: false, active: false },
    fail: (...argvs: string[]) => writeFileSync(join(dir, 'fail'), argvs.join('\n') + '\n'),
    clearFail: () => rmSync(join(dir, 'fail'), { force: true }),
    set: (name: string, patch: Record<string, unknown>) => { const s = api.state(); s.units[name] = { enabled: false, active: false, ...s.units[name], ...patch }; writeFileSync(stateFile, JSON.stringify(s)); },
    /** Runs `fn` with the stub's environment applied to this process (restored afterwards), for in-process production-backend tests. */
    async using<T>(fn: () => Promise<T>): Promise<T> {
      const saved: Record<string, string | undefined> = {};
      for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = (env as Record<string, string>)[k]; }
      try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    },
  };
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return api;
}
