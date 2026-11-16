// Host-owned fresh project/workspace gates and typed frozen-input report publication. Never imports override code.
// Reports are observations only; admission, recovery accounting and final Git creation remain authoritative.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const { probeFilesystem, reportStatus, safeErrno } = await import(existsSync(new URL('./readiness-probe.mts', import.meta.url)) ? './readiness-probe.mts' : './readiness.mts');
import type { ReadinessInput, ReadinessPath, ReadinessReport } from './readiness.mts';
import { loadInstructions } from './instructions.mts';
import { requireProjectLayout, projectLayoutPaths } from './project-layout.mts';
import { readinessIdentity } from './readiness-identity.mts';
import type { TicketInputHold, FrozenTicketInput } from './ticket-input.mts';
import type { ReadinessCheck } from './readiness-schema.mts';
import { loadTomlConfig, resolveCheckoutPath, type EffectiveConfig } from './project-config.mts';
const store = await import(existsSync(new URL('./readiness-store.mts', import.meta.url)) ? './readiness-store.mts' : existsSync(new URL('./readiness-probe.mts', import.meta.url)) ? './readiness.mts' : '../board/readiness.mts');
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export type LaunchReadinessInput = { projectRoot: string; runtimeRoot: string; runtimeIdentity: string; runtimeDependencies: string; config: EffectiveConfig; stateRoot: string; base?: string; signal?: AbortSignal };
function ancestor(path: string): string {
  let current = path;
  while (!existsSync(current)) { const next = dirname(current); if (next === current) throw Error('No existing trusted ancestor'); current = next; }
  if (realpathSync(current) !== current || !lstatSync(current).isDirectory()) throw Object.assign(Error('Unsafe readiness directory'), { code: 'EUNSAFEPATH' });
  return current;
}
export async function projectLaunchReadiness(o: LaunchReadinessInput): Promise<ReadinessReport> {
  // Unsupported/unknown layouts must not create even a blocked report or artifact directory.
  requireProjectLayout(o.projectRoot);
  let identity = readinessIdentity(o.projectRoot, o.runtimeIdentity, o.runtimeDependencies, JSON.stringify(o.config), {});
  let owner = { invocationId: randomUUID(), ownerId: String(process.pid), generation: randomUUID() };
  const paths: ReadinessPath[] = [];
  const add = (id: string, role: ReadinessPath['role'], path: string, trustedRoot: string, access: ReadinessPath['access'], create = false) => paths.push({ id, scope: 'project', role, path, trustedRoot, access, ...(create ? { create } : {}) });
  let report: ReadinessReport;
  let observationStarted = false;
  let operation = 'validate-config', observedPath = join(o.projectRoot, '.factory/factory.toml');
  try {
    if (hash(loadTomlConfig(join(o.projectRoot, '.factory'))) !== hash(o.config)) throw Object.assign(Error('Configuration changed'), { code: 'ECONFIGCHANGED' });
    const configBytes = readFileSync(observedPath);
    identity = readinessIdentity(o.projectRoot, o.runtimeIdentity, o.runtimeDependencies, configBytes, {});
    const assets: Record<string, string> = {};
    operation = 'resolve-git-metadata'; observedPath = o.projectRoot;
    add('checkout', 'checkout', o.projectRoot, o.projectRoot, 'read-directory');
    for (const [id, arg] of [['git-dir', '--absolute-git-dir'], ['git-common-dir', '--git-common-dir']] as const) {
      const path = resolve(o.projectRoot, git(o.projectRoot, ['rev-parse', arg]));
      add(id, id, path, realpathSync(path), 'read-directory');
    }
    operation = 'resolve-base';
    if (o.base) git(o.projectRoot, ['rev-parse', '--verify', `refs/remotes/origin/${o.base}^{commit}`]);
    add('runtime', 'runtime', o.runtimeRoot, o.runtimeRoot, 'read-directory');
    add('settings', 'project-asset', join(o.projectRoot, '.factory/factory.toml'), o.projectRoot, 'read-file');
    // Loading configured instruction data is host-owned and never imports executable project modules.
    operation = 'read-instruction';
    for (const path of new Set(Object.values(o.config.instructions).flat())) {
      observedPath = resolve(o.projectRoot, path);
      Object.assign(assets, loadInstructions(o.projectRoot, { common: [path], analysis: [], implementation: [], verification: [], recovery: [], supervisor: [], gateReview: [] }, 'analysis').hashes);
      const actual = resolveCheckoutPath(o.projectRoot, path, 'file');
      add(`instruction:${paths.length}`, 'project-asset', actual, o.projectRoot, 'read-file');
    }
    identity = readinessIdentity(o.projectRoot, o.runtimeIdentity, o.runtimeDependencies, configBytes, assets);
    operation = 'prepare-state'; observedPath = o.stateRoot;
    add('state', 'state', o.stateRoot, ancestor(o.stateRoot), 'write-directory', true);
    const layout = projectLayoutPaths(o.projectRoot);
    for (const [name, path] of Object.entries({ logs: layout.logs, evidence: layout.evidence, sandbox: layout.helpers, worktrees: layout.worktrees, recovery: layout.recovery })) add(name, 'artifact', path, o.projectRoot, 'write-directory', true);
    add('analysis-worktrees', 'worktree-parent', join(o.stateRoot, 'worktrees'), ancestor(o.stateRoot), 'write-directory', true);
    // Bootstrap only the explicitly selected state directory, then allocate the publication fence before observation.
    const bootstrap: ReadinessInput = { identity, owner, paths: paths.filter(p => p.id === 'state') };
    const state = await probeFilesystem(bootstrap, { signal: o.signal });
    if (state.status !== 'ready') {
      const failed = state.checks.find(c => c.required && c.status !== 'ready');
      if (failed) { operation = failed.operation; observedPath = failed.path; }
      throw Object.assign(Error('Readiness state access failed'), { code: failed?.errno ?? 'EIO' });
    }
    operation = 'begin-report';
    const prior = store.readReadiness(o.stateRoot, identity);
    const ticketChecks = 'report' in prior && JSON.stringify(prior.report.identity) === JSON.stringify(identity)
      ? prior.report.checks.filter((c: ReadinessReport['checks'][number]) => c.scope !== 'project' && Date.parse(c.observedAt) > Date.now() - 60_000).slice(-100) : [];
    const token = store.beginReadiness(o.stateRoot, identity, owner); owner = token.owner; observationStarted = true;
    operation = 'probe-filesystem'; observedPath = o.projectRoot;
    try { report = await probeFilesystem({ identity, owner, paths }, { signal: o.signal }); }
    catch (error) { report = failure(error); }
    report.checks.push(...ticketChecks); report.status = reportStatus(report.checks);
    operation = 'publish-report'; observedPath = o.stateRoot;
    if (!store.publishReadiness(o.stateRoot, token, report)) throw Object.assign(Error('Superseded'), { code: 'ESTALE' });
    return report;
  } catch (error) {
    // Setup/read/publication failures must be direct diagnostics, never a cached successful authorization.
    console.error(`Factory host readiness hold: ${operation} ${observedPath}: ${safeErrno(error)}`);
    report = failure(error);
    // Publish setup failures too when the report store is usable. Never hide the primary error.
    try {
      if (!observationStarted) {
        const bootstrap = await probeFilesystem({ identity, owner, paths: [{ id: 'state', scope: 'project', role: 'state', path: o.stateRoot, trustedRoot: ancestor(o.stateRoot), access: 'write-directory', create: true }] }, { signal: o.signal });
        if (bootstrap.status !== 'ready') throw Object.assign(Error('State access unavailable'), { code: 'EIO' });
        const token = store.beginReadiness(o.stateRoot, identity, owner); report.owner = token.owner;
        if (!store.publishReadiness(o.stateRoot, token, report)) console.error('Factory readiness failure publication superseded');
      }
    }
    catch (writeError) { console.error(`Factory readiness report write failed: ${o.stateRoot}: ${safeErrno(writeError)}`); }
    return report;
  }
  function failure(error: unknown): ReadinessReport {
    const observedAt = new Date().toISOString();
    return { version: 1, identity, owner, phase: 'active', observedAt, status: 'blocked', checks: [{ id: 'host-launch', scope: 'project', phase: 'active', observedAt, status: 'blocked', required: true, operation, path: observedPath, errno: safeErrno(error), reason: 'Required host launch check failed; no cached readiness grants permission to start', nextActor: 'operator', nextAction: 'Inspect the reported source or access operation; Factory will check again on the next launch.', automaticRecheck: 'next-launch' }] };
  }
}
export function readinessReason(report: ReadinessReport): string | undefined {
  const project = report.checks.filter(c => c.scope === 'project' && c.required);
  if (!project.length) return 'project: required host observations are missing';
  return project.filter(c => c.status !== 'ready').map(c => `${c.scope}: ${c.operation} ${c.path}: ${c.errno ?? c.reason}`).join('; ') || undefined;
}
/** Append a bounded ticket-only observation to this invocation's project report, without manufacturing a run. */
export function recordTicketLaunch(stateRoot: string, report: ReadinessReport, iid: number, problem?: string): void {
  const id = `ticket:${iid}`;
  const observedAt = new Date().toISOString();
  const check = { id, ticket: String(iid), scope: 'ticket-workspace', phase: 'active', observedAt, status: problem ? 'blocked' : 'ready', required: true,
    operation: 'inspect-worktree-registration', path: report.identity.projectRoot,
    reason: (problem ?? 'Selected workspace checks passed').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 4000), nextActor: problem ? 'operator' : 'none',
    nextAction: problem ? 'Inspect this ticket source or workspace conflict; do not delete or adopt saved work. Factory checks again next pass.' : 'No action required', automaticRecheck: 'next-launch' } as const;
  recordReadinessCheck(stateRoot, report, check);
}
/** Publish the landed typed input hold or the exact already-frozen input. Never recollect just to report. */
export function recordTicketInput(stateRoot: string, report: ReadinessReport, input: FrozenTicketInput | TicketInputHold, expectedHash?: string): void {
  const changed = !('hold' in input) && expectedHash !== undefined && input.hash !== expectedHash;
  const iid = 'hold' in input ? input.hold.iid : input.context.child.iid;
  const check: ReadinessCheck = 'hold' in input ? input.check : {
    id: `ticket-input-${iid}`, ticket: String(iid), scope: 'ticket-input', phase: 'passive', observedAt: input.context.collection.completedAt,
    status: changed ? 'blocked' : 'ready', required: true, operation: changed ? 'compare-context-hash' : 'collect-child-parent-comments', path: input.context.child.url,
    reason: changed ? 'Included ticket or parent sources changed after the frozen input; fresh analysis/snapshot required' : 'Complete structured ticket input collected',
    nextActor: changed ? 'factory' : 'none', nextAction: changed ? 'Recollect and reassess this ticket on the next pass; preserve the frozen snapshot' : 'No action required', automaticRecheck: 'next-launch',
  };
  recordReadinessCheck(stateRoot, report, check);
}
/** Preserve project checks and the original generation. Collection is passive; publication belongs to this active launch phase. */
export function recordReadinessCheck(stateRoot: string, report: ReadinessReport, check: ReadinessCheck): void {
  report.checks = [...report.checks.filter(c => c.scope === 'project'), ...report.checks.filter(c => c.scope !== 'project' && c.id !== check.id && Date.parse(c.observedAt) > Date.now() - 60_000).slice(-100), { ...check, phase: report.phase }];
  report.status = reportStatus(report.checks);
  // Retain the observation's original generation. An older pass must not allocate a new token after observing.
  if (!store.publishReadiness(stateRoot, { identity: report.identity, owner: report.owner }, report)) throw Error('Ticket readiness publication superseded; launch held');
}
export const ticketBranch = (iid: number | string, title: string) => `${iid}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '')}`;
/** Read actual registrations, not just directory existence. Unrelated and dirty worktrees are valid. No repairs. */
export function ticketWorkspaceProblem(root: string, branch: string): string | undefined {
  try {
    const target = join(root, '.factory/worktrees', branch);
    const parent = dirname(target);
    if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) return `Unsafe worktree parent: ${parent}`;
    if (existsSync(target) || (() => { try { lstatSync(target); return true; } catch (e) { if (safeErrno(e) !== 'ENOENT') throw e; return false; } })()) return `Worktree location already exists: ${target}`;
    const prefix = `${branch.split('-')[0]}-`;
    const registrations = git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0\0');
    for (const record of registrations) {
      const fields = record.split('\0');
      if (fields.includes(`worktree ${target}`) || fields.some(f => f.startsWith(`branch refs/heads/${prefix}`))) return `Worktree registration conflicts with ${branch}: ${target}`;
    }
    const existing = git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin']).split('\n').find(x => x.replace(/^refs\/(heads|remotes\/origin)\//, '').startsWith(prefix));
    if (existing) return `Branch already exists: ${existing}`;
  } catch (error) { return `Cannot establish ticket workspace safety at ${root}: ${safeErrno(error)}`; }
}
