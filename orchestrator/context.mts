// Explicit project/runtime boundary. Validate selected bytes before loading settings or taking process leases.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTomlConfig, resolveCheckoutPath, type EffectiveConfig } from './project-config.mts';
import { loadInstructions } from './instructions.mts';
import { requireProjectLayout } from './project-layout.mts';
import { assertProjectRecordLayout } from './ownership.mts';

const guidance = 'Use Factory commands with an explicit selected runtime; low-level entrypoints do not discover project context.';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
function canonical(value: string | undefined, name: string): string {
  if (!value || !isAbsolute(value) || resolve(value) !== value || realpathSync(value) !== value || !lstatSync(value).isDirectory())
    throw Error(`${name} must name an existing canonical absolute directory. ${guidance}`);
  return value;
}
function within(root: string, path: string): string {
  const target = resolve(root, path), rel = relative(root, target);
  if (isAbsolute(path) || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('Path escapes execution root');
  return target;
}
export type FrozenAdditive = Readonly<{ text: string; hashes: Readonly<Record<string, string>> }>;
// File loading/composition belongs to the instruction consumer. No project template replacement.
export function freezeAdditive(text = '', hashes: Readonly<Record<string, string>> = {}): FrozenAdditive {
  if (typeof text !== 'string' || Object.values(hashes).some(value => !/^[a-f0-9]{64}$/.test(value))) throw Error('Invalid frozen additive prompt input');
  return Object.freeze({ text, hashes: Object.freeze({ ...hashes }) });
}
export const EMPTY_ADDITIVE: FrozenAdditive = freezeAdditive();
export type ExecutionContext = Awaited<ReturnType<typeof loadExecutionContext>>;
export async function loadExecutionContext(input: { env?: NodeJS.ProcessEnv; cwd?: string; moduleRoot?: string } = {}) {
  const env = input.env ?? process.env;
  try {
    const projectRoot = canonical(env.FACTORY_PROJECT_ROOT, 'FACTORY_PROJECT_ROOT');
    requireProjectLayout(projectRoot);
    const runtimeRoot = canonical(env.FACTORY_RUNTIME_ROOT, 'FACTORY_RUNTIME_ROOT');
    if (realpathSync(input.cwd ?? process.cwd()) !== projectRoot) throw Error(`cwd must be project root. ${guidance}`);
    if (realpathSync(input.moduleRoot ?? dirname(fileURLToPath(import.meta.url))) !== runtimeRoot) throw Error(`Module is not from selected runtime. ${guidance}`);
    if (!/^[a-f0-9]{64}$/.test(env.FACTORY_RUNTIME_ID ?? '')) throw Error(`Missing selected runtime identity. ${guidance}`);
    const { validateRuntimeBundle } = await import(pathToFileURL(join(runtimeRoot, 'runtime-bundle.mts')).href);
    const manifest = freezeSnapshot(validateRuntimeBundle(runtimeRoot));
    if (manifest.id !== env.FACTORY_RUNTIME_ID || env.FACTORY_RUNTIME_DEPENDENCIES && manifest.dependencies !== env.FACTORY_RUNTIME_DEPENDENCIES || env.FACTORY_WORKFLOW_MODE !== 'project' && basename(runtimeRoot) !== manifest.id) throw Error('Selected runtime identity mismatch');
    if (env.FACTORY_WORKFLOW_MODE) {
      const { resolveWorkflow } = await import('./workflow.mts');
      resolveWorkflow(projectRoot, '', env);
    }
    let assetRoot: string;
    try {
      assetRoot = canonical(within(projectRoot, '.factory'), 'Project asset root');
      resolveCheckoutPath(projectRoot, '.factory/factory.toml', 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error(`${projectRoot}/.factory/factory.toml: missing version 2 configuration; initialize a supported new project`);
      throw error;
    }
    const config = freezeSnapshot(loadTomlConfig(assetRoot));
    const roles = ['implementation', 'verification', 'analysis', 'recovery'] as const;
    const readAdditive = () => Object.freeze(Object.fromEntries(roles.map(role => [role, loadInstructions(projectRoot, config.instructions, role)])) as Record<typeof roles[number], FrozenAdditive>);
    const additive = readAdditive();
    const additiveHashes = () => Object.fromEntries(roles.map(role => [role, additive[role].hashes]));
    if (!env.SANDCASTLE_STATE_DIR && (!env.HOME || !isAbsolute(env.HOME))) throw Error('An absolute shared state directory or HOME is required');
    if (env.SANDCASTLE_STATE_DIR && !isAbsolute(env.SANDCASTLE_STATE_DIR)) throw Error('SANDCASTLE_STATE_DIR must be absolute');
    const sharedState = resolve(env.SANDCASTLE_STATE_DIR ?? join(env.HOME!, '.local/state/factory'));
    const tracker = config.TRACKER;
    const checkSavedLayout = () => assertProjectRecordLayout(sharedState, projectRoot, { kind: tracker.kind, host: tracker.gitlabHost ?? tracker.host!, project: tracker.project });
    checkSavedLayout();
    const codePath = (path: string) => within(runtimeRoot, path);
    const projectPath = (path: string) => within(projectRoot, path);
    const templates = Object.fromEntries(['prompt.md', 'prompt.verify.md', 'prompt.analyze.md', 'prompt.recover.md'].map(name => [name, readFileSync(codePath(name), 'utf8')]));
    const templateHashes = Object.fromEntries(Object.entries(templates).map(([name, text]) => [name, hash(text)]));
    const safetySettings = JSON.parse(JSON.stringify(normalizedSettings(config)));
    const identity = freezeSnapshot({ runtime: { id: manifest.id, dependencies: manifest.dependencies }, settings: safetySettings, templates: templateHashes, additive: additiveHashes() });
    return Object.freeze({ projectRoot, runtimeRoot, assetRoot, sharedState, config, manifest, codePath, projectPath,
      templates: Object.freeze(templates), additive, identity, policyIdentity: hash(identity),
      assertCurrent: () => {
        canonical(projectRoot, 'FACTORY_PROJECT_ROOT');
        requireProjectLayout(projectRoot);
        checkSavedLayout();
        canonical(assetRoot, 'Project asset root');
        resolveCheckoutPath(projectRoot, '.factory/factory.toml', 'file');
        const now = validateRuntimeBundle(runtimeRoot);
        const currentAdditive = readAdditive();
        if (now.id !== manifest.id || now.dependencies !== manifest.dependencies || hash(normalizedSettings(loadTomlConfig(assetRoot))) !== hash(safetySettings) || hash(Object.fromEntries(roles.map(role => [role, currentAdditive[role].hashes]))) !== hash(additiveHashes()))
          throw Error('Runtime, settings or prompt inputs changed; fresh analysis/verification required');
      },
      tsx: codePath('node_modules/tsx/dist/cli.mjs'),
      sandcastle: codePath(`node_modules/@ai-hero/sandcastle/${JSON.parse(readFileSync(codePath('package-lock.json'), 'utf8')).packages['node_modules/@ai-hero/sandcastle'].bin.sandcastle}`),
      env: Object.freeze({ FACTORY_PROJECT_ROOT: projectRoot, FACTORY_RUNTIME_ROOT: runtimeRoot, FACTORY_RUNTIME_ID: manifest.id, FACTORY_RUNTIME_DEPENDENCIES: manifest.dependencies, ...(env.FACTORY_WORKFLOW_MODE ? { FACTORY_WORKFLOW_MODE: env.FACTORY_WORKFLOW_MODE } : {}), ...(env.FACTORY_HOST_RUNTIME_ROOT ? { FACTORY_HOST_RUNTIME_ROOT: env.FACTORY_HOST_RUNTIME_ROOT, FACTORY_HOST_RUNTIME_ID: env.FACTORY_HOST_RUNTIME_ID, FACTORY_HOST_RUNTIME_DEPENDENCIES: env.FACTORY_HOST_RUNTIME_DEPENDENCIES } : { FACTORY_HOST_RUNTIME_DEPENDENCIES: manifest.dependencies }), SANDCASTLE_STATE_DIR: sharedState }) });
  } catch (error) {
    const message = (error as Error).message;
    throw Error(`Invalid Factory execution context: ${message}${message.includes('Use Factory commands') ? '' : `. ${guidance}`}`);
  }
}
/** Normalized data only: source attribution and TOML formatting do not confer authority. */
export function normalizedSettings(c: EffectiveConfig) {
  const { source, sources, warnings, ...settings } = c;
  return settings;
}
let selected: Promise<ExecutionContext> | undefined;
export const executionContext = () => selected ??= loadExecutionContext();

/** A separate token per process, or an explicitly handed-off detached-child token. Never reselect a descriptor. */
export async function retainRuntime(context: ExecutionContext) {
  const ownership = await import(pathToFileURL(context.codePath('runtime-ownership.mts')).href);
  const admission = await import(pathToFileURL(context.codePath('admission.mts')).href);
  const hostRoot = context.env.FACTORY_HOST_RUNTIME_ROOT ?? context.runtimeRoot;
  const leaseId = context.env.FACTORY_HOST_RUNTIME_ID ?? context.manifest.id;
  const paths = { data: dirname(dirname(hostRoot)), runtimes: dirname(hostRoot) };
  const inherited = process.env.FACTORY_RUNTIME_LEASE;
  // The inherited capability is consumed once; grandchildren receive their own token.
  delete process.env.FACTORY_RUNTIME_LEASE;
  const lease = inherited ? ownership.transferRuntimeLease(paths, inherited, admission.ownerOf(process.pid), leaseId)
    : ownership.acquireRuntimeLease(paths, leaseId);
  let cleanupConfirmed = true, released = false;
  const release = () => {
    if (!released && cleanupConfirmed) { ownership.releaseRuntimeLease(paths, lease.token); released = true; }
  };
  process.once('exit', release);
  return { token: lease.token, pendingCleanup: () => { cleanupConfirmed = false; }, confirmedCleanup: () => { cleanupConfirmed = true; }, release,
    childLease: () => ownership.acquireRuntimeLease(paths, leaseId),
    transfer: (token: string, pid: number) => ownership.transferRuntimeLease(paths, token, admission.ownerOf(pid), leaseId),
    releaseChild: (token: string) => ownership.releaseRuntimeLease(paths, token) };
}
/** Re-read current inputs before granting new analysis or delivery authority. Frozen choices remain unchanged. */
export function contextHold(context: ExecutionContext): string | undefined {
  try { context.assertCurrent(); } catch (e) { return (e as Error).message; }
}
