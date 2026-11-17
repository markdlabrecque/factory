// Complete temporary shared-runtime project for cross-entrypoint readiness acceptance.
// Tracker, agent, container, auth and service commands are owned stubs, never host fallbacks.
import type { TestContext } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { factoryToml } from './config-fixture.mts';
import { bindExecution } from './execution-fixture.mts';

export function readinessFixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ticket-readiness-'))), p = paths(home);
  const root = join(home, 'site'), bin = join(home, 'bin'), fake = join(home, 'fake');
  mkdirSync(join(root, '.factory'), { recursive: true }); mkdirSync(bin); mkdirSync(fake);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 1500, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), '.factory/*\n!.factory/factory.toml\n.factory-workflow/\n');
  const config = join(root, '.factory/factory.toml');
  writeFileSync(config, factoryToml('owner/repo'));
  git('add', '.'); git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  git('remote', 'add', 'origin', root); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const trap = `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(fake, 'unexpected.jsonl'))}, JSON.stringify(process.argv)+'\\n'); process.exit(91);\n`;
  for (const name of ['npm', 'npx', 'pi', 'docker', 'curl', 'glab', 'systemctl', 'launchctl']) writeFileSync(join(bin, name), trap, { mode: 0o755 });
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nimport {capabilityDocker} from ${JSON.stringify(join(import.meta.dirname, '../../orchestrator/fixtures/capability-docker.mjs'))};\nconst args=process.argv.slice(2); appendFileSync(${JSON.stringify(join(fake, 'image-calls.jsonl'))},JSON.stringify(args)+'\\n');\nconst result=capabilityDocker(args,${JSON.stringify(fake)}); if(result===undefined) {appendFileSync(${JSON.stringify(join(fake, 'unexpected.jsonl'))},JSON.stringify(args)+'\\n'); process.exit(91);} console.log(result);\n`, {mode:0o755});
  const gh = readFileSync(join(import.meta.dirname, '../../orchestrator/fixtures/entrypoint/gh.mjs'), 'utf8');
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n` + gh, { mode: 0o755 });
  const runtime = bindExecution(root, process.env, { paths: p, overlays: false, sdk: join(import.meta.dirname, '../../orchestrator/fixtures/entrypoint/sandcastle') });
  addProject(p, root);
  const env = { ...runtime.env, FACTORY_HOME: home, SANDCASTLE_STATE_DIR: p.state, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, FAKE_CONTEXT_PARENT: '90', SCENARIO: 'parent-read-failed' };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); rmSync(home, { recursive: true, force: true }); });
  const main = (scenario = 'parent-read-failed') => spawnSync(process.execPath, [join(runtime.directory, 'main.mts'), '--issue', '7', '--base', 'main'], { cwd: root, env: { ...env, SCENARIO: scenario }, encoding: 'utf8', timeout: 15000 });
  return { home, p, root, bin, fake, config, git, runtime, main };
}
