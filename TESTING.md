<!-- Commit checks use fixture-owned runtimes and external boundaries across four bounded CI shards plus a separate browser-lifecycle gate. Exact-package offline verification and real browser-image/service-manager smoke checks are distinct opt-in boundaries. -->
# Testing

## Run the tests

Requires Node 22.18+; CI uses Node 24. From the repository root:

```sh
node --test orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts
```

The retained simulated Board prototype has a separate dependency-free model suite:

```sh
node --test board/board-prototype.test.mjs
```

It is not included in the three `.mts` globs above or the CI shard inventory. Run it when checking the prototype or its documented presentation contracts. Historical test counts in design and research reports describe those revisions, not the current suite.

CI runs on pull requests targeting `main` or `develop`, with the same required jobs and deadlines for both integration targets. It runs four parallel jobs through `scripts/test-shard.sh`. Normal-entrypoint integration scenarios are partitioned by input, proof, sandbox and model routing across `orchestrator/verification-entrypoint*.test.mts`. They retain the same shared fixture and assertions; separate files distribute their process cost rather than leaving all scenarios serial in one shard. The runner expands exactly the three globs above, sorts paths with `LC_ALL=C`, and assigns zero-based file position modulo four to shards 1 through 4. New matching files enter the inventory automatically. Each shard retains `--test-concurrency=4`, the hard 180-second deadline and `--test-timeout=120000`. No test-name filters or exclusions apply.

Reproduce CI from the repository root with Node 24 and GNU `timeout`:

```sh
bash scripts/test-shard.sh 1 4
bash scripts/test-shard.sh 2 4
bash scripts/test-shard.sh 3 4
bash scripts/test-shard.sh 4 4
```

These commands may run sequentially locally; CI gives each shard its own runner. Add `--list` to print a shard's file assignment without executing tests. `cli/test/ci-shards.test.mts` checks the actual runner output against the current filesystem inventory for deterministic, exact-once coverage and checks the workflow matrix and deadlines. Empty or invalid shards fail rather than silently pass.

The independent browser lifecycle job below remains mandatory. Its file also remains in the complete suite. Matrix fail-fast is disabled so a failing shard does not cancel the others. The existing `test` check succeeds only when all four shards and the browser lifecycle job succeed; failed, cancelled or skipped prerequisites cannot produce a green aggregate.

Automated tests use temporary homes, synthetic projects, fake clocks and stubbed external commands. Browser-probe fixtures expose the running Node executable in their isolated PATH rather than assuming a system installation path. They must not control real user services, contact trackers, run agents, build Docker images or fetch credentials.

`FACTORY_HOME` changes Factory's filesystem paths. It does **not** isolate `systemctl`, D-Bus or another service manager. Inject the fake backend or place test-owned command stubs first on the child process's PATH. Ensure unhandled calls cannot fall through to the host's service manager.

## Documentation fixture checks

Exercise documentation examples in disposable directories, not a registered project or a real home. Use `factoryToml` in `cli/test/config-fixture.mts` and `loadTomlConfig` for complete TOML fences. Combine labeled fragments with compatible base configurations without duplicate tables. Assert both profiles, both families, defaults and explicit sources, and reject legacy keys and invalid tier declarations. Create real contained Markdown fixtures for instruction ordering, deduplication, missing files and escaping or secret aliases.

Use `bindExecution` from `cli/test/execution-fixture.mts` with a temporary `paths` home and `overlays: false` to publish an inventory-complete fixture runtime with fake private dependencies. Use `projectFixture` and `refreshManifest` from `cli/test/workflow-fixture.mts` for an explicit complete override. Exercise context pinning, missing or unknown inventory, changed code, dependencies and directory, and renewed recovery review. Do not execute arbitrary project modules to explain configuration. `cli/test/config-explain.test.mts` shows how to trap process, network, filesystem mutation and secret reads while checking redaction, source attribution and opaque or unknown policy. Check documentation links and examples as well.

