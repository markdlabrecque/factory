# Project supervisor authority contracts

This is the authoritative reference for the project supervisor feature. The implemented foundation supplies **import-safe records, optional inert policy, read-only frozen snapshots, host-owned durable state, an explicitly invoked bounded proposal-only diagnosis worker and a source-only thin advisory host broker**. There is no scheduler wiring, action-mode switch, supervisor CLI, notification service, reviewer, gate applicator or pilot rollout here. Existing Factory gates remain unchanged. All actual contract, policy, snapshot, state, diagnosis and broker modules and the diagnosis prompt ship in the complete runtime inventory. Imports start no work; state persistence and diagnosis invocation are explicit. Paid launch remains held without demonstrated provider-enforceable ceilings, known pricing/accounting and host authorization.

A supervisor is a durable logical project responsibility, not a permanent model process. Host records, not memory or agent prose, own authorization. Observe is the starting mode. A future action mode needs explicit one-project pilot opt-in, finite project/global cost and capacity limits, cancellation fencing and host admission. Missing or unknown accounting holds paid calls. Diagnosis uses the configured family's fixed Mid role, at most two calls per unchanged incident and ten minutes per call, with one active decision per project. Independent gate review uses the separate fixed Large role, not automatic diagnosis escalation. No model/provider fallback or reviewer shopping is authorized.

## Configuration, model and paid-call foundation

