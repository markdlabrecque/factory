// Runtime descriptors and leases use locked atomic metadata writes outside the immutable store.
// PID/start-identity transactions fence complete async install/uninstall operations; uncertain owners prevent removal.
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ownerOf, ownerState, withAdmissionLock, writeDurable } from '../../board/admission.mts';
import type { Owner } from '../../board/admission.mts';
import { validateRuntimeBundle } from './runtime-bundle.mts';
import type { Paths } from './paths.mts';

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
export function transferRuntimeLease(p: Paths, token: string, owner: Owner): RuntimeLease {
  return withRuntimeLock(p, () => {
    assertRuntimeStore(p);
    const lease = readLease(p, token);
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