The readiness command block and labeled JSON subsets in `docs/factory-cli.md` are executed by `cli/test/readiness.test.mts`, using a temporary registered project and complete fake runtime. It checks quoted names, absolute/subdirectory selectors, implicit current checkout, passive/active exits, blocked display exits and the fact that doctor never publishes. Its child environment exposes only local Git; absent service commands cannot reach the host. Permission/error injection and passive mutation/process/network traps remain separate tests. `cli/test/documentation.test.mts` also validates the dedicated `docs/ticket-readiness.md` links and heading anchors.

```sh
node --test cli/test/documentation.test.mts cli/test/documentation-cli.test.mts cli/test/readiness*.test.mts cli/test/status.test.mts cli/test/ticket.test.mts board/readiness*.test.mts orchestrator/readiness.test.mts
```

Keep tracker, provider, authentication, Docker and service-manager boundaries fixture-owned and fail on unexpected calls. Do not invoke real npm, install packages, use credentials, contact a registry or service, or start a real agent. Local Git repositories and local Node children are permitted fixture boundaries. `cli/test/shared-runtime.test.mts` covers normal execution, recovery, two data-only projects, override refusal and A/B publication with those stubs.

## Supervisor authority contracts

```sh
node --test orchestrator/supervisor-contract.test.mts orchestrator/models.test.mts cli/test/runtime-bundle.test.mts
```

These unit tests prove strict bounded records, exact input/proposal identity, material
freshness, independent-review provenance, explicit denial-state refusal, no reviewer
shopping, protected-policy escalation and actionable pending notification shapes.
One minimal process-boundary case passes the existing Pi argument builder's fixed
Large-role argv and frozen stdin to local Node recorder children. It runs no Pi,
SDK, paid model, tracker, Docker or credential operation. Separate processes and
`--no-session` argv are not proof of live model behavior or an available notification
API. The [supervisor contract](docs/supervisor.md) records the separately explicit
source-only reviewer/outbox implementation and remaining paid-runtime/application
prerequisites; contract fixtures alone do not activate downstream action. The complete runtime fixtures include
the new import-safe contract module without enabling any supervisor execution.

## Supervisor durable state

```sh
node --test cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

Pure transition tests use injected PID/start observations and timestamps for stable
incident/event identity, retained denial and supersession, finite diagnosis/review
reservations, shared capacity, fencing and observation-only intent reconciliation.
One disposable filesystem boundary covers restart, revision CAS, corrupt/foreign
records, unknown ownership, and actual writer interruption immediately before and
after rename followed by stale-lock reclamation and exact-event replay. No sleeps,
paid workers, tracker calls, recovery resets, notification adapters or actions run.
The state asset joins the complete inventory; existing run/proof/recovery suites
remain mandatory in all four commit shards and the separate lifecycle gate.

## Bounded supervisor diagnosis

```sh
node --test orchestrator/supervisor.test.mts orchestrator/supervisor-policy.test.mts cli/test/supervisor-worker.test.mts cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

Pure tests prove strict typed proposals, problem/evidence/expectation separation,
original frozen context with bounded supplemental memory, basis freshness and
observation-time-only reuse, old-journal preservation, exact completion fences,
finite accounting and failure refusal. One disposable worker boundary injects Pi
process/termination/accounting adapters and clocks/deadlines, without sleeps. It
proves reserve-before-spawn, both configured-family Mid roles, no tools or action/
review/tracker effects, shared capacity, cancellation/timeout/stale/malformed/failed
output, unknown cleanup/usage holds, retained output, exhaustion and restart reuse.
The complete-runtime fixture imports the actual flat worker/prompt inventory.
No live Pi, provider enforcement, notification adapter, tracker, Docker, service,
credential, install or paid probe is exercised. An absent demonstrated provider
ceiling/accounting adapter holds paid work; stub evidence does not supply it.
All four commit shards and the separate lifecycle gate remain mandatory.

## Independent gate review and managed escalation

```sh
node --test orchestrator/gate-review.test.mts cli/test/supervisor-review.test.mts cli/test/supervisor-command.test.mts cli/test/supervisor-state.test.mts cli/test/supervisor-worker.test.mts cli/test/runtime-bundle.test.mts
```

