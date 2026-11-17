// Local IPC-only contender: explicit ready/go/result/exit barriers, no provider, tracker or timing assumptions.
import { claimSupervisorHold } from '../src/supervisor-admission.mts';
process.send!({ ready: true });
process.on('message', (message: any) => {
  if (message.exit) { process.disconnect(); return; }
  try { process.send!({ hold: claimSupervisorHold(message.dir, message.options) }); }
  catch (error) { process.send!({ error: String(error) }); }
});
