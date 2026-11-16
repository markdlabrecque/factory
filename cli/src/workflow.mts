// CLI bridge to the data-only resolver. Fresh commands read the installed descriptor; children may pass pinned context.
import { resolveWorkflow } from '../../orchestrator/workflow.mts';
import type { Paths } from './paths.mts';
import { runStateDir } from './runs.mts';
export { resolveWorkflow };
export function projectWorkflow(p: Paths, root: string, inherited?: NodeJS.ProcessEnv) {
  return resolveWorkflow(root, p.runtimeDescriptor, inherited, runStateDir(p));
}
