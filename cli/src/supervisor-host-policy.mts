// Read-only host-owned advisory policy and cumulative preflight. No defaults, reset, provisioning, or authorization effects.
import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { ADVISORY_PROFILE_ID, advisoryReservation, advisoryCount, advisoryDemand, advisoryRecord } from './supervisor-advisory-contract.mts';
import type { SupervisorPolicy } from '../../orchestrator/supervisor-policy.mts';
import { usdCeilingMicroUSD } from './supervisor-advisory-contract.mts';
const { supervisorHash } = await import(existsSync(new URL('./supervisor-contract.mts', import.meta.url)) ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
export type AdvisoryCeiling = { tokens: number; cost: number; calls: number };
export type HostAdvisoryPolicy = { version: 1; enabled: true; profile: string; capacity: 1; cumulative: AdvisoryCeiling };
export function validateHostAdvisoryPolicy(p: any): HostAdvisoryPolicy {
  advisoryRecord(p, ['version','enabled','profile','capacity','cumulative']); advisoryRecord(p.cumulative, ['tokens','cost','calls']);
  advisoryDemand(p.version === 1 && p.enabled === true && p.capacity === 1 && p.profile === ADVISORY_PROFILE_ID
    && ['tokens','cost','calls'].every(k => advisoryCount(p.cumulative[k]) && p.cumulative[k] > 0), 'explicit enabled known profile and finite host ceilings/capacity one required'); return p;
}
export const hostAdvisoryPolicyIdentity = (p: HostAdvisoryPolicy) => supervisorHash(validateHostAdvisoryPolicy(p));
/** Trusted host supplies every project/agent mount root; unreadable/malformed/path/permission uncertainty throws held. */
export function readHostAdvisoryPolicy(config: string, excludedRoots: readonly string[]) {
  advisoryDemand(typeof process.getuid === 'function' && isAbsolute(config) && resolve(config) === config
    && realpathSync(config) === config && excludedRoots.length > 0, 'canonical host-only config directory and known mount roots required');
  const file = join(config, 'supervisor.json');
  for (const root of excludedRoots) {
    advisoryDemand(isAbsolute(root) && resolve(root) === root && realpathSync(root) === root, 'canonical excluded mount root required');
    const rel = relative(root, file); advisoryDemand(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel), 'host policy is inside a project/agent mount');
  }
  const directory = lstatSync(config);
  advisoryDemand(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid() && (directory.mode & 0o077) === 0,
    'host policy directory must be owner-only');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    advisoryDemand(before.isFile() && before.uid === process.getuid() && (before.mode & 0o077) === 0 && before.nlink === 1
      && before.size > 0 && before.size <= 16384, 'host policy must be a bounded private owner-owned nonlinked file');
    const buffer = Buffer.alloc(16385), count = readSync(fd, buffer, 0, buffer.length, 0), after = fstatSync(fd);
    const currentDirectory = lstatSync(config);
    advisoryDemand(count === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
      && currentDirectory.ino === directory.ino && currentDirectory.dev === directory.dev && realpathSync(file) === file,
      'host policy changed during read');
    const text = buffer.subarray(0, count).toString('utf8');
    const policy = validateHostAdvisoryPolicy(JSON.parse(text));
    return { policy, identity: hostAdvisoryPolicyIdentity(policy), file };
  } finally { closeSync(fd); }
}
/** Checked again under the supervisor journal lock, including every legacy reservation and all role charges. */
export function advisoryLimitHold(o: { host: HostAdvisoryPolicy; project: SupervisorPolicy; hostUsed: AdvisoryCeiling; projectUsed: AdvisoryCeiling;
  roleUsed: AdvisoryCeiling; active: number; incidentCalls: number; registered: boolean; global: 'on' | 'off' | 'unknown';
  projectControl: 'enabled' | 'paused' | 'unknown'; mode: 'observe' | 'act' | 'stopped' }): string | undefined {
  try {
    const h = validateHostAdvisoryPolicy(o.host), p = o.project;
    advisoryDemand(o.registered === true && o.global === 'on' && o.projectControl === 'enabled' && ['observe','act'].includes(o.mode), 'registration/operator controls hold advisory work');
    advisoryDemand(p?.enabled === true && p.limits && p.limits.diagnosis && p.limits.review, 'all existing project/role limits required');
    const caps = [p.limits, p.limits.diagnosis];
    for (const role of [p.limits.diagnosis, p.limits.review]) {
      advisoryDemand(advisoryCount(role.maxTokens) && role.maxTokens > 0 && advisoryCount(role.maxCalls) && role.maxCalls > 0
        && advisoryCount(role.timeoutSeconds) && role.timeoutSeconds > 0 && role.timeoutSeconds <= 600
        && role.maxTokens <= p.limits.maxTokens && role.maxCalls <= p.limits.maxCalls
        && usdCeilingMicroUSD(role.maxCostUsd) <= usdCeilingMicroUSD(p.limits.maxCostUsd), 'invalid project/review role ceilings');
    }
    const used = [o.hostUsed, o.projectUsed, o.roleUsed];
    for (const u of used) { advisoryRecord(u, ['tokens','cost','calls']); advisoryDemand(Object.values(u).every(advisoryCount), 'unknown cumulative usage'); }
    advisoryDemand(['tokens','cost','calls'].every(k => o.roleUsed[k as keyof AdvisoryCeiling] <= o.projectUsed[k as keyof AdvisoryCeiling]
      && o.projectUsed[k as keyof AdvisoryCeiling] <= o.hostUsed[k as keyof AdvisoryCeiling]), 'inconsistent cumulative accounting');
    advisoryDemand(advisoryCount(o.active) && o.active < h.capacity && advisoryCount(o.incidentCalls) && o.incidentCalls < 2, 'capacity or incident allowance held');
    const reservation = { ...advisoryReservation(), calls: 1 };
    const ceilings = [h.cumulative, ...caps.map(c => ({ tokens: c.maxTokens, cost: usdCeilingMicroUSD(c.maxCostUsd), calls: c.maxCalls }))];
    for (let i = 0; i < ceilings.length; i++) for (const unit of ['tokens','cost','calls'] as const)
      advisoryDemand(advisoryCount(ceilings[i][unit]) && ceilings[i][unit] > 0 && Number.isSafeInteger(used[i][unit] + reservation[unit])
        && used[i][unit] + reservation[unit] <= ceilings[i][unit], 'cumulative host/project/role ceiling exhausted');
    return undefined;
  } catch (e) { return (e as Error).message; }
}
