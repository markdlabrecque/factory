// Local IPC-only contender: explicit ready/go/result/exit barriers, no provider, tracker or timing assumptions.
import { claimSupervisorHold } from '../src/supervisor-admission.mts';
import { claimManagedEntry } from '../../board/admission.mts';
import { adoptClaim, claimRun, setProject } from '../../board/board.mts';
process.send!({ ready: true });
process.on('message', (message: any) => {
  if (message.exit) { process.disconnect(); return; }
  try {
    const { dir, options, mode = 'diagnosis' } = message;
    const project = options.project.tracker.project;
    process.env.FACTORY_PROJECT_ROOT = options.project.root;
    delete process.env.FACTORY_LAUNCH_CLAIM;
    setProject(project);
    if (mode === 'diagnosis') process.send!({ hold: claimSupervisorHold(dir, options) });
    else if (mode === 'manual') process.send!({ token: adoptClaim('8', dir, 4) });
    // Dispatch, recovery launch and dispatch's delivery continuation share this pre-effect boundary.
    // Actual repair/delivery admission additionally needs a saved run, which deliberately makes
    // diagnosis quiescence unavailable; their held-store refusals are tested separately.
    else if (['dispatch', 'recovery', 'delivery'].includes(mode)) process.send!({ entry: claimManagedEntry(dir, options.project) });
    else {
      const input = { dir, iid: '8', project, pid: process.pid, cap: 4 };
      const result = claimRun(input);
      process.send!(result.ok ? { token: result.run.claim } : { error: result.reason });
    }
  } catch (error) { process.send!({ error: String(error) }); }
});
