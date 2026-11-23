// Isolated candidate-test transport and two tool-less, sessionless Pi review transports. No project mounts, tracker tools or delivery callbacks.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { piAnalysisArgs } from './models.mts';

export type ProcessResult = { exit: number | null; stdout: string; stderr: string };
export type ReviewRole = 'test' | 'code';
export interface BatchSandbox {
  test(sha: string, pack: Buffer, argv: string[]): Promise<ProcessResult>;
  review(role: ReviewRole, invocation: string, prompt: string): Promise<ProcessResult>;
}
// The trusted shell sees only host argv and a shallow pack. Checkout/setup failure cannot be reported as a green test.
export const CHECKOUT_AND_TEST = `set -eu
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
umask 077
work=$(mktemp -d); cd "$work"
git init -q --template= .
printf '%s\\n' "$1" >.git/shallow
git unpack-objects -q
git -c advice.detachedHead=false checkout -q --detach "$1"
test "$(git rev-parse HEAD)" = "$1"
shift
exec "$@"`;
function run(cmd: string, args: string[], input: Buffer | string, cwd: string, env?: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise(resolve => {
    const child = execFile(cmd, args, {cwd, env, encoding:'utf8', maxBuffer:1024*1024, timeout:15*60_000, killSignal:'SIGKILL'}, (err,out,log) => {
      resolve({exit: err ? typeof err.code === 'number' ? err.code : null : 0, stdout:out, stderr:log});
    });
    child.stdin!.on('error', () => {}); child.stdin!.end(input);
  });
}
export function standardBatchSandbox(imageId: string, reviewModel: string, reviewerCredential: () => string): BatchSandbox {
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('Candidate tests require a pinned local image ID');
  return {
    test: (sha, pack, argv) => run('docker',['run','--rm','--pull=never','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--read-only','--tmpfs','/tmp:rw,exec,nosuid,size=1g','--pids-limit=256','--memory=2g','--user=65534:65534','-e','HOME=/tmp',
      '-i','--entrypoint','timeout',imageId,'--signal=KILL','840s','sh','-c',CHECKOUT_AND_TEST,'sh',sha,...argv],pack,'/'),
    async review(_role, _id, prompt) {
      const cwd = mkdtempSync(join(tmpdir(),'factory-role-'));
      try {
        const args = piAnalysisArgs(reviewModel, process.env, existsSync);
        args.splice(args.indexOf('--tools'),2,'--no-tools');
        const credential = reviewerCredential();
        if (!credential) throw Error('Reviewer provider credential unavailable');
        const key = reviewModel.startsWith('openai/') ? 'OPENAI_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN';
        return await run('pi',args,prompt,cwd,{PATH:process.env.PATH, HOME:cwd, TMPDIR:cwd, PI_CODING_AGENT_DIR:cwd, [key]:credential});
      } finally { rmSync(cwd,{recursive:true,force:true}); }
    },
  };
}
