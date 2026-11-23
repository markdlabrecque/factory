// Construct a prospective single-parent integration commit and export its exact Git objects, never a worktree or ref update.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = 64 * 1024 * 1024;
function candidateGit(repo: string, args: string[], input?: string, objects?: string) {
  return execFileSync('git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd: repo, input, maxBuffer: LIMIT, timeout: 60_000, stdio: ['pipe','pipe','pipe'],
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
export function reviewMaterial(repo: string, head: string, sha: string, testPaths: string[]) {
  const listing = candidateGit(repo,['ls-tree','-rz',sha,'--',...testPaths]).toString().split('\0').filter(Boolean);
  let size = 0;
  const tests = listing.map(entry => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry);
    if (!match) throw Error('Unreadable test entry');
    const bytes = candidateGit(repo,['cat-file','blob',match[2]]);
    if ((size += bytes.length) > 1024 * 1024) throw Error('Test review input exceeds limit');
    return {path: match[3], content: new TextDecoder('utf8',{fatal:true}).decode(bytes)};
  });
  const diff = candidateGit(repo,['diff','--no-ext-diff','--no-textconv','--no-color',head,sha,'--']);
  if (diff.length > 1024 * 1024) throw Error('Code review input exceeds limit');
  return {tests, diff: diff.toString()};
}
