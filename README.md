# sandcastle-helper

Helpers for [Sandcastle](https://github.com/mattpocock/sandcastle) setups.

- `skills/sandcastle-setup/` - Claude Code skill that scaffolds `.sandcastle/` from layers (GitLab tracker, web runtime, Drupal/WordPress, Playwright). Copy to `~/.claude/skills/`.
- `orchestrator/` - one-ticket loop: implement, verify with screenshot/video evidence, post to the ticket, push, open the MR. Plus a dispatcher that starts many runs, held back by an agent-built ticket graph (dependencies and file conflicts). Start with `orchestrator/ADAPTING.md`.
- `board/` - run-state store and treasure-map status board. `board.mts` writes `.sandcastle/state/<iid>.json` per run and regenerates a self-contained `board.html` from `board.template.html`. Copy both into a project's `.sandcastle/`.
  - `board-server.mts`, `sandcastle-board.service`, `install-service.sh` - always-on version: a systemd user service (macOS: `com.sandcastle.board.plist` + `install-launchd.sh`, a launchd user agent) serving the board at `http://127.0.0.1:4444` (and each run's evidence under `/evidence/`) from one shared state folder. Node 22.18+. Run `board/install-service.sh` (Linux) or `board/install-launchd.sh` (macOS), then `export SANDCASTLE_STATE_DIR=$HOME/.local/state/sandcastle` wherever runs start, so every project and worktree reports to the one board.

Without the service, the board assumes it runs from a repo root containing `.sandcastle/` and writes `.sandcastle/board.html`.

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
  glab), labels, and milestone "<MILESTONE>" (or leave it unset to use every open ticket).
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

3. Review the dry run: it shows which tickets the graph would start and why the others wait. Then start the dispatcher timer (see `orchestrator/ADAPTING.md`).
