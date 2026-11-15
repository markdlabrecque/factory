// Data-only v2 settings and isolated canonical module copies. Never write config into the source checkout.
import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function copyTestRuntime(directory: string, config = factoryToml('owner/repo')) {
  mkdirSync(directory, { recursive: true });
  const source = fileURLToPath(new URL('../../orchestrator/', import.meta.url));
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.isFile() && !entry.name.endsWith('.test.mts')) cpSync(join(source, entry.name), join(directory, entry.name), { recursive: true });
  }
  cpSync(new URL('../../board/', import.meta.url), join(dirname(directory), 'board'), { recursive: true });
  writeFileSync(join(directory, 'factory.toml'), config);
  return (name: string) => pathToFileURL(join(directory, name)).href;
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
