# Slice 3 acceptance checks

## Result

Checks completed. **The current documented command paths pass, but this is not an unconditional sign-off against the epic's historical Q&A.** Two installed-CLI probes expose one missing requirement: `factory run` does not refuse an active or completed run record before invoking the project's dispatcher. No code was changed to hide or fix that result.

| Layer | Result |
| --- | --- |
| Complete repository regressions, run twice | **118/118 pass**, 0 fail, 0 skipped, 0 cancelled. The captured rerun exited 0. |
| Focused slice-3 regressions (`runs`, `dispatch`, `run`, `retry`, `status`, `logs`) | **18/18 pass**, exit 0. This is a subset of the full suite, not 18 additional unique tests. |
| Installed CLI, disposable-project probes, run twice | **40/42 pass; 2 fail**, both for the missing run-record guard. |
| Chromium, installed board plus existing live board | **13/13 pass** in the final run. Includes real 10-second polling, no reload, retained filter/focus, CLI/API agreement, and screenshots/video. |

## Tested installation and boundaries

- Date: 2026-11-11.
- Source checkout: `main` at `11f6186b4f5a1eeaff1c001aaa94fbfbefab094b`. This is the tested revision, not a claim that the checkout includes every subsequent remote merge.
- Runtime: Node v22.23.2. Browser version and executable are recorded in `browser/environment.json`; Chromium was used, not Firefox or WebKit.
- Installed command: `/home/mark/.local/bin/factory`, resolving to `/home/mark/.local/share/factory/app/cli/bin/factory.mts`.
- `inventory.json` contains SHA-256 identities for source and installed modules. The installed copy is not byte-for-byte current source. Its `run`, `retry`, `status` and `logs` modules match the tested source; the CLI router, shared lookup, dispatch hook and board store differ. Tests of the installed copy actually used that copy, not an assumed source equivalent.
- Synthetic CLI fixtures have an isolated `FACTORY_HOME` and state folder, synthetic Git origins, and test-owned `systemctl`, tracker, agent, Docker and HTTP-command stubs. The service-manager stub accepts only the board's read-only `show` query and rejects every other call. The fake dispatcher and fake run emit known output and exit codes; they never launch a ticket or contact a tracker. The token in the synthetic fixture is a literal dummy string, not a host credential.
- Live observations were limited to `factory status --project factory --json`, local board/API GETs, and a Chromium project filter. Only the Factory project's live rows and screenshot were retained, not another project's ticket details.
- No real `factory run`, dispatch pass, retry, service install/restart, or deliberate failure of real work was performed. No credential retrieval, production access, deployment, project-copy refresh or product-code change occurred. The untracked `.sandcastle/worktrees/` and `docs/slice-5-plan.md` were left alone.

## Commands and evidence

Full output is retained, not just success counts.

```sh
node --test cli/test/*.test.mts orchestrator/*.test.mts board/*.test.mts
node --test cli/test/{runs,dispatch,run,retry,status,logs}.test.mts
python3 scripts/installed-checks.py
node scripts/browser-checks.mjs
```

- `out/full-suite.tap`, `out/full-suite-rerun.tap`, `out/full-suite-rerun.exit`.
- `out/focused-suite.tap`, `out/focused-suite.exit`.
- `installed-summary.json`: every probe, boolean result, invocation argv/cwd, exit code, duration and stdout/stderr filenames. `installed-first-run-summary.json` retains the first run.
- `out/installed-checks.log` and the named `out/*.stdout`/`*.stderr` files: complete installed-command output.
- `out/service-calls.jsonl`: exact service-manager arguments. Only read-only board queries were accepted.
- `observations/`: the fake foreground run log, retained retry log/evidence, preserved branch list and synthetic registry.
- `browser-summary.json`, `out/browser-checks.log`, `browser/*.json`, screenshots and video.

## Coverage of the requested checks

