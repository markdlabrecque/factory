# Orchestrator

`main.mts` takes one GitLab ticket through: branch off an integration branch, implementer run, verifier run (screenshot/video evidence plus a verdict), evidence posted to the ticket, then on PASS push, wait for CI and open an MR into the same integration branch. It never merges and never closes the ticket. Written against `@ai-hero/sandcastle` 0.14.0 with the Docker provider.

```
npx tsx .sandcastle/main.mts --base <integration-branch> [--issue N] [--no-push]
```

## Install into a project

Copy into the project's `.sandcastle/`: `config.mts`, `main.mts`, `dispatch.mts`, `graph.mts`, `analyze.mts`, `tracker.mts`, `manifests.mts`, `prompt.md`, `prompt.verify.md`, `prompt.analyze.md`, `sandbox/`, and `board.mts` + `board.template.html` from `../board/`. Add `evidence/`, `state/`, `board.html` to `.sandcastle/.gitignore`. The image comes from the `sandcastle-setup` skill (needs the GitLab, web runtime, CMS and Playwright layers). The host needs `glab` and `claude` on the PATH.

## What is generic

Branching, the two agent runs and the verifier guard (it must not commit, move HEAD or dirty the tree), evidence upload and the ticket comment, the verdict gate, the push/CI/MR step, and the board updates. The container never holds a GitLab token; every GitLab call runs on the host with its own `glab` auth.

## What to adapt per project

1. **`config.mts`:** GitLab host, project path and id, the milestone, every label Sandcastle filters on or writes, and the ticket graph settings. `main.mts` and `dispatch.mts` check at startup that every label exists. From a terminal they offer to create missing ones; declining, or running without a terminal (the timer), quits.
2. **`CONFIG` at the top of `main.mts`:** image name, model, CI wait times, and `sandboxSetup` (commands that run in the container before the agent starts).
3. **`sandbox/bootstrap-site.sh`:** installs a throwaway site with synthetic data. The shipped version is Drupal from config (mirrors the project's CI e2e job). A WordPress or other stack needs its own; keep the contract that it ends with the site answering on `http://127.0.0.1`.
4. **`prompt.md`, Environment section:** how the site is reached, how to create content, which test commands to run and which not to.
5. **`prompt.verify.md`:** fixture advice and the before/after procedure. The `git checkout` + `drush updb/cim/cr` steps are Drupal specific.
6. **CI behaviour:** if branch pushes never get a pipeline, the "no pipeline appeared" fallback is the normal path; if they always do, consider dropping it.
7. **Integration branch:** `--base` is required. Some projects use a different integration branch per epic.

## Running many tickets: the dispatcher

`dispatch.mts` lists the tickets that qualify and starts one detached `main.mts --issue N` run for each, up to a cap on concurrent runs.

```
node .sandcastle/dispatch.mts --base <integration-branch> [--max N] [--dry-run]
```

- **Which tickets:** milestone and labels are in `config.mts`; the rest (assignee, excluded assignees, author, issue type, confidential, search, order, sort, cap, stagger) is in the `SELECT` block at the top of `dispatch.mts`, each commented with an example.
- **Skipped tickets:** any ticket with a running or finished run record, or a `<iid>-*` branch. A failed run is not retried automatically; delete its JSON file from the state dir to retry it. Tickets the ticket graph holds back stay on the board as `queued` with the reason.
- **Capacity:** runs in flight are counted from the board, across all projects sharing the state dir.
- **Logs:** each run writes to `.sandcastle/logs/run-<iid>.log`. Add `logs/` to `.sandcastle/.gitignore`.
- **On a schedule (Linux/systemd):** copy `sandcastle-dispatch.service` and `sandcastle-dispatch.timer` to `~/.config/systemd/user/`, fill in `__NODE__`, `__REPO__` and `__BASE__`, then `systemctl --user enable --now sandcastle-dispatch.timer`. Disable with `systemctl --user disable --now sandcastle-dispatch.timer`. The timer re-arms 15 minutes after each pass finishes, so passes never overlap.

## Ticket graph

Each dispatcher pass works out which tickets can start, so that (a) a ticket doesn't start before the tickets it depends on are merged, and (b) two tickets touching the same files are never in progress at once. The graph lives in the state dir; GitLab issue links are neither read nor written.

- **Manifests.** For each candidate, a read-only `claude -p` (model in `GRAPH.model`; Read, Grep and Glob only) reads the ticket and the code at `origin/<base>` and writes `<stateDir>/graph/<project>--<iid>.json`: what the ticket provides, what it needs that the code doesn't have yet (and which open ticket creates it), and the paths it is likely to change. The analysis runs in a detached worktree under `<stateDir>/worktrees/`.
- **Catalogue.** Blockers can only be open tickets in `TRACKER.milestone`, or in the whole project when no milestone is set.
- **When it re-analyses.** A manifest is cached on a hash of the ticket's title, description and comments; Sandcastle's own comments (marked `<!-- sandcastle -->`) and label changes don't count. A ticket is re-analysed when that hash changes, when a ticket it depends on is edited, or when it needs something nobody provided and new tickets have appeared. At most `GRAPH.maxAnalysesPerPass` per pass. To fix a wrong blocker, edit the ticket text: the next pass re-analyses it.
- **Who can start.** Its manifest is current, every ticket it depends on is closed or has its Sandcastle branch merged into the base, and its paths don't overlap a live run. A run is live from start until its MR is merged or closed, not just until the MR opens. A live run's real diff replaces its predicted paths once the implementer commits. `GRAPH.conflictIgnore` lists paths whose overlap doesn't count. Dependency cycles are broken by ignoring the weakest edge (logged).
- **Implementer finds a missing prerequisite.** It writes `blocked.json` to the evidence dir instead of committing. If every blocker is an open, unmerged ticket, the run moves to `waiting`, its empty branch is deleted, and the dispatcher relaunches it once the blockers are satisfied. Otherwise (no ticket provides it, or that ticket is already merged or closed) the ticket gets `LABELS.needsHuman` and a comment.
- **Before the MR opens.** If the ticket was edited during the run, the MR says it was built from an older version, with the description diff. `git merge-tree` against other live Sandcastle branches lists any exact conflicts in the MR description.
- **`--dry-run`** runs the analysis (it costs model calls) and prints each ticket's decision without launching or touching the board.
- **Tests:** `node --test 'orchestrator/*.test.mts'` (Node 22.18+).

## Not included

No automatic retry of failed runs. Human-written MRs don't hold their files in the conflict check.
