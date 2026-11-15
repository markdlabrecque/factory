// Read-only refresh uses explicit project settings and runtime/template policy identity in assessment freshness.
// Read-only current assessment adapter (#78). Description models use the shared resolver (#126). Shared by scheduled dispatch and --refresh-only (one card with --ticket,
// else every card of the project, #93), which exits before
// tracker writes, run updates, admission or launches. Analysis results go only to assessments; execution manifests
// remain untouched. Assessment uses a separate read-only worktree so a manual check cannot reset the execution
// analyst's checkout. Allocate assessment attempts before any tracker reads, including catalogue failures, so older
// scheduled/manual passes cannot publish over newer facts. The board worker passes its token to its child; neither
// path takes admission locks. The caller gives the remaining per-pass budget; analyze.mts enforces its own timeout.
// #149: assessment uses the same fail-closed dependency evaluator as execution.
import { freezeTicketInput, TicketInputHold, type FrozenTicketInput } from './ticket-input.mts';
import { dependencyState, type DependencyResult } from "./dependencies.mts";
import { recordTicketInput } from './launch-readiness.mts';
import type { ReadinessReport } from './readiness-schema.mts';
import { analyse, analysisWorktree } from "./analyze.mts";
import { readRuns, stateDir } from "./board.mts";
import { assessed, beginAssessment, pickRefreshes, publishAssessment, readAssessment, readAssessments, refreshCards, writeAssessment, pendingRequests, clearRequest } from "./assessment.mts";
import { selectCandidates, unitEligibility } from "./selection.mts";
import { context, effectiveConfig, AGENT, GRAPH, LABELS, SUBTASKS, TRACKER } from "./runtime-config.mts";
import { contentHash, expandUnits } from "./graph.mts";
import { readManifests } from "./manifests.mts";
import { resolveTicketModel } from "./models.mts";
import * as tracker from "./tracker.mts";
import type { Select, Ticket } from "./tracker.mts";

export function refreshProject(o: { base: string; ticket?: string; budget?: number; subtasks?: boolean; select?: Select & { excludeAssignees?: string[] };
  log?: (m: string) => void; readiness?: ReadinessReport }): void {
  const log = o.log ?? console.log, dir = stateDir();
  const allRuns = readRuns(dir, false);
  const runs = allRuns.filter((r) => r.project === TRACKER.project && (!o.ticket || r.iid === o.ticket));
  if (!runs.length) return;
  const asked = pendingRequests(dir), attempts = new Map<string, string>();
  try {
    const keys = pickRefreshes(runs.map((r) => r.key), asked, readAssessments(dir));
    for (const key of keys) {
      try {
        attempts.set(key, beginAssessment(dir, key, process.env.FACTORY_REFRESH_KEY === key ? process.env.FACTORY_REFRESH_ATTEMPT : undefined));
      } catch (e) { log(`assessment store: ${(e as Error).message}`); }
    }
    if (!attempts.size) return;
    const work = tracker.workCatalogue(o.subtasks ?? SUBTASKS.enabled);
    const catalogue = work.tickets;
    const manifests = readManifests(TRACKER.project);
    const select = effectiveConfig?.selection ?? o.select;
    const parents = selectCandidates(tracker.readyList(select), select, tracker.currentUsername);
    const selected = new Set(expandUnits(parents.map((t) => t.iid), work.childrenOf, o.subtasks ?? SUBTASKS.enabled).units.map((t) => t.iid));
    const catalogueKey = contentHash({ description: context.policyIdentity, title: JSON.stringify(catalogue.map((t) => [t.iid, t.title, t.description, t.parent]).sort((a, b) => Number(a[0]) - Number(b[0]))) });
    const dependencyCache = new Map<number, DependencyResult>();
    let worktree: ReturnType<typeof analysisWorktree> | undefined;
    const inputs = new Map<number, FrozenTicketInput>();
    refreshCards(runs.filter((r) => attempts.has(r.key)), {
      dir, attempts, project: TRACKER.project, root: process.cwd(), now: () => new Date().toISOString(),
      read: (iid) => {
        let input: FrozenTicketInput;
        try { input = freezeTicketInput(tracker.contextSource, iid); }
        catch (error) { if (error instanceof TicketInputHold && o.readiness) recordTicketInput(dir, o.readiness, error); throw error; }
        if (o.readiness) recordTicketInput(dir, o.readiness, input);
        inputs.set(iid, input);
        const t = { ...tracker.ticket(iid), title: input.context.child.title, description: input.context.child.description }, parent = input.context.parent?.iid;
        if (parent === undefined) return t;
        const p = input.context.parent!;
        return { ...t, parent: { iid: p.iid, title: p.title, description: p.description } };
      },
      notes: iid => inputs.get(iid)!.context.child.notes, hash: t => inputs.get(t.iid)!.hash, model: (description) => resolveTicketModel(description, AGENT.family),
      selection: (t) => {
        const result = unitEligibility(t, selected.has(t.iid), LABELS.exclude);
        return { selected: result.status === 'selected', selectionReason: result.reasons[0]?.message };
      },
      analysisInput: (t, notes) => `${inputs.get(t.iid)!.hash}:${catalogueKey}:${JSON.stringify(manifests.get(t.iid)?.implementerBlockers ?? [])}`,
      analysisBudget: o.budget ?? GRAPH.maxAnalysesPerPass,
      analyse: (ticket, notes) => {
        worktree ??= analysisWorktree(`${TRACKER.project}--assessment`, o.base);
        const prev = manifests.get(ticket.iid);
        const old = readAssessment(dir, runs.find((r) => Number(r.iid) === ticket.iid)!.key)?.analysis;
        const ids = new Set([...(prev?.requires ?? []), ...(old?.requires ?? [])].map((r) => r.providedBy).filter((i): i is number => i != null));
        const knownProviders: Ticket[] = [];
        for (const iid of ids) if (!catalogue.some((t) => t.iid === iid)) {
          try { knownProviders.push(tracker.ticket(iid)); } catch { /* leave unresolved, never infer satisfied */ }
        }
        return analyse({ project: TRACKER.project, base: o.base, worktree, ticket, input: inputs.get(ticket.iid)!, notes, catalogue, manifests,
          knownProviders, keepImplementerBlockers: true });
      },
      historicalBlockers: (iid) => manifests.get(iid),
      dependency: (iid) => {
        if (!dependencyCache.has(iid)) dependencyCache.set(iid, dependencyState(iid, {
          ticket: tracker.ticket,
          run: (id) => allRuns.find((r) => r.project === TRACKER.project && Number(r.iid) === id),
          mergedInto: tracker.mergedInto, base: o.base,
        }));
        return dependencyCache.get(iid)!.state;
      }, log,
    });
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    log(`assessment refresh: ${error}`);
    for (const r of runs) {
      try {
        const token = attempts.get(r.key);
        if (!token) continue;
        publishAssessment(dir, r.key, token, () => {
          writeAssessment(dir, r.key, assessed(readAssessment(dir, r.key), { iid: r.iid, project: r.project, at: new Date().toISOString(), error }));
          clearRequest(dir, r.key, asked.get(r.key));
        });
      } catch (e) { log(`assessment store: ${(e as Error).message}`); }
    }
  }
}
