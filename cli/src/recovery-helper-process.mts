// Bound recovery helper output and lifetime; confirm cleanup of the detached group before returning a result.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { terminateGroup } from './tick-cancel.mts';

export type RecoveryHelperSpawn = (node: string, args: string[], o: {cwd:string;env:NodeJS.ProcessEnv;detached:true;stdio:['ignore','pipe','pipe']}) => ChildProcess;
export type RecoveryHelperOptions = { root: string; dir: string; node?: string; path?: string; signal?: AbortSignal;
  spawn?: RecoveryHelperSpawn; terminate?: typeof terminateGroup };

type ProcessOutcome = { ok: boolean; output: string; code?: 'timeout' | 'ownership'; overflow?: boolean; reason?: string };

export function runRecoveryHelper(o: RecoveryHelperOptions, run: { args: string[]; env: NodeJS.ProcessEnv; timeout: number;
  name: string; owner: string; recordPid: (pid: number) => void; byteLimit?: number }): Promise<ProcessOutcome> {
  if (o.signal?.aborted) return Promise.resolve({ ok: false, output: '', code: 'timeout', reason: `${run.name} cancelled` });
  return new Promise(accept => {
    let child: ChildProcess;
    try {
      child = (o.spawn ?? spawn)(o.node ?? process.execPath, run.args, { cwd: o.root,
        env: { ...process.env, ...run.env, PATH: o.path ?? process.env.PATH, SANDCASTLE_STATE_DIR: o.dir },
        detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { accept({ ok: false, output: '', reason: String(e) }); return; }
    let output = '', diagnostics = '', expired = false, settled = false, overflow = false;
    const chunks: Buffer[] = [];
    let bytes = 0, stdoutEnded = !child.stdout;
    let drained: (() => void) | undefined;
    const stopWaiting = () => { clearTimeout(timer); o.signal?.removeEventListener('abort', abort); };
    const finish = async (code: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (!run.byteLimit) stopWaiting();
      let confirmed = !child.pid;
      try { if (child.pid) confirmed = (await (o.terminate ?? terminateGroup)(child.pid, { graceMs: 1000, confirmMs: 5000 })).confirmed; }
      catch { confirmed = false; }
      if (!confirmed) {
        stopWaiting();
        return accept({ ok: false, output: '', code: 'ownership',
          reason: `${run.name} process group ${child.pid} cleanup unconfirmed; ownership kept at ${run.owner}` });
      }
      const deliver = () => {
        drained = undefined;
        stopWaiting();
        const ok = !expired && !overflow && !error && code === 0;
        if (run.byteLimit && !stdoutEnded) child.stdout?.destroy();
        accept({ ok, output: run.byteLimit ? (ok ? Buffer.concat(chunks).toString('utf8') : '') : output,
          code: expired ? 'timeout' : undefined, overflow,
          reason: expired ? `${run.name} timed out or cancelled; ${diagnostics.slice(-700)}`
            : overflow ? `${run.name} output exceeded protocol limit` : error?.message ?? diagnostics.slice(-500) });
      };
      // In byte-limited mode, never accept a valid JSON prefix before all stdout is accounted for.
      if (run.byteLimit && !stdoutEnded && !expired && !overflow && !error && code === 0) drained = deliver;
      else deliver();
    };
    const abort = () => {
      expired = true;
      if (drained) drained();
      else void finish(null);
    };
    const timer = setTimeout(abort, run.timeout);
    o.signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', b => {
      if (run.byteLimit) {
        const chunk = Buffer.isBuffer(b) ? b : Buffer.from(b);
        bytes += chunk.length;
        if (bytes <= run.byteLimit) chunks.push(chunk);
        else {
          overflow = true;
          if (drained) drained();
          else void finish(null);
        }
      } else {
        output += String(b);
        if (output.length > 16384) { overflow = true; output = output.slice(0, 16384); void finish(null); }
      }
    });
    child.stdout?.once('end', () => { stdoutEnded = true; drained?.(); });
    child.stderr?.on('data', b => { diagnostics = (diagnostics + String(b)).slice(-2000); });
    // Exit, not close: descendants may retain inherited pipes. The group is still ours to terminate.
    child.once('exit', code => { void finish(code); });
    child.once('error', e => { void finish(null, e); });
    try { if (child.pid) run.recordPid(child.pid); }
    catch (e) { void finish(null, e as Error); }
    if (o.signal?.aborted) abort();
  });
}
