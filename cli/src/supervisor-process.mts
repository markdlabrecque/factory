// Own the original guard IPC endpoint, exact process/session evidence and private durable cleanup observations. Never kill reconstructed IDs or settle charges.
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, lstatSync, mkdirSync, realpathSync, openSync, closeSync, fstatSync, constants, fsyncSync, readSync } from 'node:fs';
import { join, resolve, relative, sep, dirname } from 'node:path';
import type { DiagnosisGrant } from './supervisor-advisory-contract.mts';
import { readSupervisorProjects } from './supervisor-state.mts';
import { advisoryDemand, advisoryRecord, advisoryTime, advisoryText, advisoryHash, validateAdvisoryOwner, validateDiagnosisGrant } from './supervisor-advisory-contract.mts';
const flat = existsSync(new URL('./admission.mts', import.meta.url));
const { withAdmissionLock, syncDirectory } = await import(flat ? './admission.mts' : '../../board/admission.mts');
const { supervisorHash, validateProject } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
export type ProcessIdentity = { pid: number; start: string; group: number; session: number };
export type ProcessEvidence = { version: 1; invocationId: string; fence: string; project: DiagnosisGrant['project'];
  runtime: string; dependencies: string; deadline: string; controller: ProcessIdentity; guard: ProcessIdentity; worker: ProcessIdentity };
