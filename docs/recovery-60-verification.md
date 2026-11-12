<!-- Acceptance map for #60 (bounded container repairs), written by its continuation #74. New evidence against the continued tip; the earlier INCONCLUSIVE verdict on 2244777 stays as recorded on the ticket. Recovery is still inactive: nothing triggers it (#61) and factory init does not copy prompt.recover.md (#63). -->
# #60 acceptance map (continued by #74)

The earlier verification of `2244777` was INCONCLUSIVE because `main.mts --recover` never ran from sandbox readiness through repair, cleanup, verification and delivery. That verdict stands as history. This page maps the original #60 requirements to the continued code and the tests that now exercise it. Recovery is still **inactive**: nothing calls the launcher (#61) and `factory init` does not copy `prompt.recover.md` (#63).

## Starting-code findings, and what changed

| Finding on `2244777` | Now |
| --- | --- |
| Recovery used Sandcastle's `createSandbox({branch})`/`close()`. That manager prunes and removes worktrees, fast-forwards an existing branch and mounts the common Git directory writable. | `orchestrator/recovery-sandbox.mts` creates the attempt's own container on the existing worktree. It overlays attempt-private Git metadata (only the ticket's branch). Close never touches the worktree or a branch. The entrypoint test's Sandcastle stub throws if `createSandbox`/`docker()` is called. |
| The whole `.sandcastle/evidence` tree was writable, and `previous-run.json`/`verdict.md` were reused in the ticket folder. | Only `.sandcastle/evidence/<iid>/recovery/<attemptId>/` is writable. Its snapshots are mounted read-only. Earlier evidence is copied to `history/` and never removed. |
| Container ownership was guessed from a `sandcastle-*` name plus the worktree mount. | The launcher fixes `factory-recovery-<uuid>` before spawning and records it. Only `docker container inspect/rm -f <name>` are used, so a container mounting the same worktree is never touched. |
| `repairWithin` accepted a result that settled after the deadline or a cancellation. | A late result is `timed-out`/`interrupted` (`orchestrator/recovery.test.mts`). |
| `blocked.json` or a Markdown report decided the outcome. | `recovery-report.json` is validated (`checkReport`). The report can only stop delivery. Outcomes and host fields are written by Factory to a host-owned record outside every mount. |
| The orchestration lived only in `main.mts`, which can't be imported in tests. | `runRecoveryAttempt` in `orchestrator/recovery.mts` is import-safe, with injected boundaries. `main.mts --recover` calls it with the real ones, and no test-only copy of the algorithm exists. |

## Requirements

| #60 requirement | Production path | Test | Result |
| --- | --- | --- | --- |
| Runner accepts only an admitted attempt for the exact project/iid | `main.mts` recovery block: the attempt record, the run record's `recovery.{attempt,id}`, the arguments and the worktree location must agree, and the record must be `claimed` | entrypoint test (second start refused, no Docker call); runner "never run twice" | Met with existing primitives. There is no coordinator *generation* (see gaps). |
| `prompt.recover.md` with exact attempt placeholders; per-attempt artifacts | `orchestrator/prompt.recover.md`; `runRecoveryAttempt` steps 1–2 | runner: success test lists every artifact | Met (`recovery-context.json`, `previous-run.json`, `previous-logs/`, `history/`, `input/`, `recovery-report.{json,md}`, `verdict.md`, `repair.log`). The outcome is in the host-owned attempt record, not a separate `verdict.md`. |
| Repair with `AGENT.model` regardless of ticket model labels | `main.mts` passes `AGENT.model`. In recovery mode a bad model label no longer stops the run. | entrypoint test: ticket labelled `model:sonnet`, only `claude-opus-5-5` requested; runner: only `ctx.model` | Met |
| Report fields validated; missing/malformed/unresolved/host-followup never deliver | `checkReport` | runner table (8 no-delivery cases); recovery.test | Met |
| Unique owned container name recorded before creation; sandbox ID persisted | launcher, then `setup` event `creating <name>` before `docker run`, then `sandboxId` | recovery-run: identity recorded before spawn; runner: setup-failure test | Met |
| 900000 ms deadline immediately before repair, cleared before the verifier; setup, verifier and delivery outside it | `repairWithin` with an injected clock | runner: 20- and 40-minute setup, 40-minute verifier, a deadline that has not fired at 899999 ms | Met |
| Timeout/signal/error: abort, await termination, remove the exact container, confirm absence, preserve work | `finish()` → `containerGone` | runner: timeout, SIGTERM in repair and in setup, setup failure, `docker run` failure. Each checks the input status, refs, old evidence and untouched unrelated containers. | Met. The agent's `docker exec` is killed and awaited. Anything left inside dies with the container's removal. |
| Failed cleanup keeps cleanup-pending and returns failure | `cleanup-pending` with `intended`; exit ≠ 0; settle keeps the attempt `running` | runner: stuck container; recovery-run: unconfirmed, then a later settle | Partly met. See gap 2. |
| Restart reconciliation by exact identity, including a crash between create and ID persistence | `settleRecovery`: exact name from the attempt; a missing identity is never guessed | recovery-run: crash in `setup`, death in `delivering` (not replayed), legacy attempt without a container | Met |
| No-change transient repair verifies the existing tip | step 6 | runner: no-change test | Met |
| Successful repair: separate verifier, then host delivery of the exact tip | `runVerifier` → container gone → CAS import → `postAndDeliver` | runner: success; entrypoint: `gh pr merge --match-head-commit <tip>`, origin at the tip | Met |
| Dirty input preserved, never committed wholesale by the host | private index with staged blobs; leftover changes are `unresolved` | runner: dirty-input test (status unchanged, snapshot recorded) | Met. The agent may commit the parts it needs. |
| Host-followup stops without copying, restarting or filing | `checkReport` → `host-followup` | runner table | Met |
| Branch/ref isolation; host imports only the affected ref by CAS | `prepareGit`, `importRef` | runner: mounts test (`for-each-ref` shows only the branch; no common dir, socket or other evidence); moved-branch test (not overwritten; commits kept privately) | Met |
| Recheck requirements, exclusions and ownership before verification and delivery | `main.mts` `recheck`: ticket closed, `needs-human`, `unitHash` changed, run record still held | runner: changed before verify and before deliver | Partly met. See gap 4. |
| Ambiguous delivery is not replayed | `postAndDeliver` error → `failed`; a crash while `delivering` → `interrupted`, "not replayed" | runner: delivery throws once; recovery-run: delivering crash | Met (no lookup-before-replay is needed, because nothing replays) |
| Detached worker survives `schedule off` | launcher spawns into its own process group (unchanged from #60) | earlier launcher checks; recovery-run | Met |
| No automatic dispatch or activation | nothing calls `launchRecovery`; `prompt.recover.md` not scaffolded | init tests (scaffold list) | Met |
| Scaffold allowlist and import smoke | `cli/src/scaffold.mts` adds `recovery-sandbox.mts` | `cli/test/init.test.mts` (every imported module is scaffolded) | Met |
| Normal path unchanged; branch-exists protection | `main.mts` normal path (identical to before #60 apart from the hoisted `host` and the recovery-only model-label exemption) | entrypoint test: a normal start of #7 refuses the existing branch, no Docker | Met |

## Remaining gaps (missing upstream primitives, not bypassed)

1. **Admission coordinator generation.** No `<state>/admission/state.json` with claim tokens, project activity generations and one atomic claim-plus-charge exists. #57 delivered `claimRun` under the board's claim lock, and `beginAttempt` writes a separate recovery-state file. Fencing here uses the attempt's UUID on the run record and in the attempt record, not a generation.
2. **Claims after the worker exits (closed in the continuation).** A repair that exits with cleanup pending leaves a `hold` on its run record. A held record counts as in flight whatever its stage or pid, is not washed away, and blocks the ticket, its capacity slot and the whole project until `settleRecovery` confirms the exact container gone and lifts it. While a recovery attempt or hold owns a ticket, `claimRun` refuses any other run in the same project, and a recovery claim is refused while another run of its project is in flight. Still pid-based records, not an admission coordinator generation (gap 1).
3. **Ownership receipts and storage layout.** There is no `<state>/ownership/<projectId>/<iid>.json` and no `projectId = sha256(realpath+tracker…)`. Ownership is #59's `resumeTarget` plus the recorded tip, and recovery state keeps #55's `<state>/recovery/<key>.json`. A remote-only recorded branch is still refused rather than fetched. Records are written atomically at 0600 without fsync.
4. **Prerequisite holds before delivery.** The recheck covers the ticket's own text, state, `needs-human` label and claim. Dependency or open-PR prerequisite holds (the dispatcher's analysis) are not rechecked.
5. **Not exercised:** real Docker, a real agent CLI and a real tracker. Per TESTING.md, these are trusted external boundaries. The tests verify Factory's exact `docker`/`gh` arguments, mounts, ordering and failure handling against stubs.

## Result and where the gaps go

Two safety failures found by the independent verifier on `7de07af` are fixed here: a cleanup-pending attempt now keeps its ticket, capacity slot and project claimed until its exact container is confirmed gone, and a recovery attempt holds its project exclusively. Tests cover both (`cli/test/recovery-claim.test.mts`, `cli/test/recovery-run.test.mts`).

Gaps 1, 3 and 4 above, plus the `hold` mechanism replacing gap 2's pid-based claim, are tracked in #75 ("Make recovery claims and ownership survive crashes"), which blocks #61 and #64. Gap 5 is by design. This continuation does not complete #60 as originally specified: #60 stays open until #75 delivers, and recovery stays inactive.
