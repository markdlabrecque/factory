# GitLab mechanics

The Request Ticket is an **Issue** work item; each Task ticket is a **Task** work item, a child of that Issue. Run `glab` inside the repo, or add `-R group/subgroup/project` to every command. Write every body to a scratchpad file first so the Markdown survives shell quoting.

## Labels

```
glab label list --per-page 100
glab label create -n ready-for-agent -c "#428BCA" -d "Planned and split; ready for agents to implement"   # only if missing
```

## Request Ticket, with the estimate

```
glab issue create -y --no-editor \
  -t "Plain English title" \
  -d "$(cat request.md)" \
  -l "Area,Feature" \
  -e "12h"
```

`-e` sets `time_stats.time_estimate`, which the `value-estimates` skill reads. Setting it at creation satisfies the estimate step.

For an existing ticket, replace its title and body, then set the estimate with a quick action:

```
glab issue view <N> --comments
glab issue update <N> -t "Plain English title" -d "$(cat request.md)" -l "Area,Feature"
glab issue note <N> -m "/estimate 12h"
```

## Comments

```
glab issue note <N> -m "$(cat qa.md)"
glab issue note <N> -m "$(cat plan.md)"
```

## Task tickets

`glab work-items` is experimental and has no parent flag, so create the Task, then attach it with a quick action on the Request Ticket:

```
glab work-items create --type task -t "Task title" --description-file task-1.md -F json
glab issue note <N> -m "/add_child #<task-iid>"
```

Read the new task's `iid` from the JSON output. Then confirm the children, since a quick action that fails is silent:

```
glab api graphql -f query='query { project(fullPath: "group/project") { workItems(iids: ["<N>"]) { nodes { widgets { ... on WorkItemWidgetHierarchy { children { nodes { iid title workItemType { name } } } } } } } } }'
```

Every task should appear with type `Task`. If one is missing, attach it again.

## Blockers

GitLab CE has no blocked-by links, so dependencies live in the description. List the queue before labelling anything from this run:

```
glab issue list -l ready-for-agent --per-page 100
glab issue view <N> --comments
```

In each blocked ticket's description, add this section at the end (Task tickets: directly under `## Done when`; unsplit Request Ticket: after the scope lists, before the estimate):

```markdown
## Blocked by

- #12: needs the `Tracker` contract from `src/contracts.ts`, which #12 adds.
- #14: needs the `runIssue` signature change in `src/run.ts`, which #14 adds.
```

Each entry names the blocker and the technical reason: the file, function, or output involved. Write it into the body file before `create`, or update an existing body with `glab issue update <N> -d "$(cat body.md)"`. Keep the `Depends on` line in sync with this list.

## Acceptance and ready

After filing hierarchy, dependencies and estimate, attach the [acceptance preparation](ACCEPTANCE.md) summary to each runnable work item. Link its immutable package revision/digests, trusted human/independent approval record and bounded baseline receipt or reviewed non-transition evidence. A note or description is an index, not approval/custody authority. Review mixed work per criterion; missing approval, already-green changed behavior or invalid/unavailable execution leaves the item held without the ready label.

```
glab issue note <N> -m "$(cat acceptance.md)"
glab issue view <N> --comments
```

Read back scope, plan, model metadata, acceptance identities, native child relationships and description-only blockers. Verify referenced bytes and approval/evidence, not just the presence of a note. Use implementation Model tier and distinct actual Planning model; emit an exact implementation selector only if the target runtime supports it. No Factory installation is needed.

Apply readiness last, only for reviewed runnable units. A split parent's readiness must not dispatch held children. For changed scope or acceptance on an existing ready item, remove the label before editing, then refreeze/reapprove and repeat evidence review before restoring it. Keep other labels intact.

```
glab issue update <N> --unlabel ready-for-agent   # before changing existing ready acceptance
glab issue update <N> -l ready-for-agent           # only after all readiness checks pass
```

Link format for the report: `[#N](https://<host>/<group>/<project>/-/issues/N)`.
