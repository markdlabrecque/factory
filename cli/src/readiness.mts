// Passive CLI readiness reads and explicit doctor probes. Never import selected workflow executables.
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { resolveWorkflow } from '../../orchestrator/workflow.mts';
import { loadInstructions } from '../../orchestrator/instructions.mts';
import { readinessIdentity } from '../../orchestrator/readiness-identity.mts';
import { observeReadiness, probeFilesystem } from '../../orchestrator/readiness.mts';
import type { ReadinessInput, ReadinessPath } from '../../orchestrator/readiness.mts';
import { readReadiness, readStoredReadiness } from '../../board/readiness.mts';
import type { ReadinessRead } from '../../board/readiness.mts';
import type { Paths } from './paths.mts';
import { runStateDir } from './runs.mts';
function gitPointer(path: string): string {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096) throw Error('Invalid Git metadata');
    const bytes = Buffer.alloc(4097), n = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (n > 4096) throw Error('Invalid Git metadata');
    return bytes.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}
function ancestor(path: string): string {
  let root = path;
  while (!fs.existsSync(root)) { const parent = dirname(root); if (parent === root) throw Error('Missing root'); root = parent; }
  return fs.realpathSync(root);
}
/** Build only from validated data and the complete workflow resolver. No shell, auth or tracker reads. */
export function diagnosticContext(p: Paths, root: string) {
  const workflow = resolveWorkflow(root, p.runtimeDescriptor);
  const configPath = join(root, '.factory/factory.toml');
  const configBytes = fs.readFileSync(configPath);
  const assets: Record<string, string> = {};
  for (const role of ['implementation', 'verification', 'analysis', 'recovery'] as const)
    Object.assign(assets, loadInstructions(root, workflow.config.instructions, role).hashes);
  const identity = readinessIdentity(root, workflow.id, workflow.manifest.dependencies, configBytes, assets);
  return { workflow, assets, identity };
}
export function diagnosticInput(p: Paths, root: string): ReadinessInput {
  const { workflow, assets, identity } = diagnosticContext(p, root);
  const configPath = join(root, '.factory/factory.toml');
  const paths: ReadinessPath[] = [];
  const read = (id: string, path: string, trustedRoot: string, role: ReadinessPath['role'], access: ReadinessPath['access'] = 'read-directory') =>
    paths.push({ id, scope: 'project', role, path, trustedRoot, access });
  read('checkout', root, root, 'checkout');
  read('configuration', configPath, root, 'project-asset', 'read-file');
  for (const path of Object.keys(assets)) read(`instruction:${path}`, resolve(root, path), root, 'project-asset', 'read-file');
  read('runtime', workflow.root, workflow.root, 'runtime');
  let git = join(root, '.git');
  if (fs.lstatSync(git).isFile()) {
    const text = gitPointer(git);
    if (text.length > 4096 || !/^gitdir: [^\r\n]+\n?$/.test(text)) throw Error('Invalid Git pointer');
    git = fs.realpathSync(resolve(root, text.trim().slice(8)));
  }
  read('git-dir', git, git, 'git-dir');
  read('git-head', join(git, 'HEAD'), git, 'base', 'read-file');
  const commonFile = join(git, 'commondir');
  if (fs.existsSync(commonFile)) {
    const text = gitPointer(commonFile);
    if (text.length > 4096 || !/^[^\r\n]+\n?$/.test(text)) throw Error('Invalid Git common directory');
    const common = fs.realpathSync(resolve(git, text.trim()));
    read('git-common-dir', common, common, 'git-common-dir');
  }
  for (const [id, path, role] of [
    ['state', runStateDir(p), 'state'], ['logs', join(root, '.factory/logs'), 'artifact'],
    ['evidence', join(root, '.factory/evidence'), 'artifact'], ['worktrees', join(root, '.factory/worktrees'), 'worktree-parent'],
  ] as const) paths.push({ id, scope: 'project', path, role, trustedRoot: role === 'artifact' ? root : ancestor(path), access: 'write-directory', create: true });
  return { identity, paths, owner: { invocationId: `doctor-${randomUUID()}`, ownerId: `cli-${process.pid}`, generation: randomUUID() } };
}
export function savedReadiness(p: Paths, root: string, now = Date.now()): ReadinessRead {
  // Same registered-root projection as Board: identity belongs to the observation, not current config authorization.
  return readStoredReadiness(runStateDir(p), root, now);
}
/** Never publish doctor observations over launch reports, even in explicit probe mode. */
export async function doctorReadiness(p: Paths, root: string, active: boolean) {
  const input = diagnosticInput(p, root);
  const report = await (active ? probeFilesystem(input) : observeReadiness(input));
  const saved = readReadiness(runStateDir(p), input.identity);
  const matchingActiveWrites = saved.state === 'current' && saved.report.phase === 'active' &&
    input.paths.filter(p => p.access === 'write-directory').every(p => saved.report.checks.some(c =>
      c.id === p.id && c.path === p.path && c.required && c.phase === 'active' && c.operation === 'create/write/rename/remove' && c.status === 'ready'));
  return { report, saved, matchingActiveWrites };
}
