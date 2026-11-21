// Active static admission reads the host's current preparation pointer and rehashed custody originals.
// It never approves, publishes, executes probes, reserves capacity or treats static validity as baseline authority.
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { acceptanceHash } from './acceptance-contract.mts';
import { readAcceptanceBundle, type FrozenAcceptanceBundle } from './acceptance-custody.mts';
import { frozenTicketIdentity, type FrozenTicketInput } from './ticket-input.mts';
import type { ReadinessCheck } from './readiness-schema.mts';

export class AcceptanceAdmissionHold extends Error {
  readonly code = 'acceptance-static';
  readonly reason: 'missing-preparation' | 'invalid-preparation' | 'changed-input' | 'custody-unavailable';
  constructor(reason: AcceptanceAdmissionHold['reason']) {
    super(`Acceptance static hold: ${reason}. Preparer/reviewer must publish a current independently approved frozen bundle for the complete child and parent input; preserve saved work and charges.`);
    this.reason = reason;
  }
}
/** Host preparation records are private, bounded JSON, never ticket/candidate declarations.
 * A preparer publishes {version:1,bundle,ticket,acceptance,approvalDigest} only AFTER the custody
 * API has authenticated approval and frozen originals. Removing/replacing this current reference
 * revokes old preparation; launch never manufactures, renews or repairs it.
 * This is an active launch read: the custody API also confirms durable originals with fsync.
 */
export function readPreparedAcceptance(stateRoot: string, agentMounts: readonly string[], input: FrozenTicketInput): FrozenAcceptanceBundle {
  let identity: ReturnType<typeof frozenTicketIdentity>;
  try { identity = frozenTicketIdentity(input); } catch { throw new AcceptanceAdmissionHold('changed-input'); }
  const root = join(stateRoot, 'acceptance');
  const path = join(root, `prepared-${identity.contentHash}.json`);
  let record: any;
  let reference: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
  try {
    if (realpathSync(root) !== root) throw Error('aliased store');
    const directory = lstatSync(root);
    if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) throw Error('unsafe store');
    const before = lstatSync(path);
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0 || before.size > 4096) throw Error('unsafe record');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const st = fstatSync(fd), bytes = Buffer.alloc(4097);
      const n = readSync(fd, bytes, 0, bytes.length, 0), after = fstatSync(fd), named = lstatSync(path);
      if (!st.isFile() || st.nlink !== 1 || st.dev !== before.dev || st.ino !== before.ino || n !== st.size || n > 4096
        || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs || named.dev !== st.dev || named.ino !== st.ino) throw Error('changed record');
      record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, n)));
      reference = { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs };
    } finally { closeSync(fd); }
    if (!record || record.version !== 1 || Object.keys(record).sort().join() !== 'acceptance,approvalDigest,bundle,ticket,version') throw Error('invalid record');
  } catch (e) {
    throw new AcceptanceAdmissionHold((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-preparation' : 'invalid-preparation');
  }
  if (record.ticket?.contentHash !== identity.contentHash) throw new AcceptanceAdmissionHold('changed-input');
  let bundle: FrozenAcceptanceBundle;
  try { bundle = readAcceptanceBundle(root, agentMounts, record.bundle); }
  catch { throw new AcceptanceAdmissionHold('custody-unavailable'); }
  // Collection timestamps are not requirements. Compare freshly collected source bytes by
  // content hash, then use the ORIGINAL approved rendering, including its collection metadata.
  // Never rebind an old approval to a newly rendered snapshot.
  if (bundle.manifest.ticket.contentHash !== identity.contentHash
    || acceptanceHash(bundle.manifest.ticket) !== acceptanceHash(record.ticket)
    || acceptanceHash(record.acceptance) !== acceptanceHash(bundle.manifest.acceptance)
    || record.approvalDigest !== bundle.manifest.approvalDigest) throw new AcceptanceAdmissionHold('changed-input');
  try {
    const current = lstatSync(path);
    if (realpathSync(root) !== root || !current.isFile() || current.nlink !== 1 || current.uid !== process.getuid?.() || (current.mode & 0o077) !== 0
      || Object.entries(reference!).some(([key, value]) => current[key as keyof typeof reference] !== value)) throw Error('changed reference');
  } catch { throw new AcceptanceAdmissionHold('changed-input'); }
  return bundle;
}
/** Safe display observation only. No reader of this check can acquire authority or run a probe. */
export function acceptanceStaticCheck(input: FrozenTicketInput, hold?: AcceptanceAdmissionHold, observedAt = new Date().toISOString()): ReadinessCheck {
  const iid = input.context.child.iid;
  return { id: `acceptance-static-${iid}`, ticket: String(iid), scope: 'ticket-input', phase: 'active', observedAt,
    status: hold ? 'blocked' : 'ready', required: true, operation: 'validate-prepared-acceptance', path: input.context.child.url,
    reason: hold ? `Acceptance static: ${hold.reason}` : 'Current frozen acceptance and exact preparation approval validated; baseline admission is separate',
    nextActor: hold ? 'operator' : 'none', nextAction: hold ? 'Preparer/reviewer: independently review and freeze complete acceptance, then explicitly publish its current host preparation reference. Preserve work and budgets.' : 'Static validation only; this observation grants no implementation authority',
    automaticRecheck: 'next-launch' };
}
