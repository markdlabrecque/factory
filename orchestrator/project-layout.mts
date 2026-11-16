// Shared project-only .factory paths and read-only structural inspection. Importing performs no I/O.
// Layout approval never validates TOML/runtime identity or authorizes writes. Callers retain those gates.
// Refuse aliases rather than following them; legacy entries are only lstat'd, never opened or converted.
import { accessSync, constants, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const PROJECT_ASSET_BASENAME = '.factory';
export const UNSUPPORTED_PROJECT_ASSET_BASENAME = '.sandcastle';

/** Pure path calculation; no discovery, canonicalization, suffix rewriting or filesystem access. */
export function projectLayoutPaths(projectRoot: string) {
  const root = resolve(projectRoot), assets = join(root, PROJECT_ASSET_BASENAME);
  return Object.freeze({ projectRoot: root, assets, unsupportedAssets: join(root, UNSUPPORTED_PROJECT_ASSET_BASENAME),
    config: join(assets, 'factory.toml'), env: join(assets, '.env'), envExample: join(assets, '.env.example'),
    gitignore: join(assets, '.gitignore'), dispatchWrapper: join(assets, 'factory-dispatch.sh'),
    helpers: join(assets, 'sandbox'), logs: join(assets, 'logs'), evidence: join(assets, 'evidence'),
    worktrees: join(assets, 'worktrees'), diagnosticSessions: join(assets, 'diagnostic-sessions'),
    recovery: join(assets, 'recovery') });
}
// Ticket/execution/attempt suffixes, including recovery/<attempt>/git, belong to their identity-checking owners.
export type LayoutEntry =
  | { kind: 'missing' | 'symlink' | 'other' | 'unknown' }
  | { kind: 'directory' | 'file'; canonicalPath: string };
export type LayoutObservations = { project: LayoutEntry; factory: LayoutEntry; legacy: LayoutEntry; config: LayoutEntry };
export type LayoutRefusalReason = 'project-unsafe' | 'inspection-unavailable' | 'legacy-layout' | 'mixed-layout' |
  'factory-unsafe' | 'config-unsafe' | 'config-missing' | 'fresh-not-allowed';
export type LayoutInspection =
  | { kind: 'fresh' }
  | { kind: 'supported'; config: 'present' | 'missing' }
  | { kind: 'refused'; reason: LayoutRefusalReason };

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return isAbsolute(path) && resolve(path) === path && !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
/** Pure classifier for injected observations. Unknown access is never absence or readiness. */
export function classifyProjectLayout(projectRoot: string, o: LayoutObservations): LayoutInspection {
  const p = projectLayoutPaths(projectRoot);
  const refuse = (reason: LayoutRefusalReason): LayoutInspection => ({ kind: 'refused', reason });
  if (o.project.kind === 'unknown') return refuse('inspection-unavailable');
  if (o.project.kind !== 'directory' || o.project.canonicalPath !== p.projectRoot) return refuse('project-unsafe');
  if (o.factory.kind === 'unknown' || o.legacy.kind === 'unknown') return refuse('inspection-unavailable');
  // Any legacy entry counts, including a dangling symlink, regular file or special file.
  if (o.legacy.kind !== 'missing') return refuse(o.factory.kind === 'missing' ? 'legacy-layout' : 'mixed-layout');
  if (o.factory.kind === 'missing') return { kind: 'fresh' };
  if (o.factory.kind !== 'directory' || o.factory.canonicalPath !== p.assets) return refuse('factory-unsafe');
  if (o.config.kind === 'unknown') return refuse('inspection-unavailable');
  if (o.config.kind === 'missing') return { kind: 'supported', config: 'missing' };
  if (o.config.kind !== 'file' || !contained(p.assets, o.config.canonicalPath)) return refuse('config-unsafe');
  return { kind: 'supported', config: 'present' };
}

export type LayoutPolicy =
  | { allowed: false; reason: LayoutRefusalReason }
  | { allowed: true; requiresProjectValidation: boolean };
/** Init may fill missing config in a safe data-assets directory. Existing operations require config. */
export function projectLayoutPolicy(inspection: LayoutInspection, operation: 'init' | 'existing'): LayoutPolicy {
  if (inspection.kind === 'refused') return { allowed: false, reason: inspection.reason };
  if (inspection.kind === 'fresh') return operation === 'init'
    ? { allowed: true, requiresProjectValidation: false } : { allowed: false, reason: 'fresh-not-allowed' };
  if (inspection.config === 'missing') return operation === 'init'
    ? { allowed: true, requiresProjectValidation: false } : { allowed: false, reason: 'config-missing' };
  return { allowed: true, requiresProjectValidation: true };
}

/** Enforce structural policy without reading configuration or changing project/state bytes. */
export function requireProjectLayout(root: string, operation: 'init' | 'existing' = 'existing') {
  const policy = projectLayoutPolicy(inspectProjectLayout(root), operation);
  if (!policy.allowed) throw new Error(`Unsupported Factory project layout: ${policy.reason}${policy.reason === 'config-missing' ? ' (.factory/factory.toml is missing)' : ''}. No conversion or adoption is performed.`);
  return projectLayoutPaths(root);
}

/** Inspect metadata/access only. Never read .env/config bodies, follow entry aliases, run commands or create files.
 * This is a preflight snapshot, not a TOCTOU-safe write capability. Consumers must recheck their own boundaries.
 */
export function inspectProjectLayout(projectRoot: string): LayoutInspection {
  const p = projectLayoutPaths(projectRoot);
  function observe(path: string, access: boolean): LayoutEntry {
    let st: ReturnType<typeof lstatSync>;
    try { st = lstatSync(path); }
    catch (error) { return { kind: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown' }; }
    try {
      if (st.isSymbolicLink()) return { kind: 'symlink' };
      if (!st.isDirectory() && !st.isFile()) return { kind: 'other' };
      const canonicalPath = realpathSync(path);
      if (access) {
        if (st.isDirectory()) { accessSync(path, constants.R_OK | constants.X_OK); readdirSync(path); }
        else accessSync(path, constants.R_OK);
      }
      return { kind: st.isDirectory() ? 'directory' : 'file', canonicalPath };
    } catch {
      // Once observed present, disappearance or failed canonical/access checks are unknown, not fresh.
      return { kind: 'unknown' };
    }
  }
  const missing: LayoutEntry = { kind: 'missing' };
  const project = observe(p.projectRoot, true);
  // Never descend into aliases or an untrusted project root.
  if (project.kind !== 'directory' || project.canonicalPath !== p.projectRoot)
    return classifyProjectLayout(p.projectRoot, { project, factory: missing, legacy: missing, config: missing });
  // Only lstat the old entry. Its target, permissions and contents are irrelevant to refusal.
  let legacy: LayoutEntry;
  try { lstatSync(p.unsupportedAssets); legacy = { kind: 'other' }; }
  catch (error) { legacy = { kind: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown' }; }
  const factory = observe(p.assets, true);
  const config = legacy.kind === 'missing' && factory.kind === 'directory' && factory.canonicalPath === p.assets
    ? observe(p.config, true) : missing;
  return classifyProjectLayout(p.projectRoot, { project, factory, legacy, config });
}
