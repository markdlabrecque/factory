<!-- Commit checks use fixture-owned runtimes, a local namespace-backed acceptance driver and external boundaries across four bounded CI shards plus a separate browser-lifecycle gate. Exact-package offline verification and real browser-image/service-manager smoke checks are distinct opt-in boundaries. -->
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

CI runs on pull requests targeting `main` or `develop`, with the same required jobs and deadlines for both integration targets. The copied refresh scenarios are partitioned by delivery, models, original input, Board, selection and ownership across `orchestrator/refresh*.test.mts`, sharing `refresh-fixture.mts`. All 45 existing registrations and their test bodies are retained; splitting the formerly serial file distributes process cost without reducing coverage or raising time limits. It runs four parallel jobs through `scripts/test-shard.sh`. Normal-entrypoint integration scenarios are partitioned by input, proof, sandbox and model routing across `orchestrator/verification-entrypoint*.test.mts`. They retain the same shared fixture and assertions; separate files distribute their process cost rather than leaving all scenarios serial in one shard. The runner expands exactly the three globs above, sorts paths with `LC_ALL=C`, and assigns zero-based file position modulo four to shards 1 through 4. New matching files enter the inventory automatically. Each shard retains `--test-concurrency=4`, the hard 180-second deadline and `--test-timeout=120000`. No test-name filters or exclusions apply.

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

## Owned acceptance baseline runner

`orchestrator/acceptance-runner.test.mts` exercises the approved owned-runner seam
with real private filesystem stores, shared interprocess admission locks, disposable
Git and native detached/controller processes. The external engine lifecycle is emulated
by `orchestrator/fixtures/acceptance-engine.mjs`; the fixture never executes project,
setup or frozen probe argv on the host and never supplies admission/cleanup authority.
IPC/socket barriers and an injected reservation clock cover competing reservations,
controller death, worker death, cancellation, late results, foreign owner/engine,
ambiguous creation, output overflow, image-volume refusal and retained sealed output.
The exact Git pack excludes dirty CMS-like site/database files; frozen copies and
fresh bounded state/mount policy are inspected independently. The receipt units
cover full assertion inventory and transition/failure/manual-evidence taxonomy.

```sh
node --test orchestrator/acceptance-{contract,custody,receipt,runner}.test.mts orchestrator/ticket-input.test.mts
```

One case replaces only the engine's start response with actual execution of the
unchanged copied `acceptance-sandbox.mjs` inside rootless user/mount/PID/network
namespaces (`fixtures/acceptance-namespace.mts`). It requires Linux, working rootless
Bubblewrap (`/usr/bin/bwrap`), local Git, `ldd`, `prlimit` and GNU `timeout`, plus the
running Node executable. The helper freezes only those executable/library bytes,
mounts that private closure and `/input` read-only, creates fresh `/work`, `/tmp`,
`/run`, `/proc`, `/dev`, and mounts only fixture-private disposable synthetic state
writable. It clears the environment, denies host network/mounts/sockets, and uses a
10-second outer kill deadline, CPU/file-size/fd guards and a 1 MiB captured-output
ceiling. Capability failure **fails**, never skips or falls back to host execution;
no test installs tools or changes host namespace policy.

The pinned setup seeds filesystem-backed synthetic rows/site/uploads, not SQL/CMS.
The frozen probe imports the baseline API, observes actual seed/SHA, tests read-only
inputs and hidden host source, then dirties state. Two independent runs must observe
the same seed and exact baseline despite dirty source; reuse of the first run's
persistent dirt must produce an actual driver failure and a sealed policy hold with
no results. TAP diagnostics retain real driver exit/stdout/stderr (including actual
assertions); the driver currently reports setup failure without forwarding setup
stderr. Reservation/start/read and retained receipt authentication are real.

