// Passive Board projection of registered projects and the shared sanitized readiness store.
// Never resolve project paths, load workflow code, inspect logs or run probes from a browser read.
import { closeSync, constants, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { ReadinessRead } from './readiness.mts';
const { readStoredReadiness } = await import(existsSync(new URL('./readiness-store.mts', import.meta.url)) ? './readiness-store.mts' : './readiness.mts');
export interface BoardReadinessProject { name: string; root: string; observation: ReadinessRead }
export interface BoardReadiness { generatedAt: string; projects: BoardReadinessProject[]; reason?: string }
export const registryFile = () => join(process.env.FACTORY_HOME || homedir(), '.config/factory/projects.json');
/** Registry identities are trusted local configuration, never request parameters or run-provided paths.
 * Stored observations carry their own runtime/config/context identity, not a claim about current config. */
export function buildReadinessData(stateRoot: string, registry = registryFile(), now = Date.now()): BoardReadiness {
  const result: BoardReadiness = { generatedAt: new Date(now).toISOString(), projects: [] };
  let fd: number | undefined;
  try {
    fd = openSync(registry, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    const limit = 256 * 1024;
    if (!stat.isFile() || stat.size > limit) throw Error('Invalid registry');
    const buffer = Buffer.alloc(limit + 1);
    let size = 0, count: number;
    while ((count = readSync(fd, buffer, size, buffer.length - size, null)) > 0) {
      size += count; if (size > limit) throw Error('Invalid registry');
    }
    const value = JSON.parse(buffer.subarray(0, size).toString('utf8'));
    const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 4096 && !/[\x00-\x1f\x7f]/.test(s);
    if (value?.version !== 1 || !Array.isArray(value.projects) || value.projects.length > 256 ||
        !value.projects.every((p: any) => text(p?.name) && text(p?.root) && isAbsolute(p.root) && resolve(p.root) === p.root) ||
        new Set(value.projects.map((p: any) => p.root)).size !== value.projects.length) throw Error('Invalid registry');
    result.projects = value.projects.map((p: { name: string; root: string }) => ({ name: p.name, root: p.root, observation: readStoredReadiness(stateRoot, p.root, now) }));
  } catch (error) {
    result.reason = (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'No project registry available. Project readiness is unknown.'
      : 'Project registry could not be established. Project readiness is unknown.';
  } finally { if (fd !== undefined) closeSync(fd); }
  return result;
}
