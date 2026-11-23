# Explicit Factory batch examples

These are offline walkthroughs, not live tracker writes or commands to run. File the ticket and verify its tracker representation first. Then hand the operator the runnable IDs and any prerequisites. Submission is a separate action: consult the [Factory CLI contract](https://github.com/markdlabrecque/factory/blob/develop/docs/factory-cli.md#explicit-batch-submission-and-resume) before running it.

## GitHub unsplit issue

**Issue #41: Show totals in CSV exports**

```markdown
**Model tier:** small
**Planning model:** openai/gpt-6.1-terra
**Depends on:** None

Export users need a total without calculating it by hand.

**In scope:** Append one total row to the existing CSV export.
**Out of scope:** Changes to displayed totals, export filters or detail-row ordering.

## Done when

- [ ] Exporting rows with amounts 1 and 2 appends one total row with amount 3.
- [ ] The header and the two detail rows are unchanged and in the same order.

## Verification

- Add a focused CSV assertion covering the total and preserved detail rows; run the project's normal checks.

**Estimate:** 3h (human, without AI)
```

**File and read back:** The plan comment identifies the serializer, its focused test and the absence of deployment prerequisites. There is no parent, sub-issue or native blocked-by link. If there were a hard blocker, record its number in `Depends on`, explain why, and verify the native blocked-by link on #41 as well.

**Handoff:** Filed #41 (Small, implementation from the configured tier; planner `openai/gpt-6.1-terra`), no known blockers, not submitted. If the operator separately authorizes `factory batch submit web 41`, it selects #41 only.

## GitLab child with a blocker

**Task #58: Show an empty-state total in CSV exports**

```markdown
**Model tier:** small
**Planning model:** openai/gpt-6.1-terra
**Part of:** #50
**Depends on:** #53

## Goal

Make an empty export report a total of zero.

## Context

The export improvement in #50 keeps the existing header and filters. Use the shared total-row serializer introduced by #53; do not add a second serializer.

## Changes

Handle the empty result in the CSV exporter using the shared serializer.

## Verification

- Run the export checks and add a focused assertion for an empty result.

## Done when

- [ ] An empty result keeps the existing header and has exactly one total row with amount 0 and no detail rows.
- [ ] Nonempty exports still append one total row after their detail rows.

## Blocked by

- #53: supplies the shared total-row serializer used by the empty-result path.
```

**File and read back:** Parent Issue #50 has the overall scope, plan comment and estimate. Read back #58 as a Task of #50 and verify its `Depends on` declaration and technical reason in the description. The native parent relationship carries context, not the prerequisite edge.

**Handoff:** Filed #58 (Small, implementation from the configured tier; planner `openai/gpt-6.1-terra`), depends on #53, not submitted. Filing #50 or referencing #53 doesn't select or launch either. `factory batch submit web 58` selects only #58; an unsatisfied external #53 can hold it. If the operator explicitly submits `factory batch submit web 53 58`, both are selected, and #58 waits for #53 to be delivered on that batch. Do not submit the parent in place of its Tasks.

On either tracker, authoring ends without a frozen probe package, preparer approval, baseline receipt or `ready-for-agent` label. Missing those items isn't a hold. The ticket specifies what must be verified; tests can evolve alongside the implementation. Factory checks passing tests and independent test and code reviews on the candidate, not on the ticket draft.
