// Read-only workflow content identities, copy classifications and existing gate observations.
// Only scaffoldSources paths are hashed. Git provenance requires an actual checkout root.
// Project code is never imported. Docker inspection is one bounded GET over a local Unix socket.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
import type { Paths } from './paths.mts';
import { appRoot } from './scaffold.mts';
import { classifyCopy, factoryHistory, PROJECT_OWNED, scaffoldSources } from './update.mts';
import type { History } from './update.mts';
import { copyProblem } from './schedule.mts';
import { changedSinceReview, missingWorkflow, readReview, WORKFLOW } from './recovery-review.mts';

export type Observation = { state: 'met' | 'blocked' | 'unknown'; reason: string; evidence: string[] };
export type Content = { path: string; status: 'present' | 'missing' | 'not-regular' | 'unknown'; sha256: string | null };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sources = () => [...new Set(Object.values(scaffoldSources()).flat())].sort(order);
const files = () => Object.keys(scaffoldSources()).sort(order);

function content(root: string, path: string): Content {
  try {
    // Refuse symlinked files/parents inside the selected inventory, including vendor directories.
    let parent = root;
    for (const part of path.split('/')) {
      parent = join(parent, part);
      if (lstatSync(parent).isSymbolicLink()) return { path, status: 'not-regular', sha256: null };
    }
    if (!lstatSync(parent).isFile()) return { path, status: 'not-regular', sha256: null };
    return { path, status: 'present', sha256: sha(readFileSync(parent)) };
  } catch (e) {
    return { path, status: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown', sha256: null };
  }
}

/** Version-1 digest encoding: SHA-256 of JSON [relative path, status, SHA-256|null] rows in codepoint order. */
export function workflowDigest(inventory: Content[]): string {
  return sha(JSON.stringify([...inventory].sort((a, b) => order(a.path, b.path)).map(f => [f.path, f.status, f.sha256])));
}
function gitIdentity(root: string) {
  const git = (...args: string[]) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, maxBuffer: 4 << 20,
  }).trim();
  try {
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== root) return { commit: null, dirty: null };
    return { commit: git('rev-parse', '--verify', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=normal').length > 0 };
  } catch { return { commit: null, dirty: null }; }
}
function identity(path: string, project = false) {
  let canonicalPath: string | null = null;
  let status: 'present' | 'missing' | 'unknown' = 'present';
  let linked = false;
  try {
    linked = lstatSync(path).isSymbolicLink();
    canonicalPath = realpathSync(path);
    if (!statSync(canonicalPath).isDirectory()) status = 'unknown';
  } catch (e) { status = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown'; }
  const inventory = (project ? files() : sources()).map(f => content(canonicalPath ?? path, f));
  const git = canonicalPath && status === 'present' ? gitIdentity(canonicalPath) : { commit: null, dirty: null };
  return { path: resolve(path), canonicalPath, status, linked, ...git,
    workflowDigest: workflowDigest(inventory), inventory };
}
function history(root: string): History {
  try { return factoryHistory(root); } catch { return { kind: 'none', blobs: new Map() }; }
}
function classifications(p: Paths, root: string, app: ReturnType<typeof identity>, h: History) {
  return files().map(file => {
    const required = scaffoldSources()[file];
    if (app.status !== 'present') return { file, class: 'unknown' as const, reason: 'comparison app is unavailable' };
    if (required.some(path => app.inventory.find(f => f.path === path)?.status !== 'present'))
      return { file, class: 'unknown' as const, reason: 'comparison source content is unavailable' };
    const target = content(join(root, '.sandcastle'), file);
    if (target.status === 'not-regular') return { file, class: PROJECT_OWNED.includes(file) ? 'project' as const : 'modified' as const, reason: 'not a regular file; symlinks are not followed' };
    if (target.status === 'unknown') return { file, class: 'unknown' as const, reason: 'project content is unreadable' };
    try { return classifyCopy(p, root, { app: app.canonicalPath!, history: h, files: [file] })[0]; }
    catch { return { file, class: 'unknown' as const, reason: 'file classification could not be read' }; }
  });
}
function observe(fn: () => Observation): Observation {
  try { return fn(); } catch { return { state: 'unknown', reason: 'observation could not be read', evidence: [] }; }
}
export function capabilityObservations(p: Paths, root: string) {
  const unsafe = [...new Set([...WORKFLOW, 'dispatch.sh'])].filter(f => ['not-regular', 'unknown'].includes(content(join(root, '.sandcastle'), f).status));
  if (unsafe.length) {
    const unavailable: Observation = { state: 'unknown', reason: 'workflow contains unreadable or non-regular files; checks were not followed through symlinks', evidence: unsafe };
    return { schedulerCopy: unavailable, recoveryWorkflow: unavailable, recoveryReview: unavailable,
      limitation: 'These existing string, presence and recorded-hash checks do not establish complete executable compatibility. Helper drift requires review; this report authorizes no repair.' };
  }
  const schedulerCopy = observe(() => {
    const problem = copyProblem(root);
    return { state: problem ? 'blocked' : 'met', reason: problem ?? 'existing executable dispatch and reservation-string check passes',
      evidence: problem ? [problem] : ['dispatch.sh executable', 'dispatch.mts: reserveRun(', 'board.mts: export function reserveRun'] };
  });
  const recoveryWorkflow = observe(() => {
    const missing = missingWorkflow(root);
    return { state: missing.length ? 'blocked' : 'met', reason: missing.length ? 'recovery workflow is incomplete' : 'existing recovery file and entrypoint-string checks pass', evidence: missing };
  });
  const recoveryReview = observe(() => {
    const review = readReview(p, root);
    if (review === null) return { state: 'blocked', reason: 'no recorded recovery review', evidence: [] };
    if (typeof review === 'string' || Array.isArray(review.files)
      || Object.values(review.files).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)))
      return { state: 'unknown', reason: 'malformed recovery review', evidence: [] };
    if (recoveryWorkflow.state !== 'met') return { state: 'blocked', reason: 'cannot match review against incomplete workflow', evidence: [] };
    const changed = changedSinceReview(root, review);
    return { state: changed.length ? 'blocked' : 'met', reason: changed.length ? 'workflow changed since recorded review' : 'workflow matches recorded review', evidence: changed };
  });
  return { schedulerCopy, recoveryWorkflow, recoveryReview,
    limitation: 'These existing string, presence and recorded-hash checks do not establish complete executable compatibility. Helper drift requires review; this report authorizes no repair.' };
}

