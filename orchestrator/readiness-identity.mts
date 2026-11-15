// Shared host/diagnostic observation identity from resolved data only. No probing, resolver or project imports.
import { createHash } from 'node:crypto';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function readinessIdentity(projectRoot: string, runtimeIdentity: string, dependencies: string, configBytes: string | Buffer, assets: Record<string, string>) {
  return { projectRoot, runtimeIdentity, configIdentity: hash(configBytes),
    contextFingerprint: hash(JSON.stringify({ dependencies, assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))) })) };
}
