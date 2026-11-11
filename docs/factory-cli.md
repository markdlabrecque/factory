<!-- CLI roadmap: slice two (project registry, init, Pi subscription models) implemented locally; .sandcastle retained, .factory migration deferred; board redesign (#3) implemented; slice three (`factory dispatch`, `run` with `dispatch.sh --issue`, `retry`, `status`, `logs`, and the shared lookup in cli/src/runs.mts) implemented and specified in "Slice three spec"; slice four's scheduler storage (project opt-in and launch configuration, cli/src/schedule.mts) implemented, see "Slice four: scheduler storage"; launch reservations (#32) implemented, see "Slice four: launch admission"; the Linux scheduler (#33: `factory schedule`, factory-tick units, internal `factory tick` in cli/src/commands/tick.mts, tick cancellation in cli/src/tick-cancel.mts; the service manager owns global state) implemented, with the rotating first project (#34), see "Slice four: the Linux scheduler"; slice four self-recovery requirements are agreed but unimplemented, with decisions in docs/slice-4/plan.md. -->
# Factory CLI

Status: first and second slices implemented locally, pending PR delivery and real-service verification. Slice three (dispatch, run, retry, status, logs) implemented; see "Slice three spec". Slice four is partly implemented: project opt-in and launch configuration storage, launch reservations, and the Linux scheduler from enable to uninstall with a rotating first project (see its "Slice four" sections). macOS, timing history, status health and the cutover runbook (#35 to #38) and slices five and six remain proposed. Slice four self-recovery scope is agreed but not implemented; see the [plan](slice-4/plan.md).

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
factory update               pull the latest, refresh copies inside projects
factory uninstall            stop and remove everything in the manifest
    --dry-run                show what would go, touch nothing
    --purge                  also delete config, run state, evidence, images
    --keep-state             (default) keep config and run history

factory init                 in a project: scaffold .sandcastle/ (replaces the workflow copy; environment layers stay in the setup skill)
factory project add|ls|rm    the list of projects Factory looks after

factory dispatch             one pass (--dry-run, --max N, --whole-issues)
factory run <ticket>         run one ticket now
factory retry <ticket>       clear a failed run's record so the next pass retries it
factory status               board service and every run's stage (--json; scheduler health comes later in slice four)
factory logs [ticket] [-f]   a run's log file (newest without a ticket; -f follows)

factory recovery status --project <name>   project recovery state and reports (planned slice four)
factory recovery reset --project <name>    reset recovery budget and confirmation (planned slice four)
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

Decided: one `factory-tick.timer` that walks the project list, instead of one timer per project. Reasons: `schedule on|off` is a single switch, uninstall removes one unit, and the shared run cap is enforced in one place. Per-project pause is a flag in the project list, not a unit. Global state is the timer's state in the service manager, not a Factory file. Implemented on Linux; see "Slice four: the Linux scheduler".

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
4. `factory schedule` with the single tick timer, replacing `install-dispatch.sh`. Implemented so far: project opt-in and launch configuration storage ([#31](https://github.com/markdlabrecque/factory/issues/31)), launch reservations ([#32](https://github.com/markdlabrecque/factory/issues/32)) and the Linux scheduler from enable to uninstall ([#33](https://github.com/markdlabrecque/factory/issues/33)) and its rotating first project ([#34](https://github.com/markdlabrecque/factory/issues/34)); see "Slice four: scheduler storage", "Slice four: launch admission" and "Slice four: the Linux scheduler" below. Still to come: macOS (#35), timing history (#36), scheduler health in `factory status` (#37) and the cutover runbook (#38). Self-recovery is also agreed for this slice but not implemented; see [self-recovery requirements](#slice-four-self-recovery-requirements) and the [slice 4 plan](slice-4/plan.md).
5. `factory update` and project copy refresh.
6. Retire `install-service.sh`, `install-launchd.sh` and `install-dispatch.sh`. Update `README.md`, `orchestrator/ADAPTING.md` and the setup skill (see `AGENTS.md`).
7. Migrate project files from `.sandcastle` to `.factory` in a future slice. Plan runtime path changes, compatibility and safe migration separately; do not rename directories in slice two.

The board redesign from [#3](https://github.com/markdlabrecque/factory/issues/3) is implemented: one Factory operations-console design for board and evidence pages with light/dark/system modes, page and navigation transitions, and live updates from a read-only `GET /api/runs` snapshot patched in place every 10s (no reloads; focus, scroll, filters and media playback preserved; reduced motion respected). A local `board.html` stays a static snapshot. Full implementation plans and Q&A are posted on all three tickets.

---

# Slice four: self-recovery requirements

Status: agreed product scope, not implemented or queued. The [slice 4 plan](slice-4/plan.md) records all decisions and acceptance coverage. Implementation must run through prepared Factory tickets, as required by [AGENTS.md](../AGENTS.md).

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

# Slice four: scheduler storage

Storage and opt-in contracts (`cli/src/schedule.mts`); `factory schedule` changes them and the tick reads them (see "Slice four: the Linux scheduler").

- **No global switch.** Factory stores no on/off flag. Scheduling is on when the service manager reports `factory-tick.timer` enabled and active; a `scheduler.json` left by earlier builds is ignored. A failed query is `unknown`, which blocks scheduled work like off does.
- **Launch configuration.** `~/.config/factory/schedule.json`, `{"version":1,"path":string,"node":string}`, written atomically (mode 0600) by `schedule on`. PATH only, and an absolute Node. Missing means nothing was saved (not that the timer is off); malformed or unsupported content is reported and never replaced. Members from earlier builds, such as `enabled`, are dropped.
- **Project switch.** The optional `schedule: {enabled, branch, since}` on a registry entry, written under the registry lock. Missing means off, so `project add` (and a re-add after `rm`) starts off. `setProjectSchedule(root, true)` requires a registered, present checkout with a branch checked out (no detached HEAD) and an `origin` remote that has that branch as of the last fetch (no network call), then saves the branch. `false` keeps the saved branch and stores nothing for a project never opted in. An entry with a malformed `schedule` makes the registry unsupported. `copyProblem(root)` is the second gate (`schedule on --project` and every tick): `dispatch.sh` present and executable, and a `.sandcastle` copy that has `reserveRun` (#32).
- **Why not.** `scheduleBlocker(scheduling, project, exists, branch)` returns null when a scheduled pass may run, else the first of: `scheduler is off (<reason>)`, `scheduler state unknown (<reason>)`, `project not opted in`, `project paused`, `checkout missing`, `checkout is on <x>, scheduled branch is <y>`. Scheduled work never switches branches.
- **Tick observations.** `<state>/scheduler/state.json` (`cli/src/schedule-state.mts`): `{version:1, nextRoot?, startedAt?, finishedAt?, durationMs?, pid?, currentRoot?, projects: {<root>: {attemptedAt, finishedAt?, durationMs?, pid?, result, reason?, exitCode?}}}`, `result` one of `running|ok|skipped|error|interrupted`. It records what ran and is never a switch. Only the tick that holds the lock writes it. A malformed file stops the tick and is left alone. `nextRoot` is the project that goes first next tick (see "Tick"). The bounded timing history is a later ticket.
- `factory project ls` shows `[scheduled: <branch>]` or `[schedule paused]`; `--json` rows carry `schedule` when set.

Tests: `cli/test/schedule.test.mts`.

# Slice four: launch admission

The three-slot cap (`SELECT.maxConcurrent` in `dispatch.mts`) is counted from the shared board. A dispatched `main.mts` writes its first record only after its tracker calls and fetch, so without more a pass that followed closely (the next project in a scheduled tick) could miss the runs just launched and overfill the cap, or launch the same ticket twice.

- **Reservation.** As it spawns each run, `dispatch.mts` calls `reserveRun()` (`board/board.mts`): the record gets stage `setup`, note `starting`, `starting: true` and the child's pid. It counts against the cap and holds the ticket and its files like any run in flight.
- **Hand-over.** `main.mts`'s first write clears `starting` and takes over the record with its own pid; from then on a dead process means a stopped run, as before.
- **Unstarted launch.** If the reserved pid exits while `starting` is still set (the run failed before it began), `readRuns()` deletes the record and `factory status` skips it, so the next pass retries the ticket as it did before reservations.
- Manual starts (`factory run`, `dispatch.sh --issue`) take no reservation and are not held to the cap; they still count once running.

Tests: `board/board.test.mts` ("a launched run counts as active before its child writes").

# Slice four: the Linux scheduler

`cli/src/commands/schedule.mts`, `cli/src/commands/tick.mts`, `cli/src/tick-lock.mts`, `cli/src/tick-cancel.mts`, `cli/src/platform/scheduler.mts`, `cli/src/platform/scheduler-systemd.mts`, `cli/templates/factory-tick.{service,timer}`.

- **Backend.** `ScheduleBackend` (`platform/scheduler.mts`) has `install(spec, record)` (writes the units, starts nothing), `enable()`, `disable()`, `status()` and `remove(entry)`. `status()` returns `{timer: active|inactive|missing, enabled, tick: active|inactive|missing, lastTick?}`. The timer's enablement (`UnitFileState`) and activity are read apart from the tick service's activity. A failed or unparseable `systemctl` call throws, and callers show `unknown`. On macOS every method throws until #35. The commands issued are `show`, `daemon-reload`, `enable --now` and `disable --now` on `factory-tick.timer`, `stop` on `factory-tick.service`, and per-unit `stop` and `disable` in `remove`.
- **`factory schedule on`** requires the manifest (`factory install`), refuses tick unit files it does not own, saves PATH and Node to `schedule.json`, writes `factory-tick.service` then `factory-tick.timer` (each recorded in the manifest as soon as it is written), daemon-reloads, and runs `enable --now factory-tick.timer`. The service is `Type=oneshot` running `node <app>/cli/bin/factory.mts tick`, with the saved PATH, `FACTORY_HOME`, `SANDCASTLE_STATE_DIR`, journal output, `KillMode=process` (systemd signals only the tick itself), `TimeoutStartSec=infinity` (no dispatcher timeout) and `TimeoutStopSec=2min` (room for cancellation). The timer is `OnActiveSec=1min` and `OnUnitInactiveSec=5min` with `Persistent=false`, so missed ticks are not replayed. If install or enable fails, the ledger stays and the error carries the state systemd reports now. Repeating `on` retries, and also rewrites the units and refreshes PATH and Node. On macOS it refuses.
- **`factory schedule off`** is `stopScheduling`: `disable --now factory-tick.timer`, then `stop factory-tick.service` (which waits), then `cancelTick` confirms the recorded tick and pass group are gone. A failure at any step stops there with the files kept, and running `off` again retries.
- **Cancellation** (`tick-cancel.mts`). The tick lock file (`<state>/scheduler/tick.lock`, JSON) records the tick's pid and kernel start time and, once spawned, the pass's pid and start time. The pass is spawned with `detached: true`, so it leads a new process group whose id is its pid. Everything non-detached below it (shell, `npx`, ticket analysis) is in that group. Ticket runs that `dispatch.mts` launches are detached into their own groups. Factory signals only the recorded tick pid and `-<pass pid>`, after checking they are still those processes by start time, and never group 1 or its own. `cancelTick` sends the tick SIGTERM and waits `grace + confirm + 2s`, since the tick cancels its own pass. Then it sends SIGKILL to the tick. If the pass group is still alive it sends SIGTERM to the group, waits 30 s (`DEFAULT_GRACE_MS`), sends SIGKILL to the group, and waits 5 s (`CONFIRM_MS`) for it to vanish. Zombies do not count as alive. The deadline applies to cancellation only: nothing times out a pass that is running normally. If a pass leader exits while non-detached members of its group are still alive (a backgrounded job, or a child orphaned when the dispatcher died mid-analysis), the tick keeps ownership recorded until it has terminated that group the same way (SIGTERM, grace, SIGKILL, that group only), logs it, and records the reason on the project (`left processes running in its process group, terminated`). That is cleanup after the pass ended, not a pass timeout, and it keeps ownership from being dropped while an owned process lives; if the group cannot be confirmed gone the lock stays and no pass starts over it. `off`, uninstall and reinstall report what they observed: the tick the manager said was running (even when its stop already cancelled it and left no lock), the project whose pass became `interrupted`, a pass that had already finished on its own (named as finished, never as cancelled), or that the manager could not be read. When a leftover group cannot be confirmed gone, state.json keeps what the leader did (`ok` or `error` by its exit code, with exit code, finish time and duration) and a reason naming the live group; `interrupted` is kept for cancellations that were requested. Unconfirmed cancellation throws and keeps the lock. A lock whose tick is dead but whose pass group lives is never reclaimed, so no second pass starts over it, and the next `off` cancels it. The tick's own SIGTERM/SIGINT handler does the group part (`terminateGroup`), records the pass `interrupted`, starts no later project and exits 143.
- **`factory schedule on|off --project <name|path>`** takes a registered name, a path in the checkout, or the recorded root of a deleted checkout. It sets the project switch and never touches the timer. `on` refuses a project that fails `optInProblem` or `copyProblem` and never refreshes the copy itself. Without `--project` the command is global, even inside a checkout. `--json` is for `status` only. A positional project is rejected.
- **Tick** (`factory tick`, internal, no flags). It asks the manager (`on` means timer enabled and active) before the lock, after it and before each project. Off ends it with exit 0, and unknown (query failed) with exit 1. A live holder, or a dead holder's live pass group, makes it log and exit 0. Missing or malformed launch configuration, registry or state stops it with an error. It visits the whole registry in order, rotated to start at the first opted-in, unpaused project at or after `nextRoot` (the top when `nextRoot` is unset or unregistered); before any pass it saves `nextRoot` as the next opted-in, unpaused project after that one, so the turn advances even when the tick fails, is cancelled or dies, and projects not opted in take no turn. It then, for each project that `scheduleBlocker` and `copyProblem` clear, runs `dispatch.sh --max 3` from the root through `runDispatchSh` (options `group`, `env`, `onSpawn`) with `FACTORY_SCHEDULED=1`, the saved PATH and `SANDCASTLE_STATE_DIR` set to Factory's state folder whatever the caller set. Other projects log `skip <name>: <reason>`. Stdin is inherited. State is saved before spawn (`running`), at spawn (pid) and after (`ok` or `error`, exit code, UTC finish, monotonic duration). A dead tick's `running` entries become `interrupted` without a finish time. Exit codes: 0 done, 1 a pass failed, 143 cancelled. The current dispatcher ignores `FACTORY_SCHEDULED=1`; Factory passes it as the ticket specifies.
- **`factory schedule status [--project] [--json]`** prints the manager's state (enabled, timer activity, tick activity; `unknown` when the query fails), the last trigger, enabled legacy dispatcher timers, and each project's switch, `scheduleBlocker` reason or `ready`, and last pass result. The full status contract is #37.
- **`factory doctor`** checks the manager once the units are in the ledger. Enabled and active passes, enabled but stopped fails, running but disabled warns, an unreadable manager fails, and off is information. It warns about enabled legacy `sandcastle-dispatch` timers (`~/.config/systemd/user/timers.target.wants/`). Nothing disables them automatically; the cutover is #38.
- **`factory uninstall`** stops scheduling first, then removes ledgered entries in reverse, routing scheduler units to the schedule backend and the rest to the board adapter. `--dry-run` makes no manager call and sends no signal. **`factory install`** over a ledger with scheduler units stops scheduling first, rewrites the owned units from the saved configuration and leaves the timer disabled.

Trusted, not tested: systemd's timer firing and rearming, journald, and its delivery of signals under `KillMode=process`. Tests: `cli/test/schedule-linux.test.mts` (real CLI and production adapter against `cli/test/stubs/systemctl`, synthetic process trees) and `cli/test/scheduler.test.mts` (in-memory `FakeSchedule`); see `TESTING.md`.

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

Deletes the ticket's run record, the same as deleting the JSON file by hand, only when its stage is `stopped` (including a run whose process is gone). `done`, live, `queued` and `waiting` runs and a ticket without a record are refused with the reason. It never deletes branches, logs or evidence; it warns, with the command to delete it, when a `<ticket>-*` branch exists locally or on origin (as last fetched), since the dispatcher skips such a ticket.

## `factory status [--json] [--project <name>]`

Prints the board service's state (`active`, `inactive`, `missing`, or `unknown (<reason>)` when the service manager can't be asked) and URL, then each of the project's run records, oldest first, with stage, time in that stage, title, branch, verdict, PR and note; a dead process reads as `stopped`. `--json` prints `{version:1, project:{name,root,tracker}, board:{service,url}, runs:[...]}`, the runs being the records plus their `key`. The service backend is passed in, so tests use the fake one.

## `factory logs [ticket] [-f] [--project <name>]`

Prints the ticket's run log, or the project's most recently written `run-*.log` without a ticket. `-f` polls for appended output (starting over if the file is truncated) until interrupted.

## Out of scope

Timing history and scheduler health in `factory status` (slice four: `status` shows no timers, `logs` reads no journalctl), running every registered project in one command, moving the `dispatch.sh` checks into TypeScript, refreshing `.sandcastle` copies (slice five), renaming `.sandcastle` to `.factory`, and the board redesign.

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
    status.mts               factory status: board service and the project's runs (slice three)
    logs.mts                 factory logs (slice three)
  src/manifest.mts           read, add entry, atomic write
  src/paths.mts              all paths in one place, honours FACTORY_HOME for tests
  src/projects.mts           project registry (slice two)
  src/runs.mts               which project a command is for, its run records and run logs (slice three)
  src/schedule.mts           launch configuration, project opt-in checks (slice four)
  src/schedule-state.mts     tick observations, state.json (slice four)
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
2. Create the app dir `~/.local/share/factory/app/` by copying (or, with `--link`, symlinking) the repo checkout it runs from. Add a manifest entry.
3. Symlink `~/.local/bin/factory` to `app/cli/bin/factory.mts`. Add a manifest entry. If `~/.local/bin` is not on the PATH, print the line to add.
4. Create the board unit from the shipped template (`factory-board.service` or `com.factory.board.plist`), with the absolute Node path filled in. Add a manifest entry. Enable it and start it.
5. Detect old `sandcastle-*` units, `~/.config/sandcastle/` and `~/.local/state/sandcastle/`. Print a warning naming them and that adoption comes in a later slice. Change nothing.
6. Print what was installed and the board URL.

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
