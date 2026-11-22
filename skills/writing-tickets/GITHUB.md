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

File and read back the body, model metadata, plan, children and blockers before [submitting the package](ACCEPTANCE.md#automated-handoff). Use only target-supported model selectors. For Factory, read back the ready label after the trusted preparation workflow applies it. If the workflow is unavailable or reports a hold, leave the issue unlabelled. Do not post ordinary receipt comments after freeze; they can change the requirements hash.

Before changing existing ready scope or acceptance, remove readiness:

```
gh issue edit <N> --remove-label ready-for-agent
```

Repeat the automated handoff for the new inputs. For other runtimes, use the target's documented readiness workflow.

Link format for the report: `[#N](https://github.com/<owner>/<repo>/issues/N)`.
