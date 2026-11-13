<!-- CLI roadmap: slice 4.5's `factory update --dry-run` (#91, cli/src/update.mts) classifies a project's copy and writes nothing, and --apply (#92) creates missing and replaces unedited outdated files; slice two (project registry, init, Pi subscription models) implemented locally; .sandcastle retained, .factory migration deferred; board redesign (#3) implemented; slice three (`factory dispatch`, `run` with `dispatch.sh --issue`, `retry`, `status`, `logs`, and the shared lookup in cli/src/runs.mts) implemented and specified in "Slice three spec"; slice four's scheduler storage (project opt-in and launch configuration, cli/src/schedule.mts) implemented, see "Slice four: scheduler storage"; launch reservations (#32) implemented, see "Slice four: launch admission"; the Linux scheduler (#33: `factory schedule`, factory-tick units, internal `factory tick` in cli/src/commands/tick.mts, tick cancellation in cli/src/tick-cancel.mts; the service manager owns global state) implemented, with the rotating first project (#34), see "Slice four: the Linux scheduler"; the macOS scheduler (#35: the com.factory.tick launch agent running the internal `factory supervise`, cli/src/platform/scheduler-launchd.mts and cli/src/commands/supervise.mts) implemented, see "Slice four: the macOS scheduler"; scheduler health and timings in `factory status` and `schedule status` (#37, cli/src/scheduler-health.mts) implemented; the one-machine cutover runbook (#38) is docs/scheduler-cutover.md, done by hand and rehearsed in cli/test/cutover.test.mts; slice four self-recovery requirements are agreed but unimplemented except its durable recovery state (#55, cli/src/recovery-state.mts) is stored, and atomic capacity/ticket/project claims (#57, claimRun in board/board.mts, cli/src/recovery-claim.mts) exist, kept since #75 in one admission record (board/admission.mts) with ownership receipts (orchestrator/ownership.mts), a remote-only branch fetch and a prerequisite recheck before verification and delivery, and main.mts's verifier, evidence and delivery steps are shared with recovery runs (#58, orchestrator/handoff.mts), and since #61 the tick confirms jams after each completed scheduled pass (shown by `factory recovery status`, summarized in `factory status`, repair logs in `factory logs --recovery`, explicit reset with `factory recovery reset`, #62) and calls the repair launcher (cli/src/jam-detect.mts, graph.mts findJam), which launches only in a project whose complete recovery workflow is unchanged since a recorded review (factory init records it for a new scaffold; existing projects upgrade by hand, then `factory recovery review --confirm`; cli/src/recovery-review.mts, #63, see "Slice four: reviewed recovery workflow"), see "Slice four: recovery state", "Slice four: launch admission" and "Slice four: jam confirmation"; the end-to-end proof that scheduled recovery stays safe across tick restarts, schedule off, crashed repairs and a spent budget, and the zombie-owner fix it found, are in "Slice four: scheduled recovery across restart and failure" (#64); decisions in docs/slice-4/plan.md. -->
# Factory CLI

Status: first and second slices implemented locally, pending PR delivery and real-service verification. Slice three (dispatch, run, retry, status, logs) implemented; see "Slice three spec". Slice four is partly implemented: project opt-in and launch configuration storage, launch reservations, and the scheduler from enable to uninstall on Linux and macOS with a rotating first project (see its "Slice four" sections). Bounded timing history (#36) and scheduler health in status (#37) are implemented. The one-machine cutover runbook (#38, [scheduler-cutover.md](scheduler-cutover.md)) is written and rehearsed against the systemctl stub. Slices five and six remain proposed. Slice four self-recovery scope is agreed; its recovery state store (#55), atomic run claims (#57), the shared verify-and-deliver hand-off (#58), the bounded repair attempt (#60/#74) jam confirmation after scheduled passes (#61) and `factory recovery status|reset` with recovery in `status` and `logs --recovery` (#62) are implemented, but no project can run a repair until its copy has `prompt.recover.md` (#63); see "Slice four: recovery state" and the [plan](slice-4/plan.md).

## Goal

Turn this repo from a set of skills and patterns into a software factory with one command, `factory`, installed in one place and removable in one step. The uninstall must remove every systemd unit and launchd agent that Factory created.

## Principles

- **One install point.** Code, config and state each have one home (see Layout).
- **The manifest is the source of truth.** Every file, unit or agent Factory creates is recorded in `manifest.json` at the moment it is created. Uninstall removes what the manifest lists and nothing else. It never guesses by name patterns.
- **Idempotent.** Running `factory install` twice leaves the same result.
- **Tracer bullet first.** Build the first slice end to end (command, manifest, service, uninstall) before the other commands.
- **No surprises on uninstall.** Config, run history and `.env` files are kept unless `--purge` is passed. Projects are never edited.

## Surface

```
factory install              set up the CLI, write the manifest (the bootstrap script runs this)
factory doctor               check node, docker, glab/gh, claude/pi, logins, linger
factory update               refresh copies inside projects (--dry-run classifies; --apply creates missing and replaces unedited outdated files)
factory uninstall            stop and remove everything in the manifest
    --dry-run                show what would go, touch nothing
    --purge                  also delete config, run state, evidence, images
    --keep-state             (default) keep config and run history

factory init                 in a project: scaffold .sandcastle/ (replaces the workflow copy; environment layers stay in the setup skill)
factory project add|ls|rm    the list of projects Factory looks after

factory dispatch             one pass (--dry-run, --max N, --whole-issues)
factory run <ticket>         run one ticket now
factory retry <ticket>       clear a failed run's record so the next pass retries it
factory status               board service, scheduler health and timings, and every run's stage (--json)
factory logs [ticket] [-f] [--recovery]   a run's (or with --recovery a repair's) log file (newest without a ticket; -f follows)

factory recovery status --project <name>   project recovery state, attempts and reports (--json)
factory recovery reset --project <name>    reset recovery budget and confirmation; launches nothing
factory schedule on|off [--project <name|path>]   the scheduler, or one project's opt-in (Linux)
factory schedule status [--project <name|path>] [--json]   timer, tick, and why each project would or would not run
factory board start|stop|status|open        the always-on board
factory config get|set
```

Every command takes `--json` where it prints data, and exits non-zero on failure.

## Layout

| Path | Holds |
| --- | --- |
| `~/.local/bin/factory` | the command (a symlink into the app dir) |
| `~/.local/share/factory/app/` | the code: `cli/`, `board/`, `orchestrator/`, `skills/` |
| `~/.local/share/factory/manifest.json` | everything Factory created outside its own folders |
| `~/.config/factory/` | config, project list, per-project env files |
| `~/.local/state/factory/` | run records, evidence, logs |
| `~/.config/systemd/user/factory-*` | units (Linux) |
| `~/Library/LaunchAgents/com.factory.*` | agents (macOS) |

Units and agents are renamed from `sandcastle-*` to `factory-*`. `factory install` finds old `sandcastle-*` units, the old `~/.config/sandcastle/` and `~/.local/state/sandcastle/`, and offers to adopt or replace them. It asks before touching any of them.

## Timers

Decided: one `factory-tick.timer` that walks the project list, instead of one timer per project. Reasons: `schedule on|off` is a single switch, uninstall removes one unit, and the shared run cap is enforced in one place. Per-project pause is a flag in the project list, not a unit. Global state is the timer's state in the service manager, not a Factory file. Implemented on Linux; see "Slice four: the Linux scheduler". launchd has no completion-relative timer, so on macOS the single "timer" is one launch agent, `com.factory.tick`, whose supervisor keeps the same cadence itself; see "Slice four: the macOS scheduler".

## Language

Proposed: Node and TypeScript. The repo already requires Node 22.18+, which runs `.mts` files directly (type stripping), so there is no build step. Bash would be less code but is harder to test across systemd and launchd.

## Manifest

`~/.local/share/factory/manifest.json`, written atomically (write to a temp file, then rename).

```json
{
  "version": 1,
  "installedAt": "2026-11-09T12:00:00Z",
  "platform": "linux",
  "entries": [
    { "kind": "file",    "path": "/home/u/.local/bin/factory" },
    { "kind": "dir",     "path": "/home/u/.local/share/factory/app" },
    { "kind": "systemd", "unit": "factory-board.service", "path": "/home/u/.config/systemd/user/factory-board.service" },
    { "kind": "launchd", "label": "com.factory.board", "path": "/Users/u/Library/LaunchAgents/com.factory.board.plist" }
  ]
}
```

Rules:

- An entry is added after the thing is created, and before the next step runs. A crash mid-install leaves a manifest that matches reality.
- Uninstall processes entries in reverse order. Units are stopped and disabled before their files are deleted.
- A missing path is not an error. It is reported as already gone.
- Uninstall refuses to delete a path outside `$HOME`.

## Uninstall behaviour

1. Read the manifest. If it is missing, say so and list any `factory-*` units and `com.factory.*` agents found, but delete nothing without `--force`.
2. Stop and disable every `systemd` and `launchd` entry. Reload the manager afterwards (`systemctl --user daemon-reload`).
3. Delete the unit and agent files.
4. Delete the app dir and the `factory` symlink.
5. Config, state and `.env` files: keep by default, delete with `--purge`. `--purge` also removes Docker images Factory built (identified by a label, `factory.managed=true`).
6. Never edit a project. List each registered project's `.sandcastle/` and print the command to remove it.
7. If linger was enabled (`loginctl enable-linger`), print a note. Factory does not undo it.
8. Delete the manifest last.

`--dry-run` prints steps 2 to 8 as a list and changes nothing.

## Roadmap

1. **First slice** (spec below): install, doctor, uninstall, board service. Tracked in [#1](https://github.com/markdlabrecque/factory/issues/1), including existing implementation and outstanding verification.
2. `factory project add|ls|rm` and minimal `factory init`, tracked in [#2](https://github.com/markdlabrecque/factory/issues/2). Implemented locally: add missing workflow files only; optional environment layers stay in the setup skill. `.sandcastle` retained for this slice. The personal dispatcher uses `model:sonnet` → `pi-claude-subscription/claude-sonnet-5-5` and `model:opus` → `pi-claude-subscription/claude-opus-5-5`, with the provider loaded for implementation, verification and analysis (labels select the runtime model; the ticket body records the same full ID; Opus verifies, Sonnet analyses). Not yet verified: a container image build with the provider and an authenticated sandbox run. See "Slice two spec" below.
3. `factory dispatch`, `run`, `retry`, `status`, `logs`, tracked in [#10](https://github.com/markdlabrecque/factory/issues/10). Implemented: the shared lookup ([#13](https://github.com/markdlabrecque/factory/issues/13)), `dispatch` ([#14](https://github.com/markdlabrecque/factory/issues/14)), `run` with `dispatch.sh --issue` ([#15](https://github.com/markdlabrecque/factory/issues/15)), `retry` ([#16](https://github.com/markdlabrecque/factory/issues/16)), `status` ([#17](https://github.com/markdlabrecque/factory/issues/17)), `logs` ([#18](https://github.com/markdlabrecque/factory/issues/18)) and these docs ([#19](https://github.com/markdlabrecque/factory/issues/19)). One project per command; no timers. See "Slice three spec" below.
4. `factory schedule` with the single tick timer, replacing `install-dispatch.sh`. Implemented so far: project opt-in and launch configuration storage ([#31](https://github.com/markdlabrecque/factory/issues/31)), launch reservations ([#32](https://github.com/markdlabrecque/factory/issues/32)) and the Linux scheduler from enable to uninstall ([#33](https://github.com/markdlabrecque/factory/issues/33)) and its rotating first project ([#34](https://github.com/markdlabrecque/factory/issues/34)), and the macOS scheduler ([#35](https://github.com/markdlabrecque/factory/issues/35)), and bounded timing history ([#36](https://github.com/markdlabrecque/factory/issues/36)), shown with scheduler health in status ([#37](https://github.com/markdlabrecque/factory/issues/37)), and the cutover runbook ([#38](https://github.com/markdlabrecque/factory/issues/38), [scheduler-cutover.md](scheduler-cutover.md)); see "Slice four: scheduler storage", "Slice four: launch admission", "Slice four: the Linux scheduler" and "Slice four: the macOS scheduler" below. Self-recovery is also agreed for this slice but not implemented; see [self-recovery requirements](#slice-four-self-recovery-requirements) and the [slice 4 plan](slice-4/plan.md).
5. `factory update` and project copy refresh.
6. Retire `install-service.sh`, `install-launchd.sh` and `install-dispatch.sh`. Update `README.md`, `orchestrator/ADAPTING.md` and the setup skill (see `AGENTS.md`).
7. Migrate project files from `.sandcastle` to `.factory` in a future slice. Plan runtime path changes, compatibility and safe migration separately; do not rename directories in slice two.

The board redesign from [#3](https://github.com/markdlabrecque/factory/issues/3) is implemented: one Factory operations-console design for board and evidence pages with light/dark/system modes, page and navigation transitions, and live updates from a read-only `GET /api/runs` snapshot patched in place every 10s (no reloads; focus, scroll, filters and media playback preserved; reduced motion respected). A local `board.html` stays a static snapshot. Full implementation plans and Q&A are posted on all three tickets.

---

# Slice four: self-recovery requirements

Status: agreed product scope, being implemented through Factory tickets. Only building blocks are in place (the recovery state store, the launch claim, the shared verification and delivery, the resume check, and the bounded repair attempt with its launcher, owned container and settling; see the sections below) and jam confirmation after every completed scheduled pass (#61, "Slice four: jam confirmation"), which launches a repair only in a project whose copy has the complete recovery workflow, unchanged since a recorded review (#63, "Slice four: reviewed recovery workflow"). `factory init` ships it and records the review for a new scaffold; existing projects stay inactive until upgraded by hand and reviewed. The [slice 4 plan](slice-4/plan.md) records all decisions and acceptance coverage. Implementation must run through prepared Factory tickets, as required by [AGENTS.md](../AGENTS.md).

Factory should recover jammed work without a human deleting run state or branches:

- Reuse the existing dispatcher timer. After normal dispatch, require the same project jam on two consecutive completed passes: eligible queued demand and no active ticket runs.
- Include ready stopped tickets and unresolved dependency holds. Respect explicit exclusions, open PRs awaiting merge, progressing prerequisites and shared-capacity limits.
- Run at most one recovery agent per project inside Docker, using `AGENT.model`. Make the smallest necessary repair on the affected ticket's branch, preserving commits, dirty worktrees and evidence. Stop on ambiguous branch/worktree ownership.
- Give the repair agent 15 minutes after container readiness. Setup, independent verification and delivery retain their normal limits. Cancel timed-out repair processes, preserve work and count the attempt as failed.
- Require normal separate verification and delivery after repair. Host services, credentials, other tickets' branches and remote branch deletion remain outside the helper's authority; it does not merge PRs.
- Allow two repair attempts per unchanged jam episode. Reset only after independently verified delivery progress by affected work, relevant human requirements/label changes, or explicit human reset. The helper's own activity and unrelated queue/base changes must not renew the budget.
- Add project-scoped `factory recovery status` and `factory recovery reset`. Reset refuses active recovery, preserves ticket work/evidence and leaves reevaluation to the normal timer. Keep it separate from `factory retry`.
- Show confirmation, attempts and outcomes through `factory status`, repair logs through `factory logs`, and report/reset details through recovery status. Defer a dedicated recovery board UI.
- Support new scaffolds plus a documented, reviewed manual upgrade for existing projects, preserving customizations. Recovery stays inactive until an existing project's upgrade is complete. Automated scaffold merging is out of scope.
- If a repair requires updating the host's copied workflow, report the action and stop. Do not automatically apply it to the host checkout or restart services.

# Slice four: recovery state

Durable record for self-recovery (#55, `cli/src/recovery-state.mts`). It only stores and checks; it never reads the tracker or launches anything. Since #61 the tick's jam confirmation ("Slice four: jam confirmation") feeds it.

- **File.** `<state>/recovery/<key>.json` per project (`~/.local/state/factory/recovery/`), where `key` is the first 16 hex digits of the SHA-256 of the canonical root, and the file repeats `root`. `{version:1, root, nextSeq, episode?, episodes, budgets, attempts, renewals, watch?}`. Transitions run under an exclusive `<file>.lock` and write temp-file + rename, mode 0600. Missing means empty. A malformed file, or one naming another root, is reported and never overwritten; no attempt can start from it.
- **Episode and confirmation.** A jam is identified by its affected tickets (sorted iids). `observePass` takes only completed dispatcher passes, each counted once by its pass id. The same jam on two consecutive completed passes (`CONFIRM_PASSES`) is confirmed. A pass with a different jam ends the episode (`changed`) and starts a new one; a pass with no jam ends it (`cleared`). Ended episodes are kept in `episodes`. Since #75 a pass can carry the project's admission activity `generation` ("Slice four: launch admission"): a pass at a different generation than the episode's ends it (`changed`) and starts over, so a normal launch between two passes breaks a pending confirmation, and `attemptProblem` refuses an attempt on a jam confirmed at an older generation.
- **Attempts and budget.** `beginAttempt` needs a confirmed episode that includes the ticket, no other attempt running in the project, and budget left; it records a `running` attempt and spends one of the ticket's two attempts (`ATTEMPT_LIMIT`). It is idempotent by attempt UUID: an attempt already recorded is returned without charging again, and `replay` applies an attempt the admission record already admitted (#75) without rechecking it. `finishAttempt` records `repaired`, `failed`, `timed-out`, `blocked` or `interrupted`, with optional reason, log and report paths; the budget stays spent. Budgets are per ticket and survive the episode ending, so the helper's own activity and unrelated queue changes never renew them.
- **Renewal and reset.** `renewBudget` restores one ticket's two attempts after verified delivery progress by that ticket (`progress`) or an attributable human requirement change (`requirement-change`). `resetRecovery` is the explicit project reset: refused while an attempt runs; ends the episode (`reset`), so confirmation starts over on later passes; renews every ticket's budget; keeps history; launches nothing.
- **Tracked renewal** (#56). `watch` keeps, per ticket, the last observed requirement fingerprint and verified delivery: `{seenAt, content, labels, delivery?}`. `observeTicket` takes the ticket's current `content` (the dispatcher's `unitHash`: title, description, parent and comments, leaving out Sandcastle's own and system notes), its `labels` minus those Factory writes itself (the `ready` labels, `needs-human`, the done stage), and `delivery` from `deliveryMarker(run)`: `delivered <mr>` or `merged <mr>` for a `done` record whose verifier passed and whose branch was delivered, nothing for a stopped, failing, unpushed or reserved one. The first observation only sets the baseline. A changed content hash or label set renews a spent budget as `requirement-change` (detail names the change, e.g. `labels +model:opus -model:sonnet`); a new delivery marker renews it as `progress`. Unchanged observations, label order, a repeated delivery and the helper's unverified work renew nothing; a missing marker keeps the last one; an unspent budget only moves the baseline. Since #61 the jam confirmation observes, after each completed scheduled pass, every ticket the dispatcher reports (jammed, or still ready with a stopped or done run).
- **History.** `episodes`, `attempts` and `renewals` keep the newest 100 entries each (`LOG_LIMIT`) for reports. The per-ticket `budgets` counters, not the history, decide whether another attempt is allowed.

# Slice four: resuming recorded work

A repair continues the affected ticket's own work (#59, `cli/src/recovery-workspace.mts`). `resumeTarget(root, run)` reads the ticket's run record and the project's Git state (local refs, origin refs as last fetched, `git worktree list`; no network) and returns the branch, its tip, the evidence folder and any worktree to reuse, or the reason the attempt must not start. It is read-only: it never creates, deletes, checks out or prunes anything. The recovery launcher (#60, `launchRecovery`) calls it before `claimRecovery` and passes the accepted branch on, with the ticket's ownership receipt (#75, below).

- **Accepted.** The branch the record names, shaped `<ticket>-<slug>` as `main.mts` creates it, existing locally, with no other local `<ticket>-*` branch. An origin copy is fine when the local branch already contains it. The branch may be checked out in at most one worktree, inside Sandcastle's worktree folder (`<root>/.sandcastle/worktrees/`) and present on disk; its uncommitted and untracked files are listed so the repair keeps them. With no worktree, Sandcastle checks the branch out afresh. A recorded evidence folder must be the ticket's own `<root>/.sandcastle/evidence/<ticket>`, so prior evidence is reused in place.
- **Refused as ambiguous ownership.** No recorded branch (recovery never creates or guesses one, or restarts from scratch); a recorded branch that is not this ticket's or no longer exists (a branch only on origin is returned with `remoteOnly` instead; see below); a second local branch for the ticket; an origin copy with commits the local branch lacks; the branch checked out in the project's own checkout, in a worktree outside Sandcastle's folder, or in a registered worktree whose folder is missing; another ticket's evidence folder.
- **Ownership receipts** (#75, `orchestrator/ownership.mts`, copied into projects). `<state>/ownership/<projectId>/<ticket>.json` (folders 0700, file 0600, temp file + fsync + rename), with `projectId = sha256(realpath(projectRoot) + "\0" + trackerKind + "\0" + trackerHost + "\0" + trackerProject)`, holds `{projectRoot, gitCommonDir, ticket, branch, base, worktreePath, runId, creationIntent: {branch, worktree, at}, branchSha?, worktreeAt?}`. It is written before anything is created (a normal `main.mts` run before Sandcastle creates its branch and worktree, `runId` being its launch claim token; the launcher before it adds a worktree or creates a branch from origin, `runId` being the attempt UUID), and the identities are filled in as each step completes. With a receipt, `resumeTarget` also requires the same project root and Git common directory, ticket and branch, a branch that still contains the recorded `branchSha`, and a worktree at the receipt's `worktreePath`; an intent with no identity (a crash between the receipt and the creation) is reconciled from Git (`reconcile`, filled in by the launcher), or refused when the branch was never created. Without one (a run stopped before the upgrade), only the exact recorded branch is accepted, with at most the one canonical worktree (`.sandcastle/worktrees/<branch>`) whose Git common directory is the project's; the launcher then writes the receipt (`adopt`). Receipts are never deleted, by `factory retry` or anything else.
- **Remote-only branch** (#75, `fetchRecordedBranch`). When the recorded branch exists only on origin and no claim protects the ticket, the launcher records the intent, then asks origin for exactly `refs/heads/<branch>` (refusing when none or several refs match, since `ls-remote` matches by tail), fetches it into `refs/remotes/origin/<branch>` without `+` (a non-fast-forward update is refused, not forced), checks the fetched commit is the one advertised and contains the receipt's recorded commit, and creates the local branch with `git update-ref refs/heads/<branch> <sha> ""` (only if it does not exist). Then `resumeTarget` runs again.
- Tests: `cli/test/recovery-workspace.test.mts`, against disposable Git repos.

# Slice four: shared verification and delivery

A repaired branch goes through the same hand-off as an implemented one (#58, `orchestrator/handoff.mts`, copied into projects by `factory init`). `main.mts` calls it after its implementer, and `main.mts --recover` (#60) after its repair agent.

- **`runVerifier`** runs the independent verifier in the run's sandbox: `prompt.verify.md`, `AGENT.model`, one iteration, `TIP_SHA` set to the tip being verified. A verifier that commits, moves `HEAD` or leaves the worktree dirty is refused before anything is posted or pushed. First, `beginVerification` deletes an earlier `verdict.md` from the ticket's evidence folder and clears the record's `verdict`, `mr` and `mergedAt`, so on a reused record and evidence folder only this run's verdict counts and a stale PASS never reads as delivery (`deliveryMarker`). Other evidence is kept.
- **`postAndDeliver`** posts the verdict and before/after media to the ticket, then only on PASS pushes the branch, lists conflicts with other live branches and calls the tracker's normal `deliver` with the same CI limits (`CONFIG.ciWaitMinutes`, `noPipelineMinutes`) and merge policy (`MERGE.auto`). It leaves the record `done` with verdict and PR, or returns the reason it stopped (no verdict, not PASS, push or delivery failed), which the caller records as `stopped`. A repaired branch (`origin: {kind: "repaired", attempt}`) says `Repaired by Factory recovery attempt N, then verified independently.` in the evidence comment and the PR; otherwise the text is unchanged.
- Host calls (board, tracker, git) are passed in, so the module imports no config, tracker or board file and is tested with fakes (`orchestrator/handoff.test.mts`). A project copy must take `handoff.mts` together with the new `main.mts`.
- **Prerequisite recheck** (#75, `prerequisiteHold`). A recovery run calls it before verification and again before delivery with the dispatcher's analysis of the ticket (its manifest under `<state>/graph/`): every analysed requirement and implementer-reported blocker that names another ticket must be closed or merged into its base, so a prerequisite with a run in flight or an open PR holds the ticket (the attempt ends `unresolved`, nothing delivered). A missing or out-of-date analysis, or a tracker lookup that fails, is unknown and holds too. Normal runs do not call it.
- Not handled here: a preserved branch whose PR is already open (open PRs are not jams, so a recovery should not reach delivery with one), and merging (still the tracker's `deliver` and `MERGE.auto`). The attempt's outcome is recorded by the launcher (see "Slice four: bounded repair attempts").

# Slice four: bounded repair attempts

One repair attempt on a jammed ticket (#60, continued and verified by #74): `cli/src/recovery-run.mts` on the host; `main.mts --recover`, `orchestrator/recovery.mts` (the attempt lifecycle, `runRecoveryAttempt`) and `orchestrator/recovery-sandbox.mts` (the attempt's own container and Git boundary) in the project's copy; `orchestrator/prompt.recover.md` as the repair agent's prompt. Since #61 the tick's jam confirmation settles the project's attempt after each completed scheduled pass and launches one for a confirmed jam's ticket ("Slice four: jam confirmation"). `factory init` copies `recovery.mts` and `recovery-sandbox.mts` (import-safe; ordinary dispatch is unchanged) and, since #63, `prompt.recover.md`; a repair still needs a recorded review of the copy ("Slice four: reviewed recovery workflow"). The acceptance map against the original #60 requirements is [recovery-60-verification.md](recovery-60-verification.md).

- **Launch** (`launchRecovery(p, {root, tracker, ticket})`). First settles the project's running attempt (refused while it runs or while its container is unconfirmed). Then the ticket's run record must pass `resumeTarget` with its ownership receipt (keyed by the project id from the checkout and the tracker kind, host and project in `.sandcastle/config.mts`; a branch only on origin is first fetched exactly, see "Slice four: resuming recorded work"; a pre-upgrade run's exact branch is adopted into a receipt, and missing identities are filled in from Git) and name a base branch, and the project's `.sandcastle` must have the complete recovery workflow, unchanged since its recorded review ("Slice four: reviewed recovery workflow"). The launcher picks the attempt's UUID and its exact container name, `factory-recovery-<uuid>`; `claimRecovery` then takes capacity, the ticket and the whole project with the attempt's charge in one admission record replacement ("Slice four: launch admission"), recording the attempt with that UUID, container name and its attempt-record path (and the UUID on the run record's `recovery.id`). A missing Factory worktree for the recorded branch is added with `git worktree add` (never a reset), after the receipt records the intent. The launcher writes the host-owned attempt record, `<state>/recovery/attempts/<uuid>.json` (phase `claimed`: ticket, branch, base, recorded tip, worktree, container, evidence and private-Git paths), and spawns `npx tsx .sandcastle/main.mts --issue <t> --base <b> --recover <n> --attempt-record <file>` from the root, detached into its own process group (like a dispatched ticket run, so cancelling a dispatcher pass or `factory schedule off` never reaches it), with `SANDCASTLE_STATE_DIR` set and output appended to `.sandcastle/logs/recover-<t>.log`, and hands the claim to the child's pid at once (`main.mts` adopts it and fences its board writes with the token). A spawn that fails ends the attempt `interrupted` and releases the claim once docker confirms the container absent. A refusal spawns nothing.
- **The attempt** (`main.mts --recover`, `runRecoveryAttempt`). Before any Git or container side effect, the attempt record, the claimed run record and the arguments must name the same project, ticket, branch, base and attempt (number and UUID), the record must still be `claimed` (an attempt never runs twice), and the worktree must be inside `.sandcastle/worktrees/`; `--no-push` is not allowed. The worktree's HEAD must still be the recorded tip (else `ownership-refused`). The input (HEAD, status, staged and unstaged diffs) is snapshotted into this attempt's evidence folder, `.sandcastle/evidence/<ticket>/recovery/<uuid>/`, created fresh with `recovery-context.json`, `previous-run.json`, `previous-logs/`, `history/` (a copy of earlier evidence) and `input/`; earlier `verdict.md`, `blocked.json` and media are never removed. The record says `setup` before the container is created and gets the sandbox id once known.
- **The container** (`recovery-sandbox.mts`). Not Sandcastle's `createSandbox`, whose worktree manager prunes/removes worktrees, fast-forwards an existing branch and mounts the common Git directory writable. `docker run -d --name factory-recovery-<uuid> --label factory.recovery.attempt=<uuid>` with the configured image, uid:gid and `sandboxSetup`; the existing worktree at `/home/agent/workspace`; a read-only gitfile over its `.git` pointing at attempt-private Git metadata (a clone of only the ticket's branch with the worktree's index and staged blobs, no remote); this attempt's evidence folder writable with its snapshots mounted read-only; `.sandcastle/sandbox` read-only. No Docker socket, common Git directory or other evidence; `.sandcastle/.env` values reach the container by name through the docker client's environment, never on its arguments. Agents run the provider's print command with `docker exec`.
- **Repair, report, verification and delivery.** The repair agent (`AGENT.model`, whatever the ticket's model label) gets exactly 900000 ms (`REPAIR_DEADLINE_MS`), started immediately before it runs, after the container is ready and set up, and cleared as it settles; setup, the verifier and delivery keep their own limits. A run that resolves after the deadline or a cancellation fired still counts as `timed-out`/`interrupted`. The agent must write `recovery-report.json` (`cause`, `filesChanged`, `tests[{command,result}]`, `canProceed`, `remainingBlockers`, `requiresHostUpdate`) and `recovery-report.md`: missing, malformed, cannot proceed or blockers left is `unresolved`; `requiresHostUpdate` is `host-followup` (nothing applied, restarted or filed). The report can only stop delivery; the outcome and every host field are Factory's. Uncommitted changes left in the worktree (including pre-existing dirty input the agent did not commit; Factory never commits it) are `unresolved`; the tip must descend from the recorded tip and be beyond the base. A well-formed no-change report verifies the existing tip. Requirements, the ticket's state, the needs-human label and the claim are rechecked before verifying and again before delivering (changed: `unresolved`, not a stale-spec note). Then the shared `runVerifier` (handoff.mts) on the exact tip with this attempt's evidence folder; the container is removed by name and confirmed gone; the repaired tip is imported into the branch only by `git update-ref <branch> <new> <recorded>` (a moved branch is never overwritten; the commits stay in the private metadata); and `postAndDeliver` with `origin: {kind: "repaired", attempt}`. `delivered` is recorded only after delivery succeeds; a failed or ambiguous delivery is `failed` and never retried by the attempt.
- **Timeout, cancellation and cleanup.** At the deadline, or on SIGTERM/SIGINT, the agent's `docker exec` is killed and awaited, then the exact container is removed (`docker rm -f <name>`) and `docker container inspect <name>` must report it gone. No listing, label filter or mount match is used, so no other container is ever touched. Unconfirmed: the record stays `cleanup-pending` with its intended outcome and the process exits non-zero. Commits, the worktree's files, logs and evidence are always kept. SIGTERM exits 143.
- **Settle** (`settleRecovery`). First, any attempt the admission record admitted whose charge never reached the recovery record (a launcher that crashed between the two writes) is recorded, charged exactly once. While the attempt's recovery claim is owned by a live process (pid and start identity; since #64 an owner that exited but was never reaped, a zombie, is not live), the attempt is `running`. Once it is not, the exact recorded container is removed and confirmed gone; if docker cannot confirm it, or the attempt has no recorded container (pre-#74), the attempt stays `running`, its claim keeps the ticket, a capacity slot and the whole project, and no new attempt starts. Then the attempt record decides: `finished` gives its outcome; `cleanup-pending` gives its intended outcome now that the container is gone; any other phase is `interrupted` (crash reconciliation; the run record is left `stopped` with a note that the work is preserved; a death while `delivering` says the delivery outcome is unknown and is not replayed). Only then is the claim released (token-fenced); a crash between finishing the attempt and releasing it is finished by the next settle. Settling never touches branches, worktrees, commits or evidence, and the spent budget stays spent. Outcomes: `delivered`, `unresolved`, `failed`, `timed-out`, `interrupted`, `host-followup`, `ownership-refused` (`repaired`/`blocked` remain readable from older records).
- **Gaps closed by #75** (see the acceptance map): claims live in the admission record, not pid-based run records, and the run record's `hold` is gone; ownership receipts exist and a remote-only recorded branch is fetched; dependency and open-PR prerequisite holds are rechecked before verification and delivery.
- Tests: `orchestrator/recovery-runner.test.mts` (the real runner, adapter, verifier and delivery against a synthetic Git project with a fake docker daemon, script agents and a fake clock), `orchestrator/recovery-entrypoint.test.mts` (the real launcher spawning the real scaffolded `main.mts --recover` through to delivery and settle, with `gh`, `docker` and `@ai-hero/sandcastle` stubbed), `orchestrator/recovery.test.mts` (deadline, late resolution, exact-name cleanup, report and record validation) and `cli/test/recovery-run.test.mts` (launch, identity, crash and cleanup-pending settling). Not tested: real Docker, a real agent CLI or a real tracker.

# Slice four: jam confirmation

After normal dispatch, the scheduler decides whether a project is jammed (#61): `orchestrator/graph.mts` `findJam` (the rule), `orchestrator/dispatch.mts` (the report), `cli/src/jam-detect.mts` `afterPass` and `cli/src/commands/tick.mts` (counting and launching). It reuses the existing tick; there is no recovery timer.

- **The rule** (`findJam`). No jam while any of the project's runs is in flight, the pass launched work, a candidate still waits for analysis, or the shared cap has no free slot: normal work and shared capacity come first. Otherwise the jam is every ready, not excluded ticket whose run record is `stopped` (and whose PR is not open), plus every candidate held only by prerequisites that are themselves in the jam, to any depth (`decide` now names a held ticket's open prerequisites, `waitingOn`). A hold on a prerequisite outside the jam (outside the agent queue, with an open PR, or progressing) is respected and not counted. Explicit exclusion labels, excluded assignees and tickets waiting for a model label are never demand.
- **The report.** The tick gives every scheduled pass a pass id and its own file, `<state>/scheduler/jam/<pass id>.json` (`FACTORY_PASS_ID`, `FACTORY_JAM_REPORT`). A dispatcher pass that is not a dry run writes there, after the board update and before launching, `{version:1, pass, project, at, tickets, reasons | none, observed}`: the jammed tickets with why, or why there is none, and for each jammed or still-ready ticket with a stopped or done run its `unitHash` and labels minus `ready`, `needs-human` and the done stage. Manual passes are not asked for one. The tick removes the file after the pass, and removes any a dead tick left behind.
- **Counting** (`afterPass`). Only a pass that exited 0 and was not cancelled is handed on, after its result and timing are recorded. First `settleRecovery`: while the project's attempt runs, or its container is unconfirmed, the pass is not counted (the attempt holds the project). Then each reported ticket is observed (`observeTicket` with `deliveryMarker` of its run record, so a person's change or verified delivery renews a spent budget), and the pass is counted with `observePass` at the project's admission generation. The same jam on two consecutive completed passes, with no normal admission between them, is confirmed; a pass with no jam ends the episode. A missing report (a dispatcher copy older than #61) is not counted, quietly; one for another pass or project, or a malformed one, is logged and not counted.
- **Launching.** For a confirmed jam, the target is the lowest jammed ticket whose run is `stopped` and that has attempts left (a dependency-held ticket has no work of its own; its stopped prerequisite is repaired). If the project's copy lacks the complete, reviewed recovery workflow (`recoveryCopyProblem`, #63), the jam is only recorded and logged. Otherwise, once the service manager still reports scheduling on and nothing cancelled the tick, `launchRecovery` starts one attempt, detached like ticket runs, and rechecks everything under the admission lock. After it settles, the next pass with the same unchanged jam can start the ticket's second attempt; then the budget stops it until verified progress, a requirement change or a reset.
- Logged to the tick's output as `recovery <project>: …`. What it recorded is shown by `factory recovery status`, summarized in `factory status`, and the repair logs by `factory logs --recovery`; see "Slice four: recovery status and reset". Errors here are logged and never fail the pass or the tick.
- Tests: `orchestrator/graph.test.mts` (the rule), `orchestrator/jam-report.test.mts` (the real scaffolded dispatcher writing a report against a stubbed `gh`), `cli/test/jam-detect.test.mts` (confirmation, inactive copies, stopped scheduling, running attempts, generations, budgets) and `cli/test/scheduler.test.mts` (one report per pass, removed afterwards; failed and cancelled passes not counted).

# Slice four: recovery status and reset

Operator view and explicit reset (#62, `cli/src/commands/recovery.mts`).

- **`factory recovery status [--project <name|path>] [--json]`.** Read-only. Whether recovery is active in the project (`recoveryCopyProblem`: the reviewed workflow, #63), the current jam (its tickets, how many of the two passes have seen it, or when it was confirmed), the running attempt and any recovery claim in the admission record, each ticket's budget (attempts left of two, and the last renewal: `progress`, `requirement-change` or `reset`), the last ten attempts newest first (outcome, start and finish, branch, reason, repair log and retained `recovery-report.md`, each marked `(missing)` if the file is gone), renewals and ended jams. `--json` prints `{version:1, project, recovery}`. A malformed recovery record (never overwritten) is shown as a problem and exits 1.
- **`factory recovery reset [--project <name|path>]`.** Under the admission lock, so it cannot interleave with a launch, it refuses (exit 1, nothing changed) while recovery is active: a running attempt or one whose container is not yet confirmed gone (the next scheduled pass settles it), a recovery claim, or an admitted attempt whose charge is still pending. Otherwise `resetRecovery`: the jam episode ends (`reset`), so confirmation starts over on later completed passes, and every ticket's budget is renewed. It launches nothing; the normal scheduled passes re-evaluate the project. Ticket branches, worktrees, run records, logs, reports and evidence are untouched, and recovery history is kept. It is separate from `factory retry`, which clears one stopped run.
- **`factory status`** adds a `Recovery:` line after the project's schedule (active or inactive, and the jam), the running attempt, the last finished attempt and its outcome, and tickets with spent budget; `--json` adds `recovery` (the same summary as `recovery status --json`).
- **`factory logs [ticket] --recovery`** prints `.sandcastle/logs/recover-<n>.log` (every attempt on the ticket appends to it), or the project's newest one without a ticket; `-f` follows as for run logs.
- Tests: `cli/test/recovery-command.test.mts`.

# Slice four: reviewed recovery workflow

The gate on self-recovery (#63, `cli/src/recovery-review.mts`). No automatic scaffold merging: that is slice five.

- **Workflow.** `main.mts` (with `--recover` and `--attempt-record`), `recovery.mts`, `recovery-sandbox.mts`, `handoff.mts`, `ownership.mts`, `admission.mts`, `board.mts`, `prompt.recover.md` and `prompt.verify.md` in the project's `.sandcastle`. `config.mts` is project configuration and is not part of it.
- **Review record.** `<state>/recovery/<key>.review.json` (same key as the recovery record, mode 0600, temp file + rename): `{version:1, root, reviewedAt, by: init|review, files: {name: sha256}}`. It is host-owned and never in the project, so an agent cannot write it.
- **Gate.** `recoveryCopyProblem(p, root)` is null only when every workflow file exists, `main.mts` has `--attempt-record`, and every file's hash equals the review's. Otherwise it names what is missing, that no review exists, or which files changed since the review. Jam confirmation, `launchRecovery`, `factory recovery status` and `factory status` all use it.
- **New scaffolds.** `factory init` copies `prompt.recover.md` with the rest. When that run created every workflow file, it records the review (`by: init`). If any already existed, it records nothing and says recovery is inactive.
- **Existing projects.** Upgraded by hand ([ADAPTING.md](../orchestrator/ADAPTING.md#upgrading-an-existing-project-for-self-recovery)), then `factory recovery review [--project] [--confirm]`. Without `--confirm` it is read-only: each file is missing, the same as Factory's copy, different from it, or project-specific (`main.mts`), and whether it changed since the review. `--confirm` refuses an incomplete copy and otherwise records the files as they are now; it launches nothing.
- Tests: `cli/test/recovery-command.test.mts` (review), `cli/test/init.test.mts` (new and existing scaffolds).

# Slice four: scheduled recovery across restart and failure

The end-to-end proof of the scheduled recovery path (#64): `cli/test/recovery-schedule.test.mts`. Every tick is its own process (`cli/test/fixtures/tick-recovery.mts`, which is `factory tick` with only the repair command swapped for a stand-in) against the stateful `systemctl` stub, so only Factory's files carry over between ticks. The dispatcher is a real `dispatch.sh` reporting a jam on a stopped ticket with a preserved branch, dirty worktree and evidence. Jam confirmation, `launchRecovery`, `settleRecovery`, `factory schedule off|on` and `factory recovery review|reset` are the real code; `docker` is a stub that accepts only exact-name `rm -f` and `container inspect`. In one sequence it shows:

- One completed pass only sees a jam. A tick killed mid-pass, after its dispatcher wrote a report, never counts that pass; the next tick clears its leftovers. The next completed pass confirms the jam and starts exactly one repair, detached in its own process group, which outlives the tick and owns its recovery claim.
- `factory schedule off` while a later tick's pass runs cancels that tick (exit 143) and pass only. The repair keeps running and keeps its claim; the cancelled pass is not handed to recovery; a tick while off launches nothing. Back on, passes are not counted while the repair runs.
- A repair that crashes while docker cannot confirm its exact container gone keeps the attempt `running` and the claim on the ticket, a slot and the project, tick after tick. Once docker confirms it gone, the attempt settles `interrupted` and the unchanged jam gets its second attempt.
- After the second attempt fails, repairs stop on the spent budget across later ticks, and the claim is released. `factory recovery reset` launches nothing; confirmation starts over on the next two completed passes, which start a third attempt.
- Throughout, the ticket's branch tip, uncommitted work and earlier evidence are unchanged, docker only ever named the attempts' own containers, and no `systemctl` or `docker` call was rejected.

Finding fixed: a repair process that crashed while its parent never reaps children (for example a container whose PID 1 does not reap) stayed a zombie, which `ownerState` read as a live owner, so the attempt never settled and held the project indefinitely. `processStart` (`board/admission.mts`) now treats a zombie as gone, on Linux from `/proc/<pid>/stat` and elsewhere from `ps -o stat=`. Project copies of `admission.mts` from before #64 show as `differs from Factory's copy` in `factory recovery review`; the host's settle step always uses Factory's own copy. Test: `cli/test/recovery-claim.test.mts`.

Not proven here: systemd's timer, real Docker, `main.mts --recover` itself (`orchestrator/recovery-entrypoint.test.mts` covers it), a real agent or tracker, or macOS launchd (the launcher and settle step are the same code there).

# Slice four: scheduler storage

Storage and opt-in contracts (`cli/src/schedule.mts`); `factory schedule` changes them and the tick reads them (see "Slice four: the Linux scheduler").

- **No global switch.** Factory stores no on/off flag. Scheduling is on when the service manager reports `factory-tick.timer` enabled and active; a `scheduler.json` left by earlier builds is ignored. A failed query is `unknown`, which blocks scheduled work like off does.
- **Launch configuration.** `~/.config/factory/schedule.json`, `{"version":1,"path":string,"node":string}`, written atomically (mode 0600) by `schedule on`. PATH only, and an absolute Node. Missing means nothing was saved (not that the timer is off); malformed or unsupported content is reported and never replaced. Members from earlier builds, such as `enabled`, are dropped.
- **Project switch.** The optional `schedule: {enabled, branch, since}` on a registry entry, written under the registry lock. Missing means off, so `project add` (and a re-add after `rm`) starts off. `setProjectSchedule(root, true)` requires a registered, present checkout with a branch checked out (no detached HEAD) and an `origin` remote that has that branch as of the last fetch (no network call), then saves the branch. `false` keeps the saved branch and stores nothing for a project never opted in. An entry with a malformed `schedule` makes the registry unsupported. `copyProblem(root)` is the second gate (`schedule on --project` and every tick): `dispatch.sh` present and executable, and a `.sandcastle` copy that has `reserveRun` (#32).
- **Why not.** `scheduleBlocker(scheduling, project, exists, branch)` returns null when a scheduled pass may run, else the first of: `scheduler is off (<reason>)`, `scheduler state unknown (<reason>)`, `project not opted in`, `project paused`, `checkout missing`, `checkout is on <x>, scheduled branch is <y>`. Scheduled work never switches branches.
- **Tick observations.** `<state>/scheduler/state.json` (`cli/src/schedule-state.mts`): `{version:1, nextRoot?, startedAt?, finishedAt?, durationMs?, pid?, currentRoot?, projects: {<root>: {attemptedAt, finishedAt?, durationMs?, pid?, result, reason?, exitCode?}}}`, `result` one of `running|ok|skipped|error|interrupted`. It records what ran and is never a switch. Only the tick that holds the lock writes it. A malformed file stops the tick and is left alone. `nextRoot` is the project that goes first next tick (see "Tick").
- **Timing history.** `<state>/scheduler/history.json` (`schedule-state.mts`): `{version:1, entries:[...]}`, oldest first, at most `HISTORY_LIMIT` (1000) entries, the oldest dropped on append. `{kind:"pass", tick?, root, name?, startedAt, finishedAt?, durationMs?, pid?, result: ok|error|interrupted, exitCode?, reason?}` is added when a pass ends (including a cancelled one, and one whose leftover group is unconfirmed), `tick` being its tick's `startedAt`. `{kind:"tick", startedAt, finishedAt?, durationMs?, pid?, result: done|failed|interrupted|off|unknown, reason?}` is added when a tick that took the lock ends (`off`/`unknown` when the manager stopped it mid-tick). Durations are monotonic. A tick or pass that died, or was killed by `cancelTick`, is added as `interrupted` by `markInterrupted` (the next tick or the cancellation) without an invented finish or duration, and only once. Skipped projects and ticks that never took the lock are not history. Appends are best effort: a malformed file is logged (`timing history not recorded: …`), left alone and not appended to, and never stops a tick or cancellation. It is observation only; nothing reads it as a switch or timeout. Shown by `factory status` and `schedule status` (see "Scheduler health").
- `factory project ls` shows `[scheduled: <branch>]` or `[schedule paused]`; `--json` rows carry `schedule` when set.

Tests: `cli/test/schedule.test.mts`.

# Slice four: launch admission

The three-slot cap (`SELECT.maxConcurrent` in `dispatch.mts`) is counted from the shared board. A dispatched `main.mts` writes its first record only after its tracker calls and fetch, so without more a pass that followed closely (the next project in a scheduled tick) could miss the runs just launched and overfill the cap, or launch the same ticket twice.

- **Reservation.** As it spawns each run, `dispatch.mts` calls `reserveRun()` (`board/board.mts`): the record gets stage `setup`, note `starting`, `starting: true` and the child's pid. It counts against the cap and holds the ticket and its files like any run in flight.
- **Hand-over.** `main.mts`'s first write clears `starting` and takes over the record with its own pid; from then on a dead process means a stopped run, as before. Since #75 it first adopts the launch claim the record carries (`adoptClaim`), refusing to start if that claim was superseded.
- **Unstarted launch.** If the reserved pid exits while `starting` is still set (the run failed before it began), `readRuns()` deletes the record and `factory status` skips it, so the next pass retries the ticket as it did before reservations.
- **Admission record** (#75, `board/admission.mts`, copied next to `board.mts` by `factory init`). `<state>/admission/state.json` (folder 0700, file 0600, version 1; temp file, fsync, rename, folder fsync) holds every claim by run key (`{token, project, iid, kind: normal|recovery, owner: {pid, start}, at, attempt?}`), each project's activity `generations`, and per project the recovery attempts `admitted` and any `pending` charge. All changes run under one short lock across all projects, `<state>/admission/lock`, created complete (temp file hard-linked into place) with its holder's pid and start identity; it is taken over only when that exact process is gone (pid exited, including one left as an unreaped zombie since #64, or reused by a process started at another time), never by age or a live pid alone, and an unreadable lock is never taken over. A corrupt or unknown-version record fails closed: nothing is admitted, and it is never overwritten. Reading it (`readAdmission`, status, `factory retry`) never writes.
- **Atomic claim** (#57, through the admission record since #75). Before spawning, `dispatch.mts` claims each launch with `claimRun()` (`board/board.mts`). Under the admission lock it counts live claims and in-flight run records across every project, refuses when the cap is already reached, the ticket already has a claim or a run in flight, or a recovery claim holds the project, then commits a `normal` claim (owned by the pass's pid; the project's generation goes up by one) and only then writes the reservation, carrying the token as `claim`. `reserveRun` hands the claim to the spawned child, `main.mts` adopts it, and a launch that fails to spawn releases it (`removeRun`). A normal claim ends when its run reaches a terminal or parked stage, or when its owner is gone. A refused claim launches nothing: no capacity ends the pass's launches, an owned ticket is skipped. Dispatcher copies older than `claimRun` still reserve after spawning and do not take the lock.
- **Token fencing** (#75). A process that holds a claim (`adoptClaim`, `holdClaim`) writes its record only while the record still carries its token, so a stale heartbeat or exit handler never overwrites a newer claim's record, and it releases only its own token.
- **Activity generation** (#75). Every normal admission advances its project's generation (`generationOf`). The jam confirmation (#61) passes it to `observePass`, so a normal launch between two passes breaks a pending confirmation, and `claimRecovery` refuses a jam confirmed at an older generation.
- **Recovery claim** (#57, admission record since #75, `cli/src/recovery-claim.mts`). `claimRecovery` takes, under the same lock, a slot under the cap (default 3), the affected ticket and its whole project (refused while any other run of the project is in flight): first it replays any pending charge of the project, then after the shared checks and `attemptProblem` it commits the `recovery` claim (with the attempt UUID) and the charge (`admitted` + 1, a `pending` entry) in one replacement, then applies the charge with `beginAttempt` (idempotent by UUID) and clears `pending`, then writes the ticket's record. A crash between the replacement and `beginAttempt` is replayed by the next claim or settle without charging twice or refunding. A refusal changes neither the board, the admission record nor the recovery record. The record becomes a reservation with `recovery: {attempt, id, from: {stage, note, stageSince}}`, keeping its branch and evidence, and without `starting`. A recovery claim holds the ticket, a capacity slot and the whole project whatever its record's stage or process, and is released only by `settleRecovery` after the attempt's exact container is confirmed gone. Only the tick's jam confirmation (#61) launches a repair.
- Manual starts (`factory run`, `dispatch.sh --issue`) take no reservation and are not held to the cap; they still count once running.

Tests: `board/board.test.mts` ("a launched run counts as active before its child writes", "claims are atomic") and `cli/test/recovery-claim.test.mts` (claim plus charge with a crash in between, cross-process races, token fencing, the activity generation, lock takeover and fail-closed records).

# Slice four: the Linux scheduler

`cli/src/commands/schedule.mts`, `cli/src/commands/tick.mts`, `cli/src/tick-lock.mts`, `cli/src/tick-cancel.mts`, `cli/src/platform/scheduler.mts`, `cli/src/platform/scheduler-systemd.mts`, `cli/templates/factory-tick.{service,timer}`.

- **Backend.** `ScheduleBackend` (`platform/scheduler.mts`) has `install(spec, record)` (writes the units, starts nothing), `enable()`, `disable()`, `status()` and `remove(entry)`. `status()` returns `{timer: active|inactive|missing, enabled, tick: active|inactive|missing, lastTick?}`. The timer's enablement (`UnitFileState`) and activity are read apart from the tick service's activity. A failed or unparseable `systemctl` call throws, and callers show `unknown`. Each backend also names the `files` it writes and a `logHint`. macOS has its own backend (next section); other platforms refuse. The commands issued are `show`, `daemon-reload`, `enable --now` and `disable --now` on `factory-tick.timer`, `stop` on `factory-tick.service`, and per-unit `stop` and `disable` in `remove`.
- **`factory schedule on`** requires the manifest (`factory install`), refuses tick unit files it does not own, saves PATH and Node to `schedule.json`, writes `factory-tick.service` then `factory-tick.timer` (each recorded in the manifest as soon as it is written), daemon-reloads, and runs `enable --now factory-tick.timer`. The service is `Type=oneshot` running `node <app>/cli/bin/factory.mts tick`, with the saved PATH, `FACTORY_HOME`, `SANDCASTLE_STATE_DIR`, journal output, `KillMode=process` (systemd signals only the tick itself), `TimeoutStartSec=infinity` (no dispatcher timeout) and `TimeoutStopSec=2min` (room for cancellation). The timer is `OnActiveSec=1min` and `OnUnitInactiveSec=5min` with `Persistent=false`, so missed ticks are not replayed. If install or enable fails, the ledger stays and the error carries the state systemd reports now. Repeating `on` retries, and also rewrites the units and refreshes PATH and Node.
- **`factory schedule off`** is `stopScheduling`: `disable --now factory-tick.timer`, then `stop factory-tick.service` (which waits), then `cancelTick` confirms the recorded tick and pass group are gone. A failure at any step stops there with the files kept, and running `off` again retries.
- **Cancellation** (`tick-cancel.mts`). The tick lock file (`<state>/scheduler/tick.lock`, JSON) records the tick's pid and kernel start time and, once spawned, the pass's pid and start time. The pass is spawned with `detached: true`, so it leads a new process group whose id is its pid. Everything non-detached below it (shell, `npx`, ticket analysis) is in that group. Ticket runs that `dispatch.mts` launches are detached into their own groups. Factory signals only the recorded tick pid and `-<pass pid>`, after checking they are still those processes by start time, and never group 1 or its own. `cancelTick` sends the tick SIGTERM and waits `grace + confirm + 2s`, since the tick cancels its own pass. Then it sends SIGKILL to the tick. If the pass group is still alive it sends SIGTERM to the group, waits 30 s (`DEFAULT_GRACE_MS`), sends SIGKILL to the group, and waits 5 s (`CONFIRM_MS`) for it to vanish. Zombies do not count as alive. The deadline applies to cancellation only: nothing times out a pass that is running normally. If a pass leader exits while non-detached members of its group are still alive (a backgrounded job, or a child orphaned when the dispatcher died mid-analysis), the tick keeps ownership recorded until it has terminated that group the same way (SIGTERM, grace, SIGKILL, that group only), logs it, and records the reason on the project (`left processes running in its process group, terminated`). That is cleanup after the pass ended, not a pass timeout, and it keeps ownership from being dropped while an owned process lives; if the group cannot be confirmed gone the lock stays and no pass starts over it. `off`, uninstall and reinstall report what they observed: the tick the manager said was running (even when its stop already cancelled it and left no lock), the project whose pass became `interrupted`, a pass that had already finished on its own (named as finished, never as cancelled), or that the manager could not be read. When a leftover group cannot be confirmed gone, state.json keeps what the leader did (`ok` or `error` by its exit code, with exit code, finish time and duration) and a reason naming the live group; `interrupted` is kept for cancellations that were requested. Unconfirmed cancellation throws and keeps the lock. A lock whose tick is dead but whose pass group lives is never reclaimed, so no second pass starts over it, and the next `off` cancels it. The tick's own SIGTERM/SIGINT handler does the group part (`terminateGroup`), records the pass `interrupted`, starts no later project and exits 143.
- **`factory schedule on|off --project <name|path>`** takes a registered name, a path in the checkout, or the recorded root of a deleted checkout. It sets the project switch and never touches the timer. `on` refuses a project that fails `optInProblem` or `copyProblem` and never refreshes the copy itself. Without `--project` the command is global, even inside a checkout. `--json` is for `status` only. A positional project is rejected.
- **Tick** (`factory tick`, internal, no flags). It asks the manager (`on` means timer enabled and active) before the lock, after it and before each project. Off ends it with exit 0, and unknown (query failed) with exit 1. A live holder, or a dead holder's live pass group, makes it log and exit 0. Missing or malformed launch configuration, registry or state stops it with an error. It visits the whole registry in order, rotated to start at the first opted-in, unpaused project at or after `nextRoot` (the top when `nextRoot` is unset or unregistered); before any pass it saves `nextRoot` as the next opted-in, unpaused project after that one, so the turn advances even when the tick fails, is cancelled or dies, and projects not opted in take no turn. It then, for each project that `scheduleBlocker` and `copyProblem` clear, runs `dispatch.sh --max 3` from the root through `runDispatchSh` (options `group`, `env`, `onSpawn`) with `FACTORY_SCHEDULED=1`, the saved PATH and `SANDCASTLE_STATE_DIR` set to Factory's state folder whatever the caller set. Other projects log `skip <name>: <reason>`. Stdin is inherited. State is saved before spawn (`running`), at spawn (pid) and after (`ok` or `error`, exit code, UTC finish, monotonic duration). A dead tick's `running` entries become `interrupted` without a finish time. Each pass's end and the tick's end are also appended to the timing history (see "Slice four: scheduler storage"). Exit codes: 0 done, 1 a pass failed, 143 cancelled. The current dispatcher ignores `FACTORY_SCHEDULED=1`; Factory passes it as the ticket specifies.
- **`factory schedule status [--project] [--json]`** prints the manager's state (enabled, timer activity, tick activity; `unknown` when the query fails), the last trigger, the last tick and tick timings, health problems, enabled legacy dispatcher timers, and each project's switch, `scheduleBlocker` reason or `ready`, last pass result and pass timings. `--json` adds `scheduler.lastTick`, `scheduler.ticks`, `scheduler.problems` and `projects[].timings`.
- **Scheduler health** (`cli/src/scheduler-health.mts`, #37), shared by `factory status` and `schedule status`. Read-only: one manager query plus state.json, history.json and schedule.json. `schedulingFrom` gives on/off/unknown by the tick's own rule; the phase is `running` (a tick is active), `waiting` (on, no tick), `off` or `unknown`. Problems: the manager can't be read (scheduled work is blocked), the job is enabled but not running, or running but disabled, a malformed state, history or launch configuration file (reported, left alone, never an error), no launch configuration while the job is installed, and an overdue tick (on, no tick running, nothing started or finished for two 5-minute intervals). Timing summaries are `{count, timed, lastMs?, medianMs?, p90Ms?, maxMs?, results}` over the history's entries (percentiles by nearest rank; interrupted entries have no duration and are only counted). `factory status --json` adds `scheduler: {state, reason?, phase, enabled, timer, tick, loaded?, lastTick, ticks, problems, legacyTimers, logHint}` and `schedule: {switch: on|paused|off, branch?, blocker, last, timings, recent}` (the project's five newest passes, newest first). Tests: `cli/test/status.test.mts`, and the status test in `cli/test/scheduler.test.mts`.
- **`factory doctor`** checks the manager once the units are in the ledger. Enabled and active passes, enabled but stopped fails, running but disabled warns, an unreadable manager fails, and off is information. It warns about enabled legacy `sandcastle-dispatch` timers (`~/.config/systemd/user/timers.target.wants/`). Nothing disables them automatically; the developer does, following the [cutover runbook](scheduler-cutover.md) (#38), rehearsed by `cli/test/cutover.test.mts`.
- **`factory uninstall`** stops scheduling first, then removes ledgered entries in reverse, routing scheduler units to the schedule backend and the rest to the board adapter. `--dry-run` makes no manager call and sends no signal. **`factory install`** over a ledger with scheduler units stops scheduling first, rewrites the owned units from the saved configuration and leaves the timer disabled.

Trusted, not tested: systemd's timer firing and rearming, journald, and its delivery of signals under `KillMode=process`. Tests: `cli/test/schedule-linux.test.mts` (real CLI and production adapter against `cli/test/stubs/systemctl`, synthetic process trees) and `cli/test/scheduler.test.mts` (in-memory `FakeSchedule`); see `TESTING.md`.

# Slice four: the macOS scheduler

`cli/src/platform/scheduler-launchd.mts`, `cli/src/commands/supervise.mts`, `cli/templates/com.factory.tick.plist`. Everything else (`factory schedule`, the tick, the lock, cancellation, the state file, install, uninstall, doctor) is shared with Linux.

- **One launch agent.** `~/Library/LaunchAgents/com.factory.tick.plist` runs `node <app>/cli/bin/factory.mts supervise` with the saved PATH, `FACTORY_HOME` and `SANDCASTLE_STATE_DIR`, `RunAtLoad`, `KeepAlive` `{SuccessfulExit: false}` (restart after a crash only), `AbandonProcessGroup` (launchd signals only the supervisor; passes and ticket runs are in their own groups anyway), `ExitTimeOut` 120 s (room for cancellation), `ProcessType` Background, and output to `<state>/scheduler/tick.log`. No `StartInterval` and no timeout.
- **The supervisor** (`factory supervise`, internal, no flags) runs the ticks in its own process: it waits one minute after it starts, runs a tick, then waits five minutes after that tick finished, and so on, so ticks never overlap and missed ones are not replayed. A tick that fails or throws is logged and the cadence continues. It keeps no on/off state, file or restart marker: each tick asks launchd itself, exactly as on Linux. On SIGTERM or SIGINT a wait ends at once and no tick starts; a running tick cancels its pass group (`terminateGroup`), starts no later project and records the pass `interrupted`; then the supervisor exits 0, so KeepAlive does not restart it.
- **Backend** (`LaunchdSchedule`). launchd is the authority, read as three separate observations: enablement (`launchctl print-disabled gui/<uid>`; `disabled`/`enabled`, or `true`/`false` on older macOS), loaded (`launchctl print gui/<uid>/com.factory.tick` succeeds; exit 113 means not loaded) and running (`state = running`). The domain is checked first (`launchctl print gui/<uid>`), so an unreachable launchd is `unknown`, never "not loaded", and output that does not parse throws. `status()` maps them to `{timer: active (running) | inactive | missing (no plist, not loaded), enabled, loaded, tick}`, with `tick` active while a live tick holds the tick lock. Scheduling is on when the agent is enabled and running.
- **`schedule on`** saves PATH and Node, then `install`: `launchctl disable` first when the agent is not loaded (so a plist on disk never loads by itself at the next login), then writes and ledgers the plist (`{kind: launchd, label: com.factory.tick}`). Then `enable`: `launchctl enable`, then `bootstrap gui/<uid> <plist>` when not loaded or `kickstart` when loaded but not running. A running supervisor is left alone, so repeating `on` never cancels a tick; the PATH passes get is read from `schedule.json` at every tick, but a new Node takes effect only after `off` and `on`. A failed step keeps the ledger and reports what launchd says now.
- **`schedule off`** (`stopScheduling`): `launchctl disable` before anything is signalled, then `launchctl bootout`, which SIGTERMs the supervisor and waits for it, then `cancelTick` confirms the tick and pass group are gone, exactly as on Linux. A disabled label is also what any tick still starting sees, so it starts no pass. A failed disable signals nothing; a failed bootout or unconfirmed cancellation fails `off` and keeps every file.
- **Uninstall and reinstall** stop scheduling the same way first. `remove` boots out a still-loaded agent and deletes only the plist; the label stays disabled. Reinstall rewrites the plist and leaves the label disabled and unloaded.
- **Status** shows `Supervisor (launchd com.factory.tick): enabled|disabled, loaded|not loaded, running|not running; …`, with `loaded` also in `--json`, and the log hint `tail -f <state>/scheduler/tick.log`.

Trusted, not tested: launchd loading agents at login, honouring `KeepAlive`, `ExitTimeOut` and `AbandonProcessGroup`, and writing the log file. Tests: `cli/test/schedule-macos.test.mts` runs the production adapter, the generated plist and a real supervisor process (`cli/test/fixtures/supervisor.mts`, the same code with a short first delay) against `cli/test/stubs/launchctl`, which models enablement, loaded and running separately and, for `bootout`, sends the registered job process SIGTERM and waits, as launchd documents. No real macOS trial is required.

---

# Slice three spec

Run and watch one project's work from `factory` instead of calling `.sandcastle/dispatch.sh` by hand. The commands wrap the scripts each project already has, so its checks and run behaviour stay the same; the checks are not moved into TypeScript.

## Project and run lookup

`cli/src/runs.mts`, shared by every command below.

- **Project.** `--project <name>` (a registered name, or a path inside a registered checkout; a name several projects share must be given as a path), else the registered checkout the current directory is in. Anything else fails and names the registered projects. The project must have `.sandcastle/config.mts`; its `TRACKER.project` is the name its run records carry.
- **Run records** come from `SANDCASTLE_STATE_DIR` when set, else `~/.local/state/factory` (as `factory-dispatch.sh` does). A run whose process is gone without finishing reads as `stopped`, without its record being rewritten.
- **Run log** is `.sandcastle/logs/run-<ticket>.log`, where `dispatch.mts` and `dispatch.sh --issue` write it.

## `factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]`

Runs the project's own `.sandcastle/dispatch.sh` from its root with those flags (`--max` must be a positive whole number) and `SANDCASTLE_STATE_DIR` set to the run-state folder above, streams its output and exits with its code.

## `factory run <ticket> [--project <name>]`

Runs the project's `.sandcastle/dispatch.sh --issue <ticket>` the same way. `dispatch.sh` does its usual checks, then runs `main.mts --issue <ticket>` in the foreground instead of a pass, writing the output to the terminal and to the run log; the exit code is the run's. `dispatch.sh` refuses `--dry-run` and `--max` with `--issue`. A project whose `dispatch.sh` copy predates `--issue` is refused with a message to copy the new one in (refreshing copies is slice five).

## `factory retry <ticket> [--project <name>]`

Deletes the ticket's run record, the same as deleting the JSON file by hand, only when its stage is `stopped` (including a run whose process is gone). `done`, live, `queued` and `waiting` runs and a ticket without a record are refused with the reason. It never deletes branches, logs or evidence; it warns, with the command to delete it, when a `<ticket>-*` branch exists locally or on origin (as last fetched), since the dispatcher skips such a ticket. Since #75 it also refuses a stopped card that an admission claim protects: any recovery claim (held until the attempt's container is confirmed gone), a launch claim whose owner may still run, or an admission record it cannot read (unknown). It keeps the ticket's ownership receipt.

## `factory status [--json] [--project <name>]`

Prints the board service's state (`active`, `inactive`, `missing`, or `unknown (<reason>)` when the service manager can't be asked) and URL, then each of the project's run records, oldest first, with stage, time in that stage, title, branch, verdict, PR and note; a dead process reads as `stopped`. `--json` prints `{version:1, project:{name,root,tracker}, board:{service,url}, runs:[...]}`, the runs being the records plus their `key`. Since slice four (#37) it also shows scheduler health and this project's schedule and pass timings, between the board line and the runs, and `--json` adds `scheduler` and `schedule`; see "Scheduler health" under "Slice four: the Linux scheduler". Since #62 it also summarizes self-recovery and `--json` adds `recovery`; see "Slice four: recovery status and reset". The service and schedule backends are passed in, so tests use the fake ones.

## `factory logs [ticket] [-f] [--recovery] [--project <name>]`

Prints the ticket's run log, or the project's most recently written `run-*.log` without a ticket. With `--recovery` (#62) the repair log, `recover-<n>.log`, instead. `-f` polls for appended output (starting over if the file is truncated) until interrupted.

## Out of scope

Journal output in `logs` (`logs` reads no journalctl; scheduler health and timings in `status` came in slice four), running every registered project in one command, moving the `dispatch.sh` checks into TypeScript, refreshing `.sandcastle` copies (slice five), renaming `.sandcastle` to `.factory`, and the board redesign.

## Tests

`node --test cli/test/*.test.mts orchestrator/*.test.mts board/*.test.mts`: `runs`, `dispatch`, `run`, `retry`, `status` and `logs` each have a test file under `cli/test/`, using a temp `FACTORY_HOME`, a fake project and the fake service backend.

---

# Slice two spec

## Registry

`~/.config/factory/projects.json`: `{"version":1,"projects":[{"name","root"}]}`. Identity is the canonical (realpath) Git root; name is its basename. Writes use a temp file plus rename (mode 0600) under an exclusive `projects.json.lock`; contention fails with a retry message. A malformed or unsupported file is reported and never replaced. Missing file means empty. Git worktrees are distinct roots; symlink aliases and subdirectories collapse to the root.

- `factory project add [path]` adds once, writes nothing into the project.
- `factory project ls [--json]` lists in root order, flagging a missing checkout or missing `.sandcastle`; JSON is `{version:1, projects:[{name,root,exists,scaffold}]}`.
- `factory project rm [path]` removes only the entry. A deleted checkout is removed by its recorded absolute path. Unknown is a no-op.

## Init

`factory init [path] --profile personal|client --repo <ns/project> --image <image>` (client also `--host` and `--project-id`). Inputs are validated before any write. Missing files from an explicit allowlist are created exclusively (never overwritten) in `.sandcastle/`; symlinked scaffold paths and file/directory conflicts fail before the first write. Existing files are reported as skipped; an existing `config.mts` or `main.mts` is authoritative. The project is registered only after all writes succeed; a partial copy leaves a repairable scaffold and a rerun fills the gaps. `config.mts`/`main.mts` are generated from the reference files via `// factory:<tag>` markers (project, host, project id, milestone, image, empty `sandboxSetup`). `factory-dispatch.sh` sets `SANDCASTLE_STATE_DIR` to Factory's state folder unless the caller set it. No tracker calls, logins, image builds, package installs or services.

## Uninstall

Lists each registered project's `.sandcastle` with a quoted removal command it never runs, before `--purge` removes Factory config (including the registry). Project files are never touched.

## Pi subscription provider

`pi-claude-subscription` is a Pi extension (not built into Pi) that runs `claude -p`. Host: cloned into `~/.pi/agent/extensions/pi-claude-subscription` (`git clone --depth 1 --branch <tag> https://github.com/markdlabrecque/pi-claude-subscription.git ~/.pi/agent/extensions/pi-claude-subscription && cd ~/.pi/agent/extensions/pi-claude-subscription && npm ci --omit=dev --ignore-scripts`; `pi install git:…` fails on the package's husky hook); analysis loads it via `-e <ext>/index.ts` with `--no-extensions`. Container: Sandcastle runs `pi -p --mode json --model <id>`; the image installs the CLI and extension (agent-pi layer) and the CLI authenticates with `CLAUDE_CODE_OAUTH_TOKEN` from `.sandcastle/.env`. No OpenAI login or credential is used for these models.

---

# First slice spec

## Scope

Four commands that touch every layer: the command on the PATH, the manifest, a real service on systemd or launchd, and a clean removal.

```
factory install
factory doctor
factory board start | stop | status
factory uninstall [--dry-run] [--purge]
```

Out of scope for this slice: projects, `init`, dispatch, timers, `update`, config, `--json` output, adopting old `sandcastle-*` units (detect and warn only).

## Code layout

```
cli/
  bin/factory.mts            entry point, parses argv, dispatches
  src/commands/
    install.mts
    doctor.mts
    board.mts
    uninstall.mts
    dispatch.mts             one dispatcher pass: runs the project's .sandcastle/dispatch.sh (slice three)
    run.mts                  factory run: one ticket now, through the project's dispatch.sh --issue (slice three)
    retry.mts                factory retry: clear a stopped run's record (slice three)
    status.mts               factory status: board service, scheduler health and timings, and the project's runs
    logs.mts                 factory logs (slice three; --recovery for repair logs, slice four)
    recovery.mts             factory recovery status|reset (slice four)
  src/manifest.mts           read, add entry, atomic write
  src/paths.mts              all paths in one place, honours FACTORY_HOME for tests
  src/projects.mts           project registry (slice two)
  src/runs.mts               which project a command is for, its run records and run logs (slice three)
  src/schedule.mts           launch configuration, project opt-in checks (slice four)
  src/schedule-state.mts     tick observations, state.json (slice four)
  src/recovery-state.mts     recovery episodes, budgets and attempts (slice four)
  src/recovery-claim.mts     claiming capacity, ticket and project for a repair attempt (slice four)
  src/tick-lock.mts          tick lock and process ownership (slice four)
  src/tick-cancel.mts        cancelling the active tick and its pass group (slice four)
  src/commands/schedule.mts  factory schedule on|off|status (slice four)
  src/commands/tick.mts      internal factory tick: gate on the manager, visit projects, run passes (slice four)
  src/platform/
    index.mts                picks the adapter
    systemd.mts              install, start, stop, remove a user unit
    scheduler.mts            ScheduleBackend interface and platform choice (slice four)
    scheduler-systemd.mts    factory-tick.service and .timer through systemctl (slice four)
    launchd.mts              same for a launch agent
    fake.mts                 in-memory adapter for tests
  test/
```

No dependency beyond Node's standard library. Argument parsing uses `node:util` `parseArgs`.

The platform adapter has one interface:

```ts
interface ServiceBackend {
  install(unit: ServiceSpec): Promise<ManifestEntry>;   // write file, reload, enable
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  status(name: string): Promise<'active' | 'inactive' | 'missing'>;
  remove(entry: ManifestEntry): Promise<void>;          // stop, disable, delete file, reload
}
```

## `factory install`

1. Check Node is 22.18 or newer. Stop with the version found if not.
2. Create the app dir `~/.local/share/factory/app/` by copying (or, with `--link`, symlinking) the repo checkout it runs from. Add a manifest entry. That is the checkout holding the running script; when the script is the installed app (the `factory` command on the PATH), it is the Factory checkout containing the current directory (one with `cli/bin/factory.mts`, `board`, `orchestrator` and `skills`). Outside any checkout, a linked install reuses its linked checkout and a copied install stops with an error rather than reinstall itself. Install prints the checkout it uses.
3. Symlink `~/.local/bin/factory` to `app/cli/bin/factory.mts`. Add a manifest entry. If `~/.local/bin` is not on the PATH, print the line to add.
4. Create the board unit from the shipped template (`factory-board.service` or `com.factory.board.plist`), with the absolute Node path filled in. Add a manifest entry. Enable it and start it.
5. Detect old `sandcastle-*` units, `~/.config/sandcastle/` and `~/.local/state/sandcastle/`. Print a warning naming them and that adoption comes in a later slice. Change nothing.
6. Print what was installed and the board URL.
7. If install stopped the scheduler, or any registered project is opted in, end with a reminder that the scheduler is off, naming the opted-in projects waiting, and to resume with `factory schedule on`. Install never turns scheduling back on.

Running it again reuses existing entries and refreshes the files. It never duplicates a manifest entry.

## `factory doctor`

Checks, each printed as one line with pass or fail and the fix:

- Node version is 22.18 or newer.
- `docker`, `git`, `glab` or `gh`, `claude` or `pi` are on the PATH.
- `systemctl --user` works (Linux) or `launchctl` exists (macOS).
- Linger is enabled (Linux). A fail here is a warning, not an error.
- The manifest exists and every entry's path exists.
- The board answers on `http://127.0.0.1:4444`.

Exit code is non-zero if any hard check fails.

## `factory board`

`start`, `stop` and `status` call the platform adapter for the `factory-board` service. `status` also prints the URL.

## `factory uninstall`

Follows "Uninstall behaviour" above. For this slice the manifest holds only the app dir, the symlink and the board service, so the run removes those three.

## Tests

Few and focused, per the project's testing rules. Run with `node --test cli/test/*.test.mts`, using `FACTORY_HOME` set to a temp dir and the fake adapter. No test touches the real systemd or launchd.

1. **Uninstall removes exactly the manifest.** Install into a temp home, add an unrelated file and an unrelated `factory-other.service` the manifest does not list, uninstall, and assert only the listed entries are gone.
2. **Install is idempotent.** Run install twice and assert the manifest has no duplicate entries and the same set of files exists.
3. **Crash recovery.** Make the adapter throw on the unit step, and assert the manifest lists the entries created before the failure, and that uninstall then cleans them.

Not tested: argument parsing, `doctor` output text, and the unit templates. They are trivial or covered by the manual check.

## Manual check on a real machine

A temp `FACTORY_HOME` cannot prove the real service works, so do this once per platform:

1. `factory install`, then `systemctl --user status factory-board` (or `launchctl print gui/$UID/com.factory.board`). It is active, and `curl http://127.0.0.1:4444` answers.
2. `factory doctor` passes.
3. `factory uninstall --dry-run` lists the service, the symlink and the app dir.
4. `factory uninstall`, then confirm `systemctl --user list-units 'factory-*'` is empty (or `launchctl list | grep factory` on macOS), `~/.config/systemd/user/factory-*` is gone, and `which factory` finds nothing.
5. `factory uninstall` again says nothing is installed and exits 0.

## Done when

- The three tests pass and CI runs them.
- The manual check passes on Linux, and on macOS if available.
- After uninstall, no `factory-*` unit, `com.factory.*` agent, command or app dir remains. Config and state remain unless `--purge` was passed.
- The README has a short "Install the Factory CLI" section, as `AGENTS.md` requires.
