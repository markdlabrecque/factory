// Diagnostic command only: resolve a registered project and print read-only workflow observations.
// Invalid configuration is report data, not a reason to execute legacy project code or run doctor.
import type { Paths } from '../paths.mts';
import { resolveRegisteredProject } from '../runs.mts';
import { collectWorkflowReport, formatWorkflowReport } from '../workflow-report.mts';

export async function workflow(p: Paths, action: string | undefined, options: { source?: string; project?: string; dockerSocket?: string; json?: boolean; cwd?: string }) {
  if (action !== 'status') throw new Error('Usage: factory workflow status --source <Factory-checkout> [--project <name|path>] [--docker-socket <local-path>] [--json]');
  if (!options.source) throw new Error('workflow status requires --source <Factory-checkout>');
  const project = resolveRegisteredProject(p, options);
  const report = await collectWorkflowReport(p, { source: options.source, projectRoot: project.root, dockerSocket: options.dockerSocket });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatWorkflowReport(report));
  return 0;
}