This closes real-driver synthetic execution evidence, **not** real container/cgroup/
different-UID watchdog or actual CMS installation/database-seeding evidence. The
namespace fixture's resource guards are not proof of the engine's memory/PID/tmpfs
limits. A supported-image/CMS runtime smoke remains unperformed; absent local PHP
and MariaDB/MySQL cannot be replaced by synthetic JSON state, and unsupported reset
still holds. No production, network DB, credentials or paid provider is part of
these fixtures. All four commit-tier shards, docs checks and the independent browser
lifecycle gate remain unchanged.
See [runner contract](docs/acceptance-contract.md#owned-baseline-producer).

## Acceptance static admission (partial integration)

```sh
node --test orchestrator/acceptance-admission*.test.mts orchestrator/recovery-entrypoint.test.mts
```

The approved analysis/implementation admission seam is exercised through the actual
selected common analysis, dispatch, direct, explicit-refresh, `refreshProject` and
recovery-preparation entrypoints with disposable Git and fixture-owned rejecting
tracker/Pi boundaries. Missing preparation covers both trackers and configured families;
malformed references/contracts, unapproved/tampered originals and changed input stop
before analysis or implementation records. Cached dispatch selection, cached assessment
revocation, a pending dispatched child and direct post-Git/pre-adoption revocation are covered.
Actual analyst-I/O revocation discards results and retains static diagnostics without new queue
records. An authentic custody publication reaches the
analyst, reuses cached analysis without another call, and is revoked by removing current
preparation while preserving the saved manifest. Passive stored-readiness reads retain
the safe ticket-specific reason/action without recreating state or invoking models.
`fixtures/acceptance-preparation.mts` supplies synthetic independent approval **before**
launch, never production authority or baseline execution. The existing recovery fixture
also prepares its exact complete child/parent input before its analysis pass.

These are focused filesystem/process integrations, not helper-only schema tests, browser
E2E or installed release acceptance. `acceptance-baseline-entrypoints.test.mts` additionally
exercises actual dispatch with real separate reserve/start/read, durable private grants,
disposable Git and the existing owned engine transport. Explicit host preparation occurs
before managed entry; valid current evidence permits the actual claim and child launch
for both trackers/configured families, including cached selection. Actual dispatch denies
missing/stale/current-SHA/ticket/config/reset changes, revoked/expired grants, unknown,
already-green, wrong behavioral failure, actual API cancellation, unknown engine cleanup
and tampered retained output before claim/child. Final image-I/O revocation is rechecked.
Stored reads preserve records/reservations and invoke no preparation. Pending cleanup
publishes its ticket observation before managed-entry refusal, with no tracker collection.
`fixtures/acceptance-baseline-preparation.mts` is test-only and simulates sandbox output,
not CMS reset or production authority. Direct/adopted main now independently denies missing
or revoked baselines before claim/adoption, preserving pending run bytes and admission;
normal positive model-family/tier journeys explicitly prepare actual owned baselines.
`acceptance-baseline-recovery.test.mts` proves authorized dispatched-child adoption, host
revocation and late image-read revocation before recovery charge, independent child revocation/
saved-binding change before repair, and successful original-fullscope recovery after integration
HEAD advances. Existing recovery journeys retain independent verifier, work and charge assertions;
all positive baselines are prepared before intentionally uncertain managed payload ownership.
CLI status/Board/ticket projections cover every baseline hold category plus ready observations,
retained safe SHA/binding identities and zero model/container/claim effects on passive reads.
These are standard source/offline admission proofs, not override adoption or candidate replay. No
real provider, tracker, credentials, Docker, shared daemon or package install runs.
The four full shards, documentation and independent lifecycle gates remain unchanged.

## Standard implementation continuation

`orchestrator/implementation-outcome.test.mts` covers bounded execution/turn reports and fail-closed eligibility. `orchestrator/payload-custody.test.mts` verifies durable one-time reservation without treating it as cleanup. `orchestrator/verification-entrypoint-continuation.test.mts` exercises the flat normal runner with stubbed SDK, tracker and container boundaries and disposable real Git. It checks that a resumed commit keeps the original baseline and requires the independent verifier; second incompletion, a stalled or failed resume, false success, wrong checkout, an unexplained Git delta and superseded execution do not push. A stalled SDK resume or post-resume Git probe retains unsealed custody even when the container is gone. The fixture supplies the inspected Sandcastle resume contract, not a live Pi transport or a production rollout test.

## Source acceptance release pack

The [acceptance matrix and operator-held runbook](docs/supervisor-acceptance.md) and
[sanitized machine index](docs/supervisor-acceptance.json) pin the T12 baseline.
Current candidate counts/checks/review/merge are recorded separately in its PR/epic
ledger after execution; historical counts never satisfy current gates. No tests,
fixtures or shard configuration are added by this documentation-only acceptance step.
Use Node **24.20.0**, existing checked-in offline provider archives and GNU timeout;
no package install, real provider, auth discovery, service or Docker is required:

```sh
FACTORY_270_EVIDENCE=/tmp/factory-271-evidence node --test --test-concurrency=4 --test-timeout=120000 cli/test/supervisor-*.test.mts orchestrator/supervisor*.test.mts board/supervisor.test.mts
node --test --test-concurrency=4 --test-timeout=120000 cli/test/documentation*.test.mts
bash scripts/test-shard.sh 1 4
bash scripts/test-shard.sh 2 4
bash scripts/test-shard.sh 3 4
bash scripts/test-shard.sh 4 4
timeout --signal=KILL 30s node --test --test-reporter=tap --test-timeout=15000 orchestrator/browser-provisioning.test.mts
git diff --check
```

`FACTORY_270_EVIDENCE` is only a harness artifact-output variable, not a production
capability/authorization flag. Keep its raw synthetic prompts/stdout/base64 originals
local; export only the runbook's metadata allowlist, never headers, fake/real keys or
hidden reasoning. Preserve the 15-second provider child, 120-second test, concurrency
four and 180-second shard bounds, exact inventory and separate lifecycle gate. No
browser E2E duplicates renderer/policy checks. No sleeps, retries or waivers: inspect
shard timing/assignment and report infrastructure errors (including inode exhaustion)
without deleting evidence. Independent safety review and all hosted checks on the
actual final head, latest-base reconciliation and ordinary SHA-guarded merge remain
parent release gates. No source gate establishes T14 paid permission or pilot success.

## Login-backed advisory capability regression

`cli/test/supervisor-openai-request.test.mts` reuses the network-denied provider
fixture's `--login-serialization-spike` mode to load the actual digest-checked
archived Pi serializer with a synthetic non-`sk-` credential shape. This is a
local SDK integration test, not another transport stack or copied-install E2E.
It proves the login branch omits the API-key profile's remote cap/cache fields,
emits high reasoning without a configuration update, and is rejected by the
API-key payload validator before transmission. The same existing copied
adapter/journal matrix also covers the explicit subscription profile accepting
that exact pinned login shape after real grant/worker authorization. Neither test
resolves real auth or bypasses the production API-key precondition.
`supervisor-auth.test.mts` uses synthetic pipes, a fake deadline and mocked group
signals to cover the fixed handoff failure stages, output redaction and fail-closed
cleanup. `supervisor-worker.test.mts` proves each fixed auth failure code and the
unknown fallback reach public projection without paid acquisition or reservation;
`supervisor-command.test.mts` checks both JSON formats, exact legacy reason matching,
redaction of arbitrary output, exception text and unrecognized metadata, and
preservation of the safe auth hold if the disposable journal cannot be read.
Known usage and overrun/charge/human-stop policy are cheap receipt/state units.
The existing normal-producer known-custody case uses synthetic subscription auth
to prove receipt-backed runtime/exclusion release and auth-free same/fresh-host
reuse; its unknown-usage variant keeps API-key coverage. No new E2E matrix or
real login, remote acceptance, usage, invoice or operational success is implied. Run the focused suite:

```sh
node --test --test-concurrency=4 --test-timeout=120000 cli/test/supervisor-{auth,worker,command,openai-request}.test.mts
```

The four mandatory shards, separate browser lifecycle and docs checks above remain
unchanged. See the [blocked capability disposition](docs/research/supervisor-openai-boundary.md#pi-login-capability-disposition-ticket-286-2026-11-17).

## Public copied-install advisory journeys

```sh
FACTORY_270_EVIDENCE=/tmp/factory-270-evidence node --test --test-concurrency=4 --test-timeout=120000 cli/test/supervisor-acceptance.test.mts
```

Exactly two end-to-end wiring cases reuse `normalEntrypointFixture`'s actual saved
normal execution and sealed payload custody. They run the private copied
`cli/bin/factory.mts`, production host/platform readers, selected flat runtime,
worker, owned guard/child, and four digest-checked provider archives. The package
installer remains synthetic; it is **not** the evidence that the real pinned
provider SDK loaded. The production adapter's archive loader and actual serialized
HTTP request provide that evidence. A test-only preload denies native outbound
network and substitutes SSE below the provider boundary. It rejects original
repository production imports after instrumentation loads and explicitly probes
that rejection in each public CLI process. Test instrumentation itself is imported
from test files; it is not a public CLI capability or runtime inventory asset.

A proves known usage/owned cleanup settlement, useful non-executing retained advice
in fresh status/explain processes and the production Board projection (fed fresh
public status JSON), then exact unchanged diagnostic/basis reuse with the same
authoritative prior-decision set and no second request, reservation, exclusion or pin.
B uses native pipes at actual send, then runs public stop in another process.
Already authorized work honestly remains pending, while replacement authorization
is refused. After synthetic unknown terminal usage, another IPC barrier pauses the
controller **after real parent-directory fsync** of its durable human request;
the test kills that exact native child before CLI return. Restart retains the human
request, full charge, exclusion and runtime pins and refuses managed manual work.
The existing process/T04 units own controller loss while payload-live and both
stop/authorization orderings; these two cases do not duplicate their fault matrix.

Read-only `gh`/`gh-axi` and `systemctl` stubs record every public-phase call and
reject mutations; Docker, Pi, npm and 1Password commands reject invocation.
Journey A retains synthetic API-key environment auth. Journey B explicitly selects
`--auth pi-login` and a matching host profile; an exact-argv fake Pi executable
returns a synthetic bearer before reservation. Real Pi, auth stores and refresh
are never used. Private finite policy and an explicitly
user-approved synthetic expiring operator assertion use the production default
record source, not injected host capabilities or emptied prerequisites. Dirty,
staged, untracked and parked worktree content, index, refs and raw saved run are
compared without reset/checkout/clean. Optional JSON evidence captures actual
argv/output, request, journal, complete frozen originals, ownership/custody, pins,
manifest identities and work-preservation snapshots before disposable cleanup.
This proves local source/filesystem/process wiring, not real provider enforcement,
actual billing, useful model judgment, installed quiescence or a pilot. All four
mandatory shards, separate bounded browser lifecycle, docs checks and independent
review remain required; this focused command replaces none of them.

## Explicit diagnosis command boundary

`cli/test/supervisor-command.test.mts` covers strict named-ticket parsing, redacted
result/exit permutations and signal handoff through component command facades.
A classified login hold retains its fixed reason but omits accounting if the
journal or project record disappears or the journal is corrupt. The fixture
checks the read does not recreate or rewrite those records. It also exercises
genuine host refusal using a disposable registry/current saved run and failing
backend, and actual source-bin routing for invalid/no-run requests.
`documentation-cli.test.mts` checks help and the documented no-run refusal. These
are cheap units/local control boundaries, not installed transport or paid-provider
proof. The public copied-install journey belongs to its dedicated acceptance task;
this suite does not duplicate the host/SDK matrix. No real auth file/key retrieval,
service mutation or paid call occurs. New public acquisition remains held without a
valid private operator rollout record; component facades cannot establish public authority.
`cli/test/supervisor-rollout.test.mts` covers strict schema/project/runtime/time permutations,
full-timeout window refusal and one disposable filesystem boundary (canonical private
permissions/UID, links, special files, bounded fatal UTF-8, replacement and expiry).
The existing normal-producer host fixture now uses the default public record reader with a
**synthetic disposable operator assertion**, reaches the same network-denied SDK boundary,
proves renewal does not change basis/resend/reset charges, and invalidates late output when
the record changes. This is not an installed quiescence or model-quality claim and does not
duplicate the public copied-install journey. The new `supervisor-rollout.mts` module is in
the complete runtime inventory/flat copy; no dependency archive or client stack is added.

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

## Advisory host owned-worker boundary (partial)

```sh
node --test --test-concurrency=4 --test-timeout=120000 cli/test/supervisor-host.test.mts cli/test/supervisor-input.test.mts cli/test/supervisor-worker.test.mts cli/test/supervisor-process.test.mts cli/test/supervisor-runtime.test.mts cli/test/runtime-bundle.test.mts cli/test/projects.test.mts cli/test/tick.test.mts orchestrator/verification-entrypoint-sandbox.test.mts
```

Cheap units prove fresh existing scheduler/registry controls (including absent
opt-in, aliases, duplicate registration and failed backend query), early missing
policy refusal, and observational restart cutpoints through one-use authorization.
They do not manufacture terminal certificates. The reused actual flat normal
producer fixture now imports the copied host module, claims exact custody-backed
exclusion, verifies/pins the actual four-archive SDK closure, freezes complete
saved-run originals including source-produced `no-commit.json`, rebuilds the same
basis and refuses a later genuine fake-platform off observation without erasing
the hold. SDK sandbox/Docker, tracker responses and scheduler observations are
synthetic; source/flat imports, normal lifecycle, immutable custody, Git, admission,
runtime artifacts/pins and collector I/O are real. Fake installed packages alone
are not provider capability evidence.

The SAME producer fixture now invokes the copied host's existing worker, actual
owned process and pinned SDK using T04's network-denied synthetic SSE preload,
then checks genuine raw accounting/cleanup, retained non-executing advice and durable local HUMAN settlement. A missing-terminal-usage variant proves a durable actionable human request survives reopen while the reservation remains ambiguous, fully charged and excluded with its runtime pins retained.
The existing T04 process fixture adds deterministic last-send observation barriers:
stop-before-auth, changed source and actual controller disconnect all leave no
send and retain full charge/ownership. Existing journal units own both stop/auth
orderings; no duplicate provider matrix was added. Worker units cover asynchronous
observations while retaining synchronous component fixtures.

Terminal advice composition, exact receipt-based release/reconciliation and spent-budget cache reuse are exercised through the copied host. Handled unknown accounting/cleanup records an unsettled human outcome, never a successful settlement or release. Complete mandatory and hosted acceptance remain separate gates.
No paid/live probe or model semantics is claimed.
The unchanged 15-second direct-child, 120-second test, four 180-second shard and
concurrency-four limits still apply; complete mandatory/release gates are separate.

## Complete saved-run input boundary

```sh
node --test cli/test/supervisor-input.test.mts cli/test/supervisor-facts.test.mts cli/test/supervisor-worker.test.mts cli/test/runtime-bundle.test.mts
```

Cheap units prove authoritative decision selection and audited-human-resolution
bytes. The existing worker boundary additionally proves its actual retained own
diagnosis is not a prior-decision original. One disposable readiness-project
fixture exercises real local Git/filesystem reads, private original freezing and
independent basis/binding recomputation with controlled read-only tracker responses
(including child/parent second pages and changed-page refusal). It compares dirty
bytes, index hash and refs before/after success and refusal, and covers legacy/missing
run identities, oversized/missing originals, aliases and unsupported overrides.
Tracker transport, runtime package installation and saved-run inputs are synthetic;
these tests establish no paid provider, installed mount, quiescence or cleanup
authority. The fixture Git helper has per-call bounds; whole-test 120-second bounds
and the unchanged four 180-second shards remain required.

## Normal payload custody source prerequisite

```sh
node --test --test-concurrency=4 --test-timeout=120000 orchestrator/payload-custody.test.mts orchestrator/no-commit.test.mts orchestrator/verification-entrypoint-sandbox.test.mts cli/test/supervisor-admission.test.mts cli/test/runtime-bundle.test.mts
```

Cheap event-table units cover before creation, pending/ambiguous construction,
registration, exact close, still-open handoff, terminal seal, multiple payloads and
forbidden reuse of a sealed nonce. A private-filesystem case proves exclusive event
publication and fresh attempt pointers; these synthetic events are not platform
proof. The existing actual flat-main fixture additionally asserts durable pending
custody *inside the SDK constructor*, actual returned-container registration before
agent work, independent exact absence via controlled Docker-inspect responses, and
terminal saved-record admission without altering the target raw record. Ambiguous
create, missing returned identity and failed/unconfirmed close retain entries after
actual controller exit. Foreign legacy records, stale claims/executions/nonces,
recovery and delivery ownership refuse. The real producer, filesystem and admission
code execute; SDK, tracker/auth and Docker transport are synthetic, not live platform
or provider evidence. These tests prove no full advisory-host composition or rollout.
The complete inventory and shared flat-copy fixtures carry the new module; no
package, archive, dependency, concurrency or shard-deadline change is required.

## Shared admission exclusion

```sh
node --test cli/test/supervisor-admission.test.mts cli/test/run.test.mts cli/test/recovery-claim.test.mts cli/test/recovery-run.test.mts cli/test/runtime-bundle.test.mts orchestrator/verification-entrypoint-sandbox.test.mts
```

Cheap schema/migration and namespace units cover mandatory v2 collections, explicit
v1 migration and optional-exclusion refusal. One disposable filesystem boundary
preserves corrupt bytes, verifies the frozen actual develop v1 reader refuses v2,
checks accounting preservation, canonical symlink identity, exact fences, unknown
raw ownership, managed-entry exclusion, tokenless adoption and existing dead normal/
delivery pruning. Its one real two-child claim race uses ready/go/result/exit IPC
barriers, with no sleeps, retry loops or timing tolerances. Both contenders invoke
the real durable primitive against one store; exactly one wins. Actual winner exit
proves supervisor holds survive owner death. The successor/pending-reference setup
is synthetic stored input, not a produced settlement receipt. These admission-only
cases prove refusal, **not** finalization or no-send authority. The reused
`cli/test/supervisor-process.test.mts` normal integration proves the positive path:
actual claim, policy/reservation/grant hold binding, real copied SDK/process boundary
with network-denied synthetic SSE/auth, immutable known 35-token/220-derived-cost
usage, whole-group ESRCH, actual journal-produced local-human terminal settlement,
retained full charge, exact release, idempotent reopen and stale-release refusal
against an actually claimed successor. Fabricated commit events and corrupted receipt
bindings fail closed. Other lifecycle cases retain unknown usage/exclusion. Cheap raw
filesystem permutations cover live parked/terminal records, dangling claims, starting
handoffs and unresolved recovery payloads regardless of stage or controller death.
The SAME `verification-entrypoint-sandbox.test.mts` actual normal-custody/copied
runtime fixture additionally reaches owned host/worker/SDK, validates a synthetic
typed wait against its real frozen input and retains it, then proves unchanged reuse
with maxCalls=1 spent makes zero extra sends/charges/holds/pins. Original receipt
reconciliation is idempotent. A second bounded call mutates the original human input
after authorization and proves final publication retains a durable human request,
not stale usable advice; both full reservations remain charged. Cheap host units own
final stop/denial/supersession/deadline/malformed publication permutations. Existing
T01/T04 units and IPC fixtures own both stop/authorization orderings and controller
loss, rather than another transport matrix. Synthetic JSON establishes typed
validation only, not model quality. Parent release gates still require all four
bounded shards, separate browser lifecycle and independent review.
No-send finalization and installed public host authority are not proved. Runtime
pinning is separately covered by `cli/test/supervisor-runtime.test.mts`: cheap
selection/source/dependency/override/dead-owner permutations and one reuse of the
existing T04 process fixture in protected-runtime mode. The latter imports the
actual copied-private module, positively loads the real pinned SDK closure offline,
transfers exact ready worker evidence, rejects premature/generic release/removal,
and releases only after real T05 durable settlement, known T03 usage and ESRCH.
A stale release leaves a separate successor pin intact. Ordinary runtime package
fixtures are synthetic; they are not the SDK capability evidence. HTTP/SSE, auth,
policies and rollout controls remain synthetic with outbound network denied, not
installed host or live-account proof. Run the focused boundary with:

```sh
node --test --test-concurrency=4 --test-timeout=120000 cli/test/supervisor-runtime.test.mts cli/test/runtime-ownership.test.mts cli/test/runtime-bundle.test.mts cli/test/workflow-routing.test.mts
```

One reused
standard-entrypoint fixture invokes the actual flat main, dispatch and shell bootstrap
against a real durable hold, proving zero tracker/provider/readiness/container work.
Actual recovery-claim refusal preserves synthetic pending accounting byte-for-byte
before replay/candidate consumption. Complete flat inventory/import tests exercise
the shipped helper without source fallback;
fake private package installation is not new dependency or installed-host evidence.
CLI preflight entries do not create run generations/repair charges. No live dispatch,
provider/auth probe, installation, tracker, service or rollout occurs. The four
mandatory shards, unchanged limits and separate browser lifecycle gate still apply.

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

## Advisory policy, grants and one-use authorization

```sh
node --test cli/test/supervisor-host-policy.test.mts cli/test/supervisor-state.test.mts cli/test/supervisor-worker.test.mts cli/test/runtime-bundle.test.mts
```

Cheap units own fixed-profile all-in arithmetic, downward project USD ceiling
conversion, overflow/unknown policy, cumulative host/project/role/call ceilings,
review configuration preservation, grant/fence/worker corruption, legacy refusal,
stop-before-send and send-before-stop, and replay without fresh permission. One
private temporary filesystem/journal boundary validates permissions, symlink and
corrupt-policy refusal/preservation and atomic durable receipt reopen. A local
IPC-only child provides actual PID/start ownership; it makes no provider request
and exits through its explicit IPC barrier, not sleeps or raw-PID killing. Complete
bundle tests import the new inventoried modules unchanged without source fallback.
Policy/controls in transition units are injected trusted observations, not proof of
real admission, host authority, provider settlement or installed diagnosis. No real
home policy, credentials, services, packages or provider operations run. The usual
four full shards, separate lifecycle job and documentation checks remain mandatory.

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

## Pinned advisory provider request gate

```sh
node --test cli/test/supervisor-openai-request.test.mts
node cli/test/supervisor-provider-fixture.mts --offline-spike
```

One provider integration boundary exercises the actual request adapter loaded from
a complete disposable copied runtime, with real immutable grant/registered IPC child
and journal authorization. Unmodified published Pi-AI 1.5.2 / OpenAI 7.19.0 archives
now ship as runtime assets under `cli/src/supervisor-provider/`, not test-only data.
Their original package manifests/licenses and full upstream provenance lock are
retained; the loader extracts only the complete selected public subpath closure
into a private temporary tree. Root backend/tsx installation remains a fake fixture;
**provider code/dependency availability is real**, verified by archive identity and
actual selected-subpath load/request, not that fake installer. No npm, registry,
user configuration or real installation runs in tests.

Synthetic non-secret auth, a clean child environment, disabled global fetch and
native socket/HTTP/TLS paths, and the SDK-supported HTTP seam with no fallback keep
all responses offline. Deterministic IPC barriers exercise stop-first zero-send
and authorization-first in-flight stop; real 429/503 SDK error paths and context
overflow yield one transmission without retries/compaction; repeated requests refuse.
Pure precondition units own changed frozen input and inherited debug/TLS configuration
refusal before provider startup; copied-bundle validation owns corrupt selected
artifacts. These cases do not need repeated SDK/process bootstraps. The transport scenarios retain the real SDK/request/journal boundaries. Each independent
fresh request scenario has a 15-second subprocess limit instead of sharing one
aggregate subprocess budget; the complete matrix retains the standard 120-second
test bound, four-way file concurrency and 180-second shard deadline. Every scenario
keeps all original assertions; there is no production deadline change or retry.
A fixture-side filesystem barrier mutates real copied prompt/dependency bytes after
initial validation and input read; the final gate refuses with zero authorization
and sends, without sleeps or a production callback/flag. Duplicate terminal events
are explicitly marked ambiguous rather than exposing the first as known usage.
Cheap payload permutations reject tools, background/continuation/cache-warm/extra
fields, other service tiers and enlarged bounds. The actual raw terminal callback
runs before normalized/default-zero usage. This is not a fake Pi SDK or a fake
production `DiagnosisBoundary`. HTTP/SSE, request IDs/usage, current host controls
and exclusion identity are synthetic; journal/ownership/copy/load/gate behavior is
actual. No actual admission claim, watchdog/owned cleanup, durable usage settlement,
installed host wiring, remote enforcement, billing or useful advice is proven.
The [provider contract](docs/design/supervisor-provider-contract.md) records the
conservative bound and limits. Extend this same suite, not a duplicate boundary matrix.
It enters the unchanged four-shard inventory automatically; the independent
browser lifecycle gate remains mandatory.

### Bounded transport outcome regression

```sh
node --test --test-concurrency=4 --test-timeout=120000 cli/test/supervisor-openai-request.test.mts cli/test/supervisor-openai-usage.test.mts
node --test --test-concurrency=4 --test-timeout=120000 cli/test/documentation*.test.mts
git diff --check
```

The existing network-denied copied-runtime fixture uses synthetic credentials and
injected fetch with the digest-checked pinned SDK and real journal authorization.
It covers rejected fetch, HTTP 401/429/503, empty and interrupted SSE, absent or
invalid request IDs and publication failure, alongside the existing one-send and
stop cases. It reopens bounded transport evidence before stream completion in the
stream cases and checks unknown usage and retained reservation charges. The usage
filesystem boundary checks missing, malformed, foreign, conflicting and unsafe
records, idempotence and legacy receipt compatibility. Synthetic secret-like data
must not enter transport records. These are offline adapter and private-filesystem
boundaries, not proof of live provider behavior, public CLI end-to-end projection,
settlement, cleanup or replay safety. A failed publication is not a fetch rejection.
Focused commands do not replace the four mandatory shards, separate browser
lifecycle, documentation checks, independent review or hosted checks above.

## Owned advisory local process boundary

```sh
node --test cli/test/supervisor-process.test.mts cli/test/runtime-bundle.test.mts
```

Pure evidence permutations own exact PID/start/session/group and schema refusal.
One disposable process integration owns normal completion, original-endpoint
termination, absolute child-owned deadline, **actual controller process death**
and original-native-handle guard loss, with an IPC-ready real descendant inheriting
the group. Worker IPC disconnect and its same-grant secondary deadline bound work
if the anchor disappears unexpectedly. It executes unchanged
inventoried/copied factory, guard, runner, T02 request gate and T03 raw/scalar
publication. A test-only preload supplies the existing provider fixture's synthetic
terminal HTTP/SSE and non-secret auth; all real native socket/HTTP/TLS transport is
permanently denied. It also adds an inherited observation pipe and filesystem/IPC
barriers. Filesystem barrier JSON is closed in a private temporary file and atomically
renamed before the named watcher event; file creation alone is not a completed
message. No production bypass flag or second SDK scenario matrix is introduced.
The extra pipe is only an exit/observation barrier: test-only tracing records the
actual native self-group SIGKILL attempt/error without interfering with signalling.
That accepted signal is not cleanup proof. A separate kernel whole-group ESRCH
observation is required; a still-present group remains held. Closed descriptors do
not imply a particular instantaneous `/proc` state: an exiting task may still show
R before Z/reaping. No cleanup is inferred from leader/pipe loss or a prior sample. No sleeps, polling/retries or timing tolerances establish outcomes. The
three-second deadline is an actual bound, not an elapsed-time assertion.

Linux actual process behavior is exercised; Darwin uses a bounded capability probe
and explicitly holds unverifiable numeric session evidence, with no positive Darwin
run claimed. Runtime tests verify imports and exact copied bytes for all four new
assets. Legacy injected diagnosis/scheduler tests remain component evidence, not
provider/host enforcement. No admission, runtime lease release, final settlement,
refund/replay, installed host, live remote acceptance or paid activation is proven.
The unchanged four shards, 180-second deadline/concurrency/coverage and separate
bounded browser lifecycle gate remain mandatory.

## Raw advisory usage receipts

```sh
node --test cli/test/supervisor-openai-usage.test.mts cli/test/runtime-bundle.test.mts cli/test/documentation*.test.mts
```

Cheap units own missing/explicit-zero/inconsistent/unsafe and over-reservation
counter cases, reasoning inclusion, service/cache variants, wrong association,
stream truncation and completed/incomplete/failed status, normalized-Pi-counter
exclusion, conservative derived integer charge and strict scalar receipt identity.
No retention-specific provider field is invented: explicit raw write=0 requires
no retention breakdown; absent write count and any positive write are unknown.
One private temporary filesystem/journal boundary owns atomic raw+scalar retention,
reopen/idempotence, conflicting/corrupt records, permissions, hard/symlinks
(including the lock-directory path), path-restricted/revoked prepared-writer scope,
changed directory identity and unchanged reservations/charges. Cheap
filesystem fault injection proves ancestor-sync refusal before publication and
directory-sync failure after rename: visible bytes do not yield durable success
or known resources while synchronization fails. This is not a power-loss experiment.
An IPC-only registered local child supplies real PID/start identity; all provider metadata/control/exclusion data is synthetic.
There are no live network/provider calls or duplicated SDK transport permutations. Copied
bundle assertions import the inventoried helper unchanged. Later owned cleanup,
final journal settlement/exclusion release and installed-host activation are not
claimed by these tests. Full mandatory shards and separate lifecycle remain gates.

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

Retained advice permutations use cheap units in `cli/test/supervisor-command.test.mts`
and `board/supervisor.test.mts`: all six typed categories share the diagnose/status
projection, bounded rationale/alternatives omit private draft/gate/stream bodies,
unknown usage stays null, legacy component usage is not provider invoicing, and
orphan admission exclusions remain paged without pruning. The existing in-memory
HTTP boundary traps filesystem mutations, provider/tracker network and child
launches (allowing only canonical-root read-only Git identity probes), counting even
caught calls. No listener/browser or second public install journey is needed for
this display boundary; mandatory lifecycle/hosted gates remain separate.

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

## Exact scoped supervisor gate input application

```sh
node --test cli/test/supervisor-gate-apply.test.mts cli/test/supervisor-review.test.mts cli/test/supervisor-state.test.mts orchestrator/context.test.mts orchestrator/instructions.test.mts orchestrator/handoff.test.mts cli/test/runtime-bundle.test.mts
```

Unit refusal matrices cover absent/legacy/denied/stale approval, material/proposal/
project mismatch, paused/unknown/off authorization, fences, expiry and unsupported
scope. One disposable Git/filesystem boundary uses an independent injected reviewer,
the public applicator and actual configured verification-guidance consumer, real
execution analysis through a fixture-owned Pi command, the normal separate verifier
boundary and a real local Node evidence command. It proves new candidate-bound
analysis and host proof, exact-SHA delivery contracts, retained FAIL/evidence,
post-publication crash observation without another action, actual guideline/current
authorization refusal and dirty/index/other-branch preservation. The correction is
a private intent-first input artifact, never a checkout or saved-worktree rewrite.
No arbitrary test policy, host shell executor, live tracker, paid model, Docker,
installation, registry, credential or pilot is involved. Clocks/owners/processes
are injected; there are no sleeps. The new applicator ships in the complete runtime
inventory, including copied installs and complete overrides. These focused tests
do not replace all four commit shards and the separate browser lifecycle gate.

## Supervisor Board and outcome observations

```sh
node --test board/supervisor.test.mts board/execution-events.test.mts cli/test/supervisor-command.test.mts cli/test/supervisor-review.test.mts cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

Unit tests prove sanitized whole-envelope display, text-only incident rendering,
retained 128-entry pages/aggregate holds, proposal identity, unknown accounting and
outcome attribution. One in-memory production HTTP handler boundary uses disposable
registry/config/journal and an injected tracker adapter: no-store on success/error,
GET-only/path refusal, no journal creation or modification on read, pending uncertain
POST, receipt reconciliation without repeat POST, and retained fingerprints/charges.
The existing reviewer boundary additionally checks denial/usage/notification and
explicit intervention telemetry without Board involvement. No listener, browser E2E,
live tracker, paid model, service or credential is used by these added cases. Existing
standalone copied-install fixtures include the new view asset. All four commit shards
and the separate browser lifecycle gate remain mandatory.

## Outside-lock supervisor lifecycle

```sh
node --test cli/test/supervisor-schedule.test.mts cli/test/scheduler.test.mts cli/test/runtime-bundle.test.mts
```

Pure policy/hint tests cover coalescing, unknown/off/paused/observe/stopped admission
and explicit one-project pilot requirements. One extension of the existing stubbed
tick/process fixture proves post-unlock nonblocking handoff, two-project context
isolation, unchanged rotation, exact in-process abort, late review refusal and
restart reuse of a retained wait without new charge. The complete-runtime fixture
imports the actual flat lifecycle helper. Existing worker/state tests own the finite
shared-capacity/accounting matrices; recovery and proof gates are not duplicated.
The lifecycle fixture uses injected clocks and inert process/termination adapters,
not sleeps, live agents, trackers, services, installs or a real pilot. It establishes
no default provider-enforcement adapter, joint mixed-workload lease, cross-process
cancel channel or execution-owner scoped-context consumer. All four commit shards
and the separate browser lifecycle gate remain mandatory.

## Final supervisor offline acceptance audit

```sh
node --test cli/test/supervisor-acceptance.test.mts
node --test cli/test/supervisor-*.test.mts cli/test/scheduler.test.mts cli/test/jam-detect.test.mts cli/test/recovery-claim.test.mts cli/test/recovery-run.test.mts cli/test/runtime-bundle.test.mts orchestrator/supervisor*.test.mts orchestrator/gate-review.test.mts board/supervisor.test.mts
```

The first is one minimal copied-install/public CLI and selected-runtime boundary
integration, using the existing readiness disposable Git/stub-command helper,
fixture package installer/fake service backend and complete-override publisher.
It proves public observe inspection has no effects, both configured-family fixed
roles and omitted-disabled policy, finite-policy explicit act refusal, complete
selection/no fallback on a missing lifecycle helper, and honest cross-process stop
pending across a fresh CLI read with saved dirty/index/refs and charges retained.
A reservation is explicitly seeded through the actual journal API; it is not a
worker launched by the installed CLI. The selected unbound lifecycle helper is
invoked explicitly, not represented as an effecting installed scheduler hook.
Direct CLI/module child timeouts/output caps are finite; the reused local Git
helper has no per-command timeout and remains inside the unchanged shard deadline.
No sleeps or live external services.

The second command reuses existing component source worker/reviewer/outbox/scoped
application/proof/recovery and real tick process boundaries. Their provider,
accounting, admission, tracker and sandbox adapters are injected as documented in
those sections; they do not activate the copied CLI or prove live semantic review.
Unit failure matrices remain in their owning files, with no duplicated browser E2E.
**Integrated action acceptance remains BLOCKED**, not skipped or manufactured green:
no shipped provider-enforcement/accounting adapter, joint mixed-workload lease,
authenticated cross-process cancel channel or default scoped execution-owner/host
binding. See the [criterion audit and held runbook](docs/supervisor.md#final-offline-acceptance-audit).
No runtime assets/dependencies are introduced by this fixture. These focused commands
are not substitutes for all four mandatory `scripts/test-shard.sh` commands at the
top of this file and the separate 30-second browser lifecycle gate below.

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
node --test orchestrator/verification-entrypoint*.test.mts orchestrator/recovery-entrypoint.test.mts orchestrator/refresh*.test.mts orchestrator/delivery-followup.test.mts cli/test/project-config.test.mts cli/test/run.test.mts
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
synthetic bytes, not real browser media. Its public evidence boundary additionally
checks complete original criterion-ID reconciliation (including the full 256-item
inventory), omitted/duplicate/unknown/absent IDs and retained non-PASS diagnostics.
The selected normal-entrypoint proof fixture prepares genuine original custody and
owned baseline authority, then proves an otherwise-green verifier omitting an original
criterion cannot create proof, post or push. Positive normal/recovery model-family
journeys retain complete explicit synthetic criterion IDs. This is a semantic-inventory
vertical at approved verification/recovery seam4. A second normal-entrypoint tracer
first reproduced actual post/push/merge without candidate replay despite a complete
structured PASS. It now holds without a separate exact host grant. The positive tracer
executes the actual copied driver and SAME frozen probe at baseline and exact candidate
in independent rootless namespaces: named behavioral red→green, preservation pass,
fresh filesystem synthetic seed despite source dirt, separately authenticated owners,
confirmed cleanup and retained version2 proof chain. Its independent fixture host prepares
exact grants after observing the committed candidate; SDK reports cannot approve them.
Additional entrypoint cases deny changed candidates, mismatched bundle observations,
unknown results and engine infrastructure failure, with no push. Ordinary model-family
journeys reuse external-engine protocol responses; only the explicit tracer claims actual
driver execution. This is not complete recovery/CI migration, browser/manual adequacy,
CMS/SQL reset, cgroup/watchdog or installed-release acceptance. Runtime inventory already
ships every changed producer/consumer; the added host module is test-only. Full mandatory
commands/bounds are unchanged. `verification-entrypoint*.test.mts` runs the
selected fixture runtime's ordinary entrypoint against real temporary Git repositories and fixture-owned
SDK, tracker and Docker commands. It exercises requirements/eligibility changes,
branch/claim changes, dirty verifier output, missing baseline and legacy prompts.
Recovery entrypoint/runner tests exercise the same proof lifecycle with isolated
private Git metadata and teardown. The runner's fixture verifier executes the same
zero-count assertion on real disposable commits: a missing module on the original
base is not the defect, the saved start can reproduce it, and the repaired tip passes.
The runner gets the symptom from the repair report in a feature-shaped ticket and
also covers original-base reproduction and non-delivery on INCONCLUSIVE. A real
Git fixture confirms replacement refs left by either agent cannot publish proof
or deliver a substituted tree. Handoff cases refuse missing, non-exact, unrelated
or mismatched Git identities. The entrypoint checks the packaged prompt and original proof identity. For the
smallest changed-boundary run:

```sh
node --test orchestrator/recovery-runner.test.mts orchestrator/recovery-entrypoint.test.mts orchestrator/handoff.test.mts orchestrator/verification.test.mts
```

Adapter tests assert fresh host authorization after CI and before SHA-guarded merge.
These tests do not validate live verifier judgment, video codecs or atomicity between
an external ticket edit and a tracker merge. The full commit gates above still apply.

## Existing-delivery continuation tests

Run the changed boundary first:

```sh
node --test board/delivery.test.mts orchestrator/delivery*.test.mts cli/test/delivery-followup-schedule.test.mts
node --test orchestrator/refresh*.test.mts cli/test/init.test.mts cli/test/update.test.mts cli/test/recovery-command.test.mts cli/test/recovery-run.test.mts cli/test/jam-detect.test.mts
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

## Recovery triage helper tests

```sh
node --test orchestrator/recovery-triage.test.mts orchestrator/context.test.mts orchestrator/workflow.test.mts cli/test/runtime-bundle.test.mts
```

Triage policy tests inject Pi, tracker, Git and filesystem boundaries. They exercise
strict advice, stop-key changes, cached failures, stale-result discard, bounded evidence,
comment sanitization, idempotent escalation and release on label removal. The shipped
prompt and bundle distinguish missing supplemental history and worktree diagnostics
from missing cause evidence or a real human prerequisite. Offline fixtures contrast
a reproduced unit failure, unavailable diagnosis and required operator approval.
Stubbed replies exercise the advice contract, not live model routing. Runtime-bundle
fixtures verify the helper, contract and template ship together and import without a
project or credentials. No paid model, live tracker, installed runtime or service is used.

## Recovery triage host tests

```sh
node --test --test-concurrency=4 --test-timeout=120000 cli/test/jam-detect.test.mts cli/test/recovery-{command,followup,prepare,state}.test.mts cli/test/documentation.test.mts
```

Jam tests inject triage, inspection, preparation and launch around disposable host
records. They cover opt-in, result routing, one new call per pass, unchanged budgets
on human holds, the dispatch selection rule for needs-human, and rechecks after the
triage await. The recovery launch and claim tests in the commit-tier shards still
cover budget, custody and admission refusals. Spawn and group cleanup are injected
for triage protocol and ownership cases; a fake timer drives the deadline. The existing
preparation tests exercise the shared subprocess runner with fixture-owned Node children.
Status tests use private local records to check backward compatibility and show the
cause, delivery state and ticket-comment next action. No live tracker, runtime
installation, model, Docker or scheduler is used. Run the four commit-tier shards and the separate
browser lifecycle gate after these focused tests.

## Host launch readiness tests

```sh
node --test orchestrator/launch-readiness.test.mts orchestrator/refresh*.test.mts cli/test/run.test.mts cli/test/recovery-prepare.test.mts cli/test/recovery-run.test.mts board/refresh-worker.test.mts board/install.test.mts
```

These fixtures use temporary projects/state and local Git with stubbed tracker, image, agent and process boundaries. They check project holds before tracker analysis or new queue/admission/container effects, explicit shared ticket attribution, input/workspace isolation, preserved dirty/unrelated worktrees and stale registrations, fresh success without stopped-run retry, late path/branch/image-readiness races, direct report-write failure and zero pre-charge recovery attempts. Recovery fixtures change or fail structured input after image readiness and assert typed ticket-only reports without charge. Manual, dispatch and real scheduled routing share the host hold identity; a late scheduler-policy refusal or cancellation cannot spawn after the asynchronous gate. Exact-owned-container settlement/cleanup remains exercised during a host hold. Explicit Board and scheduled read-only refresh guard opaque overrides too; standalone Board install/update fixtures execute the shipped host probe/store dependencies. Routing, pause/off/unknown policy and process-group cancellation regressions remain in the complete suite. No installed app, real registered project, service manager, Docker daemon or authentication is used.

## Ticket readiness acceptance

```sh
node --test cli/test/ticket-readiness.test.mts orchestrator/ticket-readiness.test.mts
node --test --test-concurrency=4 orchestrator/refresh*.test.mts cli/test/run.test.mts cli/test/recovery-run.test.mts cli/test/recovery-schedule.test.mts cli/test/workflow-routing.test.mts board/readiness-view.test.mts
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
