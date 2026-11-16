// Guard Factory's private Sandcastle layout patch before dependency hashing, never on import.
// The pinned byte specification and upgrade/removal procedure are in docs/sandcastle-patch.md.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateRelativePath } from './runtime-assets.mts';

export type PatchFile = { path: string; before: string; after: string; edits: { offset: number; before: string; after: string }[] };
export type SandcastlePatch = { schema: number; name: string; version: string; integrity: string; files: PatchFile[] };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const readSandcastlePatch = (): SandcastlePatch => JSON.parse(readFileSync(new URL('./sandcastle-patch.json', import.meta.url), 'utf8'));

/** Pure validation/planning. No writes until every file has one consistent preimage or postimage. */
export function planSandcastlePatch(spec: SandcastlePatch, lock: any, files: ReadonlyMap<string, Buffer>): { state: 'original' | 'patched'; files: Map<string, Buffer> } {
  if (spec.schema !== 1 || spec.name !== '@ai-hero/sandcastle' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(spec.integrity)) throw new Error('Unsupported Sandcastle patch specification');
  const locked = lock.packages?.[`node_modules/${spec.name}`];
  if (lock.lockfileVersion !== 3 || locked?.version !== spec.version || locked?.integrity !== spec.integrity || locked?.link) throw new Error('Unsupported Sandcastle lock version/integrity');
  const paths = new Set<string>();
  for (const file of spec.files) {
    validateRelativePath(file.path);
    if (paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.before) || !/^[a-f0-9]{64}$/.test(file.after)) throw new Error('Invalid Sandcastle file specification');
    paths.add(file.path);
  }
  if (files.size !== paths.size || [...files.keys()].some(path => !paths.has(path))) throw new Error('Unsupported Sandcastle package files');
  const pkg = JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}');
  if (pkg.name !== spec.name || pkg.version !== spec.version) throw new Error('Unsupported installed Sandcastle version');
  const states = new Set<string>();
  const output = new Map<string, Buffer>();
  for (const file of spec.files) {
    const bytes = files.get(file.path);
    if (!bytes) throw new Error(`Missing Sandcastle file: ${file.path}`);
    const hash = sha256(bytes);
    if (hash !== file.before && hash !== file.after) throw new Error(`Unexpected Sandcastle bytes: ${file.path}`);
    if (file.before !== file.after) states.add(hash === file.before ? 'original' : 'patched');
    if (hash === file.after) { output.set(file.path, bytes); continue; }
    let cursor = 0;
    const chunks: Buffer[] = [];
    for (const edit of file.edits) {
      const before = Buffer.from(edit.before);
      if (!Number.isSafeInteger(edit.offset) || edit.offset < cursor || !before.length || edit.offset + before.length > bytes.length || !bytes.subarray(edit.offset, edit.offset + before.length).equals(before)) throw new Error(`Invalid Sandcastle edit: ${file.path}`);
      chunks.push(bytes.subarray(cursor, edit.offset), Buffer.from(edit.after));
      cursor = edit.offset + before.length;
    }
    chunks.push(bytes.subarray(cursor));
    const patched = Buffer.concat(chunks);
    if (sha256(patched) !== file.after) throw new Error(`Sandcastle postimage mismatch: ${file.path}`);
    output.set(file.path, patched);
  }
  if (states.size !== 1) throw new Error('Incomplete or mixed Sandcastle patch state');
  return { state: [...states][0] as 'original' | 'patched', files: output };
}

/** Private runtime preparation calls this only on a newly installed, unpublished directory.
 * Runs after npm ci --ignore-scripts and before runtime-bundle dependency hashing.
 * A failed/interrupted write invalidates the staging directory; discard it, never publish it. */
export function prepareSandcastlePackage(directory: string): { state: 'original' | 'patched'; changed: string[] } {
  const root = resolve(directory);
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw new Error('Invalid private runtime directory');
  if (readdirSync(root).includes('runtime-manifest.json')) throw new Error('Cannot patch a published or manifested runtime');
  let packageRoot = root;
  for (const part of ['node_modules', '@ai-hero', 'sandcastle']) {
    packageRoot = join(packageRoot, part);
    const st = lstatSync(packageRoot);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('Sandcastle must be a private package directory');
  }
  const files = new Map<string, Buffer>();
  function walk(directory: string, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      const full = join(directory, name), st = lstatSync(full);
      if (st.isSymbolicLink()) throw new Error(`Unsupported Sandcastle symlink: ${path}`);
      if (st.isDirectory()) walk(full, path);
      else if (st.isFile() && st.nlink === 1) files.set(path, readFileSync(full));
      else throw new Error(`Unsupported Sandcastle file: ${path}`);
    }
  }
  walk(packageRoot);
  const lockPath = join(root, 'package-lock.json');
  if (!lstatSync(lockPath).isFile() || lstatSync(lockPath).isSymbolicLink()) throw new Error('Invalid private package lock');
  const plan = planSandcastlePatch(readSandcastlePatch(), JSON.parse(readFileSync(lockPath, 'utf8')), files);
  const changed: string[] = [];
  for (const [path, bytes] of plan.files) {
    if (bytes.equals(files.get(path)!)) continue;
    writeFileSync(join(packageRoot, path), bytes);
    changed.push(path);
  }
  // Verify the written bytes too; publication belongs to the existing runtime-bundle transaction.
  for (const [path, bytes] of plan.files) if (!readFileSync(join(packageRoot, path)).equals(bytes)) throw new Error(`Sandcastle write verification failed: ${path}`);
  return { state: plan.state, changed };
}
