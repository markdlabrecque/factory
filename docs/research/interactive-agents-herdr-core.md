<!-- Spike #6 report: attaching to and steering a running interactive agent through herdr-core. Experimental; not wired into Factory. -->
# Interactive agents under herdr-core (spike #6)

**Status: experimental, not supported.** Nothing in Factory's runner or dispatcher changed.

**Recommendation: investigate further, leaning adopt for the attach/steer layer.** Persistent terminal, attach, steering, resize and detach all worked end to end. Completion, failure reporting and cleanup are not safe yet and need Factory-side work (see Gaps).

## What was tested

- **herdr-core:** `hc 0.1.17` (`~/.config/Ovis/bin/herdr-core`, bundled with the Ovis app). Not the older Herdr terminal application (0.9.5), which is a different product with a different CLI.
- **Isolation:** own session `HC_SESSION=factory-spike-6` (own socket and `serve` process). The `ovis` and `default` sessions were never addressed by a write command.
- **Stack:** `hc run --bg` terminal, running a Sandcastle 0.14.0 script, which calls `sandbox.interactive()`, which starts `docker exec -it` on Claude Code 2.1.319 (`--dangerously-skip-permissions --model claude-sonnet-5-5`) in image `sandcastle-islandhealth:latest`. Ticket #6 was changed from Pi to Claude Code by the owner.
- **Fixture:** throwaway Git repo outside the project, harmless prompts only. No push, no live tickets, no verifier.
- **Auth:** an owner-supplied `CLAUDE_CODE_OAUTH_TOKEN` in a `chmod 600` file, passed as container env. Never printed.

Launch used (paths shortened):

```sh
export HC_SESSION=factory-spike-6
env -u HC_TERMINAL_ID hc run --bg --no-parent --no-notify --name spike-r5 --cwd <fixture> "RUN_ID=r5 tsx runner.mts"
hc send --wait spike-r5 "<text>"; hc interrupt spike-r5; hc get spike-r5; hc events
```

`runner.mts` was ~25 lines: `createSandbox({ branch, sandbox: docker({ imageName, env }), hooks.sandbox.onSandboxReady })` then `sandbox.interactive({ agent: claudeCode("claude-sonnet-5-5"), prompt })`, then `sandbox.close()` in `finally`.

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Real TTY, no attached UI | **Pass** | Claude's TUI rendered with no client attached; in the container `claude` ran on `pts/0`, size 120x200. |
| 2 | Attach to the same live process; resize | **Pass** | Attach at 40x100 changed container `pts/0` to `40 100`; after detach it returned to `120 200`. Same `claude` pid (48). |
| 3 | Interrupt, then revise | **Pass** | Interrupt during a 40-file task stopped it at 18 files (state `working` -> `idle`). The revised instruction created `revised.txt`; no more `f` files appeared. |
| 4 | Detach while working, reattach | **Pass** | Files grew 4 -> 7 -> 15 -> 40 across a detach and reattach. Same pid; one Claude session file with every turn. |
| 5a | Turn done without marker is not acceptance | **Pass** | Agent state was `done` while the host-side marker check said `NOT_COMPLETE`. |
| 5b | Detach without marker is not completion | **Pass** | Same check after detach. |
| 5c | Run-scoped marker, once; stale marker invalid | **Pass** | `.handback/<run>.done` with a nonce. Stale `r2.done` was ignored for run `r3`; the real marker gave `COMPLETE_NEW`, a second poll gave `COMPLETE_DUPLICATE`. |
| 6a | Terminal client lost (SIGKILL on attach client) | **Pass** | Work continued to 40 files; container size reset to `120 200`. |
| 6b | Container lost mid-work (`docker kill`) | **Pass, but see Gaps** | Sandcastle returned `interactive exit=137`. The herdr-core terminal showed `finished`, `exit_code: 0`. Agent status was `null`, not an error. |
| 7 | Lifecycle events through the Docker boundary, no broad socket | **Pass (screen-based)** | `hc events` streamed `status` events (`working`, `done`, with text such as "Writing e.txt") and `turn` events. The container had no mounted socket, no `HC_*` env and no `hc` binary. |
| 8 | Cleanup, no orphans | **Pass after manual step** | `hc kill` left the container running (orphan); it was removed by hand. Final container list matched the start. |

