// Host-only acceptance originals: bounded digest-pinned preparation, exclusive sealed publication,
// exact ticket/review binding, rehashed resume reads and private independent-runner copies. No execution/admission.
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { acceptanceHash, canonicalAcceptanceJSON, checkAcceptanceApproval, validateAcceptanceContract, type AcceptanceContract, type AcceptanceIdentity, type ApprovalRecord } from './acceptance-contract.mts';
import { frozenTicketIdentity, type FrozenTicketInput } from './ticket-input.mts';

export const ACCEPTANCE_CUSTODY_LIMITS = Object.freeze({ artifactBytes: 1024 * 1024, artifactCount: 256, totalArtifactBytes: 16 * 1024 * 1024, ticketBytes: 8 * 1024 * 1024, recordBytes: 1024 * 1024 });
export interface TicketAcceptanceIdentity { contentHash: string; renderedSha256: string }
/** Authenticated host review must cover BOTH the frozen requirements and exact contract/artifact identity.
 * Never implement this with tracker declarations, candidate files or a checksum-only self-approval. */
export interface TrustedCustodyApprovalIngress {
  lookup(binding: Readonly<{ ticket: TicketAcceptanceIdentity; acceptance: AcceptanceIdentity }>): unknown;
}
export interface AcceptanceBundlePointer { version: 1; id: string }
export interface AcceptanceBytes { path: string; bytes: Uint8Array }
interface StoredFile { name: string; sha256: string; size: number }
export interface AcceptanceBundleManifest {
  version: 1; ticket: TicketAcceptanceIdentity; acceptance: AcceptanceIdentity; approvalDigest: string;
  criteriaDigest: string; files: StoredFile[];
}
export interface FrozenAcceptanceBundle {
  pointer: AcceptanceBundlePointer; manifest: AcceptanceBundleManifest; contract: AcceptanceContract;
  approval: ApprovalRecord; ticket: FrozenTicketInput; artifacts: AcceptanceBytes[];
}
export class AcceptanceCustodyHold extends Error {
  readonly code = 'acceptance-custody';
  readonly nextActor = 'preparer-or-reviewer';
  constructor(reason: string) { super(`Acceptance custody hold: ${reason}; retain originals and investigate, never replace a running bundle`); }
}
const need = (ok: unknown, reason: string): void => { if (!ok) throw new AcceptanceCustodyHold(reason); };
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const same = (a: unknown, b: unknown) => acceptanceHash(a) === acceptanceHash(b);
const digest = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const beneath = (a: string, b: string) => { const r = relative(a, b); return !r || r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r); };
const safePath = (p: string) => typeof p === 'string' && p.length <= 1024 && !p.includes('\\') && !p.includes(':') && !p.includes('\0') && p.split('/').every(s => !!s && s !== '.' && s !== '..');
function guarded<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof AcceptanceCustodyHold) throw e; throw new AcceptanceCustodyHold('missing, unsafe, partial or unavailable original'); }
}
/** Reject aliases in every existing ancestor; private roots must already exist and be host-owned. */
function directory(path: string, privateRoot = false): string {
  need(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path, 'noncanonical directory');
  let p = path;
  for (;;) {
    const st = lstatSync(p); need(st.isDirectory() && !st.isSymbolicLink(), 'unsafe directory ancestor');
    if (p === dirname(p)) break;
    p = dirname(p);
  }
  const st = lstatSync(path);
  if (privateRoot) need(st.uid === process.getuid?.() && (st.mode & 0o077) === 0, 'store/copy root must be private and host-owned');
  return path;
}
/** The trusted caller must enumerate EVERY agent mount, including code/runtime/evidence and aliases.
 * Future mounts must repeat this check before exposing any path. No agent may mount an ancestor of the store. */
