<!-- Deferred recovery tests use fixture-only settlement, exact-container Docker stubs and fake service-manager boundaries.
Existing delivery tests stub trackers and scheduler authorization; no live CI, agents or managers. -->
<!-- Factory test policy: fixture-owned boundaries and runtimes for normal tests; browser image and service-manager smoke checks are explicitly opt-in. -->
<!-- #150: proof/entrypoint tests use synthetic evidence and stub all agent/container/tracker boundaries. -->
# Testing

## Run the tests

Requires Node 22.18+; CI uses Node 24. From the repository root:

```sh
node --test orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts
```

CI sets `--test-concurrency=4` to overlap independent fixture subprocess waits on small runners. It still runs the complete inventory above with the 180-second suite deadline and 120-second per-test deadline. A two-CPU Node 24.20.0 fixture run completed all 714 tests in 99 seconds at this concurrency, compared with 172 seconds using the CPU-derived default. This is a scheduling choice, not a skipped-test or timeout waiver.

Automated tests use temporary homes, synthetic projects, fake clocks and stubbed external commands. Browser-probe fixtures expose the running Node executable in their isolated PATH rather than assuming a system installation path. They must not control real user services, contact trackers, run agents, build Docker images or fetch credentials.

`FACTORY_HOME` changes Factory's filesystem paths. It does **not** isolate `systemctl`, D-Bus or another service manager. Inject the fake backend or place test-owned command stubs first on the child process's PATH. Ensure unhandled calls cannot fall through to the host's service manager.

## Runtime bundle preparation

```sh
node --test cli/test/runtime-bundle.test.mts cli/test/runtime-ownership.test.mts cli/test/lifecycle.test.mts
```

These tests copy the assembly inventory into temporary fixtures and inject a package installer. They check source and lock identity, applicable optional dependencies, the exact npm command boundary, failed preparation, competing publication, path collisions and symlink refusal. Copied and linked install fixtures cover descriptor publication, old-bundle retention, process leases and uninstall refusal. Subprocess fixtures exit during temporary preparation and after publication to prove ownership recovery. Late service failure must leave the old descriptor unchanged. Concurrent asynchronous installs and uninstall are fenced across service awaits. Child processes interrupt ledger and lease writes before each rename to verify metadata recovery without weakening unknown-entry deletion checks. These regular tests do not run npm or contact a registry.

An opt-in smoke test exercises the real locked tsx, esbuild platform binary and Sandcastle imports with scripts disabled. Supply a cache containing the public tarballs from the root lock and an npm CLI path. It copies only those tarballs into an isolated cache, clears inherited npm configuration and runs npm with `--offline`. It never fills missing cache entries from the network or changes the supplied cache. Run on a supported Node 22.18+ binary and Node 24 when checking dependency compatibility:

```sh
node scripts/test-runtime-packages.mts /path/to/npm-cache /path/to/npm/bin/npm-cli.js
```

The implementation was smoke-tested with Node 22.23.2 and 24.20.0. This is not an execution test of the exact 22.18.0 patch release.

## Data-only projects and workflow diagnostics

```sh
node --test cli/test/init.test.mts cli/test/update.test.mts cli/test/project-config.test.mts cli/test/workflow-report.test.mts cli/test/telemetry.test.mts
```

Init and update fixtures verify data-only assets and preserve project bytes and modes. Workflow diagnostics use explicit synthetic historical copies for comparison, alongside a data-only regression. They do not restore runtime files to new projects or authorize repairs. Socket tests use fixture-owned Unix sockets.

## Shared workflow execution

```sh
node --test orchestrator/context.test.mts orchestrator/models.test.mts orchestrator/v2-contract.test.mts cli/test/runtime-bundle.test.mts cli/test/runtime-ownership.test.mts
node --test orchestrator/verification-entrypoint.test.mts orchestrator/recovery-entrypoint.test.mts orchestrator/refresh.test.mts orchestrator/delivery-followup.test.mts cli/test/project-config.test.mts cli/test/run.test.mts
```

`cli/test/shared-runtime.test.mts` exercises a copied install and data-only init
through the normal Pi Terra implementation and independent verifier happy path,
and a saved Pi Terra recovery with Large repair and independent verification. The
recovery case exercises preparation and readiness before charging, preserves prior
work and evidence, and settles the delivered attempt. These use an explicit ticket
tier. The normal cases poison project workflow files; the copied recovery checks
their absence. They trap npm calls
and checks that execution creates no project dependencies. It uses temporary bare
Git and fake SDK, tracker, container and authentication boundaries; it does not
run a real agent or prove semantic verification.

