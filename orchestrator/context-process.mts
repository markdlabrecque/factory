// Hold the shell bootstrap's runtime lease across preflight, foreground execution and cleanup.
import { spawn } from 'node:child_process';
import { executionContext, retainRuntime } from './context.mts';
const context = await executionContext();
const lease = await retainRuntime(context);
const child = spawn('bash', [context.codePath('dispatch.sh'), ...process.argv.slice(2)], {
  cwd: context.projectRoot, env: { ...process.env, ...context.env, FACTORY_CONTEXT_BOOTSTRAPPED: '1' }, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { child.kill(signal); });
child.once('error', error => { console.error(error.message); lease.release(); process.exitCode = 1; });
child.once('exit', (code, signal) => { lease.release(); process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143); });
