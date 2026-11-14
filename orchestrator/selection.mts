// #137: shared, read-only candidate selection. Native filters are evaluated by the tracker using an
// exhaustive ready list; incomplete/failed retrieval is unknown, never evidence of deselection.
import type { Ticket, ReadyTicket, Select } from './tracker.mts';
export type Reason = { code: string; message: string };
export type Eligibility = { status: 'selected' | 'not-selected' | 'unknown'; reasons: Reason[] };
export function excludedAssignees(select?: Select & { excludeAssignees?: string[] }, currentUser?: () => string): string[] {
  return (select?.excludeAssignees ?? []).map(a => {
    if (a !== '@me') return a;
    if (!currentUser) throw new Error('Cannot resolve excluded assignee @me; selection is unknown');
    const username = currentUser();
    if (typeof username !== 'string' || !username.trim()) throw new Error('Tracker did not return the current username; selection is unknown');
    return username;
  });
}
export function assigneeReasons(ticket: ReadyTicket, excluded: string[]): Reason[] {
  if (excluded.length && !Array.isArray(ticket.assignees)) throw new Error('Assignee facts missing; selection is unknown');
  return ticket.assignees?.some(a => excluded.includes(a.username))
    ? [{ code: 'excluded-assignee', message: 'Assigned to an excluded assignee.' }] : [];
}
export function selectCandidates(ready: ReadyTicket[], select?: Select & { excludeAssignees?: string[] }, currentUser?: () => string): ReadyTicket[] {
  const excluded = excludedAssignees(select, currentUser);
  return ready.filter(t => !assigneeReasons(t, excluded).length);
}
/** Shared unit vetoes also apply to children: readiness is inherited, excluded labels are not. */
export function unitEligibility(ticket: Ticket, selected: boolean, excludedLabels: string[]): Eligibility {
  const reasons: Reason[] = [];
  if (ticket.state?.toLowerCase() === 'closed') reasons.push({ code: 'closed', message: 'Closed in tracker' });
  if (ticket.labels?.some(l => excludedLabels.includes(l))) reasons.push({ code: 'excluded-labels', message: 'Excluded by tracker label' });
  if (!selected) reasons.push({ code: 'tracker-filters', message: 'Not selected by current dispatch filters' });
  return { status: reasons.length ? 'not-selected' : 'selected', reasons };
}
/** Complete membership is sufficient for native filters, but never invent individual mismatch facts. */
export function membershipEligibility(iid: number, ready: ReadyTicket[], excluded: string[]): Eligibility {
  const found = ready.find(t => t.iid === iid);
  if (!found) return { status: 'not-selected', reasons: [{ code: 'tracker-filters', message: 'Not in the complete tracker selection (open state and configured AND filters). Individual native-filter mismatches are not known.' }] };
  const reasons = assigneeReasons(found, excluded);
  return reasons.length ? { status: 'not-selected', reasons } : { status: 'selected', reasons: [{ code: 'tracker-match', message: 'Matches all tracker filters and has no excluded assignee.' }] };
}
