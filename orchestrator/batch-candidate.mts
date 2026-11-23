// Construct prospective commits and expose exact Git objects without checking out files or updating refs.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = 64 * 1024 * 1024;
function candidateGit(repo: string, args: string[], input?: string, objects?: string, timeout=60_000) {
  return execFileSync('git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd: repo, input, maxBuffer: LIMIT, timeout, killSignal:'SIGKILL', stdio: ['pipe','pipe','pipe'],
    env: { PATH: process.env.PATH, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_LAZY_FETCH: '1',
      ...(objects ? {GIT_OBJECT_DIRECTORY:objects} : {}), GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Factory', GIT_AUTHOR_EMAIL: 'factory@localhost',
      GIT_COMMITTER_NAME: 'Factory', GIT_COMMITTER_EMAIL: 'factory@localhost' },
  });
}
export function prospectiveCommit(repo: string, head: string, base: string, tip: string, attempt: string) {
  const git = (...args: string[]) => candidateGit(repo, args).toString().trim();
  for (const sha of [head,base,tip]) {
    if (!/^[0-9a-f]{40}$/.test(sha) || git('rev-parse','--verify',`${sha}^{commit}`) !== sha) throw Error('Expected exact Git commit');
  }
  git('merge-base','--is-ancestor',base,tip);
  git('merge-base','--is-ancestor',base,head);
  // .gitattributes is candidate-controlled. A configured merge driver must not turn merge-tree into host code execution.
  // Use a clean bare repo for Git policy/config while retaining the exact new objects in the host repo.
  const objects = git('rev-parse','--path-format=absolute','--git-path','objects');
  const bare = mkdtempSync(join(tmpdir(),'factory-merge-'));
  try {
    candidateGit(bare,['init','--bare','--template=','-q','.']);
    const plumbing = (...args:string[]) => candidateGit(bare,args,undefined,objects).toString().trim();
    const tree = plumbing('merge-tree','--write-tree',`--merge-base=${base}`,head,tip);
    if (!/^[0-9a-f]{40}$/.test(tree) || tree === plumbing('rev-parse',`${head}^{tree}`)) throw Error('No prospective ticket change');
    return plumbing('commit-tree',tree,'-p',head,'-m',`Factory ticket attempt ${attempt}`);
  } finally { rmSync(bare,{recursive:true,force:true}); }
}
export function candidatePack(repo: string, sha: string) {
  const objects = candidateGit(repo, ['rev-list','--objects','--no-object-names',`${sha}^{tree}`]).toString();
  return candidateGit(repo,['pack-objects','--stdout','--no-reuse-delta','--no-reuse-object'],`${sha}\n${objects}`);
}
// Apply model-proposed file replacements only to a private bare index. No checkout, hooks or project commands.
export function applyProposal(repo:string,start:string,proposal:string) {
  if(!/^[0-9a-f]{40}$/.test(start)||candidateGit(repo,['rev-parse','--verify',`${start}^{commit}`]).toString().trim()!==start)throw Error('Invalid proposal start');
  if(Buffer.byteLength(proposal)>1024*1024)throw Error('Implementation proposal too large');
  const parsed=JSON.parse(proposal);
  if(!parsed || Object.keys(parsed).join(',')!=='edits')throw Error('Invalid implementation proposal');
  const edits=parsed.edits;
  if(!Array.isArray(edits)||!edits.length||edits.length>256)throw Error('Invalid implementation proposal');
  const objects=candidateGit(repo,['rev-parse','--path-format=absolute','--git-path','objects']).toString().trim();
  const bare=mkdtempSync(join(tmpdir(),'factory-delta-'));
  try {
    candidateGit(bare,['init','--bare','--template=','-q','.']);
    const git=(args:string[],input?:string)=>candidateGit(bare,args,input,objects).toString().trim();
    git(['read-tree',start]);const seen=new Set<string>();
    for(const edit of edits){
      if(!edit||Object.keys(edit).sort().join(',')!=='content,path')throw Error('Invalid implementation edit');
      const {path,content}=edit;
      if(typeof path!=='string'||Buffer.byteLength(path)>512||/[\x00-\x1f\\]/.test(path)||path.split('/').some(x=>!x||x==='.'||x==='..'||x.toLowerCase()==='.git')||seen.has(path))throw Error('Invalid implementation path');
      seen.add(path);
      const mode=git(['--literal-pathspecs','ls-tree',start,'--',path]).split(' ')[0];
      if(mode && mode!=='100644' && mode!=='100755')throw Error('Not a regular implementation file');
      if(content===null && mode){git(['update-index','-z','--index-info'],`0 ${'0'.repeat(40)}\t${path}\0`);continue}
      if(typeof content!=='string'||content.includes('\0')||Buffer.from(content).toString()!==content)throw Error('Invalid implementation content');
      const oid=git(['hash-object','-w','--no-filters','--stdin'],content);
      git(['update-index','--add','--cacheinfo',mode||'100644',oid,path]);
    }
    const tree=git(['write-tree']);
    const changes=changedPaths(bare,start,tree,objects);
    if(!changes.length)throw Error('Empty implementation delta');
    if(changes.some(path=>!seen.has(path)))throw Error('Unexpected implementation path change');
    return git(['commit-tree',tree,'-p',start,'-m','Factory implementation proposal']);
  } finally {rmSync(bare,{recursive:true,force:true})}
}
const decode = (bytes:Buffer) => new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes);

