# sandcastle-helper

Helpers for [Sandcastle](https://github.com/mattpocock/sandcastle) setups.

- `skills/sandcastle-setup/` - Claude Code skill that scaffolds `.sandcastle/` from layers (GitLab tracker, web runtime, Drupal/WordPress, Playwright). Copy to `~/.claude/skills/`.
- `orchestrator/` - one-ticket loop: implement, verify with screenshot/video evidence, post to the ticket, push, open the MR. Start with `orchestrator/ADAPTING.md`.
- `board/` - run-state store and treasure-map status board. `board.mts` writes `.sandcastle/state/<iid>.json` per run and regenerates a self-contained `board.html` from `board.template.html`. Copy both into a project's `.sandcastle/`.
  - `board-server.mts`, `sandcastle-board.service`, `install-service.sh` - always-on version: a systemd user service serving the board at `http://127.0.0.1:4444` (and each run's evidence under `/evidence/`) from one shared state folder. Linux, Node 22.18+. Run `board/install-service.sh`, then `export SANDCASTLE_STATE_DIR=$HOME/.local/state/sandcastle` wherever runs start, so every project and worktree reports to the one board.

Without the service, the board assumes it runs from a repo root containing `.sandcastle/` and writes `.sandcastle/board.html`.
