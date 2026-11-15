// Bounded actual-container-user probes and shared reports. No ownership repairs or real Git index writes.
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import type { Proc } from './recovery-sandbox.mts';
import { reportStatus, validReport, safeErrno, type ReadinessIdentity, type ReadinessReport } from './readiness-schema.mts';
const store = await import(existsSync(new URL('./readiness-store.mts', import.meta.url)) ? './readiness-store.mts' : '../board/readiness.mts');

export interface SandboxProbeInput {
  container: string;
  state: string;
  identity: ReadinessIdentity;
  invocationId: string;
  baseline: string;
  tip: string;
  evidence: string;
  uid: number;
  gid: number;
  /** Checkout-relative canonical files and, for frozen instruction files, their SHA-256. */
  files: Record<string, string | null>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Self-contained Node program, also executed by offline local-Git fixtures. No shell interpolation. */
export const SANDBOX_PROBE_PROGRAM = String.raw`
const fs = require('node:fs'), p = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const input = JSON.parse(process.argv[1]);
const checks = [], owned = [];
let operation = 'identity', path = '', before, identity, workspace, metadata, index;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const error = code => Object.assign(Error(code), {code});
const git = (args, env = {}) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.splitIndex=false', ...args], {encoding:'utf8', timeout:1500, maxBuffer:4*1024*1024, env:{...process.env, GIT_OPTIONAL_LOCKS:'0', ...env}, stdio:['ignore','pipe','pipe']});
const errno = e => /^[A-Z][A-Z0-9_]{0,39}$/.test(e.code || '') ? e.code : e.signal ? 'ETIMEDOUT' : 'EGIT';
const add = (id, status, reason, code) => checks.push({id, status, operation, path, reason, ...(code ? {errno:code} : {})});
const pin = dir => {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  const stat = fs.fstatSync(fd);
  if (fs.realpathSync(dir) !== dir) { fs.closeSync(fd); throw error('EUNSAFEPATH'); }
  return {fd, dir, stat};
};
const verify = o => {
  const s = fs.lstatSync(o.dir);
  if (s.isSymbolicLink() || s.dev !== o.stat.dev || s.ino !== o.stat.ino || fs.realpathSync(o.dir) !== o.dir) throw error('ESTALE');
};
const fdPath = fd => '/proc/self/fd/'+fd;
const privateDir = dir => {
  const parent = pin(dir);
  let created = false;
  try {
    verify(parent);
    const name = '.factory-readiness-'+crypto.randomUUID();
    fs.mkdirSync(p.join(fdPath(parent.fd),name), {mode:0o700}); created = true;
    const child = pin(p.join(dir,name));
    const o = {parent, child, name}; owned.push(o); return child;
  } catch(e) {
    if(created) add('cleanup-failure','blocked','private probe directory could not be pinned; cleanup unconfirmed',errno(e));
    fs.closeSync(parent.fd); throw e;
  }
};
const writeProbe = dir => {
  const temp = privateDir(dir);
  const a = p.join(fdPath(temp.fd),'write'), b = p.join(fdPath(temp.fd),'renamed');
  verify(temp);
  const fd = fs.openSync(a, fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  try {verify(temp); fs.writeFileSync(fd,'factory readiness\n'); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  verify(temp); fs.renameSync(a,b); verify(temp); fs.unlinkSync(b);
};
const indexHash = () => {
  let fd;
  try {fd = fs.openSync(index,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
  catch(e) {if(e.code === 'ENOENT') return null; throw e;}
  try {
    const s = fs.fstatSync(fd); if(!s.isFile()) throw error('EUNSAFEPATH');
    const h = crypto.createHash('sha256'), buffer = Buffer.alloc(65536); let n = 0;
    while(n < s.size) {const count = fs.readSync(fd,buffer,0,Math.min(buffer.length,s.size-n),n); if(!count) throw error('ESTALE'); h.update(buffer.subarray(0,count)); n += count;}
    if(fs.fstatSync(fd).size !== s.size) throw error('ESTALE');
    return h.digest('hex');
  } finally {fs.closeSync(fd);}
};
const snapshot = () => hash(JSON.stringify([git(['rev-parse','HEAD']),git(['status','--porcelain=v1','--untracked-files=all']),git(['diff','--no-ext-diff','--no-textconv','--binary']),git(['diff','--cached','--no-ext-diff','--no-textconv','--binary']),git(['show-ref','--head']),indexHash()]));
try {
  identity = {uid:process.getuid(),gid:process.getgid()};
  if(identity.uid !== input.uid || identity.gid !== input.gid) throw error('EIDENTITY');
  workspace = fs.realpathSync(process.cwd()); path = workspace;
  add('identity','ready','effective uid='+identity.uid+' gid='+identity.gid);
  operation = 'resolve-git-paths';
  if(fs.realpathSync(git(['rev-parse','--show-toplevel']).trim()) !== workspace) throw error('EUNSAFEPATH');
  metadata = fs.realpathSync(git(['rev-parse','--absolute-git-dir']).trim());
  index = git(['rev-parse','--path-format=absolute','--git-path','index']).trim();
  if(!p.isAbsolute(index) || p.dirname(index) !== fs.realpathSync(p.dirname(index))) throw error('EUNSAFEPATH');
  add('git-paths','ready','git-dir='+metadata+' index='+index);
  operation = 'snapshot-before'; before = snapshot();
  operation = 'read-required-file';
  for(const [file,expected] of Object.entries(input.files)) {
    path = p.resolve(workspace,file);
    if(p.isAbsolute(file) || p.relative(workspace,path).startsWith('..') || fs.realpathSync(path) !== path) throw error('EUNSAFEPATH');
    const fd = fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try {
      const s = fs.fstatSync(fd); if(!s.isFile() || s.size > 1024*1024) throw error('EINVAL');
      const buffer = Buffer.alloc(1024*1024+1); let n = 0, count;
      while(n < buffer.length && (count = fs.readSync(fd,buffer,n,buffer.length-n,null)) > 0) n += count;
      if(n > 1024*1024) throw error('EFBIG');
      if(expected && hash(buffer.subarray(0,n)) !== expected) throw error('ESTALE');
    } finally {fs.closeSync(fd);}
  }
  add('required-files','ready','required checkout/configured instruction files readable');
  operation = 'resolve-baseline-tip'; path = metadata;
  for(const sha of [input.baseline,input.tip]) {
    if(!/^[a-f0-9]{40,64}$/.test(sha) || git(['rev-parse','--verify',sha+'^{commit}']).trim() !== sha) throw error('EMISSINGBASELINE');
  }
  if(git(['rev-parse','HEAD']).trim() !== input.tip) throw error('ESTALE');
  add('baseline-tip','ready','exact baseline and starting tip resolved');
  operation = 'workspace-create-write-rename-remove'; path = workspace; writeProbe(workspace);
  add('workspace-write','ready','private workspace write/rename/remove succeeded');
  operation = 'evidence-create-write-rename-remove'; path = input.evidence;
  if(!p.isAbsolute(path) || fs.realpathSync(path) !== path) throw error('EUNSAFEPATH');
  writeProbe(path); add('evidence-write','ready','private evidence write/rename/remove succeeded');
  operation = 'alternate-index-read-tree'; path = p.dirname(index);
  const temp = privateDir(path);
  // Git is a child process, so use the probe process's pinned descriptor, not the child's /proc/self.
  const alternate = p.join('/proc/'+process.pid+'/fd/'+temp.fd,'index');
  verify(temp); git(['read-tree',input.baseline], {GIT_INDEX_FILE:alternate});
  verify(temp); git(['ls-files','--stage'], {GIT_INDEX_FILE:alternate});
  verify(temp); fs.unlinkSync(alternate);
  add('git-index-write','ready','disposable alternate index read-tree succeeded; real index/refs untouched');
} catch(e) {add('probe-failure','blocked','required sandbox operation failed',errno(e));}
finally {
  operation = 'cleanup-owned-probes'; path = workspace || '';
  let failed = checks.some(c => c.id === 'cleanup-failure');
  for(const o of owned.reverse()) {
    try {
      verify(o.parent); verify(o.child);
      // Only known files within an inode-pinned private directory. Never recursive deletion.
      for(const name of ['write','renamed','index','index.lock']) {
        const file = p.join(fdPath(o.child.fd),name);
        try {const s = fs.lstatSync(file); if(!s.isFile() || s.uid !== input.uid) throw error('ESTALE'); fs.unlinkSync(file);} catch(e) {if(e.code !== 'ENOENT') throw e;}
      }
      fs.rmdirSync(p.join(fdPath(o.parent.fd),o.name));
    } catch(e) {failed = true; add('cleanup-failure','blocked','owned probe cleanup unconfirmed',errno(e));}
    finally {fs.closeSync(o.child.fd); fs.closeSync(o.parent.fd);}
  }
  if(!failed) add('probe-cleanup','ready','owned probes removed');
  operation = 'preserve-index-status-diffs-refs'; path = workspace || '';
  if(before) {
    try {if(snapshot() !== before) throw error('EWORKCHANGED'); add('work-preservation','ready','real index, HEAD, status, staged/unstaged diffs and refs unchanged');}
    catch(e) {add('work-preservation','blocked','work preservation could not be confirmed',errno(e));}
  } else add('work-preservation','unknown','initial snapshot unavailable');
}
process.stdout.write(JSON.stringify({checks,identity,workspace,metadata,index}));
`;

// SIGKILL bounds even an uncooperative Docker client. Container teardown is a separate owned operation.
const boundedDocker: Proc = (cmd, args, o = {}) => new Promise((accept, reject) => {
  execFile(cmd, args, { signal: o.signal, timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error && typeof error.code !== 'number') reject(error);
    else accept({ status: error ? Number(error.code) : 0, stdout, stderr });
  });
});

