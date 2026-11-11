<!-- `factory init` copies this workflow into a project (.sandcastle kept); the personal config runs on pi-claude-subscription models.; one Factory board design polling /api/runs; links the experimental herdr-core spike; `factory dispatch` wraps dispatch.sh, `factory run` uses dispatch.sh --issue, `factory retry` clears a failed run's record, `factory status` shows the board service and each run's stage, and `factory logs` prints run logs. -->
# Orchestrator

> **Experimental, not supported:** attaching to a running agent (herdr-core) was only tested in a spike; see [the report](../docs/research/interactive-agents-herdr-core.md). This workflow still runs its agents non-interactively.


`main.mts` takes one ticket through: branch off an integration branch, implementer run, verifier run (screenshot/video evidence plus a verdict), evidence posted to the ticket, then on PASS push and deliver. It never closes the ticket; once the work is merged, the next dispatcher pass closes a Task or moves a ticket to `LABELS.done` (see below). Written against `@ai-hero/sandcastle` 0.14.0 with the Docker provider.

## Factory-managed board

The optional [Factory CLI](../README.md#install-the-factory-cli) installs a manifest-owned `factory-board` user service. It does not replace the project installation steps or dispatcher timers below. When using it, set `SANDCASTLE_STATE_DIR=$HOME/.local/state/factory` in the dispatcher environment so runs reach its board. Do not also install the legacy board service on port 4444. Existing Sandcastle services and state are only warned about, never migrated.

`factory init` (see the [README](../README.md#projects-factory-project-and-factory-init)) adds the missing minimal workflow files to a project's `.sandcastle` without overwriting customizations, and `factory project` records the checkout. It replaces the manual copy under "Install into a project" but not the environment layers (image, web runtime, CMS, Playwright) from the `sandcastle-setup` skill. `.sandcastle` is kept; a later migration to `.factory` is recorded in the [CLI roadmap](../docs/factory-cli.md#roadmap). The personal profile's models are `model:sonnet` → `pi-claude-subscription/claude-sonnet-5-5` and `model:opus` → `pi-claude-subscription/claude-opus-5-5`, with Opus verification and Sonnet analysis. `config.mts`, `config.personal.mts` and `main.mts` carry `// factory:<tag>` markers that `factory init` fills; keep each exactly once.

## Two reference configs

The code is shared. `config.mts` decides the tracker (`TRACKER.kind`), the agent (`AGENT`) and what happens after the push (`MERGE`).

| | `config.mts`: client and Affinity Bridge work | `config.personal.mts`: personal projects |
| --- | --- | --- |
| Tracker | GitLab via `glab` (`tracker.gitlab.mts`) | GitHub via `gh` (`tracker.github.mts`) |
| Units of work | GitLab Tasks | GitHub sub-issues |
| Agent | Claude Code, `CLAUDE_CODE_OAUTH_TOKEN` in `.sandcastle/.env` | Pi with the `pi-claude-subscription` provider (drives the Claude Code CLI on a subscription): host `claude auth login`, container `CLAUDE_CODE_OAUTH_TOKEN` in `.sandcastle/.env`; no OpenAI login |
| Implementer model | fixed, `AGENT.model` | from the ticket: exactly one of `model:sonnet`, `model:opus` labels, or the ticket isn't started |
| Verifier / analysis model | `AGENT.model` / `GRAPH.model` (`sonnet`) | fixed: `pi-claude-subscription/claude-opus-5-5` / `pi-claude-subscription/claude-sonnet-5-5` |
| After the push | wait for the branch pipeline, open an MR; a person merges | open a PR; merge it once every CI check on the pushed commit passes |
| Evidence images | uploaded to the ticket | committed to the `sandcastle-evidence` branch and linked |

For a personal project, install `config.personal.mts` as `.sandcastle/config.mts` (`factory init --profile personal` does this). Setup:

1. **Host:** `claude auth login`, and install the provider where Pi discovers it and `preflight.mts` looks: `git clone --depth 1 --branch <tag> https://github.com/markdlabrecque/pi-claude-subscription.git ~/.pi/agent/extensions/pi-claude-subscription && cd ~/.pi/agent/extensions/pi-claude-subscription && npm ci --omit=dev --ignore-scripts` (a release tag; v1.6.0 is the one checked here). `pi install git:…` is not used: it runs the package's husky `prepare` hook, which fails. Host analysis loads it with an explicit `-e <extension>/index.ts` next to `--no-extensions`, so no other extension is enabled; the path defaults to `~/.pi/agent/extensions/pi-claude-subscription/index.ts` (override with `FACTORY_PI_SUBSCRIPTION_EXTENSION`).
2. **Container:** the image needs the Claude Code CLI and the extension: use `layers/agent-pi/pi.Dockerfile.snippet`. Sandcastle's Pi adapter runs `pi -p --mode json --model <provider/id>` in the container, and the extension spawns `claude -p`. Nothing from the host's `~/.claude` or `~/.pi` is copied into the image. The CLI authenticates at run time with `CLAUDE_CODE_OAUTH_TOKEN` from `.sandcastle/.env` (`claude setup-token`), which Sandcastle passes to the container. The extension strips `ANTHROPIC_API_KEY`, so the subscription is what is used.
3. **Preflight:** `dispatch.sh` runs `preflight.mts` (`subscriptionPreflight` in `models.mts`): the extension file exists, `claude auth status` is logged in, and `pi --list-models` shows the configured models from the provider, then checks the container token with an empty Messages request. No value is printed or put on a command line; OpenAI is never consulted.

Only two models are used; `main.mts` and `dispatch.mts` refuse to run if `AGENT.model` or `GRAPH.model` is anything else (`models.mts`). A custom Pi config on `openai/` models still works: `main.mts` mints a per-run `OPENAI_API_KEY` from the host's pi login only for such models.

**Ticket writers:** the runtime model comes from the label (`model:sonnet` or `model:opus`). Put the same full ID in the ticket body (`**Pi model:** …`, `**Model label:** …`) for people, but the body alone schedules nothing and is never parsed.

**The CI gate** (`ci.mts`) is deterministic. Sandcastle merges only when at least one check on the PR's head passed and every other one passed or was skipped, and only while the head is still the commit it pushed (`gh pr merge --match-head-commit`). Failed or cancelled checks, no checks within `CONFIG.noPipelineMinutes`, or checks still running after `CONFIG.ciWaitMinutes` mean no merge: the PR becomes a draft with a comment, and the run stops. So CI must run on every PR, with no `paths` filter. Sandcastle merges in code, so no branch protection or GitHub auto-merge setting is needed.

```
npx tsx .sandcastle/main.mts --base <integration-branch> [--issue N] [--no-push]
```

## Install into a project

`factory init` does this for the files below (except `sandbox/`, and with neutral `prompt.md`/`prompt.verify.md`, an empty `sandboxSetup` and `preflight.mts` added). By hand, copy into the project's `.sandcastle/`: `config.mts` (or `config.personal.mts`, renamed to `config.mts`), `main.mts`, `dispatch.mts`, `dispatch.sh`, `graph.mts`, `analyze.mts`, `tracker.mts`, `tracker.gitlab.mts`, `tracker.github.mts`, `ci.mts`, `models.mts`, `manifests.mts`, `preflight.mts`, `prompt.md`, `prompt.verify.md`, `prompt.analyze.md`, `sandbox/`, and `board.mts` + `board.template.html` from `../board/`. Add `evidence/`, `state/`, `logs/` and `board.html` to `.sandcastle/.gitignore`. The image comes from the `sandcastle-setup` skill (needs the tracker, web runtime, CMS and Playwright layers, plus the Pi layer for the personal config). The host needs Node 22.18+, Docker, and on the PATH and logged in: `glab` and `claude` (client config) or `gh` and `pi` (personal config).

The always-on board service uses the same `board.template.html` for the board and evidence previews. Keep `board.mts`, `board-server.mts` and `board.template.html` together when updating the service. There is one Factory design; an Appearance panel picks light, dark or system mode, saved in browser storage. The service also serves `GET /api/runs` (read-only JSON); the HTTP board polls it every 10s and animates changed runs in place instead of reloading, and respects reduced motion. Its sticky navigation links back to the board; evidence opens in the same tab and never polls, so playback is not interrupted. Text previews are limited to 64 KiB, with originals still available. Local `board.html` is a static snapshot that links to evidence folders instead of preview pages. To give an existing project the new board, copy `board.mts` and `board.template.html` again (they hold no project config), and reinstall or restart the board service yourself.

## What is generic

Branching, the two agent runs and the verifier guard (it must not commit, move HEAD or dirty the tree), evidence upload and the ticket comment, the verdict gate, the push/CI/MR step, and the board updates. The container never holds a tracker token; every tracker call runs on the host with its own `glab` or `gh` login.

## What to adapt per project

1. **`config.mts`:** the tracker (GitLab host, project path and id; or GitHub `owner/repo`), the agent and merge settings, the milestone, every label Sandcastle filters on or writes (including `LABELS.done`, the stage a ticket moves to once its work is merged), whether Tasks are the units of work (`SUBTASKS`), and the ticket graph settings. `main.mts` and `dispatch.mts` check at startup that every label exists. From a terminal they offer to create missing ones; declining, or running without a terminal (the timer), quits.
2. **`CONFIG` at the top of `main.mts`:** image name, CI wait times, and `sandboxSetup` (commands that run in the container before the agent starts).
3. **`sandbox/bootstrap-site.sh`:** installs a throwaway site with synthetic data. The shipped version is Drupal from config (mirrors the project's CI e2e job). A WordPress or other stack needs its own; keep the contract that it ends with the site answering on `http://127.0.0.1`.
4. **`prompt.md`, Environment section:** how the site is reached, how to create content, which test commands to run and which not to.
5. **`prompt.verify.md`:** fixture advice and the before/after procedure. The `git checkout` + `drush updb/cim/cr` steps are Drupal specific.
6. **CI behaviour:** GitLab: if branch pushes never get a pipeline, the "no pipeline appeared" fallback is the normal path; if they always do, consider dropping it. GitHub with `MERGE.auto`: CI must run on every PR, or nothing merges.
7. **Integration branch:** `--base` is required. Some projects use a different integration branch per epic.

## Running many tickets: the dispatcher

`dispatch.mts` lists the tickets that qualify and starts one detached `main.mts --issue N` run for each, up to a cap on concurrent runs.

```
.sandcastle/dispatch.sh [--dry-run] [--max N] [--whole-issues]
.sandcastle/dispatch.sh --issue N [--no-push]
```

`dispatch.sh` runs one pass with the defaults: the base is the branch checked out where you run it (it must be on origin). It first checks `node`, the tracker CLI (`glab` or `gh`), the agent CLI (`claude`, or `pi` with the subscription preflight above; a custom `openai/` Pi config checks `pi auth check --provider openai`), `curl` and Docker are there and logged in; that `.sandcastle/.env` exists and its agent credential is accepted (by an empty Anthropic request: `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` for the client config's Claude Code, only `CLAUDE_CODE_OAUTH_TOKEN` for the subscription provider, which strips `ANTHROPIC_API_KEY`; no tokens are used, and no value is printed); and that the `CONFIG.image` image exists and was built for your UID. From a terminal it builds a missing or mismatched image (`npx sandcastle docker build-image --image-name <CONFIG.image>`); without one, as under the timer, it stops and prints that command. It then runs `npm ci` (or `npm install` without a lockfile) when `node_modules/@ai-hero/sandcastle` is missing or older than `package-lock.json`, so a pass never fails on an uninstalled `@ai-hero/sandcastle`. A `factory init` project also has `.sandcastle/factory-dispatch.sh`, which changes to the project root, defaults `SANDCASTLE_STATE_DIR` to Factory's state folder (the caller's value wins) and runs `dispatch.sh` with the same arguments. With the Factory CLI, `factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]` does the same for a registered project (the one you are standing in, or the named one) without `factory-dispatch.sh`: it runs `.sandcastle/dispatch.sh` from the project root against Factory's state folder. `dispatch.sh --issue N` does the same checks, then runs that one ticket now, in the foreground, instead of a pass: `npx tsx .sandcastle/main.mts --base <branch> --issue N`, with any extra arguments (such as `--no-push`) going to `main.mts`; the output also goes to `.sandcastle/logs/run-N.log`, and the exit code is the run's. `--dry-run` and `--max` are refused with `--issue`. `factory run N [--project <name>]` calls it for a registered project, against Factory's state folder; a project with an older `dispatch.sh` (no `--issue`) needs the new copy first. Without `--issue`, extra arguments go to `dispatch.mts`, which can also be run directly: `node .sandcastle/dispatch.mts --base <integration-branch> ...`.

- **Which tickets:** milestone and labels are in `config.mts`; the rest (assignee, excluded assignees, author, issue type, confidential, search, order, sort, cap, stagger) is in the `SELECT` block at the top of `dispatch.mts`, each commented with an example.
- **GitLab Tasks.** With `SUBTASKS.enabled` (the default), a ready issue that has Tasks (its "Child items") is a container: each open Task gets its own run, branch and MR, with the parent's description as context. Ready and exclude labels go on the parent; an exclude label on a Task holds back just that Task. An issue without Tasks is one run, as before. `--whole-issues` (or `enabled: false`) makes every ready issue one run, Tasks or not.
- **Merged work.** Every pass checks the runs whose MR merged into their base: a Task is closed, a whole ticket moves to `LABELS.done` (the ready labels come off; it stays open). A parent moves to `LABELS.done` once every one of its Tasks is closed, however they were closed; it is never closed by Sandcastle.
- **Skipped tickets:** any ticket with a running or finished run record, or a `<iid>-*` branch. A failed run is not retried automatically; delete its JSON file from the state dir to retry it, or run `factory retry <iid> [--project <name>]`, which deletes it only when the run is stopped and warns if a `<iid>-*` branch would still hold the ticket back. Tickets the ticket graph holds back stay on the board as `queued` with the reason; `factory status [--json] [--project <name>]` lists the same records (stage, time in stage, note) in a terminal, with the board service's state.
- **Capacity:** runs in flight are counted from the board, across all projects sharing the state dir.
- **Logs:** each run writes to `.sandcastle/logs/run-<iid>.log`; `factory logs <iid> [-f]` prints (and follows) it from anywhere in a registered project. Add `logs/` to `.sandcastle/.gitignore`.
- **On a schedule (Linux/systemd):** from the project, run `<sandcastle-helper>/orchestrator/install-dispatch.sh` (or pass the repo path, and `--name` if two repos share a folder name). It installs the template units `sandcastle-dispatch@.service` and `.timer` once, writes `~/.config/sandcastle/dispatch/<name>.env` (the repo path, and a PATH that reaches `node`, `glab`, `claude` and `docker`), and enables `sandcastle-dispatch@<name>.timer`. Each project gets its own timer; the base is the branch checked out in that repo. Each timer re-arms 5 minutes after its pass finishes, so a project's passes never overlap, and a random delay of up to 2 minutes keeps projects from reading the shared run cap at the same moment. List them with `systemctl --user list-timers 'sandcastle-dispatch@*'`, read a project's log with `journalctl --user -u sandcastle-dispatch@<name>`, remove one with `install-dispatch.sh --uninstall <name>`. Run `loginctl enable-linger $USER` so timers keep running when you log out. Replaces the old single-project `sandcastle-dispatch.service`/`.timer`; the installer tells you if one is still installed.

## Ticket graph

Each dispatcher pass works out which tickets can start, so that (a) a ticket doesn't start before the tickets it depends on are merged, and (b) two tickets touching the same files are never in progress at once. The graph lives in the state dir; GitLab issue links are neither read nor written.

- **Manifests.** For each candidate, a read-only `claude -p` (model in `GRAPH.model`; Read, Grep and Glob only) reads the ticket and the code at `origin/<base>` and writes `<stateDir>/graph/<project>--<iid>.json`: what the ticket provides, what it needs that the code doesn't have yet (and which open ticket creates it), and the paths it is likely to change. The analysis runs in a detached worktree under `<stateDir>/worktrees/`.
- **Catalogue.** Blockers can only be open tickets in `TRACKER.milestone`, or in the whole project when no milestone is set. With Tasks, an issue that has them is replaced by its open Tasks (even ones outside the milestone), so sibling Tasks can depend on each other and the parent itself is never a blocker.
- **When it re-analyses.** A manifest is cached on a hash of the ticket's title, description and comments (and, for a Task, its parent's title and description); Sandcastle's own comments (marked `<!-- sandcastle -->`) and label changes don't count. A ticket is re-analysed when that hash changes, when a ticket it depends on is edited, or when it needs something nobody provided and new tickets have appeared. At most `GRAPH.maxAnalysesPerPass` per pass. To fix a wrong blocker, edit the ticket text: the next pass re-analyses it.
- **Who can start.** Its manifest is current, every ticket it depends on is closed or has its Sandcastle branch merged into the base, and its paths don't overlap a live run. A run is live from start until its MR is merged or closed, not just until the MR opens. A live run's real diff replaces its predicted paths once the implementer commits. `GRAPH.conflictIgnore` lists paths whose overlap doesn't count. Dependency cycles are broken by ignoring the weakest edge (logged).
- **Implementer finds a missing prerequisite.** It writes `blocked.json` to the evidence dir instead of committing. If every blocker is an open, unmerged ticket, the run moves to `waiting`, its empty branch is deleted, and the dispatcher relaunches it once the blockers are satisfied. Otherwise (no ticket provides it, or that ticket is already merged or closed) the ticket gets `LABELS.needsHuman` and a comment.
- **Before the MR opens.** If the ticket was edited during the run, the MR says it was built from an older version, with the description diff. `git merge-tree` against other live Sandcastle branches lists any exact conflicts in the MR description.
- **`--dry-run`** runs the analysis (it costs model calls) and prints each ticket's decision without launching, touching the board, or closing and relabelling tickets.
- **Tests:** `node --test 'orchestrator/*.test.mts'` (Node 22.18+).
- **Model labels (personal config).** A unit of work without exactly one model label (`model:sonnet` or `model:opus`) stays `queued` on the board with the reason; add the label and the next pass picks it up. On a sub-issue the label goes on the sub-issue.

## Not included

No automatic retry of failed runs. Human-written MRs don't hold their files in the conflict check.