| Check | Observed data |
| --- | --- |
| Status text/JSON accuracy | Installed `status` selected alpha's three records, excluded beta, showed the same stages in text and JSON, and presented a dead nonterminal process as stopped. Synthetic active, inactive, missing and unreachable-manager responses were distinguished. |
| Project selection | Cwd in a subdirectory resolved to its registered root; `--project` by name and by an interior path selected the intended project; an unregistered directory was refused with an explanation. |
| Dispatch arguments, base, state and exit | The installed CLI called the real shipped `orchestrator/dispatch.sh` copied into a synthetic project. Its final synthetic pass saw exactly `--base main --dry-run --max 2 --whole-issues`, root cwd and the isolated Factory state folder. The wrapper returned the fake pass's exit 7. Invalid `--max 0` was refused before the script. |
| Dependency decisions | The full suite's real `orchestrator/graph.test.mts` covers blockers, conflicts, capacity, analysis, satisfied dependencies and stale manifests. The checkout's copied `.sandcastle/graph.mts` is byte-identical to `orchestrator/graph.mts`. A real project dry-run was deliberately not used because it can perform authentication and agent analysis; no live launches were needed to check the decision logic. |
| Run streaming, logging and exit | The installed CLI used the real shipped `dispatch.sh --issue` path with fake prerequisite tools and a fake `npx`. It forwarded `tsx .sandcastle/main.mts --base main --issue 501`, streamed both known stdout/stderr lines, wrote them to `run-501.log`, and returned fake exit 4. This proves forwarding/logging, not a real implementation run. |
| Invalid run arguments | Missing/non-numeric ticket and extra positional arguments were refused. |
| Retry eligibility | Stopped and dead-process records were cleared. Active, done, queued and waiting records were refused and left byte-identical. Missing record was refused with exit 1, matching the current command docs. |
| Retry preservation | The stopped record alone was removed. `601-retained`, its log and its evidence remained. The command warned that the retained branch prevents dispatcher selection. |
| Log selection | Explicit ticket selected the exact log; without a ticket it selected and named the newest log. Missing-log errors named the expected file. |
| Follow, truncation, Ctrl+C | A real PTY showed initial output, appended output and output after truncation. Sending terminal Ctrl+C stopped the follower; a separately held synthetic process stayed alive. This was not merely an injected AbortSignal test. |
| Board/CLI agreement | In the isolated board the installed CLI and API agreed before and after a stage change. On the live installation, all 16 Factory rows agreed between CLI/API, the board service reported active, and Chromium rendered the same Factory card count. |
| Board polling | A fixture changed implementing to verifying and added a new done record. The UI updated through its actual polling interval without navigation/reload; project filter, focused link and updated note were preserved. |
| Board rendering | Screenshots before/after, a new-card screenshot, a Factory-only live screenshot and synthetic-board video are retained. No uncaught page errors occurred. Images were also visually inspected for the displayed stage and readable cards. |
| Installed project-copy compatibility | The actual checkout's copied `dispatch.sh` lacks `--issue`. When that script was copied into an isolated registered fixture, the installed `factory run` refused it before executing it, with the expected refresh guidance. No real project file was refreshed. |

## Finding 1: `run` does not guard active or completed run records

**Unmet epic Q&A requirement.** Q4 says a run is allowed only when there is no record or the record is queued/waiting; active and completed records should be refused. The implementation tests do not cover that guard, and it is absent from the current wrapper.

Reproduction in the disposable alpha project:

1. Write a valid `fixture_alpha--801.json` record with `stage: implementing` and a live PID.
2. Invoke installed `factory run 801 --project alpha`.
3. The synthetic run dispatcher executes and returns its sentinel exit 4; the wrapper does not refuse the record.
4. Repeat for a valid `done` record, ticket 802: same result.

Probe IDs: `epic-run-record-guard-implementing`, `epic-run-record-guard-done`. Full stdout/stderr is in `out/run-record-{implementing,done}.*`; both complete probe runs reproduce the result.

Location: `cli/src/commands/run.mts:15-27`. That module is byte-identical in source and the installed app. It validates the ticket and script compatibility, then calls `runDispatchSh` without checking run state. The real orchestrator separately rejects an existing ticket branch (`orchestrator/main.mts:123-125`); that is **not** a run-record guard. These probes do not claim to have launched duplicate real agents or bypassed that branch check. They demonstrate that an isolated project dispatcher is invoked despite the record, contrary to Q4.

This requires either a scoped fix with a regression test or an explicit acceptance change. It was not fixed, waived, or silently marked PASS here.

## Setup gap and specification drift

- **Expected setup gap, not a new slice-3 defect:** this checkout's `.sandcastle/dispatch.sh` predates `--issue`. Real-project `factory run` cannot take the successful path until that project copy is explicitly refreshed. The epic puts copy refresh in slice 5 and requires the clear refusal, which passed. The successful path was exercised safely against a current synthetic copy.
- **Historical Q&A versus current docs:** Q5 says missing-record retry is a no-op with exit 0, while current docs and code refuse it with exit 1. Q6 describes all-runs status outside a project, while current docs and code require a registered project or `--project`. The probes record the latter documented behaviour; this report does not silently treat those differences as approved amendments to the epic.
- **Historical board records:** the real board and CLI both retain old stopped records, including prior recovery/documentation attempts. Equality here means they agree on recorded run history, not that this test reconciled every card with GitHub's merged state. No history was cleared.

## Probe-harness corrections

Two browser assertions failed during harness development, not because the application failed:

1. The first run compared rendered `innerText` to title-case `Verifying`; CSS renders it as `VERIFYING`. The semantic DOM text and screenshot already showed the correct stage. The final assertion checks semantic `Verifying`, separately records rendered text and still requires a real API poll.
2. The next run reused the previous synthetic added-card record, making the initial fixture count wrong. The harness now recreates only its own disposable browser state before each run.

Both initial summaries/logs are retained as `browser-{first,second}-run-summary.json` and `out/browser-{first,second}-run.log`. The final run is 13/13. No product test was retired or weakened and no product code changed.

## Reproduction notes

The probe scripts record this machine's installed paths. Extract the evidence under `/tmp/factory-slice3-checks-20261111` on this machine, then run the installed harness followed by the browser harness. The installed harness recreates **only its own** `fixtures/` directory; do not run the two harnesses concurrently. Chromium is `/usr/bin/chromium`; the Playwright module path is explicit in `browser-checks.mjs`.

The archive omits disposable installed fixture trees, Git object stores and the synthetic `.env`; the scripts recreate them. Evidence outputs, per-command transcripts, preserved-file observations, module hashes, screenshots and finalized videos are included. All helper servers, browsers, log followers and held synthetic work were stopped at completion.