/** Runs under the container's default agent identity, never sudo. A timeout/cancel still requires owned teardown. */
export async function probeSandbox(input: SandboxProbeInput, proc: Proc = boundedDocker): Promise<ReadinessReport> {
  if (!input.container || !/^[A-Za-z0-9_.-]+$/.test(input.container)) throw Error('Missing exact sandbox container identity');
  const token = store.beginReadiness(input.state, input.identity, { invocationId: input.invocationId, ownerId: input.container });
  const observedAt = new Date().toISOString();
  let facts: any;
  try {
    const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(input.timeoutMs ?? 15_000)]);
    const r = await proc('docker', ['exec', input.container, 'node', '-e', SANDBOX_PROBE_PROGRAM,
      JSON.stringify({ uid: input.uid, gid: input.gid, files: input.files, baseline: input.baseline, tip: input.tip, evidence: input.evidence })], { signal });
    if (r.status !== 0 || Buffer.byteLength(r.stdout) > 128 * 1024) throw Object.assign(Error('Sandbox probe failed'), { code: 'EPROBE' });
    facts = JSON.parse(r.stdout);
    if (!Array.isArray(facts.checks) || !facts.checks.length) throw Error('Invalid probe result');
  } catch (error) {
    facts = { checks: [{ id: 'probe-execution', status: 'unknown', operation: 'bounded-agent-user-probe', path: '',
      reason: `Probe incomplete; work/probe cleanup unconfirmed; container=${input.container}`, errno: input.signal?.aborted ? 'ECANCELED' : safeErrno(error) }] };
  }
  const checks = facts.checks.map((c: any) => ({ ...c, scope: 'sandbox', phase: 'sandbox', observedAt, required: true,
    nextActor: c.status === 'ready' ? 'none' : 'operator', nextAction: c.status === 'ready' ? 'No action required' : 'Inspect the failed operation; preserve work and confirm exact-container cleanup', automaticRecheck: 'next-launch' }));
  const report: ReadinessReport = { version: 1, identity: token.identity, owner: token.owner, observedAt, phase: 'sandbox', status: reportStatus(checks), checks };
  if (!validReport(report)) throw Error('Invalid sandbox readiness report; launch held');
  if (!store.publishReadiness(input.state, token, report)) throw Error('Sandbox readiness publication superseded; launch held');
  return report;
}

