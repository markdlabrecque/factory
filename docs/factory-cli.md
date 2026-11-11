<!-- CLI roadmap: slice two (project registry, init, Pi subscription models) implemented locally; .sandcastle retained, .factory migration deferred; board redesign (#3) implemented; slice three's shared project and run lookup (cli/src/runs.mts), `factory dispatch`, `factory run` (with `dispatch.sh --issue`), `factory retry` and `factory logs` added. -->
# Factory CLI

Status: first and second slices implemented locally, pending PR delivery and real-service verification. Later slices remain proposed.

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
factory status               runs, timers and board on one screen
factory logs [ticket] [-f]   a run's log file (newest without a ticket; -f follows)

factory schedule on|off|status [project]    the timers
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

Proposed: one `factory-tick.timer` that walks the project list, instead of one timer per project. Reasons: `schedule on|off` is a single switch, uninstall removes one unit, and the shared run cap is enforced in one place. Per-project pause is a flag in the project list, not a unit.

Open decision: per-project timers (today's model) are more isolated, but multiply units and uninstall work.

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
3. `factory dispatch`, `run`, `retry`, `status`, `logs`, tracked in [#10](https://github.com/markdlabrecque/factory/issues/10). In progress: the shared lookup they use is in `cli/src/runs.mts` ([#13](https://github.com/markdlabrecque/factory/issues/13)). A command's project is `--project <name>` (a registered name, or a path inside a registered checkout; a name several projects share must be given as a path), else the registered checkout the current directory is in; anything else fails and names the registered projects. The project must have `.sandcastle/config.mts`; its `TRACKER.project` is the name its run records carry. Records come from `SANDCASTLE_STATE_DIR` when set, else `~/.local/state/factory` (as `factory-dispatch.sh` does). A run whose process is gone without finishing reads as stopped, without rewriting its record. A run's log is `.sandcastle/logs/run-<ticket>.log`, where `dispatch.mts` writes it. `factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]` ([#14](https://github.com/markdlabrecque/factory/issues/14)) runs the project's own `.sandcastle/dispatch.sh` from its root with those flags (`--max` must be a positive whole number) and `SANDCASTLE_STATE_DIR` set to the run-state folder above, streams its output and exits with its code; the checks stay in `dispatch.sh`. `factory logs [ticket] [-f]` ([#18](https://github.com/markdlabrecque/factory/issues/18)) prints that file, or the project's most recently written `run-*.log` without a ticket; `-f` polls for appended output (starting over if the file is truncated) until interrupted. It reads no journalctl (timers are slice four). `factory run <ticket> [--project <name>]` ([#15](https://github.com/markdlabrecque/factory/issues/15)) runs the project's `.sandcastle/dispatch.sh --issue <n>` the same way: `dispatch.sh` does its usual checks, then runs `main.mts --issue <n>` in the foreground instead of a pass, writing the output to the terminal and to `.sandcastle/logs/run-<n>.log`; the exit code is the run's. `--dry-run` and `--max` are refused with `--issue`. A project whose `dispatch.sh` copy predates `--issue` is refused with a message to copy the new one in (refreshing copies is slice five). `factory retry <ticket> [--project <name>]` ([#16](https://github.com/markdlabrecque/factory/issues/16)) deletes the ticket's run record, the same as deleting the JSON file by hand, only when its stage is `stopped` (including a run whose process is gone); `done`, live, `queued` and `waiting` runs and a ticket without a record are refused. It never deletes branches, logs or evidence; it warns when a `<ticket>-*` branch exists locally or on origin (as last fetched), since the dispatcher skips such a ticket. `status` comes next.
4. `factory schedule` with the single tick timer, replacing `install-dispatch.sh`.
5. `factory update` and project copy refresh.
6. Retire `install-service.sh`, `install-launchd.sh` and `install-dispatch.sh`. Update `README.md`, `orchestrator/ADAPTING.md` and the setup skill (see `AGENTS.md`).
7. Migrate project files from `.sandcastle` to `.factory` in a future slice. Plan runtime path changes, compatibility and safe migration separately; do not rename directories in slice two.

The board redesign from [#3](https://github.com/markdlabrecque/factory/issues/3) is implemented: one Factory operations-console design for board and evidence pages with light/dark/system modes, page and navigation transitions, and live updates from a read-only `GET /api/runs` snapshot patched in place every 10s (no reloads; focus, scroll, filters and media playback preserved; reduced motion respected). A local `board.html` stays a static snapshot. Full implementation plans and Q&A are posted on all three tickets.

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
    logs.mts                 factory logs (slice three)
  src/manifest.mts           read, add entry, atomic write
  src/paths.mts              all paths in one place, honours FACTORY_HOME for tests
  src/projects.mts           project registry (slice two)
  src/runs.mts               which project a command is for, its run records and run logs (slice three)
  src/platform/
    index.mts                picks the adapter
    systemd.mts              install, start, stop, remove a user unit
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
