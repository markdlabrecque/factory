# Shared workflow execution context

The standard workflow separates executable runtime bytes from project data.
`cli/src/runtime-assets.mts` is the single assembly inventory. A complete flat
bundle contains the workflow, Board helpers, TOML parser, Factory templates and
private locked dependencies. A project does not supply individual executable or
template overrides to this workflow.

## Host preparation and current originals

The source-only `prepareSupervisorHost` API in `cli/src/supervisor-host.mts` creates
a validated read-only runtime context and rebuilds current originals before exact
cache comparison. A new paid call then acquires custody-backed exclusion and
runtime pins before reservation; cached reuse acquires neither. Its asynchronous
`current()` rereads the existing scheduler backend and
registry opt-in, validates private host policy and exact hold ownership, and
rebuilds the complete saved-run originals outside locks. Each private collection
gets its own host-only destination; generated freezes and observations do not
become authoritative prior decisions or recursively change the basis. The actual
normal producer's `no-commit.json` is a supported complete failure original.

Preparation does not start a child, reserve paid work or grant a request. A failure
after acquisition retains exclusion/pins, including when controls become off.
The prepared object's explicit `invoke` delegates to the existing diagnosis worker
using the pinned owned boundary. Pins transfer to the actual ready child before
grant registration/handoff. Final-send IPC rebuilds current controls, policy,
complete basis, exact hold and runtime, then the child uses the same journal-lock
authorization as stop. A second asynchronous rebuild precedes local terminal closure.
Known raw usage and fresh owned whole-group cleanup permit branded atomic terminal
publication: typed non-executing advice bound to actual output/frozen input/grant,
or a durable actionable HumanRequest. Current journal stop/human/denial/material
fences refuse usable late output. Exact cache reuse precedes paid hold/pin acquisition,
so exhausted new-call budgets do not strand cached advice. Original terminal receipts
permit exact runtime/admission release and idempotent restart reconciliation; unknown
or successor ownership remains held without resend/refund. Prepared-host observations
cannot be replaced by static controls; legacy component fixtures are not authority.
This is not activation, mount isolation or a confirmed remote cancellation claim.

## Protected advisory runtime selection

`cli/src/supervisor-runtime.mts` supplies a source-only trusted composition API,
`createSupervisorRuntime`. It resolves the existing complete workflow and loads its
actual execution context only **after** comparing every inventoried source/artifact
byte with the trusted factory's inventory and positively importing the existing
four-archive Pi/OpenAI public SDK closure offline. A regenerated project manifest,
ABI shim, model/TOML value or capability callback is not positive adapter proof.
The current advisory compatibility set is exact byte-compatible complete copies;
other complete project overrides remain valid for normal Factory but hold here
without executing their JavaScript. The saved-run collector separately still holds
all project-mode overrides; this module does not broaden that contract.

Before starting a child it acquires one protected version-2 runtime-store lease
binding canonical host and selected paths, both source/dependency identities,
project, invocation, fence, state directory and fixed provider profile. Identical
host/selected paths deduplicate; distinct paths with equal content IDs retain both
pins. Ordinary version-1 lease readers (including older GC/removal) reject version
2 rather than interpreting dead PID ownership as permission to prune. There is no
exit-hook release or dead-owner adoption. Selection/settings/source/dependencies
are checked again before start and handoff; no fallback or repair occurs.

After actual T04 readiness the lease transfers once to the exact worker PID/start
identity and retains the complete original process evidence. Unknown cleanup,
no-send, failed startup/handoff, death or missing accounting retain the pin. Release
reads actual T05 durable local-human terminal settlement, original known T03 usage
and fresh T04 whole-group absence outside the runtime lock, then removes only an
exact matching token/record under that lock. It cannot release a successor, kill a
reconstructed PID/group, reset charges, or turn retained advice into authority.

