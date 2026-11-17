// Hold runtime and managed-admission ownership across shell preflight, execution and cleanup; orphan entries hold.
import { spawn } from 'node:child_process';
import { executionContext, retainRuntime } from './context.mts';
import { claimManagedEntry, releaseManagedEntry } from './admission.mts';
import { resolve } from 'node:path';
const context = await executionContext();
const tracker = context.config.TRACKER;
const dir = process.env.SANDCASTLE_STATE_DIR ?? resolve(process.env.HOME!, '.local/state/factory');
const entry = claimManagedEntry(dir, { root: context.projectRoot, tracker: { kind: tracker.kind, host: tracker.gitlabHost ?? tracker.host!, project: tracker.project } });
const lease = await retainRuntime(context);
const child = spawn('bash', [context.codePath('dispatch.sh'), ...process.argv.slice(2)], {
  cwd: context.projectRoot, env: { ...process.env, ...context.env, FACTORY_CONTEXT_BOOTSTRAPPED: '1' }, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { child.kill(signal); });
child.once('error', error => { console.error(error.message); lease.release(); if (!child.pid) releaseManagedEntry(dir, entry); process.exitCode = 1; });
child.once('exit', (code, signal) => { releaseManagedEntry(dir, entry); lease.release(); process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143); });
