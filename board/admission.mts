// Shared v2 exclusion covers managed entries, durable supervisor holds and separate durable baseline reservations.
// Baselines use the same transaction lock, survive controller death and consume capacity until exact engine cleanup.
// Persisted writers may defer observational callbacks until every admission critical section has exited.
// Admission reads fail closed on malformed stores or IO uncertainty; only ENOENT means absent.
// Directory creation/replacement is strictly synced; unsupported or failed durability never returns successful publication.
// Optional advisory candidate identities are consumed with the SAME recovery claim/charge, never a second scheduler.
// #153: short-lived delivery ownership uses normal PID/start fencing and advances project activity without repair charges.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The admission record (slice four, #75): the one durable source of run claims, shared by every project in a run-state
// folder. `<stateDir>/admission/state.json` (folder 0700, file 0600, version 2; validated v1 migrates on the next commit) holds:
// - `claims`, by run key (`<project>--<iid>`): a token, the project and ticket, the kind (`normal` for a dispatched
//   launch, `recovery` for a repair attempt), the owning process (pid plus its start identity, so a reused pid is not
//   mistaken for the owner) and, for recovery, the attempt's UUID. A normal claim lives while its owner does. A recovery
//   claim is never released by its owner dying: only the recovery launcher's settle step releases it, after the
//   attempt's exact container is confirmed gone (cli/src/recovery-run.mts).
// - `generations`: per project, a counter that every normal admission increments. The jam confirmation (#61, cli/src/jam-detect.mts) compares it across
//   passes, so a normal launch breaks a pending jam confirmation (cli/src/recovery-state.mts).
// - `recovery`: per project, the number of recovery attempts admitted and the admitted attempts whose charge has not yet
//   been applied to the project's recovery record (`pending`). A recovery claim and its attempt charge are written in one
//   replacement; the charge is then applied to the recovery record idempotently by attempt UUID and cleared, so a crash
//   between the two writes is replayed later without charging twice or refunding (cli/src/recovery-claim.mts).
// Every writer first takes SQLite's process-death-safe writer mutex on the permanent local admission/mutex.sqlite.
// The private owner marker admission/lock is inspected, reclaimed and released only under that mutex. Never move,
// replace or delete the mutex file. Mixing protocols or filesystems without local SQLite locking is unsupported. Writes are temp file, fsync, rename, fsync of the folder. A corrupt record or an
// unknown version fails closed: nothing is claimed and the file is never overwritten. readAdmission never writes.
// Import-safe and dependency-free apart from Node, so factory init copies it next to board.mts (cli/src/scaffold.mts).

export type ClaimKind = "normal" | "recovery" | "delivery";
/** A process: its pid and, where the platform tells, when it started (to tell a reused pid apart). */
export type Owner = { pid: number; start?: string };
export interface AdmissionClaim {
  token: string;
  project: string;
  iid: string;
  kind: ClaimKind;
  owner: Owner;
  at: string;
  /** Recovery only: the attempt's UUID. */
  attempt?: string;
}
/** A recovery attempt admitted with its claim, whose charge is still to be applied to the project's recovery record. */
export interface AdmittedAttempt {
  id: string;
  iid: string;
  root: string;
  at: string;
  branch?: string;
  log?: string;
  container?: string;
  record?: string;
}
export interface AdmissionIdentity { root: string; tracker: { kind: 'github' | 'gitlab'; host: string; project: string } }
export interface ManagedEntry { id: string; project: AdmissionIdentity; owner: Owner }
export interface SupervisorHold extends ManagedEntry {
  invocationId: string;
  fence: string;
  pending: string[];
  settled: string[];
}
export interface AdmissionState {
  version: 2;
  supervisorHolds: Record<string, SupervisorHold>;
  entries: Record<string, ManagedEntry>;
  claims: Record<string, AdmissionClaim>;
  generations: Record<string, number>;
  recovery: Record<string, { admitted: number; pending: AdmittedAttempt[]; candidates?: Record<string, string> }>;
}