// The legacy lexer remains available for diagnostics only, never runtime image selection.
export { legacyImage } from './image-config.mts';
export function configuredImage(scaffold: string) {
  const tomlContent = content(scaffold, 'factory.toml');
  if (tomlContent.status !== 'present' && tomlContent.status !== 'missing')
    return { state: 'invalid-config' as const, mode: 'toml', reference: null, reason: 'TOML is unreadable or non-regular; no legacy fallback' };
  try {
    const toml = loadTomlConfig(scaffold);
    return { state: 'known' as const, mode: 'toml', reference: toml.config.image, reason: 'validated TOML sandbox image' };
  } catch { return { state: 'invalid-config' as const, mode: 'toml', reference: null, reason: 'TOML is missing, invalid or unreadable; manually migrate to version 2; no legacy fallback' }; }
}

export function localSocket(path = '/var/run/docker.sock'): string {
  if (!isAbsolute(path) || path.includes('://') || path.includes('\0')) throw new Error('--docker-socket must be an absolute local Unix socket path, not a URL');
  return path;
}
type ImageInspection = { state: 'present' | 'missing' | 'unknown'; reason: string; id?: string; repoDigests?: string[]; os?: string; architecture?: string; user?: string };
/** No CLI/context/environment fallback. A total deadline and byte limit also bound a trickling daemon. */
export function inspectLocalImage(reference: string, socket = '/var/run/docker.sock'): Promise<ImageInspection> {
  localSocket(socket);
  return new Promise(done => {
    let settled = false;
    const finish = (result: ImageInspection) => { if (!settled) { settled = true; clearTimeout(timer); req.destroy(); done(result); } };
    const req = request({ socketPath: socket, path: `/images/${encodeURIComponent(reference)}/json`, method: 'GET' }, res => {
      let size = 0; const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1 << 20) finish({ state: 'unknown', reason: 'local image response exceeds 1 MiB' }); else chunks.push(chunk);
      });
      res.on('error', () => finish({ state: 'unknown', reason: 'local image response interrupted' }));
      res.on('end', () => {
        if (res.statusCode === 404) return finish({ state: 'missing', reason: 'local daemon reports image absent' });
        if (res.statusCode !== 200) return finish({ state: 'unknown', reason: 'local daemon did not return image inspection' });
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!d || typeof d !== 'object' || typeof d.Id !== 'string' || !d.Id) throw new Error();
          const result: ImageInspection = { state: 'present', reason: 'local image inspection only', id: d.Id };
          if (Array.isArray(d.RepoDigests) && d.RepoDigests.every((v: unknown) => typeof v === 'string')) result.repoDigests = d.RepoDigests;
          if (typeof d.Os === 'string') result.os = d.Os;
          if (typeof d.Architecture === 'string') result.architecture = d.Architecture;
          if (typeof d.Config?.User === 'string') result.user = d.Config.User;
          finish(result);
        } catch { finish({ state: 'unknown', reason: 'malformed local image response' }); }
      });
    });
    const timer = setTimeout(() => finish({ state: 'unknown', reason: 'local image inspection exceeded 3-second deadline' }), 3000);
    req.on('error', () => finish({ state: 'unknown', reason: 'local Docker socket unavailable or inaccessible' }));
    req.end();
  });
}

