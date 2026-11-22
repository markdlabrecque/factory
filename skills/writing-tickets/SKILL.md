---
name: writing-tickets
description: Write, file, or prepare tickets for agents. Plan and split the work, produce executable acceptance packages, and mark tickets ready only after automated independent review and baseline validation.
---

# Writing tickets

The planning agent resolves consequential design choices and gives implementors clear outcomes, constraints, and acceptance criteria. Implementors may make local, reversible decisions within those constraints. Escalate discoveries that would change the agreed scope, architecture, or risk.

One request produces:

- a **Request Ticket**: a plain-English summary with scope boundaries, so a human can review the scope in a minute;
- a **Decisions and assumptions** comment on it, when applicable: consequential choices, justified defaults, and bounded investigations;
- an **Implementation plan** comment on it: behaviour, affected components, constraints, tests, and deploy requirements;
- one **Task ticket** per piece, as a child of the Request Ticket, each naming its implementation tier and target-supported model metadata, unless the request is small enough to stay **unsplit** (step 4);
- an **acceptance draft** per runnable ticket: stable criteria, actual executable probe and fixture bytes where appropriate, and explicit evidence obligations otherwise;
- an estimate on the Request Ticket and a **readiness result** per runnable ticket: ready after independent automated review and accepted baseline evidence, or held with a reason.

The request arrives either as a description from the user or as an **existing ticket** (a number or URL, often written by someone else). An existing ticket becomes the Request Ticket: the steps are the same, and steps 1 and 7 note where they differ.

Tracker mechanics live in [GITLAB.md](GITLAB.md) and [GITHUB.md](GITHUB.md). Read the one for the target repo's `origin` before step 7. Run commands from inside the target repo.

For follow-up work after a failed or blocked run, use [ticket-run-recovery](../ticket-run-recovery/SKILL.md) to confirm a new ticket is warranted before planning or filing it.

## Steps

