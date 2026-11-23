// Submit explicit membership or resume its foreground journey; stdout is the operator status, stderr is progress.
import { submitBatch } from '../batch.mts';
import { continueBatch } from '../batch-journey.mts';
import type { Paths } from '../paths.mts';
export async function batch(p:Paths, [action, project, ...args]:string[]) {
  if (!project || !(action === 'submit' || action === 'resume' && args.length === 1)) throw Error('Usage: factory batch submit <project> <ticket-id>... | factory batch resume <project> <batch-id>');
  const id=action==='submit'?submitBatch(p,project,args,id=>console.error(`Reserved batch ${id}`)).id:args[0];
  const status=await continueBatch(p,project,id);
  console.log(JSON.stringify(status,null,2));
  if(status.error)process.exitCode=1;
}
