// Explicit host filesystem observations. No project settings imports, Git commands or repairs.
// Active mutations use pinned directory descriptors and exclusively owned disposable files.
import * as fs from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { reportStatus, safeErrno, validIdentity, validReport } from './readiness-schema.mts';
import type { ReadinessIdentity, ObservationOwner, ReadinessScope, ReadinessReport, ReadinessCheck } from './readiness-schema.mts';
export * from './readiness-schema.mts';
export interface ReadinessPath {
  id: string;
  scope: ReadinessScope;
  role: 'project-asset' | 'checkout' | 'git-dir' | 'git-common-dir' | 'base' | 'runtime' | 'state' | 'artifact' | 'worktree-parent';
  path: string;
  trustedRoot: string;
  access: 'read-file' | 'read-directory' | 'write-directory';
  /** Only explicit ordinary Factory artifact/state/worktree directories may be created. */
  create?: boolean;
}
export interface ReadinessInput {
  identity: ReadinessIdentity;
  owner: ObservationOwner;
  paths: ReadinessPath[];
}
export interface ProbeOptions { signal?: AbortSignal; timeoutMs?: number }
const failure = (code: string) => Object.assign(new Error(code), { code });
const contained = (root: string, path: string) => { const r = relative(root, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('../'); };
export type ReadinessIO = typeof fs;
/** Low-level synchronous collector for fixture injection. Production callers use the bounded worker APIs. */
export function collectReadiness(input: ReadinessInput, phase: 'passive' | 'active', io: ReadinessIO = fs): ReadinessReport {
  if (!validIdentity(input.identity) || !input.owner || !['generation', 'ownerId', 'invocationId'].every(k => typeof input.owner[k as keyof ObservationOwner] === 'string' && input.owner[k as keyof ObservationOwner].length > 0) ||
      !Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 100) throw failure('EINVAL');
  const observedAt = new Date().toISOString();
  const checks: ReadinessCheck[] = [];
  const add = (p: ReadinessPath, status: ReadinessCheck['status'], operation: string, reason: string, errno?: string, required = true) => {
    const c: ReadinessCheck = { id: p.id, scope: p.scope, phase, observedAt, status, required, operation, path: p.path, reason,
      nextActor: status === 'ready' ? 'none' : status === 'unknown' ? 'factory' : 'operator',
      nextAction: status === 'ready' ? 'No action required' : status === 'unknown' ? 'Run a fresh active probe before launch' : `Inspect ${operation} access at the reported path`,
      automaticRecheck: 'next-launch', ...(errno ? { errno } : {}) };
    checks.push(c); return c;
  };
  for (const p of input.paths) {
    let operation = 'validate-path';
    const handles: number[] = [];
    try {
      if (!p.id || !['project', 'ticket-input', 'ticket-workspace', 'sandbox'].includes(p.scope) ||
          !['project-asset', 'checkout', 'git-dir', 'git-common-dir', 'base', 'runtime', 'state', 'artifact', 'worktree-parent'].includes(p.role) ||
          !['read-file', 'read-directory', 'write-directory'].includes(p.access) ||
          (p.access === 'write-directory' && !['artifact', 'state', 'worktree-parent'].includes(p.role)) ||
          !isAbsolute(p.path) || resolve(p.path) !== p.path || !isAbsolute(p.trustedRoot) ||
          !contained(p.trustedRoot, p.path) || io.realpathSync(p.trustedRoot) !== p.trustedRoot ||
          ((p.role === 'project-asset' || p.role === 'checkout' || p.role === 'artifact') && p.trustedRoot !== input.identity.projectRoot) ||
          io.realpathSync(input.identity.projectRoot) !== input.identity.projectRoot ||
          (p.create && (p.access !== 'write-directory' || !['artifact', 'state', 'worktree-parent'].includes(p.role)))) throw failure('EUNSAFEPATH');
      const pin = (path: string) => {
        const fd = io.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        handles.push(fd); return fd;
      };
      const descriptorPath = (fd: number) => process.platform === 'linux' ? `/proc/self/fd/${fd}` : `/dev/fd/${fd}`;
      let fd = pin(p.trustedRoot);
      operation = 'read-directory'; io.accessSync(descriptorPath(fd), fs.constants.R_OK | fs.constants.X_OK);
      let current = p.trustedRoot;
      const rootStat = io.fstatSync(fd);
      const validate = () => {
        // Recheck both the named path and its pinned directory before every mutation.
        if (io.realpathSync(p.trustedRoot) !== p.trustedRoot) throw failure('EUNSAFEPATH');
        const root = io.lstatSync(p.trustedRoot);
        if (root.dev !== rootStat.dev || root.ino !== rootStat.ino) throw failure('ESTALE');
        const s = io.lstatSync(current), pinned = io.fstatSync(fd);
        if (s.isSymbolicLink() || io.realpathSync(current) !== current || s.dev !== pinned.dev || s.ino !== pinned.ino) throw failure('ESTALE');
      };
      const parts = relative(p.trustedRoot, p.path).split('/').filter(Boolean);
      let missing = false;
      for (let i = 0; i < parts.length; i++) {
        const lastFile = i === parts.length - 1 && p.access === 'read-file';
        const child = join(descriptorPath(fd), parts[i]);
        operation = 'lstat';
        try { if (io.lstatSync(child).isSymbolicLink()) throw failure('EUNSAFEPATH'); }
        catch (e) {
          if (safeErrno(e) !== 'ENOENT' || !p.create) throw e;
          if (phase === 'passive') { missing = true; break; }
          operation = 'mkdir'; validate(); io.mkdirSync(child, { mode: 0o700 });
        }
        if (lastFile) {
          operation = 'open-read';
          // Nonblocking refuses to hang on FIFOs/devices. No file bodies enter reports.
          const f = io.openSync(child, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
          handles.push(f);
          if (!io.fstatSync(f).isFile()) throw failure('EINVAL');
          operation = 'read'; io.readSync(f, Buffer.alloc(1), 0, 1, 0);
        } else {
          operation = 'open-directory'; fd = pin(child); current = join(current, parts[i]);
          operation = 'read-directory'; io.accessSync(descriptorPath(fd), fs.constants.R_OK | fs.constants.X_OK);
        }
      }
      if (!parts.length && p.access === 'read-file') throw failure('EINVAL');
      if (p.access !== 'write-directory') { add(p, 'ready', operation, 'Required read access observed'); continue; }
      if (phase === 'passive') add(p, 'unknown', 'write-unproven', missing ? 'Intended directory is absent; write access has not been tested' : 'Write access has not been tested');
      else {
        const first = `.factory-probe-${randomUUID()}`, second = `.factory-probe-${randomUUID()}`;
        const owned = new Map<string, { dev: number; ino: number }>();
        let primary: unknown;
        try {
          for (const name of [first, second]) {
            operation = 'create'; validate();
            const f = io.openSync(join(descriptorPath(fd), name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
            try {
              const s = io.fstatSync(f); owned.set(name, { dev: s.dev, ino: s.ino }); operation = 'write';
              const bytes = Buffer.from('factory readiness\n');
              if (io.writeSync(f, bytes) !== bytes.length) throw failure('EIO');
            }
            finally { io.closeSync(f); }
          }
          operation = 'rename'; validate();
          for (const [name, s] of owned) { const now = io.lstatSync(join(descriptorPath(fd), name)); if (now.dev !== s.dev || now.ino !== s.ino) throw failure('ESTALE'); }
          io.renameSync(join(descriptorPath(fd), first), join(descriptorPath(fd), second));
          owned.set(second, owned.get(first)!); owned.delete(first);
        } catch (e) { primary = e; add(p, 'blocked', operation, 'Required filesystem operation failed', safeErrno(e)); }
        finally {
          for (const [name, s] of owned) {
            try {
              validate(); const path = join(descriptorPath(fd), name); const now = io.lstatSync(path);
              if (now.dev !== s.dev || now.ino !== s.ino || !now.isFile()) throw failure('ESTALE');
              io.unlinkSync(path);
            } catch (e) { primary ??= e; add({ ...p, id: `${p.id}:cleanup` }, 'blocked', 'remove', 'Owned probe cleanup failed; inspect the directory', safeErrno(e)); }
          }
        }
        if (!primary) add(p, 'ready', 'create/write/rename/remove', 'Disposable filesystem cycle completed');
      }
      operation = 'statfs';
      try {
        const s = io.statfsSync(descriptorPath(fd), { bigint: true });
        const bytes = s.bavail >= 0n && s.bsize > 0n ? s.bavail * s.bsize : null;
        const inodes = s.files > 0n && s.ffree >= 0n ? s.ffree : null;
        const zero = bytes === 0n || inodes === 0n;
        const c = add({ ...p, id: `${p.id}:capacity` }, zero ? 'blocked' : 'ready', 'statfs', zero ? 'Zero available required capacity' : 'Capacity observation; no low-space threshold', undefined, zero);
        c.capacity = { bytesAvailable: bytes?.toString() ?? null, inodesAvailable: inodes?.toString() ?? null };
      } catch {
        const c = add({ ...p, id: `${p.id}:capacity` }, 'unknown', 'statfs', 'Capacity metrics unavailable', undefined, false);
        c.capacity = { bytesAvailable: null, inodesAvailable: null };
      }
    } catch (e) { add(p, 'blocked', operation, 'Required access could not be established', safeErrno(e)); }
    finally { for (const fd of handles.reverse()) { try { io.closeSync(fd); } catch { /* no retained authority */ } } }
  }
  const report: ReadinessReport = { version: 1, identity: input.identity, owner: input.owner, observedAt, phase, status: reportStatus(checks), checks };
  if (!validReport(report)) throw failure('EINVAL');
  return report;
}
function bounded(input: ReadinessInput, phase: 'passive' | 'active', options: ProbeOptions): Promise<ReadinessReport> {
  if (options.signal?.aborted) return Promise.reject(failure('ECANCELED'));
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return Promise.reject(failure('EINVAL'));
  return new Promise((resolve, reject) => {
    // This self-contained native .mts worker needs no CLI eval flags, loaders or executable project imports.
    const worker = new Worker(fileURLToPath(import.meta.url), { execArgv: [], workerData: { factoryReadiness: true, input, phase } });
    let finished = false;
    const finish = (error?: unknown, report?: ReadinessReport) => {
      if (finished) return; finished = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(report!);
    };
    const abort = () => finish(failure('ECANCELED'));
    const timer = setTimeout(() => finish(failure('ETIMEDOUT')), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    worker.once('message', m => m.error ? finish(failure(m.error)) : validReport(m.report) ? finish(undefined, m.report) : finish(failure('EINVAL')));
    worker.once('error', e => finish(failure(safeErrno(e))));
    worker.once('exit', () => { if (!finished) finish(failure('EUNKNOWN')); });
  });
}
/** Passive observations never mutate paths and never establish write capability. */
export const observeReadiness = (input: ReadinessInput, options: ProbeOptions = {}) => bounded(input, 'passive', options);
/** Always run fresh for launch. Timeout/cancellation rejects; callers must hold launch, not reuse a saved success. */
export const probeFilesystem = (input: ReadinessInput, options: ProbeOptions = {}) => bounded(input, 'active', options);
if (!isMainThread && workerData?.factoryReadiness) {
  try { parentPort!.postMessage({ report: collectReadiness(workerData.input, workerData.phase) }); }
  catch (e) { parentPort!.postMessage({ error: safeErrno(e) }); }
}