1. **Investigate.** Read the code, data, and existing tickets the request touches. Facts are yours to find; the user only makes decisions. For an existing ticket, its body, comments, and linked tickets are the request; read all of them. Also read every open ticket labelled `ready-for-agent`, with its plan comment: these are queued for agents and are the scope for [Blockers](#blockers). Done when you can name the affected components, known files, related tickets, and queued work that may overlap or supply dependencies, with remaining unknowns identified for step 2.

2. **Resolve consequential choices.** Investigate the repo before asking. Ask the user only about unresolved choices that materially affect architecture, scope, user-visible behaviour, compatibility, security, data loss, ongoing cost, or rollout risk, and require the user's priorities or authority. Follow established conventions for routine implementation decisions.

   For each question, explain the consequence, recommend an option, and state why the user's input is needed. Batch independent questions using `AskAQuestion`. If no consequential choices remain, proceed without questions or a confirmation round.

   Handle uncertainty according to its source:
   - **Discoverable facts:** find the answer in code, docs, or existing tickets.
   - **Local, reversible choices:** choose an established pattern within the agreed constraints.
   - **Consequential choices requiring user judgement:** ask with a recommendation.
   - **Unknowns requiring evidence:** when a required capability may not exist (for example, a pinned dependency may lack a supported API or a provider may not permit the required operation), predict the split now: make the investigation a separately closeable ticket and block the proof or implementation ticket on its result. Give the investigation a target scenario, constraints, a stopping rule, and an evidence deliverable. Allow three recorded outcomes: **supported** (reproduced with a viable contract), **blocked on tested approaches** (reproducible failures, not universal impossibility), or **inconclusive** (what is missing and who or what can resolve it). Closing the evidence ticket is not a compatibility pass: give the proof ticket a positive acceptance criterion and make it the hard dependency for implementation. A negative or inconclusive result must not make the proof ticket ready to run unless there is an actionable next step; see [ticket-run-recovery](../ticket-run-recovery/SKILL.md). If the work is a routine unknown that the implementor can resolve without changing the plan, keep it in the implementation ticket.

   Done when consequential choices are resolved and remaining uncertainty has either a justified default or a bounded investigation. Missing executable acceptance capability requires explicit evidence and reviewer approval of the appropriate evidence-only scope or a hold; it is not an assumed pass.

3. **Plan.** Write the implementation plan to a scratchpad file. Specify intended behaviour, affected components, constraints, tests, and deploy requirements in execution order. Name exact files and functions where investigation supports them. Mechanical tasks can specify exact edits; other tasks leave local implementation details to the implementor within the agreed design. For unresolved investigations, specify the evidence needed rather than inventing an implementation. Done when an implementor with only the ticket and repo can deliver and verify the outcome, or complete the bounded investigation, without deciding unresolved consequential choices.

4. **Split.** First decide whether to split at all, judging from the plan rather than the original ask. Apply these checks in order:
   1. **Same area?** When the whole plan works in one area of code, so that parallel pieces would collide in merge conflicts, the request stays **unsplit** whatever its size. Name a model big enough for all of it. This question overrides the next for implementation work; it does not combine a bounded investigation and a gated implementation that must run in sequence.
   2. **Small enough?** When one Small or Mid tier agent can finish it in one focused session, it stays **unsplit**.
   3. Otherwise, split.

   Unsplit means no Task tickets: the Request Ticket is the unit of work, and its body carries the model metadata below. Reaching question 3 permits a split; it never requires one.

   **Smallest coherent tickets.** When splitting is appropriate, make each ticket as small as possible while preserving a complete, independently checkable outcome and its tests. One focused session is a ceiling, not a target to fill. Split further whenever the pieces have separate edit boundaries. Keep changes to the same tightly coupled files or functions together when splitting would create merge conflicts or require coordinated partial edits; edit boundaries take precedence over smaller ticket counts or sizes.

   Cut the plan into Task tickets that **fan out**: each one self-contained and runnable in parallel with the others. Restate shared context in each ticket rather than pointing elsewhere. Where a hard dependency prevents parallel work, say so in `Depends on`. Pick a tier for each piece:
   - **Small**: mechanical, fully specified edits in one or two files.
   - **Mid**: multi-file changes, or small judgement inside a fixed design.
   - **Large**: only when the piece cannot be cut smaller, including a large unsplit same-area request; give the reason in the ticket.

   Choose the intended implementation model from the table as a `provider/model-id`. The family comes from the project's `defaultProvider`: read it from the target repo's `.pi/settings.json`, falling back to `~/.pi/agent/settings.json` when the repo doesn't set it. When it is `openai` or `openai-codex`, use the OpenAI column, always with the `openai` provider. Otherwise use the Claude column.

   | Tier | Claude | OpenAI |
   |---|---|---|
   | Small | `pi-claude-subscription/claude-haiku-5-5` | `openai/gpt-6-luna` |
   | Mid | `pi-claude-subscription/claude-sonnet-5-5` | `openai/gpt-6.1-terra` |
   | Large | `pi-claude-subscription/claude-opus-5-5` | `openai/gpt-6.1-sol` |

   Aim for Small or Mid. Assign only the implementation models in this table; every ticket in one run uses the same family. Fable is never used anywhere in this workflow.

   **Model metadata:** record `**Model tier:** small|mid|large` for implementation size and a distinct `**Planning model:** <actual planner provider/model-id>` as provenance, not a runtime selector. Check the target runtime's supported selectors before emitting any exact implementation selector. For example, Factory-compatible tickets use Model tier and Planning model, not standalone Pi model; the runtime resolves implementation from its configured tier mapping. A different target that explicitly supports `**Pi model:**` may additionally use the table's exact implementation model there. Do not infer runtime support from tracker support or misreport the selected implementation model as the model that planned the ticket. Done when every plan line has exactly one runnable owner (or the request is unsplit), with implementation tier, actual planning provenance and only supported selectors.

5. **Draft acceptance.** For every runnable ticket, read [ACCEPTANCE.md](ACCEPTANCE.md). Write the target's versioned acceptance contract when available and create the actual probe, helper and fixture files alongside it, outside the implementation checkout. A Markdown checklist alone is not a package. Done when each criterion has a stable ID and an executable assertion or explicit evidence obligation, and every executable artifact has available bytes, a digest and a bounded run specification. If a draft cannot be completed, retain what exists and record the missing input.

6. **Estimate.** Hours for a human developer to implement the whole request without AI: orienting in the code, writing it, testing, QA, review, deploy. Sum the activities; when the range is genuine, use its top.

7. **File without readiness.** Write the Request Ticket, Decisions and assumptions comment when applicable, Implementation plan comment, Task tickets as children (skip when unsplit), blockers (see [Blockers](#blockers)) and estimate. Verify the final requirements and relationships in the tracker before submitting acceptance. For an existing ticket, preserve its scope and decisions; remove readiness before changing its scope or acceptance inputs. Creating an issue to obtain an ID does not make it ready.

8. **Submit and check readiness.** Follow [Automated handoff](ACCEPTANCE.md#automated-handoff). Submit the draft to the target's documented preparation workflow; the independent reviewer and host policy, not the ticket writer or a human approval queue, supply review and execution authority. For Factory, preparation owns the ready label; do not apply it via tracker commands. Readiness is per runnable unit, not inherited from a parent. If automation is unsupported or cannot complete, leave the ticket unlabelled and retain the draft and specific hold reason. Never label a split parent if doing so can dispatch held children.

9. **Report** the Request Ticket as a Markdown link when unsplit, otherwise each Task ticket link, with implementation tier, intended model or configured tier selection, planning provenance, and the observed ready/held status. For a hold, give the reason and where the draft is retained.

## Request Ticket

**Title**: plain English a non-developer client can read; the outcome, not the mechanism. No class names, file paths, or internal shorthand. About ten words at most.

| Instead of | Write |
|---|---|
| `Classifier and report builder disagree on scope: 669 nodes unclassifiable` | 669 pages can't be sorted for migration |
| `Add titles to the cross-reference migration manifest` | Show page names in the migration list |

**Body**: the summary only; implementation detail lives in the comments.

```markdown
**Model tier:** <small|mid|large>   <!-- unsplit only -->
**Planning model:** <actual planner provider/model-id>   <!-- provenance, not a runtime selector -->
<!-- Add an exact implementation selector only if the target runtime supports it. -->

<Two to four sentences: what changes, who it affects, why it matters.>

**In scope**

- <boundary>

**Out of scope**

- <adjacent work a reader would assume is included, and where it goes instead>
```

## Decisions and assumptions comment

Record consequential choices made by the user, agent-selected defaults and their rationale, and unresolved investigations with the work they block. Omit empty sections and omit the comment entirely when there is nothing to record. This is a decision record, not a transcript.

```markdown
<details>
<summary>Decisions and assumptions</summary>

### Decisions

- <Consequential choice made by the user and its rationale.>

### Assumptions and defaults

- <Agent-selected default, its rationale, and any condition requiring it to be revisited.>

### Investigations

- <Question to resolve, bounded investigation, required evidence, and dependent work blocked until the decision is settled.>

</details>
```

The blank line after `</summary>` is required, or the Markdown inside renders as plain text.

## Implementation plan comment

The plan from step 3, inside `<details><summary>Implementation plan</summary>` with the same blank-line rule. Sections:

- **Approach**: the design in a paragraph, and why.
- **Changes**: affected components and known files, intended behaviour, and implementation constraints. Identify any bounded investigations and their deliverables.
- **Tests**: each test and the behaviour it guards.
- **Deploy**: migrations, config, cache clears, ordering.
- **Acceptance**: per-runnable-ticket immutable package reference/revision/digests, approval provenance, baseline/evidence references and ready/held decision, using [ACCEPTANCE.md](ACCEPTANCE.md). The summary links the authoritative bytes; editable comments are not approval authority.
- **Tasks**: a table of task title, implementation tier, intended implementation model, planning provenance and dependencies. Omit when unsplit; this comment is then the implementor's spec.

## Task ticket

Written for an implementor that has only this ticket and the repo.

```markdown
**Model tier:** <small|mid|large>
**Planning model:** <actual planner provider/model-id>   <!-- provenance, not a runtime selector -->
<!-- Add an exact implementation selector only if the target runtime supports it. -->
**Part of:** #<request>
**Depends on:** None   <!-- or: #14 (needs its Tracker contract) -->

## Goal

<One sentence.>

## Context

<What the implementor needs from the plan and decisions record, restated here. Include relevant constraints, defaults, and investigation dependencies.>

## Changes

- <Affected component or known file>: <required behaviour and constraints, or a bounded investigation and its deliverable.>

## Tests

- <test and what it asserts>

## Done when

- [ ] <stable criterion ID: checkable condition, matching the submitted acceptance inventory>
```

Title Task tickets by the concrete change ("Add CSV export command for page sorting results"); they are read by implementors, not the client.

## Blockers

Applies when one run creates more than one ticket (Request Ticket plus Task tickets, or several Request Tickets). Skip this section when the run creates a single ticket.

**Scope**: the tickets this run creates plus every open ticket labelled `ready-for-agent`. Within that scope, ticket A is blocked by ticket B only when A has a **hard dependency** on B: A needs code, data, or a decision B produces, so B must be built before A can build on it.

Not a blocker: A and B edit the same files or functions. Agents may work in the same area at the same time; merge conflicts are resolved at merge.

Rules:

- Links point from new tickets to queued or new tickets. Existing `ready-for-agent` tickets are never edited.
- A Request Ticket is never blocked by its own Task tickets; the parent/child link covers that.
- No cycles. If two tickets seem to block each other, the later one is blocked.
- Record the reason for each link in the Task ticket's `Depends on` line (or the unsplit Request Ticket's body): `#12 (needs its Tracker contract)`.

**Mechanism** depends on the tracker:

- **GitHub Issues**: native blocked-by links, plus the `Depends on` text. See [GITHUB.md](GITHUB.md#blockers).
- **GitLab**: no links. The technical dependencies go in the ticket description. See [GITLAB.md](GITLAB.md#blockers).

Done when every pair in scope has been checked, every blocker is recorded with its reason, and (on GitHub) every link reads back from the API.

## Labels

Pick the Request Ticket's labels from the project's real label list, one per axis the project uses (area, feature). `ready-for-agent` is the one fixed name: create it when missing. Every other label must already exist.
