# GitHub mechanics

GitHub's equivalents: the Request Ticket is a parent issue, and each Task ticket is a **sub-issue** of it. Use **issue types** where the org defines them (the Request Ticket gets `Feature` or the closest match, Task tickets get `Task`). Write every body to a scratchpad file first.

## Issue types

```
gh api orgs/<owner>/issue-types --jq '.[].name'
```

Personal repos and orgs without types return nothing or 404. Leave `--type` off in that case; the parent/sub-issue link still carries the hierarchy.

## Labels

```
gh label list --limit 200
```

## Request Ticket, with the estimate

GitHub has no native time estimate. Add this line at the end of the Request Ticket body:

```markdown
**Estimate:** 12h (human, without AI)
```

If the repo belongs to a Project with a number field named `Estimate`, also set it there with `gh project item-add` and `gh project item-edit`.

```
gh issue create -t "Plain English title" -F request.md -l "area,feature" --type Feature
```

For an existing ticket, replace its title and body (the estimate line included):

```
gh issue view <N> --comments
gh issue edit <N> -t "Plain English title" -F request.md --add-label "area,feature"
```

## Comments

```
gh issue comment <N> -F qa.md
gh issue comment <N> -F plan.md
```

## Task tickets

```
gh issue create -t "Task title" -F task-1.md --parent <N> --type Task
```

Confirm the children:

```
gh api repos/<owner>/<repo>/issues/<N>/sub_issues --jq '.[] | "\(.number) \(.title)"'
```

## Blockers

Record local blocker numbers in the blocked issue's `Depends on` line and their reasons in the body. Add the native links after all the tickets exist:

```
gh issue edit <blocked> --add-blocked-by <blocker>[,<blocker>...]
```

Confirm each blocked ticket:

```
gh api repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by --jq '.[].number'
```

Every blocker must appear. If one is missing, add it again.

## Handoff

Read back the body, model metadata, plan, sub-issues and native blockers. For an explicit Factory batch, report the filed issue numbers and known blockers; native links and sub-issue relationships are not submissions. See the [GitHub batch example](BATCH.md#github-unsplit-issue).

Only for a target that requires separate acceptance preparation, follow its documented readiness workflow and [automated handoff](ACCEPTANCE.md#automated-handoff), including its rules for invalidating readiness when approved inputs change.

Link format for the report: `[#N](https://github.com/<owner>/<repo>/issues/N)`.
