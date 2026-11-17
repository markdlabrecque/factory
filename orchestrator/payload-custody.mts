// Source-owned normal payload journal: immutable, run-indexed creation/identity/absence/closed-handoff records.
// Only exact platform-observed close can close a payload. Interrupted creation/registration/control flow stays held.
import { randomUUID, createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdmissionIdentity, Owner } from '../board/admission.mts';
import { closeSandbox } from './sandbox-readiness.mts';
import { readBoundedText } from './ownership.mts';
import { existsSync } from 'node:fs';
const flat = existsSync(new URL('./admission.mts', import.meta.url));
const { durableDirectory, syncDirectory, ownerOf, keyFor, validAdmissionIdentity } = await import(flat ? './admission.mts' : '../board/admission.mts');
export interface PayloadPointer { version: 1; nonce: string }
export interface PayloadBinding {
  project: AdmissionIdentity; key: string; ticket: string; executionId: string; claim: string;
  runtime: { id: string; dependencies: string }; entry: string; lease: string; owner: Owner;
  baseline: string; ticketHash: string;
}
export type CustodyEvent = { kind: 'open'; binding: PayloadBinding } | { kind: 'pending'; id: string }
  | { kind: 'registered'; id: string; container: string } | { kind: 'absent'; id: string; container: string }
  | { kind: 'sealed' };
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(s);
const hash = (s: unknown) => createHash('sha256').update(JSON.stringify(s)).digest('hex');
const same = (a: unknown, b: unknown) => hash(a) === hash(b);
const fields = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === keys.sort().join();
function validBinding(b: PayloadBinding): boolean {
  return fields(b, ['project','key','ticket','executionId','claim','runtime','entry','lease','owner','baseline','ticketHash'])
    && validAdmissionIdentity(b.project) && b.project.tracker.host === b.project.tracker.host.toLowerCase()
    && typeof b.ticket === 'string' && b.key === keyFor(b.ticket, b.project.tracker.project) && /^\d+$/.test(b.ticket)
    && uuid(b.executionId) && uuid(b.claim) && b.executionId === b.claim && uuid(b.entry) && uuid(b.lease)
    && fields(b.runtime, ['id','dependencies']) && /^[a-f0-9]{64}$/.test(b.runtime.id) && /^[a-f0-9]{64}$/.test(b.runtime.dependencies)
    && Number.isSafeInteger(b.owner?.pid) && b.owner.pid > 0 && typeof b.owner.start === 'string' && !!b.owner.start
    && /^[a-f0-9]{40}$/.test(b.baseline) && /^[a-f0-9]{64}$/.test(b.ticketHash);
}
/** Cheap transition interpreter also used on every read. No stage, PID liveness or readiness fact is an event. */
export function custodyState(events: readonly CustodyEvent[]) {
  let binding: PayloadBinding | undefined, sealed = false;
  const payloads = new Map<string, { container?: string; absent: boolean }>();
  for (const event of events) {
    if (sealed) throw Error('Payload custody already sealed');
    if (event.kind === 'open') {
      if (binding || !fields(event,['kind','binding']) || !validBinding(event.binding)) throw Error('Invalid payload binding');
      binding = event.binding; continue;
    }
    if (!binding) throw Error('Payload custody missing open');
    if (event.kind === 'pending') {
      if (!fields(event,['kind','id']) || !uuid(event.id) || payloads.has(event.id)) throw Error('Invalid pending creation');
      payloads.set(event.id, { absent: false });
    } else if (event.kind === 'registered') {
      const p = payloads.get(event.id);
      if (!fields(event,['kind','id','container']) || !p || p.container || typeof event.container !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(event.container)
        || [...payloads.values()].some(v => v.container === event.container)) throw Error('Invalid exact payload registration');
      p.container = event.container;
    } else if (event.kind === 'absent') {
      const p = payloads.get(event.id);
      if (!fields(event,['kind','id','container']) || !p?.container || p.absent || p.container !== event.container) throw Error('Invalid exact payload absence');
      p.absent = true;
    } else if (event.kind === 'sealed') {
      if (!fields(event,['kind']) || !payloads.size || [...payloads.values()].some(p => !p.container || !p.absent)) throw Error('Unsettled payload creation/cleanup');
      sealed = true;
    } else throw Error('Unknown payload custody event');
  }
  return { binding, sealed, payloads };
}
function directory(state: string, pointer: PayloadPointer): string {
  if (!fields(pointer,['version','nonce']) || pointer.version !== 1 || !uuid(pointer.nonce)) throw Error('Unknown payload pointer');
  return join(state, 'payload-custody', pointer.nonce);
}
/** Private immutable files, exclusive publication and strict fsync. An interrupted or extra file holds, never repairs. */
export function beginPayloadCustody(state: string, binding: PayloadBinding) {
  if (!validBinding(binding) || !same(binding.owner,ownerOf(process.pid))) throw Error('Invalid source payload owner');
  const pointer: PayloadPointer = { version: 1, nonce: randomUUID() }, dir = directory(state,pointer);
  durableDirectory(dir);
  const events: CustodyEvent[] = [];
  const append = (event: CustodyEvent) => {
    custodyState([...events,event]);
    const fd = openSync(join(dir, `${String(events.length).padStart(6,'0')}.json`),'wx',0o600);
    try { writeFileSync(fd,JSON.stringify({version:1,nonce:pointer.nonce,previous:hash(events),event})); fsyncSync(fd); }
    finally { closeSync(fd); }
    syncDirectory(dir); events.push(structuredClone(event));
  };
  append({kind:'open',binding:structuredClone(binding)});
  return {
    pointer,
    pendingCreation() { const id = randomUUID(); append({kind:'pending',id}); return id; },
    register(id: string, sandbox: {sandboxId?: string}) {
      if (!sandbox.sandboxId) throw Error('Unknown actual sandbox identity');
      append({kind:'registered',id,container:sandbox.sandboxId});
    },
    async close(id: string, sandbox: {sandboxId?: string; close(): Promise<unknown>}) {
      const p = custodyState(events).payloads.get(id);
      if (!p?.container || p.container !== sandbox.sandboxId) throw Error('Payload identity changed before close');
      const result = await closeSandbox(sandbox);
      if (result.confirmed) append({kind:'absent',id,container:p.container});
      return result;
    },
    // Called only after the actual main normal scope (including delivery) has unwound; no more launch handoffs exist.
    finish() { append({kind:'sealed'}); },
  };
}
export function readPayloadCustody(state: string, pointer: PayloadPointer) {
  const dir = directory(state,pointer), names = readdirSync(dir).sort();
  if (!names.length || names.length > 4096) throw Error('Unknown payload event inventory');
  const events: CustodyEvent[] = [];
  names.forEach((name,i) => {
    if (name !== `${String(i).padStart(6,'0')}.json`) throw Error('Incomplete payload event inventory');
    const row = JSON.parse(readBoundedText(join(dir,name),64*1024,'private payload custody'));
    if (!fields(row,['version','nonce','previous','event']) || row.version !== 1 || row.nonce !== pointer.nonce || row.previous !== hash(events)) throw Error('Invalid payload event chain');
    events.push(row.event);
  });
  return custodyState(events);
}
/** Exact current modern saved run only. Recovery/delivery/new claims never inherit an earlier normal closure. */
export function payloadRunClosed(state: string, run: any, expected: { project: AdmissionIdentity; key: string; executionId: string; runtime: {id:string;dependencies:string} }): boolean {
  try {
    if (run.project !== expected.project.tracker.project || run.iid !== expected.key.split('--').at(-1)
      || run.executionId !== expected.executionId || run.starting !== undefined && run.starting !== false
      || run.recovery !== undefined || run.delivery !== undefined
      || !['stopped','waiting','done'].includes(run.stage) || !Number.isSafeInteger(run.pid) || run.pid <= 0
      || !['startedAt','updatedAt','stageSince'].every(k => typeof run[k] === 'string' && Number.isFinite(Date.parse(run[k])))) return false;
    const c = readPayloadCustody(state,run.payloadCustody), b = c.binding;
    return c.sealed && !!b && same(b.project,expected.project) && b.key === expected.key && b.executionId === run.executionId
      && b.claim === run.claim && same(b.runtime,expected.runtime) && b.baseline === run.implementationBaseSha && b.ticketHash === run.ticketHash;
  } catch { return false; }
}
