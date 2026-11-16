// CLI host adapter for bounded local supervisor observations. No refresh, reconciliation, locks, cleanup or writes.
// Selected tickets, authorization, runtime and readiness are supplied by the host; absence remains unknown.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { admissionFile, keyFor, ownerState, readAdmission } from '../../board/admission.mts';
import type { Owner } from '../../board/admission.mts';
import type { RunState } from '../../board/board.mts';
import type { Assessment } from '../../board/assessment.mts';
import type { Manifest } from '../../orchestrator/graph.mts';
import { recoverySummary } from './commands/recovery.mts';
import { projectFollowups } from './recovery-followup.mts';
import { readRecovery, recoveryFile } from './recovery-state.mts';
import { runStateDir } from './runs.mts';
import type { ProjectContext } from './runs.mts';
import type { Paths } from './paths.mts';
import { FACT_LIMITS, observed, unavailable, projectSupervisorFacts } from './supervisor-facts.mts';
import type { FactInputs, Observation } from './supervisor-facts.mts';
const MAX_BYTES = 2 * 1024 * 1024;
function json(file: string): { value: any; at: string } {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw Error('Unsafe or oversized local observation');
  return { value: JSON.parse(readFileSync(file, 'utf8')), at: stat.mtime.toISOString() };
}
function capture<T>(source: string, read: () => { value: T; at: string }): Observation<T> {
  try { const result = read(); return observed(source, 'saved', result.at, result.value); }
  catch (e) { return unavailable(source, (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown', 'Local source unavailable or invalid; no authority inferred.'); }
}
/** Read only this project's records; do not use permissive status readers which silently skip corrupt files. */
function records<T>(dir: string, project: string, valid: (x: any) => boolean): { value: T[]; at: string } {
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Unsafe observation directory');
  const names = readdirSync(dir).filter(n => n.startsWith(keyFor('', project)) && n.endsWith('.json')).sort();
  if (names.length > FACT_LIMITS.tickets) throw Error('Observation record bound exceeded');
  const results = names.map(name => { const result = json(join(dir, name)); if (!valid(result.value)) throw Error('Invalid record'); return result; });
  return { value: results.map(r => r.value), at: results.map(r => r.at).sort().at(-1) ?? stat.mtime.toISOString() };
}
const stages = ['queued','waiting','setup','implementing','verifying','posting','pushing','ci','done','stopped'];
const optionalText = (x: unknown) => x === undefined || typeof x === 'string';
function validRun(r: any, tracker: string): boolean {
  return r && r.project === tracker && /^[1-9]\d*$/.test(r.iid) && stages.includes(r.stage)
    && ['branch','evidenceDir','mr','executionId','updatedAt'].every(k => optionalText(r[k]))
    && (r.mergedAt === undefined || typeof r.mergedAt === 'string' && Number.isFinite(Date.parse(r.mergedAt)))
    && (!r.stageHistory || Array.isArray(r.stageHistory) && r.stageHistory.length <= FACT_LIMITS.items && r.stageHistory.every((s: any) => s && stages.includes(s.stage) && typeof s.at === 'string'))
    && (!r.queueReasons || Array.isArray(r.queueReasons) && r.queueReasons.length <= FACT_LIMITS.items && r.queueReasons.every((s: any) => s && typeof s.code === 'string'))
    && (!r.verification || typeof r.verification.id === 'string' && typeof r.verification.tip === 'string');
}
export type HostFactOptions = Pick<FactInputs, 'project' | 'scope'> & Partial<Pick<FactInputs, 'selected' | 'authorization' | 'runtime' | 'readiness'>> & {
  now: () => string; owner?: (owner: Owner) => 'alive' | 'dead' | 'unknown';
};
/** Local disk/process reads only. An injected owner observer and clock make repeated projection deterministic.
 * No tracker client is accepted here; exhaustive original ticket input is a separate explicit collection API. */
export function readSupervisorFacts(p: Paths, ctx: ProjectContext, o: HostFactOptions) {
  if (o.project.root !== ctx.root || o.project.tracker.project !== ctx.tracker) throw Error('Supervisor project identity mismatch');
  const at = o.now(), dir = runStateDir(p), owner = o.owner ?? ownerState;
  const runs = capture<RunState[]>(dir, () => records(dir, ctx.tracker, r => validRun(r, ctx.tracker)));
  const claims = capture<FactInputs['claims'] extends Observation<infer T> ? T : never>(admissionFile(dir), () => {
    const raw = json(admissionFile(dir)); // distinguish absent admission from authoritative empty admission
    const state = readAdmission(dir), all = Object.values(state.claims).filter(c => c.project === ctx.tracker);
    if (all.length > FACT_LIMITS.items) throw Error('Claim bound exceeded');
    return { at: raw.at, value: all.map(claim => ({ claim, owner: owner(claim.owner) })) };
  });
  // Owner reads are live even though the claims themselves were saved; stamp the combined observation now.
  if (claims.status === 'known') { claims.kind = 'live'; claims.observedAt = at; }
  const recovery = capture(recoveryFile(p, ctx.root), () => {
    const raw = json(recoveryFile(p, ctx.root));
    const summary = recoverySummary(p, ctx);
    if (summary.problem || runs.status !== 'known' || claims.status !== 'known') throw Error('Incomplete recovery observations');
    const state = readRecovery(p, ctx.root);
    summary.followups = projectFollowups({ recovery: state, runs: runs.value, claims: claims.value.map(c => c.claim), owners: Object.fromEntries(claims.value.map(c => [c.claim.token, c.owner])), at,
      paused: o.authorization?.status === 'known' && o.authorization.value.project === 'enabled' ? undefined : 'Project authorization is paused or unknown.' });
    return { value: summary, at: raw.at };
  });
  const assessments = capture<Assessment[]>(join(dir, 'assessment'), () => records(join(dir, 'assessment'), ctx.tracker, a => a && a.project === ctx.tracker && /^[1-9]\d*$/.test(a.iid) && (!a.dependencies || Array.isArray(a.dependencies) && a.dependencies.length <= FACT_LIMITS.items && a.dependencies.every((d: any) => d && (d.iid === null || Number.isSafeInteger(d.iid) && d.iid > 0) && ['satisfied','unsatisfied','unknown'].includes(d.state)))));
  const graph = capture<Manifest[]>(join(dir, 'graph'), () => records(join(dir, 'graph'), ctx.tracker, g => g && g.project === ctx.tracker && Number.isSafeInteger(g.iid) && g.iid > 0 && Array.isArray(g.footprint) && g.footprint.length <= FACT_LIMITS.items && g.footprint.every((s: unknown) => typeof s === 'string' && s.length <= 1024) && (!g.actualFootprint || Array.isArray(g.actualFootprint) && g.actualFootprint.length <= FACT_LIMITS.items && g.actualFootprint.every((s: unknown) => typeof s === 'string' && s.length <= 1024))));
  return projectSupervisorFacts({ project: o.project, scope: o.scope, at, runs, claims, recovery, assessments, graph,
    selected: o.selected ?? unavailable('selection', 'unknown', 'No current host selection supplied.'),
    authorization: o.authorization ?? unavailable('authorization', 'unknown', 'No current host authorization supplied.'),
    runtime: o.runtime ?? unavailable('runtime', 'unknown', 'No selected runtime identity supplied.'),
    readiness: o.readiness ?? unavailable('readiness', 'unknown', 'No saved readiness observation supplied.') });
}
