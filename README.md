<!-- Factory CLI: board service, project registry and init; the personal profile runs Pi on pi-claude-subscription models; the single Factory board design with live updates; links the experimental herdr-core spike. -->
# sandcastle-helper

> **Experimental:** [Interactive agents under herdr-core](docs/research/interactive-agents-herdr-core.md) (spike #6) tested attaching to and steering a running agent. It is research only and not supported by Factory.

Helpers for [Sandcastle](https://github.com/mattpocock/sandcastle) setups.

- `skills/sandcastle-setup/` - Claude Code skill that scaffolds `.sandcastle/` from layers (GitLab or GitHub tracker, Pi agent, web runtime, Drupal/WordPress, ddev shim, Playwright), and optionally installs the workflow below. Copy to `~/.claude/skills/` (and `~/.agents/skills/` for other agents).
- `orchestrator/` - one-ticket loop: implement, verify with screenshot/video evidence, post to the ticket, push, open the MR. Two reference configs share the code: `config.mts` for client and Affinity Bridge work (GitLab, Claude Code, a person merges the MR) and `config.personal.mts` for personal projects (GitHub, Pi with the `pi-claude-subscription` provider, `claude-sonnet-5-5` or `claude-opus-5-5` picked by a `model:sonnet`/`model:opus` label on each ticket, PR merged once every CI check passes). See "Two reference configs" in `orchestrator/ADAPTING.md`. Plus a dispatcher that starts many runs, held back by an agent-built ticket graph (dependencies and file conflicts). A ready issue with GitLab Tasks gets one run per Task; once MRs merge, the dispatcher closes the Tasks and moves finished tickets to the next stage (`Internal QA` by default). `dispatch.sh` runs a pass with the defaults. Start with `orchestrator/ADAPTING.md`.
- `board/` - run-state store and the Factory operations board. `board.mts` writes `.sandcastle/state/<project>--<iid>.json` per run and regenerates a self-contained `board.html` from `board.template.html`. Copy both into a project's `.sandcastle/`.
  - `board-server.mts`, `sandcastle-board.service`, `install-service.sh` - always-on version: a systemd user service (macOS: `com.sandcastle.board.plist` + `install-launchd.sh`, a launchd user agent) serving the board at `http://127.0.0.1:4444` (and each run's evidence under `/evidence/`) from one shared state folder. Node 22.18+. Run `board/install-service.sh` (Linux) or `board/install-launchd.sh` (macOS), so every project and worktree reports to the one board. `dispatch.sh` uses that folder unless `SANDCASTLE_STATE_DIR` says otherwise; to start `main.mts` directly, `export SANDCASTLE_STATE_DIR=$HOME/.local/state/sandcastle` first.

The board has one design: a graphite/cyan operations console. It shows counts (active, queued/waiting, attention, completed), filters by status and project, and groups runs into active operations, queued & waiting, and history. Each run card shows its stage on a pipeline, branch, timing, note, verdict and ticket/PR/evidence links. Amber means waiting, red means stopped or quiet for 20+ minutes, green means done; every status also has a text label. The Appearance button (sticky navigation bar) picks Light, Dark or System, saved in your browser; System follows your OS setting live. Old saved design choices are ignored.

The HTTP board does not reload. It polls `GET /api/runs` (read-only JSON, the same data as the page) every 10s, pauses in background tabs, and patches cards by run key: new runs fade in, moved runs slide, stage changes get a short highlight and counts slide to the new value. Focus, scroll and filters survive updates. If a poll fails, the board keeps the last good data and says Offline until the next poll works. Navigating between board and evidence uses a short cross-page transition in browsers that support it. With reduced motion turned on, all of this happens without animation.

Evidence opens in the same tab with image, video and text previews, a Back to board link, and normal browser Back/Forward navigation. Evidence pages never poll, so videos are not interrupted. Text previews stop at 64 KiB; Open original serves the full file.

Without the service, the board assumes it runs from a repo root containing `.sandcastle/` and writes `.sandcastle/board.html`, a static snapshot marked "Snapshot": refresh the file to see newer data. Its evidence links open local folders rather than the HTTP preview pages.

Run the board regression tests with `node --test board/board.test.mts`.

## Install the Factory CLI

Requires Node 22.18+ and a Linux systemd user session or macOS launchd session. From this checkout:

```sh
node cli/bin/factory.mts install
factory doctor
factory board status
factory uninstall --dry-run
factory uninstall
```

Add `~/.local/bin` to your PATH if the installer asks. The default install copies the runtime into `~/.local/share/factory/app`; `install --link` uses this checkout instead. The manifest in `~/.local/share/factory/manifest.json` records the app, command and board service. Reinstall refreshes owned files without duplicating entries and refuses to overwrite unowned paths. Config and run history survive uninstall; `--purge` also removes those folders and Docker images labelled `factory.managed=true`.

This first slice installs only the board, at `http://127.0.0.1:4444`, reading `~/.local/state/factory`. Set `SANDCASTLE_STATE_DIR=$HOME/.local/state/factory` when running the existing orchestrator or dispatcher to report there. Project setup, dispatch commands, scheduling and updates still use the existing scripts. Legacy Sandcastle services are detected but never adopted or stopped. Stop an existing board yourself before installing if it occupies port 4444.

`FACTORY_HOME` substitutes for HOME for isolated filesystem tests. It does not isolate the real service manager. Run `node --test cli/test/*.test.mts` to use the fake backend instead.

### Projects: `factory project` and `factory init`

```sh
factory project add [path]      # record a Git checkout; writes nothing into it
factory project ls [--json]     # registered projects, flagging missing checkouts and missing scaffolds
factory project rm [path]       # forget a project; never deletes files (a deleted checkout: pass its recorded absolute path)
factory init [path] --profile personal --repo owner/repo --image sandcastle-myproject
factory init [path] --profile client --repo group/sub/project --image sandcastle-client --host git.example.com --project-id 42
```

The registry is `~/.config/factory/projects.json` (`{version:1, projects:[{name,root}]}`), keyed by the canonical checkout root, written atomically under a lock. `init` adds only the **missing** minimal workflow files to `.sandcastle/` (orchestrator, dispatcher, ticket graph, board module, neutral prompts, `.env.example`, empty `.env` mode 0600, `.gitignore`, and `factory-dispatch.sh`, which runs `dispatch.sh` against Factory's shared state folder), never overwrites, lists what it skipped, and registers the project only after every write succeeded. An existing `config.mts` or `main.mts` stays authoritative; the flags configure new files only. Rerun to repair a partial scaffold. It does not install packages, build images, contact a tracker or provision an environment: Docker, CMS, web-runtime, ddev and Playwright layers remain in the `sandcastle-setup` skill. `.sandcastle` stays the folder name; a move to `.factory` is a later slice. `factory uninstall` lists each registered project's `.sandcastle` with a removal command it never runs.

### Personal profile: Claude subscription models

The personal config runs Pi through the `pi-claude-subscription` provider (a Pi extension that drives the Claude Code CLI on your Claude subscription). Labels select the runtime model: `model:sonnet` is `pi-claude-subscription/claude-sonnet-5-5`, `model:opus` is `pi-claude-subscription/claude-opus-5-5`. A ticket needs exactly one; a model name in the ticket body alone schedules nothing. The verifier uses Opus, ticket analysis uses Sonnet. Host: `claude auth login` and install the extension (`git clone --depth 1 --branch <tag> https://github.com/markdlabrecque/pi-claude-subscription.git ~/.pi/agent/extensions/pi-claude-subscription && cd ~/.pi/agent/extensions/pi-claude-subscription && npm ci --omit=dev --ignore-scripts`; `pi install git:…` fails on the package's husky hook). Container: the image carries the CLI and extension (`skills/sandcastle-setup/layers/agent-pi/`), and the CLI authenticates with `CLAUDE_CODE_OAUTH_TOKEN` from `.sandcastle/.env` (`claude setup-token`). No OpenAI login is needed. Client config keeps Claude Code and its token as before. Details: `orchestrator/ADAPTING.md`.

The [CLI plan](docs/factory-cli.md#roadmap) tracks the remaining slices. Slice two keeps `.sandcastle`; migration to `.factory` is deferred to a future slice.

## Setting up a project

1. Run the `sandcastle-setup` skill in the project. It does the base install (Sandcastle scaffold and GitLab tracker), then asks separately whether to add the Docker setup (web runtime, CMS and Playwright layers) and the workflow (orchestrator, dispatcher, ticket graph, board).
2. For a project set up before the skill offered the workflow, ask Claude to install it with this prompt. Replace `<sandcastle-helper>` with where this repo is checked out, and fill in `<MILESTONE>` and `<BASE>`:

```text
Install the Sandcastle workflow from <sandcastle-helper> into this project's .sandcastle/,
following <sandcastle-helper>/orchestrator/ADAPTING.md ("Install into a project" and
"What to adapt per project"). sandcastle-setup has already run here, so the Dockerfile and
tracker layer exist.

- Copy the files ADAPTING.md lists, including board.mts and board.template.html from board/.
- Fill in config.mts for this project: GitLab host, project path and numeric id (look it up with
  glab), labels (including the done stage, default "Internal QA"), and milestone "<MILESTONE>" (or leave it unset to use every open ticket).
- The workflow's main.mts and prompt.md replace the ones `sandcastle init` created. Move the
  start-web.sh hook that sandcastle-setup added to the old main.mts into CONFIG.sandboxSetup
  in the new one. Set CONFIG.image to this project's image name. Labels come only from
  config.mts; ignore the label in the old prompt.md.
- Adapt sandbox/bootstrap-site.sh, the Environment section of prompt.md, and prompt.verify.md
  to this project's stack.
- Make sure the Dockerfile's Drupal layer matches
  <sandcastle-helper>/skills/sandcastle-setup/layers/cms-drupal/drush.Dockerfile.snippet
  (a link to the project's own vendor/bin/drush, not a Drush download).
- Add @ai-hero/sandcastle and tsx as dev dependencies, and evidence/, state/, logs/ and
  board.html to .sandcastle/.gitignore.
- Rebuild the image, then, with <BASE> checked out, run `.sandcastle/dispatch.sh --dry-run` from a
  terminal and show me the output. Ask me before creating any GitLab label.
Work on a branch, and don't push.
```

For WordPress, leave out the Drupal layer step. The shipped `bootstrap-site.sh` is Drupal-only, so expect the agent to write a WordPress one.

3. Review the dry run: it shows which tickets the graph would start and why the others wait. Then run passes by hand or start the dispatcher timer (below).

## Running the dispatcher

From the project, with the integration branch checked out:

```sh
.sandcastle/dispatch.sh --dry-run   # show what would start, launch nothing
.sandcastle/dispatch.sh             # one real pass
```

It uses the checked-out branch as the base (it must be on origin), checks that `node`, Docker and the tracker and agent CLIs (`glab` and `claude`, or `gh` and `pi`) are there and logged in, and that the image in `CONFIG.image` exists and was built for your user. From a terminal it builds a missing or mismatched image; under the timer it stops and prints the build command instead. Other arguments go to `dispatch.mts`: `--max N` (concurrent runs, default 3) and `--whole-issues` (one run per issue, ignoring Tasks).

Retry a failed run by deleting its record, `~/.local/state/sandcastle/<project>--<iid>.json` (or `.sandcastle/state/` without the shared state dir). The next pass picks the ticket up again.

### On a schedule (Linux)

Each project gets its own systemd user timer, `sandcastle-dispatch@<name>.timer`, which runs a pass 5 minutes after the last one finished. All projects share the run cap and the board. There's no launchd version for the dispatcher yet, so on macOS run passes by hand.

```sh
cd ~/Projects/<project>                       # with the integration branch checked out
.sandcastle/dispatch.sh --dry-run             # once from a terminal: builds the image, checks logins
<sandcastle-helper>/orchestrator/install-dispatch.sh            # name = the repo folder's name
<sandcastle-helper>/orchestrator/install-dispatch.sh --name foo # if two repos share a folder name
loginctl enable-linger $USER                  # once per machine: keep timers running when logged out
```

```sh
systemctl --user list-timers 'sandcastle-dispatch@*'   # every project's next pass
journalctl --user -u sandcastle-dispatch@<name> -f     # one project's dispatcher log
<sandcastle-helper>/orchestrator/install-dispatch.sh --uninstall <name>
```

The timer never builds the image: after a Dockerfile change, run `.sandcastle/dispatch.sh --dry-run` from a terminal to rebuild it. To change a project's base, check out the other branch in its repo; the next pass uses it.

Upgrading from the single-project timer:

```sh
systemctl --user disable --now sandcastle-dispatch.timer
rm ~/.config/systemd/user/sandcastle-dispatch.{service,timer}
```

then run `install-dispatch.sh` from each project.

### Updating a project's copy of the workflow

Projects run their own copy of the files in `.sandcastle/`, so changes here don't reach them on their own. After pulling this repo, copy the files listed in `orchestrator/ADAPTING.md` ("Install into a project") into the project again, except the ones you adapted (`config.mts`, `main.mts`'s `CONFIG`, `prompt.md`, `prompt.verify.md`, `sandbox/bootstrap-site.sh`): merge changes into those by hand. Then check new settings in `config.mts` against the shipped one, and run `.sandcastle/dispatch.sh --dry-run`.

### On a new machine

```sh
git clone <project> && cd <project> && git checkout <integration branch>
npm install
cp .sandcastle/.env.example .sandcastle/.env    # then fill it in; it's gitignored
glab auth login --hostname <gitlab host>
claude auth login
.sandcastle/dispatch.sh --dry-run               # builds this machine's image
```

Each machine builds its own image (CPU architecture and user ID differ). Don't run dispatchers for the same project on two machines: each keeps its own state, so they would start the same tickets twice.
