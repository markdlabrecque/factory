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
gh label create ready-for-agent --color 428BCA --description "Planned and split; ready for agents to implement"   # only if missing
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

List the queue before labelling anything from this run:

```
gh issue list --label ready-for-agent --state open --limit 200 --json number,title,body
```

Add each link on the blocked ticket, after all tickets exist:

```
gh issue edit <blocked> --add-blocked-by <blocker>[,<blocker>...]
```

Confirm each blocked ticket:

```
gh api repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by --jq '.[].number'
```

Every blocker must appear. If one is missing, add it again.

## Acceptance and ready

After filing relationships and estimate, attach the [acceptance preparation](ACCEPTANCE.md) summary to each runnable issue. It must link the immutable package revision/digests, trusted human/independent approval record and bounded baseline receipt or reviewed non-transition evidence. Editable issue text is an index, not trusted approval/custody authority. Mixed work is reviewed per criterion; missing approval, already-green changed behavior or invalid/unavailable execution keeps the issue held without the ready label.

```
gh issue comment <N> -F acceptance.md
gh issue view <N> --comments
```

Read back the body, model metadata, plan, acceptance references, children and blockers. Confirm that the referenced bytes and approval/evidence identities actually match; merely posting links is insufficient. Use only runtime-supported selectors: implementation Model tier and distinct actual Planning model; add Pi model only for a target that supports it. No Factory dependency is required.

Apply readiness last, only to runnable units whose review passes. A split parent's readiness must not dispatch held children. If changing an existing ready issue's scope or frozen acceptance, remove readiness first, refreeze/reapprove and repeat evidence review before restoring it.

```
gh issue edit <N> --remove-label ready-for-agent   # before changing existing ready acceptance
gh issue edit <N> --add-label ready-for-agent      # only after all readiness checks pass
```

Link format for the report: `[#N](https://github.com/<owner>/<repo>/issues/N)`.
