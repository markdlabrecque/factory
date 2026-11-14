// Mandatory browser readiness for immutable images and actual sandboxes. Only confirmed, cleaned image probes are cached.
// Docker boundaries are injectable; this module never builds images, mounts host data or imports project configuration.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Owner } from '../board/admission.mts';
// Project copies colocate board helpers; the source tree keeps them in board/.
const { ownerOf, ownerState } = await import(new URL(existsSync(new URL('./admission.mts', import.meta.url)) ? './admission.mts' : '../board/admission.mts', import.meta.url).href);

export const BROWSER_PROBE = `
const { execFileSync } = require('node:child_process');
let stage = 'CLI missing';
(async () => {
  let browser;
  try {
    execFileSync('sh', ['-c', 'command -v playwright >/dev/null'], {timeout:10000});
    stage = 'global module resolution';
    const root = execFileSync('npm', ['root', '-g'], {encoding:'utf8', timeout:10000}).trim();
    const { chromium } = require(require('node:path').join(root, 'playwright'));
    stage = 'Chromium launch';
    browser = await chromium.launch({headless:true, timeout:15000});
    stage = 'DOM marker';
    const page = await browser.newPage();
    await page.setContent('<div id="factory-probe">ready</div>');
    if (await page.locator('#factory-probe').textContent() !== 'ready') throw Error('marker mismatch');
  } catch (_) { console.error('browser preflight failed: ' + stage); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
  if (!process.exitCode) console.log('browser preflight OK');
})().catch(() => { console.error('browser preflight failed: cleanup'); process.exitCode = 1; });`;

/** Own the detached probe group and kill descendants even when its leader exits first. */
export function browserWatchdog(timeoutMs = 30000): string {
  return `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(BROWSER_PROBE)}], { detached: true, stdio: 'inherit' });
let expired = false;
const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } } };
const timer = setTimeout(() => { expired = true; kill(); }, ${Math.max(1, Math.min(30000, timeoutMs))});
child.on('error', () => { clearTimeout(timer); kill(); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timer); kill(); process.exitCode = expired ? 124 : (code ?? 1); });`;
}
const diagnostic = (text: string) => text.match(/browser preflight failed: (?:CLI missing|global module resolution|Chromium launch|DOM marker|cleanup)/)?.[0]
  ?? (text.trim() === 'browser preflight OK' ? 'browser preflight OK' : 'browser preflight failed: probe execution or timeout');
const guidance = 'Add the documented browser layer and explicitly rebuild the configured image; custom images remain operator-owned.';

