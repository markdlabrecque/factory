// Read-only project asset reports and historical inventory diagnostics; updates never repair project files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from './paths.mts';
import { scaffoldName, shq } from './paths.mts';
import { appRoot, FROM_BOARD, FROM_ORCHESTRATOR } from './scaffold.mts';

export type FileClass = 'current' | 'missing' | 'outdated' | 'modified' | 'project';
export type FileStatus = { file: string; class: FileClass; source: string; detail?: string };
export type History = { kind: 'git' | 'catalog' | 'none'; blobs: Map<string, Set<string>> };
export const HISTORY_FILE = 'scaffold-history.json';
/** Never overwritten by `factory update`; reported for a hand merge. */
export const PROJECT_OWNED = ['factory.toml', 'config.mts', 'main.mts', 'dispatch.sh', 'prompt.md', 'prompt.verify.md'];
const TEMPLATE = 'cli/templates/project';
const PLACEHOLDER = '{{STATE_DIR_QUOTED}}';

/** Each scaffolded file (except .env) and the Factory source file(s) it comes from. config.mts and .env.example have one per profile. */
export function scaffoldSources(): Record<string, string[]> {
  const out: Record<string, string[]> = {
    'factory.toml': ['orchestrator/factory.personal.toml', 'orchestrator/factory.client.toml'],
    'config.mts': ['orchestrator/config.personal.mts', 'orchestrator/config.mts'], 'main.mts': ['orchestrator/main.mts'],
    'prompt.md': [`${TEMPLATE}/prompt.md`], 'prompt.verify.md': [`${TEMPLATE}/prompt.verify.md`],
    '.env.example': [`${TEMPLATE}/env.personal.example`, `${TEMPLATE}/env.client.example`], '.gitignore': [`${TEMPLATE}/gitignore`],
    'factory-dispatch.sh': [`${TEMPLATE}/factory-dispatch.sh`],
  };
  for (const n of FROM_ORCHESTRATOR) out[n] = [`orchestrator/${n}`];
  for (const n of FROM_BOARD) out[n] = [`board/${n}`];
  return out;
}
const allSources = () => [...new Set(Object.values(scaffoldSources()).flat())].sort();

/** Git's blob id for some content (SHA-1, or SHA-256 for a SHA-256 repository's 64-hex ids). */
export function blobId(content: Buffer, algorithm: 'sha1' | 'sha256' = 'sha1') {
  return createHash(algorithm).update(`blob ${content.length}\0`).update(content).digest('hex');
}