export const keyFor = (iid: string, proj?: string) => (proj ? `${proj.replace(/[^A-Za-z0-9._-]+/g, "_")}--${iid}` : iid);
export const admissionDir = (stateDir: string) => join(stateDir, "admission");
export const admissionFile = (stateDir: string) => join(admissionDir(stateDir), "state.json");
export const emptyAdmission = (): AdmissionState => ({ version: 2, supervisorHolds: {}, entries: {}, claims: {}, generations: {}, recovery: {} });
export const newToken = () => randomUUID();

/** Separate pre-implementation reservations, NOT run claims or recovery attempts. Never reap by PID/age.
 * Compatible readers must consult this sidecar under the same admission lock before claiming capacity. */
export interface BaselineReservation {
  executionId: string; ownerId: string; generation: string; project: AdmissionIdentity;
  iid: string; engine: string; name: string; intentDigest: string; tokenDigest: string; deadline: number;
}
export const baselineFile = (dir: string) => join(admissionDir(dir), 'baselines.json');
export function readBaselineReservations(dir: string): BaselineReservation[] {
  let d: any;
  try { d = JSON.parse(readFileSync(baselineFile(dir), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw Error('Baseline reservations unreadable; admission held'); }
  if (!isObj(d) || Object.keys(d).sort().join() !== 'reservations,version' || d.version !== 1 || !Array.isArray(d.reservations)
    || new Set(d.reservations.map((r: any) => r?.executionId)).size !== d.reservations.length
    || !d.reservations.every((r: any) => isObj(r) && Object.keys(r).sort().join() === 'deadline,engine,executionId,generation,iid,intentDigest,name,ownerId,project,tokenDigest'
      && ['executionId','ownerId','generation','iid','engine','name','intentDigest','tokenDigest'].every(k => str(r[k]))
      && validAdmissionIdentity(r.project) && Number.isSafeInteger(r.deadline) && r.deadline > 0)) throw Error('Baseline reservations malformed; admission held');
  return d.reservations;
}
/** Trusted transaction writer only: use within withAdmission, never infer release from controller death. */
export function writeBaselineReservations(dir: string, reservations: BaselineReservation[]): void {
  if (!admissionDepth) throw Error('Baseline reservation write requires admission transaction');
  writeDurable(baselineFile(dir), JSON.stringify({ version: 1, reservations }));
}

// ---- process identity ------------------------------------------------------------------------------------------------

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}
/** When process `pid` started: a platform-specific string, null when no such process exists or it has exited and is
 *  only a zombie waiting for its parent to reap it (a crashed owner whose parent never reaps is gone, not running),
 *  undefined when it exists but its start cannot be read. */
export function processStart(pid: number): string | null | undefined {
  if (!Number.isInteger(pid) || pid <= 0 || processGone(pid)) return null;
  try {
    // Linux: after the parenthesised command name, field 3 of /proc/<pid>/stat is the state and field 22 the start
    // (clock ticks since boot).
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z" || fields[0] === "X") return null;
    return `linux:${fields[19]}`;
  } catch {
    /* not Linux, or gone meanwhile */
  }
  if (process.platform === "linux") return processGone(pid) ? null : undefined;
  const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  if (state.status === 0 && state.stdout.trim().startsWith("Z")) return null;
  const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return `ps:${r.stdout.trim()}`;
  return processGone(pid) ? null : undefined;
}
export function ownerOf(pid: number): Owner {
  const start = processStart(pid);
  return start ? { pid, start } : { pid };
}
/** Whether the owner still runs: "dead" only when its pid is gone or now belongs to a process started at another time. */
export function ownerState(o: Owner): "alive" | "dead" | "unknown" {
  const start = processStart(o.pid);
  if (start === null) return "dead";
  if (start === undefined) return "unknown";
  if (o.start && o.start !== start) return "dead";
  return o.start ? "alive" : "unknown";
}
/** A claim that still holds: every recovery claim (released only by settling), and a normal claim whose owner may run. */
export const claimLive = (c: AdmissionClaim) => c.kind === "recovery" || ownerState(c.owner) !== "dead";

// ---- the record ------------------------------------------------------------------------------------------------------

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown) => typeof x === "string" && x.length > 0;
const optStr = (x: unknown) => x === undefined || typeof x === "string";
const validOwner = (o: any) => isObj(o) && Number.isInteger(o.pid) && o.pid > 0 && optStr(o.start);