export async function collectWorkflowReport(p: Paths, options: { source: string; projectRoot: string; invokingApp?: string; dockerSocket?: string }) {
  const socket = localSocket(options.dockerSocket);
  const source = identity(options.source);
  if (source.status !== 'present' || !source.canonicalPath || !statSync(join(source.canonicalPath, 'cli/src/scaffold.mts'), { throwIfNoEntry: false })?.isFile()
    || !statSync(join(source.canonicalPath, 'orchestrator'), { throwIfNoEntry: false })?.isDirectory()) throw new Error('--source must name a Factory source checkout directory');
  const invokingApp = identity(options.invokingApp ?? appRoot);
  const installed = identity(p.app);
  const installedApp = { ...installed, status: installed.status === 'present' ? installed.linked ? 'linked' : 'copied' : installed.status,
    files: installed.inventory.map(f => {
      const reference = source.inventory.find(s => s.path === f.path)!;
      return { ...f, againstSource: f.status === 'present' && reference.status === 'present'
        ? f.sha256 === reference.sha256 ? 'same' : 'different' : 'unknown' };
    }) };
  const projectCopy = identity(join(options.projectRoot, '.sandcastle'), true);
  const sourceHistory = history(source.canonicalPath), installedHistory = history(installed.canonicalPath ?? p.app);
  const againstSource = classifications(p, options.projectRoot, source, sourceHistory);
  const againstInstalled = classifications(p, options.projectRoot, installed, installedHistory);
  const config = configuredImage(join(options.projectRoot, '.sandcastle'));
  return { version: 1, source, invokingApp, installedApp,
    projectCopy: { ...projectCopy, root: options.projectRoot, files: projectCopy.inventory.map(f => ({ ...f,
      againstSource: againstSource.find(c => c.file === f.path)!, againstInstalled: againstInstalled.find(c => c.file === f.path)! })) },
    capabilities: capabilityObservations(p, options.projectRoot),
    image: { configuration: config, socket, inspection: config.reference ? await inspectLocalImage(config.reference, socket) : { state: 'unknown', reason: 'configured image is unknown; no daemon request made' } },
    limitations: ['Content digests identify selected files, not releases. Missing files have explicit digest markers.',
      'Source/app inventories use source-relative paths; the project inventory uses scaffold-relative paths and project settings. Compare files, not digests across these layouts.',
      'Git commit and dirty state are unknown without a checkout rooted at that exact path. Historical blob matches do not establish installed commit provenance.',
      'No verification probes, tracker/auth calls, service observations, image pulls/builds/runs or updates were performed.'] };
}
export type WorkflowReport = Awaited<ReturnType<typeof collectWorkflowReport>>;
export function formatWorkflowReport(report: WorkflowReport): string {
  const lines = ['Factory workflow status, schema version 1'];
  for (const [name, copy] of Object.entries({ source: report.source, invokingApp: report.invokingApp, installedApp: report.installedApp, projectCopy: report.projectCopy })) {
    lines.push(`${name}: ${copy.status} ${copy.canonicalPath ?? copy.path}`, `  commit: ${copy.commit ?? 'unknown'}; dirty: ${copy.dirty ?? 'unknown'}`, `  workflowDigest: ${copy.workflowDigest}`);
  }
  lines.push('Installed file differences against source:');
  for (const f of report.installedApp.files.filter(f => f.againstSource !== 'same')) lines.push(`  ${f.path}: ${f.status}; ${f.againstSource}`);
  lines.push('Project file comparisons (source / installed):');
  const differences = report.projectCopy.files.filter(f => f.againstSource.class !== 'current' || f.againstInstalled.class !== 'current');
  lines.push(`  ${report.projectCopy.files.length - differences.length} files current against both references`);
  for (const f of differences) lines.push(`  ${f.path}: ${f.status}; ${f.againstSource.class} / ${f.againstInstalled.class}`);
  for (const [name, obs] of Object.entries(report.capabilities)) if (typeof obs !== 'string') lines.push(`${name}: ${obs.state}; ${obs.reason}${obs.evidence.length ? `; ${obs.evidence.join(', ')}` : ''}`);
  lines.push(report.capabilities.limitation, `image configuration: ${report.image.configuration.state}; ${report.image.configuration.reference ?? 'unknown'}`,
    `local image: ${report.image.inspection.state}; ${report.image.inspection.reason}`);
  const inspected = report.image.inspection as ImageInspection;
  if (inspected.state === 'present') lines.push(`  ID: ${inspected.id}; RepoDigests: ${inspected.repoDigests?.join(', ') ?? 'unknown'}; OS: ${inspected.os ?? 'unknown'}; architecture: ${inspected.architecture ?? 'unknown'}; user: ${inspected.user ?? 'unknown'}`);
  lines.push(...report.limitations);
  return lines.join('\n');
}