/** Every committed blob id of each source file in the Git checkout `root`, or null when root is not a checkout's top level. */
export function gitHistory(root: string): Map<string, Set<string>> | null {
  let top: string;
  try { top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
  if (realpathSync(top) !== realpathSync(root)) return null;
  const out = execFileSync('git', ['-C', root, 'log', '--all', '--format=', '--raw', '--no-abbrev', '--no-renames', '--', ...allSources()],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  const blobs = new Map<string, Set<string>>();
  for (const line of out.split('\n')) {
    const m = line.match(/^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) \w+\t(.+)$/);
    if (!m) continue;
    const set = blobs.get(m[3]) ?? new Set();
    for (const id of [m[1], m[2]]) if (!/^0+$/.test(id)) set.add(id);
    blobs.set(m[3], set);
  }
  return blobs;
}

/** Write the catalog of earlier versions into a copied app (what install calls). Returns false when source has no Git history. */
export function writeHistoryCatalog(source: string, app: string): boolean {
  const blobs = gitHistory(source);
  if (!blobs) return false;
  const files = Object.fromEntries([...blobs].map(([k, v]) => [k, [...v].sort()]));
  writeFileSync(join(app, HISTORY_FILE), JSON.stringify({ version: 1, files }, null, 2) + '\n');
  return true;
}

/** The app's earlier versions: its own Git history, else the install catalog, else none. A malformed catalog counts as none. */
export function factoryHistory(app = appRoot): History {
  const git = gitHistory(app);
  if (git) return { kind: 'git', blobs: git };
  try {
    const d = JSON.parse(readFileSync(join(app, HISTORY_FILE), 'utf8'));
    if (d?.version === 1 && d.files && typeof d.files === 'object') {
      return { kind: 'catalog', blobs: new Map(Object.entries(d.files as Record<string, string[]>).map(([k, v]) => [k, new Set(v)])) };
    }
  } catch { /* none */ }
  return { kind: 'none', blobs: new Map() };
}

/** Report only project-owned data; workflow implementation belongs to Factory or the project override. */
export function classifyCopy(_p: Paths, root: string, o: { app?: string; history?: History; files?: string[] } = {}): FileStatus[] {
  loadTomlConfig(join(root, scaffoldName));
  const assets = ['factory.toml', '.env.example', '.gitignore', 'factory-dispatch.sh'];
  return assets.filter(file => !o.files || o.files.includes(file)).map(file => ({
    file, class: 'project' as const, source: 'project-owned',
    detail: existsSync(join(root, scaffoldName, file)) ? 'never modified by update' : 'absent; never created by update',
  }));
}

/** Compare historical inventory for diagnostics only. This never authorizes or performs repairs. */
export function classifyInventory(p: Paths, root: string, o: { app?: string; history?: History; files?: string[] } = {}): FileStatus[] {
  const app = o.app ?? appRoot;
  const history = o.history ?? factoryHistory(app);
  const read = (rel: string) => readFileSync(join(app, rel));
  const known = (src: string, content: Buffer) => {
    const ids = history.blobs.get(src);
    if (!ids?.size) return false;
    const algorithm = [...ids][0].length === 64 ? 'sha256' : 'sha1';
    return ids.has(blobId(content, algorithm));
  };
  return Object.entries(scaffoldSources()).filter(([file]) => !o.files || o.files.includes(file)).sort(([a], [b]) => a.localeCompare(b)).map(([file, sources]): FileStatus => {
    const target = join(root, scaffoldName, file);
    const owned = PROJECT_OWNED.includes(file);
    const st = (() => { try { return lstatSync(target); } catch { return undefined; } })();
    if (!st) return owned
      ? { file, class: 'project', source: sources[0], detail: 'absent from project' }
      : { file, class: 'missing', source: sources[0], detail: 'absent from historical copy' };
    if (!st.isFile()) return { file, class: owned ? 'project' : 'modified', source: sources[0], detail: 'not a regular file; not followed' };
    const content = readFileSync(target);
    if (file === 'factory.toml' || file === 'config.mts' || file === 'main.mts') {
      return { file, class: 'project', source: sources.join(' or '), detail: 'templated with your settings; compare with Factory\'s copy and merge by hand' };
    }
    if (file === 'factory-dispatch.sh') {
      const tpl = read(sources[0]).toString('utf8');
      const rendered = tpl.replace(PLACEHOLDER, () => shq(p.state));
      if (content.toString('utf8') === rendered) return { file, class: 'current', source: sources[0] };
      const text = content.toString('utf8');
      const generic = text.includes(shq(p.state)) ? Buffer.from(text.replace(shq(p.state), () => PLACEHOLDER)) : null;
      return generic && known(sources[0], generic)
        ? { file, class: 'outdated', source: sources[0], detail: 'unmodified earlier Factory copy; historical copy differs' }
        : { file, class: 'modified', source: sources[0], detail: 'edited locally' };
    }
    const exact = sources.find(s => existsSync(join(app, s)) && read(s).equals(content));
    if (exact) return { file, class: 'current', source: exact };
    if (owned) return { file, class: 'project', source: sources[0], detail: 'differs from Factory\'s copy' };
    const old = sources.find(s => known(s, content));
    return old
      ? { file, class: 'outdated', source: old, detail: 'unmodified earlier Factory copy; historical copy differs' }
      : { file, class: 'modified', source: sources[0], detail: 'edited locally' };
  });
}


export type Applied = { files: FileStatus[]; created: string[]; replaced: string[] };
export function applyCopy(p: Paths, root: string, o: { app?: string; history?: History } = {}): Applied {
  return { files: classifyCopy(p, root, o), created: [], replaced: [] };
}
