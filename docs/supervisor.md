# Project supervisor authority contracts

This is the authoritative reference for the project supervisor feature. The implemented foundation supplies **import-safe records, validation, a bounded authority investigation and host-owned durable state**, not a running supervisor. There is no new worker, configuration switch, CLI, notification service, gate applicator or pilot rollout here. Existing Factory gates remain unchanged. The contract and state modules ship in the complete runtime inventory. The contract performs no I/O; state persistence is explicit and importing the state module starts no work.

A supervisor is a durable logical project responsibility, not a permanent model process. Host records, not memory or agent prose, own authorization. Observe is the starting mode. A future action mode needs explicit one-project pilot opt-in, finite project/global cost and capacity limits, cancellation fencing and host admission. Missing or unknown accounting holds paid calls. Diagnosis uses the configured family's fixed Mid role, at most two calls per unchanged incident and ten minutes per call, with one active decision per project. Independent gate review uses the separate fixed Large role, not automatic diagnosis escalation. No model/provider fallback or reviewer shopping is authorized.

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
| `HumanRequest` | Typed actionable host escalation/outbox record with incident/proposal, ticket or project scope, question, original evidence references, next operator action, required stop and notification delivery state. |
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
there is no running supervisor or pilot opt-in in this change.

## Reproduce offline evidence

```sh
node --test orchestrator/supervisor-contract.test.mts orchestrator/models.test.mts
node --test cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

Policy and schema matrices are unit tests; one minimal local Node process fixture tests argv/stdin. There is no browser E2E or notification E2E because no notification implementation exists. Run all commit-tier shards and the separate browser lifecycle command in [TESTING.md](../TESTING.md) before delivery. Passing offline tests does not constitute a pilot or prove an unavailable SDK primitive.
