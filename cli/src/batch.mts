// Bind batch ownership to the authenticated tracker repository ID and named Git origin. Only a positive push receipt and exact readback settle a write.
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { durableDirectory, syncDirectory, withAdmissionLock, writeDurable } from '../../board/admission.mts';
import { readBoundedText } from '../../orchestrator/ownership.mts';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
import { requireProjectLayout } from '../../orchestrator/project-layout.mts';
import { batchMembers, resolveMembers, trackerRepositoryId } from './batch-tracker.mts';
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
// In a URI the port belongs to the authority; in SCP syntax everything after the colon is the repository path.
export function matchesTrackerOrigin(remote:string, host:string, project:string):boolean {
  if (/[\s?#]/.test(remote)) return false;
  const parts = remote.includes('://')
    ? /^(?:https:\/\/|ssh:\/\/(?:git@)?)([\w.-]+(?::\d{1,5})?)\/(.+)$/.exec(remote)
    : /^(?:git@)?([\w.-]+):(.+)$/.exec(remote);
  if (!parts || parts[1].toLowerCase() !== host.toLowerCase() || parts[2].replace(/\.git$/,'') !== project) return false;
  const port = parts[1].split(':')[1];
  return !port || (Number(port) > 0 && Number(port) <= 65535);
}
function context(p: Paths, project: string) {
  if (!project) throw Error('Batch requires an explicit registered project');
  const registration = batchRegistration(p,project), root = realpathSync(registration.root);
  if (root !== registration.root || git(root,'rev-parse','--show-toplevel') !== root) throw Error('Batch registration is not a canonical checkout root');
  batchStore(p,root);
  const config = loadTomlConfig(requireProjectLayout(root).assets,{strictOriginals:true}), t = config.TRACKER;
  if (config.workflow.mode !== 'factory') throw Error('Batch does not convert project workflow overrides');
  const host = t.host ?? t.gitlabHost!, remote = originEndpoint(root);
  if (!matchesTrackerOrigin(remote,host,t.project))
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
// Named pushes also update the local ref selected by remote.origin.fetch. Never let
// that implicit update target an operator branch, including via a symbolic tracking ref.
function checkTracking(root:string, id?:string) {
  const mappings = git(root,'config','--null','--get-all','remote.origin.fetch');
  if (!['+refs/heads/*:refs/remotes/origin/*\0','refs/heads/*:refs/remotes/origin/*\0'].includes(mappings))
    throw Error('Batch requires conventional origin fetch tracking');
  if (id) {
    const probe = spawnSync('git',[...gitArgs(root),'symbolic-ref','--quiet','--no-recurse',`refs/remotes/origin/factory/batch/${id}`],{timeout:30000,stdio:'ignore'});
    if (probe.error || probe.signal || probe.status !== 1) throw Error('Unsafe batch tracking ref');
  }
}
function verifyRepository(c:Context, expected:string) {
  if (trackerRepositoryId(c.config) !== expected) throw Error('Batch held: tracker repository identity changed');
}
export type BatchIdentity = { version:2; id:string; root:string; repository:string; repositoryId:string; members:number[]; baseRef:string; sourceSha:string; destinationRef:string; expectedHead:string };
type Pending = { next:string; attempt:string };
type Record = BatchIdentity & { phase:'creating'|'ready'|'advancing'; pending:Pending|null };
function observe(c:Context, ref:string): string|null {
  const out = git(c.root,'ls-remote','--refs','--',checkedOrigin(c),ref);
  if (!out) return null;
  const [value,name] = out.split('\t');
  if (!isSha(value) || name !== ref) throw Error('Ambiguous remote batch ref');
  return value;
}
// No local retention ref: a stale checkout can lose an unreachable object to GC.
// Always fetch by the saved object ID, never the possibly moved base branch.
function fetchCommit(c:Context, repositoryId:string, sha:string) {
  verifyRepository(c,repositoryId);
  git(c.root,'fetch','--no-prune','--no-prune-tags','--no-tags','--no-write-fetch-head','--no-auto-maintenance','--recurse-submodules=no','--refmap=','--',checkedOrigin(c),sha);
  if (git(c.root,'cat-file','-t',sha) !== 'commit') throw Error('Batch base is not a commit');
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
  if (r?.version !== 2 || typeof r.repositoryId !== 'string' || !r.repositoryId || r.id !== id || r.root !== c.root || r.repository !== c.repository || r.destinationRef !== destination(id)
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
  const {version,id,root,repository,repositoryId,members,baseRef,sourceSha,destinationRef,expectedHead} = r;
  return {version,id,root,repository,repositoryId,members,baseRef,sourceSha,destinationRef,expectedHead};
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
  verifyRepository(c,r.repositoryId);
  if (r.phase === 'ready' && head === r.expectedHead) return 'ready';
  if (r.pending && receipt(dir,r) && head === r.pending.next) return 'settle';
  // The marker directory entry is synced before spawn. Only ENOENT, not an
  // empty receipt or dangling symlink, proves this intent didn't reach Git.
  if (r.pending && !lstatSync(join(dir,r.pending.attempt+'.push'),{throwIfNoEntry:false})) {
    if (r.phase === 'creating' && head === null) return 'create';
    if (r.phase === 'advancing' && head === r.expectedHead) return 'discard-advance';
  }
  throw Error('Batch held: destination missing, collided, drifted, or lacks a confirmed host write');
}
function settle(dir:string,c:Context,r:Record):BatchIdentity {
  if (check(dir,c,r) !== 'settle') throw Error('Batch push not confirmed');
  // Retain the observed historical fact before clearing the intent. A crash between batch
  // settlement and member journalling must not require a working tracker to remember landing.
  if(r.phase==='advancing')writeDurable(join(dir,r.pending!.attempt+'.settled'),JSON.stringify({version:1,id:r.id,repositoryId:r.repositoryId,destination:r.destinationRef,old:r.expectedHead,next:r.pending!.next,attempt:r.pending!.attempt}));
  const ready:Record = {...r,expectedHead:r.pending!.next,phase:'ready',pending:null};
  save(dir,ready); return identity(ready);
}
type Publish = (write:()=>void)=>void;
function push(dir:string,c:Context,r:Record, prepare?:()=>Publish):BatchIdentity {
  const {next,attempt} = r.pending!;
  if (r.phase === 'creating') {
    let present = false;
    try { present = git(c.root,'cat-file','-t',next) === 'commit'; } catch { /* missing or unreadable locally */ }
    if (!present) {
      checkTracking(c.root,r.id);
      fetchCommit(c,r.repositoryId,next);
    }
  }
  verifyRepository(c,r.repositoryId);
  const publish=prepare?.() ?? (write=>write());
  const marker = join(dir,attempt+'.push');
  if (lstatSync(marker,{throwIfNoEntry:false})) throw Error('Batch attempt already exists');
  const args = [...gitArgs(c.root),'-c','push.pushOption=','push','--porcelain',`--force-with-lease=${r.destinationRef}:${r.phase === 'creating' ? '' : r.expectedHead}`,'--',checkedOrigin(c),`${next}:${r.destinationRef}`];
  checkTracking(c.root,r.id);
  // Final claim check, both durable intents and the actual bounded Git process share the revocation lock.
  publish(()=>recordPush(dir,r,marker,args));
  return settle(dir,c,r);
}
function recordPush(dir:string,r:Record,marker:string,args:string[]) {
  let fd:number|undefined, mayHaveLaunched = false;
  try {
    if (r.phase === 'advancing') save(dir,r);
    fd = openSync(marker,'wx',0o600);
    syncDirectory(dir);
    mayHaveLaunched = true;
    const result = spawnSync('git',args,{stdio:['ignore',fd,'pipe'],timeout:30000,killSignal:'SIGKILL',env:{...process.env,LC_ALL:'C'}});
    const error = result.error as NodeJS.ErrnoException|undefined;
    if ((error?.code === 'ENOENT' || error?.code === 'EACCES') && error.syscall === 'spawnSync git' && result.pid === 0 && result.status === null && result.signal === null) {
      mayHaveLaunched = false;
      throw Error(`Batch Git push executable did not launch: ${error.code}`);
    }
    fsyncSync(fd);
  } catch (error) {
    if (!mayHaveLaunched) {
      // Under the batch lock, restore the old authority even if saving intent failed after rename.
      if (r.phase === 'advancing') save(dir,{...r,phase:'ready',pending:null});
      if (fd !== undefined) {
        const owned = fstatSync(fd,{bigint:true}), current = lstatSync(marker,{bigint:true});
        if (owned.dev !== current.dev || owned.ino !== current.ino) throw Error('Batch attempt marker changed');
        unlinkSync(marker); syncDirectory(dir);
      }
    }
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function submitBatch(p:Paths,project:string,ids:string[],onReserved?: (id:string)=>void):BatchIdentity {
  const members = batchMembers(ids), c = context(p,project);
  checkTracking(c.root);
  const repositoryId = trackerRepositoryId(c.config);
  resolveMembers(c.config,members,repositoryId);
  const baseRef = c.branch ? `refs/heads/${c.branch}` : /^ref: (refs\/heads\/[^\s]+)\tHEAD$/m.exec(git(c.root,'ls-remote','--symref','--',checkedOrigin(c),'HEAD'))?.[1];
  if (!baseRef || baseRef.startsWith('refs/heads/factory/batch/')) throw Error('Missing or invalid configured base branch');
  git(c.root,'check-ref-format',baseRef);
  const sourceSha = observe(c,baseRef); if (!sourceSha) throw Error('Configured base missing from origin');
  // The checkout may be stale; fetch only the pinned commit, without changing any checkout or local branch.
  batchStore(p,c.root);
  fetchCommit(c,repositoryId,sourceSha);
  const id = randomUUID(), dir = location(p,id), parent = batchStore(p,c.root);
  verifyRepository(c,repositoryId);
  durableDirectory(parent); privatePath(parent,true); mkdirSync(dir,{mode:0o700}); syncDirectory(parent);
  const r:Record = {version:2,id,root:c.root,repository:c.repository,repositoryId,members,baseRef,sourceSha,destinationRef:destination(id),expectedHead:sourceSha,phase:'creating',pending:{next:sourceSha,attempt:randomUUID()}};
  save(dir,r);
  onReserved?.(id);
  try { return resumeBatch(p,project,id); } catch (e) { throw Error(`Batch ${id}: ${(e as Error).message}`); }
}
/** Status only: distinguish the actual remote ref (or an unavailable observation) from the last settled head. */
export function inspectBatchHead(p:Paths,project:string,id:string) {
  const c=context(p,project), b=identity(load(location(p,id),c,id));
  try {verifyRepository(c,b.repositoryId);return {b,observedHead:observe(c,b.destinationRef)}}
  catch {return {b,observedHead:null}}
}
/** Historical command namespace: registration and private original only, independent of live tracker or Git. */
export function batchCommandStore(p:Paths,project:string,id:string) {
  const dir=location(p,id), root=batchRegistration(p,project).root;
  batchStore(p,root); privatePath(dirname(dir),true); privatePath(dir,true);
  const file=join(dir,'batch.json'); privatePath(file,false);
  const original=JSON.parse(readBoundedText(file,1<<20,'batch identity'));
  if(original.id!==id || original.root!==root || original.version!==2 || original.destinationRef!==destination(id)) throw Error('Mismatched batch command identity');
  return dir;
}
/** Passive dispatch/delivery lookup; an incomplete transaction requires explicit operator resume. */
export function readOwnedBatch(p:Paths,project:string,id:string):BatchIdentity {
  const dir = location(p,id), c = context(p,project), r = load(dir,c,id);
  if (check(dir,c,r) !== 'ready') throw Error('Pending batch transaction; resume first');
  return identity(r);
}
export function resumeBatch(p:Paths,project:string,id:string):BatchIdentity {
  const dir = location(p,id), c = context(p,project), r = load(dir,c,id);
  if (check(dir,c,r) === 'ready') return identity(r);
  return withAdmissionLock(dir,() => {
    const current = load(dir,c,id), action = check(dir,c,current);
    if (action === 'ready') return identity(current);
    if (action === 'settle') return settle(dir,c,current);
    if (action === 'discard-advance') {
      const ready:Record = {...current,phase:'ready',pending:null};
      save(dir,ready); return identity(ready);
    }
    return push(dir,c,current);
  });
}
/** Local host member namespace. Does not adopt or settle pending Git transactions. */
export function batchMemberLocation(p:Paths,project:string,id:string,ticket:number) {
  const c=context(p,project), dir=location(p,id), r=load(dir,c,id);
  if(!r.members.includes(ticket)) throw Error('Ticket is not an owned batch member');
  return {dir, root:c.root, config:c.config, identity:identity(r)};
}
/** Historical settlement only, never authority for another write. Requires both the host's
 * authenticated exact readback at settlement and the positive porcelain receipt for this attempt. */
export function confirmedBatchAdvance(p:Paths,project:string,id:string,ticket:number,old:string,next:string,attempt:string):boolean {
  if(!uuid.test(attempt)||!isSha(old)||!isSha(next))throw Error('Invalid delivery identity');
  const {dir,identity:r}=batchMemberLocation(p,project,id,ticket),file=join(dir,attempt+'.settled');
  if(!lstatSync(file,{throwIfNoEntry:false}))return false;
  privatePath(file,false);
  const s=JSON.parse(readBoundedText(file,65536,'batch settlement'));
  if(s.version!==1||s.id!==id||s.repositoryId!==r.repositoryId||s.destination!==r.destinationRef||s.old!==old||s.next!==next||s.attempt!==attempt)throw Error('Mismatched batch settlement');
  return receipt(dir,{...r,phase:'advancing',pending:{next,attempt}});
}
/** Read-only receipt reconciliation; settle ONLY the named advance with its positive receipt and exact readback. */
export function observedBatchAdvance(p:Paths,project:string,id:string,old:string,next:string,attempt:string):'landed'|'refused'|'unknown' {
  if(!uuid.test(attempt)||!isSha(old)||!isSha(next)) throw Error('Invalid delivery identity');
  const c=context(p,project),dir=location(p,id);
  return withAdmissionLock(dir,()=>{
    const r=load(dir,c,id), file=join(dir,attempt+'.push');
    verifyRepository(c,r.repositoryId);
    if(!existsSync(file)) return 'unknown';
    privatePath(file,false);
    const lines=readBoundedText(file,65536,'Git push receipt').split('\n');
    if(lines.some(l=>l.startsWith(`!\t${next}:${r.destinationRef}\t`))) return 'refused';
    if(!lines.some(l=>l.startsWith(` \t${next}:${r.destinationRef}\t`))) return 'unknown';
    if(r.phase==='advancing' && r.expectedHead===old && r.pending?.attempt===attempt && r.pending.next===next) { settle(dir,c,r); return 'landed'; }
    if(r.phase!=='ready'||check(dir,c,r)!=='ready') return 'unknown';
    git(c.root,'merge-base','--is-ancestor',next,r.expectedHead);
    return 'landed';
  });
}
/** Trusted delivery consumer only, AFTER its independent exact-candidate gate. No caller-supplied ref, no public CLI route. */
export function advanceBatch(p:Paths,project:string,id:string,expectedOld:string,next:string, attempt=randomUUID() as string, prepare?:()=>Publish):BatchIdentity {
  if (!uuid.test(attempt)) throw Error('Invalid advance attempt');
  const c = context(p,project), dir = location(p,id);
  function validate() {
    const r = load(dir,c,id);
    if (r.phase !== 'ready' || check(dir,c,r) !== 'ready' || r.expectedHead !== expectedOld || !isSha(next) || next === expectedOld || git(c.root,'cat-file','-t',next) !== 'commit') throw Error('Stale or invalid batch candidate');
    git(c.root,'merge-base','--is-ancestor',expectedOld,next); return r;
  }
  validate();
  return withAdmissionLock(dir,() => {
    const pending:Record = {...validate(),phase:'advancing',pending:{next,attempt}};
    return push(dir,c,pending,prepare);
  });
}
