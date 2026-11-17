// Read-only private operator rollout attestations. Human quiescence assertions are not automated custody or spending authority.
import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { advisoryDemand, advisoryRecord, advisoryHash, advisoryTime } from './supervisor-advisory-contract.mts';
import type { ProjectIdentity } from '../../orchestrator/supervisor-contract.mts';
const { supervisorHash, validateProject } = await import(existsSync(new URL('./supervisor-contract.mts', import.meta.url)) ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
export type RolloutBinding = { project: ProjectIdentity; host: string; hostDependencies: string; selected: string; dependencies: string };
export type RolloutAttestation = RolloutBinding & { version: 1; recordedAt: string; expiresAt: string; olderRuntimesQuiesced: true; unmanagedWorkQuiesced: true };
export type RolloutPin = { identity: string; expiresAt: string };
export function validateRolloutPin(p: any): RolloutPin {
  advisoryRecord(p,['identity','expiresAt']);
  advisoryDemand(advisoryHash(p.identity) && advisoryTime(p.expiresAt),'invalid rollout pin'); return p;
}
export function validateRolloutAttestation(r: any, expected: RolloutBinding, now = Date.now()): RolloutAttestation {
  advisoryRecord(r,['version','project','host','hostDependencies','selected','dependencies','recordedAt','expiresAt','olderRuntimesQuiesced','unmanagedWorkQuiesced']);
  validateProject(r.project);
  advisoryDemand(r.version === 1 && r.olderRuntimesQuiesced === true && r.unmanagedWorkQuiesced === true
    && ['host','hostDependencies','selected','dependencies'].every(k => advisoryHash(r[k]))
    && supervisorHash({project:r.project,host:r.host,hostDependencies:r.hostDependencies,selected:r.selected,dependencies:r.dependencies}) === supervisorHash(expected),
    'rollout attestation is unsupported or belongs to another project/runtime');
  advisoryDemand(advisoryTime(r.recordedAt) && advisoryTime(r.expiresAt) && Date.parse(r.recordedAt) <= now
    && Date.parse(r.expiresAt) > now && Date.parse(r.expiresAt) > Date.parse(r.recordedAt)
    && Date.parse(r.expiresAt) - Date.parse(r.recordedAt) <= 86400000, 'rollout attestation is future-recorded, stale, expired or exceeds 24 hours');
  return r;
}
export function assertRolloutWindow(pin: RolloutPin, at: string, timeoutMs: number): void {
  validateRolloutPin(pin);
  advisoryDemand(advisoryTime(at) && Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    && Date.parse(pin.expiresAt) >= Date.parse(at) + timeoutMs,'rollout attestation has insufficient full diagnosis window');
}
/** No writes, symlink following, blocking special-file opens, fallback paths or caller-provided authority. */
export function readSupervisorRollout(config: string, expected: RolloutBinding, excludedRoots: readonly string[], now = Date.now()): RolloutPin {
  advisoryDemand(typeof process.getuid === 'function' && isAbsolute(config) && resolve(config) === config && realpathSync(config) === config
    && excludedRoots.length > 0, 'canonical private rollout directory required');
  const file = join(config,'supervisor-rollout.json');
  for (const root of excludedRoots) {
    advisoryDemand(isAbsolute(root) && resolve(root) === root && realpathSync(root) === root,'canonical rollout excluded root required');
    const rel = relative(root,file);
    advisoryDemand(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel),'rollout record is inside a project/runtime mount');
  }
  const directory = lstatSync(config), uid = process.getuid!();
  advisoryDemand(directory.isDirectory() && directory.uid === uid && (directory.mode & 0o7777) === 0o700,'rollout directory must be current-owner mode 0700');
  const fd = openSync(file,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    advisoryDemand(before.isFile() && before.uid === uid && (before.mode & 0o7777) === 0o600 && before.nlink === 1
      && before.size > 0 && before.size <= 16384,'rollout record must be current-owner regular unlinked mode 0600 bounded data');
    const buffer = Buffer.alloc(16385), count = readSync(fd,buffer,0,buffer.length,0), after = fstatSync(fd);
    const named = lstatSync(file), parent = lstatSync(config);
    advisoryDemand(count === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
      && named.ino === before.ino && named.dev === before.dev && named.ctimeMs === before.ctimeMs
      && parent.ino === directory.ino && parent.dev === directory.dev && parent.ctimeMs === directory.ctimeMs
      && realpathSync(file) === file,'rollout record changed during read');
    const text = new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count));
    const record = validateRolloutAttestation(JSON.parse(text),expected,now);
    return {identity:supervisorHash({text,dev:before.dev,ino:before.ino,mtime:before.mtimeMs,ctime:before.ctimeMs}),expiresAt:record.expiresAt};
  } finally { closeSync(fd); }
}
