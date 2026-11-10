<!-- CLI roadmap: slice two adds Pi subscription models and retains .sandcastle; .factory migration is deferred. -->
# Factory CLI

Status: first slice implemented locally, pending PR delivery and real-service verification. Later slices remain proposed.

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

factory init                 in a project: scaffold .sandcastle/ (replaces the setup skill)
factory project add|ls|rm    the list of projects Factory looks after

factory dispatch             one pass (--dry-run, --max N, --whole-issues)
factory run <ticket>         run one ticket now
factory retry <ticket>       clear a failed run's record so the next pass retries it
factory status               runs, timers and board on one screen
factory logs [project]       dispatcher logs (journalctl or the log file)

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
2. `factory project add|ls|rm` and minimal `factory init`, tracked in [#2](https://github.com/markdlabrecque/factory/issues/2). Add missing workflow files only; keep optional environment layers in the setup skill. Retain `.sandcastle` for this slice. Also configure the personal dispatcher for `model:sonnet` → `pi-claude-subscription/claude-sonnet-5-5` and `model:opus` → `pi-claude-subscription/claude-opus-5-5`, with subscription-provider loading/auth for implementation, verification and analysis. Labels select the runtime model; the ticket body records the same full ID. Use Opus for verification and Sonnet for analysis. This replaces the current OpenAI-only assumptions, not just the model strings.
3. `factory dispatch`, `run`, `retry`, `status`, `logs`.
4. `factory schedule` with the single tick timer, replacing `install-dispatch.sh`.
5. `factory update` and project copy refresh.
6. Retire `install-service.sh`, `install-launchd.sh` and `install-dispatch.sh`. Update `README.md`, `orchestrator/ADAPTING.md` and the setup skill (see `AGENTS.md`).
7. Migrate project files from `.sandcastle` to `.factory` in a future slice. Plan runtime path changes, compatibility and safe migration separately; do not rename directories in slice two.

The board redesign is tracked separately in [#3](https://github.com/markdlabrecque/factory/issues/3): one Minority Report-inspired Factory design for board and evidence pages, retaining light/dark/system modes, with polished page, navigation and live-data transitions. Respect reduced motion and preserve focus, scroll and media playback. Full implementation plans and Q&A are posted on all three tickets.

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
  src/manifest.mts           read, add entry, atomic write
  src/paths.mts              all paths in one place, honours FACTORY_HOME for tests
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
