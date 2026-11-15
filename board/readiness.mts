// Atomic local readiness projection. Generation allocation fences older publishers across processes.
// Reads are passive and bounded. Write errors are fatal to callers, never best-effort launch success.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReadinessIdentity, ReadinessReport, ObservationOwner } from '../orchestrator/readiness-schema.mts';
const schema = await import(fs.existsSync(new URL('./readiness-schema.mts', import.meta.url)) ? './readiness-schema.mts' : '../orchestrator/readiness-schema.mts');
const { MAX_REPORT_BYTES, identityKey, projectKey, validIdentity, validReport, displayFreshness, safeErrno } = schema;
export { displayFreshness };
export type ReadinessToken = { identity: ReadinessIdentity; owner: ObservationOwner };
interface Envelope { version: 1; token: ReadinessToken; report: ReadinessReport | null; diagnostics: { observedAt: string; status: string }[] }
export type ReadinessRead =
  | { state: 'current' | 'stale'; report: ReadinessReport }
  | { state: 'missing' | 'pending' | 'invalid'; reason: string; errno?: string };
const sameOwner = (a: ObservationOwner, b: ObservationOwner) => ['invocationId', 'ownerId', 'generation'].every(k => a[k as keyof ObservationOwner] === b[k as keyof ObservationOwner]);
const fail = (code: string) => Object.assign(new Error(`Readiness store: ${code}`), { code });
const fdPath = (fd: number) => process.platform === 'linux' ? `/proc/self/fd/${fd}` : `/dev/fd/${fd}`;
function directory(root: string, create: boolean): number {
  if (fs.realpathSync(root) !== root) throw fail('EUNSAFEPATH');
  const rootFd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const pinned = fs.fstatSync(rootFd), named = fs.lstatSync(root);
    if (fs.realpathSync(root) !== root || pinned.dev !== named.dev || pinned.ino !== named.ino) throw fail('ESTALE');
    const path = join(fdPath(rootFd), 'readiness');
    if (create) { try { fs.mkdirSync(path, { mode: 0o700 }); } catch (e) { if (safeErrno(e) !== 'EEXIST') throw e; } }
    return fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  } finally { fs.closeSync(rootFd); }
}
function readEnvelope(path: string): Envelope {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) throw fail('EINVALIDREPORT');
    const buf = Buffer.alloc(MAX_REPORT_BYTES + 1);
    let n = 0, count: number;
    while ((count = fs.readSync(fd, buf, n, buf.length - n, null)) > 0) { n += count; if (n > MAX_REPORT_BYTES) throw fail('EINVALIDREPORT'); }
    const v = JSON.parse(buf.subarray(0, n).toString('utf8'));
    if (!v || v.version !== 1 || !validIdentity(v.token?.identity) || !v.token.owner ||
        !['invocationId', 'ownerId', 'generation'].every(k => typeof v.token.owner[k] === 'string' && v.token.owner[k].length > 0 && v.token.owner[k].length <= 4096) ||
        !Array.isArray(v.diagnostics) || v.diagnostics.length > 3 ||
        !v.diagnostics.every((d: any) => d && Object.keys(d).every(k => ['observedAt', 'status'].includes(k)) && typeof d.observedAt === 'string' && Number.isFinite(Date.parse(d.observedAt)) && ['ready', 'blocked', 'unknown'].includes(d.status)) ||
        (v.report !== null && (!validReport(v.report) || identityKey(v.report.identity) !== identityKey(v.token.identity) || !sameOwner(v.report.owner, v.token.owner)))) throw fail('EINVALIDREPORT');
    return v;
  } finally { fs.closeSync(fd); }
}
function validateDirectory(root: string, fd: number): void {
  const path = join(root, 'readiness'), pinned = fs.fstatSync(fd), named = fs.lstatSync(path);
  if (fs.realpathSync(root) !== root || fs.realpathSync(path) !== path || named.isSymbolicLink() || pinned.dev !== named.dev || pinned.ino !== named.ino) throw fail('ESTALE');
}
function locked<T>(root: string, identity: ReadinessIdentity, body: (directoryFd: number, file: string) => T): T {
  if (!validIdentity(identity)) throw fail('EINVAL');
  const fd = directory(root, true), dir = fdPath(fd), file = join(dir, `${projectKey(identity.projectRoot)}.json`), lock = `${file}.lock`;
  let lockFd: number | undefined;
  try {
    // No unsafe stale-lock reclamation. A crashed writer requires explicit operator inspection.
    validateDirectory(root, fd);
    lockFd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    return body(fd, file);
  } finally {
    try {
      if (lockFd !== undefined) {
        const owned = fs.fstatSync(lockFd), current = fs.lstatSync(lock);
        if (current.isSymbolicLink() || owned.dev !== current.dev || owned.ino !== current.ino) throw fail('ESTALE');
        fs.unlinkSync(lock);
      }
    } finally { if (lockFd !== undefined) fs.closeSync(lockFd); fs.closeSync(fd); }
  }
}
function atomic(file: string, value: Envelope, directoryFd: number, root: string): void {
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > MAX_REPORT_BYTES) throw fail('EINVALIDREPORT');
  const tmp = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  let owned: { dev: number; ino: number } | undefined;
  let published = false;
  try {
    validateDirectory(root, directoryFd);
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const stat = fs.fstatSync(fd); owned = { dev: stat.dev, ino: stat.ino };
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    const current = fs.lstatSync(tmp);
    if (!current.isFile() || current.dev !== owned.dev || current.ino !== owned.ino) throw fail('ESTALE');
    validateDirectory(root, directoryFd);
    fs.renameSync(tmp, file); published = true; fs.fsyncSync(directoryFd);
  } catch (error) {
    // If post-rename durability confirmation fails, withdraw only our own report.
    if (published && owned) {
      try { const s = fs.lstatSync(file); if (s.dev === owned.dev && s.ino === owned.ino) fs.unlinkSync(file); }
      catch { /* The direct original failure still holds launch; no successful return. */ }
    }
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (owned && !published) {
      try { const s = fs.lstatSync(tmp); if (s.dev !== owned.dev || s.ino !== owned.ino || !s.isFile()) throw fail('ESTALE'); fs.unlinkSync(tmp); }
      catch (e) { if (safeErrno(e) !== 'ENOENT') throw e; }
    }
  }
}
/** Allocate before observing. Beginning a newer observation invalidates older publication tokens. */
export function beginReadiness(stateRoot: string, identity: ReadinessIdentity, owner: Omit<ObservationOwner, 'generation'>): ReadinessToken {
  if (!owner || !['invocationId', 'ownerId'].every(k => typeof owner[k as keyof typeof owner] === 'string' && owner[k as keyof typeof owner].length > 0 && owner[k as keyof typeof owner].length <= 4096 && !/[\x00-\x1f\x7f]/.test(owner[k as keyof typeof owner]))) throw fail('EINVAL');
  return locked(stateRoot, identity, (directoryFd, file) => {
    let prior: Envelope | undefined;
    try { prior = readEnvelope(file); } catch (e) { if (safeErrno(e) !== 'ENOENT' && safeErrno(e) !== 'EINVALIDREPORT' && !(e instanceof SyntaxError)) throw e; }
    const token: ReadinessToken = { identity, owner: { ...owner, generation: randomUUID() } };
    const diagnostics = [...(prior?.diagnostics ?? []), ...(prior?.report ? [{ observedAt: prior.report.observedAt, status: prior.report.status }] : [])].slice(-3);
    atomic(file, { version: 1, token, report: null, diagnostics }, directoryFd, stateRoot);
    return token;
  });
}
/** False means superseded, not saved. A thrown error must block launch and be reported directly. */
export function publishReadiness(stateRoot: string, token: ReadinessToken, report: ReadinessReport): boolean {
  if (!validReport(report) || identityKey(token.identity) !== identityKey(report.identity) || !sameOwner(token.owner, report.owner)) throw fail('EINVAL');
  return locked(stateRoot, token.identity, (directoryFd, file) => {
    const current = readEnvelope(file);
    if (identityKey(current.token.identity) !== identityKey(token.identity) || !sameOwner(current.token.owner, token.owner)) return false;
    atomic(file, { ...current, report }, directoryFd, stateRoot); return true;
  });
}
/** Missing, invalid, pending and stale are display states, never launch authorization. */
export function readReadiness(stateRoot: string, identity: ReadinessIdentity, now = Date.now(), maxAgeMs?: number): ReadinessRead {
  let fd: number | undefined;
  try {
    if (!validIdentity(identity)) throw fail('EINVAL');
    fd = directory(stateRoot, false);
    const envelope = readEnvelope(join(fdPath(fd), `${projectKey(identity.projectRoot)}.json`));
    if (!envelope.report) return { state: 'pending', reason: 'Current observation has not been published' };
    return { state: displayFreshness(envelope.report, identity, now, maxAgeMs), report: envelope.report };
  } catch (e) {
    const errno = safeErrno(e);
    return { state: errno === 'ENOENT' ? 'missing' : 'invalid', reason: 'Readiness report could not be established', errno };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
