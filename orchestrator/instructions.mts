// Validate and freeze project-owned additive Markdown; an explicit host-validated scoped correction can replace one verification source.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { resolveCheckoutPath, type EffectiveConfig } from './project-config.mts';
import type { FrozenAdditive } from './context.mts';

type Role = Exclude<keyof EffectiveConfig['instructions'], 'common'>;

/** Common files precede role files; aliases of the same real file are read once. */
export function loadInstructions(root: string, lists: EffectiveConfig['instructions'], role: Role,
  correction?: { path: string; before: string; after: string; originalHashes: Readonly<Record<string,string>> }): FrozenAdditive {
  const seen = new Set<string>();
  const hashes: Record<string, string> = Object.create(null);
  const sections: string[] = [];
  for (const path of [...lists.common, ...lists[role]]) {
    if (!/\.md$/i.test(path)) throw Error(`Instruction path must name a Markdown file: ${path}`);
    let resolved: string, bytes: Buffer;
    try {
      resolved = resolveCheckoutPath(root, path, 'file');
      // Validate the target too: a Markdown alias must not open .env or auth data.
      if (!/\.md$/i.test(resolved) || relative(root, resolved).split(/[\\/]/).some(part => /^(?:\.env(?:\..*)?|auth\.json)$/i.test(part)))
        throw Error('Instruction target must be a Markdown file outside secret paths');
      if (seen.has(resolved)) continue;
      bytes = readFileSync(resolved);
      if (correction && correction.originalHashes[path] !== createHash('sha256').update(bytes).digest('hex')) throw Error('Applicable instruction bytes differ from independent review');
      if (correction && role === 'verification' && path === correction.path) {
        if (bytes.toString('utf8') !== correction.before) throw Error('Scoped instruction preimage changed');
        bytes = Buffer.from(correction.after);
      }
    } catch (error) {
      throw Error(`Cannot load instruction file ${JSON.stringify(path)}: ${(error as Error).message}`);
    }
    seen.add(resolved);
    hashes[relative(root, resolved)] = createHash('sha256').update(bytes).digest('hex');
    sections.push(bytes.toString('utf8'));
  }
  return Object.freeze({ text: sections.join('\n\n'), hashes: Object.freeze({ ...hashes }) });
}
