// Synthetic historical workflow copies for diagnostic and legacy-boundary tests only.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FROM_BOARD, FROM_ORCHESTRATOR } from '../src/scaffold.mts';

export function populateCopiedWorkflow(root: string, source: string) {
  for (const [dir, names] of [['orchestrator', [...FROM_ORCHESTRATOR, 'main.mts']], ['board', FROM_BOARD], ['cli/templates/project', ['prompt.md', 'prompt.verify.md']]] as const) {
    for (const name of names) {
      const target = join(root, '.factory', name);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(source, dir, name), target);
    }
  }
}