/** Add teardown facts without dropping the primary probe failure. Superseded reports stay fenced. */
export function recordSandboxCleanup(state: string, report: ReadinessReport, confirmed: boolean): void {
  const check = { id: 'container-cleanup', scope: 'sandbox' as const, phase: 'sandbox' as const,
    observedAt: new Date().toISOString(), status: confirmed ? 'ready' as const : 'blocked' as const, required: true,
    operation: 'confirm-exact-container-absent', path: report.owner.ownerId,
    reason: confirmed ? 'Exact container confirmed absent' : 'Exact container cleanup unconfirmed; ownership hold retained',
    nextActor: confirmed ? 'none' as const : 'operator' as const, nextAction: confirmed ? 'No action required' : 'Inspect the exact owned container before releasing cleanup ownership', automaticRecheck: 'none' as const };
  report.checks.push(check); report.status = reportStatus(report.checks);
  // A newer invocation owns the display now. Never overwrite it with an older cleanup.
  store.publishReadiness(state, { identity: report.identity, owner: report.owner }, report);
}

/** SDK close can swallow Docker errors. Independently confirm the exact identity on every exit path. */
export async function closeSandbox(sandbox: { sandboxId?: string; close(): Promise<unknown> }, proc: Proc = boundedDocker): Promise<{ confirmed: boolean; reason?: string }> {
  let reason: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([sandbox.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('close timed out')), 15_000); })]);
  } catch (error) { reason = `Sandbox close failed: ${(error as Error).message}`; }
  finally { if (timer) clearTimeout(timer); }
  let confirmed = false;
  if (sandbox.sandboxId && /^[A-Za-z0-9_.-]+$/.test(sandbox.sandboxId)) {
    try {
      const r = await proc('docker', ['container', 'inspect', sandbox.sandboxId], { signal: AbortSignal.timeout(5000) });
      confirmed = !reason && r.status !== null && r.status !== 0 && /No such (object|container)/i.test(r.stderr);
    } catch { /* Uncertainty retains the runtime cleanup lease. */ }
  }
  if (!confirmed) reason = [reason, `Container ${sandbox.sandboxId ?? '(unknown)'} teardown unconfirmed; ownership cleanup hold retained`].filter(Boolean).join('; ');
  return { confirmed, ...(reason ? { reason } : {}) };
}

export function sandboxReadinessHold(report: ReadinessReport): string | undefined {
  if (report.status === 'ready') return;
  return `Sandbox readiness ${report.status} in ${report.owner.ownerId}: ` + report.checks.filter(c => c.status !== 'ready').map(c => `${c.operation} ${c.path} ${c.errno ?? ''}: ${c.reason}`).join('; ');
}
