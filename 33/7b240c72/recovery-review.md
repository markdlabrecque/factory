VERDICT: PASS

# #33 recovery, second re-review of review-0 findings (reviewer-2)

Scope: only the four numbered findings in `/recovery/review-0.md`, and the three residuals review-1 left inside findings 1 and 2. I didn't restart the full review.

All four findings are now resolved. Each review-1 residual is fixed in the code, has a regression test, and is caught by a targeted mutation. My own earlier probes now show the corrected behaviour.

## Tested revision

- HEAD `991180a96ad63918ece3aea5f6323f7224549029`, unchanged. Branch `33-deliver-the-linux-schedule-enable-to-uni`. PR base `dbfd2f35d25e792e5ef5c093edde5e76f8911b6d`.
- Tree: HEAD plus the uncommitted round-3 diff. It's the same file set as before (20 tracked files changed, 10 untracked). The implementor's snapshot is `/recovery/evidence/uncommitted-round3.patch`.
- Fingerprint, computed as in review-0 and review-1 (`git diff HEAD`, then each untracked file's contents sorted by path, piped to sha256): `166146f5fb115a681584d8b01fbf73a8ca670f905523f1e120d5d62f3888984a`. Review-1 reviewed `d314a914...`.
- I inspected the current `cli/src/commands/schedule.mts` (`StopReport`, `stopScheduling`, `describeStop`), `cli/src/commands/tick.mts` (header lines 1-28 and the result handling at lines 134-168), the new and extended tests in `cli/test/schedule-linux.test.mts` (lines 715-740 and 814-830), the "Review-1 round" section of `/recovery/implementation.md`, and `/recovery/evidence/mutation-checks-round3.txt`.
- Node v22.23.4, Linux, no systemd. I didn't modify, stage or commit any worktree file. I wrote only `/recovery/evidence/review-2/*` and this report.

## Commands and results

| Command | Result |
| --- | --- |
| `node --test orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts` | 118 pass, 0 fail. `/recovery/evidence/review-2/full-suite.tap` |
| `node --test cli/test/schedule-linux.test.mts cli/test/scheduler.test.mts cli/test/schedule.test.mts`, twice | 52 pass, 0 fail both times. No stray `sleep 300` or leftover loop processes afterwards. `/recovery/evidence/review-2/focused-reruns.txt` |
| Rerun of my review-1 probe, `node --test /recovery/evidence/review-1/probes.test.mts` | R1-a now fails, because it asserted the old misreport. The message is now `The active tick was stopped. The pass for /w/alpha had already finished on its own.` and state.json records `ok`. `/recovery/evidence/review-2/review-1-probe-rerun.txt` |
| Read `/recovery/evidence/mutation-checks-round3.txt` (implementor's evidence, not rerun) | M19, M19b, M20 and M21 each fail the test named for them |

## Disposition per finding

### 1. `off` misreported a tick that systemd's stop had cancelled: resolved

- The round-2 fix still holds. The manager's tick state is read before the stop, the CLI never says "No tick was running" when the manager showed a tick, and a failed read is reported as unknown. Covered by the earlier tests and by mutations M14 and M15.
- Residual 1a is fixed. `stopScheduling` (`schedule.mts`) now keeps each pre-stop `running` entry's result after the stop.
  - `interrupted` lists only the entries that are now `interrupted`.
  - The new `finished` list holds entries that ended on their own.
  - `describeStop` says "had already finished on its own" for those and never calls them cancelled.
- Evidence:
  - The new test "off does not call a pass cancelled when it finished on its own while the stop was taking effect" covers both outcomes. A rewrite to `ok` gives the exact message, with no "cancelled" or "interrupted". A rewrite to `interrupted` names the project as cancelled.
  - Mutations M19 and M19b are caught.
  - My probe R1-a now gets the accurate message.
- Minor wording point, not a finding: in the unknown-manager branch, the message says "It found no tick lock or running pass" and can then add "The pass for X had already finished on its own." Both statements are true after the stop.

### 2. Ownership of a pass group was dropped while members were alive: resolved

- The round-2 behaviour still holds. Leftover members of a finished pass's group are terminated, confined to that group, and the record is dropped only once the group is empty. The detached ticket run survives. Covered by the earlier tests and by mutations M13 and M18.
- Residual 2a is fixed. The top comment of `cli/src/commands/tick.mts` (lines 18-25) now covers:
  - when the leftover group is terminated, and that the termination is confined to that group;
  - that this is cleanup after the pass ended, not a timeout;
  - the state.json reason;
  - that the lock keeps the group recorded and the tick exits 1 when termination can't be confirmed;
  - that `interrupted` is reserved for a cancellation that was requested.
- Residual 2b is fixed. In the unconfirmed branch (`tick.mts:139-155`), an observed exit code keeps `exitCode`, `finishedAt` and `durationMs`. The result follows the exit code (`ok` or `error`), the reason names the leftover group, the project counts as an error, the lock is kept and the tick exits 1. `interrupted` remains only for a cancellation that was requested. Finish time and duration are not invented when there is no exit code.
- Evidence:
  - The extended test (`schedule-linux.test.mts:814-830`) asserts `result: 'ok'`, `exitCode: 0`, a kept `finishedAt` and `durationMs >= 0`, the reason, the recorded lock, and that a later tick is `busy`.
  - Mutations M20 and M21 are caught.
  - README and `docs/factory-cli.md` mention the unconfirmed case.

### 3. Failed enable and partial installation untested through the production adapter: resolved (unchanged since review-1)

The three stub-level CLI tests are still present and pass: a failed `enable --now`, a failed `daemon-reload`, and `schedule on` run twice.

### 4. Docs conflicted with the cancellation contract and slice status: resolved (unchanged since review-1)

`TESTING.md` lines 1-67 still match the policy word for word, with the reconciling paragraph in "In this repository". The `docs/factory-cli.md` status line is still correct. No em dashes were added in this round.

## Remaining actions

None within the scope of review-0.

## Limitations

- The stub boundary is unchanged. systemd's stop delivering SIGTERM to the tick and waiting for it is trusted and documented, not proven. In the tests a `FakeSchedule` hook or the test itself sends that SIGTERM.
- One branch has no dedicated test: a cancellation that was requested, couldn't be confirmed, and has no observed exit code. The implementor explains why in-process testing can't reach it, and I read that branch's code (`tick.mts:143-145`).
- I didn't rerun the implementor's mutation scripts. I read their output and checked that the named tests exist and assert the claimed behaviour.
- This PASS covers only the review-0 findings. The fresh re-verification of the repaired tree under the trusted-systemd boundary is a separate later stage.
- `origin/main` is still ahead of the PR base with #46 doc commits, so expect conflicts in the shared docs when the branch is rebased or merged.
