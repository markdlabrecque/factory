// Standard shell preflight gate, before remote/auth/image/container operations. No tracker reads.
import { executionContext } from './context.mts';
import { projectLaunchReadiness, readinessReason } from './launch-readiness.mts';
const context = await executionContext();
const reason = readinessReason(await projectLaunchReadiness({ projectRoot: context.projectRoot, runtimeRoot: context.runtimeRoot, runtimeIdentity: context.manifest.id, runtimeDependencies: context.manifest.dependencies, config: context.config, stateRoot: context.sharedState }));
if (reason) { console.error(`Factory project held: ${reason}`); process.exitCode = 1; }
