// Construct a prospective single-parent integration commit and export its exact Git objects, never a worktree or ref update.
import { execFileSync } from 'node:child_process';
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
// Import only an isolated implementer's patch, never its .git/config, hooks, refs or repository path.
export function importImplementation(repo:string, start:string, delta:{tip:string;commit:string;patch:string}) {
  const {tip,commit,patch}=delta;
  const headers=/^tree ([0-9a-f]{40})\nparent ([0-9a-f]{40})\nauthor [^\n]+\ncommitter [^\n]+\n\n/.exec(commit);
  if (!headers || headers[2]!==start || !/^[0-9a-f]{40}$/.test(tip) || !patch || Buffer.byteLength(patch)>1024*1024) throw Error('Expected one ordinary implementation commit on the exact start');
  const tree=headers[1];
  const objects=candidateGit(repo,['rev-parse','--path-format=absolute','--git-path','objects']).toString().trim();
  const bare=mkdtempSync(join(tmpdir(),'factory-delta-'));
  try {
    candidateGit(bare,['init','--bare','--template=','-q','.']);
    const git=(args:string[],input?:string)=>candidateGit(bare,args,input,objects).toString().trim();
    git(['read-tree',start]); git(['apply','--cached','--binary','--whitespace=nowarn','-'],patch);
    if (git(['write-tree'])!==tree || tree===git(['rev-parse',`${start}^{tree}`])) throw Error('Incomplete or empty implementation delta');
    if(git(['hash-object','-t','commit','-w','--stdin'],commit)!==tip) throw Error('Implementation commit identity mismatch');
    return tip;
  } finally {rmSync(bare,{recursive:true,force:true})}
}
const decode = (bytes:Buffer) => new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes);
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
export function reviewMaterial(repo: string, head: string, sha: string, testPaths: string[]) {
  let remaining=1024*1024;
  function blob(oid:string) {
    const size=Number(candidateGit(repo,['cat-file','-s',oid]).toString().trim());
    if (!Number.isSafeInteger(size) || size<0 || (remaining-=size)<0) throw Error('Review input exceeds limit');
    const bytes=candidateGit(repo,['cat-file','blob',oid]);
    if (bytes.length!==size || bytes.includes(0)) throw Error('Unrepresentable review blob');
    return decode(bytes);
  }
  const inventory=candidateGit(repo,['ls-tree','-rz',sha,'--',...testPaths]);
  if(inventory.length>1024*1024) throw Error('Test inventory exceeds limit');
  const listing = decode(inventory).split('\0').filter(Boolean);
  if(listing.length>2048) throw Error('Too many test files');
  const tests = listing.map(entry => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry);
    if (!match) throw Error('Unreadable test entry');
    return {path: match[3], content:blob(match[2])};
  });
  if(!testPaths.every(p=>tests.some(t=>t.path===p || t.path.startsWith(p+'/')))) throw Error('Configured test source missing');
  // Raw object changes do not consult working-tree attributes, textconv or external diff drivers.
  const fields=decode(candidateGit(repo,['diff-tree','--no-commit-id','-r','--raw','--no-abbrev','--no-renames','--ignore-submodules=none','-z',head,sha,'--'])).split('\0');
  if (fields.pop()!=='' || !fields.length || fields.length%2 || fields.length>4096) throw Error('Incomplete or oversized change inventory');
  const diff=[];
  for(let i=0;i<fields.length;i+=2){
    const m=/^:(000000|100644|100755|120000) (000000|100644|100755|120000) ([a-f0-9]{40}) ([a-f0-9]{40}) [ADMT]$/.exec(fields[i]);
    if(!m || !fields[i+1]) throw Error('Unsupported Git change');
    const side=(mode:string,oid:string)=>mode==='000000'?null:{mode,oid,content:blob(oid)};
    diff.push({path:fields[i+1],before:side(m[1],m[3]),after:side(m[2],m[4])});
  }
  return {tests,diff};
}