export const BATCH_CONTEXT_LIMIT = 64 * 1024;
export type ReviewView = ReturnType<typeof openReviewView>;

export function literalPath(path: unknown): string {
  if(typeof path!=='string'||Buffer.byteLength(path)>512||/[\x00-\x1f\\]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'))throw Error('Invalid checkout path');
  return path;
}

/** An immutable checkout view. Git runs in a private bare repository with no project config,
 * working-tree access, environment discovery, external diff, or command surface for a reviewer. */
export function openReviewView(repo:string, base:string, candidate:string) {
  for(const sha of [base,candidate]) if(!/^[0-9a-f]{40}$/.test(sha))throw Error('Invalid review commit');
  const objects=candidateGit(repo,['rev-parse','--path-format=absolute','--git-path','objects']).toString().trimEnd();
  const bare=mkdtempSync(join(tmpdir(),'factory-review-'));
  const close=()=>rmSync(bare,{recursive:true,force:true});
  function run(args:string[],none=false) {
    const result=spawnSync('git',['--no-replace-objects','--literal-pathspecs',...args],{cwd:bare,
      env:{PATH:process.env.PATH,LC_ALL:'C',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_LAZY_FETCH:'1',GIT_OBJECT_DIRECTORY:objects,GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0'},
      stdio:['ignore','pipe','pipe'],maxBuffer:BATCH_CONTEXT_LIMIT,timeout:5000,killSignal:'SIGKILL'});
    if(result.error||result.signal||result.stdout.length>BATCH_CONTEXT_LIMIT)throw Error('Review tool exceeded its output or time limit');
    if(result.status!==0&&!(none&&result.status===1))throw Error('Review tool could not read exact objects');
    return decode(result.stdout);
  }
  try {
    candidateGit(bare,['init','--bare','--template=','-q','.']);
    for(const sha of [base,candidate]) if(run(['rev-parse','--verify',`${sha}^{commit}`]).trim()!==sha)throw Error('Missing review commit');
  } catch(error){close();throw error}
  const ref=(side:unknown)=>{if(side==='candidate')return candidate;if(side==='base')return base;throw Error('Invalid review side')};
  const scope=(path:unknown)=>path===undefined?[]:[literalPath(path)];
  return {
    close,
    list:(side:unknown,path?:unknown)=>run(['ls-tree','-z','--name-only',ref(side),'--',...(path===undefined?[]:[literalPath(path)+'/'])]).split('\0').filter(Boolean),
    search(side:unknown,query:unknown,path?:unknown){
      if(typeof query!=='string'||!query||Buffer.byteLength(query)>256||/[\x00\r\n]/.test(query))throw Error('Invalid literal search');
      return run(['grep','--no-textconv','-z','-l','-I','-F','-e',query,ref(side),'--',...scope(path)],true).split('\0').filter(Boolean);
    },
    read(side:unknown,path:unknown){
      const sha=ref(side),p=literalPath(path);
      const entry=/^100(?:644|755) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(run(['ls-tree','-z',sha,'--',p]));
      if(!entry||entry[2]!==p)throw Error('Not an exact regular checkout file');
      const size=Number(run(['cat-file','-s',entry[1]]));
      if(!Number.isSafeInteger(size)||size<0||size>BATCH_CONTEXT_LIMIT)throw Error('Review file exceeds output limit');
      const text=run(['cat-file','blob',entry[1]]);
      if(text.includes('\0'))throw Error('Not a text checkout file');
      return {path:p,oid:entry[1],content:text};
    },
    diff(path?:unknown){
      const paths=scope(path);
      return run(['diff-tree','--no-commit-id','-r','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=none',
        ...(paths.length?['-p','--text','--no-color']:['--raw','--no-abbrev']),base,candidate,'--',...paths]);
    },
  };
}
// One staged test-role request. Only exact regular blobs in this commit; no pathspecs, traversal, links or working-tree reads.
export function requestedContext(repo:string, candidate:string, paths:unknown, deadline:number) {
  if(!Array.isArray(paths) || paths.length<1 || paths.length>4 || new Set(paths).size!==paths.length) throw Error('Invalid context request');
  const git=(args:string[])=>{
    const left=Math.floor(deadline-performance.now()); if(left<1)throw Error('Context deadline');
    return candidateGit(repo,args,undefined,undefined,left);
  };
  let remaining=65536;
  return paths.map(path=>{
    if(typeof path!=='string'||Buffer.byteLength(path)>512||/[\x00-\x1f\\]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git'))throw Error('Invalid context path');
    const entry=decode(git(['--literal-pathspecs','ls-tree','-z',candidate,'--',path]));
    const m=/^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(entry);
    if(!m||m[3]!==path)throw Error('Missing context blob');
    const size=Number(git(['cat-file','-s',m[2]]).toString());
    if(!Number.isSafeInteger(size)||size<0||(remaining-=size)<0)throw Error('Context too large');
    const bytes=git(['cat-file','blob',m[2]]); if(bytes.length!==size||bytes.includes(0))throw Error('Unrepresentable context');
    return {path,oid:m[2],content:decode(bytes)};
  });
}
function boundedReader(repo:string){
  let remaining=1024*1024;
  function blob(oid:string) {
    const size=Number(candidateGit(repo,['cat-file','-s',oid]).toString().trim());
    if (!Number.isSafeInteger(size) || size<0 || (remaining-=size)<0) throw Error('Review input exceeds limit');
    const bytes=candidateGit(repo,['cat-file','blob',oid]);
    if (bytes.length!==size || bytes.includes(0)) throw Error('Unrepresentable review blob');
    return decode(bytes);
  }
  return blob;
}
export function validateReviewInputs(repo:string,head:string,sha:string,testPaths:string[]){
  // Check test selection exists; do not preload its contents (even privately).
  const tests=candidateGit(repo,['--literal-pathspecs','ls-tree','-rz',sha,'--',...testPaths]);
  if(tests.length>1024*1024)throw Error('Test inventory exceeds limit');
  const entries=decode(tests).split('\0');
  if(entries.pop()!==''||entries.length>2048)throw Error('Incomplete or oversized test inventory');
  const regular=entries.map(line=>{
    const entry=/^100(?:644|755) blob [0-9a-f]{40}\t(.+)$/s.exec(line);
    if(!entry)throw Error('Not a regular configured test source');
    return entry[1];
  });
  if(!testPaths.every(p=>regular.some(path=>path===p||path.startsWith(p+'/'))))throw Error('Configured test source missing');
  // Keep the existing bounded delta validation; none of these bytes go into a model prompt.
  const blob=boundedReader(repo);
  if(!changedPaths(repo,head,sha,undefined,blob).length)throw Error('Empty change inventory');
}
function changedPaths(repo:string,head:string,sha:string,objects?:string,blob?:(oid:string)=>string){
  const fields=decode(candidateGit(repo,['diff-tree','--no-commit-id','-r','--raw','--no-abbrev','--no-renames','--no-ext-diff','--no-textconv','--ignore-submodules=none','-z',head,sha,'--'],undefined,objects)).split('\0');
  if(fields.pop()!=='' || fields.length%2 || fields.length>4096)throw Error('Incomplete or oversized change inventory');
  const paths:string[]=[];
  for(let i=0;i<fields.length;i+=2){
    const m=/^:(000000|100644|100755|120000) (000000|100644|100755|120000) ([a-f0-9]{40}) ([a-f0-9]{40}) [ADMT]$/.exec(fields[i]);
    if(!m||!fields[i+1])throw Error('Unsupported Git change');
    if(blob){if(m[1]!=='000000')blob(m[3]);if(m[2]!=='000000')blob(m[4]);}
    paths.push(fields[i+1]);
  }
  return paths;
}
