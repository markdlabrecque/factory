// Build fixture-owned complete runtimes with fake private packages. No registry, installed app or project code executes.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_ASSETS } from '../src/runtime-assets.mts';
import { prepareRuntimeBundle } from '../src/runtime-bundle.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../src/runtime-ownership.mts';
import { installPackages } from './runtime-fixture.mts';
const repository = fileURLToPath(new URL('../../', import.meta.url));
export function executionSnapshot(runtime: { directory: string; env: NodeJS.ProcessEnv }, root: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `const {executionContext}=await import(${JSON.stringify(join(runtime.directory, 'context.mts'))}); const c=await executionContext(); console.log(JSON.stringify({identity:c.identity,policyIdentity:c.policyIdentity,config:c.config}));`], { cwd: root, env: runtime.env, encoding: 'utf8' }));
}
export function stageExecutionPackages(dir: string, sdk: string) {
  installPackages(dir);
  writeFileSync(join(dir, 'node_modules/tsx/dist/cli.mjs'), `import {pathToFileURL} from 'node:url'; const entry=process.argv[2]; process.argv.splice(1,1); await import(pathToFileURL(entry).href);\n`);
  if (existsSync(sdk)) {
    const pkg = JSON.parse(readFileSync(join(dir, 'node_modules/@ai-hero/sandcastle/package.json'), 'utf8'));
    cpSync(sdk, join(dir, 'node_modules/@ai-hero/sandcastle'), { recursive: true });
    const fake = JSON.parse(readFileSync(join(dir, 'node_modules/@ai-hero/sandcastle/package.json'), 'utf8'));
    writeFileSync(join(dir, 'node_modules/@ai-hero/sandcastle/package.json'), JSON.stringify({ ...fake, ...pkg }));
  }
}
export function bindExecution(root: string, env: NodeJS.ProcessEnv = process.env, options: { overlays?: boolean; install?: (dir: string) => void; sdk?: string; sourceRoot?: string; paths?: import('../src/paths.mts').Paths } = {}) {
  const staging = mkdtempSync(join(dirname(root), 'execution-'));
  const source = join(staging, 'source'), data = options.paths?.data ?? join(staging, 'data'), runtimes = options.paths?.runtimes ?? join(data, 'runtimes');
  const descriptor = options.paths?.runtimeDescriptor ?? join(data, 'runtime.json');
  for (const asset of RUNTIME_ASSETS) {
    const target = join(source, asset.source); mkdirSync(dirname(target), { recursive: true });
    const overlay = join(root, '.sandcastle', asset.destination);
    cpSync(options.overlays !== false && existsSync(overlay) && !['package.json', 'package-lock.json'].includes(asset.destination) ? overlay : join(options.sourceRoot ?? repository, asset.source), target);
  }
  const bundle = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: runtimes, install: dir => {
    stageExecutionPackages(dir, options.sdk ?? join(root, 'node_modules/@ai-hero/sandcastle'));
    options.install?.(dir);
  } });
  const p = { data, runtimes, runtimeDescriptor: descriptor } as any;
  withRuntimeLock(p, () => { recordRuntimeOwnership(p, bundle.id); writeRuntimeDescriptor(p, bundle.id); });
  return { ...bundle, env: { ...env, FACTORY_RUNTIME_DESCRIPTOR: descriptor, FACTORY_PROJECT_ROOT: root, FACTORY_RUNTIME_ROOT: bundle.directory, FACTORY_RUNTIME_ID: bundle.id, FACTORY_RUNTIME_DEPENDENCIES: bundle.manifest.dependencies, FACTORY_HOST_RUNTIME_DEPENDENCIES: bundle.manifest.dependencies }, staging };
}
