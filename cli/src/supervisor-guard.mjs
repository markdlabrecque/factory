// Minimal owned session anchor: no filesystem/provider work. Only this live anchor signals its own group.
import { spawn } from 'node:child_process';
const [runner, deadlineText, limitText] = process.argv.slice(2);
const deadline = Number(deadlineText), limit = Number(limitText);
if (!process.send || !Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline - Date.now() > 600_000
  || !Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000_000) process.exit(1);
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  // The detached guard is the session/group anchor and has never exited or handed its PID to a kill caller.
  try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); }
};
// Arm before spawning/importing/waiting for controller or SDK work. Controller loss never disables this deadline.
setTimeout(stop, Math.max(1, deadline - Date.now()));
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('uncaughtException', stop);
process.on('unhandledRejection', stop);
process.stdout.on('error', stop);
process.stderr.on('error', stop);
const worker = spawn(process.execPath, [runner], { cwd: process.cwd(), env: {
  PATH: '/usr/bin:/bin', HOME: process.cwd(), LANG: 'C',
}, stdio: ['ignore','pipe','pipe','ipc'] });
let output = 0, errors = 0, handed = false, ready = false, closed = false, pending = 0, observing = false, observed = false;
const drained = () => { if (closed && pending === 0) stop(); };
const forward = (stream, bytes) => { pending++; stream.write(bytes, () => { pending--; drained(); }); };
worker.stdout.on('data', b => { output += b.length; if (output > limit) stop(); else forward(process.stdout,b); });
worker.stderr.on('data', b => { errors += b.length; if (errors > 8192) stop(); else forward(process.stderr,b); });
worker.on('error', stop);
// Normal completion drains bounded output before killing the anchor/remaining group. Descendant-held pipes
// cannot disable the already-armed deadline; disconnect/terminate/overflow still stop immediately.
worker.on('close', () => { closed = true; drained(); });
worker.on('message', m => {
  if (!ready && m?.kind === 'ready' && Object.keys(m).length === 1) {
    ready = true; process.send?.({ kind: 'ready', worker: worker.pid });
  } else if (handed && !observing && !observed && m?.kind === 'observe' && Object.keys(m).length === 1) {
    observing = true; process.send?.({ kind: 'observe' });
  } else if (m?.kind === 'complete' && Object.keys(m).length === 1) {
    process.send?.({ kind: 'complete' });
  } else stop();
});
process.on('message', m => {
  if (m?.kind === 'terminate' && Object.keys(m).length === 1) return stop();
  if (m?.kind === 'observation') {
    if (!observing || observed || Object.keys(m).length !== 2 || Buffer.byteLength(JSON.stringify(m)) > 4_000_000) return stop();
    observed = true; worker.send(m, e => { if (e) stop(); }); return;
  }
  if (!ready || handed || m?.kind !== 'handoff' || Buffer.byteLength(JSON.stringify(m)) > 4_000_000) return stop();
  handed = true;
  worker.send(m, e => { if (e) stop(); });
});
