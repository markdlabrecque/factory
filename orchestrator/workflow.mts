// Data-only complete-workflow selection. Never import project executables or infer overrides from copied files.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadTomlConfig, resolveCheckoutPath } from './project-config.mts';
// Assembly helpers ship flat beside this module; source callers use the same trusted CLI implementation.
const helper = existsSync(new URL('./runtime-bundle.mts', import.meta.url)) ? './runtime-bundle.mts' : '../cli/src/runtime-bundle.mts';
const { validateRuntimeBundle, regenerateRuntimeManifest } = await import(helper);
export { regenerateRuntimeManifest };
export type Workflow = ReturnType<typeof resolveWorkflow>;
function canonical(path: string, label: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw Error(`${label} must be a canonical absolute directory`);
  return path;
}
function bundle(root: string, project = false) {
  try { return validateRuntimeBundle(root); }
  catch (error) { throw Error(`Invalid ${project ? 'project workflow' : 'Factory runtime'} at ${root}: ${(error as Error).message}${project ? '. Review the complete override and regenerate runtime-manifest.json with regenerateRuntimeManifest; no Factory fallback is permitted' : ''}`); }
}
/** The descriptor path is trusted launcher configuration, never project data. Children use a pinned selection. */
export function resolveWorkflow(projectRoot: string, descriptor: string, inherited?: NodeJS.ProcessEnv) {
  canonical(projectRoot, 'Project root');
  resolveCheckoutPath(projectRoot, '.sandcastle/factory.toml', 'file');
  const config = loadTomlConfig(join(projectRoot, '.sandcastle'));
  let hostRoot: string, hostId: string;
  if (inherited?.FACTORY_PROJECT_ROOT === projectRoot && inherited.FACTORY_RUNTIME_ROOT && inherited.FACTORY_RUNTIME_ID) {
    hostRoot = canonical(inherited.FACTORY_HOST_RUNTIME_ROOT ?? inherited.FACTORY_RUNTIME_ROOT, 'Inherited Factory runtime');
    hostId = inherited.FACTORY_HOST_RUNTIME_ID ?? inherited.FACTORY_RUNTIME_ID;
    if (bundle(hostRoot).id !== hostId) throw Error('Inherited Factory runtime identity mismatch');
  } else {
    if (!isAbsolute(descriptor) || lstatSync(descriptor).isSymbolicLink() || !lstatSync(descriptor).isFile()) throw Error('A trusted installed runtime descriptor is required');
    const d = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (d?.version !== 1 || !/^[a-f0-9]{64}$/.test(d.id)) throw Error('Invalid installed runtime descriptor');
    hostId = d.id;
    hostRoot = canonical(join(dirname(descriptor), 'runtimes', hostId), 'Factory runtime');
    if (bundle(hostRoot).id !== hostId) throw Error('Installed runtime descriptor identity mismatch');
  }
  const mode = config.workflow.mode;
  const root = mode === 'factory' ? hostRoot : resolveCheckoutPath(projectRoot, config.workflow.directory!, 'directory');
  canonical(root, 'Workflow root');
  const manifest = mode === 'factory' ? bundle(root) : bundle(root, true);
  if (inherited?.FACTORY_PROJECT_ROOT === projectRoot && inherited.FACTORY_RUNTIME_ROOT &&
      (inherited.FACTORY_RUNTIME_ROOT !== root || inherited.FACTORY_RUNTIME_ID !== manifest.id || inherited.FACTORY_WORKFLOW_MODE && inherited.FACTORY_WORKFLOW_MODE !== mode))
    throw Error('Selected workflow changed during invocation; start a fresh Factory invocation');
  const env = { FACTORY_PROJECT_ROOT: projectRoot, FACTORY_RUNTIME_ROOT: root, FACTORY_RUNTIME_ID: manifest.id,
    FACTORY_WORKFLOW_MODE: mode, FACTORY_HOST_RUNTIME_ROOT: hostRoot, FACTORY_HOST_RUNTIME_ID: hostId };
  return { mode, root, id: manifest.id, manifest, config, env,
    entrypoints: { dispatch: join(root, 'dispatch.sh'), refresh: join(root, 'dispatch.mts'), main: join(root, 'main.mts'), preparation: join(root, 'recovery-analysis.mts'), config: join(root, 'config-read.mts'), capabilities: join(root, 'capabilities.mts') },
    tsx: join(root, 'node_modules/tsx/dist/cli.mjs') };
}
