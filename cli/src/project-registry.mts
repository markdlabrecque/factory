// Shared strict read-only registry reader. Missing registry is empty, malformed data is held and never repaired.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Paths } from './paths.mts';
export type ProjectSchedule = { enabled: boolean; branch: string; since: string };
export type Project = { name: string; root: string; schedule?: ProjectSchedule };
export type Registry = { version: 1; projects: Project[] };
export function readRegistry(p: Pick<Paths, 'projects'>): Registry {
  if (!existsSync(p.projects)) return { version: 1, projects: [] };
  let data: any;
  try { data = JSON.parse(readFileSync(p.projects, 'utf8')); } catch { throw new Error(`Project registry is not valid JSON: ${p.projects}. Fix or remove it; Factory will not overwrite it.`); }
  const ok = data?.version === 1 && Array.isArray(data.projects)
    && data.projects.every((x: any) => typeof x?.name === 'string' && typeof x?.root === 'string' && isAbsolute(x.root)
      && (x.schedule === undefined || (typeof x.schedule?.enabled === 'boolean' && typeof x.schedule.branch === 'string' && x.schedule.branch !== '' && typeof x.schedule.since === 'string')));
  if (!ok) throw new Error(`Unsupported project registry: ${p.projects}. Fix or remove it; Factory will not overwrite it.`);
  return data;
}
