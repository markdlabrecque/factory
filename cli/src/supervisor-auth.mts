// Explicit host-only Pi OAuth export, before ownership/reservation and outside locks. No store reads or fallback.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const PI_LOGIN_ARGS = Object.freeze(['auth','print-bearer-token','--min-expiry','50m','--provider','openai']);
export const validPiBearer = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 16384
  && /^(?!sk-)[A-Za-z0-9._~+\/-]+=*$/.test(s);
/** The supported command verifies OAuth type and expiry (and MAY refresh). The parent bounds even a hung CLI.
 * Test seams are source-only, not flags/config/environment executable overrides. Stderr is counted, never retained.
 * Failure kills the whole detached child group, destroys pipes and returns only fixed sanitized prose.
 */
export async function resolvePiLogin(signal?: AbortSignal, seam?: {
  start?: (cwd: string) => ChildProcess;
  timer?: (f: () => void, ms: number) => () => void;
}): Promise<string> {
  const fail = () => Error('Advisory held: Pi login handoff unavailable, cancelled or malformed; no fallback');
  if (signal?.aborted) throw fail();
  const cwd = mkdtempSync(join(tmpdir(),'factory-advisory-auth-'));
  try {
    return await new Promise<string>((accept,reject) => {
      let child: ChildProcess;
      try {
        child = seam?.start ? seam.start(cwd) : spawn('pi',[...PI_LOGIN_ARGS],{cwd,detached:true,stdio:['ignore','pipe','pipe'],
          env:{PATH:process.env.PATH ?? '/usr/bin:/bin',HOME:process.env.HOME ?? '',LANG:'C',PI_OFFLINE:'1'}});
      } catch { reject(fail()); return; }
      let done = false, bytes = Buffer.alloc(0), stderrBytes = 0, cancelTimer = () => {};
      const finish = (ok = false) => {
        if (done) return; done = true; cancelTimer(); signal?.removeEventListener('abort',abort);
        // A successful closed child must leave no group behind; descendants invalidate the handoff.
        let absent = false;
        if (child.pid) {
          try { process.kill(-child.pid,0); } catch (e) { absent = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
          if (!absent) { try { process.kill(-child.pid,'SIGKILL'); } catch { /* failure remains refused */ } }
        }
        child.stdout?.destroy(); child.stderr?.destroy();
        const token = bytes.toString('utf8').replace(/\r?\n$/,''); bytes.fill(0);
        if (ok && absent && validPiBearer(token)) accept(token); else reject(fail());
      };
      const abort = () => finish();
      const timer = seam?.timer ?? ((f,ms) => { const t=setTimeout(f,ms); return () => clearTimeout(t); });
      cancelTimer = timer(abort,20_000);
      child.stdout?.on('data',chunk => {
        const b=Buffer.from(chunk); if (bytes.length+b.length > 16386) { finish(); return; }
        bytes=Buffer.concat([bytes,b]);
      });
      child.stderr?.on('data',chunk => { stderrBytes+=Buffer.byteLength(chunk); if (stderrBytes>8192) finish(); });
      child.once('error',()=>finish()); child.once('close',code=>finish(code===0));
      signal?.addEventListener('abort',abort,{once:true}); if (signal?.aborted) abort();
    });
  } finally { rmSync(cwd,{recursive:true,force:true}); }
}
