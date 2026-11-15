// Read-only selection intent uses validated workflow identity and Factory-owned native tracker reads.
// Never imports project executables/main/dispatch, creates labels, analyzes, or writes state.
// Native-filter membership must be complete; uncertain reads produce unknown rather than false reasons.
import { resolveWorkflow } from '../../../orchestrator/workflow.mts';
import { nativeGithub } from '../../../orchestrator/selection-tracker.github.mts';
import { nativeGitlab } from '../../../orchestrator/selection-tracker.gitlab.mts';
import type { Paths } from '../paths.mts';
import { findRun, resolveProject, runStateDir, ticketId } from '../runs.mts';
import { excludedAssignees, membershipEligibility, unitEligibility } from '../../../orchestrator/selection.mts';
import type { Eligibility } from '../../../orchestrator/selection.mts';
import { readAssessment } from '../../../board/assessment.mts';
import { keyFor } from '../../../board/board.mts';

export async function selectionExplain(p: Paths, action: string | undefined, ticket: string | undefined, o: { project?: string; json?: boolean } = {}): Promise<number> {
  if (action !== 'explain' || !ticket) throw new Error('Usage: factory selection explain <ticket> [--project <name|path>] [--json]');
  const iid = Number(ticketId(ticket));
  if (!Number.isSafeInteger(iid) || iid <= 0) throw new Error('Expected a positive ticket number');
  const ctx = resolveProject(p, o);
  const selected = resolveWorkflow(ctx.root, p.runtimeDescriptor);
  const c = selected.config, source = c.source;
  const workflow = { mode: selected.mode, root: selected.root, identity: selected.id,
    dependencies: selected.manifest.dependencies, behavior: selected.mode === 'project' ? 'opaque' : 'factory',
    actualSelection: selected.mode === 'project' ? 'unknown' : 'factory-native' };
  let eligibility: Eligibility = { status: 'unknown', reasons: [] };
  let inheritedFrom: number | undefined;
  try {
    const tracker = c.TRACKER.kind === 'github' ? nativeGithub(c) : nativeGitlab(c);
    const t = tracker.ticket(iid);
    const ready = tracker.readyList(c.selection);
    const excluded = excludedAssignees(c.selection, tracker.currentUsername);
    eligibility = membershipEligibility(iid, ready, excluded);
    if (c.SUBTASKS.enabled) {
      const parent = tracker.parentOf(iid);
      if (parent !== undefined) {
        const parentResult = membershipEligibility(parent, ready, excluded);
        if (parentResult.status === 'selected') { eligibility = parentResult; inheritedFrom = parent; }
      }
    }
    if (eligibility.status === 'selected' && inheritedFrom) {
      eligibility.reasons.push({ code: 'inherited-parent', message: `Eligibility inherited from selected parent #${inheritedFrom}; child labels are not required.` });
      if (!['open','opened'].includes((t.state ?? '').toLowerCase())) eligibility = { status: 'not-selected', reasons: [{ code: 'closed-child', message: 'Child is closed; only open children become work units.' }] };
    } else if (eligibility.status === 'selected' && c.SUBTASKS.enabled) {
      const kids = tracker.children([iid]).get(iid);
      if (kids?.length) eligibility = { status: 'not-selected', reasons: [{ code: kids.some(k => k.open) ? 'parent-container' : 'all-children-closed', message: kids.some(k => k.open) ? 'Selected parent is a container; open children are the work units.' : 'Selected parent has all children closed; dispatch would advance it, not start a run.' }] };
    }
    if (eligibility.status === 'selected') {
      const veto = unitEligibility(t, true, c.LABELS.exclude);
      if (veto.status !== 'selected') eligibility = veto;
    }
    // These facts came from an independent ticket lookup, not inferred from a partial list.
    if (!inheritedFrom && eligibility.status === 'not-selected') {
      if (t.labels) {
        const missing = c.LABELS.ready.filter(l => !t.labels!.includes(l));
        const veto = c.LABELS.exclude.filter(l => t.labels!.includes(l));
        if (missing.length) eligibility.reasons.push({ code: 'missing-labels', message: `Missing required labels: ${missing.join(', ')}` });
        if (veto.length) eligibility.reasons.push({ code: 'excluded-labels', message: `Excluded labels: ${veto.join(', ')}` });
      }
      if (c.TRACKER.milestone && t.milestone !== undefined && t.milestone?.title !== c.TRACKER.milestone) eligibility.reasons.push({ code: 'milestone', message: 'Ticket is outside the configured milestone.' });
      if (c.selection.issueType && t.issue_type !== undefined && t.issue_type !== c.selection.issueType) eligibility.reasons.push({ code: 'issue-type', message: 'Ticket type does not match selection.issue_type.' });
      if (c.selection.confidential !== undefined && t.confidential !== undefined && t.confidential !== c.selection.confidential) eligibility.reasons.push({ code: 'confidentiality', message: 'Ticket confidentiality does not match selection.confidential.' });
      const username = (a: string) => a === '@me' ? tracker.currentUsername() : a;
      if (c.selection.author && t.author && t.author.username !== username(c.selection.author)) eligibility.reasons.push({ code: 'author', message: 'Author does not match selection.author.' });
      if (c.selection.assignee && t.assignees && !t.assignees.some(a => a.username === username(c.selection.assignee!))) eligibility.reasons.push({ code: 'assignee', message: 'No assignee matches selection.assignee.' });
      if (t.state && !['open','opened'].includes(t.state.toLowerCase())) eligibility.reasons.push({ code: 'closed', message: 'Ticket is not open.' });
    }
  } catch (e) { eligibility = { status: 'unknown', reasons: [{ code: 'retrieval-failed', message: (e as Error).message }] }; }
  const run = findRun(p, ctx, String(iid)).run;
  const assessment = readAssessment(runStateDir(p), keyFor(String(iid), ctx.tracker));
  // Persisted holds are historical observations, never a promise that execution can start now.
  const executionHolds = { status: 'unknown', message: 'Read-only snapshot; current capacity, conflicts, admission and prerequisite holds are not reevaluated. Missing or stale information is unknown.',
    recordedRun: run ? { stage: run.stage, note: run.note, startedAt: run.startedAt } : null,
    recordedAssessment: assessment ? { checkedAt: assessment.facts?.checkedAt, analysisState: assessment.analysisState, dependencies: assessment.dependencies, retryRequired: assessment.retryRequired, error: assessment.error } : null };
  const settings = { selection: { ...c.selection, milestone: c.TRACKER.milestone, labels: { all: c.LABELS.ready, none: c.LABELS.exclude } },
    work: { units: c.SUBTASKS.enabled ? 'subtasks' : 'issues' }, dispatch: c.dispatch, sources: c.sources, warnings: c.warnings };
  const result = { source, workflow, settings, eligibilityScope: 'configured-selection-intent', eligibility: eligibility.status, reasons: eligibility.reasons, inheritedFrom: inheritedFrom ?? null, executionHolds };
  if (o.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Configuration: ${source.mode} (${source.path})`);
    console.log(`Workflow: ${JSON.stringify(workflow)}`);
    if (workflow.behavior === 'opaque') console.log('Eligibility describes configured selection intent; actual project workflow selection is unknown.');
    if (settings) console.log(`Effective settings (with explicit/default sources):\n${JSON.stringify(settings, null, 2)}`);
    console.log(`Eligibility: ${result.eligibility}\n${result.reasons.map(r => `  ${r.code}: ${r.message}`).join('\n')}`);
    console.log(`Execution holds (separate): ${JSON.stringify(executionHolds, null, 2)}`);
  }
  return eligibility.status === 'unknown' ? 1 : 0;
}