This runtime API is not activation authority. The explicit public advisory host now reads
an expiring private [operator rollout attestation](factory-cli.md#operator-rollout-attestation)
bound to the canonical project/tracker plus `identity.host`, `hostDependencies`, `selected`
and `dependencies`. These are actual verified complete-runtime/dependency identities, not
operator-selected substitute ABI values. Compatibility checks above and raw custody/claims
remain required; a human assertion cannot bypass them. Public acquisition requires the full
configured timeout remaining. Fresh record reads before authorization/publication must match
the policy/grant pin; changes or expiry invalidate usable output, not accounting obligations.
No record data enters diagnosis basis, and renewal never resets history. The component-only
host prerequisite booleans are not public source proof or installed quiescence evidence.
Mount/resource isolation and actual older-runtime/unmanaged-work quiescence remain the future
operator's responsibility, not an automated conclusion. Auth remains an explicit trusted
handoff parameter, never discovered from user configuration.

## Explicit saved-run diagnosis collector

The source-only `cli/src/supervisor-input.mts` collector consumes an already selected
`ExecutionContext`, checks current selection before and after collection, and
requires one explicit ticket in a uniquely registered canonical checkout. It
reuses the selected config/instruction/template/runtime identities without
credential discovery, user auth/settings reads or project executable imports.
Complete project-mode overrides currently hold as unsupported by this collector;
standard Factory source is never substituted for an override.

Its frozen `originals.json` contains the complete snapshot, incident facts, current
frozen ticket input and exact material `bindings`. The snapshot policy digest binds
those original run/attempt/receipt/config/saved-input bytes, normalized settings,
current base SHA and ownership along with Factory model policy; runtime/dependency,
baseline/tip and current ticket hashes remain explicit snapshot material. Originals
are read with bounded stable no-alias reads and written 0600 in a new 0700 host
directory outside project/runtime mounts. Finished recovery inputs use the exact
validated attempt-scoped current evidence, never an older implementation verdict.
Own-hold exclusion requires an explicit exact identity, matched against both
read-only admission observations; conflicting foreign holds still refuse even
without a generation increment. Neither a selected context nor a fixture
runtime proves actual installed mount or cleanup authority. Refer to the
[complete input contract](supervisor.md#complete-saved-run-input-collection) for
source roles, authoritative decisions, cache stability and refusal conditions.

## Reviewed acceptance originals

The selected runtime includes the host-only `acceptance-custody.mts` APIs alongside
`acceptance-contract.mts`. They bind exact frozen ticket content/rendered hashes,
authoritative criterion inventory, reviewed contract/probe/fixture bytes and trusted
approval into a content-addressed sealed original. `ticket-input.mts` exports the
shared `frozenTicketIdentity` recomputation; payload journals and existing proof
formats are unchanged. No standard entrypoint, admission or replay gate is activated
by adding these APIs.

A trusted host supplies an authenticated approval ingress scoped to both ticket and
acceptance identities, a canonical private store, and the complete inventory of
**all** agent mounts. Originals must be outside every mount, including mutable
evidence, project and runtime code; ancestor/equality/alias overlaps refuse. Probe
bytes are digest-pinned local bytes, never remote fetch or host shell instructions.
Exclusive publication and a complete seal permit only rehashed exact originals;
partial, unknown, missing and tampered state holds without replacement or deletion.
Resume/repair must retain their original saved bundle pointer, not refreeze current
tracker inputs or replace historical proof. New requirements or approval create a
new reviewed identity for a separately authorized execution.

Only the trusted independent runner may obtain a new private execution copy outside
implementer mounts. It reads expected results from the original contract, not candidate
code, and must never mount the original store. The implementer receives requirements
and diagnostics only. These APIs do not themselves establish runner reset, execution
authorization, mount completeness, candidate replay or delivery proof; downstream
host integration owns those boundaries. Filesystem permissions assume trusted host
code and an isolated implementer, not protection against malicious same-UID host
processes. See [the custody API contract](acceptance-contract.md#host-owned-frozen-acceptance-custody)
for bounds, publication/retention and caller responsibilities.

### Owned baseline execution and receipt custody

The selected inventory includes `acceptance-runner.mts`, `acceptance-worker.mts`,
`acceptance-sandbox.mjs` and the pure `acceptance-receipt.mts` policy checker.
The host producer requires distinct exact execution authorization, a complete
validated runtime/private dependency identity and a saved frozen bundle/approval.
It reserves separate capacity under the shared admission lock, starts a detached
worker, transports only exact Git objects and rehashed runner copies, and performs
setup/probes only inside the bounded private sandbox. Fresh `/work` and `/state`
support pinned project-local synthetic web/database setup; no implementer/shared
Git, original custody, host credentials, Docker socket or external resources are
mounted or authorized. Unsupported reset holds.

Controller death does not release the reservation. A different-UID in-container
watchdog bounds payload execution independently; stable engine/container/owner/
generation cleanup, deadline and cancellation fencing govern settlement. Unknown
or ambiguous late creation retains capacity. An immutable producer seal and durable
admission publication index authenticate exact results and retained raw output;
caller booleans or arbitrary policy-valid JSON are not producer receipts.
See [the owned producer contract](acceptance-contract.md#owned-baseline-producer)
for supported images, limits, source APIs and real-runtime evidence limitations.
The owned-runner tests now execute the actual copied driver/setup/frozen probe in a
local rootless namespace with only a copied executable/library closure, read-only
inputs and disposable private synthetic state. Two fresh executions observe the
same seed/SHA; reuse of persistent dirty synthetic state yields a real setup failure
and no results. This is filesystem-backed synthetic site evidence, not actual
CMS/SQL reset, Docker cgroups or the different-UID watchdog. Those proof limits and
unsupported-reset holds remain; no project-class narrowing is implied.
No standard entrypoint admission, implementation launch or candidate-proof gate is
activated here; independent custody/semantic review remains separate.

## Normal payload custody and terminal handoff

The standard launcher inventories `payload-custody.mts` with the exact selected
source/dependency identity. Actual normal main saves a fresh private journal nonce
on its current run before payload creation, durably writes pending custody before
calling Sandcastle, registers its actual returned exact container and records absence
only through the real close helper's independent Docker observation. This journal
is separate from branch/worktree ownership receipts and mutable readiness reports.

A lexical normal scope owns implementation, verification and host delivery. Its
terminal seal is appended only after that scope has actually unwound and every
registered payload is absent with no pending creation; only then may its cleanup
entry and runtime lease release on exit. Ambiguous construction/registration, failed
close and controller loss retain ownership. Early no-payload failure does not mint
closure. A successor scope receives a fresh nonce; normal/recovery admission clears
old pointers, and delivery continuation's changed claim cannot inherit authority.
The admission exception validates only an explicitly selected current saved run
against its complete immutable source-bound chain; all legacy/foreign raw records
remain held. See [the exclusion protocol](supervisor.md#shared-admission-exclusion).
No full advisory host, credentials, installed activation or runtime policy change is
introduced by this source protocol.

## Launcher contract

A trusted launcher selects a prepared runtime once and supplies:

| Input | Contract |
| --- | --- |
| `FACTORY_PROJECT_ROOT` | Existing canonical absolute checkout root |
| `FACTORY_RUNTIME_ROOT` | Existing canonical absolute selected workflow directory. Installed bundles are named by content ID; explicit project overrides need not be. |
| `FACTORY_RUNTIME_ID` | The selected manifest's source content ID |
| `FACTORY_RUNTIME_DEPENDENCIES` | Selected private dependency snapshot hash, pinned for descendants |
| `FACTORY_WORKFLOW_MODE` | Resolver-selected `factory` or `project` |
| `FACTORY_HOST_RUNTIME_ROOT`, `FACTORY_HOST_RUNTIME_ID`, `FACTORY_HOST_RUNTIME_DEPENDENCIES` | Validated installed host bundle and dependency snapshot whose runtime-store lease protects launcher dependencies, including for project mode |
| cwd | The project root, not the runtime directory or a checkout subdirectory |
| `SANDCASTLE_STATE_DIR` | Absolute shared state directory. Omission uses `$HOME/.local/state/factory`. |

`orchestrator/context.mts` validates the complete runtime inventory, Node/platform
metadata and private dependency snapshot. The executing module must belong to that
runtime. Missing context, wrong cwd, aliases, changed bytes or an incomplete bundle
fail before workflow preflight. There is no adjacent-config, copied-module or
project-package fallback. Low-level entrypoints tell the caller to use Factory
commands rather than guessing a checkout.

The context loads only `<project>/.factory/factory.toml`, schema version 2.
The shared `project-layout.mts` inspection requires canonical project and asset directories and refuses all config symlinks, including contained aliases. Any `.sandcastle` entry or unknown inspection result holds new work without creating reports or artifacts.
Missing or v1 settings are unsupported. Validation runs before credential,
Docker or admission work. The data-only `config-read.mts` bridge returns allowlisted
metadata, not generated shell or arbitrary settings JSON. Its `supervisorPolicy` key returns only the validated supervisor policy JSON; it is not operator mode or admission.

## Code and project paths

Runtime code, executable helpers and all four Factory prompt templates come from
the selected bundle. SDK entrypoints use Node with the bundle's absolute
`node_modules/tsx/dist/cli.mjs`. Interactive image builds use the bundle's absolute
Sandcastle executable. Dispatch never installs project dependencies and never
resolves an executable through project `npm`, `npx` or `node_modules`.

Git and `.env` use the checkout. Sandbox image/setup settings come from its TOML.
Logs, evidence, recovery artifacts, diagnostic sessions, SDK patches and implementation worktrees use the shared `.factory` layout. New private runtime preparation applies the pinned [Sandcastle patch](sandcastle-patch.md) after npm with scripts disabled and before dependency hashing. Failed preparation leaves prior bundles and descriptor bytes intact. Analysis worktrees and shared records retain their shared
state layout. `.factory/sandbox` is an explicitly mounted project helper
directory; an empty project receives no installed sample image or Drupal setup. Repository source examples live under `.factory/`, but executable runtime assembly reads the canonical `orchestrator/`, `board/` and CLI template inventories. The retired project workflow copies are not runtime inputs.
Saved-layout assertions inspect every top-level state JSON before project filtering
and all selected-project ownership receipts with canonical, stable regular-file
reads bounded to 8 MiB each. Aliases and special files refuse before opening;
NOFOLLOW/NONBLOCK and descriptor checks prevent a replacement FIFO from blocking.
Receipt validation uses the same bounded bytes, not a second unrestricted read.
Initial context loading and `assertCurrent` also bound every project config and
instruction read through the same canonical regular-file descriptor primitive:
256 KiB per file, 128 configured instruction paths total, and 1 MiB composed text
per role (six roles), including separators. Invalid text and unstable reads refuse.
Ordinary contained instruction aliases remain supported; supervisor collection
calls `assertCurrent({strictOriginals:true})` at both freshness checks to reject
aliases before any inherited instruction read. NOFOLLOW/NONBLOCK and descriptor
checks apply here too, not merely in the collector's later original reads.
Selected immutable runtime manifest/template validation remains unchanged.
Malformed unrelated JSON remains under its normal schema reader's authority.
`codePath` and `projectPath` reject lexical traversal between these roots. Existing old-layout run/ownership paths are never rewritten into `.factory` authority. Exact saved-container settlement may proceed while a layout hold blocks new launches; that maintenance does not authorize repair or adopt a branch. Already-running processes keep their immutable selected runtime, even after a new descriptor is published.

## Frozen inputs and proof

Normal startup resolves the implementation tier once from the ticket's current
description. The run stores `implementationModel` and `modelChoice`, including
family, tier, source, resolved model, description revision and policy identity.
Later assessment refreshes do not overwrite those attempt fields. Pi is fixed;
analysis and supervisor diagnosis use family Mid; verification, recovery and independent gate review use family Large with high
thinking. Recovery does not inherit the old implementer tier. Provider provisioning
failure never selects another family or model. OpenAI token handoff and explicit
subscription-extension loading retain their existing credential boundaries.

The context snapshots normalized settings, runtime inventory/dependency identity,
Factory template bytes/hashes and the additive-input hash map. Execution analyses
carry `policyIdentity`; an absent or different identity requires fresh analysis.
Assessment freshness and recovery preparation also include this policy identity.
Existing actual footprints, implementer blockers, saved work, evidence and attempt
budgets are not reset by that invalidation.

Host proofs contain the complete runtime file inventory, not a second curated
executable list. Proof settings include normalized configuration and the frozen
runtime/template/additive identities. Current-input checks run before admission
and verification/delivery authorization. Existing-delivery continuation compares
the entire selected inventory and settings before it can reuse a proof. Changing
settings or templates requires fresh authority; TOML comments alone do not.
Requirement, historical baseline, immutable verifier, independent browser probe,
claim, exact-SHA CI and merge checks remain separate mandatory gates.

Standard normal/recovery main retain the original authenticated custody criterion
IDs separately from verifier report text and pass them through the existing verifier
entrypoint. The runtime-owned `ACCEPTANCE_CRITERIA` prompt argument exposes only
that identity inventory. PASS reports must reconcile every original `criterionId`
exactly once; the host validates this after verifier immutability checks. The
existing runtime inventory already ships all touched modules and verifier template;
no new helper or dependency asset is introduced. Normal and recovery main perform
separately authorized owned exact-candidate
replay after payload teardown, reusing the detached producer and original frozen bundle.
The candidate reserves separate capacity and composes only with its exact live claim and
managed entry. Normal runs authenticate their payload journal; repair authenticates its
attempt record and exact repair-container absence. No foreign ownership or cap is bypassed.
Version 3/policy 3 proofs retain authenticated baseline/candidate handles plus the
original full policy/raw-config binding; writer and shared proof readers authenticate both
producer seals, exact SHAs, independent owners, original bytes, current grants and cleanup.
The current host preparation and baseline reference must still match. Writer and reader
also check the project/state, requirements hash, image and normal or exact-recovery-attempt replay purpose,
and derive mandatory semantic criterion IDs and typed obligations from the authenticated
original bundle. The report and frozen media bind browser and interactive obligations;
manual links resolve to the independently authorized candidate receipt, not agent output.
All changed modules were already shipped by the complete runtime inventory; the test
host is fixture-only. Nonexecuting CI continuation requires modern replay proof and
compares it to the run's saved original admission. Legacy PASS holds with explicit
migration guidance; it is not rewritten. Unsettled candidate reservations retain recovery claim
ownership and charges.
Baseline admission identity, full-scope baseline and saved repair-start comparison stay separate.

### Supervisor and independent review inputs

The additive roles `supervisor` and `gateReview` use the same contained Markdown loader as existing roles: common files first, canonical deduplication, literal frozen text and hashes, no secret-path aliases. Their ordered hash maps and normalized supervisor policy participate in `identity`/`policyIdentity` and `assertCurrent`. Edits invalidate authority without rewriting the existing snapshot. These are additional guidelines, not replacement Factory prompts or constraints.

This context supplies only runtime/config/instruction identity. It does not collect or synthesize a supervisor snapshot or review input. The explicit [diagnosis worker](supervisor.md#bounded-diagnosis-and-retained-memory) retains the original sources and separate guidelines/Factory constraints required by committed `supervisor-contract.mts`; summaries and additive hashes alone cannot replace them. Its prompt and pure parser ship with the complete runtime. No independent review worker or action authority is supplied by execution context. The explicit scoped gate-input consumer below validates previously retained host authority; it cannot create an approval.

`supervisor-policy.mts` and `supervisor-contract.mts` ship through the single complete runtime inventory, including copied fixture installs and explicit project overrides. Assembly, manifest regeneration, selection and override recovery review already consume that inventory; a missing/changed supervisor module cannot borrow installed code. Future modules/entrypoints/prompts must be added when their actual files land, then receive new complete manifest identity and renewed override review. No absent future asset names or mixed-runtime fallback are supported.

### Direct advisory provider artifact boundary

The source-only direct request adapter requires a **validated complete selected
runtime**, not source-tree or host-global Pi. It compares the selected runtime ID
and dependency identity with the immutable grant, verifies that it is itself loaded
from that exact flat runtime, revalidates at the final transport gate before
authorization, and validates again after the response. The actual selected prompt
bytes must match their manifest hash. Its fixed
`supervisor-provider/` assets contain hash-pinned published Pi-AI/OpenAI public
subpath archives and original manifest/license data, plus real provenance package
and lock files. These files participate in the ordinary runtime inventory/source
identity. The provenance lock records the upstream full dependency graph; runtime
loading is deliberately only the complete selected OpenAI Responses subpath closure,
not an all-provider install. No package manager or source/test fallback is used.
Verified archive bytes are copied to private temporary scratch before extraction;
immutable runtime contents are never modified. An enlarged import surface or
changed artifact needs a new complete inventory/profile rather than a missing
module workaround.

The exact grant owner must be a separately registered worker PID/start. Frozen
snapshot project/ticket/run, basis, runtime and dependencies must match the grant.
The system prompt is selected-runtime-owned, and all original snapshot context is
serialized into the user message. Explicit isolated worker configuration and
Standard API auth are required; environment credential/log/proxy overrides cannot
select the provider context. Final payload/profile/worker authorization uses the
supervisor journal under its stop lock, then HTTP occurs outside every lock.
Raw terminal evidence is not yet durable settlement or a proof artifact.
[Request contract](design/supervisor-provider-contract.md) and
[supervisor limits](supervisor.md#bounded-direct-pi-request-source-adapter) distinguish
this request proof from the owned lifecycle composition below and later installed
factory/public-command acceptance. No activation is implied.

### Owned advisory runtime assets

The complete inventory also ships `supervisor-openai.mts`, `supervisor-process.mts`,
`supervisor-runner.mts` and `supervisor-guard.mjs`, unchanged in copied bundles.
The trusted source factory must be loaded from that exact selected flat runtime;
it accepts no caller executable, argv, environment or transport selector. Its fresh
empty cwd/HOME and detached Node guard/worker have no project settings, tools,
sessions or credential discovery. Explicit auth crosses owned IPC only at handoff,
not the immutable grant or process evidence.

The minimal guard owns its group and starts an absolute bounded deadline before
waiting for the parent/worker. Parent loss, timeout and termination signal only
that still-live anchor's own group. Bounded parent-side Linux `/proc` or Darwin
ps capability evidence must establish exact start/group/session identity; unknown
Darwin session evidence is explicitly held, not claimed supported. Private durable
process association precedes journal registration and grant handoff. The actual
T02 final transport gate remains the sole send permission and T03 publishes durable
raw/scalar usage. Whole-group ESRCH observation, not anchor exit or pipe closure,
is required for a private cleanup receipt; live/reused/unknown groups are never
raw-killed on reopen. The worker also exits on anchor IPC disconnect and retains
its own same-grant deadline; unexpected anchor loss is not permission for network
work to wait indefinitely. This fallback is not a group cleanup receipt. Missing
evidence holds ownership and full charge.

These APIs do not acquire shared admission or runtime-store leases, construct
complete current facts, settle advisory reservations, release exclusion, publish
advice or provide public host wiring. Later trusted composition must supply those
contracts and all agent-mount exclusions. The old injected print worker remains
component-only. See the [owned boundary](supervisor.md#owned-short-lived-advisory-process-boundary)
for lifecycle, strict evidence and explicit platform limitations.

### Shared admission version compatibility

The complete runtime inventory includes `supervisor-admission.mts` alongside the
mandatory v2 `admission.mts` reader/writer. Validated v1 state migrates only on commit,
preserving claims/generations/recovery pending and candidate accounting. Old actual
v1 readers reject v2. No optional exclusion bypass or downgrade is supported. Complete
copy/import fixtures must include both assets unchanged; never fall back to source
code from a selected flat runtime.

Owned baseline reservations additionally use the mandatory v1
`admission/baselines.json` sidecar under that same lock. Normal/recovery/delivery
capacity counts retained baselines, conflicting managed entries refuse them, and
supervisor acquisition requires their quiescence. No baseline creates a run or
recovery charge. Baselines are never reaped by PID or age. **Old v2 admission code
does not understand this sidecar**: select the entire updated admission/board/
supervisor runtime and quiesce all old/unmanaged work before baseline API use.
Keeping the main state version at 2 is not a mixed-runtime compatibility guarantee.
Immutable `admission/baseline-<execution>.sealed` indexes survive reservation release;
private receipt/spec/output identities remain retained outside sandbox mounts.

Managed CLI dispatch/manual/selected-issue, shell bootstrap, standard direct main/
dispatch and recovery launch acquire durable entry ownership before effecting work.
Normal/recovery/delivery admissions and claim adoption/transfer also refuse a
conflicting supervisor hold. Tokenless manual adoption takes a real normal claim.
Entries bind canonical root and tracker; aliases sharing the same root or sanitized
tracker namespace conflict even when display names, hosts or roots differ. Entries
have no generation/recovery charge and orphan entries are not pruned by owner death.
Existing normal/delivery claim pruning remains unchanged; supervisor holds are never
pruned by owner death. Raw run records without definitive ownership/payload cleanup
prevent new holds regardless of stage, starting/claim metadata or controller death;
no shipped legacy raw producer provides that proof.

This is source exclusion, not public advisory finalization. A separate source-only
`settleAdvisory` journal primitive validates actual registered grant/authorization,
immutable known T03 usage and exact T04 whole-group cleanup outside locks, then uses
a private one-use frozen event and journal CAS to retain a finished reservation,
full reserved charge and a terminal receipt. Owned-host publication also validates
actual bounded output/frozen input and atomically retains typed advice or a pending
local HumanRequest; no notification is sent. Exact release reads validated durable
closure before taking the admission lock and rechecks the full current hold identity;
replay cannot resend or clear a successor. Strict old journal readers refuse the new
settlements field; three-field old advisory records remain explicitly readable.
No-send, absence-only or caller-callback cleanup authority is supplied. Journal send
authorization remains the sole one-use permission under its own lock; no nested
supervisor/admission locks or network/process waits under either lock are added.
Runtime compatibility checks occur before admission locking. Quiescence of all old
runtimes and unmanaged work plus complete compatible active-runtime selection are
explicit rollout gates, not a claim of exclusion against nonparticipating code.
See [shared admission exclusion](supervisor.md#shared-admission-exclusion) and its
[entrypoint-to-guard trace](supervisor.md#managed-entrypoint-audit-trace). The trace
distinguishes preflight entries from exact-token implementation/recovery/delivery
claims; neither layer replaces frozen proof, continuation or send-authorization
checks. Direct main/dispatch and shell bootstrap are guarded independently of the
CLI wrapper, so supported selected-issue entry does not rely on its caller behaving
correctly. No runtime module or dependency is added by this audit.

### Exact scoped gate-input corrections

The source-only [`applyReviewedGate`](supervisor.md#exact-scoped-verification-guidance-application)
API publishes an intent-bound immutable host input artifact, not an edit to the
checkout, worktree, config or installed runtime. Only a configured verification-only
Markdown document can receive an exact full-preimage substitution; other roles,
Factory constraints and arbitrary command execution are excluded. The private
artifact is outside all project/agent mounts and is never a proof or verdict.

A trusted host can explicitly call `loadExecutionContext({ gate })` with its exact
application/ticket/run and current authorization provider. There is **no** TOML or
environment bypass selector and no default CLI activation. The loader validates
current pilot/act/fence/expiry, receipt/worktree, full runtime/settings, all actual
reviewed instruction bytes and independent host review-completion provenance. It
substitutes just that source in the existing verification loader. Every raw read
is checked against its reviewed original hash; original files are not changed.

The frozen identity additionally binds application/input/review, scope, fence,
expiry, postimage and current candidate SHA. Candidate or material changes revoke
the old context; material proposal/input changes also require new independent
review. `assertScope` is enforced by real analysis, normal/recovery execution and
existing-delivery authorization, so an unamended context cannot reuse old analysis
or proof for that exact run. Another explicitly named ticket/run is unaffected.
`analyse` accepts the explicit scoped context and run ID; `runVerifier` accepts its
execution context and exact renewed manifest. The latter refuses stale candidate/
policy/requirements analysis and requires a new evidence directory before the
ordinary independent verifier runs. New host proof still requires immutable
candidate, current context, confirmed cleanup and exact-SHA delivery gates. A gate
approval never changes a historical FAIL/INCONCLUSIVE or supplies PASS/merge approval. `postAndDeliver` additionally checks the proof's frozen exact amendment/application/candidate and source hash against the host journal on every authorization, independently of the caller's current-context recheck. An old same-SHA PASS is refused even when paired with a valid amended context.

These are explicit source APIs for trusted orchestration, not a scheduler transport
or paid/live adapter. A caller unable to carry them safely through current execution
contracts must retain work and use the committed human bridge; it must not mutate
the host checkout or weaken Factory. Offline tests exercise their real consumer
and proof APIs with fixture-owned process/sandbox boundaries. Live paid ceilings,
activation and pilot prerequisites remain unchanged.

## Process ownership

The shell bootstrap holds its own runtime lease through preflight and foreground
execution. Dispatcher, normal/recovery execution, analysis preparation and provider
preflight processes own separate lease tokens. A dispatcher acquires a separate
child token before spawn, transfers it to the detached child's PID/start identity,
and passes that capability to the child. The child consumes it rather than using
the dispatcher's token. Descendants inherit the pinned project/runtime identity,
not an installed descriptor that might change during the pass.

A process releases only its own token. Normal and recovery runs mark cleanup
pending while they own sandbox resources and release only after their cleanup
boundary confirms completion. Uncertain cleanup leaves the lease record in place.
PID/start ownership, stale-owner handling and uninstall rules remain those of the
runtime store; leases add no age-based reclamation or garbage collection. They do
not replace recovery claims, exact-container cleanup or settlement.

## Workflow selection

`orchestrator/workflow.mts` selects one complete workflow using canonical checkout
identity, v2 TOML and a trusted installed runtime descriptor. Selection reads data
and hashes files, never importing project executable modules. CLI run/dispatch,
scheduler readiness and dispatch/refresh, Board refresh, recovery preparation,
image readiness and recovery launch use this resolver. Copied `.factory`
main/dispatch files cannot override Factory mode. `cli/src/runs.mts` still resolves
registered checkout and data-only tracker identity, not executable paths.

Factory mode uses the descriptor's validated content-addressed bundle. Project
mode uses only the explicit repository-relative `workflow.directory`. It requires
the same versioned complete inventory, package/lock metadata and private dependency
snapshot. The source tree is closed: only inventoried files, their parent directories,
`runtime-manifest.json` and private `node_modules` are permitted. Additional helpers
or metadata files are rejected, including symlinks outside the listed inventory.
Missing/unknown inventories, stale hashes, illegal paths, source symlinks
and missing dependencies fail without fallback. Dependency links must remain inside
private `node_modules` and resolve to existing entries. No installed helper or
prompt fills a hole in an override. Project overrides are trusted custom code, not
a sandbox or permission to bypass installed host admission/review contracts.

A fresh invocation reads the current descriptor. Its children inherit the selected
root, source ID, private dependency hash, mode and host identity rather than
rediscovering a newer descriptor. Regenerating a manifest after a dependency-only
edit does not authorize inherited children to use those new bytes.
Scheduler recovery preparation and launch retain their completed pass's selection
and saved Node/PATH. Changing workflow mode/root/identity within an invocation
fails and requires a fresh invocation. Active processes keep independent runtime
lease tokens; the host runtime store remains protected in project mode too.

Factory-mode recovery needs no per-project executable review. Project-mode review
is host-owned and binds mode, workflow root, complete source ID/file hashes and
private dependency hash. Edits or a different override directory invalidate review.
A review cannot repair an invalid manifest, reset history/budgets or authorize
admission, proof reuse, cleanup or delivery by itself.

Board services receive `FACTORY_RUNTIME_DESCRIPTOR` from trusted installation
configuration. Standalone Board installation uses the same bundle builder and
records `~/.local/share/sandcastle-board-runtime/runtime.json`; Factory installation
supplies its own `runtime.json`. Missing descriptors and missing/ambiguous checkouts
publish token-fenced assessment failures. Board never falls back to local dispatch
files. Refresh remains read-only with respect to runs, charged admission and tracker mutation,
with bounded process groups and existing request coalescing.

### Maintaining a complete code override

Start with a copy of a prepared bundle in a checkout-contained directory. Review
all custom executable changes, keep its private dependencies complete, then use
the trusted Factory checkout's pure helper to calculate a new manifest. For example,
from the project root, replacing both paths with the intended absolute paths:

```sh
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  import { regenerateRuntimeManifest } from "/path/to/factory/orchestrator/workflow.mts";
  const directory = "/path/to/project/workflow";
  writeFileSync(directory + "/runtime-manifest.json",
    JSON.stringify(regenerateRuntimeManifest(directory), null, 2) + "\n");
'
```

The helper only reads and hashes files; the caller explicitly writes its result.
It does not install packages, migrate projects or confer review authority. Configure
`workflow.mode = "project"` with the repository-relative directory and explicitly
confirm recovery review after inspecting the complete override. A stale manifest
is an error, never a reason to run Factory code instead.

## Diagnostic and instruction boundaries

Low-level entrypoints consume explicit context; they do not discover descriptors.
`factory config explain` resolves and validates the selected runtime without importing
its executable modules, preparing bundles or acquiring leases. A project override's
actual behavior remains opaque. Do not treat an old copied scaffold as a prepared bundle.

Configured instruction files are validated and frozen separately for implementation,
verification, analysis and recovery. Common files precede role files and canonical
aliases are deduplicated. Their role-specific hashes participate in policy identity;
current-input checks reload them and revoke authority on changes. Frozen text is
inserted literally in an additive section, never as a replacement Factory template.
Missing or invalid configured files fail closed.

[Supported-layout acceptance](../TESTING.md#supported-layout-acceptance) records the offline entrypoint, preservation and dependency-identity evidence. The [patch maintenance guide](sandcastle-patch.md#updating-the-sdk) owns SDK updates and removal; fixture SDKs do not replace its actual-package verification.

These changes are source contracts, not deployment or migration instructions.
They neither install a runtime into a real project nor resume schedules.
