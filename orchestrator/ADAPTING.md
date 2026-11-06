# Orchestrator

`main.mts` takes one GitLab ticket through: branch off an integration branch, implementer run, verifier run (screenshot/video evidence plus a verdict), evidence posted to the ticket, then on PASS push, wait for CI and open an MR into the same integration branch. It never merges and never closes the ticket. Written against `@ai-hero/sandcastle` 0.14.0 with the Docker provider.

```
npx tsx .sandcastle/main.mts --base <integration-branch> [--issue N] [--no-push]
```

## Install into a project

Copy into the project's `.sandcastle/`: `main.mts`, `dispatch.mts`, `prompt.md`, `prompt.verify.md`, `sandbox/`, and `board.mts` + `board.template.html` from `../board/`. Add `evidence/`, `state/`, `board.html` to `.sandcastle/.gitignore`. The image comes from the `sandcastle-setup` skill (needs the GitLab, web runtime, CMS and Playwright layers).

## What is generic

Branching, the two agent runs and the verifier guard (it must not commit, move HEAD or dirty the tree), evidence upload and the ticket comment, the verdict gate, the push/CI/MR step, and the board updates. The container never holds a GitLab token; every GitLab call runs on the host with its own `glab` auth.

## What to adapt per project

1. **`CONFIG` at the top of `main.mts`:** GitLab host, project path and id, the labels an issue needs, image name, model, CI wait times, and `sandboxSetup` (commands that run in the container before the agent starts).
2. **`sandbox/bootstrap-site.sh`:** installs a throwaway site with synthetic data. The shipped version is Drupal from config (mirrors the project's CI e2e job). A WordPress or other stack needs its own; keep the contract that it ends with the site answering on `http://127.0.0.1`.
3. **`prompt.md`, Environment section:** how the site is reached, how to create content, which test commands to run and which not to.
4. **`prompt.verify.md`:** fixture advice and the before/after procedure. The `git checkout` + `drush updb/cim/cr` steps are Drupal specific.
5. **CI behaviour:** if branch pushes never get a pipeline, the "no pipeline appeared" fallback is the normal path; if they always do, consider dropping it.
6. **Integration branch:** `--base` is required. Some projects use a different integration branch per epic.

## Running many tickets: the dispatcher

`dispatch.mts` lists the tickets that qualify and starts one detached `main.mts --issue N` run for each, up to a cap on concurrent runs.

```
node .sandcastle/dispatch.mts --base <integration-branch> [--max N] [--dry-run]
```

- **Which tickets:** edit the `SELECT` block at the top of `dispatch.mts`. Every option (labels, excluded labels, assignee, excluded assignees, author, milestone, issue type, confidential, search, order, sort, cap, stagger) is commented there with an example. Keep `gitlabHost` and `project` in step with `CONFIG` in `main.mts`.
- **Skipped tickets:** any ticket that already has a run record on the board (any stage, including stopped) or a `<iid>-*` branch. A failed run is not retried automatically; delete its JSON file from the state dir to retry it.
- **Capacity:** runs in flight are counted from the board, across all projects sharing the state dir.
- **Logs:** each run writes to `.sandcastle/logs/run-<iid>.log`. Add `logs/` to `.sandcastle/.gitignore`.
- **On a schedule (Linux/systemd):** copy `sandcastle-dispatch.service` and `sandcastle-dispatch.timer` to `~/.config/systemd/user/`, fill in `__NODE__`, `__REPO__` and `__BASE__`, then `systemctl --user enable --now sandcastle-dispatch.timer`. Disable with `systemctl --user disable --now sandcastle-dispatch.timer`. The timer re-arms 15 minutes after each pass finishes, so passes never overlap.

## Not included

No dependency ordering between tickets (blocked-by links are not checked; use an exclude label), no automatic retry.
