// Data-only scaffold writer: preflight destinations and create missing assets exclusively without overwrites.
import { closeSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldName } from './paths.mts';
import { requireProjectLayout } from '../../orchestrator/project-layout.mts';

export const appRoot = fileURLToPath(new URL('../../', import.meta.url));
export type Profile = 'personal' | 'client';
export type Settings = { profile: Profile; repo: string; image: string; host?: string; projectId?: number };
export type PlannedFile = { path: string; content: string | Buffer; mode: number };

export { FROM_ORCHESTRATOR, FROM_BOARD } from './runtime-assets.mts';

type Edit = { tag: string; line?: RegExp; value?: (m: RegExpMatchArray) => string };
const marker = (tag: string) => new RegExp(`// factory:${tag}(?![\\w:-])`, 'g');

/** Rewrite the single line carrying `// factory:<tag>`. Zero or several markers, or a line the pattern misses, is an error. */
export function fillTags(text: string, edits: Edit[]): string {
  let lines = text.split('\n');
  for (const { tag, line: pattern, value } of edits) {
    const hits = lines.flatMap((l, i) => (marker(tag).test(l) ? [i] : []));
    if (hits.length !== 1) throw new Error(`Template marker factory:${tag} must appear exactly once; found ${hits.length}`);
    const m = lines[hits[0]].match(pattern!);
    if (!m) throw new Error(`Template line for factory:${tag} no longer matches the expected shape`);
    lines[hits[0]] = lines[hits[0]].replace(pattern!, () => value!(m));
  }
  return lines.join('\n');
}
/** Replace the lines from `factory:<tag>:start` through `factory:<tag>:end` (both markers once each). */
export function replaceBlock(text: string, tag: string, replacement: string): string {
  const lines = text.split('\n');
  const find = (suffix: string) => lines.flatMap((l, i) => (l.includes(`// factory:${tag}:${suffix}`) ? [i] : []));
  const [a, b] = [find('start'), find('end')];
  if (a.length !== 1 || b.length !== 1 || a[0] > b[0]) throw new Error(`Template markers factory:${tag}:start/:end must each appear once, in order`);
  lines.splice(a[0], b[0] - a[0] + 1, replacement);
  return lines.join('\n');
}

export function buildAssets(s: Settings, stateDir: string, root = appRoot): PlannedFile[] {
  const read = (rel: string) => readFileSync(join(root, rel));
  const out: PlannedFile[] = [];
  const add = (name: string, content: string | Buffer, mode = 0o644) => out.push({ path: `${scaffoldName}/${name}`, content, mode });
  const personal = s.profile === 'personal';
  const toml = read(`orchestrator/factory.${s.profile}.toml`).toString('utf8').split('\n').map(line => {
    if (line.includes('# factory:project-id')) return `project_id = ${s.projectId} # factory:project-id`;
    if (line.includes('# factory:project')) return `project = ${JSON.stringify(s.repo)} # factory:project`;
    if (line.includes('# factory:host')) return `host = ${JSON.stringify(s.host)} # factory:host`;
    if (line.includes('# factory:image')) return `image = ${JSON.stringify(s.image)} # factory:image`;
    return line;
  }).join('\n');
  add('factory.toml', toml);

  const tpl = (name: string) => read(`cli/templates/project/${name}`);
  add('.env.example', tpl(personal ? 'env.personal.example' : 'env.client.example'));
  add('.gitignore', tpl('gitignore'));
  add('.env', '', 0o600);
  add('factory-dispatch.sh', tpl('factory-dispatch.sh'), 0o755);
  return out;
}

const lstatOrNone = (path: string): Stats | undefined => {
  try { return lstatSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
};
/** 'file' when the destination already holds a regular file, 'missing' when it can be created; otherwise throws. */
function inspect(root: string, rel: string): 'file' | 'missing' {
  let cur = root;
  for (const part of rel.split('/').slice(0, -1)) {
    cur = join(cur, part);
    const st = lstatOrNone(cur);
    if (!st) break;
    if (st.isSymbolicLink()) throw new Error(`Refusing to write through a symlink: ${cur}`);
    if (!st.isDirectory()) throw new Error(`Expected a directory but found a file: ${cur}`);
  }
  const target = join(root, rel);
  const st = lstatOrNone(target);
  if (!st) return 'missing';
  if (st.isFile()) return 'file';
  throw new Error(`Cannot create ${target}: a ${st.isSymbolicLink() ? 'symlink' : 'directory or special file'} is in the way`);
}

export function writeScaffold(root: string, files: PlannedFile[], hooks: { beforeWrite?: (path: string, index: number) => void } = {}) {
  requireProjectLayout(root, 'init');
  // Decide before repairing ANY missing file: an existing workflow without TOML stays legacy.
  const legacy = inspect(root, `${scaffoldName}/factory.toml`) === 'missing' &&
    ['config.mts','main.mts','dispatch.mts','dispatch.sh'].some(f => inspect(root, `${scaffoldName}/${f}`) === 'file');
  if (legacy) throw new Error('Unsupported existing workflow without version 2 factory.toml; No conversion or adoption is performed.');
  const todo = files.filter(f => inspect(root, f.path) === 'missing'); // all preflight checks finish before the first write
  const skipped = files.filter(f => !todo.includes(f)).map(f => f.path);
  const created: string[] = [];
  for (const f of todo) {
    hooks.beforeWrite?.(f.path, created.length);
    requireProjectLayout(root, 'init');
    inspect(root, f.path);
    const target = join(root, f.path);
    mkdirSync(dirname(target), { recursive: true });
    let fd: number;
    try { fd = openSync(target, 'wx', f.mode); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${target} appeared while initializing; not overwriting it. Rerun to continue.`);
      throw e;
    }
    try { fchmodSync(fd, f.mode); writeSync(fd, f.content); closeSync(fd); }
    catch (e) { try { closeSync(fd); } catch {} rmSync(target, { force: true }); throw e; }
    created.push(f.path);
  }
  return { created, skipped };
}