/** Setup logs are separate from the later independent verifier's log and acceptance artifacts. */
export async function browserPreflight(sandbox: { exec(cmd: string): Promise<{ stdout: string; stderr?: string; exitCode?: number }> }, evidenceHost: string,
  timeoutMs = 30000, logName: 'browser-preflight.log' | 'setup-browser-preflight.log' = 'browser-preflight.log'): Promise<string | undefined> {
  const path = resolve(evidenceHost, logName);
  let message = 'browser preflight failed: probe or timeout', ok = false;
  try {
    rmSync(path, { force: true });
    const encoded = Buffer.from(browserWatchdog(timeoutMs)).toString('base64');
    const result = await sandbox.exec(`command -v playwright >/dev/null || { echo "browser preflight failed: CLI missing"; exit 1; }; exec node -e "eval(Buffer.from('${encoded}','base64').toString())"`);
    message = diagnostic(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    ok = (result.exitCode ?? 0) === 0 && message === 'browser preflight OK';
  } catch { /* never retain arbitrary errors or environment data */ }
  try { writeFileSync(path, message.slice(0, 256) + '\n'); }
  catch { ok = false; message = 'browser preflight evidence could not be recorded'; }
  if (!ok) return `Playwright/Chromium provisioning failure: ${message}. ${guidance}`;
}

export type CapabilityResult = { ok: true; imageId: string; cached: boolean } | { ok: false; scope: 'environment'; retryable: true; reason: string };
export type DockerCommand = (args: string[], options: { timeout: number; signal?: AbortSignal }) => Promise<string>;
export const dockerCommand: DockerCommand = (args, options) => new Promise((accept, reject) => {
  execFile('docker', args, { timeout: options.timeout, signal: options.signal, killSignal: 'SIGKILL', maxBuffer: 65536 },
    (error, stdout, stderr) => error ? reject(Error('Docker command failed or timed out'))
      : accept(args[0] === 'container' && args[1] === 'logs' ? `${stdout}\n${stderr}` : stdout));
});
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const PROBE_HASH = sha(browserWatchdog());
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const LABEL = 'com.factory.preflight';
type Lock = { owner: Owner; name: string; token: string; imageId: string };

/** Confirm absence through a successful daemon listing. Never infer absence from a failed inspect. */
async function cleanup(lock: Lock, docker: DockerCommand): Promise<boolean> {
  try {
    const present = (await docker(['container', 'ls', '-a', '--filter', `name=^/${lock.name}$`, '--format', '{{.ID}}'], { timeout: 10000 })).trim();
    if (!present) return true;
    const rows = JSON.parse(await docker(['container', 'inspect', lock.name], { timeout: 10000 }));
    const c = rows?.[0];
    if (rows.length !== 1 || c?.Name !== `/${lock.name}` || c?.Config?.Labels?.[LABEL] !== lock.token || c?.Image !== lock.imageId || !/^[a-f0-9]{64}$/.test(c?.Id)) return false;
    await docker(['container', 'rm', '-f', c.Id], { timeout: 10000 });
    return !(await docker(['container', 'ls', '-a', '--filter', `name=^/${lock.name}$`, '--format', '{{.ID}}'], { timeout: 10000 })).trim();
  } catch { return false; }
}

/** A cache is image capability only, never ticket verification or authorization to skip sandbox probes. */
export async function checkImageCapabilities(o: { image: string; uid: number; gid: number; stateDir: string; signal?: AbortSignal;
  docker?: DockerCommand; probeHash?: string }): Promise<CapabilityResult> {
  const hold = (reason: string): CapabilityResult => ({ ok: false, scope: 'environment', retryable: true, reason: `Image readiness hold: ${reason}. ${guidance}` });
  if (o.signal?.aborted) return hold('cancelled');
  if (typeof o.image !== 'string' || !o.image.trim() || typeof o.stateDir !== 'string' || !o.stateDir.trim()) return hold('explicit local image and state directory are required');
  if (!Number.isSafeInteger(o.uid) || o.uid <= 0 || !Number.isSafeInteger(o.gid) || o.gid <= 0) return hold('a non-root UID/GID is required');
  const docker = o.docker ?? dockerCommand;
  let imageId: string;
  try {
    const rows = JSON.parse(await docker(['image', 'inspect', o.image], { timeout: 10000, signal: o.signal }));
    if (rows.length !== 1 || !IMAGE_ID.test(rows[0]?.Id) || !new RegExp(`^${o.uid}(?::${o.gid})?$`).test(rows[0]?.Config?.User)) return hold('local image identity or configured user is unknown or mismatched');
    imageId = rows[0].Id;
  } catch { return hold('local image inspection failed'); }
  const fields = { imageId, uid: o.uid, gid: o.gid, probeHash: o.probeHash ?? PROBE_HASH };
  const key = sha(JSON.stringify(fields)), dir = join(o.stateDir, 'capabilities'), file = join(dir, `${key}.json`), lockDir = join(dir, `${key}.lock`);
  try { mkdirSync(dir, { recursive: true }); } catch { return hold('cache directory unavailable'); }
  // Check the lock before the cache: an uncertain older cleanup cannot be hidden by a success record.
  try { mkdirSync(lockDir); }
  catch {
    let old: Lock;
    try {
      old = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
      if (!/^factory-preflight-[a-f0-9-]{36}$/.test(old.name) || !/^[a-f0-9-]{36}$/.test(old.token) || old.name !== `factory-preflight-${old.token}` || old.imageId !== imageId
        || !Number.isSafeInteger(old.owner?.pid) || old.owner.pid <= 0) return hold('probe ownership is unconfirmed');
      if (ownerState(old.owner) !== 'dead') return hold('another probe is live or its process identity is unknown; retry later');
      // Only one dead-owner reconciler may remove this lock. A crashed reconciler leaves a hold, not an age-based takeover.
      mkdirSync(join(lockDir, 'reaping'));
    } catch { return hold('probe ownership or cleanup is unconfirmed'); }
    if (!(await cleanup(old, docker))) {
      // This reconciler finished without certainty. Keep the original ownership lock, but let a later call retry exact cleanup.
      try { rmSync(join(lockDir, 'reaping'), { recursive: true }); } catch { /* interrupted/uncertain reconciliation stays held */ }
      return hold('dead probe exact-container cleanup is unconfirmed');
    }
    try { rmSync(lockDir, { recursive: true }); } catch { return hold('dead probe lock could not be released'); }
    return hold('dead probe cleaned; retry readiness');
  }
  const token = randomUUID(), lock: Lock = { owner: ownerOf(process.pid), name: `factory-preflight-${token}`, token, imageId };
  let created = false, success = false, cached = false, reason = 'probe failed';
  try {
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify(lock), { flag: 'wx' });
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      cached = saved && !Array.isArray(saved) && Object.keys(saved).length === 5 && Object.entries(fields).every(([k, v]) => saved[k] === v)
        && typeof saved.completedAt === 'string' && Number.isFinite(Date.parse(saved.completedAt)) && new Date(saved.completedAt).toISOString() === saved.completedAt;
    } catch { /* malformed records safely re-probe under the owned lock */ }
    if (cached && !o.signal?.aborted) success = true;
    else {
      if (o.signal?.aborted) throw Error('cancelled');
      // Record the exact name before create: even an uncertain create response must be reconciled.
      created = true;
      await docker(['container', 'create', '--pull', 'never', '--name', lock.name, '--label', `${LABEL}=${token}`, '--network', 'none', '--user', `${o.uid}:${o.gid}`,
        '--entrypoint', 'node', imageId, '-e', browserWatchdog()], { timeout: 10000, signal: o.signal });
      const deadline = Date.now() + 30000;
      await docker(['container', 'start', lock.name], { timeout: 10000, signal: o.signal });
      for (;;) {
        if (o.signal?.aborted || Date.now() >= deadline) throw Error('cancelled or timed out');
        const rows = JSON.parse(await docker(['container', 'inspect', lock.name], { timeout: Math.max(1, Math.min(10000, deadline - Date.now())), signal: o.signal }));
        const c = rows?.[0];
        if (rows.length !== 1 || c?.Name !== `/${lock.name}` || c?.Config?.Labels?.[LABEL] !== token || c?.Image !== imageId) throw Error('ownership unknown');
        if (c.State?.Status === 'exited') {
          const text = await docker(['container', 'logs', lock.name], { timeout: 10000, signal: o.signal });
          reason = diagnostic(text);
          success = c.State.ExitCode === 0 && c.State.OOMKilled === false && c.State.Error === '' && reason === 'browser preflight OK';
          break;
        }
        if (c.State?.Status !== 'running') throw Error('state unknown');
        await new Promise(r => setTimeout(r, 100));
      }
    }
  } catch { reason = 'probe control, cancellation or timeout'; }
  // Cleanup deliberately ignores the caller's aborted signal. Release nothing on uncertain cleanup.
  if (created && !(await cleanup(lock, docker))) return hold('exact owned container cleanup is unconfirmed; ownership retained');
  if (o.signal?.aborted) { success = false; reason = 'cancelled'; }
  try {
    if (success && !cached) {
      const temp = `${file}.${token}.tmp`;
      writeFileSync(temp, JSON.stringify({ ...fields, completedAt: new Date().toISOString() }), { flag: 'wx' });
      renameSync(temp, file);
    }
    rmSync(lockDir, { recursive: true });
  } catch { return hold('cache publication or lock release failed'); }
  return success ? { ok: true, imageId, cached } : hold(reason);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [image, uid, gid, stateDir] = process.argv.slice(2);
  const cancel = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => cancel.abort());
  const result = await checkImageCapabilities({ image, uid: Number(uid), gid: Number(gid), stateDir, signal: cancel.signal });
  if (result.ok) console.log(result.imageId);
  else { console.error(result.reason); process.exitCode = 1; }
}
