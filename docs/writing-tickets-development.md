# Writing-tickets tracked development workspace

For [issue 314](https://github.com/markdlabrecque/factory/issues/314), the owner explicitly authorized the Factory repository as the tracked development workspace for the portable writing-tickets skill. This supersedes the ticket and parent plan's external/global-edit workspace hold and requirement that a repository copy cannot count as delivery. The initial proposal deferred global installation and synchronization. The tracked skill now describes an unattended acceptance handoff: draft executable artifacts while writing the ticket, let trusted target automation perform review and baseline execution, and leave the ticket held if that automation is absent. Factory's copied install already bundles `skills/`; that packaging does not register or update the independently discovered user skill.

## Unchanged import provenance

The initial import copies the complete live directory's three regular files from `/home/mark/.agents/skills/writing-tickets/`, after reading all three. No sibling resources existed. No content, encoding or newline normalization was applied. The source directory was not modified. The import's parent is fetched `origin/develop` at `a242b30d748d4f35e964069cea9486d71c298970` (merged PR 317).

| File under `skills/writing-tickets/` | SHA-256 of source and unchanged import |
| --- | --- |
| `SKILL.md` | `b008bd7831e4d4233ae69a947f70a2161d36fc886c20f610c1f55371345f1677` |
| `GITHUB.md` | `64da61330cca04b454f771cb97b939bc9120b9469e2a006088fb8cc08c347a77` |
| `GITLAB.md` | `b989e6ef5f94251c2a9246dee1b50eb163326caedfb5eb03e9844d8dddad0d4d` |

The separate import commit `16cb180d2f853f2a7d5f52688be457136d5a6100` contains only these unchanged files and this provenance note. `cmp` passed for all three files before that commit; source SHA-256 values were checked again after the proposal edits and remained unchanged. Review the later proposal against that commit, not just against develop, to see the actual guidance changes.

## Initial proposal review boundary

The skill remains portable across projects and trackers. The repository houses its development; it does not make Factory mandatory for consumers. [SKILL.md](../skills/writing-tickets/SKILL.md) owns the workflow, sibling tracker references own tracker mechanics, and [ACCEPTANCE.md](../skills/writing-tickets/ACCEPTANCE.md) owns preparation details. The existing `ticket-run-recovery` pointer is an external skill dependency retained from the live source, not a bundled or installed dependency.

No runtime custody, runner, role prompts, global installation or automatic ticket dispatch changes belong to this work. Fresh independent review is required before delivery; keep the proposal worktree for that review.

## Ticket reconciliation and readiness

The [owner-decision reconciliation comment](https://github.com/markdlabrecque/factory/issues/314#issuecomment-7047100390) records the superseded hold and the separate unchanged import. The issue body now names the repository footprint and distinguishes development delivery from deferred global deployment. Dependency 309 was closed after PR 317 merged. Issue 314 remains open with its documentation label; no ready label was added, avoiding automatic dispatch while this explicitly authorized implementation is in progress. The parent planning comments are historical; this owner decision supersedes only their T6 workspace/install requirements, not their acceptance guarantees.

## Proposal review evidence

This is implementer document review and static validation, not the fresh independent review or a fabricated future-protocol approval. No real feature probes, baseline sandbox or model calls were launched for the hypothetical examples.

### Manual scenario matrix

Each row was walked through step 5, the disclosed acceptance sequence, then both tracker readiness sections. Both paths retain native child/blocker handling and add approval/evidence read-back before their final label command. The decisions below assume actual frozen bytes and matching trusted review records exist; missing records hold in every scenario.

| Scenario / observed evidence | GitHub decision | GitLab decision |
| --- | --- | --- |
| Changed summary export: existing API loads; named wrong/missing summary failure observed in authorized bounded baseline | Ready after issue references/read-back; later candidate must pass same assertion | Same, after work-item references/read-back |
| Changed summary already green, or existing API import fails | Hold for semantic review / setup repair respectively; neither is expected red | Same hold; no ready label |
| Refactor preserves row order: approved preservation probe passes baseline | Ready; later identical assertion must remain green | Same preservation decision |
| Documentation-only / genuinely manual acceptance: baseline snapshots and reviewed checklist; explicit non-transition rationale and approver | Ready with exact inventory/evidence review, no fabricated red; later candidate review required | Same evidence-only decision |
| Investigation: target scenario, bounds, stopping rule and reproducible evidence deliverable approved; capability unknown | Investigation ready; dependent proof/implementation held pending positive evidence | Same; dependency remains in description |
| Mixed summary + order + guide: named changed red, preservation green, reviewed guide baseline | Ready only when all three separate obligations pass preparation review | Same per-criterion decision |
| Mixed ticket hides unavailable changed probe under docs exception, or bundle/fixture changes after approval | Hold; remove prior readiness and obtain new identity-bound approval/evidence | Same; remove only readiness, retain other labels |

No scenario requires Factory: the target supplies its own trusted immutable storage, review channel and bounded sandbox. Absent those capabilities, the prescribed outcome is an explicit hold, not installing Factory or running tracker shell on the host. Candidate semantic/manual verification remains independent and cannot be replaced by parser/replay success.

### Checks run

- `git diff --check`: passed.
- `node --test orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts`: **1,246 passed; 0 failed, skipped or cancelled** (about 80 seconds; retained local log `/tmp/issue314-commit-suite.log`). This is the requested existing commit-tier suite; no tests/configuration/fixtures were changed.
- `node --test orchestrator/models.test.mts`: **7 passed**; no model launch.
- One-off Node static check extracted the two Markdown model examples in `ACCEPTANCE.md`, passed the Factory example through `ticketTier`/`resolveTicketModel` for both runtime families (`openai`, `anthropic`), changed only planning provenance to Claude and confirmed unchanged tier, and confirmed that the explicitly other-runtime Pi example is rejected by Factory. It also instantiated both Request/Task templates at all three tiers: **6 explicit tier resolutions passed**, not accidental default fallback. An initial check command used the wrong internal family name `claude`; correcting the check to the exported `anthropic` family resolved that command error without product changes.
- Reviewed the approved six-model table and provider fallback against the unchanged import: preserved. Runtime-supported tier resolution remains separate from actual planning provenance.
- All new relative skill/document links resolve within the proposal. The pre-existing external recovery-skill dependency remains intentionally unbundled, as noted above.

### Current limits

The skill requires a documented submission interface and trusted automated review for unattended readiness. The host custody and baseline APIs are not that interface; without it the skill retains the draft and leaves the ticket held. No installer hook, reviewer service, or execution-policy integration is supplied by the skill.