Unit matrices prove complete original context, strict exact proposal/input/model/
policy/reviewer binding and failure refusal. One minimal disposable process boundary
uses fresh local Node recorder children with Pi's supplied fixed-Large argv, empty
cwd/home and no inherited tools/transcript. Injected notification adapters prove
stop-before-POST, exact ticket/configured project issue routing, successful receipt
only, uncertain delivery retention, marker reconciliation without repeat POST,
restart/dedup, no observe/unauthorized write and no gate/work/budget mutation.
Offline command-construction fixtures exercise the actual `gh-axi`/`glab` API shape;
the local resolution CLI boundary checks explicit exact IDs/confirmation and OS
audit actor. Regression cases reject audit-only cached approval and changed retained
originals, and exercise A→B→C exact audited resolution with fresh diagnosis/review,
retained denials and cumulative charges. Clocks/owners are injected; no sleeps,
live models/trackers/credentials/services/installs or paid probes are used. Provider
ceiling enforcement and live pilot remain unproved and disabled. All four commit
shards and the separate lifecycle gate remain mandatory.

## Supervisor operator inspection and controls

```sh
node --test cli/test/supervisor-command.test.mts cli/test/supervisor-worker.test.mts cli/test/supervisor-review.test.mts cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

Unit parser/finite-policy matrices and disposable journal fixtures prove versioned
read-only default-observe JSON, no journal creation on inspection, bounded redacted
display, explicit pilot confirmation, unsupported runtime activation refusal, exact
reservation-only injected cancellation, pending cancellation without a shipped
cross-process handle, and retained human holds/charges/work through mode/stop.
The existing minimal real CLI resolution boundary also covers status routing and
invalid flag/act refusal without writes; its exact resolution assertions remain.
Worker boundary fixtures prove a durable stop prevents spawn and makes in-flight
output nonauthoritative while only the original confirmed termination/accounting
boundary can settle a charge. No live model/tracker/service, sleep, runtime probe,
configuration outside disposable fixtures or paid adapter activation is tested.
All four commit shards and the separate lifecycle gate remain mandatory.

## Runtime bundle preparation

```sh
node --test cli/test/runtime-bundle.test.mts cli/test/runtime-ownership.test.mts cli/test/lifecycle.test.mts
```

These tests copy the assembly inventory into temporary fixtures and inject a package installer. They check source and lock identity, applicable optional dependencies, the exact npm command boundary, failed preparation, competing publication, path collisions and symlink refusal. Copied and linked install fixtures cover descriptor publication, old-bundle retention, process leases and uninstall refusal. Subprocess fixtures exit during temporary preparation and after publication to prove ownership recovery. Late service failure must leave the old descriptor unchanged. Concurrent asynchronous installs and uninstall are fenced across service awaits. Child processes interrupt ledger and lease writes before each rename to verify metadata recovery without weakening unknown-entry deletion checks. These regular tests do not run npm or contact a registry.

The pinned SDK patch has cheap guard and transactional-publication checks:

```sh
node --test cli/test/sandcastle-patch.test.mts cli/test/runtime-bundle.test.mts
```

These use owned synthetic package bytes to check version/integrity, complete inventory, exact preimages/postimages, repeat application, mixed-state refusal, changed patch-input source identity, dependency-only identity/drift and failed-publication preservation. They do not prove the upstream SDK's directory behavior. The [Sandcastle patch guide](docs/sandcastle-patch.md) owns the version/file coverage, coordinated SDK/lock/specification update procedure, drift guards, publication/rollback boundaries and eventual removal.

An opt-in offline smoke test exercises the real locked tsx, esbuild platform binary and Sandcastle `0.14.0` package with scripts disabled. It calls the production installer, applies the patch before dependency hashing and validates the resulting bundle. The disposable probe in `scripts/smoke-sandcastle-patch.mts` checks upstream worktree creation/reuse/recognition/pruning/removal, environment loading, default and explicit logging, saved-patch cleanup/recovery guidance, and default/explicit Docker/Podman build argv. Container executables are argv recorders, not daemon calls. It neither builds an image nor runs an agent. Supply a cache containing the public tarballs from the root lock and an npm CLI path. It copies only those tarballs into an isolated cache, clears inherited npm configuration and runs npm with `--offline`. It never fills missing cache entries from the network or changes the supplied cache. Run on a supported Node 22.18+ binary and Node 24 when checking dependency compatibility:

```sh
node scripts/test-runtime-packages.mts /path/to/npm-cache /path/to/npm/bin/npm-cli.js
```

The implementation was smoke-tested with Node 22.23.2 and 24.20.0. The actual-package patch smoke passed on Node 22.23.2 during #208 and through the activated production installer on Node 24.20.0 during #210. That evidence is reused for this documentation/source-asset change; no package install is rerun solely to edit docs. This is not an execution test of the exact 22.18.0 patch release. A future SDK/lock/specification update requires fresh actual-package evidence; missing offline cache content blocks that gate rather than authorizing network access.

## Supported-layout acceptance

Supported new projects use `.factory` for config, environment assets, implementation worktrees, logs, evidence, diagnostic sessions and SDK patches. Old-only and mixed layouts are unsupported, not upgrade inputs. No test may convert deployed projects, rewrite old authority or operate on ignored operator artifacts.

Run the cheap layout boundary checks and the existing entrypoint/package fixtures:

```sh
node --test orchestrator/project-layout.test.mts cli/test/init.test.mts cli/test/sandcastle-patch.test.mts
timeout --signal=KILL 180s node --test --test-concurrency=4 --test-reporter=tap --test-timeout=120000 cli/test/layout-acceptance.test.mts cli/test/recovery-run.test.mts cli/test/runtime-bundle.test.mts cli/test/shared-runtime.test.mts cli/test/workflow-routing.test.mts
```

`cli/test/layout-acceptance.test.mts` covers old-only, mixed, symlink, type-conflict and unreadable layouts across init, CLI launch, scheduled/read-only refresh, Board refresh, registry add and cleanup. Each invalidates a previously ready observation. It asserts unchanged project bytes/modes, Git refs/index/status and saved shared authority, no external command calls and no admission. Board may write only its assessment/request observation. Recovery fixtures reject old-layout evidence and ownership receipts even for a supported project, without spending an attempt, touching dirty work or probing an image. Already-owned exact-container settlement remains separate from authorization to launch new work.

Copied-install normal/verifier/recovery fixtures assert `.factory` asset/worktree paths and exact evidence/helper mounts. Routing fixtures pin runtime and dependency identity through CLI, tick, unopted refresh, Board, preparation and recovery, including complete overrides. The SDK, tracker, agent, container and service-manager boundaries remain synthetic. Real temporary filesystem/Git operations prove preservation and selection, not live deployment.

The accepted baseline in [PR #214](https://github.com/markdlabrecque/factory/pull/214), merged 2026-11-16, passed 941 regular tests across all four bounded shards and the separate 12-test browser-lifecycle gate. Eight added cases cover unsupported-layout preservation, old authority and dependency identity. The focused five-file command above passed 66 tests. The separate browser execution repeats a file already in the shard inventory; it is not 12 additional unique tests. Reproduce all four shards and the separate browser command for each candidate change. Source readiness does not claim a live install, conversion, built image or rollout.

## Data-only projects and workflow diagnostics

```sh
node --test cli/test/init.test.mts cli/test/update.test.mts cli/test/project-config.test.mts cli/test/workflow-report.test.mts cli/test/telemetry.test.mts
```

Init and update fixtures verify data-only assets and preserve project bytes and modes. Workflow diagnostics use explicit synthetic historical copies for comparison, alongside a data-only regression. They do not restore runtime files to new projects or authorize repairs. Socket tests use fixture-owned Unix sockets.

## Shared workflow execution

```sh
node --test orchestrator/context.test.mts orchestrator/models.test.mts orchestrator/v2-contract.test.mts cli/test/runtime-bundle.test.mts cli/test/runtime-ownership.test.mts
node --test orchestrator/verification-entrypoint*.test.mts orchestrator/recovery-entrypoint.test.mts orchestrator/refresh.test.mts orchestrator/delivery-followup.test.mts cli/test/project-config.test.mts cli/test/run.test.mts
```

`cli/test/shared-runtime.test.mts` exercises a copied install and data-only init
through the normal Pi Terra implementation and independent verifier happy path,
and a saved Pi Terra recovery with Large repair and independent verification. The
recovery case exercises preparation and readiness before charging, preserves prior
work and evidence, and settles the delivered attempt. These use an explicit ticket
tier. The normal cases poison project workflow files; the copied recovery checks
their absence. They trap npm calls
and check that execution creates no project dependencies. It uses temporary bare
Git and fake SDK, tracker, container and authentication boundaries; it does not
run a real agent or prove semantic verification. A complete project override also
runs the implementation and verifier with custom code and a marked template. Removing
its mandatory verification helper makes the CLI refuse before any fixture tracker,
authentication, Docker or agent call, while saved state and evidence remain unchanged.
This exercises one override, not a model-policy guarantee for arbitrary custom code.

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
`.factory-workflow`, separate from mutable `.factory` configuration, logs,
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
synthetic bytes, not real browser media. `verification-entrypoint*.test.mts` runs the
selected fixture runtime's ordinary entrypoint against real temporary Git repositories and fixture-owned
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
command evidence and frozen host records. The selected-runtime dispatch fixture runs local Git
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
The recovery entrypoint's pass scenario uses the selected complete runtime's preparation helper with a
fixture-owned `pi`, tracker and bare origin. It reproduces current assessment plus
stale execution analysis, preserves saved work/evidence, then follows independent
verification and delivery. Scheduled recovery fixtures inject synthetic preparation
rather than running a real analyst. No test contacts live trackers, agents, Docker,
credentials or a service manager.

## Host launch readiness tests

```sh
node --test orchestrator/launch-readiness.test.mts orchestrator/refresh.test.mts cli/test/run.test.mts cli/test/recovery-prepare.test.mts cli/test/recovery-run.test.mts board/refresh-worker.test.mts board/install.test.mts
```

These fixtures use temporary projects/state and local Git with stubbed tracker, image, agent and process boundaries. They check project holds before tracker analysis or new queue/admission/container effects, explicit shared ticket attribution, input/workspace isolation, preserved dirty/unrelated worktrees and stale registrations, fresh success without stopped-run retry, late path/branch/image-readiness races, direct report-write failure and zero pre-charge recovery attempts. Recovery fixtures change or fail structured input after image readiness and assert typed ticket-only reports without charge. Manual, dispatch and real scheduled routing share the host hold identity; a late scheduler-policy refusal or cancellation cannot spawn after the asynchronous gate. Exact-owned-container settlement/cleanup remains exercised during a host hold. Explicit Board and scheduled read-only refresh guard opaque overrides too; standalone Board install/update fixtures execute the shipped host probe/store dependencies. Routing, pause/off/unknown policy and process-group cancellation regressions remain in the complete suite. No installed app, real registered project, service manager, Docker daemon or authentication is used.

## Ticket readiness acceptance

```sh
node --test cli/test/ticket-readiness.test.mts orchestrator/ticket-readiness.test.mts
node --test --test-concurrency=4 orchestrator/refresh.test.mts cli/test/run.test.mts cli/test/recovery-run.test.mts cli/test/recovery-schedule.test.mts cli/test/workflow-routing.test.mts board/readiness-view.test.mts
node --test --test-concurrency=4 orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts
timeout --signal=KILL 30s node --test --test-reporter=tap --test-timeout=15000 orchestrator/browser-provisioning.test.mts
```

The first command is the cross-path acceptance fixture, not a replacement for sibling-owned safety regressions in the second command or the complete inventory in the third. The last command is the separately bounded browser lifecycle check and uses fake browser modules. All commands are offline on Node 24; no package installation is needed.

`cli/test/ticket-readiness-fixture.mts` publishes the complete shared runtime with `bindExecution`, a temporary registered Git checkout and rejecting external-command stubs. The CLI acceptance file calls production manual run, dispatch and scheduled tick against unusable artifact directories. Each pass must publish a fresh generation before tracker analysis, admission or a manufactured queued/stopped record. File-at-directory obstructions produce actual `ENOTDIR` failures, even under root, without relying on chmod semantics. Evidence, worktree and shared-state cases remain distinguishable from a healthy filesystem whose parent comment read fails. No obstruction is repaired by Factory. A fixture removes only its own obstruction to test the next pass.

The same tests run the selected standard `main.mts` for failed second-page reads, a response exceeding the context byte bound and a ticket branch collision. No partial frozen evidence, agent start or admission is allowed. Required instruction failure and report publication failure cannot reuse a stored healthy report. A real raw-config edit and publication of a different runtime bundle make the old report stale for identity-aware doctor reads. CLI status JSON/text and the production in-memory Board GET handler must agree on the stored report's generation, observation time, scope, operation, next actor/action and automatic policy without renewing it. Status and Board intentionally remain stored-observation readers, not current-config authorization. A complete custom override receives the host gate; its internal context/sandbox behavior is explicitly unobserved.

`orchestrator/ticket-readiness.test.mts` reuses the landed normal/recovery entrypoint fixtures through copied install and data-only init. A synthetic full child specification plus immediate-parent decisions and ordered plan must occur byte-for-byte in the captured implementation and independent-verifier prompts. Saved context/provenance, rendered SHA-256, run metadata and delivery proof must agree. Literal template-like task text stays data. The recovery path proves incomplete input holds before charge, then saves frozen repair/verifier input and settles exact delivery. Container-only workspace/evidence failures start no agent; recovery retains exactly one charged attempt. Cleanup failure retains exact ownership instead of claiming the container disappeared. Parent-plan edits revoke authority before verification without rewriting frozen input.

The mandatory existing integration regressions cover successful next-pass selection without stopped-run retry, late branch/worktree/source races, pause/off/cancellation and claim fences, proof freshness, exact-SHA delivery, and settlement/exact-container cleanup while new launches are held. They remain in the complete suite with unchanged deadlines. Image capability probes, SDK prompt substitution, tracker replies and container teardown are fixture boundaries, not evidence of real Docker, tracker pagination services, semantic agent verification or arbitrary custom workflow internals. Fixtures contain synthetic planning text only, never local project logs, transcripts or credentials. No installed app, real registered project, service, authentication, npm network, 1Password or production access is permitted.

## Offline image readiness tests

`orchestrator/capabilities.test.mts` injects Docker commands to exercise immutable identity, non-root/offline container arguments, exact cleanup, cancellation, owner-process locks, malformed cache and non-sticky failures. No daemon or auth is used. `browser-provisioning.test.mts` runs the actual Node watchdog against fixture-owned fake global modules and checks descendant cleanup. Normal/recovery entrypoint tests use synthetic owned Docker responses and verify setup failures start no agents; admitted setup failures retain their budget charge. CLI recovery tests inject readiness to prove known-bad images spend zero attempts and pause/off/cancellation still prevent admission. `image-config.test.mts` proves configuration discovery never executes project code.

Run these focused tests before the full suite:

```sh
node --test orchestrator/capabilities.test.mts orchestrator/browser-provisioning.test.mts orchestrator/verification-entrypoint*.test.mts orchestrator/recovery-entrypoint.test.mts cli/test/image-config.test.mts cli/test/recovery-run.test.mts cli/test/recovery-schedule.test.mts cli/test/init.test.mts cli/test/update.test.mts
```

The CI browser lifecycle isolation command is separate from the full suite and uses fake browser modules, not a Docker image:

```sh
timeout --signal=KILL 30s node --test --test-reporter=tap --test-timeout=15000 orchestrator/browser-provisioning.test.mts
```

## Optional browser image smoke test

Run `./scripts/test-browser-image.sh` from this checkout with Docker/build access, network access for public build dependencies, and a non-root caller UID/GID. It builds a uniquely tagged disposable image from `.factory/Dockerfile`, overrides the entrypoint and checks the non-root browser with synthetic content, screenshot and video from an empty directory. The runtime check downloads nothing. The image and container are removed on exit; configured images and services are untouched. The regular Node suite never runs this test.

## Optional deployment smoke tests

A real systemd user-session trial can provide additional deployment confidence, but is not an automated verification or merge gate. Obtain operator approval before changing host services. Use an isolated synthetic project, exact unit names and a cleanup procedure that preserves unrelated services and running work.

Never expose the host's systemd or D-Bus control socket to an agent container merely to satisfy verification. No production access or credential retrieval is authorized by a test or smoke-test instruction.

<!-- Recovery scan tests use disposable Git/state roots and stubbed process/container boundaries only. -->
## In this repository

The sentence above about Factory's disable/removal logic not killing an active pass is the general policy. Under the approved #30 and #33 contract, `schedule off`, uninstall and reinstall cancel the tick's own dispatcher process group. The tests here prove two things about that: the cancellation is confined to that group, and independently detached ticket runs survive it.

- `cli/test/stubs/systemctl` is the stateful, failure-injecting `systemctl` stub. `cli/test/schedule-helpers.mts` puts it first on a test's PATH, exposes its call log and states, and injects failures (`fail('--user stop factory-tick.service')`). Its `calls.jsonl` also records any rejected call, and tests assert that list is empty.
- `cli/test/schedule-linux.test.mts` runs the real CLI and the production adapter (`cli/src/platform/scheduler-systemd.mts`) against that stub, and cancels synthetic process trees: a dispatcher holding a nested shell, a nested analysis process with its own child, and one detached ticket run in its own group. Where it sends the tick SIGTERM itself, it stands in for what `systemctl stop` is documented to do under `KillMode=process`.
- `cli/test/stubs/launchctl` is the same kind of stub for macOS: it models the label's enablement, loaded and running states separately, exits 113 for a missing service, and for `bootout` does the one documented launchd effect Factory relies on, SIGTERM to the job's registered process and a wait for it to exit. `cli/test/schedule-macos.test.mts` runs the production launchd adapter, the generated plist and a real supervisor process (`cli/test/fixtures/supervisor.mts`: the same supervisor code with a short first delay) against it, on Linux. It does not prove launchd's own loading, `KeepAlive` or `ExitTimeOut` behaviour, which is trusted the same way systemd's is.
- `cli/test/cutover.test.mts` exercises the service-manager boundary on a temporary home with a fixture runtime and synthetic project. It does not establish live deployment behavior. Factory's CLI runs against the default stub, so any call it made to a legacy unit would be rejected.
- `cli/test/scheduler.test.mts` covers the same logic against the in-memory `FakeSchedule` (`cli/src/platform/fake.mts`).
- `cli/test/recovery-schedule.test.mts` (#64) runs scheduled self-recovery end to end: every tick is its own process (`cli/test/fixtures/tick-recovery.mts`, `factory tick` with only the repair command swapped for a stand-in) against the `systemctl` stub, with a `docker` stub that accepts only exact-name `rm -f` and `container inspect`. It covers a tick killed mid-pass, `schedule off` while a repair runs, a crashed repair whose container docker cannot confirm gone, the two-attempt budget and reset. It does not run real Docker, `main.mts --recover` or an agent.
- Recovery refusal boundaries are covered by `cli/test/recovery-workspace.test.mts`, `cli/test/recovery-run.test.mts`, `cli/test/recovery-claim.test.mts` and `cli/test/jam-detect.test.mts`. They check byte-for-byte preservation on read-only refusal, numeric candidate order, no refusal cache, between-candidate cancellation/generation/review/run changes, project uncertainty, and charged spawn/record/post-commit failures. Disposable Git repos and state roots cover real launcher/afterPass integration; process races prove only one project recovery can be admitted. No tracker, authentication, installed project, Docker daemon or service manager is needed. Run focused tests with `node --test cli/test/recovery-workspace.test.mts cli/test/recovery-claim.test.mts cli/test/recovery-run.test.mts cli/test/jam-detect.test.mts`, then the full command above.
- The tick and its cancellation are Factory code, so they are tested with real processes: `cli/src/commands/tick.mts`, `cli/src/tick-lock.mts`, `cli/src/tick-cancel.mts`.
