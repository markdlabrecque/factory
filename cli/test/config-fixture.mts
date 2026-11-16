// Data-only v2 settings and complete fixture-owned runtimes. Never write config into the source checkout.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bindExecution } from './execution-fixture.mts';
import { pathToFileURL } from 'node:url';

export function copyTestRuntime(directory: string, config = factoryToml('owner/repo')) {
  mkdirSync(directory, { recursive: true });
  const project = join(directory, 'project');
  mkdirSync(join(project, '.factory'), { recursive: true });
  writeFileSync(join(project, '.factory/factory.toml'), config);
  const bundle = bindExecution(project, process.env, { overlays: false });
  Object.assign(process.env, bundle.env);
  process.chdir(project);
  return (name: string) => pathToFileURL(join(bundle.directory, name)).href;
}

export function factoryToml(project: string, options: { kind?: 'github' | 'gitlab'; host?: string; projectId?: number; image?: string } = {}) {
  const kind = options.kind ?? 'github';
  return `version = 2
[tracker]
kind = ${JSON.stringify(kind)}
project = ${JSON.stringify(project)}
host = ${JSON.stringify(options.host ?? (kind === 'github' ? 'github.com' : 'git.example.com'))}
${kind === 'gitlab' ? `project_id = ${options.projectId ?? 42}` : ''}
[labels]
needs_human = "needs-human"
done = "merged"
[sandbox]
image = ${JSON.stringify(options.image ?? 'fixture')}
`;
}
