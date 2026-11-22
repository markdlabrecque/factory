# Factory Strategy

## Vision
<!-- vision: author-approved 2026-11-22 -->

`Factory` exists so that a maintainer can hand off a batch of prepared software changes and get one branch back to test.
It serves repository operators who decide what work enters the batch and whether its combined result goes any further.
It owns exactly one thing: the sandboxed delivery of an operator-selected ticket batch to its integration branch.

### The operator gives Factory the work

A session starts with an explicit batch; naming a parent ticket includes its in-scope subtickets, and a saved tracker query can supply a list the operator previews and confirms.
Factory resolves the batch membership before implementation starts and does not add later matches or start work from a label alone.
Factory respects the blockers recorded on those tickets instead of inventing dependencies or treating a blocked prerequisite as complete.
A missing prerequisite can join the batch before implementation only with the operator's explicit confirmation.
Ticket preparation owns the description of the intended behavior and the dependency graph; the batch runner consumes both.
A batch account distinguishes what merged from what stopped so silence does not look like completion.

### The implementer owns the tests, not the verdict

The implementer changes code and tests together and can revise both until the candidate is ready for review.
A ticket enters the batch branch only when its automated tests pass and two fresh reviewers, independent of the implementer and of each other, approve the tests and the implementation respectively.
The test reviewer records what the ticket requires and what the tests prove before looking at the implementation, then may consult the diff to check that the tests actually exercise the behavior.
A ticket is not eligible to merge if a required behavior has no credible automated test and can only be judged after handoff.
The code reviewer starts with the diff and judges the implementation on its merits.
A revision needs fresh review of each changed surface; code approval can carry forward only when the host can establish that the revision changes only tests and leaves the reviewed implementation and its inputs unchanged.
Factory uses one ticket merge gate: passing tests and both approvals, without a separate test author, pre-implementation approval, frozen probes, or deterministic acceptance-criteria replay.
After a rejected review round, Factory can return the ticket for revision at most twice, with tests and the required reviews on each revision.
A third rejected round stops that ticket and blocks its dependents without stopping independent tickets.

### Usability review informs without gating

At the end of every ticket's implementation, a fresh agent tries the change as an end user, separately from the test and code reviews.
When it can verify the change, it posts screenshot or video evidence to the ticket along with any usability suggestions grounded in common user expectations or established usability standards.
When it cannot verify the change, it still posts a ticket comment that says so instead of leaving the outcome ambiguous.
Neither the usability review nor delivery of its comment is a merge prerequisite.
The review never sends work back to the implementer or substitutes for passing tests and the two required approvals.

### Authority stays with the host

Agents implement, review, and advise within their roles; the host checks that each result applies to the ticket and the work it gates.
A passing baseline, an approval for changed work, or an unavailable review cannot stand in for current evidence.
A simpler ticket gate does not waive sandbox ownership, execution limits, or the authority to write to the destination branch.
Recovery preserves saved work and stays within existing ownership and attempt limits rather than turning advice into permission to retry.
A stop leaves enough evidence for the operator to see what is known and what still needs a decision.

### The integration branch is the handoff

Factory creates one integration branch per batch from a pinned starting commit; the operator can choose the base without giving Factory permission to write back to it.
Before each merge, Factory runs the ticket's tests on its proposed merge result against the current integration tip and retests if the tip moves before the merge.
Factory hands over the branch when each ticket has either merged or stopped, without adding a final batch-wide test pass, even as an advisory check.
The operator tests the combined branch, makes any follow-up fixes, and decides whether and where to merge it onward.
Factory does not promote the branch, revert tickets out of it, or take action in response to human testing of the handoff.

### Scope

Factory is not a tracker backlog scheduler, a general CI service, or a release manager.
Tracker records supply requirements and dependencies; the Board and journal make run outcomes inspectable without granting new authority.
Legacy setups and runs do not carry forward into this workflow, and Factory does not offer a compatibility mode for its former acceptance gate.
No project-specific convenience is a reason to let a ticket or model output authorize its own merge.

A change aligns when it helps deliver or inspect an operator-selected batch without weakening independent reviews, tests on the proposed merge result, or operator control after handoff.
A change should be resisted when it grants work from a label, waives a merge requirement, turns usability feedback into a merge gate, reintroduces the legacy gate, or gives Factory responsibility for testing or promoting the completed batch.