`cli/test/execution-fixture.mts` assembles complete temporary bundles from the
single runtime inventory with fake private dependencies. The tsx stand-in imports
only the supplied absolute entrypoint; no package manager or real agent runs.
Fixtures stage any test-specific workflow/provider changes before publication,
then validate the same manifest and dependency hashes as production. The normal
and recovery entrypoint fixtures stage their SDK outside the project and assert
that the project has no `node_modules`. They never write settings into the source
checkout or modify an installed app.

Context tests reject missing/noncanonical roots, wrong cwd, missing/mismatched
runtime identity, escaped settings and changed dependency/template bytes. Two
projects share runtime bytes while retaining separate settings and artifacts.
Real local Node children test independent lease tokens, a detached child's cleanup
boundary, uninstall refusal while owners are alive and bundle A remaining selected
after descriptor B publication. This is a process/metadata contract test, not a
real service-manager or container test.

Entrypoint fixtures poison project modules/templates, remove project dependencies,
and exercise both model families and all implementation tiers plus default Mid.
They preserve the independent verifier, immutable evidence, historical baseline,
claim, dependency, readiness, recovery-budget and exact-SHA delivery assertions.
Settings/template changes revoke authority without changing the running model
snapshot. The recovery fixture checks Large repair/verification regardless of
Small/Mid/Large implementation tier. Instruction loader and
context tests cover role ordering and containment. Refresh exercises analysis prompt
composition and cache invalidation after instruction edits, and existing-delivery
continuation refuses an old proof after an edit. Normal entrypoint tests check frozen
invocation text and refusal before verification; recovery captures composed repair and
independent verifier prompts. The normal SDK boundary is a one-pass substitution
contract stub, not a test of the real SDK. Run the full suite above after these focused tests.

## Complete workflow routing

```sh
node --test orchestrator/workflow.test.mts orchestrator/context.test.mts cli/test/workflow-routing.test.mts cli/test/run.test.mts cli/test/dispatch.test.mts cli/test/scheduler.test.mts cli/test/schedule-linux.test.mts cli/test/schedule-macos.test.mts cli/test/recovery-run.test.mts cli/test/recovery-prepare.test.mts cli/test/recovery-schedule.test.mts board/refresh-worker.test.mts board/install.test.mts
```

Resolver tests reject missing/unknown inventories, stale hashes, missing transitive
helpers/dependencies, illegal directories and source/dependency symlinks without
importing project code or falling back. The selected source tree is closed to the
runtime inventory, its parent directories, manifest and private dependencies.
Unknown helpers cannot sit outside the hashed inventory. Children pin both selected
and host dependency roots along with their runtime identities. Manifest regeneration is read-only until
the caller writes the returned value. Explicit override review binds complete source,
dependency and location identity; edits require regeneration and renewed review.

`cli/test/workflow-fixture.mts` publishes complete project overrides in
`.factory-workflow`, separate from mutable `.sandcastle` configuration, logs,
evidence and environment files. Tests edit selected code there and explicitly
regenerate its manifest before renewed review. Initial scaffold fixtures copy only
inventory assets across the data/code boundary. Re-publishing never restores a
removed mandatory helper. `cli/test/workflow-fixture.test.mts` checks those fixture
boundaries, including unchanged identity after data writes and refusal of unknown
code helpers or missing mandatory files.

`cli/test/workflow-routing.test.mts` records actual selected entrypoints and context
for both Factory and complete-project modes across CLI run/dispatch, scheduled
passes, never-opted read-only refresh, Board, recovery preparation and recovery
launch. It checks saved Node/PATH, cwd, argv, state and host-runtime handoff, plus
pause, ambiguous roots, missing descriptors and no-fallback refusal. The recovery
spawn boundary uses a sleeping Node child and the selected image-capability helper
is a fixture stub. This proves routing and host admission/charge contracts, not
actual agent, image or tracker behavior. Existing entrypoint, proof, lease, cleanup,
admission and budget tests remain mandatory. Board installation uses a fixture-only
npm command and fake service managers, never a registry or the user's services.

## Local event observations

```sh
node --test board/execution-events.test.mts cli/test/telemetry.test.mts
node --test board/board.test.mts board/install.test.mts cli/test/init.test.mts cli/test/update.test.mts cli/test/recovery-command.test.mts cli/test/recovery-run.test.mts cli/test/jam-detect.test.mts orchestrator/recovery-runner.test.mts
```

