// Scaffold writer: builds the allowlisted `.sandcastle/` assets from the installed app (never from cwd) and
// creates only the files that are missing. Existing files are never touched; symlinked or mistyped
// destinations are rejected before any write; creation is exclusive ('wx'), so a race fails instead of
// overwriting. A failed write removes its own partial file, leaving a scaffold a rerun can repair. The allowlist
// includes handoff.mts, the verify/deliver steps main.mts imports (shared with recovery runs, #58).
import { closeSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldName, shq } from './paths.mts';

export const appRoot = fileURLToPath(new URL('../../', import.meta.url));
export type Profile = 'personal' | 'client';
export type Settings = { profile: Profile; repo: string; image: string; host?: string; projectId?: number };
export type PlannedFile = { path: string; content: string | Buffer; mode: number };

const FROM_ORCHESTRATOR = ['dispatch.mts', 'dispatch.sh', 'graph.mts', 'analyze.mts', 'tracker.mts', 'tracker.gitlab.mts', 'tracker.github.mts',
  'ci.mts', 'models.mts', 'manifests.mts', 'preflight.mts', 'prompt.analyze.md', 'handoff.mts'];
const FROM_BOARD = ['board.mts', 'board.template.html'];

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
  const modeOf = (rel: string) => statSync(join(root, rel)).mode & 0o777;
  const out: PlannedFile[] = [];
  const add = (name: string, content: string | Buffer, mode = 0o644) => out.push({ path: `${scaffoldName}/${name}`, content, mode });
  const copy = (name: string, rel: string) => add(name, read(rel), modeOf(rel));

  const personal = s.profile === 'personal';
  const config = read(personal ? 'orchestrator/config.personal.mts' : 'orchestrator/config.mts').toString('utf8');
  const edits: Edit[] = [
    { tag: 'project', line: /^(\s*project:\s*)"[^"]*"/, value: m => `${m[1]}${JSON.stringify(s.repo)}` },
    { tag: 'milestone', line: /^(\s*milestone:\s*)undefined as string \| undefined/, value: m => m[0] },
    ...(personal ? [] : [
      { tag: 'host', line: /^(\s*gitlabHost:\s*)"[^"]*"/, value: (m: RegExpMatchArray) => `${m[1]}${JSON.stringify(s.host)}` },
      { tag: 'project-id', line: /^(\s*projectId:\s*)\d+/, value: (m: RegExpMatchArray) => `${m[1]}${s.projectId}` },
    ]),
  ];
  add('config.mts', fillTags(config, edits));

  let main = read('orchestrator/main.mts').toString('utf8');
  main = fillTags(main, [{ tag: 'image', line: /^(\s*image:\s*)"[^"]*"/, value: m => `${m[1]}${JSON.stringify(s.image)}` }]);
  main = replaceBlock(main, 'sandbox-setup',
    '  sandboxSetup: [] as { command: string; sudo?: boolean; timeoutMs?: number }[], // add environment setup commands here (see the sandcastle-setup skill)');
  add('main.mts', main, modeOf('orchestrator/main.mts'));

  for (const name of FROM_ORCHESTRATOR) copy(name, `orchestrator/${name}`);
  for (const name of FROM_BOARD) copy(name, `board/${name}`);
  const tpl = (name: string) => read(`cli/templates/project/${name}`);
  add('prompt.md', tpl('prompt.md'));
  add('prompt.verify.md', tpl('prompt.verify.md'));
  add('.env.example', tpl(personal ? 'env.personal.example' : 'env.client.example'));
  add('.gitignore', tpl('gitignore'));
  add('.env', '', 0o600);
  add('factory-dispatch.sh', tpl('factory-dispatch.sh').toString('utf8').replace('{{STATE_DIR_QUOTED}}', () => shq(stateDir)), 0o755);
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
  const todo = files.filter(f => inspect(root, f.path) === 'missing'); // all preflight checks finish before the first write
  const skipped = files.filter(f => !todo.includes(f)).map(f => f.path);
  const created: string[] = [];
  for (const f of todo) {
    hooks.beforeWrite?.(f.path, created.length);
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
