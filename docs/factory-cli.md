<!-- Operator contracts for shared runtime selection, scheduling, recovery and read-only diagnostics. -->
<!-- Recovery maintenance settles locally before project pause gates; status reprojects saved-work followups without writes.
Live read-only scheduler authorization and delivery claims continue existing exact-head PRs. -->
<!-- Scheduled passes use each project's configured dispatch cap, counted across the shared board. -->
<!-- Operator guidance covers CLI commands, runtime ownership, scheduling, recovery and diagnostics. -->
# Factory CLI

The [project supervisor authority contract](supervisor.md) documents the gate inventory,
import-safe records, explicit fresh-review/managed-comment outbox boundaries and
remaining paid-runtime/application prerequisites. The exact local resolution command
below does not enable action mode, launch a review or approve a gate.
The source-only [advisory repair broker](supervisor.md#thin-host-action-broker) can inject a candidate into the existing
successful-pass/two-pass recovery scan; no production caller activates it. Disabled/observe/stopped supervisors leave
existing automatic recovery unchanged. Advice never bypasses fresh preparation, current scheduler/project authorization,
saved-run ownership, project exclusion or the existing atomic attempt charge. Waiting CI stays on existing delivery
follow-through, without new repair/model budget. Failed CI can yield a human-approved follow-up draft or an otherwise
eligible exact stopped-run repair, never authority from merely having an open PR. Missing trusted escalation/activation
capability remains held; no local record counts as delivered notification or human approval.

Dispatch and recovery enforce [image and sandbox readiness](image-readiness.md) before agent work. Recovery awaits readiness before atomic claim-and-charge, reports environment holds without spending attempts, and rechecks scheduling eligibility after the probe. New supported projects use `.factory` throughout. Strict metadata inspection refuses any `.sandcastle` entry, mixed layouts, directory/config aliases and unknown inspection results before new project writes, tracker work, reports or launch/admission effects. Init may complete a safe existing `.factory` data/image-assets directory without config, preserving existing regular files and registering only after all writes succeed. Executable legacy remnants without TOML are still refused. Existing operations require validated TOML. The shared runtime contract is a breaking change. Project owners are responsible for reviewing their own configuration and custom code; Factory does not automatically migrate them.

The [structured ticket-context contract](ticket-readiness.md#structured-ticket-context) defines complete child and immediate-parent input, bounded collection holds, provenance, hashing and untrusted rendering. Standard launch/analysis gates refuse incomplete structured input before work starts and publish typed ticket-only holds alongside project checks. Standard workflows freeze one complete snapshot per invocation for prompts and evidence, then compare fresh included-source hashes at the existing analysis/proof/delivery boundaries.

The [ticket-readiness contract](ticket-readiness.md) also defines the shared filesystem probe/report API and its passive-reader boundary. The CLI consumes these reports passively and offers explicit doctor probes. The standard normal and recovery workflows probe the prepared workspace, Git metadata and evidence mount as the actual agent UID/GID after setup/browser preflight and before invoking an implementer or repair agent. Required failures or unknown results invoke zero agents and preserve both readiness and cleanup causes. A post-container recovery failure still spends the existing admitted attempt. Exact-container teardown must be confirmed; normal uncertainty retains the runtime cleanup lease/ownership receipt, and recovery uncertainty retains its cleanup-pending claim until settlement. Complete custom workflows remain internally opaque unless their implementation calls the shared sandbox helper. No new CLI command or override handshake is introduced by this gate. Saved readiness is never launch authority.

Normal implementer stops with zero commits now retain [an attributed no-commit explanation](ticket-readiness.md#no-commit-explanations) in the execution note and bounded execution evidence. Factory's zero-commit, worktree and push facts remain separate from the agent's claim. If capture is unavailable, cause stays unknown. Inspect ticket context and evidence before choosing a relaunch; there is no new automatic retry or success authority. Existing blocked-report dependency handling and opt-in recovery policy are unchanged. The owned sandbox closes before a no-commit exit; teardown failures retain the explanation and do not confirm cleanup.
The [host launch gate](ticket-readiness.md#host-launch-ordering) applies fresh filesystem/input checks to manual run, dispatch, scheduled starts and recovery preparation/admission. A shared project failure stops before ticket analysis, new queue/run/admission records or containers. It leaves tracker selection and existing parked/stopped history intact, with one shared report rather than per-ticket failures, tracker comments or needs-human labels. A ticket input or branch/worktree conflict holds only that ticket. Neither an ordinary dirty checkout nor an unrelated valid worktree is a blanket failure. Factory preserves conflicts for inspection; it does not repair, delete or adopt them.

The same host-owned project gate precedes explicit complete overrides, including Board reassessment and never-opted scheduled refresh, without importing their code into diagnostics or claiming coverage of opaque internal behavior. Board polling remains passive. A fresh pass may resume normal selection after success, but never implicitly retries a stopped run. Ticket-specific checks repeat before protected creation/admission, and final filesystem/Git operations remain authoritative. Saved readiness never authorizes launch.

Recovery host checks run within the existing preparation/pre-charge flow and repeat after image readiness. Complete input must still match the existing preparation before charge, including parent planning comments. A failed source or changed hash publishes a ticket-input hold without replacing the preparation. Host-known failure charges no attempt. Capacity, activity-generation, ownership and admission-time local checks still apply; no budget is refunded or reset. After a container starts, existing charged-attempt and exact-container cleanup rules remain. Settlement and scheduled local maintenance run independently of the new-launch gate, including during project holds or pauses under the existing global-off/unknown/cancellation policy. Unconfirmed cleanup continues to hold ownership, and report state-write failures are reported directly.

## Supervisor human-request resolution

```sh
factory supervisor resolve --project <name-or-path> --incident <exact-incident-id> --request <exact-request-id> --proposal <exact-held-proposal-hash> --reason "Owner decision after inspecting originals" --abandon --confirm
factory supervisor resolve --project <name-or-path> --incident <exact-incident-id> --request <exact-request-id> --proposal <exact-held-proposal-hash> --reason "Permit only this material successor and new review" --revised <exact-new-proposal-hash> --confirm
```

This is a **local host-user control**, not tracker approval or an action-mode switch.
Choose exactly one of `--abandon` or `--revised`; the latter cannot reuse the held
proposal. Without confirmation, exact IDs, a reason and validated project identity,
the command refuses without changing the journal. Registered project resolution is
the same as other run controls; without `--project`, use the current registered
checkout. It reads validated TOML, never executes project configuration or fetches
credentials. OS UID/username supplies the audit actor; there is no actor flag or
trust in a tracker comment/model response. Exit 0 means the resolution audit was
committed, **not** gate approval, review/repair launch, proof or merge authority.
Unknown/unsettled worker accounting or a foreign/already-resolved request exits 1.

Inspect original retained review input/process/result and human request in the
host-owned `<state>/supervisor/state.json` and its referenced sidecars before
resolving. Do not edit that journal manually. Denials, pending/delivered requests,
original gates/work and cumulative charges remain retained. Abandonment permits no
replacement. A revised exact hash requires a new material incident and fresh
independent review; A→B→C resolution chains retain all history without resetting
budgets. This command does not automatically resume a worker or clear the original
denial. Supervisor status/mode/stop controls and scheduler wiring remain separate work.

The [source-only escalation contract](supervisor.md#durable-managed-comment-outbox)
delivers one managed comment to the exact ticket or an explicitly configured
same-project operator issue for project-wide requests. There is no fallback ticket.
Only an actual tracker API comment receipt marks notification delivered; it never
means human approval. Observe or absent host notification authorization forbids
tracker writes. Failed/uncertain/crashed delivery remains pending and stopped;
reconciliation may find the exact marker but never blindly repeats POST. There is
no installed notification service, live configuration or automatic delivery command
introduced here. Provider-enforceable paid ceilings/accounting, gate application,
fresh proof and live activation remain prerequisites; offline tests are not a pilot.

## Board readiness

The Board shows stored readiness once per registered project, even before its first run. The notice is separate from historical execution stops. It shows project checks and explicitly attributed ticket-input, ticket-workspace and sandbox checks, with phase, operation, safe path/error, observation time and identity, next actor/action and automatic recheck policy. An unattributed ticket/sandbox check is not a project hold. A later ready observation removes the current failure notice without rewriting old run records or evidence.

`GET /api/readiness` is a separate no-store JSON snapshot `{ generatedAt, projects, reason? }`. Each project has its registered `name`, canonical `root` and shared-store `observation`. Requests cannot select filesystem paths or another project's report. The existing `/api/runs` response remains `{ runs: [...], generatedAt }`; its run array and card semantics are unchanged. GET assembly no longer reconciles dead processes or reads agent-log excerpts. Explicit log/evidence commands remain separate.

The page polls readiness every ten seconds with at most one readiness request in flight and pauses in hidden tabs. Polling reads bounded stored data only. It does not probe, launch a workflow, fetch tracker input, write state or repair anything. `board.html` contains an additive timestamped `readiness` bootstrap alongside runs. File snapshots and evidence pages make no readiness requests.

Missing, pending, invalid, stale or unavailable observations are unknown, not healthy. The Board identifies the stored runtime/config/context but does not load project configuration to prove that identity is still selected. A recent `ready` observation is not launch authorization. Report producers must supply safe fields, not raw transcript text, credentials or setup commands. All fields render as plain text. See the [Board projection contract](ticket-readiness.md#board-projection) for bounds and attribution limits.

## Configuration explanation

`factory config explain [--project <name|path>] [--json]` validates v2 configuration, instructions and the selected runtime without launching it. A registered name selects its root; an explicit path selects that path, even if unregistered. Without `--project`, it selects the innermost registered root containing the current directory, or searches ancestors for `.factory/factory.toml`. This differs from run and dispatch, which require registered checkout resolution. JSON output has version 1, normalized settings and source attribution, canonical project and config paths, config and instruction hashes, runtime identity and Factory model policy. Setup commands and instruction bodies are not printed. The command reads and hashes local files only: it does not prepare a runtime, access the network, acquire leases or write files. A complete project override reports configured intent and validated identity, but its actual models and behavior are opaque. Invalid inputs exit 1 with sanitized diagnostics; successful validation exits 0. This does not check tracker, image, credentials or service availability. Configuration aliases are rejected, and instruction aliases must resolve to Markdown outside secret paths before any content read. Factory model policy is reported only when its selected inventory hash matches the CLI's known policy bytes; otherwise it is unknown with a warning, never inferred by executing the module.

## Selection explanation

`factory selection explain <ticket> [--project <name|path>] [--json]` explains configured selection without starting work.

```sh
factory selection explain 42 --project <name-or-path>
factory selection explain 42 --project <name-or-path> --json
```

This command requires a positive ticket number and a registered checkout. It validates v2 configuration and the complete selected runtime, then uses Factory-owned native host tracker reads. It never imports custom project executables, creates labels, runs analysis or writes state. Unlike `config explain`, it is not offline and needs existing tracker access.

The result separates configured selection eligibility from execution holds. `eligibility` is `selected`, `not-selected` or `unknown`, with structured reasons, effective settings/source attribution and selected workflow identity. Open child Tasks can inherit eligibility from a selected parent; a parent with children is a container rather than an executable work unit. Ticket-local exclusion and closed-child rules still apply. Failed or incomplete tracker reads are unknown, not proof that a filter excluded the ticket. Selected and not-selected results exit 0; unknown exits 1. Invalid arguments/configuration/runtime/project selection also fail.

JSON includes `source`, `workflow`, `settings`, `eligibilityScope`, `eligibility`, `reasons`, `inheritedFrom` and `executionHolds`. Recorded run/assessment facts are historical only. Capacity, conflicts, prerequisites and admission are not re-evaluated. A complete project override reports configured selection intent with opaque actual behavior, not a guarantee of what its custom dispatcher would select. Selection explanation never authorizes execution.

## Project asset diagnostics

```sh
factory update --dry-run --project <name-or-path>
factory update --apply --project <name-or-path>
```

Both forms validate the project's v2 data and report project-owned `factory.toml`, `.env.example`, `.gitignore` and `factory-dispatch.sh`. Existing assets are never modified; absent assets are never created by update. `--apply` is retained as a supported command form, not permission to repair executable copies or overrides. No automatic v1 migration, partial workflow merge or image rebuild occurs. Explicit project changes belong to the owner; shared runtime publication uses `factory install`, and custom code follows [complete override maintenance](../orchestrator/ADAPTING.md#complete-project-workflow-override). Historical copy drift remains separately available through `factory workflow status`.

## Local observations

`factory telemetry export [--project <name|path>] [--ticket <iid>] [--since <ISO-8601>] [--format json|jsonl]` exports append-only local execution and explicit-control observations. JSONL is the default, with metadata first. The command writes only stdout, does not reconcile state or take writer locks, and reports coverage as `observed-only`. Missing history is not proof of inactivity. See [local execution observations](telemetry.md) for the event schema, supported controls, unknown attribution, diagnostics, retention and runtime upgrade requirements.

The sections below document the scheduler, recovery and ticket contracts as well as installation and project commands.

## Goal

Factory provides one installed operator command for project execution, scheduling, recovery and observation. Installation records ownership; uninstall removes the services and artifacts in its manifest, preserves projects, and refuses unsafe runtime removal. Unrelated or untracked services are never removed merely because their names match.

## Principles

- **One install point.** Code, config and state each have one home (see Layout).
- **The manifest is the source of truth.** Every file, unit or agent Factory creates is recorded in `manifest.json` at the moment it is created. Uninstall removes what the manifest lists and nothing else. It never guesses by name patterns.
- **Idempotent.** Running `factory install` twice leaves the same result.
- **Delivered end to end.** Installation, service ownership and uninstall form the completed first slice; later commands use the same ownership boundaries.
- **No surprises on uninstall.** Config, run history and `.env` files are kept unless `--purge` is passed. Projects are never edited.

## Surface

```
factory install              set up the CLI, write the manifest (the bootstrap script runs this)
factory doctor [--project <name|path>] [--probe-filesystem] [--json]   passive diagnostics or explicit owned filesystem probes
factory update               report project-owned data (--dry-run and --apply do not repair files)
factory workflow status      compare an explicit source, invoking/installed apps and registered project copy; read-only (--json)
factory uninstall            stop and remove everything in the manifest
    --dry-run                show what would go, touch nothing
    --purge                  also delete config, run state, evidence, images
    --keep-state             (default) keep config and run history

factory init                 create minimal project data and register the checkout
factory project add|ls|rm    the list of projects Factory looks after

factory dispatch             one pass (--dry-run, --max N, --whole-issues)
factory run <ticket>         run one ticket now
factory retry <ticket>       clear a failed run's record so the next pass retries it
factory telemetry export    read-only local event export (--project, --ticket, --since, --format json|jsonl)
factory status               board service, scheduler health and timings, and every run's stage (--json)
factory logs [ticket] [-f] [--recovery]   a run's (or with --recovery a repair's) log file (newest without a ticket; -f follows)

factory recovery status --project <name>   project recovery state, attempts and reports (--json)
factory recovery reset --project <name>    reset recovery budget and confirmation; launches nothing
factory recovery review [--confirm] [--project <name|path>]   inspect or explicitly confirm a complete project override
factory schedule on|off [--project <name|path>]   the scheduler, or one project's opt-in (Linux/macOS)
factory schedule status [--project <name|path>] [--json]   timer, tick, and why each project would or would not run
factory clean [--dry-run] [--project <name|path>] [--json]   delete merged, clean local Factory branches and their worktrees
factory board start|stop|status             the always-on board; status prints its URL
factory config explain       read-only effective configuration and runtime identity (--json)
factory selection explain <ticket>   tracker-backed configured selection explanation (--json)
factory ticket comment|sync|verdict|archive|archived|show|restore   journal controls and read-only inspection; see ticket journal
```

Only commands that list `--json` in their syntax accept it.

## Read-only workflow identity report

```sh
factory workflow status --source /path/to/factory --project my-project
factory workflow status --source /path/to/factory --project /path/to/project --json
factory workflow status --source /path/to/factory --docker-socket /run/user/1000/docker.sock --json
```

`--source` is required and must name a Factory source directory with `cli/src/scaffold.mts` and `orchestrator/`. It is never inferred from an install ledger. `--project` uses the existing registered-name/path/worktree resolution. Without it, the current checkout must be registered. Selection does not require valid project configuration, so missing workflow files and malformed TOML can still be reported. An explicitly named registered but missing checkout is reported as missing.

The invoking application and `Paths.app` installed application are separate observations. A symlink install reports `linked` and its canonical target. A regular installed directory reports `copied`. A commit is shown only if Git identifies that exact directory as a checkout root. Copied apps have no invented commit or release version, even when `scaffold-history.json` recognizes a historical blob. Unavailable commit/dirty facts are `null` in JSON and `unknown` in text. `dirty` is local Git worktree status, not a compatibility assessment. No refs are fetched.

### Version-1 JSON contract

The top-level `version` is `1`. These are the report sections:

| Field | Content |
| --- | --- |
| `source`, `invokingApp` | `path`, `canonicalPath`, `status`, `linked`, `commit`, `dirty`, `workflowDigest`, `inventory` |
| `installedApp` | Same identity fields, `status` of `copied`, `linked`, `missing` or `unknown`, plus `files` with `againstSource` of `same`, `different` or `unknown` |
| `projectCopy` | Same identity fields for `.factory`, registered `root`, plus `files` with independent `againstSource` and `againstInstalled` classifications |
| `capabilities` | `schedulerCopy`, `recoveryWorkflow`, `recoveryReview`, each `{state, reason, evidence}`, and a compatibility `limitation` |
| `image` | `configuration`, local `socket`, and `inspection` |
| `limitations` | Explicit limits of the collected evidence |

Inventory entries are `{path, status, sha256}`. Status is `present`, `missing`, `not-regular` or `unknown`; unavailable hashes are `null`. Only the sorted `scaffoldSources` allowlist is inventoried, including the orchestrator/board files, profiles, entrypoint and prompt templates. No arbitrary directory traversal, `.env`, auth files, installed dependencies, Git objects or runtime state enters the content digest. Internal inventory symlinks are not followed.

`workflowDigest` is SHA-256 over UTF-8 `JSON.stringify` of `[path, status, sha256]` rows, sorted by relative path in codepoint order. Missing-file markers are part of this encoding. It identifies selected content, not a release. Source/app paths use the source layout; project paths use the scaffold layout, with rendered settings. Do not compare a project digest directly to an app digest to infer drift. Use the per-file comparisons instead. Source and app digests are directly comparable because they use the same inventory.

Historical project-copy diagnostics use read-only `classifyInventory`: `current`, `missing`, `outdated`, `modified`, `project`. `outdated` requires an exact historical blob match, not a guess that a differing file is old. These comparisons do not select the active workflow or authorize a hand merge. An unavailable comparison is `unknown` with a reason, not `current` or `missing`. Source and installed comparisons use their own histories. This differs from `factory update`'s data-only `classifyCopy`; update does not repair executable copies or overrides. The report never calls `applyCopy`.

### Observations, not compatibility certification

The capability states are `met`, `blocked` and `unknown`. Scheduler observation validates the complete selected workflow, private dependencies and executable dispatch entrypoint. Recovery workflow observation uses the same complete inventory. Factory-mode recovery trusts the validated installed bundle without per-project review. Project-mode review compares the selected mode/root, source identity and dependency hashes to the host-owned review record; edits invalidate review. Missing project reviews block that observation; malformed/unreadable records stay unknown. Unreadable or non-regular legacy copy inventory entries remain unknown diagnostics. These observations do not certify arbitrary custom workflow behavior or authorize an update, review or schedule change.

Image configuration comes from validated v2 TOML through `loadTomlConfig`. Missing, v1, invalid or unreadable TOML is `invalid-config`; only v2 configuration is supported, with no legacy fallback. Project modules are never executed to discover settings. Dispatch, direct runs, selection, refresh and recovery use the same v2 configuration authority. Factory derives Pi, high thinking and role models from `agent.family`; ticket descriptions select implementation tiers, defaulting to Mid. See [project configuration](project-config.md).

Image inspection sends only `GET /images/<encoded-reference>/json` to the local Unix socket. The default is `/var/run/docker.sock`; `--docker-socket` must be an absolute local path, not a URL. Remote `DOCKER_HOST` and Docker contexts are ignored. The request has a total 3-second deadline and a 1 MiB body limit. A 404 reports `missing`; inaccessible sockets, daemon errors, malformed/oversized bodies and timeouts report `unknown`. Successful inspection retains only image ID, RepoDigests, OS, architecture and configured user. It excludes image Env, labels and daemon error bodies. Missing optional identity fields remain absent in JSON and unknown in text.

A valid report exits 0 even with drift, blocked checks, invalid configuration or unknown image facts. Bad arguments, an invalid source directory, unregistered project selection or inability to construct a report exits 1. Collection and formatting create no directories or metadata and do not run doctor, dispatch, service managers, tracker/auth commands or verification probes. They never pull, build or run images. This command is diagnostic, not a deployment or shared-runtime migration step.

## Layout

| Path | Holds |
| --- | --- |
| `~/.local/bin/factory` | the command (a symlink into the app dir) |
| `~/.local/share/factory/app/` | the code: `cli/`, `board/`, `orchestrator/`, `skills/` |
| `~/.local/share/factory/manifest.json` | installation ownership ledger |
| `~/.local/share/factory/runtime.json` | installed runtime descriptor |
| `~/.local/share/factory/runtimes/` | content-addressed runtime bundles and leases |
| `~/.config/factory/` | config, project list, per-project env files |
| `~/.local/state/factory/` | run records, evidence, logs |
| `~/.config/systemd/user/factory-*` | units (Linux) |
| `~/Library/LaunchAgents/com.factory.*` | agents (macOS) |

Install warns about detected old Sandcastle services and directories. It does not adopt them.

## Timers

Decided: one `factory-tick.timer` that walks the project list, instead of one timer per project. Reasons: `schedule on|off` is a single switch, uninstall removes one unit, and the shared run cap is enforced in one place. Per-project pause is a flag in the project list, not a unit. Global state is the timer's state in the service manager, not a Factory file. Implemented on Linux; see "Slice four: the Linux scheduler". launchd has no completion-relative timer, so on macOS the single "timer" is one launch agent, `com.factory.tick`, whose supervisor keeps the same cadence itself; see "Slice four: the macOS scheduler".

## Language

Implemented in Node and TypeScript, with shell bootstraps where needed. The repo requires Node 22.18+, which runs `.mts` files directly through type stripping, so there is no application compilation step. The selected workflow uses its private locked runtime dependencies; installation prepares those separately. See [execution context](execution-context.md) and [testing](../TESTING.md).

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

1. Read the manifest. If it is missing, report that and list any discovered `factory-*` units and `com.factory.*` agents, but delete nothing. There is no `--force` escape hatch; untracked artifacts require separately reviewed manual cleanup.
2. Stop and disable every `systemd` and `launchd` entry. Reload the manager afterwards (`systemctl --user daemon-reload`).
3. Delete the unit and agent files.
4. Delete the app dir and the `factory` symlink.
5. Config, state and `.env` files: keep by default, delete with `--purge`. `--purge` also removes Docker images Factory built (identified by a label, `factory.managed=true`).
6. Never edit a project. List each registered project's `.factory/` and print the command to remove it.
7. If linger was enabled (`loginctl enable-linger`), print a note. Factory does not undo it.
8. Delete the manifest last.

`--dry-run` prints steps 2 to 8 as a list and changes nothing.

## Roadmap

The first five slices are complete in source. Completion here does not mean a particular machine has installed the latest runtime, migrated its configuration or enabled scheduling. Operator deployment and live smoke checks remain separate actions.

| Slice | Status | Delivered behavior |
| --- | --- | --- |
| 1. Installation and Board service | Complete, [#1](https://github.com/markdlabrecque/factory/issues/1) | `install`, `doctor`, `board start|stop|status`, ownership manifest and safe `uninstall`, with Linux and macOS service adapters. |
| 2. Project registration and initialization | Complete, [#2](https://github.com/markdlabrecque/factory/issues/2) | `project add|ls|rm` and `init`. Current init creates data-only v2 configuration and environment assets; see [project configuration](project-config.md). |
| 3. Manual execution and observation | Complete, [#10](https://github.com/markdlabrecque/factory/issues/10) | `dispatch`, `run`, `retry`, `status` and `logs`, using the selected complete runtime and explicit project context. |
| 4. Scheduling and self-recovery | Complete, [#30](https://github.com/markdlabrecque/factory/issues/30) | One completion-relative scheduler on Linux/macOS, project opt-in, rotating priority, atomic admission, timing/health reports and bounded recovery with independent verification. See [self-recovery requirements](#slice-four-self-recovery-requirements) and the scheduler contracts below. |
| 5. Project assets and ticket journal | Complete, [#85](https://github.com/markdlabrecque/factory/issues/85), [#98](https://github.com/markdlabrecque/factory/issues/98) through [#103](https://github.com/markdlabrecque/factory/issues/103) | `update --dry-run|--apply` now report project-owned data without modifying it. Merged-work reconciliation, safe local cleanup, and ticket comments, sync, verdict correction, archive, show and restore are implemented. See [ticket journal](#slice-five-ticket-journal). |
| 6. Interactive attach/steer | Planned, [#216](https://github.com/markdlabrecque/factory/issues/216); production integration not implemented | Per-project opt-in for interactive Pi implementation through herdr-core; noninteractive remains the default. CLI attach/steer and read-only status/Board visibility. Explicit hand-back, truthful exit propagation and exact-owned orphan cleanup precede rollout. Independent verification and host delivery gates remain authoritative. |
| 7. Use `.factory` for new projects | Complete in source and offline acceptance | Config, patched runtime SDK, worktrees, artifacts and recovery agree. Tracked image/environment assets use `.factory`; obsolete copied modules are retired. Old `.sandcastle` and mixed layouts are refused without conversion. [Acceptance evidence and limits](../TESTING.md#supported-layout-acceptance) distinguish source readiness from live rollout. |

### Delivered follow-up features

- The live Board uses the approved per-ticket stage tracker, ticket stats and one latest-ten Shipped section, with light/dark/system appearance, reduced-motion support, evidence pages and in-place ten-second run polling. File snapshots remain static. See the [Board design and production behavior](board-design-prototype.md#promotion-to-the-board-template).
- Existing PR/MR delivery can continue after required checks become ready, under fresh proof, policy, identity and exact-head merge gates. See [existing-delivery follow-through](#existing-delivery-follow-through).
- Recovery preserves deferred work, refreshes analysis before charging, tries another candidate after a ticket-local refusal and reports stops with explicit resumption guidance. See the recovery contracts below.
- V2 project data, additive role instructions, fixed family/tier model policy and complete shared or project-owned runtimes replace copied partial workflows. See [project configuration](project-config.md) and [execution context](execution-context.md).
- Complete frozen child/parent ticket input, host filesystem gates, actual-user sandbox probes, passive CLI/Board readiness and explicit doctor probes are implemented. See [ticket readiness](ticket-readiness.md) and [image readiness](image-readiness.md).
- Local execution events and read-only telemetry export are implemented. See [telemetry](telemetry.md).

### Planned and deferred work

The [herdr-core spike](research/interactive-agents-herdr-core.md) supplies the adoption decision for slice 6, not a production integration. The standard workflow remains noninteractive Pi until that slice is delivered. Completion hand-back, exit propagation, orphan cleanup, initialization and compatibility with the current Pi workflow are slice 6 work. Reboot recovery and a person's real terminal remain untested. The [slice 6 epic](https://github.com/markdlabrecque/factory/issues/216) records the implementation plan and agent-sized tasks. Analysis, recovery and verification stay noninteractive; writable browser terminals and process resurrection after holder loss/reboot are out of scope.

A dedicated recovery Board interface is deferred. Recovery reports and reset are available through CLI commands; passive Board readiness does not provide recovery controls.

---

# Slice five: ticket journal

<!-- Ticket verdict and archive commands preserve raw run records; board/tickets.mts shares admission-locked validation with the board endpoint. -->
The shared store for manual ticket metadata (#98, `board/journal.mts`), from the slice 5 plan: comments, verdict corrections and archive state. `factory ticket comment|sync|verdict|archive|archived|show|restore` (#99-#102) and the board's Archive button and corrected-verdict display (#103) build on it; all listed commands and the board controls are implemented. Shipped/history cards expose an X button named "Archive ticket", hidden in file snapshots. It calls `POST /api/projects/<encoded-tracker-project>/tickets/<iid>/archive` with `x-factory: 1`. The server re-reads eligibility under the admission lock and refuses active or queued work with a JSON error. The card stays until success, and a failure is shown on the card for retry. Successful responses identify the archived execution, so a delayed response cannot hide a newer run loaded by polling. The tooltip explains that run data, logs and evidence are preserved. Effective verdict badges say "corrected" when manual, with the original verdict in their tooltip. Archive browsing and restore remain command-only. Journal read failures fall back to the raw result for presentation, so damaged manual metadata cannot interrupt stage updates or evidence access. Mutations still fail closed. Verdict and show commands validate the raw record's tracker project and ticket before using its run identity.

- **Storage.** `<state>/journal/<key>.json` (`keyFor(iid, TRACKER.project)`, folder 0700, files 0600), `{version: 1, project, iid, events}`. It is a subfolder, so the run-record scans (`readRuns`, `projectRuns`) never see it, and run records are never written by it. A file naming another project or ticket (two names that sanitize to one key), a corrupt file and an unknown version fail closed and are never overwritten. A ticket with no journal projects exactly as its run record reads.
- **Events** are only appended: a UUID `id` (the stable tracker marker), `kind` (`comment`, `verdict`, `archive`, `restore`), `project`, `iid`, `at`, `actor`, and `run`, the run identity it applies to (`runIdentity`: `execution:<executionId>` for new normal admissions, `started:<startedAt>` for legacy/manual runs; recovery retains the execution it repairs). `comment` has `text`; `verdict` has the explanation in `text` and `verdict: {from, to}`, `from` being the effective verdict before (taken under the lock) and `to` `PASS` or `FAIL` (`pass`/`fail` normalized). An empty comment or explanation, any other verdict, or a missing tracker project is refused before anything is written.
- **Projection** (`projectTicket(journal, run)`): `original` is the run record's verdict, `verdict` the latest correction for this run or else the original, `correction` that event; `archived` holds while the latest archive or restore event is an archive of this run; plus every comment and correction and the events not yet delivered. A new execution inherits neither a correction nor an archive. Archiving or restoring twice is a no-op (`setArchived` reports `changed: false` and writes nothing). Archive and restore are never posted.
- **Serialized writes.** Each mutation re-reads the journal under `<key>.lock` (created complete and hard-linked into place, naming its holder's pid and start identity, taken over only when that exact process is gone, never by age) and replaces the file durably (temp file, fsync, rename). Concurrent writers from several processes keep every event.
- **Delivery.** Comments and corrections start `pending`. `beginDelivery` gives one poster a token and marks the event `posting`, refusing another while that process lives; `finishDelivery` with that token records `delivered` with the tracker's comment id, or the error as `pending` (not posted) or `uncertain` (may have been posted). After an `uncertain` attempt or a poster that died while `posting`, the next `beginDelivery` returns `check: true`: search the tracker for the event's marker before posting again (`factory ticket sync`, #100).

- **`factory ticket verdict <ticket> --verdict pass|fail --message <explanation>`** requires an existing run and a non-empty explanation. `correctVerdict` saves one correction event with the previous effective verdict and current run, then `deliver` posts one manual-correction comment with the previous/new verdict, explanation, run and marker. The original verdict and execution stage stay untouched. Failure exits 1 with "saved locally; sync pending"; `ticket sync` retries the same event.
- **`factory ticket archive|restore <ticket>`** changes journal state only. `board/tickets.mts` exports `archiveTicket(dir, {project, iid}, archived, actor)`, returning `{changed, event?}`. It re-reads the raw run under `withAdmission`, verifies ticket identity, and for archive requires stage `done` and no live claim. This matches the board history group; stopped, waiting, queued and active work is refused. Restore is allowed at any stage. Repeats append nothing. Use this helper from the board endpoint rather than the unchecked journal primitive. Lock order is admission then journal. It never calls a tracker.
- **`factory ticket archived [--json]`** lists this project's currently archived runs, including original/effective verdict and archive time. **`factory ticket show <ticket> [--json]`** works while archived and shows run, original/effective verdict, archive state, comments, corrections, full history and pending/error delivery. A comment-only ticket is also readable. All ticket commands use the standard registered checkout or `--project <name|path>` resolution. Comment accepts `--message` as an alternative to positional text.
- **Board projection.** `buildBoardData` alone excludes archived cards from lists/counts and exposes `originalVerdict`, effective `verdict` and `manuallyCorrected`. `readRuns` remains raw for dispatcher/evidence access. Normal admission sets `executionId` even when its lifecycle start timestamp is retained. The selected runtime includes `journal.mts`; project-mode recovery review covers it as part of the complete inventory.
- **`factory ticket comment <ticket> <text> [--project <name|path>]`** (#99, `cli/src/commands/ticket.mts`). Saves the comment (`addComment`, with the current run's identity when the ticket has a run record) before any tracker call, then takes it with `beginDelivery` and posts `text` + `markerFor(id)` (`<!-- factory-journal:<id> -->`) through `gh api --hostname <host> -X POST repos/<project>/issues/<n>/comments` or `glab api --hostname <gitlabHost> -X POST projects/<encoded project>/issues/<n>/notes`, kind and host read from `.factory/factory.toml`. `finishDelivery` records `delivered` with the returned comment id; `pending` when the CLI could not start or the config names no host; `uncertain` when the CLI ran but failed or returned no id. Exit 0 when posted, 1 when saved but not posted.
- **`factory ticket sync [ticket] [--project <name|path>]`** (#100, `ticketSync` and `deliver` in `cli/src/commands/ticket.mts`; `ticket comment` posts through the same `deliver`). For each journal of the project (`<state>/journal/<key>--<n>.json`; a file that belongs to another project is skipped) or the one ticket named, each comment and correction not `delivered` is taken with `beginDelivery`. When it returns `check: true`, the ticket's comments are listed read-only (`gh api --hostname <host> --paginate repos/<project>/issues/<n>/comments?per_page=100`, or `glab api ... --paginate projects/<encoded>/issues/<n>/notes?per_page=100`; the concatenated page arrays are parsed) and a comment containing `markerFor(id)` is recorded as `delivered` with its id, without posting; a search that fails records the event `uncertain` again and posts nothing. Otherwise, or when not found, it posts `bodyFor(event)`: the text, with a correction prefixed `Manual verdict correction from X to Y.` and its run reference, and the marker. Busy events (a live poster) are skipped. Exit 0 when nothing is left undelivered, 1 otherwise.

Tests: `board/journal.test.mts`, `cli/test/ticket.test.mts`.

# Slice four: self-recovery requirements

Recovery uses the selected complete workflow. Factory mode needs no per-project review; project mode requires a current host-owned review. The following sections describe the current recovery contracts.

The implemented recovery workflow handles eligible jammed work without requiring a human to delete run state or branches:

- Reuse the existing dispatcher timer. After normal dispatch, require the same project jam on two consecutive completed passes: eligible queued demand and no active ticket runs.
- Include ready stopped tickets and unresolved dependency holds. Respect explicit exclusions, open PRs awaiting merge, progressing prerequisites and shared-capacity limits.
- Run at most one recovery agent per project inside Docker, using the family's Factory-policy Large model (`AGENT.model`). Make the smallest necessary repair on the affected ticket's branch, preserving commits, dirty worktrees and evidence. Stop on ambiguous branch/worktree ownership.
- Give the repair agent 15 minutes after container readiness. Setup, independent verification and delivery retain their normal limits. Cancel timed-out repair processes, preserve work and count the attempt as failed.
- Require normal separate verification and delivery after repair. Host services, credentials, other tickets' branches and remote branch deletion remain outside the helper's authority; it does not merge PRs.
- Allow two repair attempts per unchanged jam episode. Reset only after independently verified delivery progress by affected work, relevant human requirements/label changes, or explicit human reset. The helper's own activity and unrelated queue/base changes must not renew the budget.
- Add project-scoped `factory recovery status` and `factory recovery reset`. Reset refuses active recovery, preserves ticket work/evidence and leaves reevaluation to the normal timer. Keep it separate from `factory retry`.
- Show confirmation, attempts and outcomes through `factory status`, repair logs through `factory logs`, and report/reset details through recovery status. Defer a dedicated recovery board UI.
- Require a complete, reviewed project override when project mode is selected. Owners maintain their customizations; Factory does not merge them automatically.
- If a repair requires updating the host's selected runtime or complete project override, report the action and stop. Do not automatically apply it to the host checkout or restart services.

# Slice four: recovery state

Durable record for self-recovery (#55, `cli/src/recovery-state.mts`). It only stores and checks; it never reads the tracker or launches anything. Since #61 the tick's jam confirmation ("Slice four: jam confirmation") feeds it.

- **File.** `<state>/recovery/<key>.json` per project (`~/.local/state/factory/recovery/`), where `key` is the first 16 hex digits of the SHA-256 of the canonical root, and the file repeats `root`. `{version:1, root, nextSeq, episode?, episodes, budgets, attempts, renewals, watch?}`. Transitions run under an exclusive `<file>.lock` and write temp-file + rename, mode 0600. Missing means empty. A malformed file, or one naming another root, is reported and never overwritten; no attempt can start from it.
- **Episode and confirmation.** A jam is identified by its affected tickets (sorted iids). `observePass` takes only completed dispatcher passes, each counted once by its pass id. The same jam on two consecutive completed passes (`CONFIRM_PASSES`) is confirmed. A pass with a different jam ends the episode (`changed`) and starts a new one; a pass with no jam ends it (`cleared`). Ended episodes are kept in `episodes`. Since #75 a pass can carry the project's admission activity `generation` ("Slice four: launch admission"): a pass at a different generation than the episode's ends it (`changed`) and starts over, so a normal launch between two passes breaks a pending confirmation, and `attemptProblem` refuses an attempt on a jam confirmed at an older generation.
- **Attempts and budget.** `beginAttempt` needs a confirmed episode that includes the ticket, no other attempt running in the project, and budget left; it records a `running` attempt and spends one of the ticket's two attempts (`ATTEMPT_LIMIT`). It is idempotent by attempt UUID: an attempt already recorded is returned without charging again, and `replay` applies an attempt the admission record already admitted (#75) without rechecking it. `finishAttempt` records `repaired`, `failed`, `timed-out`, `blocked` or `interrupted`, with optional reason, log and report paths; the budget stays spent. Budgets are per ticket and survive the episode ending, so the helper's own activity and unrelated queue changes never renew them.
- **Renewal and reset.** `renewBudget` restores one ticket's two attempts after verified delivery progress by that ticket (`progress`) or an attributable human requirement change (`requirement-change`). `resetRecovery` is the explicit project reset: refused while an attempt runs; ends the episode (`reset`), so confirmation starts over on later passes; renews every ticket's budget; keeps history; launches nothing.
- **Tracked renewal** (#56). `watch` keeps, per ticket, the last observed requirement fingerprint and verified delivery: `{seenAt, content, labels, delivery?}`. `observeTicket` takes the ticket's current `content` (the dispatcher's `unitHash`: title, description, parent and comments, leaving out Sandcastle's own and system notes), its `labels` minus those Factory writes itself (the `ready` labels, `needs-human`, the done stage), and `delivery` from `deliveryMarker(run)`: `delivered <mr>` or `merged <mr>` for a `done` record whose verifier passed and whose branch was delivered, nothing for a stopped, failing, unpushed or reserved one. The first observation only sets the baseline. A changed content hash or label set renews a spent budget as `requirement-change` (detail names the change, e.g. `labels +model:opus -model:sonnet`); a new delivery marker renews it as `progress`. Unchanged observations, label order, a repeated delivery and the helper's unverified work renew nothing; a missing marker keeps the last one; an unspent budget only moves the baseline. Since #61 the jam confirmation observes, after each completed scheduled pass, every ticket the dispatcher reports (jammed, or still ready with a stopped or done run).
- **History.** `episodes`, `attempts` and `renewals` keep the newest 100 entries each (`LOG_LIMIT`) for reports. The per-ticket `budgets` counters, not the history, decide whether another attempt is allowed.

<!-- Recovery validation is read-only; typed ticket refusals alone permit another candidate in a confirmed pass. -->
# Slice four: resuming recorded work

A repair continues the affected ticket's own work (#59, `cli/src/recovery-workspace.mts`). `resumeTarget(root, run)` reads the ticket's run record and the project's Git state (local refs, origin refs as last fetched, `git worktree list`; no network) and returns the branch, its tip, the evidence folder and any worktree to reuse, or the reason the attempt must not start. It is read-only: it never creates, deletes, checks out or prunes anything. The recovery launcher (#60, `launchRecovery`) calls it before `claimRecovery` and passes the accepted branch on, with the ticket's ownership receipt (#75, below).

- **Accepted.** The record names an existing base commit or branch. The branch the record names, shaped `<ticket>-<slug>` as `main.mts` creates it, existing locally, with no other local `<ticket>-*` branch. An origin copy is fine when the local branch already contains it. The branch may be checked out in at most one worktree, inside Sandcastle's worktree folder (`<root>/.factory/worktrees/`) and present on disk; its uncommitted and untracked files are listed so the repair keeps them. With no worktree, Sandcastle checks the branch out afresh. A recorded evidence folder must be exactly the ticket's own `<root>/.factory/evidence/<ticket>` or `<root>/.factory/evidence/<ticket>/<executionId>` with a valid recorded execution UUID. Missing evidence keeps the existing absent-evidence behavior; a missing field defaults to the ticket root. Execution identity comes from the saved run, not a guessed basename or the recovery attempt/ownership receipt UUID. Lexical traversal, foreign tickets/executions, arbitrary descendants and escaping or dangling symlink aliases are refused. The validated directory is carried into the attempt record as `previousEvidence`, without moving evidence or rewriting the saved run's identity.
- **Refused as ambiguous ownership.** No recorded branch (recovery never creates or guesses one, or restarts from scratch); a recorded branch that is not this ticket's or no longer exists (a branch only on origin is returned with `remoteOnly` instead; see below); a second local branch for the ticket; an origin copy with commits the local branch lacks; the branch checked out in the project's own checkout, in a worktree outside Sandcastle's folder, or in a registered worktree whose folder is missing; another ticket's evidence folder.
- **Ownership receipts** (#75, `orchestrator/ownership.mts` in the selected runtime). `<state>/ownership/<projectId>/<ticket>.json` (folders 0700, file 0600, temp file + fsync + rename), with `projectId = sha256(realpath(projectRoot) + "\0" + trackerKind + "\0" + trackerHost + "\0" + trackerProject)`, holds `{projectRoot, gitCommonDir, ticket, branch, base, worktreePath, runId, creationIntent: {branch, worktree, at}, branchSha?, worktreeAt?}`. It is written before anything is created (a normal `main.mts` run before Sandcastle creates its branch and worktree, `runId` being its launch claim token; the launcher before it adds a worktree or creates a branch from origin, `runId` being the attempt UUID), and the identities are filled in as each step completes. With a receipt, `resumeTarget` also requires the same project root and Git common directory, ticket and branch, a branch that still contains the recorded `branchSha`, and a worktree at the receipt's `worktreePath`; an intent with no identity (a crash between the receipt and the creation) is reconciled from Git (`reconcile`, filled in by the launcher), or refused when the branch was never created. Without one (a run stopped before the upgrade), only the exact recorded branch is accepted, with at most the one canonical worktree (`.factory/worktrees/<branch>`) whose Git common directory is the project's; the launcher then writes the receipt (`adopt`). Receipts are never deleted, by `factory retry` or anything else. A receipt with an old or uncertain worktree layout is never rewritten or adopted by `.factory`. Run records, evidence paths and historical baselines are not translated. Already-owned exact-container cleanup and local settlement remain possible during a layout hold, using saved attempt identity, not new launch authority.
- **Remote-only branch** (#75, `fetchRecordedBranch`). When the recorded branch exists only on origin and no claim protects the ticket, the launcher records the intent, then asks origin for exactly `refs/heads/<branch>` (refusing when none or several refs match, since `ls-remote` matches by tail), fetches it into `refs/remotes/origin/<branch>` without `+` (a non-fast-forward update is refused, not forced), checks the fetched commit is the one advertised and contains the receipt's recorded commit, and creates the local branch with `git update-ref refs/heads/<branch> <sha> ""` (only if it does not exist). Then `resumeTarget` runs again.
- Tests: `cli/test/recovery-workspace.test.mts`, against disposable Git repos.

<!-- #150: normal and repaired delivery require fresh immutable host proof and unchanged requirements. -->
# Slice four: shared verification and delivery

Policy-1 delivery now requires the verifier's structured criterion report and a
host-only frozen proof (`orchestrator/verification.mts`). Both entrypoints bind the
execution, recovery UUID if applicable, recorded historical baseline, verified tip,
starting complete child/parent included-source hash, artifact hashes and runtime/workflow provenance after teardown.
Legacy PASS is never proof. Missing baseline or execution identity requires explicit
human review or newly established verification, not today's fetched base as a fallback.
Requirements/eligibility/claim changes refuse delivery; exact-SHA nonforced push and
remote confirmation precede delivery. Both adapters reauthorize after CI, immediately
before SHA-guarded auto merge; manual merge remains manual. An external edit can still
race after the last tracker read. Project owners must review custom prompts and helpers and renew project-mode recovery review when the selected identity changes. No continuation
loop, scheduler change or historical record migration is included.

A repaired branch goes through the same hand-off as an implemented one (#58, `orchestrator/handoff.mts` in the selected runtime). `main.mts` calls it after its implementer, and `main.mts --recover` (#60) after its repair agent.

- **`runVerifier`** runs the independent verifier in the run's sandbox: `prompt.verify.md`, `AGENT.model`, one iteration, `TIP_SHA` set to the tip being verified. A verifier that commits, moves `HEAD` or leaves the worktree dirty is refused before anything is posted or pushed. First, `beginVerification` deletes an earlier `verdict.md` from the ticket's evidence folder and clears the record's `verdict`, `mr` and `mergedAt`, so on a reused record and evidence folder only this run's verdict counts and a stale PASS never reads as delivery (`deliveryMarker`). Other evidence is kept.
- **`postAndDeliver`** posts the verdict and before/after media to the ticket, then only on PASS pushes the branch, lists conflicts with other live branches and calls the tracker's normal `deliver` with the same CI limits (`CONFIG.ciWaitMinutes`, `noPipelineMinutes`) and merge policy (`MERGE.auto`). It leaves the record `done` with verdict and PR, or returns the reason it stopped (no verdict, not PASS, push or delivery failed), which the caller records as `stopped`. A repaired branch (`origin: {kind: "repaired", attempt}`) says `Repaired by Factory recovery attempt N, then verified independently.` in the evidence comment and the PR; otherwise the text is unchanged.
- Host calls (board, tracker, git) are passed in, so the module imports no config, tracker or board file and is tested with fakes (`orchestrator/handoff.test.mts`). A custom project workflow owns the complete selected inventory.
- **Prerequisite recheck** (#75, `prerequisiteHold`). A recovery run calls it before verification and again before delivery with the dispatcher's analysis of the ticket (its manifest under `<state>/graph/`): every analysed requirement and implementer-reported blocker that names another ticket must be closed or merged into its base, so a prerequisite with a run in flight or an open PR holds the ticket (the attempt ends `unresolved`, nothing delivered). A missing or out-of-date analysis, or a tracker lookup that fails, is unknown and holds too. Normal runs do not call it.
- Not handled here: a preserved branch whose PR is already open (open PRs are not jams, so a recovery should not reach delivery with one), and merging (still the tracker's `deliver` and `MERGE.auto`). The attempt's outcome is recorded by the launcher (see "Slice four: bounded repair attempts").

# Existing-delivery follow-through

A verified branch can have an open PR/MR whose required checks are not ready when the initial delivery wait ends. The host stores a strict version-1 `delivery` checkpoint on the run, binding tracker kind/host/repository, PR/MR number and URL, source/base branches, exact head SHA, project/ticket/execution and host proof ID. States are `ci-waiting`, `operator-required` and `merged`, with a bounded reason code and observation time. Legacy PASS notes and PR URLs do not create a checkpoint or authorize continuation.

Only a non-dry scheduled dispatch with automatic merge enabled continues `ci-waiting` checkpoints. Manual dispatch, direct runs, dry runs and read-only refresh do not perform this continuation. Each pass considers at most ten waits, oldest observation first. It starts no implementer, repair agent or verifier, spends no recovery attempt, posts no new evidence comment and creates no replacement PR/MR.

Continuation takes a delivery admission claim and revalidates the frozen PASS proof, historical baseline, execution/branch identity, complete selected runtime inventory and normalized settings. It also requires unchanged local and remote head SHAs, current complete ticket/parent input, selection/eligibility, no exclusion or needs-human label, the same checked-out base, and live scheduler/project authorization through the trusted saved CLI/Node. Capacity and conflicting ownership can hold the observation. Current checks, review and merge restrictions still apply. Both tracker adapters reauthorize immediately before exact-head merge; a remote ticket edit can still race the last read.

One observation has a total 30-second deadline and at most 10 seconds per subprocess. Pending or missing checks and unknown tracker responses stay retryable on the same recorded PR/MR. Failed checks, identity/proof/settings changes, draft/closed PRs or merge restrictions can require operator action. An ambiguous merge response does not justify a second PR or a blind repair; the next eligible pass observes the same identity. Token-fenced completion discards stale observers. Only confirmed merge records completion.

Inspect the run through `factory status`, its logs and evidence. An `operator-required` checkpoint is not automatically retried as a CI wait. Preserve the branch and proof artifacts, resolve the named gate and obtain fresh verification or owner review when inputs changed. Recovery reset is not delivery authorization. See [verification contracts](#slice-four-shared-verification-and-delivery), [execution context](execution-context.md#frozen-inputs-and-proof) and [continuation tests](../TESTING.md#existing-delivery-continuation-tests).

# Merged-work reconciliation and local cleanup

Dispatch reconciles stopped, queued or waiting records whose recorded work merged outside Factory. With a host checkpoint, it observes that exact PR/MR identity; without one, the adapters can look up a merged change by recorded branch or ticket-title reference into the expected base. A closed ticket alone is not merge evidence. Dry runs report what would change. A live reconciliation updates the card only if its stage and ownership still permit it, preserves its verdict/history, and closes a Task or advances the whole ticket as appropriate. Tracker-update failure is reported separately from the local merge observation. Reconciliation does not launch an agent.

```sh
factory clean --dry-run --project <name-or-path>
factory clean --project <name-or-path> --json
```

Cleanup is offline and project-scoped. A candidate must have a `done` record with `mergedAt`, no recorded recovery/start reservation, and an existing local `<ticket>-<slug>` branch. Its tip must already be contained in a local/origin base ref or the last-fetched origin ticket-branch ref. This permits a pushed squash-merged branch but keeps unpushed commits. Cleanup never fetches, pushes or deletes remote branches.

A branch checked out in the project root or a foreign worktree is kept. Factory-owned worktrees under `.factory/worktrees/` must have no uncommitted or untracked changes. Before mutation, cleanup re-reads the run; it removes clean worktrees without force and deletes the branch only by compare-and-swap against the checked tip. Missing registered worktrees can be pruned. Kept and failed entries include reasons. `--dry-run` reports candidates without deleting anything; JSON contains `project`, `root`, `dryRun`, `removed`, `kept` and `failed`. A failed removal exits 1; safely kept work does not.

The tick runs the same cleanup after each completed scheduled pass. Run records, ownership receipts, evidence, logs, journals and telemetry remain untouched. This is not an arbitrary stale-worktree remover or a substitute for inspecting an ownership/cleanup hold.

# Frozen ticket input

The standard workflow collects complete structured child and immediate-parent bodies
and planning comments on the host before analysis or implementation. Failed required
reads hold only that ticket, without a new stopped record or needs-human label.
Readable configured instructions/templates are also required. Normal, read-only
analysis, repair and independent verifier prompts use frozen rendered task bytes;
the sandbox gets no tracker credentials. Host-owned source manifests and rendered
bytes are saved under `<state>/ticket-inputs/`, separate from agent-writable evidence.
See [ticket readiness](ticket-readiness.md#frozen-input-holds-and-evidence) for paths,
hashes, typed diagnostics and custom-workflow coverage.

Analysis and proof freshness include parent human-plan bytes. An edit requires fresh
analysis/verification; generated Factory comments do not invalidate their own proof.
Current source checks before verification/delivery never rewrite a running prompt
or an old proof. Existing claim, eligibility, base/tip, budget and cleanup gates remain.

# Recovery execution-analysis preparation

A current Board assessment does not authorize recovery. After a confirmed jam,
read-only local candidate screening can skip proven ticket refusals. Once one target
passes that screening, the host runs the selected `recovery-analysis.mts` through
`cli/src/recovery-prepare.mts` and rechecks scheduling authorization. Nothing scans
past that target after analysis starts. Preparation is not a repair attempt and
never renews or charges a budget.

The selected helper reads current ticket, parent and human-note inputs, the open provider
catalogue and reliably read previously named providers, and fetches the recorded
origin base exactly. Its optional execution-manifest `recoveryAnalysisKey` hashes
complete included child/parent source bytes, base identity, provider descriptions, saved implementer
blockers, analysis prompt bytes, model/provider and schema. Missing keys are stale,
not lost history. Identical inputs reuse successful execution analysis; changed
inputs run the existing read-only analyst in an invocation-specific detached
workspace. Saved branches, dirty implementation worktrees, evidence, actual footprint
and implementer blockers are retained. Only clean invocation-owned analysis
workspaces are removed, without force; dirty or unconfirmed workspaces are reported.

Inputs are read again after analysis and live prerequisite checks. Unknown,
unlinked and human-only prerequisites hold recovery. Known dependencies can retain
their identities after closing; fresh dependency evidence still decides readiness.
Successful analysis is atomically published with a short per-ticket publication
lock and compare-and-swap against the original manifest bytes. A concurrent winner
is usable only for the same fresh key. Assessments and historical run verdicts are
never rewritten by preparation.

The helper emits one bounded version-1 JSON result, `ready`, `held` or `error`,
with typed codes and ticket/project scope. Only ready carries the exact project,
ticket, root, base, requirements hash, base SHA, analysis key and manifest digest.
The wrapper uses saved scheduler Node/PATH and shared state, with an AbortSignal
and its own process group. Total preparation time is the configured analysis timeout
plus 60 seconds; tracker/Git setup operations have at most 20 seconds each. Exit,
cancellation and timeout terminate only that owned group and require confirmed
cleanup before accepting a result. Unconfirmed ownership leaves a
`<state>/recovery/prepare-<root-hash>.json` stop record. Confirm the named group is
gone and any reported workspace has been inspected before removing that record;
it is never cleared by age or a budget reset.

Missing/unreviewed helpers, malformed output, changed inputs, analysis failure,
timeout and prerequisite holds consume zero attempts. The last preparation code,
scope and reason appear separately in recovery status and the ticket's recovery
log, without replacing attempt history. The follow-up projection also shows current
preparation holds as waiting or operator-required observations; active ownership,
project pause, exhausted budgets and authoritative merged completion keep priority. Direct launcher calls without preparation
refuse. Before admission commits its charge, it checks the target is still stopped,
the exact manifest digest/key and recorded base match, and the local origin-base
SHA still matches. These additional checks use file reads under admission and
publication locks, with no tracker or agent subprocess. External tracker edits can
still race after preparation, so the existing requirements/prerequisite checks before
verification and delivery remain required. This is not an atomic remote-ticket
transaction or permission to bypass independent verification.

# Slice four: bounded repair attempts

One repair attempt on a jammed ticket (#60, continued and verified by #74): `cli/src/recovery-run.mts` on the host; `main.mts --recover`, `orchestrator/recovery.mts` (the attempt lifecycle, `runRecoveryAttempt`) and `orchestrator/recovery-sandbox.mts` (the attempt's own container and Git boundary) in the selected runtime; `orchestrator/prompt.recover.md` as the repair agent's prompt. The tick performs local settlement before each project's dispatch/pause gate and again after completed scheduled passes. Only jam confirmation after a successful pass launches an attempt for a confirmed jam's ticket ("Slice four: jam confirmation"). Factory mode uses the installed bundle; a project override needs a recorded review ("Slice four: reviewed recovery workflow"). The acceptance map against the original #60 requirements is [recovery-60-verification.md](recovery-60-verification.md).

- **Launch** (`launchRecovery(p, {root, tracker, ticket, preparation})`). Requires the validated execution preparation described above. The caller settles the project's previous attempt separately. Launch validation itself is read-only and holds while any attempt, recovery claim or pending charge remains unsettled. It checks shared capacity, claims, budget, stopped run state, identity and workflow review before considering a ticket refusal. Then the ticket's run record must pass `resumeTarget` with its ownership receipt (keyed by the project id from the checkout and the tracker kind, host and project in `.factory/factory.toml`; a branch only on origin is first fetched exactly, see "Slice four: resuming recorded work"; a pre-upgrade run's exact branch is adopted into a receipt, and missing identities are filled in from Git) and name a base branch, and the selected workflow must validate, and a project override must match its recorded review ("Slice four: reviewed recovery workflow"). The launcher picks the attempt's UUID and its exact container name, `factory-recovery-<uuid>`; `claimRecovery` then takes capacity, the ticket and the whole project with the attempt's charge in one admission record replacement ("Slice four: launch admission"), recording the attempt with that UUID, container name and its attempt-record path (and the UUID on the run record's `recovery.id`). A missing Factory worktree for the recorded branch is added with `git worktree add` (never a reset), after the receipt records the intent. The launcher writes the host-owned attempt record, `<state>/recovery/attempts/<uuid>.json` (phase `claimed`: ticket, branch, base, recorded tip, worktree, container, evidence and private-Git paths), and spawns saved Node with the selected private tsx and `main.mts --issue <t> --base <b> --recover <n> --attempt-record <file>` from the root, detached into its own process group (like a dispatched ticket run, so cancelling a dispatcher pass or `factory schedule off` never reaches it), with `SANDCASTLE_STATE_DIR` set and output appended to `.factory/logs/recover-<t>.log`, and hands the claim to the child's pid at once (`main.mts` adopts it and fences its board writes with the token). A spawn that fails ends the attempt `interrupted` and releases the claim once docker confirms the container absent. A refusal spawns nothing.
- **Typed launch results.** `started` has `admitted: true` and the actual attempt, pid, branch and log. `ticket-refused` has `admitted: false`, a stable code and an actionable reason from read-only validation. Local codes are `branch-missing`, `branch-invalid`, `base-missing`, `base-invalid`, `branches-ambiguous`, `branch-diverged`, `worktree-not-owned` and `evidence-mismatch`. `project-stopped` has `admitted: false` and a code/reason for shared uncertainty or any failure after preparation starts. Git/IO failures, unavailable identity, malformed shared stores, unknown receipt ownership, review failure, capacity and claim rejection are project stops, never inferred from message text. Remote-only branches may proceed to exact fetch, but any failure from intent writing, fetching, receipt adoption/reconciliation or later validation stops the scan even without a charge. `admitted-failed` has `admitted: true`, the actual charged attempt and its reason. Spawn, attempt-record and post-commit failures never refund the attempt. If a committed charge cannot be recovered safely, the stopping exception propagates.
- **Admission recheck.** Under the admission lock, the stored candidate must still be stopped before dead-process reconciliation, with the same recorded branch, base, evidence location, execution and ownership identity. The confirmed episode and activity generation, workspace tip/path and workflow review must still agree with validation. Atomic claim-plus-charge and `replayAdmitted` remain unchanged. Recovery run reads never reconcile records or skip malformed shared records.
- **The attempt** (`main.mts --recover`, `runRecoveryAttempt`). Before any Git or container side effect, the attempt record, the claimed run record and the arguments must name the same project, ticket, branch, base and attempt (number and UUID), the record must still be `claimed` (an attempt never runs twice), and the worktree must be inside `.factory/worktrees/`; `--no-push` is not allowed. The worktree's HEAD must still be the recorded tip (else `ownership-refused`). The input (HEAD, status, staged and unstaged diffs) is snapshotted into this attempt's evidence folder, `.factory/evidence/<ticket>/recovery/<uuid>/`, created fresh with `recovery-context.json`, `previous-run.json`, `previous-logs/`, `history/` (a read-only copy of the validated saved evidence directory, not sibling executions; legacy attempt records retain ticket-root history) and `input/`; earlier `verdict.md`, `blocked.json` and media are never removed. The record says `setup` before the container is created and gets the sandbox id once known.
- **The container** (`recovery-sandbox.mts`). Not Sandcastle's `createSandbox`, whose worktree manager prunes/removes worktrees, fast-forwards an existing branch and mounts the common Git directory writable. `docker run -d --name factory-recovery-<uuid> --label factory.recovery.attempt=<uuid>` with the configured image, uid:gid and `sandboxSetup`; the existing worktree at `/home/agent/workspace`; a read-only gitfile over its `.git` pointing at attempt-private Git metadata (a clone of only the ticket's branch with the worktree's index and staged blobs, no remote); this attempt's evidence folder writable with its snapshots mounted read-only; `.factory/sandbox` read-only. No Docker socket, common Git directory or other evidence; `.factory/.env` values reach the container by name through the docker client's environment, never on its arguments. Agents run the provider's print command with `docker exec`.
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
- **Launching.** For a confirmed jam, scan its initially stopped candidates once in ascending numeric ticket order. Skip a ticket only when its own attempt budget is exhausted under the current rules. A dependency-held ticket has no work of its own; its stopped prerequisite is repaired. If the selected workflow is invalid or a project override lacks a current review (`recoveryCopyProblem`, #63), the jam is only recorded and logged. Before every candidate, recheck scheduling/cancellation, reread the run, recovery episode, activity generation and review. Read-only `inspectRecoveryCandidate` continues only after `ticket-refused`, logging the ticket, stable code and reason. The first locally viable target gets execution-analysis preparation, then scheduling authorization is rechecked before launch. A preparation hold or any later outcome ends the scan without trying another target. Stop on `project-stopped`, `admitted-failed`, the first `started` result or any exception. `launchRecovery` rechecks admission under the shared lock, so at most one candidate can be admitted per pass. All-local-refusal passes spend no budget. There is no refusal cache; a later eligible pass rechecks local facts. No labels, requirements, saved work, evidence or receipts are deleted to advance the scan. After it settles, the next pass with the same unchanged jam can start the ticket's second attempt; then the budget stops it until verified progress, a requirement change or a reset.
- Logged to the tick's output as `recovery <project>: …`. What it recorded is shown by `factory recovery status`, summarized in `factory status`, and the repair logs by `factory logs --recovery`; see "Slice four: recovery status and reset". Errors here are logged and never fail the pass or the tick.
- Tests: `orchestrator/graph.test.mts` (the rule), `orchestrator/jam-report.test.mts` (the real scaffolded dispatcher writing a report against a stubbed `gh`), `cli/test/jam-detect.test.mts` (confirmation, inactive copies, stopped scheduling, running attempts, generations, budgets) and `cli/test/scheduler.test.mts` (one report per pass, removed afterwards; failed and cancelled passes not counted).

# Persistent deferred recovery follow-through

`cli/src/recovery-followup.mts` runs local maintenance for each registered project while the tick lock is held, before its dispatch/pause gate. It calls the existing `settleRecovery` owner/exact-container checks and observes saved work. A paused project gets settlement, but no dispatch, analysis refresh or agent launch. Global scheduler off/unknown and cancellation still stop maintenance. Maintenance errors are logged and suppress recovery launch for that project this tick without changing normal pass outcomes.

Stopped tickets with saved branches remain outstanding when competing recovery ends. Later eligible successful passes reconsider them through fresh dispatcher reports, normal two-pass jam confirmation, reviewed workflow checks and admission. Maintenance and persisted observations never count as passes or authorize launch. Stale or unknown prerequisites still hold the normal handoff; only the dispatcher refresh path can obtain current analysis. Budgets are not renewed by another ticket finishing, a pause, restart or analysis refresh. Exhaustion requires verified progress, an attributable requirement change or an explicit operator reset.

The optional version-1 `followups` map is keyed by ticket id. Each entry has `state`, `reason`, `nextAction` and `changedAt`. Missing maps remain valid. Malformed snapshots fail closed, and unchanged observations preserve timestamps without repeated events. Updates use the recovery-state lock and atomic replacement. Another attempt finishing never removes outstanding saved work; authoritative merge records complete it, and actual removal of the relevant recorded work retires the entry. Read/write errors preserve previous observations and are reported.

Status reprojects current local facts rather than treating the snapshot as truth. Outstanding-work priority is uncertain ownership, active recovery, project pause/opt-out, exhausted budget, recorded host/delivery gate, then pending recheck. States are `operator-required`, `waiting`, `paused`, `pending`, and `complete`. A delivered recovery attempt means handoff finished, not that the ticket merged. An opened PR or delivery-waiting record remains outstanding through independent verification, CI, review and confirmed merge. Only a local authoritative merged record reports `complete`; prose, PR URLs and old verdicts never authorize completion or satisfy host prerequisites.

`factory recovery status` and its JSON `recovery.followups` show each reason and next action. Reading status never settles processes, probes containers, writes observations or launches work. No new command, configuration or Board UI is required. Factory-mode recovery needs no per-project review. Project-mode recovery requires a current review of the complete override.

# Slice four: recovery status and reset

Operator view and explicit reset (#62, `cli/src/commands/recovery.mts`).

- **`factory recovery status [--project <name|path>] [--json]`.** Read-only. Whether recovery is active in the project (`recoveryCopyProblem`: the reviewed workflow, #63), the current jam (its tickets, how many of the two passes have seen it, or when it was confirmed), the last preparation code/scope/reason, the running attempt and any recovery claim in the admission record, each ticket's budget (attempts left of two, and the last renewal: `progress`, `requirement-change` or `reset`), the last ten attempts newest first (outcome, start and finish, branch, reason, repair log and retained `recovery-report.md`, each marked `(missing)` if the file is gone), renewals and ended jams. `--json` prints `{version:1, project, recovery}`. A malformed recovery record (never overwritten) is shown as a problem and exits 1.
- **`factory recovery reset [--project <name|path>]`.** Under the admission lock, so it cannot interleave with a launch, it refuses (exit 1, nothing changed) while recovery is active: a running attempt or one whose container is not yet confirmed gone (the next globally enabled tick settles it locally, even while the project is paused), a recovery claim, or an admitted attempt whose charge is still pending. Otherwise `resetRecovery`: the jam episode ends (`reset`), so confirmation starts over on later completed passes, and every ticket's budget is renewed. It launches nothing; the normal scheduled passes re-evaluate the project. Ticket branches, worktrees, run records, logs, reports and evidence are untouched, and recovery history is kept. It is separate from `factory retry`, which clears one stopped run.
- Follow-up state, reason and next action appear in both status formats as described in [Persistent deferred recovery follow-through](#persistent-deferred-recovery-follow-through).
- **`factory status`** adds a `Recovery:` line after the project's schedule (active or inactive, and the jam), the running attempt, the last finished attempt and its outcome, and tickets with spent budget; `--json` adds `recovery` (the same summary as `recovery status --json`).
- **`factory logs [ticket] --recovery`** prints `.factory/logs/recover-<n>.log` (every attempt on the ticket appends to it), or the project's newest one without a ticket; `-f` follows as for run logs.
- Tests: `cli/test/recovery-command.test.mts`.

# Slice four: reviewed recovery workflow

The self-recovery workflow gate is in `cli/src/recovery-review.mts`.

- **Factory mode.** A validated installed bundle needs no per-project recovery review. Init does not copy or review workflow code.
- **Project mode.** Review the entire selected inventory, including prompts, helpers, package metadata and private dependencies. The authoritative inventory is `cli/src/runtime-assets.mts`. `factory recovery review [--project <name|path>]` lists a valid selected inventory without recording a review. After inspecting it, `factory recovery review --confirm [--project <name|path>]` records the review and launches nothing. Invalid or incomplete bundles cannot be confirmed.
- **Review record.** The host-owned version 2 record at `<state>/recovery/<key>.review.json` binds mode, canonical workflow root, content identity, file hashes and dependency hash. Changing the override, its location or dependencies invalidates review. Manifest regeneration is separate and does not itself review code. A review does not bypass admission, proof, cleanup or budget gates.
- Tests: `cli/test/recovery-command.test.mts` and `orchestrator/workflow.test.mts`.

# Slice four: scheduled recovery across restart and failure

The end-to-end proof of the scheduled recovery path (#64): `cli/test/recovery-schedule.test.mts`. Every tick is its own process (`cli/test/fixtures/tick-recovery.mts`, which is `factory tick` with synthetic execution preparation and the repair command swapped for a stand-in) against the stateful `systemctl` stub, so only Factory's files carry over between ticks. The dispatcher is a real `dispatch.sh` reporting a jam on a stopped ticket with a preserved branch, dirty worktree and evidence. Jam confirmation, `launchRecovery`, `settleRecovery`, `factory schedule off|on` and `factory recovery review|reset` are the real code; `docker` is a stub that accepts only exact-name `rm -f` and `container inspect`. In one sequence it shows:

- One completed pass only sees a jam. A tick killed mid-pass, after its dispatcher wrote a report, never counts that pass; the next tick clears its leftovers. The next completed pass confirms the jam and starts exactly one repair, detached in its own process group, which outlives the tick and owns its recovery claim.
- `factory schedule off` while a later tick's pass runs cancels that tick (exit 143) and pass only. The repair keeps running and keeps its claim; the cancelled pass is not handed to recovery; a tick while off launches nothing. Back on, passes are not counted while the repair runs.
- A repair that crashes while docker cannot confirm its exact container gone keeps the attempt `running` and the claim on the ticket, a slot and the project, tick after tick. Once docker confirms it gone, the attempt settles `interrupted` and the unchanged jam gets its second attempt.
- After the second attempt fails, repairs stop on the spent budget across later ticks, and the claim is released. `factory recovery reset` launches nothing; confirmation starts over on the next two completed passes, which start a third attempt.
- Throughout, the ticket's branch tip, uncommitted work and earlier evidence are unchanged, docker only ever named the attempts' own containers, and no `systemctl` or `docker` call was rejected.

Finding fixed: a repair process that crashed while its parent never reaps children (for example a container whose PID 1 does not reap) stayed a zombie, which `ownerState` read as a live owner, so the attempt never settled and held the project indefinitely. `processStart` (`board/admission.mts`) now treats a zombie as gone, on Linux from `/proc/<pid>/stat` and elsewhere from `ps -o stat=`. The host's settle step uses Factory's own admission code. Test: `cli/test/recovery-claim.test.mts`.

Not proven here: systemd's timer, real Docker, `main.mts --recover` itself (`orchestrator/recovery-entrypoint.test.mts` covers it), a real agent or tracker, or macOS launchd (the launcher and settle step are the same code there).

# Slice four: scheduler storage

Storage and opt-in contracts (`cli/src/schedule.mts`); `factory schedule` changes them and the tick reads them (see "Slice four: the Linux scheduler").

- **No global switch.** Factory stores no on/off flag. Scheduling is on when the service manager reports `factory-tick.timer` enabled and active; a `scheduler.json` left by earlier builds is ignored. A failed query is `unknown`, which blocks scheduled work like off does.
- **Launch configuration.** `~/.config/factory/schedule.json`, `{"version":1,"path":string,"node":string}`, written atomically (mode 0600) by `schedule on`. PATH only, and an absolute Node. Missing means nothing was saved (not that the timer is off); malformed or unsupported content is reported and never replaced. Members from earlier builds, such as `enabled`, are dropped.
- **Project switch.** The optional `schedule: {enabled, branch, since}` on a registry entry, written under the registry lock. Missing means off, so `project add` (and a re-add after `rm`) starts off. `setProjectSchedule(root, true)` requires a registered, present checkout with a branch checked out (no detached HEAD) and an `origin` remote that has that branch as of the last fetch (no network call), then saves the branch. `false` keeps the saved branch and stores nothing for a project never opted in. An entry with a malformed `schedule` makes the registry unsupported. `copyProblem(root)` is the second gate (`schedule on --project` and every tick): the selected complete workflow must validate and its `dispatch.sh` must be executable.
- **Why not.** `scheduleBlocker(scheduling, project, exists, branch)` returns null when a scheduled pass may run, else the first of: `scheduler is off (<reason>)`, `scheduler state unknown (<reason>)`, `project not opted in`, `project paused`, `checkout missing`, `checkout is on <x>, scheduled branch is <y>`. Scheduled work never switches branches.
- **Tick observations.** `<state>/scheduler/state.json` (`cli/src/schedule-state.mts`): `{version:1, nextRoot?, startedAt?, finishedAt?, durationMs?, pid?, currentRoot?, projects: {<root>: {attemptedAt, finishedAt?, durationMs?, pid?, result, reason?, exitCode?}}}`, `result` one of `running|ok|skipped|error|interrupted`. It records what ran and is never a switch. Only the tick that holds the lock writes it. A malformed file stops the tick and is left alone. `nextRoot` is the project that goes first next tick (see "Tick").
- **Timing history.** `<state>/scheduler/history.json` (`schedule-state.mts`): `{version:1, entries:[...]}`, oldest first, at most `HISTORY_LIMIT` (1000) entries, the oldest dropped on append. `{kind:"pass", tick?, root, name?, startedAt, finishedAt?, durationMs?, pid?, result: ok|error|interrupted, exitCode?, reason?}` is added when a pass ends (including a cancelled one, and one whose leftover group is unconfirmed), `tick` being its tick's `startedAt`. `{kind:"tick", startedAt, finishedAt?, durationMs?, pid?, result: done|failed|interrupted|off|unknown, reason?}` is added when a tick that took the lock ends (`off`/`unknown` when the manager stopped it mid-tick). Durations are monotonic. A tick or pass that died, or was killed by `cancelTick`, is added as `interrupted` by `markInterrupted` (the next tick or the cancellation) without an invented finish or duration, and only once. Skipped projects and ticks that never took the lock are not history. Appends are best effort: a malformed file is logged (`timing history not recorded: …`), left alone and not appended to, and never stops a tick or cancellation. It is observation only; nothing reads it as a switch or timeout. Shown by `factory status` and `schedule status` (see "Scheduler health").
- `factory project ls` shows `[scheduled: <branch>]` or `[schedule paused]`; `--json` rows carry `schedule` when set.

Tests: `cli/test/schedule.test.mts`.

# Slice four: launch admission

The cap from each project's `dispatch.max_concurrent` configuration is counted from the shared board. A dispatched `main.mts` writes its first record only after its tracker calls and fetch, so without more a pass that followed closely (the next project in a scheduled tick) could miss the runs just launched and overfill the cap, or launch the same ticket twice.

- **Reservation.** As it spawns each run, `dispatch.mts` calls `reserveRun()` (`board/board.mts`): the record gets stage `setup`, note `starting`, `starting: true` and the child's pid. It counts against the cap and holds the ticket and its files like any run in flight.
- **Hand-over.** `main.mts`'s first write clears `starting` and takes over the record with its own pid; from then on a dead process means a stopped run, as before. Since #75 it first adopts the launch claim the record carries (`adoptClaim`), refusing to start if that claim was superseded.
- **Unstarted launch.** If the reserved pid exits while `starting` is still set (the run failed before it began), `readRuns()` deletes the record and `factory status` skips it, so the next pass retries the ticket as it did before reservations.
- **Admission record** (#75, `board/admission.mts`, shipped with `board.mts` in the complete selected runtime). `<state>/admission/state.json` (folder 0700, file 0600, version 1; temp file, fsync, rename, folder fsync) holds every claim by run key (`{token, project, iid, kind: normal|recovery, owner: {pid, start}, at, attempt?}`), each project's activity `generations`, and per project the recovery attempts `admitted` and any `pending` charge. All changes run under one short lock across all projects, `<state>/admission/lock`, created complete (temp file hard-linked into place) with its holder's pid and start identity; it is taken over only when that exact process is gone (pid exited, including one left as an unreaped zombie since #64, or reused by a process started at another time), never by age or a live pid alone, and an unreadable lock is never taken over. A corrupt or unknown-version record fails closed: nothing is admitted, and it is never overwritten. Reading it (`readAdmission`, status, `factory retry`) never writes.
- **Atomic claim** (#57, through the admission record since #75). Before spawning, `dispatch.mts` claims each launch with `claimRun()` (`board/board.mts`). Under the admission lock it counts live claims and in-flight run records across every project, refuses when the cap is already reached, the ticket already has a claim or a run in flight, or a recovery claim holds the project, then commits a `normal` claim (owned by the pass's pid; the project's generation goes up by one) and only then writes the reservation, carrying the token as `claim`. `reserveRun` hands the claim to the spawned child, `main.mts` adopts it, and a launch that fails to spawn releases it (`removeRun`). A normal claim ends when its run reaches a terminal or parked stage, or when its owner is gone. A refused claim launches nothing: no capacity ends the pass's launches, an owned ticket is skipped. Custom workflow behavior remains the project owner's responsibility.
- **Token fencing** (#75). A process that holds a claim (`adoptClaim`, `holdClaim`) writes its record only while the record still carries its token, so a stale heartbeat or exit handler never overwrites a newer claim's record, and it releases only its own token.
- **Activity generation** (#75). Every normal admission advances its project's generation (`generationOf`). The jam confirmation (#61) passes it to `observePass`, so a normal launch between two passes breaks a pending confirmation, and `claimRecovery` refuses a jam confirmed at an older generation.
- **Recovery claim** (#57, admission record since #75, `cli/src/recovery-claim.mts`). `claimRecovery` takes, under the same lock, a slot under the cap (default 3), the affected ticket and its whole project (refused while any other run of the project is in flight): first it replays any pending charge of the project, then after the shared checks and `attemptProblem` it commits the `recovery` claim (with the attempt UUID) and the charge (`admitted` + 1, a `pending` entry) in one replacement, then applies the charge with `beginAttempt` (idempotent by UUID) and clears `pending`, then writes the ticket's record. A crash between the replacement and `beginAttempt` is replayed by the next claim or settle without charging twice or refunding. A refusal changes neither the board, the admission record nor the recovery record. The record becomes a reservation with `recovery: {attempt, id, from: {stage, note, stageSince}}`, keeping its branch and evidence, and without `starting`. A recovery claim holds the ticket, a capacity slot and the whole project whatever its record's stage or process, and is released only by `settleRecovery` after the attempt's exact container is confirmed gone. Only the tick's jam confirmation (#61) launches a repair.
- Manual starts through `factory run` take no reservation and are not held to the cap; they still count once running.

Tests: `board/board.test.mts` ("a launched run counts as active before its child writes", "claims are atomic") and `cli/test/recovery-claim.test.mts` (claim plus charge with a crash in between, cross-process races, token fencing, the activity generation, lock takeover and fail-closed records).

# Slice four: the Linux scheduler

`cli/src/commands/schedule.mts`, `cli/src/commands/tick.mts`, `cli/src/tick-lock.mts`, `cli/src/tick-cancel.mts`, `cli/src/platform/scheduler.mts`, `cli/src/platform/scheduler-systemd.mts`, `cli/templates/factory-tick.{service,timer}`.

- **Backend.** `ScheduleBackend` (`platform/scheduler.mts`) has `install(spec, record)` (writes the units, starts nothing), `enable()`, `disable()`, `status()` and `remove(entry)`. `status()` returns `{timer: active|inactive|missing, enabled, tick: active|inactive|missing, lastTick?}`. The timer's enablement (`UnitFileState`) and activity are read apart from the tick service's activity. A failed or unparseable `systemctl` call throws, and callers show `unknown`. Each backend also names the `files` it writes and a `logHint`. macOS has its own backend (next section); other platforms refuse. The commands issued are `show`, `daemon-reload`, `enable --now` and `disable --now` on `factory-tick.timer`, `stop` on `factory-tick.service`, and per-unit `stop` and `disable` in `remove`.
- **`factory schedule on`** requires the manifest (`factory install`), refuses tick unit files it does not own, saves PATH and Node to `schedule.json`, writes `factory-tick.service` then `factory-tick.timer` (each recorded in the manifest as soon as it is written), daemon-reloads, and runs `enable --now factory-tick.timer`. The service is `Type=oneshot` running `node <app>/cli/bin/factory.mts tick`, with the saved PATH, `FACTORY_HOME`, `SANDCASTLE_STATE_DIR`, journal output, `KillMode=process` (systemd signals only the tick itself), `TimeoutStartSec=infinity` (no dispatcher timeout) and `TimeoutStopSec=2min` (room for cancellation). The timer is `OnActiveSec=1min` and `OnUnitInactiveSec=5min` with `Persistent=false`, so missed ticks are not replayed. If install or enable fails, the ledger stays and the error carries the state systemd reports now. Repeating `on` retries, and also rewrites the units and refreshes PATH and Node.
- **`factory schedule off`** is `stopScheduling`: `disable --now factory-tick.timer`, then `stop factory-tick.service` (which waits), then `cancelTick` confirms the recorded tick and pass group are gone. A failure at any step stops there with the files kept, and running `off` again retries.
- **Cancellation** (`tick-cancel.mts`). The tick lock file (`<state>/scheduler/tick.lock`, JSON) records the tick's pid and kernel start time and, once spawned, the pass's pid and start time. The pass is spawned with `detached: true`, so it leads a new process group whose id is its pid. Everything non-detached below it (shell, `npx`, ticket analysis) is in that group. Ticket runs that `dispatch.mts` launches are detached into their own groups. Factory signals only the recorded tick pid and `-<pass pid>`, after checking they are still those processes by start time, and never group 1 or its own. `cancelTick` sends the tick SIGTERM and waits `grace + confirm + 2s`, since the tick cancels its own pass. Then it sends SIGKILL to the tick. If the pass group is still alive it sends SIGTERM to the group, waits 30 s (`DEFAULT_GRACE_MS`), sends SIGKILL to the group, and waits 5 s (`CONFIRM_MS`) for it to vanish. Zombies do not count as alive. The deadline applies to cancellation only: nothing times out a pass that is running normally. If a pass leader exits while non-detached members of its group are still alive (a backgrounded job, or a child orphaned when the dispatcher died mid-analysis), the tick keeps ownership recorded until it has terminated that group the same way (SIGTERM, grace, SIGKILL, that group only), logs it, and records the reason on the project (`left processes running in its process group, terminated`). That is cleanup after the pass ended, not a pass timeout, and it keeps ownership from being dropped while an owned process lives; if the group cannot be confirmed gone the lock stays and no pass starts over it. `off`, uninstall and reinstall report what they observed: the tick the manager said was running (even when its stop already cancelled it and left no lock), the project whose pass became `interrupted`, a pass that had already finished on its own (named as finished, never as cancelled), or that the manager could not be read. When a leftover group cannot be confirmed gone, state.json keeps what the leader did (`ok` or `error` by its exit code, with exit code, finish time and duration) and a reason naming the live group; `interrupted` is kept for cancellations that were requested. Unconfirmed cancellation throws and keeps the lock. A lock whose tick is dead but whose pass group lives is never reclaimed, so no second pass starts over it, and the next `off` cancels it. The tick's own SIGTERM/SIGINT handler does the group part (`terminateGroup`), records the pass `interrupted`, starts no later project and exits 143.
- **`factory schedule on|off --project <name|path>`** takes a registered name, a path in the checkout, or the recorded root of a deleted checkout. It sets the project switch and never touches the timer. `on` refuses a project that fails its branch or selected-runtime validation and does not repair the runtime. Without `--project` the command is global, even inside a checkout. `--json` is for `status` only. A positional project is rejected.
- **Tick** (`factory tick`, internal, no flags). It asks the manager (`on` means timer enabled and active) before the lock, after it and before each project. Off ends it with exit 0, and unknown (query failed) with exit 1. A live holder, or a dead holder's live pass group, makes it log and exit 0. Missing or malformed launch configuration, registry or state stops it with an error. It visits the whole registry in order, rotated to start at the first opted-in, unpaused project at or after `nextRoot` (the top when `nextRoot` is unset or unregistered); before any pass it saves `nextRoot` as the next opted-in, unpaused project after that one, so the turn advances even when the tick fails, is cancelled or dies, and projects not opted in take no turn. It then, for each project that `scheduleBlocker` and `copyProblem` clear, runs `dispatch.sh` with no `--max` override, so the cap comes from the project's `dispatch.max_concurrent` setting, counted across the shared board. It runs from the root through `runDispatchSh` (options `group`, `env`, `onSpawn`) with `FACTORY_SCHEDULED=1`, the saved PATH and `SANDCASTLE_STATE_DIR` set to Factory's state folder whatever the caller set. A project never opted in (no `schedule` entry) instead gets a read-only refresh (#94): `runRefreshOnly` spawns the saved Node on the selected runtime's `dispatch.mts --refresh-only --base <current branch>` from the root, as the leader of its own process group, with the saved PATH and `SANDCASTLE_STATE_DIR` and without `FACTORY_SCHEDULED` or the jam report. It is recorded and cancelled like a pass, takes no turn, adds no pass history, gets no jam confirmation, and ends as `skipped` (or `interrupted`) with `project not opted in; read-only refresh <ok|failed: exit N|cancelled>`; it is reported in the result's `refreshed` and never fails the tick. A detached HEAD or an invalid selected runtime skips it. Other projects, paused ones included, log `skip <name>: <reason>` after local recovery maintenance. Maintenance never refreshes or launches work and contributes no pass history or jam confirmation. Stdin is inherited. State is saved before spawn (`running`), at spawn (pid) and after (`ok` or `error`, exit code, UTC finish, monotonic duration). A dead tick's `running` entries become `interrupted` without a finish time. Each pass's end and the tick's end are also appended to the timing history (see "Slice four: scheduler storage"). Exit codes: 0 done, 1 a pass failed, 143 cancelled. The current dispatcher ignores `FACTORY_SCHEDULED=1`; Factory passes it as the ticket specifies.
<!-- #153: scheduled continuation uses the existing version-1 status JSON as live, read-only authority. -->
- **Existing PR continuation (#153).** The tick exports its absolute CLI entrypoint and saved Node as `FACTORY_CLI_ENTRYPOINT`/`FACTORY_SCHEDULER_NODE` only to scheduled children. A normal non-dry pass observes up to ten host-recorded `ci-waiting` checkpoints once each, oldest first. Exact proof, current requirements/eligibility, workflow/settings and local/remote heads must match; no agents or repair charges. Each observer has a 30-second deadline and 10-second subprocess bounds. Before observation and before merge it runs that exact Node/CLI's `schedule status --project <canonical-root> --json`, requiring version 1, global service enabled/timer active, exactly the registered project enabled on the recorded base and blocker null. Unknown/off/paused/cancelled/base-switched authorization refuses merge, without PATH fallback. Tracker transport ambiguity stays retryable on the same PR; identity/CI/policy failures require an operator. No historical adoption, creates, pushes, reruns or repeated waiting comments. Delivery claims count against shared capacity and advance activity generation without changing execution identity or renewing repair budget; only confirmed merged checkpoints count as progress. Manual/dry-run/refresh-only dispatch does no open-PR continuation. The operator must maintain compatible CLI and runtime code.
- **`factory schedule status [--project] [--json]`** prints the manager's state (enabled, timer activity, tick activity; `unknown` when the query fails), the last trigger, the last tick and tick timings, health problems, enabled legacy dispatcher timers, and each project's switch, `scheduleBlocker` reason or `ready`, last pass result and pass timings. `--json` adds `scheduler.lastTick`, `scheduler.ticks`, `scheduler.problems` and `projects[].timings`.
- **Scheduler health** (`cli/src/scheduler-health.mts`, #37), shared by `factory status` and `schedule status`. Read-only: one manager query plus state.json, history.json and schedule.json. `schedulingFrom` gives on/off/unknown by the tick's own rule; the phase is `running` (a tick is active), `waiting` (on, no tick), `off` or `unknown`. Problems: the manager can't be read (scheduled work is blocked), the job is enabled but not running, or running but disabled, a malformed state, history or launch configuration file (reported, left alone, never an error), no launch configuration while the job is installed, and an overdue tick (on, no tick running, nothing started or finished for two 5-minute intervals). Timing summaries are `{count, timed, lastMs?, medianMs?, p90Ms?, maxMs?, results}` over the history's entries (percentiles by nearest rank; interrupted entries have no duration and are only counted). `factory status --json` adds `scheduler: {state, reason?, phase, enabled, timer, tick, loaded?, lastTick, ticks, problems, legacyTimers, logHint}` and `schedule: {switch: on|paused|off, branch?, blocker, last, timings, recent}` (the project's five newest passes, newest first). Tests: `cli/test/status.test.mts`, and the status test in `cli/test/scheduler.test.mts`.
- **`factory doctor`** checks the manager once the units are in the ledger. Enabled and active passes, enabled but stopped fails, running but disabled warns, an unreadable manager fails, and off is information. It warns about enabled legacy `sandcastle-dispatch` timers (`~/.config/systemd/user/timers.target.wants/`). Doctor disables nothing.
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
- **Next tick for the Board** (#121). The supervisor saves `<state>/scheduler/next-tick.json` (`cli/src/next-tick.mts`, `{version:1, pid, startTicks, at}`) before each wait and removes it when the wait ends and when it stops; `LaunchdSchedule.timers()` reads it only while that process is still running. It is a display hint that nothing schedules from. On Linux `SystemdSchedule.timers()` reads `systemctl --user list-timers --all --output=json --no-pager factory-tick*.timer`. Both back the Board's `GET /api/timers`.
- **Status** shows `Supervisor (launchd com.factory.tick): enabled|disabled, loaded|not loaded, running|not running; …`, with `loaded` also in `--json`, and the log hint `tail -f <state>/scheduler/tick.log`.

Trusted, not tested: launchd loading agents at login, honouring `KeepAlive`, `ExitTimeOut` and `AbandonProcessGroup`, and writing the log file. Tests: `cli/test/schedule-macos.test.mts` runs the production adapter, the generated plist and a real supervisor process (`cli/test/fixtures/supervisor.mts`, the same code with a short first delay) against `cli/test/stubs/launchctl`, which models enablement, loaded and running separately and, for `bootout`, sends the registered job process SIGTERM and waits, as launchd documents. No real macOS trial is required.

---

# Slice three spec

Status: implemented. This section documents current commands, not a pending implementation plan.

Run and watch one project's work through the selected complete runtime. Commands run with the checkout as their working directory, not the runtime directory.

## Project and run lookup

`cli/src/runs.mts`, shared by every command below.

- **Project.** `--project <name>` accepts a registered name or a path inside a registered checkout; duplicate names require a path. Without it, use the registered checkout containing the current directory. Linked worktrees can resolve through their registered Git common directory, unless ambiguous. The checkout needs valid `.factory/factory.toml`; its tracker project identifies run records.
- **Run records** come from `SANDCASTLE_STATE_DIR` when set, else `~/.local/state/factory` (as `factory-dispatch.sh` does). A run whose process is gone without finishing reads as `stopped`, without its record being rewritten.
- **Run log** is `.factory/logs/run-<ticket>.log`, where `dispatch.mts` and `dispatch.sh --issue` write it.

## `factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]`

Runs the selected runtime's `dispatch.sh` from the project root with those flags. `--max` must be a positive safe integer. It sets `SANDCASTLE_STATE_DIR`, streams output and returns the child exit code.

## `factory run <ticket> [--project <name>]`

Runs the selected `dispatch.sh --issue <ticket>` from the project root. The Factory workflow runs the ticket in the foreground and writes terminal output and the run log. The exit code is the run's. `factory run` accepts neither `--dry-run` nor `--max`.

## `factory retry <ticket> [--project <name>]`

Deletes the ticket's run record, the same as deleting the JSON file by hand, only when its stage is `stopped` (including a run whose process is gone). `done`, live, `queued` and `waiting` runs and a ticket without a record are refused with the reason. It never deletes branches, logs or evidence; it warns, with the command to delete it, when a `<ticket>-*` branch exists locally or on origin (as last fetched), since the dispatcher skips such a ticket. Since #75 it also refuses a stopped card that an admission claim protects: any recovery claim (held until the attempt's container is confirmed gone), a launch claim whose owner may still run, or an admission record it cannot read (unknown). It keeps the ticket's ownership receipt.

## `factory status [--json] [--project <name>]`

Prints the board service's state (`active`, `inactive`, `missing`, or `unknown (<reason>)` when the service manager can't be asked) and URL, then each of the project's run records, oldest first, with stage, time in that stage, title, branch, verdict, PR and note; a dead process reads as `stopped`. `--json` prints `{version:1, project:{name,root,tracker}, board:{service,url}, runs:[...]}`, the runs being the records plus their `key`. Since slice four (#37) it also shows scheduler health and this project's schedule and pass timings, between the board line and the runs, and `--json` adds `scheduler` and `schedule`; see "Scheduler health" under "Slice four: the Linux scheduler". Since #62 it also summarizes self-recovery and `--json` adds `recovery`; see "Slice four: recovery status and reset". The service and schedule backends are passed in, so tests use the fake ones.

Readiness appears once above the runs, including projects with no runs. Project checks and ticket-input, ticket-workspace and sandbox observations are separate; a ticket hold is not a failure of every selected ticket. Each observation shows scope/phase, checked time, identity, operation, quoted path, safe errno, next actor/action and automatic recheck policy. Like Board, status and ticket show use `readStoredReadiness` for the registered root. Identity is the recorded observation identity, not a claim that current configuration/runtime still matches. Stale observations retain their historical facts but show current readiness as unknown. Missing, pending, invalid or unreadable reports show unknown with cause-known limits. Status never publishes or starts probes. JSON adds `readiness: ReadinessRead` to version 1 without changing existing fields. There is no prose on JSON stdout. A successfully displayed blocked or unknown report exits 0; bad arguments or project selection exit 1.

`factory ticket show <ticket> [--project <name|path>] [--json]` adds current project `readiness`, explicitly attributed `ticketReadiness`, `input` and `executionReadiness` to its version-1 JSON. It works without a run or journal so a project hold remains visible. A colliding foreign run is still refused. Only checks with an explicit matching `ticket` are associated with this ticket; paths, IDs and owner names are never used to infer attribution. Historical execution stage/note stays separate from current project readiness. Standard workflow `input.state:"frozen"` projects the saved execution/attempt's bounded host-owned source manifest, with coverage, content/rendered hashes and source references. It does not establish current tracker freshness. Missing or invalid input evidence and missing execution-specific producers are explicit unknowns, with empty coverage/references and a null hash, not a reason to collect tracker content. Neither command follows arbitrary links, reads log bodies or environment values, imports executable override modules or starts agents/containers. Existing service-manager status queries remain read-only.

### Readiness diagnosis

Start passively, then opt into write probes only when appropriate. These commands use a synthetic registered project named `project with spaces`; substitute your registered name or checkout path. `ticket show` is passive too, even without a run.

<!-- readiness-command-fixture -->
```sh
factory doctor --project "project with spaces" --json
factory status --project "project with spaces" --json
factory ticket show 7 --project "project with spaces" --json
factory doctor --project "project with spaces" --probe-filesystem --json
```

Names, paths inside registered checkouts and the current registered checkout are supported selectors. Quote spaces. A linked worktree uses its own versioned settings/workflow; ambiguous registration requires an explicit registered name. An unregistered path is not an invitation to register or initialize it automatically.

| Command/result | Exit | Interpretation |
| --- | --- | --- |
| Passive project doctor, required writes unproven but no blocked read | 0 | Write capability is untested, not ready. |
| Active project doctor, all required checks ready | 0 | Observed host access only; no report publication or launch. |
| Active doctor blocked/required unknown, timeout or collection failure | 1 | Inspect the reported operation; no repair was attempted. |
| Status or ticket show successfully displays blocked/unknown readiness | 0 | Diagnostic display succeeded; this is not launch eligibility. |
| Bad arguments, unknown/ambiguous project | 1 | Selection/argument error, not a filesystem diagnosis. |

These JSON subsets are fixture-checked, not complete responses. Immediately after creating an isolated project/runtime with no saved launch report, passive doctor includes:

<!-- readiness-passive-json -->
```json
{
  "version": 1,
  "readiness": { "state": "current", "report": { "phase": "passive", "status": "unknown" } },
  "saved": { "state": "missing" },
  "writeCapability": "untested"
}
```

Here `current` identifies the newly made passive observation, while `unknown` says required write access is unproven. A successful explicit probe instead includes:

<!-- readiness-active-json -->
```json
{
  "version": 1,
  "readiness": { "state": "current", "report": { "phase": "active", "status": "ready" } },
  "saved": { "state": "missing" },
  "writeCapability": "ready"
}
```

It still leaves status's stored report missing. For ticket 7 with no run, journal or attributed input report, `ticket show` includes:

<!-- readiness-ticket-json -->
```json
{
  "version": 1,
  "readiness": { "state": "missing" },
  "input": { "state": "unknown", "coverage": [], "contentHash": null, "references": [] },
  "executionReadiness": { "state": "unknown" }
}
```

Do not test JSON truthiness or exit 0 as a launch gate. Consumers must interpret report/check scope, state, required status and freshness. `status.readiness.report.status` can be blocked by a ticket check even when project-scope checks are ready. Human status separates these scopes. See the [safe next-action examples](ticket-readiness.md#safe-next-actions-by-example) for missing parent context, denied evidence access, unavailable reports, branch collisions and container-only failures.

Project selection follows the existing registered name/path rules. Explicit project mode checks only the project filesystem, not installation services or Board HTTP. With no flags, doctor retains its installation checks and adds passive filesystem observation when run inside a registered checkout. `--json` or `--probe-filesystem` without a selector uses the current registered checkout.

Passive doctor never creates directories or files. Required write ability is `untested` unless a current matching active observation contains successful write cycles for every intended writable location. A saved observation is not authorization. Passive unknown write ability alone exits 0, while an observed required failure exits 1.

`--probe-filesystem` explicitly permits exclusive create/write/rename/remove checks using private disposable files. It may create missing ordinary Factory state, logs, evidence and worktree-parent directories. It never repairs permissions, deletes branches/worktrees, runs setup commands, reads credentials or provisions a sandbox. Active blocked/unknown, timeout or failed collection exits 1 and reports a safe operation-specific inspection action. Success exits 0. Doctor does not publish even active observations over the launch report. JSON is a single `{version:1, project, readiness, saved, writeCapability, coverage}` object, or a safe unknown `readiness` on collection failure. Unknown project selection is an argument error on stderr.

The host observation does not establish sandbox-user access, especially inside opaque custom workflows. Reports cannot replace image/browser gates, admission, independent verification, exact-SHA delivery or recovery accounting. See [ticket readiness](ticket-readiness.md#cli-observation-examples) for examples and local test coverage.

## `factory logs [ticket] [-f] [--recovery] [--project <name>]`

Prints the ticket's run log, or the project's most recently written `run-*.log` without a ticket. With `--recovery` (#62) the repair log, `recover-<n>.log`, instead. `-f` polls for appended output (starting over if the file is truncated) until interrupted.

## Out of scope

`logs` does not read journalctl. Run and dispatch target one project per command.

## Tests

`node --test cli/test/*.test.mts orchestrator/*.test.mts board/*.test.mts`: `runs`, `dispatch`, `run`, `retry`, `status` and `logs` each have a test file under `cli/test/`, using a temp `FACTORY_HOME`, a fake project and the fake service backend.

---

# Slice two spec

Status: implemented. V2 data-only init and selected complete runtimes supersede the original copied-workflow scaffold.

## Registry

`~/.config/factory/projects.json`: `{"version":1,"projects":[{"name","root"}]}`. Identity is the canonical (realpath) Git root; name is its basename. Writes use a temp file plus rename (mode 0600) under an exclusive `projects.json.lock`; contention fails with a retry message. A malformed or unsupported file is reported and never replaced. Missing file means empty. Git worktrees are distinct roots; symlink aliases and subdirectories collapse to the root.

- `factory project add [path]` adds once, writes nothing into the project.
- `factory project ls [--json]` lists in root order, flagging a missing checkout or missing `.factory`; JSON is `{version:1, projects:[{name,root,exists,scaffold}]}`.
- `factory project rm [path]` removes only the entry. A deleted checkout is removed by its recorded absolute path. Unknown is a no-op.

## Init

`factory init [path] --profile personal|client --repo <namespace/project> --image <image> [--host <gitlab host> --project-id <n>]` (client requires both `--host` and `--project-id`) creates v2 `factory.toml`, `.env`, `.env.example`, `.gitignore` and a convenience wrapper only. Both profiles default to Pi with the OpenAI family; tracker, selection and merge defaults differ. No workflow modules, prompts, parser or dependencies are copied into the project. The wrapper calls `factory dispatch --project` with the canonical root and forwards arguments literally. CLI, scheduler, recovery and Board launch paths select a complete validated workflow through the shared resolver; see [workflow selection](execution-context.md#workflow-selection).

Inputs and existing v2 configuration are validated before writes. Creation is exclusive, existing files are preserved, symlinks and type conflicts are refused, and registration follows successful writes. A partial write can be completed by rerunning init. Unsupported existing configuration is refused; init does not convert it. No tracker calls, logins, image builds, package installs or services are performed. Authenticate Pi and the tracker separately and provision the configured sandbox image. Runtime dependencies are installed with Factory, not in the project.

`factory update --dry-run` and `--apply` report project-owned assets without creating or replacing project data or workflow overrides. Install publishes the shared runtime.


## Uninstall

Lists each registered project's `.factory` with a quoted removal command it never runs, before `--purge` removes Factory config (including the registry). Project files are never touched.

## Pi subscription provider

`pi-claude-subscription` is a Pi extension (not built into Pi) that runs `claude -p`. Host: cloned into `~/.pi/agent/extensions/pi-claude-subscription` (`git clone --depth 1 --branch <tag> https://github.com/markdlabrecque/pi-claude-subscription.git ~/.pi/agent/extensions/pi-claude-subscription && cd ~/.pi/agent/extensions/pi-claude-subscription && npm ci --omit=dev --ignore-scripts`; `pi install git:…` fails on the package's husky hook); analysis loads it via `-e <ext>/index.ts` with `--no-extensions`. Container: Sandcastle runs `pi -p --mode json --model <id>`; the image installs the CLI and extension (agent-pi layer) and the CLI authenticates with `CLAUDE_CODE_OAUTH_TOKEN` from `.factory/.env`. No OpenAI login or credential is used for these models.

---

# First slice spec

Status: implemented. The installation contracts below include later runtime-ownership and scheduler integration updates.

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
    dispatch.mts             one dispatcher pass: runs the selected runtime dispatch.sh
    run.mts                  factory run: one ticket now, through selected dispatch.sh --issue
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
  src/commands/clean.mts     factory clean (slice 4.5, #96); the rules are in src/clean.mts
  src/commands/tick.mts      internal factory tick: gate on the manager, visit projects, run passes (slice four), clean after each completed pass (#97)
  src/platform/
    index.mts                picks the adapter
    systemd.mts              install, start, stop, remove a user unit
    scheduler.mts            ScheduleBackend interface and platform choice (slice four)
    scheduler-systemd.mts    factory-tick.service and .timer through systemctl (slice four)
    launchd.mts              same for a launch agent
    fake.mts                 in-memory adapter for tests
  test/
```

The CLI parses arguments with Node's `node:util` `parseArgs`. The shared runtime has private locked dependencies.

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

Before replacing the app, install prepares a content-addressed runtime in `~/.local/share/factory/runtimes/` using the checkout's locked package manifests and `npm ci --include=dev --include=optional --ignore-scripts`. Applicable platform dependencies, including esbuild's executable, are mandatory even though npm marks them optional. It atomically updates `runtime.json` only after bundle preparation, app installation and service setup succeed. A failed install leaves the previous descriptor and bundle usable. Runtime ownership is durably reserved before temporary or published directories are created. A later install can remove a recorded temporary directory only when its PID/start identity is confirmed dead, and can reuse a validated published bundle after an interruption. A PID/start-identity transaction fences the entire asynchronous install or uninstall, including service setup. A competing operation fails rather than selecting a descriptor for another operation's app. Atomic metadata writes stage outside the store, so interrupted ledger or lease writes cannot turn known bundles into unrecognized store entries. Copied and linked installs both prepare independent runtime bytes; changes to a linked checkout require another install. Old bundles are retained, not garbage-collected. If a pass selects runtime A and reinstall publishes B, fresh invocations select B while that pass and its children retain A. The source content ID includes inventory bytes, modes and Node metadata; the dependency digest is pinned separately. Private SDK preparation applies Factory's pinned layout patch before dependency hashing. The [Sandcastle patch guide](sandcastle-patch.md) owns its rationale, guarded inputs, coordinated SDK/lock/specification updates, offline verification, rollback and removal. Never patch a published bundle in place. Linked installs also need reinstall to publish changed runtime bytes; editing the linked checkout does not mutate the active default runtime bundle. The bundle inventory includes `model-policy.mts` alongside its runtime consumers. V2 entrypoints already require explicit TOML settings, so bundling preserves their source bytes rather than rewriting a legacy CONFIG block. The low-level workflow now requires an explicit project root, selected runtime root/content ID and project-root cwd. It uses the bundle's private absolute executables, with process leases and complete inventory/config/template proof identity. See [shared execution context](execution-context.md). CLI run/dispatch, scheduler dispatch and refresh, Board refresh, recovery preparation, image readiness and recovery launch now resolve one complete workflow. Factory mode ignores copied local code. Explicit project mode selects a repository-contained `workflow.directory` and requires the complete closed inventory in `cli/src/runtime-assets.mts`, its manifest and private dependencies. Missing files, extra source entries, source symlinks, stale hashes or invalid dependencies fail without filling any helper from Factory. The manifest identifies bytes and modes, not their safety or trustworthiness. Custom code can change behavior, and its owner is responsible for reviewing and maintaining it. Children retain their parent's selected root/identity and saved scheduler Node/PATH. Factory-mode recovery needs no per-project code review; complete project overrides require host-owned review bound to their current source and dependency identity. Board services receive a trusted descriptor path; missing descriptors produce read-only assessment errors. See [workflow selection and manual override maintenance](execution-context.md#workflow-selection). See [selection explanation](#selection-explanation) for read-only native tracker diagnostics. New projects contain data-only assets, and role-specific additive instructions are validated and frozen in the selected execution context.

Running install again reuses existing entries and refreshes the files. It never duplicates a manifest entry.

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

Follows "Uninstall behaviour" above. The manifest also owns the exact runtime store and descriptor paths. Before removing anything, uninstall checks the runtime ownership ledger and process leases. Live or unidentifiable owners, malformed leases and unrecognized bundles stop removal; a confirmed dead PID/start identity does not. Uninstall never steals ownership based on age. Launchers acquire and transfer leases to protect the host runtime while processes are active, including detached ticket and recovery children and their cleanup. Wait for work and cleanup to finish; do not manually remove leased bundles or ownership metadata. Project-mode launches also lease the host runtime.

## Tests

Few and focused, per the project's testing rules. Run with `node --test cli/test/*.test.mts`, using `FACTORY_HOME` set to a temp dir and the fake adapter. No test touches the real systemd or launchd.

1. **Uninstall removes exactly the manifest.** Install into a temp home, add an unrelated file and an unrelated `factory-other.service` the manifest does not list, uninstall, and assert only the listed entries are gone.
2. **Install is idempotent.** Run install twice and assert the manifest has no duplicate entries and the same set of files exists.
3. **Crash recovery.** Make the adapter throw on the unit step, and assert the manifest lists the entries created before the failure, and that uninstall then cleans them.

Readiness argument/output and safety boundaries are covered by `cli/test/readiness*.test.mts`; installation unit templates retain their existing fixture and manual coverage.

## Manual check on a real machine

These are optional operator-authorized deployment checks, not outstanding source implementation or an automated merge gate. A temp `FACTORY_HOME` alone does not isolate service-manager commands. Inspect existing ownership and active work, and use exact installed identities before running these commands on a real machine:

1. `factory install`, then `systemctl --user status factory-board` (or `launchctl print gui/$UID/com.factory.board`). It is active, and `curl http://127.0.0.1:4444` answers.
2. `factory doctor` passes.
3. `factory uninstall --dry-run` lists the service, the symlink and the app dir.
4. `factory uninstall`, then confirm the exact units/agents and paths from its manifest are gone and its CLI symlink is removed. Unrelated or untracked `factory-*` and `com.factory.*` services must remain untouched; do not require a name-pattern listing to be empty.
5. `factory uninstall` again says nothing is installed and exits 0.

## First-slice completion

Implemented and closed in [#1](https://github.com/markdlabrecque/factory/issues/1). Installation, lifecycle, ownership, failure recovery and safe uninstall have offline regression coverage in CI. After successful uninstall, manifest-owned services, command, app and eligible runtime assets are removed; unrelated services and project files remain. Config and state remain unless `--purge` is passed. Runtime lease and unsafe-removal refusals still apply.

The maintained verification commands and optional live-check boundaries are in [TESTING.md](../TESTING.md). Closure is not a claim that the current revision has been installed or smoke-tested on every supported platform.