These tests use disposable state roots, synthetic Git projects, injected tracker replies and fake scheduler/container boundaries. Store tests spawn only local Node writers, crash them before/after publication, race stale-owner reclamation, check restrictive modes and verify append order and idempotent replay. Export tests compare file bytes and modification times, including missing history, filters, concurrent publication and corrupt data. Control tests check unknown attribution, explicit request/result correlation, no-op/refused/failed outcomes and the absence of inferred or automatic controls. Recorder failures at admission, charge, cleanup, settlement and command boundaries must leave authoritative outcomes unchanged. No installed project copy, login, service manager, browser, tracker or Docker daemon is required.

## Deferred recovery regression tests

```sh
node --test cli/test/recovery-followup.test.mts cli/test/recovery-schedule.test.mts cli/test/jam-detect.test.mts cli/test/recovery-state.test.mts cli/test/recovery-command.test.mts cli/test/scheduler.test.mts
```

These tests cover local settlement during project pauses, preserved saved branches, later two-pass re-evaluation after competing delivery, unchanged retry budgets, fail-closed ownership/global/cancellation gates, strict backward-compatible snapshots and read-only human/JSON status. The process-level scheduler fixture uses stand-in repair processes and a Docker stub that accepts only exact-container removal/inspection. It proves delivered attempts stay outstanding until authoritative merge, not actual tracker delivery or real Docker behavior. Run the full suite above after integration with the current main branch. Admission race, prerequisite and independent proof/CI/review tests remain mandatory.

## Systemd is a trusted dependency

Systemd is a well-tested third-party component. Factory tests its integration with systemd, not systemd's implementation.

Exercise the real Factory CLI, production service adapter and generated unit files against a stubbed `systemctl` boundary. A unit test can inject a fake backend; an end-to-end contract test must also exercise the production adapter's actual command construction.

| Verify in Factory tests | Trust systemd to implement |
| --- | --- |
| Exact command arguments, unit identities and lifecycle ordering | Its service and timer engines |
| Generated unit syntax, quoting, executable paths and environment | Its documented unit-directive semantics |
| Timer directives for initial delay, completion-relative interval and missed-tick policy | Actual elapsed timer firing and rearming |
| Configured output destination | Journald storage and retrieval |
| Configured kill mode and start timeout | Cgroup membership and systemd's signal delivery |
| Factory's own spawn, signal and shutdown behavior | Systemd's internal process management |

For example, assert that Factory writes the required timer directives and does not disable the timer after a failed pass. Do not wait for a real systemd timer to prove its documented rearming behavior. A stub cannot prove that behavior either; the test proves Factory supplied the correct integration contract.

## Stubs must test the contract

A `systemctl` stub must:

- Record exact argument arrays and reject unexpected calls.
- Model the enabled, active, inactive and missing states that Factory reads. Timer enablement and service activity are separate states.
- Return the output shapes the production adapter consumes.
- Inject failures at relevant lifecycle steps, including partial installation and enablement.
- Keep all files and state in the test fixture.

An unconditional `exit 0` stub is insufficient. Keep the stub limited to the command contract; do not build a substitute systemd scheduler.

Verify Factory's registry, ownership manifest, generated files, status output and error handling alongside the calls. Include repeated enable/disable, repair, dry-run, uninstall and refusal to overwrite unowned files. Preserve unrelated files and services.

Use injected clocks to test Factory-owned delays and elapsed-time calculations. Use synthetic subprocesses to test that Factory's disable/removal logic does not itself kill an active pass or detached child, and that it starts no later work after disable. Inspect the unit's kill/timeout directives separately. Do not describe a stubbed test as proof of systemd's actual process handling.

## Verification verdicts

The same boundary applies to unit tests, end-to-end tests and agent verification:

- **PASS:** the evidence supports the ticket's Factory-owned behavior and integration contract.
- **FAIL:** observed Factory behavior violates that contract.
- **INCONCLUSIVE:** evidence needed to verify Factory-owned behavior is unavailable.

The absence of systemd, a user bus, journald, a cgroup setup or a real timer in the verification container does **not**, by itself, justify INCONCLUSIVE. A privileged image, systemd as PID 1 and access to the host's manager are not acceptance prerequisites.

Evidence must name the stubbed boundary, commands run, assertions made and any untested Factory behavior. Do not claim real timer or journal observations from stub output. Do not turn an earlier INCONCLUSIVE verdict into PASS without reviewing the tested revision against this boundary.

This policy does not waive tests of Factory's own scheduling, concurrency, ownership, failure recovery or process lifecycle. It does not excuse an unrelated missing prerequisite or silently extend the trusted boundary to other dependencies.

