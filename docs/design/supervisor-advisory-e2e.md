# Supervisor delivery plan: advisory proof first, autonomy gated

Status: **implementation plan, not shipped capability or activation approval**.
Baseline: `develop` at `211bf1558a229d787267a93e1bc29a1fc0151406` (2026-11-17).

## 1. Request and finish line

Give an operator a real, bounded way to ask why one saved ticket run is stuck,
receive useful advice, and inspect the same retained result or actionable human
request in the CLI and Board. Prove the complete path through the shipped public
CLI, selected immutable runtime, actual Pi/OpenAI integration, durable accounting,
and existing admission controls—not a test-only supervisor.

This document plans the **owner-approved advisory MVP end to end**, then identifies
the separately gated increments needed for the broader supervisor in
[epic #231](https://github.com/markdlabrecque/factory/issues/231). It does not turn
advisory acceptance into acceptance of autonomous recovery, review, correction or
delivery. Local task IDs below are proposed work packages, **not filed issues**.
No issues, labels, dispatch, installations or paid work are authorized by this plan.

### Approved MVP boundaries

- One registered project, one explicitly named ticket, its current saved run.
  No project-wide/no-run diagnosis. Missing or ambiguous historical identity holds;
  do not manufacture a run, baseline, failure, readiness observation or proof.
- Explicit operator invocation, proposal-only. Fixed Mid
  `openai/gpt-6.1-terra`, with the existing `high` thinking policy. No provider/model
  fallback, escalation, agent tools or resumed model session. The new runtime path
  refuses Anthropic; existing general family behavior remains supported unchanged.
- Complete original ticket/parent/human planning and relevant current evidence;
  summaries and display excerpts are never substitutes for originals.
- Local durable advice/human requests first. CLI/Board reads are passive. No
  automatic tracker notification, recovery admission, review, gate edit, code
  delivery or scheduled diagnosis. Existing operator-initiated recovery keeps all
  its controls, counters, independent verification and exact-SHA delivery gates.
- Conservative atomic exclusion from conflicting project work, not a second
  execution scheduler. One diagnosis owner; unknown cleanup/accounting retains
  charge and exclusion. No reset, refund, uncertain replay or raw-PID cleanup.
- Global off/unknown, project pause, supervisor stop, human/denial holds and changed
  material inputs fence new work. An explicit diagnosis does not unpause or enable
  scheduling. Observe permits this explicitly authorized advice, never effects.

### Three different finish lines

| Finish line | What must be demonstrated | What it does not establish |
| --- | --- | --- |
| Adapter candidate | Provider contract plus actual Pi request-path constraints, durable raw usage, owned process lifecycle, fail-closed accounting | Public installed wiring, useful diagnosis, actual server behavior or billed invoice measured live |
| Offline advisory MVP | Public copied-install command reaches that adapter; complete inputs, real exclusion/journal, useful-shaped retained advice or local human request, CLI/Board visibility and stop/preservation work | A live paid call, diagnosis quality, production installation, reduced operator effort or autonomy |
| Evaluated one-project advisory pilot | Separately authorized real installation/configuration and bounded paid evaluation, actual usage and operator assessment against a baseline | Broader rollout, automatic actions, reviewer approval, verifier PASS or epic completion |

The source/offline delivery ends at the second line. The plan includes an executable
procedure for the third, but running it requires a new explicit authorization.

## 2. Starting point: reuse versus missing wiring

Authoritative current behavior lives in [the supervisor reference](../supervisor.md).
The [OpenAI investigation](../research/supervisor-openai-boundary.md) records exact
Pi/Pi-AI 1.5.2 artifact hashes and primary provider sources. Model support is
positive. The unchanged print invocation is **not** a paid budget adapter.

| Component already in source | Reuse | Remaining work for this slice |
| --- | --- | --- |
| `orchestrator/supervisor-contract.mts`, `supervisor.mts`, `supervisor-policy.mts` | Strict original snapshots, incident/basis identities, proposal parsing, role/project preflight | Concrete host inputs and trusted provider capability; no new permissive policy engine |
| `cli/src/supervisor-state.mts` / `commitSupervisor` | Durable host-wide journal, CAS, reservations, human/denial holds, atomic diagnosis publication | Bind real exclusion/request ownership; explicit crash-safe request authorization if existing events cannot express it |
| `cli/src/supervisor-worker.mts` / `diagnoseProject` | Reserve before launch, frozen originals, fixed role, bounded diagnostics, stale-result checks, reuse | A real `DiagnosisBoundary`; grant/hold ownership checks at actual send; real completion/accounting rather than injected callbacks |
| `cli/src/supervisor-facts.mts` / `collectSupervisorTicketInput`, `supervisorReviewSnapshot` | Exhaustive original child/parent/comments collector and shared snapshot validator | Saved-run-aware host assembly of every material/source field; bounded read-only tracker collection |
| `cli/src/supervisor-facts-host.mts` / `readSupervisorFacts` | Passive local observations, explicit unknowns | It is not a complete paid-launch authority collector; do not promote status output to authorization |
| `board/admission.mts`, `board/board.mts` / `withAdmission`, `admitRun` | Shared lock, durable claims, PID/start fencing | Project exclusion respected by all managed normal/manual/recovery/delivery paths, schema/version safety and exact settlement |
| `orchestrator/workflow.mts`, `context.mts`, `cli/src/runtime-ownership.mts` | Complete workflow selection, immutable runtime/dependency identity and runtime leases | Diagnosis-specific selected-runtime invocation and child ownership; no project executable discovery/fallback |
| `cli/src/commands/supervisor.mts`, `cli/bin/factory.mts` | Read-only status/explain, stop/control, exact local human resolution | Public `diagnose` route; current projection shows next-action kind but needs a useful safe advisory summary |
| `board/supervisor.mts`, `board/board-server.mts`, `board/board.template.html` | Passive `/api/supervisor`, redaction, human requests and observed costs | Render retained advisory detail without inventing progress or introducing effecting UI |
| Review/application/recovery/scheduler modules | Retain existing source contracts and negative regressions | Not reachable automatically from the advisory host; broader installed journeys remain deferred |

### Existing tracker work

- [#243](https://github.com/markdlabrecque/factory/issues/243) remains incomplete;
  [PR #255](https://github.com/markdlabrecque/factory/pull/255) is a separate,
  unmerged bounded audit. Its hosted shard-3 timeout occurred twice; local passing
  results did not waive CI. Its new acceptance file is **not on this baseline**.
- [PR #256](https://github.com/markdlabrecque/factory/pull/256) merged provider
  research and the advisory scope. It implemented no adapter or diagnosis command.
- [#228](https://github.com/markdlabrecque/factory/issues/228) is related existing
  continuation work, not a prerequisite. Preserve its proof/ownership constraints
  if it lands; refresh its body/comments and queued work before filing tickets.
- Existing closed supervisor children are source-component delivery, not evidence
  that their public action paths are operational. Do not reopen them merely to
  conceal missing integration; file bounded follow-on work under the epic.

## 3. Target operator journey

Proposed public syntax (not yet available):

```text
factory supervisor diagnose <ticket> --project <name|path> [--json]
factory supervisor status --project <name|path> --json
factory supervisor explain --project <name|path> --json
factory supervisor stop --project <name|path>
```

`diagnose` is the explicit request to spend within already configured finite
limits. It does not require or enable `mode act`, install services, schedule a
future call, enable a paused project, or notify the tracker. It selects exactly the
current saved record for that ticket and reports its run identity. Historical run
selection is deferred. The collector must bind saved execution identity and any
recovery-attempt identity into the run/evidence basis; legacy records lacking
needed identity are held, never upgraded by assumption.

```text
public diagnose(ticket, project)
  resolve registered canonical root and tracker
  validate current controls + explicit finite host/project policy
  select and lease the complete Factory runtime (opaque overrides refused)
  collect originals + saved run + current immutable material identities
  reject stale/incomplete/oversized/unsupported input before paid launch
  claim durable project exclusion under existing admission lock
  release admission lock
  re-read controls/material; call existing diagnoseProject
    reuse an exact retained decision, OR
    durably reserve diagnosis resources before process/request launch
    start one fresh owned Pi boundary with its immutable grant
    authorize at most one send; constrain final serialized request
    retain raw terminal usage and owned cleanup evidence
    recheck controls/material; publish advice OR local human request
  release exclusion/runtime ownership only with exact settlement evidence
  print sanitized structured outcome

later status/explain/Board read retained results; no provider/tracker refresh
```

Suggested command result contract: versioned JSON with `state` (`held`,
`proposed`, `reused`, `human-required`), project/ticket/run identity, incident and
invocation/diagnostic IDs where present, bounded reason/recommendation, reservation
and known/unknown accounting, and safe local evidence references. No raw prompts,
credentials, provider stream, hidden reasoning or unsanitized stdout/stderr.
Use exit 0 for proposed/reused, 2 for a retained human-required result, and 1 for
held/invalid/failed launch; document local signal exits separately. Status reads
remain successful observations even when their content reports holds.

## 4. Shared design contracts to freeze before implementation fan-out

These contracts are planned additions, not declarations that matching APIs exist.
T00/T01 must commit the concrete supported interfaces before downstream tickets
refer to them. Do not add dependency edges for file overlap alone; serialize
shared-file writing/merges and revalidate against the current base.

### 4.1 Provider capability and all-in accounting

The only supported route is focused hardening of the existing Pi/OpenAI path.
T00 must choose a supported integration surface from actual source evidence:
trusted explicit extension, isolated Pi SDK invocation, or a precisely bounded Pi
change. It must show how the gate prevents transmission. A hook that merely logs,
reports an error, or swallows a thrown exception is **not** a request gate.
Do not invent CLI budget flags or silently introduce a second OpenAI client stack.
If the route needs an upstream primitive/release or broader architecture, report
that concrete blocker and stop dependent paid-adapter work for owner review.

The trusted adapter factory—not project TOML, model output or a callback returning
`true`—constructs `DiagnosisBoundary` only when all prerequisites are established:

1. Exact resolved model/provider/API/endpoint and supported Pi artifact identity;
   frozen settings, no arbitrary user extensions/resources/model overrides.
2. A proven upper bound `I` on the **complete serialized input**, including system
   framing, and server-accepted output/reasoning bound `O`. Prompt bytes, local
   token estimates and stdout limits do not establish `I`. A context-derived bound
   is acceptable only with an explicit provider contract and a budget it fits.
3. Exact conservative arithmetic, upward rounded in integer micro-USD:
   `reservedTokens = I + O`, and cost covering the worst allowed input/cache-write,
   output, service-tier, long-context and regional rates. Fix supported policies
   where possible; unknown rates or unrepresented charges refuse before send.
   Reasoning is included in output, not added a second time.
4. At most one generation request. Cover SDK/provider retries, agent retries,
   compaction/overflow recovery, cache warming and continuation, not just one retry
   setting. No tools or deferred/background generation. A token-count preflight
   API call is **not** implicitly authorized; T00 must explicitly account for any
   additional request and its pricing/call-policy consequences before adopting it.
5. The accepted remote request remains bounded if every local process dies. A
   watchdog proves local lifecycle only, not remote cancellation or exact dollars.
6. Raw terminal provider evidence associated with exact invocation/request/model,
   input/cache/output totals, actual service/cache policy and price version.
   Normalized Pi counters defaulting to zero and computed catalogue cost are not
   enough to prove terminal usage or a provider invoice.

Price knowledge and authoritative token usage support a clearly identified
**derived charge**, not a claim of account-invoice reconciliation. Missing terminal
usage, unknown pricing detail or uncertain remote acceptance returns unknown.
Reserve worst case monotonically; never treat a reserved upper bound as measured
actual usage or refund the difference. Record reserved and known actual separately.
Account alerts and propagation-delayed hard spend limits are secondary defenses.

### 4.2 Host controls and finite global policy

Existing project TOML supervisor limits remain project-owned inputs, not global
spending authority. Add a versioned, host-owned policy outside project/agent mounts
(default candidate `Paths.config/supervisor.json`) with an explicit enabled state,
finite cumulative host token/cost/call ceilings, and finite diagnosis capacity.
Absent, unreadable, malformed, unsupported or unpriced policy means held. No
unlimited default or per-invocation reset. For this one-project pilot, use capacity
one; expanding concurrency is not necessary for acceptance.

Preserve existing global-off/unknown and project-pause semantics. Reuse the current
trusted observations (`schedulingState`/backend status and registry schedule state)
rather than treating explicit `diagnose` as a bypass. This means the existing
controls can conservatively refuse a manual diagnosis, including a never-opted-in
project. The command must explain which control held it and must not enable a
service/project to get past it. A future independent advisory authorization switch
would be a separate product decision, not an implementor's silent substitute.
All source/offline fixtures supply these observations through existing platform
fakes; this plan runs no service-manager mutation.

Pin policy identity in each grant. Increasing a configured ceiling must not erase
history or renew spent allowance. Recheck registration, controls, policy and source
identity before authorization and publication. Existing required review-limit
configuration is preserved, but advisory operation never consumes review calls.

### 4.3 Ownership records and the two-store transaction

Proposed `DiagnosisGrant` binds project canonical root/tracker, ticket/saved run,
incident/basis, invocation ID, fresh fence, selected runtime/dependency identity,
provider artifact/profile identity, policy identity, owner PID/start, deadline and
reserved resources. Secrets are not grant fields or hashes of secret values.
The provider boundary cannot enlarge or replay it.

Proposed `SupervisorHold` lives in the shared admission store, with exact project,
invocation/fence, owner identity and pending/settled evidence references. It is not
an implementation run or recovery attempt; claiming it must not increment recovery
charges, normal generations or execution progress. Match canonical root **and**
tracker identity consistently; protect against aliases sharing a tracker/run-state
namespace, not just pretty project names.

`admission/state.json` and `supervisor/state.json` have different locks today.
Do not pretend their writes form one atomic transaction. **The supervisor journal
owns send authorization:** T01 adds a one-use authorization transition through
`commitSupervisor`, under the same supervisor lock as `stop`/control transitions.
It checks the exact active reservation/invocation/fence, previously registered
worker ownership and immutable grant, and rejects stopped/human-held or otherwise
ineligible state. Its durable receipt binds the request payload/profile identity.
An event replay can inspect that receipt but cannot obtain a fresh permission or
resend. T02 consumes this committed primitive; T09 composes it with admission,
not a second permission store. Exclusion is acquired first and cannot be released
while a registered worker or its send authorization is unsettled. Protocol:

| Ordered durable boundary | Crash behavior |
| --- | --- |
| Claim exclusion, before any paid reservation | No paid request is permitted; orphan exclusion remains until exact no-send/owner evidence allows settlement |
| Persist reservation tied to existing exclusion | Charge remains even if no process starts; never infer refund from absent PID |
| Register child ownership, then consume one-use send authorization in the supervisor journal | Same-lock stop ordering is definitive; crash/ambiguous send consumes permission, with no replacement request or replay |
| Send constrained request outside every lock | Remote spend bounded by accepted request, not controller survival |
| Persist raw terminal usage and owned cleanup receipt | Receipt publication is idempotent; missing/invalid evidence retains charge/exclusion |
| Commit final diagnosis/human outcome in supervisor journal | Late stop/material change cannot publish usable advice; preserve diagnostics |
| Release matching exclusion and runtime ownership | Only exact durable settlement/no-send evidence permits release; repeated cleanup cannot release a successor |

No network, subprocess wait, tracker collection or model work runs under either
lock. No nested cross-store locks. Define request authorization as the linearized
admission point: stop prevents new authorizations and usable late output, but an
already authorized request is owned in-flight work, not magically unsent. Stop
between authorization and transmission must not be reported as confirmed remote
cancellation. Prove both lock orderings deterministically: stop commits first ->
no authorization/send; authorization commits first -> already owned in-flight
work, with stopped-state usable publication refused. The child must wait for an
explicit ownership-registration/authorization handshake before network work; a
spawned PID is not permission. A grant cannot be reconstructed from journal absence
alone. Cleanup may not release exclusion merely because no authorization is yet
visible: a live/unknown registered worker or uncertain handoff still holds it.

Existing `withAdmission` prunes dead normal/delivery claims. New supervisor holds
must **not** be pruned by owner death. Schema evolution must make older readers
fail closed rather than silently ignore an optional exclusion field: plan a new
validated admission version, preserve all claims/generations/recovery/pending
charges in migration, and test old-reader refusal. Publish compatible readers and
writers together in the complete runtime. Do not silently downgrade on rollback.

Every managed effecting entrypoint must honor exclusion before work: dispatched
normal runs, manual `factory run`/selected `--issue` entry, recovery and delivery.
`adoptClaim` currently permits a tokenless manual start; guarding only `admitRun`
therefore does **not** finish this work. Audit actual main/dispatch entrypoints.
Untracked active work and missing ownership are holds, not an empty project.
The guarantee covers supported managed entrypoints, not arbitrary commands a host
user runs outside Factory. Mixed old runtimes/unmanaged entrypoints must be
identified as unsupported/unknown; do not claim exclusion against code that never
participates. Quiescence and compatible active-runtime checks are rollout gates.

### 4.4 Complete source and result identity

Use `collectSupervisorTicketInput`/`freezeTicketInput` to collect complete current
child/parent/human comments, including all pages and stable collection checks.
Assemble all source roles: child, parent, human planning, guidelines, Factory rules,
gate, failure and prior decisions. Legitimate absence is explicitly not-applicable;
missing/truncated/oversized relevant originals hold. No implicit tracker writes.

Define `prior-decisions` as the complete relevant **authoritative decision set at
the collection cutoff**, sorted by stable identity/content: existing validated
independent-review decisions, audited local human resolutions and applicable
human/policy decisions not already supplied as ticket originals. Preserve their
original bytes and references. A genuinely new such decision changes the basis;
if no relevant decision exists, mark the role not-applicable. Do not include the
whole mutable journal, observation revisions, charge counters, diagnostic summaries
or the cached diagnosis's own output as new authoritative prior decisions.

On each invocation, first rebuild current external/material originals and that
authoritative set, then compare `diagnosisBasis` for exact reuse. The worker's
separate bounded `DiagnosisMemory` may provide supplemental past-diagnosis context
for a new call, but it neither replaces original sources nor recursively changes
the snapshot basis. An unchanged invocation after saving its own diagnosis must
therefore have the same basis and make no new send. A new material human/review
instruction changes the basis and is still subject to retained denial/human holds,
incident allowances and cumulative budgets; change does not imply permission.

Bind saved run/attempt, implementation baseline, current tip/base, failure/gate
bytes, selected runtime and dependencies, normalized settings/model policy,
complete ticket-input hash and admission generation. New admission without a
normal generation increment still changes ownership: revalidate exclusion and
claims, not just the generation field. A materially changed ticket, run, evidence,
policy, runtime or owner invalidates the in-flight/cached result.

Store originals privately outside agent mounts, with bounded no-symlink reads and
host-only permissions; use existing layout/path validation. Do not checkout/reset,
clean, fetch/update a worktree or discover arbitrary secrets to gather evidence.
Bound every direct child and tracker/Git subprocess; the existing readiness Git
helper has no per-call timeout, so fixture-wide deadlines remain necessary until
that shared helper is deliberately addressed. No relevant original is truncated
merely to fit the model; refuse with an actionable explanation.

Retained advice includes rationale, alternatives and the typed proposed next step,
clearly marked non-executing. Gate-change and recovery proposals remain advice.
Unusable output, exhausted unchanged-incident allowance or uncertainty yields a
local durable human request. Existing exact human resolution can record abandon
or a material successor; it never grants approval, clears denied history, confirms
cleanup/accounting or automatically retries. No new reset/approve-all command.

## 5. Ticket-ready work packages

Each package below supplies the goal, dependencies, footprint, verification and
completion conditions to expand into a self-contained task. Copy relevant scope
and invariant text into each filed ticket; the implementor must not need this
conversation or an HTML plan. Paths marked **new** are proposals, not existing APIs.

Planning model for every task: **Mid, `openai/gpt-6.1-terra`** (project provider
setting is OpenAI). Use this repository's `Model tier: mid` runtime selector and a
separate planning-model field; do not introduce rejected active `Pi model:` selectors.
No `ready-for-agent` labels or automatic launches are part of this plan.

Every source task must include its own required authoritative docs, responsibility
comments, focused tests and runtime inventory/dependency updates in the same PR.
Markdown receives the same conflict protection as code. Do not defer shipping a
new asset until a later packaging task or refer to nonexistent downstream modules.
The listed estimates are human hours without AI, including local tests/review work;
they are not suggested agent run durations.

### T00 — Prove a supported constrained Pi request path (8h)

**Depends on:** none. **Type:** bounded technical investigation with executable spike.

- **Goal:** select and evidence the smallest existing-Pi integration that can
  enforce section 4.1, or return a specific missing capability.
- **Footprint:** `docs/research/supervisor-openai-boundary.md`; proposed
  `docs/design/supervisor-provider-contract.md`; one bounded offline request-path
  fixture/spike using the actual supported Pi/provider artifact. If introducing a
  test, read the writing-tests skill and put it in the regular test inventory.
  Promote this same harness into T02; do not keep duplicate request-path suites.
- **Deliver:** exact hook/SDK invocation and fail-closed behavior, complete-input
  bound derivation, allowed service/cache policies and worst-case price arithmetic,
  one-request gate location, raw usage surface, artifact pin/packaging and test
  transport strategy. Resolve the catalogue/public context discrepancy explicitly.
- **Proof:** real Pi/provider code with denied external network and controlled HTTP
  transport captures the final payload. Invalid grant and a forced extra request
  cannot transmit. No fake `DiagnosisBoundary`, invented budget flags or live API.
- **Done when:** review accepts the concrete contract and supported dependency
  identity, or the ticket reports BLOCKED with the exact primitive/owner decision.
  Dependent paid-path implementation stays blocked on the latter; documentation
  saying “hardening needed” is not successful completion of this investigation.

### T01 — Freeze grants, limits and one-use send authorization (10h)

**Depends on:** T00's supported provider contract.

- **Goal:** provide validated grants, finite host/project/role policy and the
  durable authorization primitive T02 needs, not capability booleans from config.
- **Footprint:** **new** `cli/src/supervisor-advisory-contract.mts`,
  `cli/src/supervisor-host-policy.mts`; `cli/src/supervisor-state.mts` authorization
  schema/transition and targeted worker/policy interfaces;
  runtime inventory; `docs/supervisor.md`, `docs/project-config.md` for any schema
  changed, and `docs/factory-cli.md` for host provisioning/inspection.
- **Changes:** grant/profile identity and strict version/unknown-field handling;
  explicit host policy loader, cumulative call/token/cost limits, capacity one;
  exact upward-rounded micro-USD arithmetic and applicable cache/tier conditions.
  Implement ownership registration and the section 4.3 one-use send-authorization
  transition in the supervisor journal, serialized with stop. Define schema/version
  migration without erasing existing history or treating legacy active reservations
  as known no-send. Replay is observational, never a second permission. Preserve
  all existing project/review defaults and no-reset behavior.
- **Proof:** unit cases for exact ceilings, overflow, rounding, reasoning/cache
  treatment, stale/unknown profile, malformed policy and project-versus-host caps;
  authorization/stop transition cases for both orderings, duplicate permission,
  wrong fence/reservation/worker and legacy uncertainty. Minimal real filesystem
  loader case for permissions/path/corruption preservation; actual interprocess
  composition is T09, not duplicated here.
- **Done when:** absent/unknown/insufficient policy cannot create a valid grant;
  T02 can consume a concrete committed same-lock authorization API, with exact-once
  return semantics. Bounds are justified by T00 and no secret is serialized.

### T02 — Enforce one bounded request in the actual Pi path (8h)

**Depends on:** T01.

- **Goal:** make the final provider request obey a single immutable grant.
- **Footprint:** **new** `cli/src/supervisor-openai-request.mts` and the exact trusted
  Pi integration asset selected by T00; runtime inventory/dependency manifests;
  `docs/supervisor.md`, `docs/execution-context.md` as affected.
- **Changes:** fixed resolved Mid/API/endpoint, no tools/resources/fallback,
  complete-request input gate, exact server output ceiling, allowed cache/service
  policy; consume T01's one-use supervisor-journal authorization at the final gate,
  never a temporary permission store or injected authorization callback. Disable
  hidden request sources and gate
  any attempt they still make before network transmission. No production test flag.
- **Proof:** one provider-transport integration suite against real pinned Pi code,
  with synthetic non-secret auth and all real outbound traffic denied. Assert the
  outgoing payload and zero/one transmitted generation outcomes across gate
  rejection and hidden-call attempts; keep policy arithmetic in T01 unit tests.
- **Done when:** transport evidence plus primary provider contract establish the
  bound. An injected callback, timeout or `enforceable: true` is not that evidence.

### T03 — Retain and validate authoritative provider settlement (6h)

**Depends on:** T01; consumes the T00 raw terminal-event contract.

- **Goal:** durably distinguish known terminal usage from ambiguous accounting.
- **Footprint:** **new** `cli/src/supervisor-openai-usage.mts`; receipt schemas in the
  advisory contract; runtime inventory; `docs/supervisor.md`, `docs/telemetry.md`.
- **Changes:** exact invocation/request/model association, raw terminal record and
  validated scalar receipt, service/cache/token detail, price version and derived
  micro-USD charge. Reject missing/inconsistent/out-of-reservation counters.
  Preserve terminal provider status separately from valid diagnosis text.
- **Proof:** unit validation for missing/zero counters, reasoning inclusion,
  cache/tier variants, wrong IDs, truncation and incomplete responses; one atomic
  filesystem persistence/reopen case. No duplicated provider request matrix.
- **Done when:** `usage` returns known resources only on complete matching evidence;
  missing stream, default-zero counters or receipt corruption remains unknown.

### T04 — Build the owned short-lived provider boundary and watchdog (8h)

**Depends on:** T02 and T03.

- **Goal:** implement a real `DiagnosisBoundary` using their trusted gate/receipts.
- **Footprint:** **new** `cli/src/supervisor-openai.mts`,
  `cli/src/supervisor-process.mts` and any watchdog/runner asset chosen by T00;
  necessary `DiagnosisBoundary` contract adjustment in `supervisor-worker.mts`;
  inventory; `docs/supervisor.md`, `docs/execution-context.md`.
- **Changes:** fresh isolated process/environment, supported Pi artifact validation,
  immutable grant handoff and explicit ready/authorize handshake (no request before
  ownership is durably registered), bounded stdout/stderr, exact PID/start/group
  ownership, child-owned deadline surviving controller death, lifecycle receipts and
  idempotent `terminate`/`usage`. Reject unsupported platform/lifecycle capability;
  do not silently narrow Factory's support claims without recording that blocker.
- **Proof:** one real disposable local-process integration for normal completion,
  controller termination, deadline and descendant cleanup using explicit IPC
  barriers, not sleeps/retry tolerances. Provider protocol remains the T02 suite.
  A pipe close or missing leader alone cannot establish full-group cleanup.
- **Done when:** parent loss cannot leave unbounded local work; remote spend is
  independently bounded by T02; ambiguous cleanup/usage keeps ownership and charge.
  Existing worker injection tests remain component tests, not adapter proof.

### T05 — Add durable supervisor exclusion to shared admission (8h)

**Depends on:** T01.

- **Goal:** atomically exclude competing project work without fake run/repair charges.
- **Footprint:** `board/admission.mts`, `board/board.mts`; **new**
  `cli/src/supervisor-admission.mts`; inventory; `docs/supervisor.md`,
  `docs/factory-cli.md` and `docs/execution-context.md` for schema/compatibility.
- **Changes:** new admission version and explicit compatible migration; durable
  hold claim/check/release with exact invocation/fence; stale-owner retention;
  `admitRun` refusal for conflicting normal/recovery/delivery admissions. Preserve
  claims, generations and recovery pending/candidate accounting byte-for-byte in
  meaning. New holds do not advance implementation/recovery counters.
- **Proof:** units for schema/migration/canonical identity/fences; one real
  interprocess admission race with deterministic IPC barriers. Verify old readers
  refuse the new store and corrupt stores are untouched.
- **Done when:** simultaneous claimants cannot both win, no owner-death pruning of
  supervisor holds occurs, and exact release cannot clear a successor. This alone
  does not claim tokenless manual entrypoints are covered.

### T06 — Make every managed effecting entry honor exclusion (8h)

**Depends on:** T05.

- **Goal:** close manual/legacy paths that would bypass a shared admission check.
- **Footprint:** `cli/src/commands/run.mts`, `commands/dispatch.mts`,
  `cli/src/recovery-claim.mts`, `orchestrator/dispatch.mts`, `orchestrator/main.mts`,
  `board/board.mts` as the audited entrypoint trace requires;
  `docs/factory-cli.md`, `docs/execution-context.md`, `docs/supervisor.md`.
- **Changes:** obtain/adopt genuine normal ownership before supported manual work;
  enforce same exclusion for selected `--issue`, recovery and delivery starts;
  preserve dispatched claim handoff, exact-token board writes and existing recovery
  charges. Refuse unsupported mixed-runtime/opaque/unowned activity, not hide it.
- **Proof:** table-driven cheap entrypoint cases plus the existing admission race
  harness for manual versus diagnosis, dispatch, recovery and delivery. Assert no
  implementation/container/model/remote effect or recovery charge after refusal.
- **Done when:** publish an entrypoint-to-guard trace with no managed bypass, and
  all existing claim/recovery/proof/continuation regressions pass unchanged.

### T07 — Assemble complete saved-run diagnosis inputs (8h)

**Depends on:** none; reuse current contracts. Integrate T01 identity at T09.

- **Goal:** construct a real complete snapshot and facts for one current saved run.
- **Footprint:** **new** `cli/src/supervisor-input.mts`; existing facts/ticket-input,
  tracker, run/layout and selected-context helpers where needed; inventory;
  `docs/supervisor.md`, `docs/ticket-readiness.md` and `docs/execution-context.md`.
- **Changes:** resolve exact saved execution/attempt identity and material source
  hashes; collect all comment pages/original roles; separate guidelines and Factory
  constraints; bind baseline/tip/failure/settings/runtime/dependencies/admission.
  Bound direct Git/tracker children; no refresh/reconciliation/edit/checkout.
- **Proof:** cheapest collector units and one real read-only fixture boundary using
  existing ticket-readiness/project helpers and controlled tracker responses.
  Cover missing run/legacy identity, changed pages, oversized or missing originals,
  stale material and unsupported complete overrides without inventing input.
  Cheap collector cases assert own diagnosis publication leaves prior-decision
  sources/basis unchanged, whereas a new material human decision changes them.
- **Done when:** the frozen originals independently recompute the snapshot/basis;
  collection/refusal preserves dirty/index/refs and never delivers tracker writes.

### T08 — Pin and retain selected runtime ownership for diagnosis (6h)

**Depends on:** T04.

- **Goal:** give the host a supported complete-runtime selection and lease, with
  real provider dependency identity, before exposing any public paid command.
- **Footprint:** **new** `cli/src/supervisor-runtime.mts`; `orchestrator/workflow.mts`,
  `context.mts`, `cli/src/runtime-ownership.mts`, `runtime-assets.mts` as needed;
  runtime fixtures; `docs/execution-context.md`, `docs/supervisor.md`.
- **Changes:** use existing selection/context and runtime leases; pin both host and
  selected Factory identities and T00's Pi artifact/dependency contract. Transfer
  exact child leases; retain on uncertain cleanup. Refuse opaque project overrides,
  missing assets, mutated dependencies or unsupported Pi without source fallback.
  Every preceding task already ships its own assets; this is not a deferred copy fix.
- **Proof:** extend existing complete-bundle/lease/override fixtures. Demonstrate
  private copied imports and provider assets resolve without source-tree access,
  and mutation/missing-dependency/removal attempts hold safely.
- **Done when:** no work can run from a reselected/partially installed runtime or
  lose the owned runtime while diagnosis is unsettled.

### T09 — Connect the real advisory host, journals and settlement (10h)

**Depends on:** T01, T04, T06, T07 and T08.

- **Goal:** compose the actual existing diagnosis worker with genuine controls,
  complete input, provider boundary, exclusion and runtime ownership.
- **Footprint:** **new** `cli/src/supervisor-host.mts`; targeted worker/state/admission
  changes for the section 4.3 protocol; inventory;
  `docs/supervisor.md`, `docs/execution-context.md`, `docs/telemetry.md`.
- **Changes:** immutable grant, exclusion-before-reservation, real current authority
  rereads, composition of T01's same-lock authorization API (not a new permission
  mechanism), exact reuse with section 4.4's prior-decision cutoff, raw evidence
  settlement, durable human outcomes and safe release. Reuse `diagnoseProject`; do not introduce
  a parallel test/production supervisor or call the recovery/review/action broker.
  Define idempotent restart/reconciliation from exact receipts; uncertain state
  remains held and inspectable, not permanently hidden or automatically repaired.
- **Proof:** state-transition units own crash-cutpoint table coverage; one real
  filesystem/process composition proves reserve-before-request and monotonic
  hold/settlement across controller loss, both stop/authorization orderings and
  stale material. Own diagnosis cannot recursively invalidate reuse; new material
  human decisions change the basis but cannot bypass holds. No model semantics
  asserted from canned transport output.
- **Done when:** a non-CLI host invocation with real adapters can produce retained
  advice/human request, cannot execute it, and every interrupted boundary has an
  explicit safe successor or actionable held state.

### T10 — Expose explicit diagnosis through the public CLI (6h)

**Depends on:** T09.

- **Goal:** make the target command available without enabling action mode.
- **Footprint:** `cli/bin/factory.mts`, `cli/src/commands/supervisor.mts`;
  `docs/factory-cli.md`, `docs/supervisor.md`.
- **Changes:** strict `diagnose <ticket>` parsing, project selection, host call,
  versioned redacted result and defined exit codes; signal-to-owned cancellation.
  Keep status/explain/Board reads passive; no arbitrary model/actor/budget-reset or
  injected host-capability flags. Stop in another CLI writes the durable fence and
  reports cancellation pending honestly; it does not claim immediate termination.
- **Proof:** parser/output/control units using established fixtures; actual public
  copied-install wiring belongs once in T12, not another full journey matrix here.
- **Done when:** invalid/no-run/unsupported/held selection cannot reach paid send;
  observe can explicitly diagnose within controls, act remains unavailable, and
  an unresolved human request cannot be bypassed by repeated diagnose calls.

### T11 — Show useful retained advice and honest costs in CLI/Board (6h)

**Depends on:** T09's retained result contract.

- **Goal:** expose the same useful recommendation and local human request safely.
- **Footprint:** `supervisorProjection` in `cli/src/commands/supervisor.mts`,
  `board/supervisor.mts`, `board/board-server.mts`, `board/board.template.html`,
  existing execution-event metrics as needed; `docs/supervisor.md`,
  `docs/factory-cli.md`, `docs/telemetry.md`.
- **Changes:** bounded rationale, alternatives and typed next-step summary for all
  supported diagnosis categories, diagnostic/run/basis references, reserved versus
  known/unknown usage, owners and stop-pending visibility. Mark all advice
  non-authorizing. No execution button or automatic tracker notification.
- **Proof:** existing projection/redaction/renderer units and passive endpoint
  contract; malicious HTML/ANSI/secrets, missing/corrupt journal and pagination
  remain safe. Reads must make zero provider/tracker mutation calls.
- **Done when:** an operator can understand the retained advice without reading raw
  hidden reasoning, and neither a proposal nor human delivery counts as progress.
  T10/T11 touch shared CLI/docs: serialize their edits/rebase, not parallel writers.

### T12 — Prove the public copied-install advisory journey (10h)

**Depends on:** T10 and T11 (and their transitive runtime/provider/admission work).

- **Goal:** prove shipped wiring through real host/worker/admission/adapter code.
- **Footprint:** canonical `cli/test/supervisor-acceptance.test.mts` (reconcile with
  PR #255 if it lands; do not create a duplicate supervisor fixture); reuse
  `ticket-readiness-fixture.mts`, `runtime-fixture.mts`, `config-fixture.mts`,
  `platform/fake.mts` and existing process/transport harnesses; `TESTING.md`,
  `docs/supervisor.md`.
- **Journey A:** copied public CLI on private selected runtime, fixture-owned
  current ticket/run/originals and real host controls -> actual trusted adapter
  with synthetic HTTP response -> real reservation/settlement -> retained advice
  visible through fresh CLI process and the production Board projection. Unchanged
  rerun retains the same authoritative prior-decision set/basis and reuses exact
  advice with no second paid request. Work/ref/index unchanged.
- **Journey B:** public stop during an owned diagnosis -> new authorization refused,
  pending remains honest -> controller loss/unknown terminal usage cannot release
  charge/exclusion or admit conflicting work; local human request is visible after
  restart. Unit suites, not this journey, own every fault permutation.
- **Isolation:** deny real network/model/tracker/1Password/Docker/service mutation;
  use the real adapter with transport substitution below the provider boundary.
  Never replace `diagnoseProject`, inject fake host authorization, register a
  test-only supervisor, empty production prerequisites or treat a no-op hook as work.
- **Done when:** recorded command/output/request trace/journal/ownership artifacts
  prove both journeys with no source fallback, and the evidence states exactly
  which provider responses/platform boundaries are synthetic. It does not prove
  remote enforcement, actual billing, diagnosis quality or a completed pilot.

### T13 — Complete source acceptance, runbook and release gate (6h)

**Depends on:** T12 and all mandatory safety regression results.

- **Goal:** provide a reproducible evidence pack and operator-held pilot procedure.
- **Footprint:** `docs/supervisor.md`, `docs/factory-cli.md`, `TESTING.md`; reconcile
  obsolete/in-flight audit wording in PR #255 explicitly; relevant issue comments
  only when the owner authorizes tracker updates/ticket filing.
- **Changes:** capability/prerequisite checks, measured baseline, finite-budget
  provisioning, explicit per-project invocation, observing raw known/unknown
  accounting locally, stop/rollback and held reconciliation instructions. Include
  external Pi version/dependency compatibility and admission schema upgrade limits.
- **Proof:** all four unchanged mandatory CI shards, separate lifecycle job,
  documentation checks and independent safety review of actual current code and
  copied-install evidence. Investigate shard timeouts using timings/assignments;
  no coverage/deadline reduction or repeated retry without new analysis.
- **Done when:** every matrix row below has an artifact or explicit blocker; latest
  develop reconciliation, all hosted checks and reviews are green, ordinary
  SHA-guarded merge only. Offline MVP acceptance is separate from epic closure,
  installation, paid permission and pilot completion. Retain a clean active worktree;
  clean up only other completed captured worktrees, never dirty work by force.

### T14 — Evaluate one project, only after separate authorization (6h evaluation budget)

**Depends on:** T13 **and fresh explicit operator approval** for installation,
configuration, credentials mechanism and bounded paid calls. Not source execution
permission and not part of this plan's authorized work.

- **Goal:** establish real operational/semantic evidence, not just canned wiring.
- **Procedure:** operator selects one owned non-production project and saved run,
  captures current manual diagnosis/intervention baseline, provisions compatible
  immutable runtime and finite limits, verifies no incompatible/unowned active
  work, then authorizes a specified small call count and spend ceiling.
- **Evidence:** request/response IDs and actual known usage/derived charge, same
  retained public views, no unauthorized effects or lost work; operator grades
  whether advice correctly describes the evidence and gives a useful next step.
  Record misleading advice and intervention time, not just valid JSON.
- **Stop:** any accounting/ownership/pricing/control uncertainty, unsafe advice or
  unexpected call holds further work. Lost terminal evidence is not grounds to
  repeat the paid call. No automatic recovery or notification as remediation.
- **Done when:** owner records accept/reject and operational limitations. A sample
  is not a statistically demonstrated reduction in effort or wider-rollout approval.

### Dependency and estimate summary

| Task | Hard prerequisites | Human hours |
| --- | --- | ---: |
| T00 constrained-path investigation | None | 8 |
| T01 grants/policy/arithmetic/same-lock authorization | T00 successful contract | 10 |
| T02 actual request gate | T01 | 8 |
| T03 raw usage/settlement | T01 | 6 |
| T04 owned boundary/watchdog | T02, T03 | 8 |
| T05 admission schema/exclusion | T01 | 8 |
| T06 managed entrypoint coverage | T05 | 8 |
| T07 complete saved-run collector | None | 8 |
| T08 selected runtime/leases | T04 | 6 |
| T09 real host composition | T01, T04, T06, T07, T08 | 10 |
| T10 public CLI | T09 | 6 |
| T11 advisory projection | T09 | 6 |
| T12 copied-install journeys | T10, T11 | 10 |
| T13 acceptance/runbook | T12 | 6 |
| **Source/offline task subtotal** | | **108** |
| Cross-task integration, independent review and release coordination | | **12** |
| **Source/offline estimate (upper planning allocation)** | | **120** |
| T14 separately authorized evaluation | T13 + owner permission | **6, excluded** |

These are new integration estimates, not a claim that the epic's original 128h
estimate has been spent or that all remaining autonomy fits inside 120h. T00 may
expose an upstream/platform blocker requiring re-estimation. No parallel agents
are requested here; the dependency graph permits independent work, while shared
source/doc/inventory edits still require serialized writing/merge coordination.

## 6. Proof matrix and evidence pack

Choose the cheapest tier that proves each behavior. Keep pure policy and fault
permutations in units; one integration harness owns each real external boundary.
The two copied-install journeys are justified because no unit can establish that
the distributed public CLI/private runtime/host/adapter/display chain is connected.
Do not add browser E2E merely to retest renderer policy.

| Claim | Cheapest sufficient evidence | Owner | Not acceptable as proof |
| --- | --- | --- | --- |
| Exact fixed model/API and complete bounded request | Actual pinned Pi request serialization + enforced offline transport gate + primary provider contract | T00, T02 | CLI flags, model availability alone, stub `start` assertions |
| Finite all-in token/cost reservation | Reviewed complete-input bound and price premises; arithmetic units; captured output cap | T00–T02 | Estimate, stdout bound, soft/delayed account budget, reserved = actual |
| No hidden second generation | Actual provider request trace with induced retry/overflow/warming paths blocked before send | T02 | SDK retry setting alone or no second call in one happy-path sample |
| Terminal usage is known or honestly unknown | Raw terminal event identity and receipt validation; atomic reopen | T03 | Text success, default zeros, inferred invoice or cleanup |
| Controller-independent local bounds | Disposable owned-process/group integration with explicit barriers and durable receipts | T04 | Parent timer, pipe close, PID absence or raw-PID kill |
| One owner across conflicting managed work | Real shared-store interprocess race; entrypoint guard trace; schema compatibility checks | T05, T06 | Busy-state read, `admissionHold: true`, lease registered only by tests |
| Complete original context and fresh basis | Actual collector fixture, source hashes and negative stale/missing cases | T07 | Status excerpts, supervisor summaries or invented hashes |
| Reserve-before-request and crash-safe monotonic settlement | Real host/store/process composition plus cutpoint units | T09 | Injected callback returning authorized/cleaned/accounted |
| Correct selected bundle and dependency identity | Private copied runtime imports/leases, mutation and complete-override refusal | T08 | Source alias, no-op installer as proof of actual new dependency availability |
| Public installed advice/human visibility and stop | Two copied-install public journeys with actual host/adapter and controlled transport | T10–T12 | Calling worker directly, injecting production services or a test supervisor |
| No effects and work preserved | Effect traps plus dirty/index/refs/counters before/after; existing proof/denial regressions | T06–T13 | “observe” string or mocked no-op hook |
| Real provider acceptance and useful diagnosis | Explicitly authorized operational sample, usage evidence and operator judgement | T14 | Synthetic transport output, valid JSON, reviewer/model self-approval |

For every candidate retain a concise machine-readable index plus human summary:

- Exact source commit, base/merge SHA, selected runtime/dependency ID, Pi/provider
  artifact hashes/version, platform and documented provider/price contract version.
- Focused test commands and results, four complete shard results, separate lifecycle
  job, hosted check URLs and independent review findings/disposition. Historical
  counts are not current acceptance; adding test files changes modulo shard costs.
- Public commands/exit statuses and sanitized outputs; actual captured synthetic
  request count/payload fields; journal revisions/reservation resources and receipt
  IDs; exclusion/lease transitions; original-input hash/references. No secrets or
  raw hidden reasoning in tracker attachments.
- Work preservation and zero-effect assertions, fresh-process inspection results,
  unresolved prerequisites and a clear **real / synthetic / not run** boundary for
  each row. A missing row is a blocker, not an invitation to relax it.

Source command baseline (Node 24; no package install/live services required for
existing fixtures; T00 must provide the offline pinned-artifact strategy for new
provider integration):

```bash
node --test cli/test/supervisor-*.test.mts orchestrator/supervisor*.test.mts board/supervisor.test.mts
node --test cli/test/documentation*.test.mts
bash scripts/test-shard.sh 1 4
bash scripts/test-shard.sh 2 4
bash scripts/test-shard.sh 3 4
bash scripts/test-shard.sh 4 4
timeout --signal=KILL 30s node --test --test-reporter=tap --test-timeout=15000 orchestrator/browser-provisioning.test.mts
git diff --check
```

Implementors run changed focused unit/integration tests while iterating and all
mandatory commit gates before finishing. Any new matching tests enter the exact
inventory automatically. Retain concurrency, complete coverage, the 180-second
shard deadline and independent lifecycle gate. No sleeps/timing tolerances in
commit tests; use process IPC barriers. Real browser-image/service-manager/provider
smoke work remains distinct and explicitly authorized where required.

## 7. Broader supervisor after the advisory proof

The following are **deferred planning packages**, not MVP acceptance criteria or
permission to activate them. They explain how an end-to-end advisory proof grows
into the original supervisor without equating source helpers with operational
capabilities. Scope/activation decisions must be recorded before these become
ready implementation tickets. Estimate them from refreshed source at that time.

| Package | Existing source to reuse | Missing production integration and required proof | Dependencies/gates |
| --- | --- | --- | --- |
| D0 action authority/ownership contract | Authority inventory, existing recovery/proof rules, advisory holds | Decide finite mixed-workload capacity/atomic handoff, authenticated cross-process control, scoped execution-owner consumer and role-specific paid ceilings; publish exact nonwaivable boundaries | T13, explicit owner-approved action scope; no effects while unresolved |
| D1 existing recovery admission | `cli/src/supervisor-policy.mts` / `brokerSupervisor`, `recovery-claim.mts`, `recovery-run.mts` | Trusted broker caller atomically converts authorized advice into exactly one existing claim/charge; crash/replay and refusal proofs; preserve #228 and operator controls | D0; finite actual execution capacity and role accounting; approval does not reset budgets |
| D2 fresh independent gate review | `supervisor-review.mts` / `reviewGateProposal`, `orchestrator/gate-review.mts` | Real fresh read-only fixed Large reviewer boundary with complete originals and exact proposal binding; denial/inconclusive/timeout remains stopped, no reviewer shopping | D0; separately proven Large-model/provider/price profile, not reuse of Mid booleans; explicit review authorization |
| D3 scoped correction through fresh proof/delivery | `supervisor-gate-apply.mts` / `applyReviewedGate`, `gateInstructionSource`, context/analysis/verifier/handoff | Trusted scoped execution owner consumes the exact approved correction; new analysis and independent verification/proof, including same-SHA changes; delivery checks current exact SHA and approval | D2, real execution-owner transport and finite capacity; approved review is not verifier PASS |
| D4 authorized notification/control and event host | `supervisor-escalation.mts` / `deliverSupervisorRequest`, `trackerNotificationAdapter`, `resolveSupervisorRequest`; `supervisor-schedule.mts` / `supervisorWakeups`; tick hook | Explicit durable outbox delivery/receipt distinct from approval; authenticated owned cancellation; production host binding outside locks, event coalescing and stop races | D0 and relevant D1–D3 paths; channel/target/activation approved; no automatic observe writes |
| D5 full-action installed acceptance and pilot | Original #243 audit/runbook and all advisory evidence | Public installed recovery, independent denial/approval, exact local correction, new proof and guarded delivery, notification uncertainty and real stop under races; separately authorized measured pilot | All D0–D4 capabilities and fresh permission; no test-only callback/host or no-op hook counts |

The advisory process watchdog does not satisfy D4's authenticated cross-process
cancellation service. Its project exclusion is not automatically a general mixed-
workload capacity lease. Its provider proof covers neither the fixed Large reviewer
nor existing implementation/recovery billing without separate evidence. Local
human visibility does not prove tracker delivery, acknowledgement or approval.

Keep [#231](https://github.com/markdlabrecque/factory/issues/231) open until the
owner explicitly accepts the remaining epic requirements or explicitly redefines
them. Do not close [#243](https://github.com/markdlabrecque/factory/issues/243) merely
because an advisory fixture passes. Record its revised acceptance scope and the
remaining original action blockers openly when filing the new work.

## 8. Converting this plan into actionable tickets

1. Refresh develop, this evidence register, epic/child/PR comments and all queued
   ready work. Verify PR #255's actual disposition; do not merge red checks or
   silently discard its audited negative cases. New work does not depend on that
   PR merely because it shares files.
2. Create an advisory-delivery Request Ticket under the epic, or explicitly amend
   [#243](https://github.com/markdlabrecque/factory/issues/243)'s acceptance scope
   with owner agreement. Do not rewrite old action acceptance as if it passed. Link this plan by committed path/revision.
3. Record approved boundaries, conservative defaults and T00's bounded uncertainty.
   Copy each work package's context, changes, test tier, footprint including docs,
   non-goals and measurable done conditions into its task body. Include only
   already committed APIs; prospective names are implementation targets.
4. File the hard dependencies in the table, with reasons and native blocked-by
   links where supported, then read them back. Parent-child membership is not a
   child-as-blocker link. No edge for file overlap alone; assign shared-file merge
   ownership explicitly. T00 and T07 are the initial independent candidates.
5. Keep dependent paid-runtime tickets blocked if T00 cannot establish its
   contract. Escalate the specific new primitive/risk/decision, not a generic
   request for credentials, another model or permission to weaken bounds.
6. Assign fixed planning models and estimates, preserve develop as integration
   base, and retain source/offline/no-production/no-credentials/no-paid limits in
   every ticket. No label, Factory dispatch, new agent thread, service install or
   live pilot is implied by producing this Markdown plan.
7. Report evidence by finish line. A reviewed research note is not a working
   adapter; a working adapter is not public installed acceptance; public offline
   acceptance is not semantic success or authorization to operate autonomously.
