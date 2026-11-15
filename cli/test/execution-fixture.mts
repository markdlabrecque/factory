// Build fixture-owned complete runtimes with fake private packages. No registry, installed app or project code executes.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_ASSETS } from '../src/runtime-assets.mts';
import { prepareRuntimeBundle } from '../src/runtime-bundle.mts';
import { recordRuntimeOwnership, withRuntimeLock } from '../src/runtime-ownership.mts';
import { installPackages } from './runtime-fixture.mts';
const repository = fileURLToPath(new URL('../../', import.meta.url));
export function executionSnapshot(runtime: { directory: string; env: NodeJS.ProcessEnv }, root: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `const {executionContext}=await import(${JSON.stringify(join(runtime.directory, 'context.mts'))}); const c=await executionContext(); console.log(JSON.stringify({identity:c.identity,policyIdentity:c.policyIdentity,config:c.config}));`], { cwd: root, env: runtime.env, encoding: 'utf8' }));
}
export function bindExecution(root: string, env: NodeJS.ProcessEnv = process.env, options: { overlays?: boolean; install?: (dir: string) => void } = {}) {
  const staging = mkdtempSync(join(dirname(root), 'execution-'));
  const source = join(staging, 'source'), data = join(staging, 'data'), runtimes = join(data, 'runtimes');
  for (const asset of RUNTIME_ASSETS) {
    const target = join(source, asset.source); mkdirSync(dirname(target), { recursive: true });
    const overlay = join(root, '.sandcastle', asset.destination);
    cpSync(options.overlays !== false && existsSync(overlay) && !['package.json', 'package-lock.json'].includes(asset.destination) ? overlay : join(repository, asset.source), target);
  }
  const bundle = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: runtimes, install: dir => {
    installPackages(dir);
    // tsx fixture only imports the selected absolute entrypoint; it performs no package resolution.
    writeFileSync(join(dir, 'node_modules/tsx/dist/cli.mjs'), `import {pathToFileURL} from 'node:url'; const entry=process.argv[2]; process.argv.splice(1,1); await import(pathToFileURL(entry).href);\n`);
    const sdk = join(root, 'node_modules/@ai-hero/sandcastle');
    if (existsSync(sdk)) {
      const pkg = JSON.parse(readFileSync(join(dir, 'node_modules/@ai-hero/sandcastle/package.json'), 'utf8'));
      cpSync(sdk, join(dir, 'node_modules/@ai-hero/sandcastle'), { recursive: true });
      const fake = JSON.parse(readFileSync(join(dir, 'node_modules/@ai-hero/sandcastle/package.json'), 'utf8'));
      writeFileSync(join(dir, 'node_modules/@ai-hero/sandcastle/package.json'), JSON.stringify({ ...fake, ...pkg }));
    }
    options.install?.(dir);
  } });
  withRuntimeLock({ data, runtimes } as any, () => recordRuntimeOwnership({ data, runtimes } as any, bundle.id));
  return { ...bundle, env: { ...env, FACTORY_PROJECT_ROOT: root, FACTORY_RUNTIME_ROOT: bundle.directory, FACTORY_RUNTIME_ID: bundle.id }, staging };
}
