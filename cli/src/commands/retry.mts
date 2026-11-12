// `factory retry <ticket> [--project <name>]`: clear a failed run so the next dispatcher pass picks the ticket up
// again. Deletes the run's record in Factory's run-state folder (the same as deleting the JSON file by hand), only
// when the run is stopped: failed, or its process exited without finishing. A done, live, queued or waiting run is
// refused, and so is a ticket with no record. It never deletes branches, logs or evidence: if a `<ticket>-*` branch
// is left (locally or on origin, as last fetched), it says so, because the dispatcher skips a ticket that has one.
// Since #75 it also refuses a card an admission claim protects (board/admission.mts): any recovery claim (released only
// once its attempt's container is confirmed gone), a launch claim whose owner may still run, or an admission record it
// cannot read (unknown). It keeps the ticket's ownership receipt (<state>/ownership/), so a later repair still knows
// which branch and worktree Factory created.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { keyFor, ownerState, readAdmission } from '../../../board/admission.mts';
import type { Paths } from '../paths.mts';
import { findRun, resolveProject, runStateDir, ticketId } from '../runs.mts';
export type RetryOptions = { project?: string; cwd?: string };

/** Local and origin branches named `<iid>-*`, as the dispatcher looks for them. */
function ticketBranches(root: string, iid: string): string[] {
  let refs = '';
  try { refs = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'], { cwd: root, encoding: 'utf8' }); } catch { return []; }
  return refs.split('\n').filter(b => b.replace(/^origin\//, '').startsWith(`${iid}-`));
}

export async function retry(p: Paths, ticket: string | undefined, o: RetryOptions = {}): Promise<void> {
  const iid = ticketId(ticket);
  const ctx = resolveProject(p, { project: o.project, cwd: o.cwd });
  const { file, run } = findRun(p, ctx, iid);
  if (!run) throw new Error(`No run record for #${iid} in ${ctx.name} (${file}); the next pass can already pick it up.`);
  if (run.stage !== 'stopped') {
    const why = run.stage === 'done' ? 'finished' : run.stage === 'queued' || run.stage === 'waiting' ? `${run.stage}; the dispatcher re-checks it every pass` : `still running (stage ${run.stage}, pid ${run.pid})`;
    throw new Error(`#${iid} in ${ctx.name} is ${why}. Only a stopped run can be retried.`);
  }
  let claims;
  try { claims = readAdmission(runStateDir(p)).claims; }
  catch (e) { throw new Error(`#${iid} in ${ctx.name} may be claimed, and the claim is unknown: ${(e as Error).message}`); }
  const claim = claims[keyFor(iid, ctx.tracker)];
  if (claim && (claim.kind === 'recovery' || ownerState(claim.owner) !== 'dead')) {
    throw new Error(claim.kind === 'recovery'
      ? `#${iid} in ${ctx.name} is held by recovery attempt ${claim.attempt} until its container is confirmed gone; not cleared.`
      : `#${iid} in ${ctx.name} is claimed by process ${claim.owner.pid}, which may still be running; not cleared.`);
  }
  rmSync(file, { force: true });
  console.log(`Cleared #${iid} in ${ctx.name}${run.note ? ` (was stopped: ${run.note})` : ''}. The next pass picks it up.`);
  const branches = ticketBranches(ctx.root, iid);
  if (branches.length) {
    console.log(`But the dispatcher skips a ticket that has a branch, and #${iid} has: ${branches.join(', ')}. `
      + `Delete it once you no longer need its work (git branch -D <branch>; git push origin --delete <branch>).`);
  }
}
