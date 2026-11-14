// Recovery publication uses a short per-ticket lock and raw-byte CAS; every execution writer shares it.
import { randomUUID } from 'node:crypto';
import { digest } from './recovery-analysis-contract.mts';
import { withAdmissionLock } from './admission.mts';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { keyFor, stateDir } from "./board.mts";
import type { Manifest } from "./graph.mts";

// Manifest store: <stateDir>/graph/<project>--<iid>.json, next to the run records.

const dir = () => resolve(stateDir(), "graph");
const file = (project: string, iid: number) => resolve(dir(), `${keyFor(String(iid), project)}.json`);

export function readManifest(project: string, iid: number): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(file(project, iid), "utf8"));
  } catch {
    return undefined;
  }
}

export function manifestDigest(project: string, iid: number): string {
  try { return digest(readFileSync(file(project, iid), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return digest(''); throw e; }
}
function locked<T>(project: string, iid: number, fn: () => T): T {
  mkdirSync(dir(), { recursive: true });
  return withAdmissionLock(`${file(project, iid)}.publication`,fn,0); // dead-owner recovery, never steal by age
}
function replace(m: Manifest): void {
  const f = file(m.project, m.iid), tmp = `${f}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(m, null, 2)); renameSync(tmp, f); }
  finally { rmSync(tmp, { force: true }); }
}
export function writeManifest(m: Manifest): void { locked(m.project, m.iid, () => replace(m)); }
/** Publish only against the original bytes. No tracker/agent work while locked. */
export function publishManifest(m: Manifest, expected: string): boolean {
  return locked(m.project, m.iid, () => {
    if (manifestDigest(m.project, m.iid) !== expected) return false;
    replace(m); return true;
  });
}

/** Merge fields into a ticket's manifest, creating a bare one if the ticket was never analysed. */
export function patchManifest(project: string, iid: number, patch: Partial<Manifest>): void {
  locked(project, iid, () => {
  const cur: Manifest = readManifest(project, iid) ?? {
    iid, project, hash: "", analyzedAt: "", base: "", baseSha: "",
    provides: [], requires: [], footprint: [], catalogueIids: [], blockerHashes: {},
  };
  replace({ ...cur, ...patch, iid, project });
  });
}

export function readManifests(project: string): Map<number, Manifest> {
  const out = new Map<number, Manifest>();
  if (!existsSync(dir())) return out;
  const prefix = keyFor("", project);
  for (const f of readdirSync(dir()).filter((n) => n.startsWith(prefix) && n.endsWith(".json"))) {
    try {
      const m: Manifest = JSON.parse(readFileSync(resolve(dir(), f), "utf8"));
      if (m.project === project) out.set(m.iid, m);
    } catch {
      /* skip unreadable file */
    }
  }
  return out;
}

export function removeManifest(project: string, iid: number): void {
  locked(project, iid, () => rmSync(file(project, iid), { force: true }));
}