/** Only ENOENT means absent. IO uncertainty, malformed data or an unknown version holds admission. Never writes. */
export function readAdmission(stateDir: string): AdmissionState {
  const file = admissionFile(stateDir);
  let d: any;
  try {
    d = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyAdmission();
    throw new Error(`Admission record is not valid JSON: ${file}. Nothing is admitted until it is fixed; Factory will not overwrite it.`);
  }
  return migrateAdmission(d, file);
}
/** Pure compatible decode: v1's accounting collections are preserved; exclusion fields cannot hide in v1. */
export function migrateAdmission(d: any, file = 'admission/state.json'): AdmissionState {
  const ok = isObj(d) && (d.version === 1 || d.version === 2)
    && Object.keys(d).sort().join() === (d.version === 1 ? ['version','claims','generations','recovery'] : ['version','claims','generations','recovery','entries','supervisorHolds']).sort().join()
    && (d.version === 1 ? !('supervisorHolds' in d) && !('entries' in d) :
      isObj(d.supervisorHolds) && Object.entries<any>(d.supervisorHolds).every(([id, h]) => validEntry(h) && id === h.id
        && str(h.invocationId) && str(h.fence) && Array.isArray(h.pending) && h.pending.every(str) && Array.isArray(h.settled) && h.settled.every(str))
      && isObj(d.entries) && Object.entries<any>(d.entries).every(([id, e]) => validEntry(e) && id === e.id))
    && isObj(d.claims) && Object.entries<any>(d.claims).every(([k, c]) => isObj(c) && str(c.token) && typeof c.project === "string" && str(c.iid)
      && k === keyFor(c.iid, c.project) && (c.kind === "normal" || c.kind === "recovery" || c.kind === "delivery") && validOwner(c.owner) && str(c.at)
      && optStr(c.attempt) && (c.kind !== "recovery" || str(c.attempt)))
    && isObj(d.generations) && Object.values(d.generations).every((g) => Number.isInteger(g) && (g as number) >= 0)
    && isObj(d.recovery) && Object.values<any>(d.recovery).every((r) => isObj(r) && Number.isInteger(r.admitted) && r.admitted >= 0
      && (r.candidates === undefined || isObj(r.candidates) && Object.entries(r.candidates).every(([id, attempt]) => /^[a-f0-9]{64}$/.test(id) && str(attempt)))
      && Array.isArray(r.pending) && r.pending.every((a: any) => isObj(a) && str(a.id) && str(a.iid) && str(a.root) && str(a.at)
        && optStr(a.branch) && optStr(a.log) && optStr(a.container) && optStr(a.record)));
  if (!ok) throw new Error(`Unsupported admission record: ${file}. Nothing is admitted until it is fixed; Factory will not overwrite it.`);
  // Explicit compatible migration: preserve the original collections (including candidate and pending charges).
  // Read-only callers do not publish a migration. Old readers reject the version on the next v2 commit.
  return d.version === 1 ? { ...d, version: 2, supervisorHolds: {}, entries: {} } : d;
}

export function validAdmissionIdentity(p: any): p is AdmissionIdentity {
  return isObj(p) && str(p.root) && resolve(p.root) === p.root && isObj(p.tracker)
    && ['github', 'gitlab'].includes(p.tracker.kind) && str(p.tracker.host) && str(p.tracker.project);
}
const validEntry = (e: any): boolean => isObj(e) && str(e.id) && validAdmissionIdentity(e.project)
  && validOwner(e.owner) && str(e.owner.start);
/** Namespace collisions are conflicts even across tracker hosts or distinct checkout roots: board keys omit host/kind. */
export function admissionConflict(a: AdmissionIdentity, b: AdmissionIdentity): boolean {
  return a.root === b.root || keyFor('namespace', a.tracker.project) === keyFor('namespace', b.tracker.project);
}
/** Unknown identity never establishes that an existing hold belongs to somebody else. */
export function supervisorExclusion(s: AdmissionState, tracker?: string, root?: string): string | undefined {
  const hold = Object.values(s.supervisorHolds).find(h => !tracker || !root || h.project.root === root
    || keyFor('namespace', h.project.tracker.project) === keyFor('namespace', tracker));
  return hold ? `project held by supervisor ${hold.id} (${hold.invocationId}/${hold.fence})` : undefined;
}
/** Short synchronous admission transaction only; callers own subprocess lifetime outside this lock.
 * Entries survive owner death: an exited controller does not prove its descendants or handoff settled. */
