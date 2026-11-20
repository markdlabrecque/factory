# Writing-tickets tracked development workspace

For [issue 314](https://github.com/markdlabrecque/factory/issues/314), the owner explicitly authorized the Factory repository as the tracked development workspace for the portable writing-tickets skill. This supersedes the ticket and parent plan's external/global-edit workspace hold and requirement that a repository copy cannot count as delivery. Global installation, symlinks and install/update automation are deferred. This repository copy is a development proposal, not a claim that the live skill has been updated.

## Unchanged import provenance

The initial import copies the complete live directory's three regular files from `/home/mark/.agents/skills/writing-tickets/`, after reading all three. No sibling resources existed. No content, encoding or newline normalization was applied. The source directory was not modified. The import's parent is fetched `origin/develop` at `a242b30d748d4f35e964069cea9486d71c298970` (merged PR 317).

| File under `skills/writing-tickets/` | SHA-256 of source and unchanged import |
| --- | --- |
| `SKILL.md` | `b008bd7831e4d4233ae69a947f70a2161d36fc886c20f610c1f55371345f1677` |
| `GITHUB.md` | `64da61330cca04b454f771cb97b939bc9120b9469e2a006088fb8cc08c347a77` |
| `GITLAB.md` | `b989e6ef5f94251c2a9246dee1b50eb163326caedfb5eb03e9844d8dddad0d4d` |

The separate import commit contains only these unchanged files and this provenance note. Review the later proposal against that commit, not just against develop, to see the actual guidance changes.

## Review boundary

The skill remains portable across projects and trackers. The repository houses its development; it does not make Factory mandatory for consumers. `skills/writing-tickets/SKILL.md` owns the workflow, sibling tracker references own tracker mechanics, and any acceptance reference owns preparation details. The existing `ticket-run-recovery` pointer is an external skill dependency retained from the live source, not a bundled or installed dependency.

No runtime custody, runner, role prompts, global installation or automatic ticket dispatch changes belong to this work. Fresh independent review is required before delivery; keep the proposal worktree for that review.
