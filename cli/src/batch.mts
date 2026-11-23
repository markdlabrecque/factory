// Host-owned batch identity and ref transactions. Only a new-ref / fast-forward Git receipt plus exact remote readback can settle a write.
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { durableDirectory, syncDirectory, withAdmissionLock, writeDurable } from '../../board/admission.mts';
import { readBoundedText } from '../../orchestrator/ownership.mts';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
import { requireProjectLayout } from '../../orchestrator/project-layout.mts';
import { batchMembers, resolveMembers } from './batch-tracker.mts';
import { batchRegistration } from './project-registry.mts';
import type { Paths as FactoryPaths } from './paths.mts';
type Paths = Pick<FactoryPaths,'state'|'projects'>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isSha = (value:unknown):value is string => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const destination = (id: string) => `refs/heads/factory/batch/${id}`;
const gitArgs = (root: string) => ['--no-replace-objects','-C',root,'-c','core.hooksPath=/dev/null','-c','push.followTags=false','-c','push.recurseSubmodules=no','-c','remote.origin.mirror=false'];
function git(root: string, ...args: string[]): string {
  try { return execFileSync('git',[...gitArgs(root),...args],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trimEnd(); }
  catch { throw Error(`Batch Git ${args[0]} failed`); }
}
// Inspect even when the final directory does not exist: realpath of just the leaf (or existsSync)
// would miss a redirected ancestor or a dangling link. Never create a path in order to validate it.
function inspectDirectory(path:string): boolean {
  const parent = dirname(path);
  if (parent !== path && !inspectDirectory(parent)) return false;
  const stat = lstatSync(path,{throwIfNoEntry:false});
  if (!stat) return false;
  if (!stat.isDirectory() || realpathSync(path) !== path) throw Error('Batch state requires canonical directories without links');
  return true;
}
function batchStore(p:Paths, root:string) {
  if (!isAbsolute(p.state) || resolve(p.state) !== p.state) throw Error('Batch host state must be canonical');
  const store = join(p.state,'batches'), rel = relative(root,store);
  if (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)) throw Error('Batch host state must be outside the project checkout');
  if (inspectDirectory(store)) privatePath(store,true);
  return store;
}
const origin = 'origin';
function originEndpoint(root:string) {
  const fetch = git(root,'remote','get-url','--all',origin);
  if (!fetch || /[\s?#]/.test(fetch) || git(root,'remote','get-url','--push','--all',origin) !== fetch)
    throw Error('Batch requires one matching origin fetch/push endpoint');
  return fetch;
}
function context(p: Paths, project: string) {
  if (!project) throw Error('Batch requires an explicit registered project');
  const registration = batchRegistration(p,project), root = realpathSync(registration.root);
  if (root !== registration.root || git(root,'rev-parse','--show-toplevel') !== root) throw Error('Batch registration is not a canonical checkout root');
  batchStore(p,root);
  const config = loadTomlConfig(requireProjectLayout(root).assets,{strictOriginals:true}), t = config.TRACKER;
  if (config.workflow.mode !== 'factory') throw Error('Batch does not convert project workflow overrides');
  const host = t.host ?? t.gitlabHost!, remote = originEndpoint(root);
  const url = /^(?:https:\/\/|ssh:\/\/(?:git@)?)([\w.-]+)\/(.+)$/.exec(remote) ?? /^(?:git@)?([\w.-]+):(.+)$/.exec(remote);
  if (!url || url[1].toLowerCase() !== host.toLowerCase() || url[2].replace(/\.git$/,'') !== t.project)
    throw Error('Batch requires one matching tracker repository and origin fetch/push endpoint');
  return {root, config, endpoint:remote, repository:`${t.kind}:${host}/${t.project}${t.projectId ? `:${t.projectId}` : ''}`, branch:registration.schedule?.branch};
}
type Context = ReturnType<typeof context>;
// The expanded endpoint is identity evidence, never a Git operand. An anonymous URL can
// resolve differently from the named remote (notably for explicit pushurl and URL rewrites).
function checkedOrigin(c:Context) {
  if (originEndpoint(c.root) !== c.endpoint) throw Error('Batch origin endpoint changed');
  return origin;
}
export type BatchIdentity = { version:1; id:string; root:string; repository:string; members:number[]; baseRef:string; sourceSha:string; destinationRef:string; expectedHead:string };
type Pending = { next:string; attempt:string };
type Record = BatchIdentity & { phase:'creating'|'ready'|'advancing'; pending:Pending|null };
function observe(c:Context, ref:string): string|null {
  const out = git(c.root,'ls-remote','--refs','--',checkedOrigin(c),ref);
  if (!out) return null;
  const [value,name] = out.split('\t');
  if (!isSha(value) || name !== ref) throw Error('Ambiguous remote batch ref');
  return value;
}
function privatePath(path:string, directory:boolean) {
  const stat = lstatSync(path);
  if (realpathSync(path) !== path || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || !(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1)) throw Error('Unsafe batch ownership path');
}
function location(p:Paths,id:string) {
  if (!uuid.test(id)) throw Error('Invalid batch ID');
  return join(p.state,'batches',id);
}
function load(dir:string,c:Context,id:string): Record {
  privatePath(join(dir,'..'),true); privatePath(dir,true);
  const lockDir = join(dir,'admission');
  if (inspectDirectory(lockDir)) privatePath(lockDir,true);
  const file = join(dir,'batch.json'); privatePath(file,false);
  const r = JSON.parse(readBoundedText(file,1<<20,'batch record'));
  if (r?.version !== 1 || r.id !== id || r.root !== c.root || r.repository !== c.repository || r.destinationRef !== destination(id)
      || !isSha(r.sourceSha) || !isSha(r.expectedHead) || typeof r.baseRef !== 'string' || !r.baseRef.startsWith('refs/heads/')
      || r.baseRef.startsWith('refs/heads/factory/batch/') || !Array.isArray(r.members) || !r.members.every(Number.isSafeInteger))
    throw Error('Missing or mismatched batch ownership');
  batchMembers(r.members.map(String));
  const pending = r.pending;
  if (r.phase === 'ready' && pending === null) return r;
  if (typeof pending?.attempt === 'string' && uuid.test(pending.attempt) && isSha(pending.next)) {
    if (r.phase === 'advancing' && pending.next !== r.expectedHead) return r;
    if (r.phase === 'creating' && pending.next === r.sourceSha && r.expectedHead === r.sourceSha) return r;
  }
  throw Error('Unknown batch transaction');
}
function save(dir:string,r:Record) { writeDurable(join(dir,'batch.json'),JSON.stringify(r)+'\n'); }
function identity(r:Record):BatchIdentity {
  const {version,id,root,repository,members,baseRef,sourceSha,destinationRef,expectedHead} = r;
  return {version,id,root,repository,members,baseRef,sourceSha,destinationRef,expectedHead};
}
function receipt(dir:string,r:Record):boolean {
  const file = join(dir,r.pending!.attempt+'.push');
  if (!existsSync(file)) return false;
  privatePath(file,false);
  const status = r.phase === 'creating' ? '*' : ' ';
  return readBoundedText(file,65536,'Git push receipt').split('\n').some(line => line.startsWith(`${status}\t${r.pending!.next}:${r.destinationRef}\t`));
}
// Check before locking as well: passive reads and holds must not mutate state.
function check(dir:string,c:Context,r:Record) {
  const head = observe(c,r.destinationRef);
  if (r.phase === 'ready' && head === r.expectedHead) return 'ready';
  if (r.pending && receipt(dir,r) && head === r.pending.next) return 'settle';
  if (r.phase === 'creating' && head === null && !receipt(dir,r)) return 'create';
  throw Error('Batch held: destination missing, collided, drifted, or lacks a confirmed host write');
}
function settle(dir:string,c:Context,r:Record):BatchIdentity {
  if (check(dir,c,r) !== 'settle') throw Error('Batch push not confirmed');
  const ready:Record = {...r,expectedHead:r.pending!.next,phase:'ready',pending:null};
  save(dir,ready); return identity(ready);
}
function push(dir:string,c:Context,r:Record):BatchIdentity {
  const {next,attempt} = r.pending!;
  const target = checkedOrigin(c);
  const fd = openSync(join(dir,attempt+'.push'),'wx',0o600);
  try {
    syncDirectory(dir);
    // Exact absent/old lease, no '+' refspec, verified ancestry on advances. Up-to-date is NOT evidence of ownership.
    spawnSync('git',[...gitArgs(c.root),'push','--porcelain',`--force-with-lease=${r.destinationRef}:${r.phase === 'creating' ? '' : r.expectedHead}`,'--',target,`${next}:${r.destinationRef}`],{stdio:['ignore',fd,'pipe'],timeout:30000,env:{...process.env,LC_ALL:'C'}});
    fsyncSync(fd);
  } finally { closeSync(fd); }
  return settle(dir,c,r);
}
export function submitBatch(p:Paths,project:string,ids:string[],onReserved?: (id:string)=>void):BatchIdentity {
  const members = batchMembers(ids), c = context(p,project);
  resolveMembers(c.config,members);
  const baseRef = c.branch ? `refs/heads/${c.branch}` : /^ref: (refs\/heads\/[^\s]+)\tHEAD$/m.exec(git(c.root,'ls-remote','--symref','--',checkedOrigin(c),'HEAD'))?.[1];
  if (!baseRef || baseRef.startsWith('refs/heads/factory/batch/')) throw Error('Missing or invalid configured base branch');
  git(c.root,'check-ref-format',baseRef);
  const sourceSha = observe(c,baseRef); if (!sourceSha) throw Error('Configured base missing from origin');
  // The checkout may be stale; fetch only the pinned commit, without changing any checkout or local branch.
  batchStore(p,c.root);
  git(c.root,'fetch','--no-tags','--no-write-fetch-head','--recurse-submodules=no','--refmap=','--',checkedOrigin(c),sourceSha);
  if (git(c.root,'cat-file','-t',sourceSha) !== 'commit') throw Error('Base is not a commit');
  const id = randomUUID(), dir = location(p,id), parent = batchStore(p,c.root);
  durableDirectory(parent); privatePath(parent,true); mkdirSync(dir,{mode:0o700}); syncDirectory(parent);
  const r:Record = {version:1,id,root:c.root,repository:c.repository,members,baseRef,sourceSha,destinationRef:destination(id),expectedHead:sourceSha,phase:'creating',pending:{next:sourceSha,attempt:randomUUID()}};
  save(dir,r);
  onReserved?.(id);
  try { return resumeBatch(p,project,id); } catch (e) { throw Error(`Batch ${id}: ${(e as Error).message}`); }
}
/** Passive dispatch/delivery lookup; an incomplete transaction requires explicit operator resume. */
export function readOwnedBatch(p:Paths,project:string,id:string):BatchIdentity {
  const dir = location(p,id), c = context(p,project), r = load(dir,c,id);
  if (r.phase !== 'ready' || check(dir,c,r) !== 'ready') throw Error('Pending batch transaction; resume first');
  return identity(r);
}
export function resumeBatch(p:Paths,project:string,id:string):BatchIdentity {
  const dir = location(p,id), c = context(p,project), r = load(dir,c,id);
  if (check(dir,c,r) === 'ready') return identity(r);
  return withAdmissionLock(dir,() => {
    const current = load(dir,c,id), action = check(dir,c,current);
    if (action === 'ready') return identity(current);
    if (action === 'settle') return settle(dir,c,current);
    if (existsSync(join(dir,current.pending!.attempt+'.push'))) throw Error('Unconfirmed creation attempt; refusing blind retry');
    return push(dir,c,current);
  });
}
/** Trusted delivery consumer only, AFTER its independent exact-candidate gate. No caller-supplied ref, no public CLI route. */
export function advanceBatch(p:Paths,project:string,id:string,expectedOld:string,next:string):BatchIdentity {
  const c = context(p,project), dir = location(p,id);
  function validate() {
    const r = load(dir,c,id);
    if (r.phase !== 'ready' || check(dir,c,r) !== 'ready' || r.expectedHead !== expectedOld || !isSha(next) || next === expectedOld || git(c.root,'cat-file','-t',next) !== 'commit') throw Error('Stale or invalid batch candidate');
    git(c.root,'merge-base','--is-ancestor',expectedOld,next); return r;
  }
  validate();
  return withAdmissionLock(dir,() => {
    const pending:Record = {...validate(),phase:'advancing',pending:{next,attempt:randomUUID()}};
    save(dir,pending); return push(dir,c,pending);
  });
}