export function claimManagedEntry(dir: string, project: AdmissionIdentity): string {
  if (!validAdmissionIdentity(project)) throw Error('Managed entry identity unknown');
  project = { root: realpathSync(project.root), tracker: { ...project.tracker, host: project.tracker.host.toLowerCase() } };
  return withAdmission(dir, tx => {
    const reason = supervisorExclusion(tx.state, project.tracker.project, project.root);
    if (reason) throw Error(reason);
    if (readBaselineReservations(dir).some(b => admissionConflict(b.project, project))) throw Error('Project held by acceptance baseline cleanup');
    const owner = ownerOf(process.pid);
    if (!owner.start) throw Error('Managed entry owner unknown');
    const id = newToken(); tx.state.entries[id] = { id, project: structuredClone(project), owner }; tx.commit(); return id;
  });
}
export function releaseManagedEntry(dir: string, id: string): boolean {
  return withAdmission(dir, tx => {
    const e = tx.state.entries[id], me = ownerOf(process.pid);
    if (!e || e.owner.pid !== me.pid || !me.start || e.owner.start !== me.start) return false;
    delete tx.state.entries[id]; tx.commit(); return true;
  });
}

/** A successful return establishes directory durability; unsupported filesystems fail closed, not best effort. */
export function syncDirectory(directory: string): void {
  const fd = openSync(directory, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
/** Sync the containing chain too: existing visible directories may be left by an earlier failed publication. */
export function durableDirectory(directory: string): void {
  let current = resolve(directory); mkdirSync(current, { recursive: true, mode: 0o700 });
  for (;;) { syncDirectory(current); const parent = dirname(current); if (current === parent) break; current = parent; }
}
/** Write `text` atomically and durably: synced directory creation, 0600 temp, fsync, rename, strict folder fsync. */
export function writeDurable(file: string, text: string): void {
  durableDirectory(dirname(file)); writePrepared(file, text);
}
/** Internal only: the containing directory chain was synced by this same synchronous lock scope. */
function writePrepared(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  syncDirectory(dirname(file));
}


/** Take <stateDir>/admission/lock, run `fn`, release. See the file comment for when a lock is taken over. */
// Observational callbacks run only after all authoritative admission locks have been released.
// A callback cannot change the result, even when persistence or the callback fails.
let admissionDepth = 0;
let observations: (() => void)[] = [];
export function observationFailure(): void {
  try { console.warn('Factory telemetry: recorder failed'); } catch { /* diagnostics cannot change safety results */ }
}
export function afterAdmission(fn: () => void): void {
  if (admissionDepth) observations.push(fn);
  else { try { fn(); } catch { observationFailure(); } }
}
function flushObservations(): void {
  if (admissionDepth) return;
  const pending = observations; observations = [];
  for (const fn of pending) { try { fn(); } catch { observationFailure(); } }
}
export type DurableWriter = (file: string, text: string) => void;
export function withAdmissionLock<T>(stateDir: string, fn: (write: DurableWriter) => T, waitMs = 10_000): T {
  const dir = admissionDir(stateDir);
  durableDirectory(dir);
  if(!Number.isSafeInteger(waitMs)||waitMs< -1||waitMs>2147483647)throw Error('Invalid admission lock timeout');
  const db=new DatabaseSync(join(dir,'mutex.sqlite'));
  try {
    // Existing journal callers use -1 for a single nonblocking attempt.
    db.exec(`PRAGMA busy_timeout=${Math.max(0,waitMs)}`);
    try { db.exec('BEGIN IMMEDIATE'); } catch(e){
      if((e as {errcode?:number}).errcode===5)throw Error(`Run admission is locked by process (SQLite writer busy in ${dir}). Retry shortly.`);
      throw e;
    }
    return underMutex(stateDir,dir,fn);
  } finally { try {db.close()} finally {flushObservations()} }
}
function underMutex<T>(stateDir:string, dir:string, fn:(write:DurableWriter)=>T):T {
  const lock = join(dir, "lock");
  const me = {...ownerOf(process.pid),token:randomUUID()};
  const tmp = join(dir, `lock.${process.pid}.${randomUUID().slice(0, 8)}`);
  writePrepared(tmp, JSON.stringify(me));
  // Only this transaction may touch the marker. A surviving legacy owner or malformed marker holds.
  try {
    for (;;) {
      try {
        linkSync(tmp, lock);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      let holder: Owner | undefined;

      try {
        const h = JSON.parse(readFileSync(lock, "utf8"));
        if (validOwner(h)) holder = h;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; // released meanwhile
      }
      if (holder && ownerState(holder) === "dead") {
        rmSync(lock);
        continue;
      }
      throw new Error(holder
          ? `Run admission is locked by process ${holder.pid} (${lock}). Retry shortly.`
          : `Run admission lock ${lock} is unreadable; it is never taken over by age. Remove it once no factory or dispatcher process runs.`);
    }
  } finally {
    rmSync(tmp, { force: true });
  }
  admissionDepth++;
  let active = true;
  try {
    const stamp = (path: string) => { const st = statSync(path, { bigint: true });
      if (!st.isDirectory()) throw Error('Durable writer directory identity is unknown'); return `${st.dev}:${st.ino}:${st.ctimeNs}`; };
    const directories = new Map([resolve(stateDir), resolve(dir)].map(path => [path, stamp(path)]));
    const write: DurableWriter = (file, text) => {
      const destination = resolve(file), parent = dirname(destination);
      if (!active || !directories.has(parent) || directories.get(parent) !== stamp(parent)) throw Error('Durable writer is outside its active owned lock scope');
      // No repeated ancestor fsync is needed: this lock already synced that exact containing chain.
      // Every write still fsyncs its new file and the containing directory after atomic replacement.
      try { writePrepared(destination, text); directories.set(parent, stamp(parent)); }
      catch (e) { active = false; throw e; }
    };
    return fn(write);
  } finally {
    active = false;
    try {
      if(readFileSync(lock,'utf8')!==JSON.stringify(me))throw Error('Admission marker ownership changed; retained for inspection');
      rmSync(lock);
    } finally { admissionDepth--; }
  }
}

export interface AdmissionTx {
  /** The record as read under the lock; mutate it, then commit. */
  state: AdmissionState;
  /** Write the current state as one atomic replacement. May be called more than once. */
  commit(): void;
}

/** Run `fn` with the admission record under the lock. Normal claims whose owner is gone are dropped on commit. */
export function withAdmission<T>(stateDir: string, fn: (tx: AdmissionTx) => T): T {
  return withAdmissionLock(stateDir, () => {
    const state = readAdmission(stateDir);
    const tx: AdmissionTx = {
      state,
      commit() {
        if (state.version !== 2) throw Error('Admission downgrade is unsupported');
        migrateAdmission(state); // Writers validate the complete mandatory exclusion schema too.
        for (const [k, c] of Object.entries(state.claims)) if (!claimLive(c)) delete state.claims[k];
        writeDurable(admissionFile(stateDir), JSON.stringify(state, null, 2) + "\n");
      },
    };
    return fn(tx);
  });
}

/** Hand the claim `token` on `key` to process `pid`. Only that token, and with `from`, only while `from` owns it. */
export function transferClaim(stateDir: string, key: string, token: string, pid: number, from?: number): boolean {
  return withAdmission(stateDir, (tx) => {
    const c = tx.state.claims[key];
    if (!c || c.token !== token || (from !== undefined && c.owner.pid !== from)) return false;
    if (supervisorExclusion(tx.state, c.project, realpathSync(process.env.FACTORY_PROJECT_ROOT ?? process.cwd()))) return false;
    c.owner = ownerOf(pid);
    tx.commit();
    return true;
  });
}

/** Release the claim `token` on `key`, only if it still holds that token and (when given) is of `kind`. */
export function releaseClaim(stateDir: string, key: string, token: string, kind?: ClaimKind): boolean {
  return withAdmission(stateDir, (tx) => {
    const c = tx.state.claims[key];
    if (!c || c.token !== token || (kind && c.kind !== kind)) return false;
    delete tx.state.claims[key];
    tx.commit();
    return true;
  });
}

/** The project's activity generation (normal admissions so far). */
export const generationOf = (s: AdmissionState, project: string) => s.generations[project] ?? 0;
