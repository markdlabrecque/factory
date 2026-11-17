// Runtime descriptors and leases use locked atomic metadata writes outside the immutable store.
// PID/start transactions fence install/uninstall; protected v2 advisory pins survive owner death until exact durable terminal evidence.
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
// The same helper ships flat in a runtime; source CLI callers use the source Board module.
const { ownerOf, ownerState, withAdmissionLock, writeDurable } = await import(existsSync(new URL('./admission.mts', import.meta.url)) ? './admission.mts' : '../../board/admission.mts');
import type { Owner } from '../../board/admission.mts';
import { validateRuntimeBundle } from './runtime-bundle.mts';
import type { Paths } from './paths.mts';
import type { ProjectIdentity } from '../../orchestrator/supervisor-contract.mts';

export type RuntimeDescriptor = { version: 1; id: string };
export type RuntimeLease = { version: 1; token: string; id: string; owner: Owner };
const idPattern = /^[a-f0-9]{64}$/;
const tokenPattern = /^[a-f0-9-]{36}$/;
// Stage outside the store so interrupted durable writes never become unowned store entries.
function writeRuntimeMetadata(p: Paths, target: string, text: string): void {
  const staging = join(p.data, 'runtime-ownership', 'metadata');
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  if (!lstatSync(staging).isDirectory() || lstatSync(staging).isSymbolicLink()) throw new Error('Invalid runtime metadata staging directory');
  // All metadata writers hold withRuntimeLock, so earlier staged writes cannot still be active.
  for (const name of readdirSync(staging)) {
    if (!/^[a-f0-9-]{36}(?:\.\d+\.[a-f0-9]{8}\.tmp)?$/.test(name)) throw new Error('Unknown runtime metadata staging entry');
    const path = join(staging, name);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unknown runtime metadata staging entry');
    rmSync(path);
  }
  const temporary = join(staging, randomUUID());
  try {
    writeDurable(temporary, text);
    renameSync(temporary, target);
    try { const fd = openSync(dirname(target), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
    catch { /* Directory fsync is unavailable on some supported filesystems. */ }
  } finally { rmSync(temporary, { force: true }); }
}
const leaseDir = (p: Paths) => join(p.runtimes, '.leases');
const ownedFile = (p: Paths) => join(p.runtimes, '.owned.json');
const removingFile = (p: Paths) => join(p.runtimes, '.removing.json');
export function assertRuntimeAvailable(p: Paths): void {
  const path = removingFile(p);
  if (!existsSync(path)) return;
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unknown runtime removal ownership');
  const owner = JSON.parse(readFileSync(path, 'utf8'));
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0 || (owner.start !== undefined && typeof owner.start !== 'string') || ownerState(owner) !== 'dead') throw new Error('Runtime store removal has live or unknown owner');
  rmSync(path);
}
export function markRuntimeRemoving(p: Paths): void {
  assertRuntimeAvailable(p);
  preflightRuntimeRemoval(p);
  if (existsSync(p.runtimes)) writeRuntimeMetadata(p, removingFile(p), JSON.stringify(ownerOf(process.pid)) + '\n');
}
export function clearRuntimeRemoving(p: Paths): void { rmSync(removingFile(p), { force: true }); }
type Preparation = { id: string; temporary: string; owner: Owner };
type Ledger = { version: 1; ids: string[]; preparations: Preparation[] };
const temporaryPattern = /^\.runtime-[a-f0-9-]{36}$/;
function ledger(p: Paths): Ledger {
  if (!existsSync(ownedFile(p))) return { version: 1, ids: [], preparations: [] };
  const stat = lstatSync(ownedFile(p));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unknown runtime ownership ledger');
  const data = JSON.parse(readFileSync(ownedFile(p), 'utf8'));
  if (!data || data.version !== 1 || !Array.isArray(data.ids) || !data.ids.every((id: unknown) => typeof id === 'string' && idPattern.test(id)) || new Set(data.ids).size !== data.ids.length) throw new Error('Unknown runtime ownership ledger');
  data.preparations ??= [];
  if (!Array.isArray(data.preparations) || !data.preparations.every((x: any) => x && idPattern.test(x.id) && data.ids.includes(x.id) && temporaryPattern.test(x.temporary) && x.owner && Number.isInteger(x.owner.pid) && x.owner.pid > 0 && (x.owner.start === undefined || typeof x.owner.start === 'string'))) throw new Error('Unknown runtime preparation ownership');
  return data;
}
const ownedIds = (p: Paths) => ledger(p).ids;
export function runtimeOwned(p: Paths, id: string): boolean { return ownedIds(p).includes(id); }
export function recordRuntimeOwnership(p: Paths, id: string): void {
  if (!idPattern.test(id)) throw new Error('Invalid runtime ownership identity');
  const data = ledger(p);
  if (!data.ids.includes(id)) data.ids.push(id);
  data.ids.sort();
  writeRuntimeMetadata(p, ownedFile(p), JSON.stringify(data) + '\n');
}
/** Called under the runtime lock before the builder creates any directory. */
export function reserveRuntimePreparation(p: Paths, plan: { id: string; temporary: string }): void {
  if (!idPattern.test(plan.id) || !temporaryPattern.test(plan.temporary)) throw new Error('Invalid runtime preparation');
  const data = ledger(p);
  if (!data.ids.includes(plan.id)) data.ids.push(plan.id);
  data.ids.sort();
  data.preparations.push({ ...plan, owner: ownerOf(process.pid) });
  writeRuntimeMetadata(p, ownedFile(p), JSON.stringify(data) + '\n');
}
/** Only confirmed-dead preparations are removed. No age-based reclamation or adoption. */
export function recoverRuntimePreparations(p: Paths): void {
  assertRuntimeStore(p);
  const data = ledger(p), keep: Preparation[] = [];
  for (const preparation of data.preparations) {
    const path = join(p.runtimes, preparation.temporary);
    if (!existsSync(path)) continue;
    if (ownerState(preparation.owner) !== 'dead') { keep.push(preparation); continue; }
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('Unknown runtime preparation ownership');
    rmSync(path, { recursive: true });
  }
  data.preparations = keep;
  writeRuntimeMetadata(p, ownedFile(p), JSON.stringify(data) + '\n');
}
const leasePath = (p: Paths, token: string) => join(leaseDir(p), `${token}.json`);
export const withRuntimeLock = <T,>(p: Paths, fn: () => T) => withAdmissionLock(join(p.data, 'runtime-ownership'), fn);
/** Fence the complete async install/uninstall operation, including service awaits. Contenders fail closed. */
export async function withRuntimeTransaction<T>(p: Paths, fn: () => Promise<T>): Promise<T> {
  const path = join(p.data, 'runtime-ownership', 'transaction.json'), token = randomUUID();
  withRuntimeLock(p, () => {
    if (existsSync(path)) {
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unknown runtime transaction ownership');
      const previous = JSON.parse(readFileSync(path, 'utf8'));
      if (!previous || previous.version !== 1 || !tokenPattern.test(previous.token) || !previous.owner || !Number.isInteger(previous.owner.pid) || previous.owner.pid <= 0 || (previous.owner.start !== undefined && typeof previous.owner.start !== 'string')) throw new Error('Unknown runtime transaction ownership');
      if (ownerState(previous.owner) !== 'dead') throw new Error('Runtime install/uninstall transaction has live or unknown owner');
    }
    writeRuntimeMetadata(p, path, JSON.stringify({ version: 1, token, owner: ownerOf(process.pid) }) + '\n');
  });
  try { return await fn(); }
  finally {
    withRuntimeLock(p, () => {
      if (JSON.parse(readFileSync(path, 'utf8')).token !== token) throw new Error('Runtime transaction ownership changed');
      rmSync(path);
    });
  }
}
function validLease(x: any): x is RuntimeLease {
  return x && x.version === 1 && idPattern.test(x.id) && tokenPattern.test(x.token) && x.owner && Number.isInteger(x.owner.pid) && x.owner.pid > 0 && (x.owner.start === undefined || (typeof x.owner.start === 'string' && x.owner.start.length > 0));
}
function readLease(p: Paths, token: string): RuntimeLease {
  if (!tokenPattern.test(token)) throw new Error('Invalid runtime lease token');
  const dir = lstatSync(leaseDir(p));
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Invalid runtime lease directory');
  const path = leasePath(p, token);
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Invalid runtime lease');
  const lease = JSON.parse(readFileSync(path, 'utf8'));
  if (!validLease(lease) || lease.token !== token) throw new Error('Invalid runtime lease');
  return lease;
}
function assertRuntimeStore(p: Paths): void {
  const stat = lstatSync(p.runtimes);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unknown ownership of runtime store');
}
export function readRuntimeDescriptor(p: Paths): RuntimeDescriptor {
  assertRuntimeStore(p);
  if (!lstatSync(p.runtimeDescriptor).isFile() || lstatSync(p.runtimeDescriptor).isSymbolicLink()) throw new Error('Invalid runtime descriptor');
  const d = JSON.parse(readFileSync(p.runtimeDescriptor, 'utf8'));
  if (!d || d.version !== 1 || typeof d.id !== 'string' || !idPattern.test(d.id)) throw new Error('Invalid runtime descriptor');
  if (validateRuntimeBundle(join(p.runtimes, d.id)).id !== d.id) throw new Error('Runtime descriptor identity mismatch');
  return d;
}
export function writeRuntimeDescriptor(p: Paths, id: string): void {
  if (!idPattern.test(id) || validateRuntimeBundle(join(p.runtimes, id)).id !== id) throw new Error('Invalid runtime identity');
  writeRuntimeMetadata(p, p.runtimeDescriptor, JSON.stringify({ version: 1, id }) + '\n');
}
/** Callers retain the returned token as the authority to transfer or release this lease. */
export function acquireRuntimeLease(p: Paths, id: string, owner: Owner = ownerOf(process.pid)): RuntimeLease {
  return withRuntimeLock(p, () => {
    assertRuntimeAvailable(p);
    assertRuntimeStore(p);
    if (!idPattern.test(id) || !ownedIds(p).includes(id) || validateRuntimeBundle(join(p.runtimes, id)).id !== id) throw new Error('Invalid runtime identity');
    const lease: RuntimeLease = { version: 1, token: randomUUID(), id, owner };
    if (!validLease(lease) || ownerState(owner) !== 'alive') throw new Error('Runtime lease owner must be identifiable and alive');
    mkdirSync(leaseDir(p), { recursive: true, mode: 0o700 });
    const stat = lstatSync(leaseDir(p));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unknown runtime lease ownership');
    writeRuntimeMetadata(p, leasePath(p, lease.token), JSON.stringify(lease) + '\n');
    return lease;
  });
}
export function transferRuntimeLease(p: Paths, token: string, owner: Owner, expectedId?: string): RuntimeLease {
  return withRuntimeLock(p, () => {
    assertRuntimeStore(p);
    const lease = readLease(p, token);
    if (expectedId !== undefined && lease.id !== expectedId) throw new Error('Runtime lease identity mismatch');
    if (ownerState(lease.owner) !== 'alive' || ownerState(owner) !== 'alive') throw new Error('Runtime lease owner is not confirmed alive');
    lease.owner = owner;
    writeRuntimeMetadata(p, leasePath(p, token), JSON.stringify(lease) + '\n');
    return lease;
  });
}
export function releaseRuntimeLease(p: Paths, token: string): void {
  withRuntimeLock(p, () => { assertRuntimeStore(p); readLease(p, token); rmSync(leasePath(p, token)); });
}
/** Must run under withRuntimeLock, including the eventual removal. */
export function preflightRuntimeRemoval(p: Paths): void {
  if (!existsSync(p.runtimes)) return;
  const st = lstatSync(p.runtimes);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Unknown ownership of runtime store');
  const { ids, preparations } = ledger(p);
  for (const name of readdirSync(p.runtimes)) {
    if (name === '.owned.json' || name === '.removing.json') continue;
    if (name === '.leases') {
      const dir = leaseDir(p), s = lstatSync(dir);
      if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('Unknown runtime lease ownership');
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) throw new Error('Unknown runtime lease ownership');
        const lease = readLease(p, file.slice(0, -5));
        if (!ids.includes(lease.id)) throw new Error('Unknown runtime lease ownership');
        if (ownerState(lease.owner) !== 'dead') throw new Error(`Runtime ${lease.id} has live or unknown owner`);
      }
    } else if (temporaryPattern.test(name)) {
      const preparation = preparations.find(x => x.temporary === name);
      const stat = lstatSync(join(p.runtimes, name));
      if (!preparation || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unknown ownership of runtime store entry: ${name}`);
      if (ownerState(preparation.owner) !== 'dead') throw new Error('Runtime preparation has live or unknown owner');
    } else {
      if (!idPattern.test(name) || !ids.includes(name)) throw new Error(`Unknown ownership of runtime store entry: ${name}`);
      try { if (validateRuntimeBundle(join(p.runtimes, name)).id !== name) throw new Error('identity mismatch'); }
      catch { throw new Error(`Unknown ownership of runtime bundle: ${name}`); }
    }
  }
}

/** V2 is intentionally unreadable by V1 readers/GC: dead PID pruning must fail closed.
 * One protected record pins both identities (including a project override outside the store).
 * There is no exit hook, dead-owner recovery, generic transfer or generic release for V2. */
export type AdvisoryRuntimeBinding = { stateDir: string; project: ProjectIdentity;
  invocationId: string; fence: string; profile: string;
  pins: { root: string; id: string; dependencies: string }[] };
export type AdvisoryRuntimeLease = { version: 2; token: string; id: string; owner: Owner;
  binding: AdvisoryRuntimeBinding; process: import('./supervisor-process.mts').ProcessEvidence | null };
function readAdvisoryLease(p: Paths, token: string): AdvisoryRuntimeLease {
  if (!tokenPattern.test(token)) throw Error('Invalid protected runtime token');
  const file = leasePath(p, token);
  for (const path of [leaseDir(p), file]) if (lstatSync(path).isSymbolicLink()) throw Error('Invalid protected runtime lease');
  const v = JSON.parse(readFileSync(file, 'utf8'));
  if (v.version !== 2 || v.token !== token || !idPattern.test(v.id) || !v.binding || !Array.isArray(v.binding.pins)) throw Error('Invalid protected runtime lease');
  return v;
}
export function acquireAdvisoryRuntimeLease(p: Paths, id: string, binding: AdvisoryRuntimeBinding): AdvisoryRuntimeLease {
  binding = structuredClone(binding);
  const owner = ownerOf(process.pid);
  if (ownerState(owner) !== 'alive') throw Error('Unknown protected runtime owner');
  return withRuntimeLock(p, () => {
    assertRuntimeAvailable(p); assertRuntimeStore(p);
    if (!runtimeOwned(p, id) || !binding.invocationId || !binding.fence || !binding.stateDir || !binding.profile || !binding.pins.length
      || !binding.pins.some(pin => pin.id === id && pin.root === join(p.runtimes,id))) throw Error('Invalid protected runtime binding');
    for (const pin of binding.pins) {
      const m = validateRuntimeBundle(pin.root);
      if (m.id !== pin.id || m.dependencies !== pin.dependencies) throw Error('Protected runtime changed');
    }
    const lease: AdvisoryRuntimeLease = { version: 2, token: randomUUID(), id, owner, binding, process: null };
    mkdirSync(leaseDir(p), { recursive: true, mode: 0o700 });
    if (lstatSync(leaseDir(p)).isSymbolicLink()) throw Error('Invalid protected runtime directory');
    writeRuntimeMetadata(p, leasePath(p,lease.token), JSON.stringify(lease) + '\n');
    return structuredClone(lease);
  });
}
/** Recheck the exact retained record before any start/handoff. Missing/mutated pins never re-create ownership. */
export function assertAdvisoryRuntimeLease(p: Paths, expected: AdvisoryRuntimeLease): void {
  withRuntimeLock(p, () => {
    assertRuntimeAvailable(p); assertRuntimeStore(p);
    if (JSON.stringify(readAdvisoryLease(p,expected.token)) !== JSON.stringify(expected)) throw Error('Protected runtime ownership changed');
    for (const pin of expected.binding.pins) {
      const m = validateRuntimeBundle(pin.root);
      if (m.id !== pin.id || m.dependencies !== pin.dependencies) throw Error('Protected runtime changed');
    }
  });
}
/** Only the exact initial ready child, once. No reconstructed-PID signalling or dead-owner adoption. */
export async function transferAdvisoryRuntimeLease(p: Paths, expected: AdvisoryRuntimeLease,
  evidence: import('./supervisor-process.mts').ProcessEvidence): Promise<AdvisoryRuntimeLease> {
  const { validateProcessEvidence, processIdentity } = await import('./supervisor-process.mts');
  evidence = structuredClone(validateProcessEvidence(evidence));
  if (JSON.stringify(processIdentity(evidence.worker.pid)) !== JSON.stringify(evidence.worker) || ownerState(expected.owner) !== 'alive') throw Error('Unknown ready child or controller');
  return withRuntimeLock(p, () => {
    const lease = readAdvisoryLease(p,expected.token), b = lease.binding;
    if (JSON.stringify(lease) !== JSON.stringify(expected) || lease.process
      || evidence.invocationId !== b.invocationId || evidence.fence !== b.fence || JSON.stringify(evidence.project) !== JSON.stringify(b.project)
      || !b.pins.some(pin => pin.id === evidence.runtime && pin.dependencies === evidence.dependencies)) throw Error('Protected runtime transfer mismatch');
    lease.owner = { pid: evidence.worker.pid, start: evidence.worker.start }; lease.process = evidence;
    writeRuntimeMetadata(p,leasePath(p,lease.token),JSON.stringify(lease) + '\n');
    return structuredClone(lease);
  });
}
/** Release only after durable T05 local-human settlement, original known usage and fresh whole-group absence.
 * Evidence reads/imports happen before the runtime lock; final exact-record CAS cannot release a successor. */
export async function releaseAdvisoryRuntimeLease(p: Paths, expected: AdvisoryRuntimeLease): Promise<void> {
  const { readSupervisor } = await import('./supervisor-state.mts');
  const { readOwnedProcess, readOwnedCleanup } = await import('./supervisor-process.mts');
  const { readProviderUsage } = await import('./supervisor-openai-usage.mts');
  const { supervisorHash } = await import(existsSync(new URL('./supervisor-contract.mts', import.meta.url)) ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
  const { ADVISORY_PROFILE_ID } = await import('./supervisor-advisory-contract.mts');
  expected = structuredClone(expected);
  const b = expected.binding, s = readSupervisor(b.stateDir,b.project), key = supervisorHash(b.invocationId);
  const g = s.advisory?.workers[key]?.grant, a = s.advisory?.sends[key], terminal = s.advisory?.settlements?.[key];
  if (!g || !a || !terminal || !expected.process || b.profile !== ADVISORY_PROFILE_ID || g.profile !== b.profile
    || g.invocationId !== b.invocationId || g.fence !== b.fence || terminal.grantId !== g.id || terminal.fence !== b.fence
    || !['local-human-required','retained-advice'].includes(terminal.disposition) || terminal.authorization !== a.receipt
    || g.owner.pid !== expected.owner.pid || g.owner.start !== expected.owner.start) throw Error('Protected runtime settlement held');
  const evidence = readOwnedProcess(b.stateDir,g), cleanup = readOwnedCleanup(b.stateDir,g), usage = readProviderUsage(b.stateDir,g,a);
  if (supervisorHash(evidence) !== supervisorHash(expected.process) || terminal.process !== supervisorHash(evidence)
    || terminal.cleanup !== supervisorHash(cleanup) || usage.state !== 'known' || supervisorHash(terminal.usage) !== supervisorHash(usage.receipt)) throw Error('Protected runtime evidence held');
  withRuntimeLock(p, () => {
    assertRuntimeStore(p);
    if (!existsSync(leasePath(p,expected.token))) {
      // Idempotence is not successor authority. Refuse even observational closure across new ownership.
      for (const name of readdirSync(leaseDir(p)).filter(n => n.endsWith('.json'))) {
        const other = JSON.parse(readFileSync(join(leaseDir(p),name),'utf8'));
        if (other.version === 2 && (other.binding?.project?.root === b.project.root
          || JSON.stringify(other.binding?.project?.tracker) === JSON.stringify(b.project.tracker))) throw Error('Protected runtime successor mismatch');
      }
      return;
    }
    if (JSON.stringify(readAdvisoryLease(p,expected.token)) !== JSON.stringify(expected)) throw Error('Protected runtime successor mismatch');
    rmSync(leasePath(p,expected.token));
  });
}
