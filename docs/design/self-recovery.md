<!-- Agreed self-recovery scope for future Factory tickets. No recovery implementation ships with this document. -->
# Self-recovery slice

Status: agreed scope, not implemented. The direct implementation and its tests were discarded at the user's request. Implementation must be ticketed and run through Factory under [AGENTS.md](../../AGENTS.md).

## Outcome

Factory should notice when queued work cannot move forward, deploy a helper agent to investigate, and recover a jammed ticket without requiring a human to delete its state or branch.

The existing dispatcher timer should perform the check after a normal dispatch pass. This slice does not add another timer.

## Jam detection

Check each project separately. A project is jammed when it has queued work and none of its tickets are active. Still-ready stopped tickets count as queued demand, so a project whose pending tickets have all failed can recover too.

A full shared run cap or a dependency progressing in another project should delay recovery rather than trigger it. Normal dispatch gets the first opportunity to launch work. Recovery must respect shared capacity and avoid duplicating an active ticket run.

## Repair agent

Run the helper inside the existing Docker sandbox for isolation, on one affected ticket's existing branch. Provide logs, previous evidence, run state and queue/dependency diagnostics so it can find the cause before editing.

The helper may repair ticket implementation, tests and project-local workflow files. Instruct it to make the smallest change to the worktree that moves the ticket forward. Preserve existing commits, uncommitted work and evidence rather than deleting a failed branch and starting over.

Host services, credentials, other tickets' branches and remote branch deletion remain outside its authority. The helper does not merge PRs. Normal Factory verification and delivery policy still apply after repair.

Changing a project-local workflow file in the ticket branch does not itself update the running host dispatcher. Report any required host-side follow-up rather than claiming it has already happened.

The retained [repair prompt draft](self-recovery-prompt.md) records the intended agent instructions. Its placeholders, filenames and report format are design proposals, not an installed runtime contract.

## Recoverable tickets

The current dispatcher skips a ticket that already has a branch. The current retry command clears a stopped run's record but leaves its branch behind, so clearing state alone may not make the ticket runnable.

The implementation needs a guarded branch-preserving recovery path. Resume or repair the affected ticket's worktree, retain diagnostics, and return it to normal verification. A transient failure should not force an unnecessary new commit when the existing implementation is already correct.

Intentional dependency holds, open PRs awaiting merge and missing credentials are not permission to bypass prerequisites or acceptance requirements. An unresolved problem should produce a report and stop that attempt.

## Bounds and reports

- At most one recovery agent per project.
- A 15-minute timeout.
- At most two repair attempts against an unchanged jam.
- Keep the diagnostic report and stop retrying that jam when the budget is exhausted.
- Resume automatic recovery after a meaningful state change or an explicit human reset.

Record the observed cause, files changed, tests and results, whether the ticket can proceed, and any remaining blocker. Preserve previous reports and evidence across attempts.

## Ticket preparation

Before implementation, specify these details in Factory-ready tickets:

- The exact pending-work predicate and how it respects intentional exclusions and dependencies.
- How the helper claims a project and shared capacity without racing another dispatcher pass.
- Safe ownership checks for existing branches and worktrees, including remote-only branches and uncommitted work.
- Which meaningful state changes reset the retry budget. The helper's own logs and failed attempts must not reset it indefinitely.
- The timeout boundary, cancellation and container cleanup, including sandbox setup.
- The explicit reset mechanism and where operators find recovery status and reports.
- How existing project scaffolds receive the new workflow without overwriting customizations.

Test Factory-owned detection, retry bounds, concurrency, preservation, failure handling and independent verification with stubbed external boundaries. A live container trial can provide additional deployment evidence, but earlier tests of the discarded implementation are not evidence for the eventual Factory-delivered change.

This document does not create, queue or dispatch implementation tickets. Those are a separate step before development begins.
