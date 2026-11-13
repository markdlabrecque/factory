// Validated ticket archive mutations shared by the CLI and HTTP board. Re-read raw records under the admission
// lock, refuse anything outside the board's Shipped/history group (done), and refuse live claims including recovery.
// Journal writes take their own per-ticket lock inside admission, so a new launch cannot race archive validation.
// Nothing changes run records, evidence, tracker issues or dispatcher eligibility. Restore is safe at any stage.
// Return the archived execution identity so delayed HTTP responses cannot remove a newer polled execution.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimLive, keyFor, withAdmission } from './admission.mts';
import { setArchived, runIdentity } from './journal.mts';
import type { Ticket } from './journal.mts';
import type { RunState } from './board.mts';

export function archiveTicket(dir: string, ticket: Ticket, archived: boolean, actor: string): ReturnType<typeof setArchived> & { run: string } {
  if (!ticket.project?.trim() || !/^\d+$/.test(ticket.iid)) throw new Error('Expected a tracker project and ticket number.');
  return withAdmission(dir, tx => {
    const key = keyFor(ticket.iid, ticket.project);
    let run: RunState;
    try { run = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')); }
    catch { throw new Error(`No readable run for ${ticket.project}#${ticket.iid}.`); }
    if (run.project !== ticket.project || run.iid !== ticket.iid || !run.startedAt) throw new Error('Run identity does not match the ticket.');
    const claim = tx.state.claims[key];
    if (archived && (run.stage !== 'done' || (claim && claimLive(claim)))) {
      throw new Error(`Cannot archive #${ticket.iid}: only completed history tickets without active work can be archived (stage ${run.stage}).`);
    }
    return { ...setArchived(dir, ticket, run, archived, { actor }), run: runIdentity(run) };
  });
}
