// Public batch selection/ownership commands; neither command claims tickets or executes a gate.
import { resumeBatch, submitBatch } from '../batch.mts';
import type { Paths } from '../paths.mts';
export function batch(p:Paths, [action, project, ...args]:string[]) {
  if (!project || !(action === 'submit' || action === 'resume' && args.length === 1)) throw Error('Usage: factory batch submit <project> <ticket-id>... | factory batch resume <project> <batch-id>');
  console.log(JSON.stringify(action === 'submit' ? submitBatch(p,project,args,id => console.error(`Reserved batch ${id}`)) : resumeBatch(p,project,args[0]),null,2));
}