[Project configuration](project-config.md#optional-supervisor-policy) defines optional `[supervisor]` policy. Omission/disabled policy is inert. Explicit finite cumulative project and diagnosis/review token, cost and call ceilings are required for opt-in; timeout can only lower the ten-minute bound. Two diagnoses per unchanged incident and one active decision per project remain fixed. This introduces no scheduler or actual model catalogue, and changes none of the existing implementation/analysis/verifier/recovery role mappings.

`model-policy.mts` fixes `supervisor` to Mid and `gateReview` to Large in the configured family, with Pi/high thinking and no exact-model/provider overrides, fallback or automatic escalation. Independent review is separately budgeted, not a diagnosis escalation. Model policy identity is version 2; old analysis/proof must be refreshed normally.

`supervisor-policy.mts:supervisorCallHold` is a pure necessary paid-call preflight. It refuses disabled/unregistered, stopped, unknown global admission, missing/invalid finite caps, unknown pricing/accounting, invalid worst-case reservations, exhausted project/role totals and active-decision/incident bounds. Observe may receive bounded **diagnosis proposals only**; review still requires act. Observe never grants action/reviewer admission. Inputs are host facts, not agent claims. Usage totals include settled usage **and all outstanding reservations**, with no implicit period or automatic reset. A successful preflight is not admission, proof or action authority. The downstream journal/admission owner must atomically check/reserve project and global budgets/capacity under a fence before spawn, enforce provider token/output and time ceilings, settle known usage, and hold new calls on any accounting failure. The preflight does not write state; the durable journal below provides the host-owned atomic storage boundary. The explicit diagnosis worker below connects configured preflight to the atomic journal reservation and a required trusted host process/accounting boundary. No shipped Pi adapter currently demonstrates provider-enforceable all-in ceilings; absent that capability paid launch remains held, rather than treating process termination or byte limits as a token/cost guarantee.

`context.mts` freezes supervisor/review additive instructions and their hashes alongside normalized policy and complete selected-runtime identity. Common then role inputs remain contained, additive guidelines; they cannot replace Factory constraints or original source bytes. See [frozen inputs](execution-context.md#supervisor-and-independent-review-inputs). No future worker/prompt asset is referenced until it exists; new actual assets enter the single complete inventory in the change that introduces them. Overrides must be complete and reviewed, never mixed with installed helpers.

**Activation remains blocked:** configured limits or an `act` observation cannot clear the unattended approved-channel/acknowledgement/authenticated-resumption blocker below, install a reviewer worker, atomically apply a correction, produce fresh verification, or clear a durable denial. No mode/restart/reviewer shopping removes denial; approval is never verifier PASS. The executable action set remains empty.

## Authority and gate inventory

The inventory below is bounded to the named source surfaces inspected for this increment. “Local alternative” means a proposal/evidence path, **not permission to disable a check**. Any proposal changing project gate expectations requires a new independent review with the original sources. A project-owned complete workflow is opaque code, not authority over the host. Unknown gate categories cannot execute.

| Gate / purpose | Source and decision owner | Project authority / safe local alternative | Nonwaivable Factory guarantee | Required fresh evidence |
| --- | --- | --- | --- | --- |
| Selection, eligible ticket, model tier | `orchestrator/project-config.mts`, `selection.mts`, `models.mts` | Owner configures selection and family; ticket declares tier. Correct additive instructions or draft a requirement question; no supervisor relabeling into eligibility | Excluded/human-held work is not made eligible by a model; fixed role/family policy, no escalation | Current validated config, complete child/parent input, model resolution, tracker eligibility |
| Project guidelines and workflow selection | `project-config.mts`, `context.mts`, `workflow.mts` | Contained additive Markdown; owner may supply an explicit complete reviewed workflow. A narrowly scoped instruction correction can be proposed | Runtime inventory/dependency identity, containment, host policy and current context; override does not waive host gates | Raw config, instruction bytes/hashes, source/dependency/template identities, complete-override review where applicable |
| Complete input and workspace readiness | `launch-readiness.mts`, `context.mts`, `ticket-input.mts` | Repair the actual missing source/access prerequisite under separate authority; no cached healthy substitution | Complete frozen ticket/parent sources, successful report publication, safe paths and branch/worktree noncollision; preserve saved work | Newly collected context and fresh filesystem observations, canonical identities and Git registrations, effective sandbox-user checks |
| Project verification command or acceptance evidence expectation | `verification.mts`, `handoff.mts`, project guidelines / `TESTING.md` | Propose an exact equivalent offline project command and explain equivalence. This can replace a project-owned command expectation, never the host verifier/proof schema | Independent verifier, immutable candidate, required artifacts, PASS only with actual supported evidence; review approval is not verifier PASS | Original gate/failure output, applicable guidelines, exact command substitution, independent review; new command evidence and normal verification after application |
| Verification proof freshness | `verification.mts`, `context.mts`, `handoff.mts` | Fix evidence or rerun required verification; no rewrite of historical baseline or old proof | Host-only proof outside agent mounts, original baseline, exact tip, frozen requirements/runtime/settings, confirmed cleanup | New proof on changed material inputs and current authorization at publication/push/merge |
| Prerequisites and conflicts | `handoff.mts` (`prerequisiteHold`), `dependencies.mts`, execution manifests | Correct original analysis or supply real satisfied-provider evidence, not a synthetic “satisfied” response | Unknown dependency holds; active work/conflicting footprints retain ownership; stale analysis cannot authorize | Current source/policy hashes, provider reads and live work/PR observations, renewed analysis |
| Readiness/image/setup gates | `launch-readiness.mts`, `capabilities.mts`, `handoff.mts` | Draft a project-local setup fix; do not pretend image or filesystem readiness | Exact image identity, actual-user access, browser preflight and owned teardown remain required | Real required capability/readiness observations at authorized launch time (not supplied by this offline investigation) |
| Jam confirmation and recovery admission | `cli/src/jam-detect.mts`, `recovery-run.mts`, `recovery-claim.mts` | Route a future repair proposal through the existing broker; ordinary local correction can remove the cause | Two-pass confirmation, fresh preparation/eligibility, bounded charged attempts, no budget renewal through agent activity | Current stopped run, generation, episode, complete preparation, saved-work ownership, capacity and attempt accounting |
| Shared claims, fencing, cleanup | `board/admission.mts`, `cli/src/recovery-run.mts`, `ownership.mts` | No automatic local waiver; preserve work and ask operator if ownership uncertain | Atomic ticket/project/capacity ownership, PID/start identity, exact-container settlement, no unsafe cleanup | Current claim/token/generation, receipt, process/container identity and confirmed cleanup |
| Delivery, CI and reviews | `handoff.mts`, `verification.mts`, tracker adapters | Project owner sets merge policy/required checks through normal config review. Supervisor may diagnose a gate but cannot fabricate CI, approvals or SHA evidence | Current host proof, immutable exact-SHA push and merge authorization, tracker-required checks/reviews, no admin bypass | Current tip/base/requirements/context, real checks/reviews, fresh before-merge authorization |
| Global off, project pause, cancellation, host authority | `cli/src/recovery-run.mts`, `jam-detect.mts`, `board/admission.mts` and scheduler callers | Operator may explicitly resume under existing controls; supervisor cannot self-resume | No late action after cancellation/off/unknown policy; settlement remains separate from permission to launch | Current host policy/fence and existing admission, not a saved snapshot or notification receipt |

### Initial supported proposal set

The closed category list in `supervisor-contract.mts` is:

1. `verification-command-substitution`: an exact before/after project-owned evidence command, targeted to a contained project document and one ticket/run. Equivalence must be demonstrated against the original behavior. No change to host proof requirements, CI/review enforcement, evidence integrity or semantic product requirements.
2. `additive-instruction-correction`: an exact correction to project-owned additive guidance, consistent with the original owner decisions and Factory constraints. It cannot replace a Factory prompt, alter product requirements or reclassify a protected host policy as project guidance.
3. `factory-policy`: a **classification for escalation only**, never a supported action.

These are schema-supported proposal categories, **not currently executable gate changes**. The initial executable supervisor action set is empty. There is no generic bypass, permanent waiver, project-wide gate effect or unknown-category fallback. Path validation is lexical; future host application must enforce physical containment, ownership, current authorization, allowed target semantics and exact preimage. Structural validators cannot prove semantic equivalence or distinguish a disguised host-policy bypass; the independent reviewer and host must both reject it. Any unresolved authority question goes to a human, not an expanded supported set.

## Public contracts and material identity

`orchestrator/supervisor-contract.mts` exports version 1 records and strict validators. Every record rejects unknown/missing fields and unknown versions/states. Strings, arrays, source bundles and substitution sizes are bounded. All validators throw on invalid shapes; `reviewOutcome` converts invalid input to a held result. They do not read files, processes, tracker state, credentials or clocks.

| Record | Meaning / ownership |
| --- | --- |
| `ProjectIdentity`, `Scope` | Canonical absolute checkout root plus tracker kind/host/project. Host verifies physical canonicality; schema checks lexical shape. Hosts are lowercase, no URL; GitHub owner/repo is lowercase, no `.git`; GitLab subgroup paths retain tracker spelling. Ticket scope has one positive ticket number; project scope has none. These do not reuse Board's lossy display key as authority. |
| `Snapshot` | Host-supplied observed inputs: scope, mode, time, run/base/baseline/tip, runtime/dependencies, policy, settings, ticket-input hash, admission generation; original sources; separate explicit project guidelines and nonwaivable Factory constraints. It is observation, not permission. |
| `Incident` | One bounded progress/problem episode, snapshot identity, reason and lifecycle, with at most two diagnosis calls for unchanged inputs. A ticket incident and a project/environment incident are distinct. State persistence/budgets/fencing are specified in the durable-state section below. |
| `Proposal`, `GateChange` | Exact substitution plus rationale, alternatives, risks, incident, snapshot identity and project/scope. Effect owns exactly one ticket/run and has an explicit expiry. Proposal ID is the canonical SHA-256 of the entire proposal except `id`. Changes require a new ID and review, never mutation of an approved record. |
| `ReviewInput` | Entire snapshot and exact proposal. Original child, immediate-parent context, human planning, project guidelines, Factory rules, gate/failure evidence and prior decisions are required source roles. Include full relevant human/parent comments in order, not just summaries. `missing` and `truncated` are explicit nonapprovable states. `not-applicable` is allowed only for genuinely absent parent/human-planning/prior-decisions roles; host collection must establish that absence. |
| `IndependentReview` | Audit of one host-assigned fresh invocation: reviewer/model/invocation identities, start/completion, exact input hash/proposal ID, approve/deny/inconclusive and reason. Agent output alone cannot establish provenance. Timeout, parser failure, missing context or uncertain output holds; none means approval. |
| `Intent` | Proposed exact operation carrying incident/proposal/review/input/run identity, host fence and expiry. `authorized` is a persisted host decision, never something validated shape or an agent can grant. Atomic admission and application belong downstream. |
| `HumanRequest` | Typed actionable host escalation/outbox record with incident, ticket or project scope, question, original evidence references, next operator action, required stop and notification delivery state. For diagnosis-only requests the existing `proposalId` correlation field binds the retained diagnostic ID instead of a gate proposal ID; neither conveys approval or delivery. |
| `HostOutcome` | Held, review-approved, or human-required. **There is no apply/deliver outcome** in this contract layer. Review-approved only means the supplied review passes structural/freshness policy. |

`supervisorHash` uses sorted object keys and ordered arrays; `sourceHash` hashes exact UTF-8 source text. No text normalization, age-only approval or string display key grants authority. Source text is bounded to 256 Ki characters per source and 2 MiB total bytes, at most 128 sources. Collection must explicitly mark overflow instead of silently truncating; if original relevant context exceeds bounds, hold and escalate for an authorized collection design rather than summarize it into approval. Source locators must point to retained original bytes, not secrets or untrusted writable host authority.

`reviewOutcome` requires identical current review-input hash and exact proposal ID, project/scope/run bindings, act mode, unexpired effect, host-matching fresh invocation/reviewer/fixed-role model and completed review on/after the snapshot. It requires all source roles and complete material context. The host supplies fresh provenance and its durable denial latch; passing `denied: false` is not permission to clear a stored denial. A new model output is not evidence that original context was complete.

### Invalidation, denial and resumption

Any material change to child/parent/human context, guidelines, Factory policy, gate/failure evidence, exact diff, risks/alternatives, prior decisions, project/ticket, run/base/baseline/tip, runtime/dependencies/settings or admission generation invalidates the input hash. Observe/stop, off/pause, expired effect, superseding incident or lost ownership fences any later application even if a review was previously approved. A corrected gate requires new analysis/proof wherever its inputs changed; approval is never a verification PASS. Consumption/expiry must prevent reuse on unrelated tickets or subsequent runs. Atomic consumption is not implemented here.

A denial latches the incident into human-required and requests `FlagAHuman` semantics. Never automatically launch another reviewer to override it. Changed inputs do not silently remove the denial. Operator resumption must be an authenticated, durable decision identifying actor, denied proposal/review, reason and permitted next action. It may abandon the proposal or authorize a revised proposal with a new fresh review; it cannot convert denial to approval, reuse old proof or waive Factory constraints. The state/action increments must implement that audit/fence before action can ship.

Ticket-only evidence/expectation failure stops that ticket's proposed action. Project/runtime/config/ownership ambiguity and required Factory-wide changes stop new supervisor decisions/actions for the project. Existing execution owners retain their work and settlement responsibilities; an escalation is not permission to kill them, reset budgets, delete saved work or rewrite evidence. Notification never resumes anything.

## Fresh reviewer investigation: supported boundary and limits

Inspected source:

- `models.mts:piAnalysisArgs` constructs a new print-mode Pi invocation with `--no-session`, no resume/continue/session selectors, `--tools read,grep,find,ls`, `--no-extensions`, `--no-skills` and `--no-context-files`. Only the configured subscription provider may be loaded explicitly with `-e`. The same argument builder accepts the family's fixed Large model for a future reviewer; diagnosis continues to use Mid.
- `analyze.mts:runPi` uses a new `spawnSync("pi", args, {cwd,input,...})` each time with complete frozen prompt on stdin, bounded timeout/output. This is an existing host CLI boundary, not an invented Sandcastle reviewer API. Its analysis JSON extractor is not a strict review parser and must not be reused as approval parsing without strict validation.
- `main.mts` uses Sandcastle `pi` and `sandbox.run` for implementation; `handoff.mts:runVerifier` uses a separate verifier invocation and checks candidate immutability. Neither proves fresh supervisor review sessions or exposes `FlagAHuman`.

Offline evidence: `supervisor-contract.test.mts` exercises the existing `piAnalysisArgs` with both fixed Large family models across two new local Node recorder processes. It verifies frozen stdin bytes, exact allowlisted argv, separate process identities, no session/resume selectors and no human tool in the allowlist. `models.test.mts` already covers provider-extension selection and unavailable-extension refusal. These tests prove **Factory argument construction and a local process boundary**, not live Pi behavior, provider isolation, a semantic independent review or any SDK feature. No paid model, real Pi, authentication or container is used.

**Reviewer prerequisite:** the downstream review worker must connect this existing fresh host invocation pattern to complete retained review input, strict bounded output parsing, fixed Large policy, durable invocation/denial audit, enforced budgets/capacity, read-only isolated workspace and cancellation. It must prove those with offline adapters before action is enabled. A separate process alone is not sufficient independence if it reloads proposer history or has mutation tools. No reviewer worker is installed by this ticket.

## Unattended FlagAHuman investigation and concrete blocker

**Unavailable primitive:** the inspected Factory runtime has no registered `FlagAHuman` tool or unattended host notification/acknowledgement adapter. `piAnalysisArgs` explicitly disables discovered extensions and allows only filesystem readers. `analyze.mts` provides no MCP/tool bridge. `main.mts` and existing needs-human labels/stages/logs do not call this interactive harness's tool. The interactive T3/Pi session's available `FlagAHuman` is not inherited by Factory agents. No unsupported SDK registration or fictitious notification API is claimed.

The proposed host boundary is `HumanRequest` plus the following required semantics, **not an implemented bridge**:

1. On denial, required Factory-wide change, unavailable primitive or unresolved authority, durably fence the affected ticket/project's new supervisor work and persist an immutable actionable request **before** external notification. Include exact review/proposal IDs, bounded findings, original evidence locations, the human question and next action. Preserve all existing saved work and owners.
2. Retain `delivery.state = pending` and attempts on failure/crash. A log message, Board badge, issue label, successful local write or agent statement is not delivery. A future outbox writer must use host-owned atomic durable publication outside agent mounts; outbox loss/corruption holds action. Contract tests validate the record; the durable-state foundation below persists pending requests but does not deliver them.
3. Deliver to an explicitly operator-approved unattended channel with a stable request idempotency key. Record `notified` only after an actual adapter acknowledgement/receipt, channel and time. Notification errors remain pending and stopped; bounded redelivery must not restart work or spend agent/recovery budgets. Notification acceptance and human resolution are separate events.
4. An authenticated operator resolves/resumes explicitly with retained audit and fresh gates. No automatic reviewer shopping, model escalation, Factory-wide edit, global rollout or authority renewal follows notification.

**Blocking prerequisite for dependent action work:** before gate review/application/action activation, implement and independently verify a real host escalation/outbox + approved unattended notification adapter + fail-closed stop/resumption integration. The owner/operator must choose/approve the actual channel and its acknowledgement/authentication contract; this investigation does not authorize a new service, credential, installation or Factory-wide policy change. The downstream review task must either deliver that approved source-only bridge with offline failure/crash/duplicate/stop fixtures, or remain held and call the available human escalation surface. The application/lifecycle/pilot tasks cannot treat merging this investigation as proof of delivery. Until that prerequisite and the reviewer worker evidence above are satisfied, the executable action set remains empty.

This finding does not block source-only contracts, state, snapshot or configuration work that preserves observe-only/inert defaults. It **does** block dependent action activation. No live pilot, paid runtime probe, service/registry mutation, production access or secret retrieval was performed.

## Durable supervisor state and accounting

`cli/src/supervisor-state.mts` is a bookkeeping API, not a worker, mode switch,
notification bridge, admission replacement or action authorizer. Nothing calls it
from the scheduler or enables paid work. A persisted proposal, review or intent
never authorizes a run, gate edit, proof, push, merge or recovery attempt. Existing
run/receipt/proof/delivery/recovery stores and saved evidence are not modified.

### Host journal and short transitions

The caller supplies the same **host-owned state directory**, outside project and
agent mounts, used for admission/recovery. `<state>/supervisor/state.json` is a
version-1 host journal with project-scoped records keyed by the SHA-256 of the
canonical project root. Each record repeats the shared `ProjectIdentity` (root
and tracker); a changed tracker at an existing root holds rather than adopting
old authority. This single journal is intentional: one atomic replacement
commits project accounting and shared capacity together, without a cross-file
charge/claim crash gap. Project identity must be physically canonicalized by the
host, as for the shared contract; this API validates lexical canonicality only.

`readSupervisor` is read-only: only missing storage means empty. Malformed JSON,
unknown versions/fields, foreign identity, invalid PID/start owners, inconsistent
charges/counters and I/O uncertainty throw without overwriting anything. An
unrelated valid project can coexist in the journal; an invalid project record
holds the entire journal. No automatic migration, deletion or reset is offered.

`commitSupervisor(stateDir, project, expectedRevision, event)` uses the existing
admission PID/start-identity lock and durable writer, in a **separate supervisor
lock namespace**. Contention fails immediately; callers must reread rather than
spin inside a scheduler lock. The revision CAS is checked under that short lock.
The only effect under it is a synchronous journal transition and 0600 temporary
file + fsync + rename publication (0700 directories, directory fsync where
supported by the existing writer). There are no agents, tracker reads or other
asynchronous effects under this lock. Dead lock holders may be reclaimed by
PID/start identity, never age; unreadable or unknown lock ownership holds.

The pure `transitionSupervisor` takes injected process observations. Active worker
and pending-intent ownership uncertainty blocks new transitions. Reservation
completion requires the exact recorded PID/start, fence, active reservation and
unexpired deadline. PID reuse or a stale fence cannot settle another worker.
Dead workers become `ambiguous` only through an explicit observation. Their
charges and capacity stay held; this increment has no authority to release them,
refund them or launch a replacement. Future settlement needs authoritative
resource/worker observations, not a timeout-based assumption of safety.

### Incidents, idempotency, decisions and inert intents

Stable incident identity hashes the shared project/scope plus relevant requirement,
gate, run and failure fact identities. These are explicit host-collected inputs,
not supervisor prose, timestamps, unrelated queue activity or unrelated base
movement. Snapshot hashes remain attached original context references; changing
an observation's prose/time does not change the incident, renew budgets or rewrite
its original snapshot. Snapshot collection and deciding which changed facts are
relevant belong to the snapshot/worker layers, not this store.

Changed relevant facts create a new incident and mark prior incidents in that
scope superseded; returning to old facts never resurrects the old incident.
All old incidents, exact proposals, independent-review audits, pending human
requests and intent observations remain retained. Denials and Factory-wide
classifications hold subsequent new decisions conservatively at project scope,
including after a material change. There is no resume/clear-denial API. A future
authenticated operator integration must retain its own explicit audit and fresh
authority; notification alone can never clear a hold.

Each event has a stable host idempotency ID and exact canonical payload digest.
Exact replay is a no-op, including after restart or display-history eviction;
reusing an ID with different bytes holds. Repeated observations with different
event IDs still reuse the stable incident. One pending `HumanRequest` is kept per
incident; rephrasing cannot replace it, notify it, resume it or request another
reviewer. The state module accepts no invented notification receipt.

Only **proposed/inert** shared `Intent` records may be inserted. Intent IDs cannot
be reused. The durable commit must precede any future separately authorized side
effect; this module has no effect callback or authorize/apply operation. A dead
owner's ambiguous intent can only be reconciled by recording explicit retained
observation references (`observed-applied`, `observed-not-applied`, or `unknown`).
Even observed-applied leaves the shared intent `proposed`: it is audit, not host
application authority. Reconciliation never executes or retries the effect;
observed-not-applied is not permission to replay it. Existing admission, exact
preimages, containment, current fences and fresh proof remain downstream gates.

### Resource reservations and retained accounting

Before a future worker launch, the host must commit a reservation with a stable
invocation identity, PID/start owner, fence, finite token/cost upper bound and
explicit deadline. Diagnosis defaults are enforced at **two reservations per
unchanged incident and at most 600,000 ms per call**. Independent reviews have
separate counters and require an explicit finite call limit and timeout. There
is one unsettled decision per project; ambiguous workers also block replacement.
Each review reservation binds exactly one invocation ID (the reservation ID)
and one retained review result; another distinct result cannot reuse its charge.
A fenced result for an already-superseded incident is still retained, and a denial
still latches the project hold. An actual reviewer result is audit only; the store does not prove independent
context, fixed Large role, provenance, semantic approval or applicability.

Reservations check finite positive project and shared token/cost ceilings and
shared capacity against **all journal projects under the same lock**. Costs use
host-selected integer accounting units (for example micro-units of currency),
not floating point estimates. Missing/unknown/zero paid bounds hold. Counters
charge the full upper bound before work; actual usage is recorded separately
within that bound, with **no refund** for short, failed, denied, interrupted or
inconclusive work. Diagnosis and review usage never touches recovery attempts.
A future worker must enforce its reserved token/cost/deadline at its provider
boundary; a state reservation alone is not evidence that a paid call is safe or
authorization to launch it. Validated limits/role configuration and real worker
cancellation remain owned by their downstream layers. No model/provider fallback
or budget renewal exists in this module.

Only the last 100 display events are retained in `history`. Incident counters,
charged reservations, event-deduplication IDs, denials, proposals, reviews, human
requests and intents are **not** truncated with display history. Storage growth
is deliberate; there is no unsafe compaction or reset/refund path here. A future
retention design must preserve every safety index and charge before removing
original records. Supervisor activity never renews recovery budgets or rewrites
saved work.

This state foundation does **not** discharge the approved-channel/acknowledgement/
authentication decision for unattended FlagAHuman, the fresh read-only fixed-Large
review worker evidence, or atomic contained/preimage/fenced application with new
proof. All remain prerequisites for action activation. Defaults remain inert;
there is no automatic supervisor loop or pilot opt-in. Explicit diagnosis is described below.

## Read-only work snapshots and progress

`cli/src/supervisor-facts.mts` exports `projectSupervisorFacts`, a pure bounded
projection, and the separate explicit original-input/review-snapshot helpers.
The projection asset ships in the complete selected runtime, including complete
project overrides. `cli/src/supervisor-facts-host.mts` is the CLI-side local reader;
it is not a selected-workflow entrypoint and enables no scheduler/CLI action.
There is no implicit observation loop or tracker refresh. Omitted authorization,
selection, runtime or readiness inputs remain unknown and inert.

The facts envelope uses the shared `ProjectIdentity` and `Scope` and retains source
provenance. It is deliberately **not** an approvable `Snapshot`: the shared review
schema requires concrete material identities, which cannot be fabricated for
missing sources. `supervisorReviewSnapshot` constructs that shared schema only
from explicit material and original `Source` records, always in observe mode.
Validation does not establish host provenance or permission.

Each source records saved versus live origin, original observation time (local
file mtime for disk records), and a canonical SHA-256 of the observed JSON value.
This hash identifies the observation, not necessarily raw file bytes, proof
freshness or current tracker truth. Combined claim/process observations are live
and time-stamped with the injected host clock; saved delivery/assessment/readiness
keep their own times. Missing records differ from unreadable, corrupt, oversized
or otherwise unknown records. Unknown input cannot manufacture readiness,
selection, merge progress or authorization. `launchAuthorized` is always false;
even ready assessment/readiness is not admission authority.

The host adapter reads bounded local run, admission, recovery, assessment and
graph records. It uses `recoverySummary` and pure `projectFollowups` for existing
attempt/preparation/budget/follow-up semantics, with injected owner observations.
It does not use permissive run readers that silently drop corrupt records or
perform crash reconciliation. Graph conflicts reuse the existing path-overlap
rules; assessment dependencies remain saved three-state observations, not a new
provider read. Predicted conflicts are not claims. The host supplies current
selection, global/project authorization, runtime identity and saved readiness;
the adapter does not execute project configuration or instruction modules.

Status includes outstanding selected/run/claim/assessment/graph/budget tickets,
stages, owner certainty, branch/evidence/proof references, attempt log/report
references, preparation holds, dependency/conflict records, CI/delivery waits and
confirmed merge progress. No log bodies are read. Classification distinguishes
incomplete/stopped work, temporary waits, delivery waits, structured gate disputes,
exhaustion, human holds, active owners and uncertainty. Open PR/CI waits take
precedence over repair-budget exhaustion; they are not a recovery jam. A failed
check/operator delivery checkpoint remains a human hold. Only a host run's
`mergedAt` or a valid execution-bound merged delivery checkpoint confirms merge;
a done stage, closed issue, PASS verdict or model claim does not. A saved merge
observation is not a fresh before-merge authorization. Same-execution continuation
is neither required nor implemented here; existing delivery records are preserved.

Projection limits are 128 tickets/items per source, 2 MiB per host JSON file and
512 characters per excerpt. Oversized source collections become unknown, not a
silently complete partial list. A bounded union reports omitted tickets. Status
omits arbitrary notes, requirements, setup/instruction/environment bodies and
credentials. Safe opaque references retain original paths or HTTPS locations;
URL credentials/query/fragment and secret-like paths are removed. Excerpts redact
common credential assignments/tokens/private keys. Redaction is defense in depth,
not proof arbitrary prose is secret-free: never feed secret bodies to status.
Source values are not copied wholesale into the output.

### Original context is a separate collection path

`collectSupervisorTicketInput` calls the existing host-owned `freezeTicketInput`
collector explicitly, never during status. The supplied tracker source must be
read-only. It exhaustively retains child and immediate-parent requirements and
ordered comments, coverage/provenance and exact rendered input/hash. It also
returns separate child, parent and human-planning `Source` records with complete
original bodies, not supervisor summaries. Established absent parent/comments
are `not-applicable`; partial reads throw the existing ticket-input hold. The
shared review bounds (256 Ki characters/source, 2 MiB total) are checked without
silent truncation. Overflow holds for an authorized collection design; no
summarized substitute approves review. Callers must retain originals separately
and supply guidelines, Factory rules, exact gate/failure and prior decisions for
future independent review. Status never contains this original-context bundle.

Repeated local observation performs no tracker mutation, report publication,
refresh, settlement, cleanup, admission, model call, budget charge/reset or
project/run write. Observation cannot acknowledge a human request, discharge the
missing notification bridge, prove reviewer provenance or authorize application.
All downstream action prerequisites above remain in force.

Focused offline evidence:

```sh
node --test cli/test/supervisor-facts.test.mts cli/test/recovery-followup.test.mts cli/test/recovery-command.test.mts cli/test/runtime-bundle.test.mts
```

Unit matrices cover waits, stopped/dirty-work preservation, saved merge truth,
failed/pending CI, unknown ownership/authorization, source failures, original
parent/human context and redaction. One disposable filesystem boundary compares
all fixture bytes/mtimes across repeated host reads. The existing runtime-bundle
boundary imports the actual selected snapshot asset. No live tracker, Docker,
paid agent, secret store or installed project is used.

## Bounded diagnosis and retained memory

`orchestrator/supervisor.mts` supplies pure context composition and strict proposal parsing;
`prompt.supervisor.md` is the Factory-owned proposal-only prompt.
`cli/src/supervisor-worker.mts:diagnoseProject` is an explicit, short-lived host call,
not a resident model session or a second provider stack. These actual assets join
the complete selected runtime. Complete project overrides must include them; no
absent future reviewer/bridge/application asset is imported. Scheduler wakeups and
operator commands are not implemented by diagnosis.

### Input, output and unchanged decisions

The host provides a frozen shared `Snapshot` containing the original requirements,
ordered human/parent context, guidelines, Factory rules, gate/failure evidence and
original references, plus committed incident `Facts`. Scope and run must match.
The worker does not collect tracker data, read arbitrary project files, run shell
tools or retrieve credentials. The separate read-only collector remains responsible
for complete original sources. Missing/truncated context is explicit, not approval.

Diagnosis receives the last eight retained diagnostic summaries (ordered by
completion time and ID), original references, and an explicit omitted count.
Summaries supplement the full original snapshot; they never replace it. The memory
index itself is bounded at 10,000 diagnoses per project; exceeding that bound holds
new calls pending a safe retention design, not silent safety-index compaction.
The host retains the complete frozen prompt/snapshot separately at
`<state>/supervisor/<project-root-hash>/<invocation-hash>/input.json`, process-group
ownership in `process.json`, and bounded output/rationale in `result.json` and the
journal. These are host-owned diagnostic records, not authority mounted into agents.
No saved work, run/recovery receipt, proof or historical evidence is rewritten.

A strict version-1 `DiagnosisDecision` distinguishes **problem**, **evidence-mechanism**
and **expectation**, with rationale and lawful alternatives. Its closed action union is:

- wait or observe with the specific condition/evidence needed;
- request consideration by the existing repair broker for exactly this ticket/run;
- an exact shared project `Proposal` for one supported gate category, with complete
  before/after, scope, expiry, alternatives and risks; Factory-wide classification
  must instead escalate;
- a bounded scoped follow-up draft pending human approval, never a ready ticket;
- an actionable escalation question and next operator step.

JSON must be the entire stdout value, at most 192 KiB; stderr retains at most 8 KiB.
Unknown/missing fields, unknown actions, code fences, malformed output, mismatched
scope/run, protected gate category, expired substitution and stale basis hold.
There is no approve/apply/execute/deliver output. Structural validation cannot prove
semantic equivalence or authorize a proposed gate correction. The future fresh
independent reviewer/host must reject disguised policy bypasses.

The decision basis hashes every snapshot field **except observation time**. Original
source bytes/references/statuses, policy, mode, material identities and guidelines
remain material. A known unchanged valid decision, especially an external wait,
is reused after restart without another model reservation/call. Reuse rereads only
its exact owned retained input file (no symlink, finite 32 MiB envelope), validates
the original snapshot hash and unchanged material basis, and holds if originals
are missing/corrupt/changed. An exact gate proposal still binds the full original
snapshot hash and current-time expiry; a later timestamp does not rebind or approve it. Changes never reset stable incident counters.
Unresolved exhaustion of the two-call incident allowance retains an actionable
pending human request correlated to the last retained diagnosis.

### Reservation, Pi process boundary and failure

Callers must release scheduler/admission locks before invoking the worker and
supply current host authorization, finite shared token/cost/capacity ceilings,
validated project policy and the configured family. The journal directory must be
host-owned, physically outside project/agent mounts (the worker additionally checks
lexical separation); physical ownership/canonicality is the host caller's contract.
Unknown/off/paused/stopped/unregistered state or retained denial/human hold stops
new diagnosis. Observe permits proposal-only diagnosis, never review/repair/action
or tracker posting. Nothing here clears the separate action-bridge blocker.

Before spawn the worker applies `supervisorCallHold` to actual journal totals
(including every reservation, with no refunds), then commits a per-project
PID/start/fence reservation through the shared journal CAS/lock. That commit checks
finite project and **host-wide** budgets/capacity atomically. Costs use integer
micro-USD; configured USD caps round down, never up. Role/project call limits and
role token/cost limits are checked against the same project revision; a competing
transition invalidates CAS. Frozen input publication precedes reservation/spawn.
The controller owns the reservation; detached child group identity is retained
before output handling. After controller death the active charge/capacity stays
held; restart never infers cleanup or launches a replacement.

The trusted `DiagnosisBoundary` must actually enforce the reserved **all-in**
input/output/provider token and cost ceilings, including after controller failure,
and supply known final accounting. Its fixed model must match the configured
family's Mid role. It may launch only the supplied new `pi` print invocation,
using the established `piAnalysisArgs` with `--no-session`, explicit configured
subscription extension only, no discovery, no fallback/escalation, and the **stricter
`--no-tools`** restriction. All original input is supplied on stdin, so arbitrary
host filesystem readers are unnecessary and forbidden. No credential lookup or
new provider implementation is added.

**Current paid-runtime prerequisite:** the established Pi analysis CLI does not
provide demonstrated all-in token/cost enforcement/accounting merely through its
existing timeout and `maxBuffer`. There is deliberately no default `spawn(pi)`
that pretends otherwise. Without a trusted enforcement/accounting adapter for the
exact fixed model, or with unknown pricing/usage, the worker returns held before
reservation/spawn. Offline injected process adapters prove Factory orchestration,
not real provider enforcement. A separately evidenced adapter is required before
any paid diagnosis activation; no live paid probe is authorized by this source
change. This is distinct from the unresolved human notification/action bridge.

The worker rechecks current authorization/material inputs before spawn and again
before accepting output. The injected/host deadline is finite (configured lower
bound of at most ten minutes). Cancellation, timeout, output overflow and process
exit/error terminate only the owned process group through the bounded host adapter;
cleanup must be confirmed even after normal exit, because descendants can retain
pipes. Normal exit starts cleanup but is not stdout completion: bounded output is
collected through process `close`, still under the original deadline. Unknown cleanup or final usage makes the reservation ambiguous and retains
its charge/capacity. Confirmed known usage may settle a failed/late call but never
refunds the reserved ceiling or makes it successful. Stale/malformed/failed/cancelled/
timed-out results retain diagnostics with no usable decision. Completion requires
exact reservation/fence/controller identity; a late/superseded/held result cannot
be published as a proposal. Raw diagnostic sidecars remain even on a journal CAS
failure, while the charge remains conservatively held.

One journal transition atomically publishes completion with the exact gate
proposal, or with the required actionable `HumanRequest`, evidence paths,
`delivery = pending` and required stop. There is no completion-to-human-stop crash
gap. Gate proposals bind their retained diagnosis snapshot, not an incident's first
observation; the incident's original snapshot and call counters remain unchanged.
Failures and explicit escalations cannot be retained as reusable success without
their human stop. Notification is **not**
delivered by logs, local writes, sidecars or this return value. No adapter
acknowledgement, authenticated resumption or denial clearing is invented. The
unattended approved-channel/acknowledgement/authentication blocker remains. Review,
application, recovery admission, labels, budgets, exact-SHA delivery and pilot work
remain separately owned and unenabled.

Focused evidence uses pure proposal/context/state tests and one disposable
stubbed process-adapter boundary, with injected clocks/deadlines and no sleeps:

```sh
node --test orchestrator/supervisor.test.mts orchestrator/supervisor-policy.test.mts cli/test/supervisor-worker.test.mts cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

The boundary proves reserve-before-spawn, fixed Mid argv/no tools, shared capacity,
project fence, cancel/timeout/stale/malformed/failure/unknown accounting holds,
retained input/output, observe-only gate proposal persistence and restart reuse.
The existing complete-runtime fixture imports the actual flat worker and prompt.
These tests run no Pi, provider, reviewer, repair, tracker, service, Docker,
credential operation or pilot.

## Thin host action broker

`cli/src/supervisor-policy.mts:brokerSupervisor` is a pure typed host broker over a
retained successful diagnosis, its current material snapshot, durable incident/
denial journal and explicit current host authorization. It does not accept model
claims as host records. It returns wait, held/refused, a human-approval-only draft,
an actionable pending `HumanRequest`, or an **advisory** exact ticket/execution
candidate. Gate amendments are refused here: only the separately reviewed apply
module may consider them. No gate edits, tracker writes, labels, ticket creation,
new dispatch, continuation, proof override or recovery-budget reset exists here.
Draft requirements/labels/dependencies remain draft text requiring human approval.

This is source-only integration, not activation or a new scheduler. The optional
`afterPass.supervisor` host hook is reached only inside the existing successful-pass,
two-pass confirmed jam scan, after current stopped-run, budget, workflow and local
ownership screening. A production caller does not supply it yet. Omission preserves
existing automation, as must a disabled/observe/stopped caller (return no candidate;
do not install an effecting hook). The broker itself holds those modes without
writes. The host hook may narrow action-mode admission, never expand it. It must
record host outcomes durably and separately from the model diagnosis; a failed
record operation stops the scan. For a human-required result the caller must commit
the existing journal `human` event/required stop before any bridge notification.
Returning a request or recording a local outcome is **not** notification delivery.
There is no built-in bridge adapter or fabricated receipt. Missing trusted bridge
and explicit action-activation authority hold repair candidates, pending and stopped.
No uncommitted reviewer/notification/application interface is imported.

A candidate uses the same `prepareRecovery`, `launchRecovery`, `claimRecovery` and
Board admission owner as automatic repair. Fresh execution analysis, original input,
workspace/image readiness, saved ownership, current project/scheduler authorization,
activity generation, capacity, project recovery exclusion and bounded charged
attempts remain authoritative. Its exact execution ID must match the host run.
The candidate's synchronous host callback rechecks its exact facts/fence and clock
after asynchronous preparation/readiness and again inside atomic admission. Late
pause/off/unknown/stale/cancellation cannot turn old advice into authority.

The existing admission record optionally retains `recovery[project].candidates`,
a SHA-256 candidate-ID to attempt-UUID safety index. It is consumed in the **same**
atomic replacement as the existing claim and charge; replay after crash/settlement
cannot spend a second attempt for that candidate. No separate recovery truth store,
refund or automatic retention/reset exists. Automatic and advisory races use the
same project exclusion and charge. The broker also requires authoritative existing
attempt observations; a repair charged since that diagnosis (including automatic
repair) holds replay instead of silently proposing the next attempt. Because the
committed diagnosis contract has no atomically retained recovery-admission baseline
and attempt start times precede asynchronous readiness/admission, this broker
conservatively holds **any prior charged attempt for that ticket**, even one older
than diagnosis. It does not infer a supervisor retry right from timestamps or a
new diagnosis. Existing automatic recovery without a supervisor candidate hook
retains its remaining-attempt policy. The host must supply the actual `RecoveryState`,
not a status projection. Unknown accounting, root mismatch or incomplete retained
sequence history (including normal history truncation) holds; bounded history is
never proof that no prior charge exists. Charged current ticket budgets also hold. A genuinely new diagnosis still cannot renew recovery
budgets or bypass jam confirmation.

Waiting CI returns wait and remains on existing delivery follow-through; it does
not start a model, analysis or repair budget through this broker. Failed CI may
produce a scoped human-approval draft or eligible existing stopped-run repair.
An open PR is never branch modification/delivery authority. Existing exact-SHA
proof, before-merge authorization, saved evidence and owners remain untouched.
Same-execution continuation is separate; this adds no retry/reset/exclusion removal.

The flat selected runtime ships this actual asset as `supervisor-broker.mts`,
distinct from `orchestrator/supervisor-policy.mts` (the paid-call preflight) which
continues to ship as `supervisor-policy.mts`. Both import safely; no absent future
asset is referenced. A later complete-runtime publication is operator work, not
part of source delivery. Paid diagnosis remains held without demonstrated provider-
enforced all-in ceilings and known pricing/accounting. Notification/reviewer/apply/
lifecycle evidence and explicit one-project pilot approval remain activation
prerequisites; offline authorized facts do not discharge them.

Focused unit policy matrices and the extended existing disposable afterPass race
fixture prove host allow/hold/refuse/draft identity and at most one attempt/charge,
with paused/active/unknown/exhausted/CI-wait no-launch cases. Fixtures use injected
clocks/process/container/tracker boundaries, not live models or notification:

```sh
node --test cli/test/supervisor-policy.test.mts cli/test/jam-detect.test.mts cli/test/recovery-claim.test.mts cli/test/recovery-run.test.mts cli/test/runtime-bundle.test.mts
```

## Reproduce offline evidence

```sh
node --test orchestrator/supervisor-contract.test.mts orchestrator/supervisor-policy.test.mts orchestrator/project-config.test.mts orchestrator/context.test.mts orchestrator/instructions.test.mts orchestrator/models.test.mts orchestrator/workflow.test.mts
node --test cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

Policy and schema matrices are unit tests; one minimal local Node process fixture tests argv/stdin. There is no browser E2E or notification E2E because no notification implementation exists. Run all commit-tier shards and the separate browser lifecycle command in [TESTING.md](../TESTING.md) before delivery. Passing offline tests does not constitute a pilot or prove an unavailable SDK primitive.
