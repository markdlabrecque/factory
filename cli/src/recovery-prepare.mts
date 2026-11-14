// Run only a reviewed project copy under saved scheduler Node/PATH. Preparation owns a bounded process group,
// confirms cleanup before interpreting stdout, and never consumes an attempt. Tests inject process boundaries.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Paths } from './paths.mts';
import { recoveryCopyProblem } from './recovery-review.mts';
import { terminateGroup } from './tick-cancel.mts';
import { digest, held, validPreparation } from '../../orchestrator/recovery-analysis-contract.mts';
import type { Preparation } from '../../orchestrator/recovery-analysis-contract.mts';
export type PreparationProcess = (node: string, args: string[], o: {cwd:string;env:NodeJS.ProcessEnv;detached:true;stdio:['ignore','pipe','pipe']}) => ChildProcess;
export type PrepareOptions = {root:string;tracker:string;ticket:number;base:string;dir:string;node?:string;path?:string;signal?:AbortSignal;
  spawn?:PreparationProcess; terminate?:typeof terminateGroup; setupTimeoutMs?:number};
export async function prepareRecovery(p: Paths, o: PrepareOptions): Promise<Preparation> {
  if (!Number.isSafeInteger(o.ticket) || o.ticket<=0 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(o.base) || o.base.includes('..'))
    return held('config','Recovery preparation requires a numeric ticket and recorded base','project');
  let copy:string|null;
  try { copy = recoveryCopyProblem(p,o.root); } catch (e) {return held('config',String(e),'project');}
  if (copy) return held('config',copy,'project');
  const helper = join(o.root,'.sandcastle/recovery-analysis.mts');
  if (!existsSync(helper)) return held('config','Recovery preparation helper missing; update and review the project workflow','project');
  if (o.signal?.aborted) return held('timeout','Preparation cancelled','project');
  const owner = join(p.recovery,`prepare-${digest(resolve(o.root))}.json`);
  try { mkdirSync(p.recovery,{recursive:true}); } catch (e) {return held('ownership',String(e),'project');}
  // An uncertain previous cleanup remains a project-wide stop. Never overwrite its process identity.
  if (existsSync(owner)) return held('ownership',`Previous preparation ownership is unconfirmed: ${owner}; confirm its named process group/workspace cleanup before removing this record`,'project');
  try { writeFileSync(owner,JSON.stringify({root:o.root,at:new Date().toISOString()}),{flag:'wx',mode:0o600}); }
  catch (e) { return held('ownership',String(e),'project'); }
  let uncertain = false;
  const run = async (args:string[],timeout:number): Promise<{ok:boolean;output:string;code?:'timeout'|'ownership';reason?:string}> => {
    if (o.signal?.aborted) return {ok:false,output:'',code:'timeout',reason:'Preparation cancelled'};
    return new Promise(accept => {
      let child:ChildProcess;
      try { child = (o.spawn ?? spawn)(o.node ?? process.execPath,args,{cwd:o.root,env:{...process.env,PATH:o.path ?? process.env.PATH,
        SANDCASTLE_STATE_DIR:o.dir},detached:true,stdio:['ignore','pipe','pipe']}); }
      catch (e) { accept({ok:false,output:'',reason:String(e)}); return; }
      let output='',diagnostics='',expired=false,settled=false,overflow=false;
      const finish = async (code:number|null, error?:Error) => {
        if (settled) return; settled=true; clearTimeout(timer); o.signal?.removeEventListener('abort',abort);
        let confirmed = !child.pid;
        try { if (child.pid) confirmed = (await (o.terminate ?? terminateGroup)(child.pid,{graceMs:1000,confirmMs:5000})).confirmed; }
        catch { confirmed=false; }
        if (!confirmed) { uncertain=true; accept({ok:false,output:'',code:'ownership',reason:`Preparation process group ${child.pid} cleanup unconfirmed; ownership kept at ${owner}`}); }
        else accept({ok:!expired && !overflow && !error && code === 0,output,code:expired ? 'timeout' : undefined,
          reason:expired ? `Preparation timed out or cancelled; ${diagnostics.slice(-700)}` : overflow ? 'Preparation output exceeded protocol limit' : error?.message ?? diagnostics.slice(-500)});
      };
      const abort = () => {expired=true; void finish(null);};
      const timer=setTimeout(abort,timeout);
      o.signal?.addEventListener('abort',abort,{once:true});
      child.stdout?.on('data',b => {output+=String(b); if (output.length>16384) {overflow=true;output=output.slice(0,16384);void finish(null);} });
      child.stderr?.on('data',b => {diagnostics=(diagnostics+String(b)).slice(-2000);});
      // Exit, not close: descendants may retain inherited pipes. The group is still ours to terminate.
      child.once('exit',code => {void finish(code);}); child.once('error',e => {void finish(null,e);});
      try { if (child.pid) writeFileSync(owner,JSON.stringify({root:o.root,pid:child.pid,at:new Date().toISOString()})); }
      catch (e) { void finish(null,e as Error); }
      if (o.signal?.aborted) abort();
    });
  };
  try {
    const setupMs = o.setupTimeoutMs ?? 60_000, started = Date.now();
    const config = await run([join(o.root,'.sandcastle/config-read.mts'),join(o.root,'.sandcastle'),'analysisTimeoutMinutes'],Math.min(setupMs,20_000));
    if (!config.ok) return held(config.code ?? 'config',config.reason || 'Cannot read preparation deadline','project');
    const minutes=Number(config.output.trim());
    if (!Number.isFinite(minutes) || minutes<=0 || minutes*60_000+setupMs>2_147_483_647) return held('config','Invalid preparation deadline','project');
    const result=await run([helper,String(o.ticket),o.base],Math.max(1,minutes*60_000+setupMs-(Date.now()-started)));
    if (!result.ok) return held(result.code ?? 'analysis-failed',result.reason || 'Preparation helper failed','project');
    let value:unknown;try {value=JSON.parse(result.output);}catch {return held('analysis-failed','Malformed preparation JSON','project');}
    if (!validPreparation(value)) return held('analysis-failed','Invalid preparation protocol','project');
    if (value.state==='ready' && (value.project!==o.tracker || value.ticket!==o.ticket || value.root!==resolve(o.root) || value.base!==o.base))
      return held('changed','Preparation target identity mismatch','project');
    if (value.state !== 'ready' && value.code === 'ownership') {
      uncertain=true;
      writeFileSync(owner,JSON.stringify({root:o.root,at:new Date().toISOString(),reason:value.reason}));
    }
    return value;
  } catch (e) { return held('config',String(e),'project'); }
  finally { if (!uncertain) rmSync(owner,{force:true}); }
}