function isolated(root: string, agentMounts: readonly string[]): string {
  directory(root, true);
  need(Array.isArray(agentMounts), 'explicit complete agent mount inventory required');
  for (const mount of agentMounts) {
    need(isAbsolute(mount) && resolve(mount) === mount && realpathSync(mount) === mount, 'noncanonical mount');
    directory(dirname(mount));
    const st = lstatSync(mount); need(st.isDirectory() || st.isFile() && st.nlink === 1, 'unsafe mount');
    need(!beneath(root, mount) && !beneath(mount, root), 'acceptance custody overlaps an agent mount');
  }
  return root;
}
function syncDir(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function writeExclusive(path: string, bytes: Uint8Array | string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function readBounded(path: string, max: number, privateFile: boolean): Buffer {
  directory(dirname(path));
  const before = lstatSync(path);
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= max, 'unsafe or oversized artifact');
  if (privateFile) need(before.uid === process.getuid?.() && (before.mode & 0o077) === 0, 'nonprivate original');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    need(st.isFile() && st.nlink === 1 && st.dev === before.dev && st.ino === before.ino && st.size === before.size, 'replaced original');
    // Bounded descriptor read even if a file grows after stat.
    const bytes = Buffer.alloc(max + 1);
    const count = readFileBounded(fd, bytes);
    const after = fstatSync(fd), name = lstatSync(path);
    need(count <= max && count === st.size && st.size === after.size && st.mtimeMs === after.mtimeMs && st.ctimeMs === after.ctimeMs
      && name.dev === st.dev && name.ino === st.ino && name.nlink === 1, 'unstable or oversized original');
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
// readFileSync(fd) can allocate without a ceiling after a concurrent append.
function readFileBounded(fd: number, bytes: Buffer): number {
  let count = 0, n: number;
  while (count < bytes.length && (n = readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += n;
  return count;
}
function inventory(contract: AcceptanceContract): { path: string; sha256: string }[] {
  const byPath = new Map<string, string>();
  for (const a of [...contract.probes.flatMap(p => p.bundle), ...contract.fixtures]) {
    need(safePath(a.path), 'unsafe artifact path');
    need(!byPath.has(a.path) || byPath.get(a.path) === a.sha256, 'conflicting artifact path identities');
    need(![...byPath.keys()].some(p => p.startsWith(a.path + '/') || a.path.startsWith(p + '/')), 'artifact file/directory collision');
    byPath.set(a.path, a.sha256);
  }
  need(byPath.size <= ACCEPTANCE_CUSTODY_LIMITS.artifactCount, 'artifact inventory limit');
  return [...byPath].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, sha256]) => ({ path, sha256 }));
}
function checkedBytes(contract: AcceptanceContract, supplied: readonly AcceptanceBytes[]): AcceptanceBytes[] {
  const expected = inventory(contract);
  need(Array.isArray(supplied) && supplied.length === expected.length && new Set(supplied.map(a => a.path)).size === supplied.length, 'missing/extra/duplicate artifacts');
  let total = 0;
  return expected.map(a => {
    const input = supplied.find(x => x.path === a.path);
    need(input?.bytes instanceof Uint8Array && input.bytes.byteLength <= ACCEPTANCE_CUSTODY_LIMITS.artifactBytes, 'missing or oversized artifact bytes');
    const bytes = Buffer.from(input!.bytes); total += bytes.length;
    need(total <= ACCEPTANCE_CUSTODY_LIMITS.totalArtifactBytes && sha(bytes) === a.sha256, 'artifact bytes differ from reviewed digest or aggregate limit');
    return { path: a.path, bytes };
  });
}
/** Optional local resolver. Only exact reviewed SHA-256 bytes are accepted: no URLs, moving refs,
 * shell, Git fetch or remote instructions. Symlinks, hard links and traversal refuse. */
export function resolveAcceptanceArtifacts(root: string, value: unknown): AcceptanceBytes[] {
  return guarded(() => {
    directory(root);
    const parsed = validateAcceptanceContract(value); need(parsed.status === 'valid', 'invalid contract');
    if (parsed.status !== 'valid') throw new AcceptanceCustodyHold('invalid contract');
    const entries = inventory(parsed.value);
    // Count/size bounds apply before reading the complete inventory.
    let total = 0;
    const bytes = entries.map(a => {
      const path = join(root, a.path); need(beneath(root, path), 'artifact traversal');
      const bytes = readBounded(path, ACCEPTANCE_CUSTODY_LIMITS.artifactBytes, false); total += bytes.length;
      need(total <= ACCEPTANCE_CUSTODY_LIMITS.totalArtifactBytes, 'aggregate artifact limit');
      return { path: a.path, bytes };
    });
    return checkedBytes(parsed.value, bytes);
  });
}
function records(ticket: FrozenTicketInput, contract: AcceptanceContract, approval: ApprovalRecord, artifacts: AcceptanceBytes[]) {
  const ticketBytes = Buffer.from(JSON.stringify(ticket));
  need(ticketBytes.length <= ACCEPTANCE_CUSTODY_LIMITS.ticketBytes, 'ticket byte limit');
  return [
    { name: 'ticket.json', bytes: ticketBytes },
    { name: 'contract.json', bytes: Buffer.from(canonicalAcceptanceJSON(contract)) },
    { name: 'approval.json', bytes: Buffer.from(canonicalAcceptanceJSON(approval)) },
    ...artifacts.map((a, i) => ({ name: `artifact-${String(i).padStart(3, '0')}`, bytes: Buffer.from(a.bytes) })),
  ];
}
function publish(dir: string, root: string, files: { name: string; bytes: Buffer }[], manifest: AcceptanceBundleManifest): void {
  // mkdir is the exclusive reservation. Partial/unknown directories are NEVER overwritten or removed.
  mkdirSync(dir, { mode: 0o700 }); syncDir(root);
  for (const f of files) writeExclusive(join(dir, f.name), f.bytes);
  writeExclusive(join(dir, 'manifest.json'), canonicalAcceptanceJSON(manifest));
  syncDir(dir);
  // A completed marker becomes visible atomically. A crash at any cutpoint holds unless the
  // complete exact inventory and all hashes validate; leftover marker.partial is retained.
  writeExclusive(join(dir, 'marker.partial'), canonicalAcceptanceJSON({ version: 1, id: acceptanceHash(manifest) }));
  linkSync(join(dir, 'marker.partial'), join(dir, 'sealed.json'));
  unlinkSync(join(dir, 'marker.partial')); syncDir(dir); syncDir(root);
}
export interface AcceptancePreparation {
  ticket: FrozenTicketInput; contract: unknown; artifacts: readonly AcceptanceBytes[]; approvals: TrustedCustodyApprovalIngress;
}
/** Pure bounded preparation. Only authenticated host ingress can supply approval; the returned
 * bytes are host-private, not a candidate-facing payload or execution authorization. */
export function prepareAcceptanceBundle(options: AcceptancePreparation): { pointer: AcceptanceBundlePointer; manifest: AcceptanceBundleManifest; files: { name: string; bytes: Buffer }[] } {
  return guarded(() => {
    // Snapshot input before calling trusted ingress, so caller aliases cannot alter reviewed content.
    const ticketJSON = JSON.stringify(options.ticket);
    need(Buffer.byteLength(ticketJSON) <= ACCEPTANCE_CUSTODY_LIMITS.ticketBytes, 'ticket byte limit');
    const ticket = JSON.parse(ticketJSON) as FrozenTicketInput;
    const ticketIdentity = frozenTicketIdentity(ticket);
    const approved = checkAcceptanceApproval(options.contract, { lookup: acceptance => options.approvals.lookup(Object.freeze({ ticket: Object.freeze({ ...ticketIdentity }), acceptance })) });
    need(approved.status === 'valid', 'missing or untrusted exact-content approval');
    if (approved.status !== 'valid') throw new AcceptanceCustodyHold('unapproved');
    const { contract, identity, approval } = approved.value;
    const artifacts = checkedBytes(contract, options.artifacts), files = records(ticket, contract, approval, artifacts);
    const manifest: AcceptanceBundleManifest = { version: 1, ticket: ticketIdentity, acceptance: identity,
      approvalDigest: acceptanceHash(approval), criteriaDigest: acceptanceHash(contract.criteria),
      files: files.map(f => ({ name: f.name, size: f.bytes.length, sha256: sha(f.bytes) })) };
    return { pointer: { version: 1, id: acceptanceHash(manifest) }, manifest, files };
  });
}
/** Exclusive publication grants no runner/implementation admission. Always reprepare from trusted
 * ingress; arbitrary caller-assembled prepared records cannot be published through this API. */
export function freezeAcceptanceBundle(options: AcceptancePreparation & { root: string; agentMounts: readonly string[] }): AcceptanceBundlePointer {
  return guarded(() => {
    const root = isolated(options.root, options.agentMounts);
    const { pointer, manifest, files } = prepareAcceptanceBundle(options), dir = join(root, pointer.id);
    try { publish(dir, root, files, manifest); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    // A racing publisher only reuses a complete identical original. It never repairs a partial one.
    readAcceptanceBundle(root, options.agentMounts, pointer);
    return pointer;
  });
}
/** Resume/repair uses the saved pointer, not a fresh tracker lookup/freeze. No replacement,
 * historical deletion, automatic repair or approval substitution exists on this read path. */
export function readAcceptanceBundle(root: string, agentMounts: readonly string[], pointer: AcceptanceBundlePointer): FrozenAcceptanceBundle {
  return guarded(() => {
    isolated(root, agentMounts);
    need(pointer?.version === 1 && digest(pointer.id) && Object.keys(pointer).sort().join() === 'id,version', 'invalid bundle pointer');
    const dir = join(root, pointer.id); directory(dir, true);
    const readJSON = (name: string, max = ACCEPTANCE_CUSTODY_LIMITS.recordBytes) => {
      const text = readBounded(join(dir, name), max, true).toString('utf8'), value = JSON.parse(text);
      need(text === canonicalAcceptanceJSON(value), 'noncanonical custody record'); return value;
    };
    const seal = readJSON('sealed.json'); need(same(seal, pointer), 'missing or mismatched seal');
    const manifest = readJSON('manifest.json') as AcceptanceBundleManifest;
    need(acceptanceHash(manifest) === pointer.id && manifest.version === 1 && Array.isArray(manifest.files) && manifest.files.length <= ACCEPTANCE_CUSTODY_LIMITS.artifactCount + 3, 'manifest identity mismatch');
    const names = ['sealed.json', 'manifest.json', ...manifest.files.map(f => f.name)].sort();
    need(new Set(names).size === names.length && readdirSync(dir).sort().join('\0') === names.join('\0'), 'partial or unknown custody inventory');
    need(manifest.files.slice(3).every(f => Number.isSafeInteger(f.size) && f.size >= 0 && f.size <= ACCEPTANCE_CUSTODY_LIMITS.artifactBytes)
      && manifest.files.slice(3).reduce((n, f) => n + f.size, 0) <= ACCEPTANCE_CUSTODY_LIMITS.totalArtifactBytes, 'stored aggregate artifact limit');
    const contents = manifest.files.map((f, i) => {
      const name = i < 3 ? ['ticket.json', 'contract.json', 'approval.json'][i] : `artifact-${String(i - 3).padStart(3, '0')}`;
      need(f.name === name && Number.isSafeInteger(f.size) && f.size >= 0 && digest(f.sha256), 'unsafe record inventory');
      const bytes = readBounded(join(dir, name), i === 0 ? ACCEPTANCE_CUSTODY_LIMITS.ticketBytes : ACCEPTANCE_CUSTODY_LIMITS.recordBytes, true);
      need(bytes.length === f.size && sha(bytes) === f.sha256, 'original hash mismatch'); return bytes;
    });
    const ticket = JSON.parse(contents[0].toString()) as FrozenTicketInput;
    need(same(frozenTicketIdentity(ticket), manifest.ticket), 'frozen requirements changed');
    const approval = JSON.parse(contents[2].toString()) as ApprovalRecord;
    const approved = checkAcceptanceApproval(JSON.parse(contents[1].toString()), { lookup: () => approval });
    need(approved.status === 'valid', 'stored review binding mismatch');
    if (approved.status !== 'valid') throw new AcceptanceCustodyHold('stored review invalid');
    const { contract, identity } = approved.value;
    need(same(identity, manifest.acceptance) && acceptanceHash(approval) === manifest.approvalDigest && acceptanceHash(contract.criteria) === manifest.criteriaDigest, 'inventory or approval identity changed');
    const artifacts = checkedBytes(contract, inventory(contract).map((a, i) => ({ path: a.path, bytes: contents[i + 3] })));
    need(contents.length === artifacts.length + 3, 'artifact count mismatch');
    // Establish durable observed names even after a publisher lost its final fsync acknowledgement.
    syncDir(dir); syncDir(root);
    return { pointer: { ...pointer }, manifest, contract, approval, ticket, artifacts };
  });
}
/** Only the independent runner's trusted host may call this. The new private directory must
 * stay outside ALL implementer mounts; the runner may mount this copy, NEVER the originals.
 * Returned digest-pinned bytes/expected results cannot be supplied by candidate code. */
export function copyAcceptanceForRunner(root: string, agentMounts: readonly string[], pointer: AcceptanceBundlePointer, destination: string): string {
  return guarded(() => {
    const bundle = readAcceptanceBundle(root, agentMounts, pointer);
    const parent = directory(dirname(destination), true);
    need(isAbsolute(destination) && resolve(destination) === destination && !beneath(root, destination) && !beneath(destination, root), 'runner copy overlaps originals');
    isolated(parent, agentMounts);
    mkdirSync(destination, { mode: 0o700 }); syncDir(parent);
    for (const a of bundle.artifacts) {
      const target = join(destination, a.path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeExclusive(target, a.bytes);
      let parent = dirname(target);
      while (parent !== destination) { syncDir(parent); parent = dirname(parent); }
    }
    // The runner receives the contract from the host read API, not candidate files;
    // no metadata pathname can collide with arbitrary reviewed artifact paths.
    syncDir(destination);
    readAcceptanceBundle(root, agentMounts, pointer);
    return destination;
  });
}