## Findings

**Runtime evidence**

1. **Attach is real.** `hc attach` joins the live `docker exec -it`; the same process and conversation continue. It was driven here through a scripted PTY, so a person's terminal was not tried.
2. **Status detection works without hooks in the container.** herdr-core reads the host-side terminal and reports `claude-code` with `working`/`done`. This is screen-based, so a Claude UI change could break it.
3. **`done` is not finished.** After a prompt to run `sleep 300`, Claude moved it to the background and the turn showed `done` with "1 shell still running". `hc interrupt` reported `stopped` but did not end that shell.
4. **Scrollback is not a transcript.** `hc read --lines 1000` held none of the earlier turns. The Claude session file inside the container did.
5. **Reported process is the host runner.** `foreground` is the Node runner, not the agent in the container.
6. **First-run dialogs block the agent.** A clean container showed theme, security notes, folder trust and a bypass-permissions warning. Two of my keystrokes picked "No, exit" because that was the default. Seeding `~/.claude.json` (`hasCompletedOnboarding`, `theme`, trusted `projects` entry) and `~/.claude/settings.json` (`skipDangerousModePermissionPrompt`) through `onSandboxReady` removed them.
7. **Path-mirroring mount hazard.** Sandcastle mounts the repo's `.git` at the host path. With the repo under `/tmp/claude-1000`, Docker created that parent as root inside the container and Claude refused to start ("Temp directory /tmp/claude-1000 is owned by uid 0"). Repos under `/tmp` or other CLAUDE_CODE_TMPDIR parents need care.
8. **Terminals you start are children** and end with their parent unless `--outlive-parent`. I used `--no-parent`.
9. **Kill is distinguishable, container loss is not.** `hc kill` gave `finished`, `signal: 1`, reason `killed`. A killed container gave `exit_code: 0`, the same as success, because the Sandcastle runner swallowed 137.

**Inference, not tested**

- Reboot or daemon-crash recovery. Only `server stop` of an empty session was run.
- A person attaching from a real terminal rather than a scripted PTY.
- Multiple simultaneous containers or terminals.

## Security

- Do not mount a host herdr-core socket into the agent container. Not needed: events and attach worked with none.
- The bypass-permissions flag is Sandcastle's default for interactive Claude; the container is the boundary.
- The token file must be `chmod 600`; it was `644` when first created.
- Anyone who can attach to a session can type as the agent. Keep sessions per-run or per-user.

## Gaps before this could be adopted

1. **Completion:** the marker is agent-written, so a non-compliant agent can skip or forge it. Real acceptance needs commits plus the verifier verdict. Idle, done and detach must stay separate from it.
2. **Failure reporting:** Factory's runner must pass the Sandcastle exit code through (137 above), or container loss reads as success.
3. **Cleanup:** killing the terminal leaves the container. The runner needs a signal handler that calls `sandbox.close()`, or Factory must sweep orphans.
4. **First-run config:** the image or the setup hook must seed Claude's config.
5. **Durability:** events are live only; Factory must reconcile from `hc get` after a gap.
6. **Recovery** after reboot or core restart is untested.

## Cleanup evidence

Terminals removed; container list identical to before the first run; test repo and worktrees deleted; `factory-spike-6` stopped with `hc server stop`. The `default` session stayed at 0 terminals. The `ovis` session went from 2 to 3 live terminals during the spike; no command here targeted it, so I believe that was the owner's own use, but I could not prove it. The old Herdr 0.9.5 files were left alone.
