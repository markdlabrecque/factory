// Bound and freeze contained project-owned additive Markdown; strict original reads reject aliases and scoped corrections remain host-validated.
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { readBoundedText } from './ownership.mts';
import { resolveCheckoutPath, type EffectiveConfig } from './project-config.mts';
import type { FrozenAdditive } from './context.mts';

type Role = Exclude<keyof EffectiveConfig['instructions'], 'common'>;

/** Common files precede role files; aliases of the same real file are read once. */
export function loadInstructions(root: string, lists: EffectiveConfig['instructions'], role: Role,
  correction?: { path: string; before: string; after: string; originalHashes: Readonly<Record<string,string>> },
  options: { strictOriginals?: boolean } = {}): FrozenAdditive {
  if (Object.values(lists).reduce((n, paths) => n + paths.length, 0) > 128) throw Error('Instructions exceed 128 configured paths');
  let total = 0;
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
      if (options.strictOriginals && join(root, path) !== resolved) throw Error('Unsafe aliased instruction original');
      if (seen.has(resolved)) continue;
      bytes = Buffer.from(readBoundedText(options.strictOriginals ? join(root, path) : resolved, 256 * 1024, 'instruction original'));
      if (correction && correction.originalHashes[path] !== createHash('sha256').update(bytes).digest('hex')) throw Error('Applicable instruction bytes differ from independent review');
      if (correction && role === 'verification' && path === correction.path) {
        if (bytes.toString('utf8') !== correction.before) throw Error('Scoped instruction preimage changed');
        bytes = Buffer.from(correction.after);
      }
    } catch (error) {
      throw Error(`Cannot load instruction file ${JSON.stringify(path)}: ${(error as Error).message}`);
    }
    if (bytes.length > 256 * 1024) throw Error('Oversized instruction original or correction');
    total += bytes.length + (sections.length ? 2 : 0);
    if (total > 1024 * 1024) throw Error('Instructions exceed 1 MiB per-role aggregate');
    seen.add(resolved);
    hashes[relative(root, resolved)] = createHash('sha256').update(bytes).digest('hex');
    sections.push(bytes.toString('utf8'));
  }
  return Object.freeze({ text: sections.join('\n\n'), hashes: Object.freeze({ ...hashes }) });
}