## Verified delivery regression tests

Run the changed verification boundary first:

```sh
node --test orchestrator/verification*.test.mts orchestrator/handoff.test.mts orchestrator/delivery.test.mts orchestrator/recovery*.test.mts
```

`verification.test.mts` checks schema, evidence paths and frozen proof integrity with
synthetic bytes, not real browser media. `verification-entrypoint.test.mts` runs the
scaffolded ordinary entrypoint against real temporary Git repositories and fixture-owned
SDK, tracker and Docker commands. It exercises requirements/eligibility changes,
branch/claim changes, dirty verifier output, missing baseline and legacy prompts.
Recovery entrypoint/runner tests exercise the same proof lifecycle with isolated
private Git metadata and teardown. Adapter tests assert fresh host authorization after
CI and before SHA-guarded merge. These prove host integrity and command contracts;
they do not classify semantic acceptance coverage, validate video codecs or promise
atomicity between an external ticket edit and a tracker merge.

## Existing-delivery continuation tests

Run the changed boundary first:

```sh
node --test board/delivery.test.mts orchestrator/delivery*.test.mts cli/test/delivery-followup-schedule.test.mts
node --test orchestrator/refresh.test.mts cli/test/init.test.mts cli/test/update.test.mts cli/test/recovery-command.test.mts cli/test/recovery-run.test.mts cli/test/jam-detect.test.mts
```

Adapter fixtures exercise exact-head checks/jobs, required gates, identity/approval
holds and lost merge responses without live trackers. Proof fixtures use synthetic
command evidence and frozen host records. The copied-dispatch fixture runs local Git
against a temporary bare origin and a fixture-owned absolute read-only scheduler CLI;
manual/dry-run/refresh-only passes must perform no continuation. Admission tests cover
capacity, conflicting claims, stale tokens and PID reuse without repairing anything.
Scheduler tests assert the exact trusted command and malformed/off/paused/base-switch
refusals; they never run the host CLI against the user's service manager. These tests
do not prove real GitHub/GitLab behavior or atomicity of external edits and merges.

## Recovery preparation tests

Run the preparation boundary before the full suite:

```sh
node --test orchestrator/recovery-analysis.test.mts orchestrator/recovery-entrypoint.test.mts cli/test/recovery-prepare.test.mts cli/test/recovery-claim.test.mts cli/test/recovery-run.test.mts cli/test/jam-detect.test.mts cli/test/recovery-schedule.test.mts cli/test/init.test.mts cli/test/update.test.mts
```

Preparation unit tests inject ticket/catalogue/base reads and analysis. Process tests
run fixture-owned Node helpers and descendants, checking bounded JSON, cancellation,
timeout and retained ownership on unconfirmed cleanup. Admission tests compare local
manifest bytes and Git refs, including concurrent claims and zero-charge refusals.
The recovery entrypoint's pass scenario uses the copied preparation helper with a
fixture-owned `pi`, tracker and bare origin. It reproduces current assessment plus
stale execution analysis, preserves saved work/evidence, then follows independent
verification and delivery. Scheduled recovery fixtures inject synthetic preparation
rather than running a real analyst. No test contacts live trackers, agents, Docker,
credentials or a service manager.

## Offline image readiness tests

`orchestrator/capabilities.test.mts` injects Docker commands to exercise immutable identity, non-root/offline container arguments, exact cleanup, cancellation, owner-process locks, malformed cache and non-sticky failures. No daemon or auth is used. `browser-provisioning.test.mts` runs the actual Node watchdog against fixture-owned fake global modules and checks descendant cleanup. Normal/recovery entrypoint tests use synthetic owned Docker responses and verify setup failures start no agents; admitted setup failures retain their budget charge. CLI recovery tests inject readiness to prove known-bad images spend zero attempts and pause/off/cancellation still prevent admission. `image-config.test.mts` proves configuration discovery never executes project code.

Run these focused tests before the full suite:

```sh
node --test orchestrator/capabilities.test.mts orchestrator/browser-provisioning.test.mts orchestrator/verification-entrypoint.test.mts orchestrator/recovery-entrypoint.test.mts cli/test/image-config.test.mts cli/test/recovery-run.test.mts cli/test/recovery-schedule.test.mts cli/test/init.test.mts cli/test/update.test.mts
```

## Optional browser image smoke test

Run `./scripts/test-browser-image.sh` from this checkout with Docker/build access, network access for public build dependencies, and a non-root caller UID/GID. It builds a uniquely tagged disposable image from `.sandcastle/Dockerfile`, overrides the entrypoint and checks the non-root browser with synthetic content, screenshot and video from an empty directory. The runtime check downloads nothing. The image and container are removed on exit; configured images and services are untouched. The regular Node suite never runs this test.

