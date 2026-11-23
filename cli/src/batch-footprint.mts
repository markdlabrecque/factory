// Derive a reservation from two exact local Git commits. No checkout, fetch, project diff driver or worker-provided path list.
import { execFileSync } from 'node:child_process';

export function approvedFootprint(root:string, head:unknown, candidate:unknown):string[] {
  const sha = (value:unknown):value is string => typeof value==='string' && /^[a-f0-9]{40}$/.test(value);
  if(!sha(head) || !sha(candidate)) return ['*'];
  const git = (...args:string[]) => execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null',...args],{
    cwd:root,stdio:['ignore','pipe','pipe'],maxBuffer:256*1024,timeout:5000,killSignal:'SIGKILL',
    env:{PATH:process.env.PATH,LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0'},
  });
  try {
    if(git('cat-file','-t',candidate).toString().trim()!=='commit') return ['*'];
    const headers=git('cat-file','commit',candidate).toString('latin1').split('\n\n',1)[0].split('\n');
    const parents=headers.filter(s=>s.startsWith('parent '));
    if(parents.length!==1 || parents[0]!==`parent ${head}`) return ['*'];
    const bytes=git('diff-tree','-r','--no-commit-id','--no-renames','--no-ext-diff','--no-textconv','--ignore-submodules=none','--name-only','-z',head,candidate,'--');
    const paths=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).split('\0');
    if(paths.pop()!=='' || !paths.length || paths.length>4096 || paths.some(p=>p.split('/').some(s=>!s || s==='.' || s==='..') || p.trim()!==p || /[\x00-\x1f\x7f\\*]/.test(p))) return ['*'];
    return paths;
  } catch { return ['*']; }
}
