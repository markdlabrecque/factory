// Bounded host-only Pi OAuth export and fixed failure reasons, before paid acquisition and outside locks.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PI_LOGIN_ARGS = Object.freeze(['auth','print-bearer-token','--min-expiry','50m','--provider','openai']);
export const validPiBearer = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 16384
  && /^(?!sk-)[A-Za-z0-9._~+\/-]+=*$/.test(s);

const stages = {
  setup: 'child setup failed',
  spawn: 'child could not be started',
  timeout: 'child deadline expired',
  cancelled: 'cancelled',
  exit: 'child exited unsuccessfully',
  'output-limit': 'child output limit exceeded',
  'malformed-bearer': 'bearer missing or malformed',
  cleanup: 'auth-process cleanup unconfirmed',
  unknown: 'failure stage unknown',
} as const;
export type PiLoginFailure = Readonly<{ stage: keyof typeof stages; cleanupUnconfirmed?: boolean }>;
export function piLoginFailureReason(failure: PiLoginFailure): string | undefined {
  if (typeof failure.stage !== 'string' || !Object.hasOwn(stages, failure.stage)) return undefined;
  const cleanup = failure.cleanupUnconfirmed === true && failure.stage !== 'cleanup' ? '; auth-process cleanup unconfirmed' : '';
  return `Pi login handoff held: ${stages[failure.stage]}${cleanup}; no fallback or reservation`;
}

// Only failures minted here carry stage evidence; arbitrary resolver errors, even lookalikes, do not.
const failures = new WeakMap<object, PiLoginFailure>();
function refuse(stage: PiLoginFailure['stage'], cleanupUnconfirmed = false): Error {
  const failure = Object.freeze({stage,cleanupUnconfirmed});
  const error = Error(piLoginFailureReason(failure));
  failures.set(error,failure);
  return error;
}
export function piLoginFailureOf(error: unknown): PiLoginFailure | undefined {
  return typeof error === 'object' && error !== null ? failures.get(error) : undefined;
}

/** The supported command verifies OAuth type and expiry (and may refresh). No store reads or fallback here.
 * Test seams are source-only. Stderr is counted, never retained; failed handoffs never return raw output.
 */
export async function resolvePiLogin(signal?: AbortSignal, seam?: {
  start?: (cwd: string) => ChildProcess;
  timer?: (f: () => void, ms: number) => () => void;
}): Promise<string> {
  if (signal?.aborted) throw refuse('cancelled');
  let cwd: string;
  try { cwd = mkdtempSync(join(tmpdir(),'factory-advisory-auth-')); }
  catch { throw refuse('setup'); }
  let resolved = false;
  try {
    const token = await new Promise<string>((accept,reject) => {
      const bytes = Buffer.alloc(16386);
      let child: ChildProcess;
      try {
        child = seam?.start ? seam.start(cwd) : spawn('pi',[...PI_LOGIN_ARGS],{cwd,detached:true,stdio:['ignore','pipe','pipe'],
          env:{PATH:process.env.PATH ?? '/usr/bin:/bin',HOME:process.env.HOME ?? '',LANG:'C',PI_OFFLINE:'1'}});
      } catch { reject(refuse('spawn')); return; }
      let done = false, length = 0, stderrBytes = 0, cancelTimer = () => {};
      const finish = (stage: PiLoginFailure['stage'] | null, neverStarted = false) => {
        if (done) return; done = true;
        cancelTimer(); signal?.removeEventListener('abort',abort);
        // A successful closed child must already have left no group behind. Sending SIGKILL
        // is not confirmation; preserve the original failure stage as well when there is one.
        let absent = neverStarted;
        if (child.pid) {
          try { process.kill(-child.pid,0); } catch (e) { absent = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
          if (!absent) { try { process.kill(-child.pid,'SIGKILL'); } catch { /* cleanup remains unconfirmed */ } }
        }
        child.stdout?.destroy(); child.stderr?.destroy();
        const token = stage === null && absent ? bytes.toString('utf8',0,length).replace(/\r?\n$/,'') : undefined;
        bytes.fill(0);
        if (validPiBearer(token)) accept(token);
        else reject(refuse(stage ?? (absent ? 'malformed-bearer' : 'cleanup'),!absent));
      };
      const abort = () => finish('cancelled');
      const timer = seam?.timer ?? ((f,ms) => { const t=setTimeout(f,ms); return () => clearTimeout(t); });
      child.on('error',()=>finish(child.pid === undefined ? 'spawn' : 'unknown',child.pid === undefined));
      try {
        child.stdout?.on('error',()=>finish('unknown'));
        child.stderr?.on('error',()=>finish('unknown'));
        child.stdout?.on('data',(chunk: Buffer) => {
          if (done) return;
          if (length+chunk.length > bytes.length) { finish('output-limit'); return; }
          length += chunk.copy(bytes,length);
        });
        child.stderr?.on('data',chunk => {
          if (done) return;
          stderrBytes+=Buffer.byteLength(chunk);
          if (stderrBytes>8192) finish('output-limit');
        });
        child.once('close',(code,exitSignal)=>finish(code===0 && !exitSignal ? null
          : exitSignal || typeof code === 'number' ? 'exit' : 'unknown'));
        signal?.addEventListener('abort',abort,{once:true});
        cancelTimer = timer(()=>finish('timeout'),20_000);
        if (done) cancelTimer();
        if (signal?.aborted) abort();
      } catch { finish('setup'); }
    });
    resolved = true;
    return token;
  } catch (e) {
    if (piLoginFailureOf(e)) throw e;
    throw refuse('unknown');
  } finally {
    try { rmSync(cwd,{recursive:true,force:true}); }
    catch { if (resolved) throw refuse('unknown'); /* keep the primary refusal */ }
  }
}