## Optional deployment smoke tests

A real systemd user-session trial can provide additional deployment confidence, but is not an automated verification or merge gate. Obtain operator approval before changing host services. Use an isolated synthetic project, exact unit names and a cleanup procedure that preserves unrelated services and running work.

Never expose the host's systemd or D-Bus control socket to an agent container merely to satisfy verification. No production access or credential retrieval is authorized by a test or smoke-test instruction.

<!-- Recovery scan tests use disposable Git/state roots and stubbed process/container boundaries only. -->
## In this repository

The sentence above about Factory's disable/removal logic not killing an active pass is the general policy. Under the approved #30 and #33 contract, `schedule off`, uninstall and reinstall cancel the tick's own dispatcher process group. The tests here prove two things about that: the cancellation is confined to that group, and independently detached ticket runs survive it.

- `cli/test/stubs/systemctl` is the stateful, failure-injecting `systemctl` stub. `cli/test/schedule-helpers.mts` puts it first on a test's PATH, exposes its call log and states, and injects failures (`fail('--user stop factory-tick.service')`). Its `calls.jsonl` also records any rejected call, and tests assert that list is empty.
- `cli/test/schedule-linux.test.mts` runs the real CLI and the production adapter (`cli/src/platform/scheduler-systemd.mts`) against that stub, and cancels synthetic process trees: a dispatcher holding a nested shell, a nested analysis process with its own child, and one detached ticket run in its own group. Where it sends the tick SIGTERM itself, it stands in for what `systemctl stop` is documented to do under `KillMode=process`.
- `cli/test/stubs/launchctl` is the same kind of stub for macOS: it models the label's enablement, loaded and running states separately, exits 113 for a missing service, and for `bootout` does the one documented launchd effect Factory relies on, SIGTERM to the job's registered process and a wait for it to exit. `cli/test/schedule-macos.test.mts` runs the production launchd adapter, the generated plist and a real supervisor process (`cli/test/fixtures/supervisor.mts`: the same supervisor code with a short first delay) against it, on Linux. It does not prove launchd's own loading, `KeepAlive` or `ExitTimeOut` behaviour, which is trusted the same way systemd's is.
- `cli/test/cutover.test.mts` rehearses the [cutover runbook](docs/scheduler-cutover.md) on a home that starts with a legacy timer and an outdated project copy. Factory's CLI runs against the default stub, so any call it made to a legacy unit would be rejected. Only the explicit `factory legacy retire` step runs with `STUB_LEGACY=1`, which accepts `disable --now` on a legacy timer and removes its `timers.target.wants` link. `cli/test/legacy.test.mts` covers `factory legacy status|retire` the same way, including a failed disable.
- `cli/test/scheduler.test.mts` covers the same logic against the in-memory `FakeSchedule` (`cli/src/platform/fake.mts`).
- `cli/test/recovery-schedule.test.mts` (#64) runs scheduled self-recovery end to end: every tick is its own process (`cli/test/fixtures/tick-recovery.mts`, `factory tick` with only the repair command swapped for a stand-in) against the `systemctl` stub, with a `docker` stub that accepts only exact-name `rm -f` and `container inspect`. It covers a tick killed mid-pass, `schedule off` while a repair runs, a crashed repair whose container docker cannot confirm gone, the two-attempt budget and reset. It does not run real Docker, `main.mts --recover` or an agent.
- Recovery refusal boundaries are covered by `cli/test/recovery-workspace.test.mts`, `cli/test/recovery-run.test.mts`, `cli/test/recovery-claim.test.mts` and `cli/test/jam-detect.test.mts`. They check byte-for-byte preservation on read-only refusal, numeric candidate order, no refusal cache, between-candidate cancellation/generation/review/run changes, project uncertainty, and charged spawn/record/post-commit failures. Disposable Git repos and state roots cover real launcher/afterPass integration; process races prove only one project recovery can be admitted. No tracker, authentication, installed project, Docker daemon or service manager is needed. Run focused tests with `node --test cli/test/recovery-workspace.test.mts cli/test/recovery-claim.test.mts cli/test/recovery-run.test.mts cli/test/jam-detect.test.mts`, then the full command above.
- The tick and its cancellation are Factory code, so they are tested with real processes: `cli/src/commands/tick.mts`, `cli/src/tick-lock.mts`, `cli/src/tick-cancel.mts`.
