VERDICT: FAIL

# #33 re-verification against the revised systemd boundary

- **Tested SHA:** `991180a96ad63918ece3aea5f6323f7224549029` on `33-deliver-the-linux-schedule-enable-to-uni` (parent `dbfd2f3`, #32). At the end HEAD was unchanged and `git status --porcelain` was empty. No tracked file was edited.
- **Feature classification:** new feature (`factory schedule`, `factory-tick.{service,timer}`, `cli/src/tick.mts`). There is no "before" behaviour.
- **Boundary used:** `systemctl` was replaced by a stateful stub that can fail on demand (`stub/systemctl`). This host has no systemctl, so no call could reach a real manager.
  - It records exact argv arrays in `calls.jsonl`.
  - It models unit-file presence, `enabled` and `active` as separate states, and returns the `show` output shapes Factory parses.
  - It injects failures for an exact argv (once or always) and rejects unknown verbs. **0 of 191 calls were rejected.**
- **Not re-labelled:** the prior INCONCLUSIVE stands for what it covered. This verdict is a fresh review of the code, not a relabel. The old `e2e.sh` stub always exits 0, so under the revised policy it is not sufficient evidence. It was read but not reused.

## Why FAIL

Missing systemd is not the reason. The failures are in Factory-owned behaviour that the current ticket requires explicitly, observed through Factory's real CLI and production `Systemd` backend.

### Blocking defects (Factory-owned, ticket-explicit)

1. **Uninstall does not preserve an executing pass, and does not first commit `enabled=false`.**
   - **Where:** `cli/src/commands/uninstall.mts:26` walks the ledger without writing the global switch.
     - `cli/src/platform/systemd.mts:39` runs `systemctl --user stop factory-tick.service`.
     - `cli/bin/factory.mts:79` turns SIGTERM into an abort.
     - `cli/src/tick.mts:50` handles that abort with `child.kill('SIGTERM')` on the running `dispatch.sh`.
   - **Seen in `out/p3-preserve.txt` §B:**
     - After uninstall, `scheduler.json` still says `"enabled": true`.
     - The stub log shows `["--user","stop","factory-tick.service"]`.
     - We then applied only the documented, trusted effect of that stop under `KillMode=process`: one SIGTERM to the tick's main PID. Factory's own tick then killed the held pass (`pass alpha: exit 128 after 1s (interrupted)`, tick exit 143). Only the detached child survived.
   - **Ticket rule broken:** "Uninstall first commits global enabled=false … preserves an executing pass and detached runs", and "`remove` follows the same preservation rule". Also seen in `out/p1-lifecycle.txt`.
2. **Reinstall does not stop future activation or leave the desired switch disabled.**
   - **Where:** `cli/src/commands/install.mts` (only board entries, `:25`) does not look at scheduler artifacts.
   - **Seen in `out/p4-reinstall-optin-cli.txt` §A:**
     - With the scheduler on, `factory install` issued only board calls.
     - The stub timer stayed `enabled: true, active: true`.
     - `scheduler.json` stayed `enabled: true`.
     - `schedule status` still said "Scheduler: on".
3. **Scheduled dispatch does not ignore stdin.**
   - **Where:** `cli/src/tick.mts:49` spawns with `stdio: 'inherit'`.
   - **Seen in `out/p1-lifecycle.txt`:** with the tick run on a pty (`script`), the fake dispatcher recorded `stdin=/dev/pts/0 stdin_tty=yes`.
   - **Why it matters:** `orchestrator/dispatch.sh:121` builds a missing image whenever `[ -t 0 ]`, so a tick started from a terminal can trigger an automatic image build.
   - **Under the unit:** systemd's default `StandardInput=null` is trusted, and the dispatcher saw `/dev/null`. The ticket still requires Factory's own spawn to ignore stdin.
4. **Global on does not roll back the desired switch when enabling fails.**
   - **Where:** `cli/src/commands/schedule.mts:91-92`.
   - **Seen in `out/p2-failures.txt` §A:** `enable --now factory-tick.timer` was made to fail. The command exited 1, but `scheduler.json` kept `"enabled": true`. The ledger was kept correctly, and a repeat `schedule on` repaired it.
5. **Project opt-in skips two of the required checks.** It does not check that the branch exists on origin, and it does not check that `dispatch.sh` is executable.
   - **Where:** `cli/src/commands/schedule.mts:54` (`copyProblem` only checks that the file exists and greps for `reserveRun`) and `:79`.
   - **Seen in `out/p4-reinstall-optin-cli.txt` §B:** three projects that should have been refused were accepted:
     - a local-only branch,
     - a project with no `origin` at all,
     - a mode-644 `dispatch.sh`.
6. **A tick returns 0 when a project's pass fails.**
   - **Where:** `cli/src/commands/schedule.mts:68` returns 0 unless interrupted, and `tick()` reports `result:'done'`.
   - **Seen in:** `out/p4-reinstall-optin-cli.txt` §D (the pass exited 3, the tick exited 0) and `out/p5-units-manifest-clock.txt`.
   - **Ticket:** "return nonzero on project error".
7. **The scheduled pass gets neither `--max 3` nor `FACTORY_SCHEDULED=1`.**
   - **Where:** `cli/src/tick.mts:49` passes `[]` and the inherited env.
   - **Seen in `out/p1-lifecycle.txt`:** the dispatcher recorded `argv=[]` and `FACTORY_SCHEDULED=<unset>`. The dispatcher's default cap happens to be 3 (`orchestrator/dispatch.mts:65`), but the ticket's explicit invocation contract is not met.
8. **The agreed CLI contract `schedule on|off|status [--project <name|path>]` is not implemented.**
   - **Where:** `cli/bin/factory.mts:45` defines `schedule: { json }` only, and the target is a positional argument.
   - **Seen in `out/p4-reinstall-optin-cli.txt` §E:** `--project` gets `Unknown option '--project'`, and project-filtered status is not available.
9. **No scheduler run state is persisted.**
   - The tick writes no `scheduler/state.json`: no running/result record before or after a pass, and no PID on spawn (`out/p1-lifecycle.txt`).
   - So `schedule status` cannot show the "last project result" that the ticket's initial status requires.
   - The full status contract and timing history belong to later tasks (G/#36) and are not counted here.
10. **The required automated test coverage is missing.**
    - There is no `cli/test/schedule-linux.test.mts`.
    - No repository test drives the production `Systemd` adapter's command construction against a fake manager subprocess. `cli/test/scheduler.test.mts` uses only the in-memory `Fake` plus `schedulerUnits()` text.
    - The ticket and TESTING.md both require this.

### Contract deviations, lower severity

- **Config storage:** it is `~/.config/factory/scheduler.json` `{version,enabled,since}`, not `schedule.json` `{version,enabled,path,node}`. PATH and node are saved in the unit file, not the config. This shape comes from merged #31, so it is noted here rather than counted as a #33 blocker.
- **State dir:** scheduled children get `SANDCASTLE_STATE_DIR=runStateDir(p)`, which honours the caller's override (`cli/src/runs.mts:53`). The ticket wants `p.state` always. Under the unit the variable is unset, so the result is `p.state`; the only exposure is a hand-run `schedule tick` with an override. Found by reading the code, not probed.
- **Duplicated spawn:** the tick duplicates the spawn logic instead of adding the hook the ticket asked for to `runDispatchSh` in `commands/dispatch.mts`.

## Behaviour that met the criteria (evidence)

| Behaviour | Evidence |
| --- | --- |
| Repo suite `node --test orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts`: 76 pass / 0 fail | `out/01-repo-tests.tap` |
| Fresh install leaves the scheduler off and writes no tick units. Project opt-in makes no systemctl call and leaves the global switch off. Global on (even run inside a checkout) opts in no project | `out/p1-lifecycle.txt` |
| Global on runs exactly `daemon-reload` then `enable --now factory-tick.timer`. Only the timer is enabled; the service is never enabled | `out/p1-lifecycle.txt` |
| The ledger records `factory-tick.service` then `factory-tick.timer`, each once. If the second artifact fails, the first stays ledgered. A failed `daemon-reload` leaves both ledgered and both removable. Unowned paths are refused with no call made | `out/p2-failures.txt` §A–D |
| Tick run with exactly the unit's ExecStart and Environment (`env -i`, stdin `/dev/null`): cwd = root, PATH = saved PATH, `SANDCASTLE_STATE_DIR` = `p.state`, non-TTY stdin, a not-opted-in project is skipped | `out/p1-lifecycle.txt` |
| Off persists `enabled=false` first (even when disable fails), runs only `show timer` + `disable --now factory-tick.timer`, and never touches the service | `out/p1-lifecycle.txt`, `out/p2-failures.txt` §E |
| During a held pass, `schedule off` and project off kill neither the pass nor its detached child, and no later project starts | `out/p3-preserve.txt` §A, A2 |
| Branch drift or detached HEAD makes the tick skip the project with HEAD, refs, status and files unchanged and no stash created. The tick makes no systemctl call, so a failed pass never disables the timer | `out/p4-reinstall-optin-cli.txt` §C, D |
| Old protocol and detached HEAD are refused at opt-in. Project off works for a deleted checkout and keeps the branch. A repeated project on refreshes the branch | `out/p4-reinstall-optin-cli.txt` §B |
| Uninstall dry-run makes no calls and changes no files. Real uninstall removes timer → tick service → board by exact unit and leaves `unrelated.service`, config/registry and project files alone. Repeat uninstall, a ledgered unit missing on disk, a failed stop followed by a retry, and a board-only manifest all work | `out/p1-lifecycle.txt`, `out/p2-failures.txt` §F–H |
| Status reports `unknown`, never active, when `systemctl` errors or is missing | `out/p2-failures.txt` §I |
| Unit quoting of space, `"`, `\`, `%` and `$` round-trips exactly under systemd's documented grammar, with no specifier or variable expansion | `out/p5-units-manifest-clock.txt` |
| Directives: `Type=oneshot`, `TimeoutStartSec=infinity`, `KillMode=process`, no EnvironmentFile or shell, journal output by default, no `[Install]` on the service; timer has `OnActiveSec=1min`, `OnUnitInactiveSec=5min`, `Persistent=false`, no OnBootSec or randomized delay | `out/p5-units-manifest-clock.txt` |
| `validate()` accepts only exact unit/path pairs and rejects swapped paths, `factory-*` lookalikes, a missing unit and `__proto__` | `out/p5-units-manifest-clock.txt` |
| Fake clock: sequential visits; pass durations 125s/7s and tick 132s taken from the injected clock; a concurrent tick is `busy` | `out/p5-units-manifest-clock.txt` |
| Docs and header comments are updated in the four required docs plus `docs/factory-cli.md`, and match the code, including its documented "SIGTERM also stops the current pass", which conflicts with the ticket | `git diff dbfd2f3 HEAD` (reviewed) |

## Trusted, not tested (systemd semantics)

These are trusted, not proven by the stub:

- Real timer firing and rearming: 60 s first activation, 5 min after the service goes inactive, including after a failed run.
- Journald storage.
- Cgroup and `KillMode=process` signal delivery.
- `StandardInput=null` as the default.
- `daemon-reload` and `enable` on a real user manager.

Where systemd's documented stop semantics mattered (§B of P3), the single SIGTERM it would send was applied by hand. The defect is in what Factory's code does after that signal.

## Untested or unverified Factory-owned behaviour

- macOS routing: not runnable here. The code refuses `schedule on` before writing anything.
- A newline in a saved path creates an extra unit directive (P5, informational). Newlines are outside the characters the ticket lists.
- A pass killed by a signal is logged as `exit 128`, not 128+signal (cosmetic, seen in P3).

## Files (all under `/home/agent/evidence/33/reverify-systemd-boundary/`)

- **Scripts:** `stub/systemctl`, `lib.sh`, `unitparse.py`, `p1-lifecycle.sh`, `p2-failures.sh`, `p3-preserve.sh`, `p4-reinstall-optin-cli.sh`, `p5-units-manifest-clock.mts`, `run-all.sh` (reproduces everything).
- **Outputs:** `out/01-repo-tests.tap`, `out/p1-lifecycle.txt` (35 checks, 8 defects), `out/p2-failures.txt` (29/1), `out/p3-preserve.txt` (15/3), `out/p4-reinstall-optin-cli.txt` (27/8), `out/p5-units-manifest-clock.txt` (31/1), `out/stub-rejected-count.txt` (0).
- **Fixtures:** `fixtures/*` are disposable homes, synthetic Git projects, stub state and exact call logs.
- **Counting note:** "defect" check lines include several that restate the same root cause; the numbered list above is the de-duplicated set. One P1 line, "status --json has phase/cap", is the deferred task-G contract and is not counted.