export type CleanupEvidence = { version: 1; process: string; group: number; state: 'absent'; at: string };
/** Bounded parent-side capability/identity probe. The guard never runs ps or blocking disk work. */
export function processIdentity(pid: number): ProcessIdentity {
  advisoryDemand(Number.isSafeInteger(pid) && pid > 0, 'invalid process ID');
  if (process.platform === 'linux') {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8'), fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    advisoryDemand(fields[0] !== 'Z' && /^\d+$/.test(fields[19]), 'unknown live process identity');
    return { pid, start: `linux:${fields[19]}`, group: Number(fields[2]), session: Number(fields[3]) };
  }
  advisoryDemand(process.platform === 'darwin', 'unsupported owned-process platform');
  const env = { PATH: '/usr/bin:/bin', LANG: 'C' };
  let row: string;
  try {
    row = execFileSync('/bin/ps', ['-o','pgid=,sess=,stat=,lstart=','-p',String(pid)], { timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 4096, env, encoding: 'utf8' }).trim();
  } catch { throw Error('Advisory held: Darwin process/session probe unavailable'); }
  const match = row.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
  advisoryDemand(match && !match[3].startsWith('Z'), 'unsupported Darwin process/session evidence');
  return { pid, start: `ps:${match[4]}`, group: Number(match[1]), session: Number(match[2]) };
}
/** Signal zero is observation ONLY; even a reused/unknown group is held, never signalled. */
export function groupAbsent(group: number): boolean {
  if (!Number.isSafeInteger(group) || group <= 1) return false;
  try { process.kill(-group, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
}
export function validateProcessEvidence(v: any): ProcessEvidence {
  advisoryRecord(v, ['version','invocationId','fence','project','runtime','dependencies','deadline','controller','guard','worker']);
  validateProject(v.project);
  advisoryDemand(advisoryText(v.invocationId) && advisoryText(v.fence) && advisoryHash(v.runtime) && advisoryHash(v.dependencies), 'incomplete process binding');
  for (const i of [v.controller,v.guard,v.worker]) {
    advisoryRecord(i, ['pid','start','group','session']); validateAdvisoryOwner({ pid: i.pid, start: i.start });
    advisoryDemand(Number.isSafeInteger(i.group) && i.group > 1 && Number.isSafeInteger(i.session) && i.session > 1, 'unknown group/session');
  }
  advisoryDemand(v.version === 1 && advisoryTime(v.deadline) && v.guard.pid === v.guard.group && v.guard.pid === v.guard.session
    && v.worker.group === v.guard.group && v.worker.session === v.guard.session && v.worker.pid !== v.guard.pid
    && v.controller.group !== v.guard.group && v.controller.pid !== v.guard.pid && v.controller.pid !== v.worker.pid, 'not an isolated anchored group');
  return v;
}
function store(stateDir: string, project: DiagnosisGrant['project'], invocationId: string, create: boolean) {
  advisoryDemand(typeof process.getuid === 'function' && resolve(stateDir) === stateDir && realpathSync(stateDir) === stateDir, 'canonical host process store required');
  for (const p of [project, ...readSupervisorProjects(stateDir).map(s => s.project)]) {
    const rel = relative(p.root, stateDir); advisoryDemand(rel === '..' || rel.startsWith(`..${sep}`), 'process store inside project');
  }
  let dir = stateDir;
  const st = lstatSync(dir); advisoryDemand(st.isDirectory() && st.uid === process.getuid() && !(st.mode & 0o022), 'unsafe host process root');
  for (const part of ['supervisor','process',supervisorHash(project),supervisorHash(invocationId),'admission']) {
    dir = join(dir,part);
    if (create) try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const stat = lstatSync(dir); advisoryDemand(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && !(stat.mode & 0o077), 'unsafe private process store');
  }
  // The final segment is the lock directory, validated before withAdmissionLock can use it.
  return dirname(dir);
}
function readRecord(dir: string, name: string) {
  const fd = openSync(join(dir,name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd); advisoryDemand(s.isFile() && s.nlink === 1 && s.uid === process.getuid!() && !(s.mode & 0o077) && s.size > 0 && s.size <= 16384, 'unsafe process receipt');
    const bytes = Buffer.alloc(16385), count = readSync(fd,bytes,0,bytes.length,0), after = fstatSync(fd);
    advisoryDemand(count === s.size && after.size === s.size && after.mtimeMs === s.mtimeMs && after.ctimeMs === s.ctimeMs, 'process receipt changed');
    fsyncSync(fd); syncDirectory(dir); return JSON.parse(bytes.subarray(0,count).toString('utf8'));
  } finally { closeSync(fd); }
}
function publish(dir: string, name: string, value: unknown) {
  withAdmissionLock(dir, write => {
    let previous: any;
    try { lstatSync(join(dir,name)); previous = readRecord(dir,name); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (previous !== undefined) advisoryDemand(supervisorHash(previous) === supervisorHash(value), 'conflicting immutable process receipt');
    else write(join(dir,name), JSON.stringify(value) + '\n');
    advisoryDemand(supervisorHash(readRecord(dir,name)) === supervisorHash(value), 'process receipt publication mismatch');
  }, -1);
}
export function readOwnedProcess(stateDir: string, g: DiagnosisGrant): ProcessEvidence {
  validateDiagnosisGrant(g);
  const v = validateProcessEvidence(readRecord(store(stateDir,g.project,g.invocationId,false),'process.json'));
  advisoryDemand(v.invocationId === g.invocationId && v.fence === g.fence && supervisorHash(v.project) === supervisorHash(g.project)
    && v.runtime === g.runtime && v.dependencies === g.dependencies && v.deadline === g.deadline
    && v.worker.pid === g.owner.pid && v.worker.start === g.owner.start, 'process/grant mismatch');
  return v;
}
/** Reopen is observation-only. Missing metadata, live/reused group or I/O uncertainty stays held. Never sends or kills. */
export function confirmOwnedCleanup(stateDir: string, g: DiagnosisGrant): boolean {
  try {
    const v = readOwnedProcess(stateDir,g), dir = store(stateDir,g.project,g.invocationId,false);
    if (!groupAbsent(v.guard.group)) return false;
    let receipt: CleanupEvidence;
    try { receipt = readRecord(dir,'cleanup.json'); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      receipt = { version: 1, process: supervisorHash(v), group: v.guard.group, state: 'absent', at: new Date().toISOString() };
      publish(dir,'cleanup.json',receipt);
    }
    advisoryRecord(receipt,['version','process','group','state','at']);
    return receipt.version === 1 && receipt.process === supervisorHash(v) && receipt.group === v.guard.group && receipt.state === 'absent' && advisoryTime(receipt.at);
  } catch { return false; }
}
/** Strict durable cleanup reference, after a fresh whole-group absence check. No caller attestation. */
export function readOwnedCleanup(stateDir: string, g: DiagnosisGrant): CleanupEvidence {
  advisoryDemand(confirmOwnedCleanup(stateDir,g), 'whole-group cleanup missing or unknown');
  const v = readRecord(store(stateDir,g.project,g.invocationId,false),'cleanup.json') as CleanupEvidence;
  const p = readOwnedProcess(stateDir,g);
  advisoryRecord(v,['version','process','group','state','at']);
  advisoryDemand(v.version === 1 && v.process === supervisorHash(p) && v.group === p.guard.group
    && v.state === 'absent' && advisoryTime(v.at), 'invalid cleanup receipt');
  return v;
}
export type OwnedProcess = { child: ChildProcess; evidence: ProcessEvidence; handoff(request: unknown): void; terminate(): Promise<boolean> };
/** Launch only the inventoried runner and guard. No caller-selected executable, argv, environment or provider seam. */
export async function startOwnedProcess(o: { runtimeRoot: string; stateDir: string; project: DiagnosisGrant['project']; invocationId: string;
  fence: string; runtime: string; dependencies: string; deadline: string; cwd: string; maxOutputBytes: number }): Promise<OwnedProcess> {
  advisoryDemand(advisoryTime(o.deadline) && Date.parse(o.deadline) > Date.now() && Date.parse(o.deadline) - Date.now() <= 600_000, 'finite child deadline required');
  const controller = processIdentity(process.pid), dir = store(o.stateDir,o.project,o.invocationId,true);
  const child = spawn(process.execPath, [join(o.runtimeRoot,'supervisor-guard.mjs'),join(o.runtimeRoot,'supervisor-runner.mts'),String(Date.parse(o.deadline)),String(o.maxOutputBytes)], {
    detached: true, cwd: o.cwd, env: { PATH: '/usr/bin:/bin', HOME: o.cwd, LANG: 'C' }, stdio: ['ignore','pipe','pipe','ipc'],
  });
  // Always drain with fixed retained bounds; a caller not consuming output cannot grow controller memory.
  let stdout = 0, stderr = 0;
  const stop = () => { if (child.connected) child.send({ kind: 'terminate' }, () => {}); };
  child.stdout!.on('data', b => { stdout += b.length; if (stdout > o.maxOutputBytes) stop(); });
  child.stderr!.on('data', b => { stderr += b.length; if (stderr > 8192) stop(); });
  const closed = new Promise<void>(accept => { child.once('close', () => accept()); child.once('error', () => accept()); });
  try {
    const workerPID = await new Promise<number>((accept,reject) => {
      child.once('error',reject); child.once('exit',() => reject(Error('Advisory held: guard exited before ready')));
      child.once('message',(m: any) => m?.kind === 'ready' && Object.keys(m).length === 2 && Number.isSafeInteger(m.worker)
        ? accept(m.worker) : reject(Error('Advisory held: invalid readiness')));
    });
    const evidence = validateProcessEvidence({ version: 1, invocationId: o.invocationId, fence: o.fence, project: o.project,
      runtime: o.runtime, dependencies: o.dependencies, deadline: o.deadline, controller, guard: processIdentity(child.pid!), worker: processIdentity(workerPID) });
    publish(dir,'process.json',evidence); // Must succeed BEFORE caller registers grant or receives a handoff capability.
    let handed = false, terminated: Promise<boolean> | undefined;
    return { child, evidence, handoff(request) {
      advisoryDemand(!handed && child.connected && Date.now() < Date.parse(o.deadline), 'handoff already spent or expired'); handed = true;
      child.send({ kind: 'handoff', request, maxOutputBytes: o.maxOutputBytes }, e => { if (e) stop(); });
    }, terminate() {
      return terminated ??= (async () => { stop(); await closed; return groupAbsent(evidence.guard.group); })();
    } };
  } catch (e) { stop(); await closed; throw e; }
}
