// Durable managed admission precedes preparation probes/model work; uncertain group cleanup retains its entry.
// Run the selected complete workflow under saved scheduler Node/PATH, with project-mode review. Preparation owns a bounded process group,
// confirms cleanup before interpreting stdout, and never consumes an attempt. Tests inject process boundaries.
import { claimManagedEntry, releaseManagedEntry } from '../../board/admission.mts';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Paths } from './paths.mts';
import { recoveryCopyProblem } from './recovery-review.mts';
import { projectWorkflow } from './workflow.mts';
import { runRecoveryHelper } from './recovery-helper-process.mts';
import type { RecoveryHelperOptions } from './recovery-helper-process.mts';
import { digest, held, validPreparation } from '../../orchestrator/recovery-analysis-contract.mts';
import type { Preparation } from '../../orchestrator/recovery-analysis-contract.mts';
export type PrepareOptions = RecoveryHelperOptions & {tracker:string;ticket:number;base:string;workflowEnv?:NodeJS.ProcessEnv;setupTimeoutMs?:number};
export const preparationOwnerFile = (p: Paths, root: string) => join(p.recovery, `prepare-${digest(resolve(root))}.json`);
export async function prepareRecovery(p: Paths, o: PrepareOptions): Promise<Preparation> {
  if (!Number.isSafeInteger(o.ticket) || o.ticket<=0 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(o.base) || o.base.includes('..'))
    return held('config','Recovery preparation requires a numeric ticket and recorded base','project');
  let copy:string|null;
  try { copy = recoveryCopyProblem(p,o.root); } catch (e) {return held('config',String(e),'project');}
  if (copy) return held('config',copy,'project');
  let workflow;
  try { workflow = projectWorkflow(p, o.root, o.workflowEnv); } catch (error) { return held('config', String(error), 'project'); }
  if (o.signal?.aborted) return held('timeout','Preparation cancelled','project');
  const tracker = workflow.config.TRACKER;
  let entry: string;
  try { entry = claimManagedEntry(o.dir, { root: o.root, tracker: { kind: tracker.kind, host: tracker.gitlabHost ?? tracker.host!, project: tracker.project } }); }
  catch (error) { return held('ownership', String(error), 'project'); }
  let uncertain = false;
  try {
  const { projectLaunchReadiness, readinessReason } = await import('../../orchestrator/launch-readiness.mts');
  const hostHold = readinessReason(await projectLaunchReadiness({ projectRoot: o.root, runtimeRoot: workflow.root, runtimeIdentity: workflow.id, runtimeDependencies: workflow.manifest.dependencies, config: workflow.config, stateRoot: o.dir, base: o.base, signal: o.signal }));
  if (o.signal?.aborted) return held('timeout','Preparation cancelled','project');
  if (hostHold) return held('config', hostHold, 'project');
  const helper = workflow.entrypoints.preparation;
  if (o.signal?.aborted) return held('timeout','Preparation cancelled','project');
  const owner = preparationOwnerFile(p,o.root);
  try { mkdirSync(p.recovery,{recursive:true}); } catch (e) {return held('ownership',String(e),'project');}
  // An uncertain previous cleanup remains a project-wide stop. Never overwrite its process identity.
  if (existsSync(owner)) return held('ownership',`Previous preparation ownership is unconfirmed: ${owner}; confirm its named process group/workspace cleanup before removing this record`,'project');
  try { writeFileSync(owner,JSON.stringify({root:o.root,at:new Date().toISOString()}),{flag:'wx',mode:0o600}); }
  catch (e) { return held('ownership',String(e),'project'); }
  const run = async (args:string[],timeout:number) => {
    const result = await runRecoveryHelper(o, { args, timeout, owner, env: workflow.env, name: 'Preparation',
      recordPid: pid => writeFileSync(owner,JSON.stringify({root:o.root,pid,at:new Date().toISOString()})) });
    if (result.code === 'ownership') uncertain = true;
    return result;
  };
  try {
    const setupMs = o.setupTimeoutMs ?? 60_000, started = Date.now();
    const config = await run([workflow.entrypoints.config,join(o.root,'.factory'),'analysisTimeoutMinutes'],Math.min(setupMs,20_000));
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
  } finally { if (!uncertain) releaseManagedEntry(o.dir, entry); }
}
