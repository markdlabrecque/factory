# Project supervisor authority contracts

This is the authoritative reference for the project supervisor feature. The implementation supplies **import-safe records, optional inert policy, read-only frozen snapshots, host-owned durable state, explicit bounded diagnosis and independent review workers, a durable host tracker-comment outbox with exact local resolution, a source-only thin advisory host broker and exact scoped gate-input application**. The scheduler has a short hint hook and an explicit outside-lock source lifecycle transport, but no live action activation adapter, notification service or pilot rollout. The CLI supplies read-only inspection and audited per-project mode/stop fences, refusing unsupported act activation. The explicit gate applicator below publishes only one exact scoped verification-guidance input artifact; it never edits project files or branches. `factory supervisor resolve` is a local audit control, not activation. Existing Factory gates remain unchanged. All actual contract, policy, snapshot, state, diagnosis, review, escalation, broker, scoped application and lifecycle modules and prompts ship in the complete runtime inventory. Imports start no work; state persistence and diagnosis invocation are explicit. Paid launch remains held without demonstrated provider-enforceable ceilings, known pricing/accounting and host authorization.

A supervisor is a durable logical project responsibility, not a permanent model process. Host records, not memory or agent prose, own authorization. Observe is the starting mode. Action mode needs explicit one-project pilot opt-in, finite project/global cost and capacity limits, cancellation fencing and host admission. Missing or unknown accounting holds paid calls. Diagnosis uses the configured family's fixed Mid role, at most two calls per unchanged incident and ten minutes per call, with one active decision per project. Independent gate review uses the separate fixed Large role, not automatic diagnosis escalation. No model/provider fallback or reviewer shopping is authorized.

## Operator modes, inspection and held recovery

[`factory supervisor status|explain|mode|stop`](factory-cli.md#supervisor-inspection-and-project-controls)
extends the existing exact `resolve` command. Status/explain share a version-1,
observation-only JSON envelope. Mode defaults to observe without creating a journal.
The envelope separates owners, incident/evidence basis, proposals, host refusal,
human request/delivery, reviewer decision/provenance, configured/cumulative budgets,
execution observations, host-confirmed merge progress and the next observation.
It never copies frozen source/prompt/output bodies. Proposal display includes redacted bounded before/after excerpts, the exact proposal ID, alternatives and risks; display text cannot substitute for retained original review input. Retained display
collections have deterministic 128-entry pages (`--offset`), with unresolved holds
and unsettled ownership first and explicit total/before/after counts. Aggregate human
hold/pending-worker state is never page-limited. Compare revisions across pages;
no authoritative journal index is truncated. Redacted excerpts
are display aids, not complete review context or authority. Read commands perform
no model/review/repair/tracker/service mutation, settlement or refresh.

The journal's optional version-1 `control` records OS actor, timestamp, mode and
explicit pilot flag; older journals still validate without rewriting. Controls use
the same short CAS/atomic journal boundary and preserve all original denials,
resolutions, work, counters and charges. Unknown worker ownership does not prevent
writing a conservative observe/stop fence. Mode changes never resolve human holds.
`mode act --pilot --confirm` requires enabled finite project/role limits plus real
host global limits/capacity, supported workflow/action authority, notification bridge
authorization/target and enforceable all-in provider accounting. The shipped CLI
cannot supply that complete capability and refuses activation with prerequisites;
valid TOML or an injected offline test does not demonstrate it. There is no global
schedule enablement, project unpause, provider fallback or proof waiver.

Observe fences new reviews/actions; stop additionally fences diagnosis. Reservations
check the durable fence under their journal lock, and workers re-read mode before
spawn/acceptance/notification, independent of a stale caller snapshot. Stop can pass
only exact retained diagnosis/review reservations to a trusted owned cancellation
adapter, never implementation owners. **No shipped cross-process cancellation
adapter is proven:** active/ambiguous reservations produce exit 1, cancellation
pending, after the stop fence is committed. No raw PID kill or accounting release is
attempted. Existing bounded workers still have their host AbortSignal/terminate
boundary and deadline. Already admitted operations are not rolled back or broadly
killed; an in-flight mode change can invalidate completion CAS, leaving its original
charge/capacity and diagnostic sidecar for explicit authoritative reconciliation.
A stop with no unsettled workers exits 0 without claiming any implementation kill.

Recovery from denial remains exact OS-user `resolve`: abandon, or authorize one
materially new successor hash that requires fresh diagnosis/review. Delivery receipts,
mode changes, restart and tracker/model output cannot resume or turn reviewer approval
into execution/completion. No budget reset or reviewer shopping is introduced.

The command/host reader ship with the CLI tree; the Board adapter below joins the
complete runtime inventory alongside existing state/worker/review/escalation and
scoped application assets. Source-only unit and disposable CLI tests prove controls, not
provider enforcement, live delivery, atomic gate application, scheduler integration
or an operational pilot. Scoped input application and outside-lock lifecycle transport are independently evidenced below; live capabilities and pilot prerequisites retain their separate scope.

## Board observation and outcome costs

`board/supervisor.mts` is a passive sanitized adapter over the existing version-1
CLI status projection, not another policy engine. The server supplies the host CLI
reader for registered roots only; browsers cannot supply paths. A missing/corrupt
journal, revision-zero absent project or unavailable CLI is UNKNOWN. No journal is
created by inspection. Standalone copies without the CLI intentionally show unknown.
The adapter ships in the selected inventory as `supervisor-view.mts` (distinct from
the existing diagnosis `supervisor.mts`) and in standalone Board copies.

[`GET /api/supervisor`](factory-cli.md#board-supervisor-observations) is GET-only,
no-store on success and error, and uses the same deterministic 128-entry pages and
omission counts as CLI inspection. Safety indexes remain untruncated. Aggregate
holds, charges and interventions are not limited to the selected page; compare
revisions when navigating. The small accessible Board section shows mode and why
work waits, HUMAN DECISION NEEDED and exact question/next action. Expand the plain
text status page to inspect proposal ID and redacted before/after/risks, review
outcome/host completion, evidence references, budgets/accounting and confirmed merge
progress. Excerpts are explicitly not the exact originals; inspect retained originals
locally before a decision. Neither model text nor arbitrary references become HTML,
file fetches or trusted links. Credentials, URL userinfo/query/fragment and absolute
filesystem/credential references are removed across the whole envelope. No original
file bodies are read for display; only the existing allowlisted status fields appear.

Opening, paging or refreshing observations never launches diagnosis/review/repair,
changes mode, resolves a hold, posts a notification or creates a journal. The existing
review worker still commits denial and invokes the **same** durable host bridge
without the Board. There is no second notifier or automatic delivery service: only
an explicitly invoked host API with current act/notification authorization may use
`deliverSupervisorRequest`. Exact ticket or explicitly configured same-project
operator issue routing, one unchanged-incident managed comment, pending/stopped on
failure, no repeat POST on reconciliation and actual API receipt semantics remain
unchanged. Delivery is not approval; model/tracker comments cannot resume work.
Notes do not change requirement fingerprints or reset diagnosis/recovery budgets.

[Supervisor telemetry](telemetry.md#supervisor-outcomes-and-cost-attribution) follows
successful journal transitions outside their lock, using the existing execution-event
store/export. Journal status supplies cumulative charged ceilings, separately summed
known actual usage and explicit unknown-accounting reservation counts per diagnosis/
review role, plus exact audited local-resolution intervention counts. Missing state
never becomes zero. Refused outcomes and observed incident-to-confirmed-merge elapsed
time are observational, not a second truth store or action authority. Missing history,
unknown merge timestamps and project-wide incidents have unknown elapsed time;
agent activity, pending requests, delivery receipts, review approval and verifier
claims alone never count as confirmed progress. Timing is first retained incident
observation to a later saved host-confirmed merge, not proof of causal improvement.
No baseline benefit, live notification, provider enforcement or pilot is demonstrated.
All existing act refusal, durable stop/cancellation-pending, paid-call holds and
separately authorized one-project pilot prerequisites remain unchanged.

Focused offline evidence uses unit projection/redaction/text-rendering/attribution
and one in-memory HTTP plus injected tracker boundary with disposable state, no
listener, model, credential or live delivery:

```sh
node --test board/supervisor.test.mts board/execution-events.test.mts cli/test/supervisor-command.test.mts cli/test/supervisor-review.test.mts cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

## Configuration, model and paid-call foundation

[Project configuration](project-config.md#optional-supervisor-policy) defines optional `[supervisor]` policy. Omission/disabled policy is inert. Explicit finite cumulative project and diagnosis/review token, cost and call ceilings are required for opt-in; timeout can only lower the ten-minute bound. Two diagnoses per unchanged incident and one active decision per project remain fixed. This introduces no scheduler or actual model catalogue, and changes none of the existing implementation/analysis/verifier/recovery role mappings.

`model-policy.mts` fixes `supervisor` to Mid and `gateReview` to Large in the configured family, with Pi/high thinking and no exact-model/provider overrides, fallback or automatic escalation. Independent review is separately budgeted, not a diagnosis escalation. Model policy identity is version 2; old analysis/proof must be refreshed normally.

`supervisor-policy.mts:supervisorCallHold` is a pure necessary paid-call preflight. It refuses disabled/unregistered, stopped, unknown global admission, missing/invalid finite caps, unknown pricing/accounting, invalid worst-case reservations, exhausted project/role totals and active-decision/incident bounds. Observe may receive bounded **diagnosis proposals only**; review still requires act. Observe never grants action/reviewer admission. Inputs are host facts, not agent claims. Usage totals include settled usage **and all outstanding reservations**, with no implicit period or automatic reset. A successful preflight is not admission, proof or action authority. The downstream journal/admission owner must atomically check/reserve project and global budgets/capacity under a fence before spawn, enforce provider token/output and time ceilings, settle known usage, and hold new calls on any accounting failure. The preflight does not write state; the durable journal below provides the host-owned atomic storage boundary. The explicit diagnosis worker below connects configured preflight to the atomic journal reservation and a required trusted host process/accounting boundary. No shipped Pi adapter currently demonstrates provider-enforceable all-in ceilings; absent that capability paid launch remains held, rather than treating process termination or byte limits as a token/cost guarantee.

`context.mts` freezes supervisor/review additive instructions and their hashes alongside normalized policy and complete selected-runtime identity. Common then role inputs remain contained, additive guidelines; they cannot replace Factory constraints or original source bytes. See [frozen inputs](execution-context.md#supervisor-and-independent-review-inputs). No future worker/prompt asset is referenced until it exists; new actual assets enter the single complete inventory in the change that introduces them. Overrides must be complete and reviewed, never mixed with installed helpers.

**Activation remains blocked:** configured limits or an `act` observation cannot demonstrate provider-enforceable paid ceilings/accounting, authorize tracker notification, atomically apply a correction, produce fresh verification, or clear a durable denial. The owner-approved source-only bridge and fresh reviewer orchestration are implemented below; they do not activate a live adapter or pilot. No mode/restart/reviewer shopping removes denial; approval is never verifier PASS. The source-only executable set is restricted to the exact verification-guidance substitution below; no live action is enabled.

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

These are schema-supported proposal categories, not blanket execution authority. `supervisor-gate-apply.mts` supports only a full-document exact substitution at a configured **verification-only** Markdown source, frozen as a host-owned ticket/run input artifact. It excludes common/other-role guidance, Factory/config/runtime files and changes to the checkout or saved branch. Both local categories use that same narrow consumer; broader additive corrections remain unsupported. There is no generic bypass, permanent waiver, project-wide gate effect or unknown-category fallback. Physical ownership, exact original bytes, current authorization, retained review provenance and fresh analysis/proof are enforced by the application/consumer boundaries below. Structural validation cannot establish semantic equivalence: the independent reviewer and host must reject disguised policy bypasses. Unresolved authority goes to the committed human bridge, never an expanded supported set.

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

Any material change to child/parent/human context, guidelines, Factory policy, gate/failure evidence, exact diff, risks/alternatives, prior decisions, project/ticket, run/base/baseline/tip, runtime/dependencies/settings or admission generation invalidates the input hash. Observe/stop, off/pause, expired effect, superseding incident or lost ownership fences any later application even if a review was previously approved. A corrected gate requires new analysis/proof wherever its inputs changed; approval is never a verification PASS. Consumption/expiry prevent reuse on unrelated tickets or subsequent runs. The explicit scoped artifact and consumer below add one-shot publication plus observation-only reconciliation; they do not authorize a run or waive delivery.

A denial latches the incident into human-required and requests `FlagAHuman` semantics. Never automatically launch another reviewer to override it. Changed inputs do not silently remove the denial. Operator resumption must be an authenticated, durable decision identifying actor, denied proposal/review, reason and permitted next action. It may abandon the proposal or authorize a revised proposal with a new fresh review; it cannot convert denial to approval, reuse old proof or waive Factory constraints. The exact local resolution command below records that audit without changing the original denial, approving a gate or resetting any charge.

Ticket-only evidence/expectation failure stops that ticket's proposed action. Project/runtime/config/ownership ambiguity and required Factory-wide changes stop new supervisor decisions/actions for the project. Existing execution owners retain their work and settlement responsibilities; an escalation is not permission to kill them, reset budgets, delete saved work or rewrite evidence. Notification never resumes anything.

## Fresh reviewer investigation: supported boundary and limits

Inspected source:

- `models.mts:piAnalysisArgs` constructs a new print-mode Pi invocation with `--no-session`, no resume/continue/session selectors, `--tools read,grep,find,ls`, `--no-extensions`, `--no-skills` and `--no-context-files`. Only the configured subscription provider may be loaded explicitly with `-e`. The independent review worker uses the same argument builder with the family's fixed Large model and the stricter `--no-tools` restriction; diagnosis continues to use Mid.
- `analyze.mts:runPi` uses a new `spawnSync("pi", args, {cwd,input,...})` each time with complete frozen prompt on stdin, bounded timeout/output. This is an existing host CLI boundary, not an invented Sandcastle reviewer API. Its analysis JSON extractor is not a strict review parser and must not be reused as approval parsing without strict validation.
- `main.mts` uses Sandcastle `pi` and `sandbox.run` for implementation; `handoff.mts:runVerifier` uses a separate verifier invocation and checks candidate immutability. Neither proves fresh supervisor review sessions or exposes `FlagAHuman`.

Offline evidence: `supervisor-contract.test.mts` exercises the existing `piAnalysisArgs` with both fixed Large family models across two new local Node recorder processes. It verifies frozen stdin bytes, exact allowlisted argv, separate process identities, no session/resume selectors and no human tool in the allowlist. `models.test.mts` already covers provider-extension selection and unavailable-extension refusal. These tests prove **Factory argument construction and a local process boundary**, not live Pi behavior, provider isolation, a semantic independent review or any SDK feature. No paid model, real Pi, authentication or container is used.

**Implemented source boundary:** `supervisor-review.mts` connects this pattern to complete frozen input, strict output, fixed Large policy, durable host completion/provenance, reservations, empty isolated cwd/home and cancellation. Offline adapters prove Factory orchestration below, not live provider ceiling enforcement. A separate process alone is not independence if it reloads proposer history or mutation tools; this worker passes no transcript and disables all tools and discovery.

## Unattended FlagAHuman investigation and owner-approved bridge

**Unavailable primitive:** the inspected Factory runtime has no registered `FlagAHuman` tool or unattended host notification/acknowledgement adapter. `piAnalysisArgs` explicitly disables discovered extensions and allows only filesystem readers. `analyze.mts` provides no MCP/tool bridge. `main.mts` and existing needs-human labels/stages/logs do not call this interactive harness's tool. The interactive T3/Pi session's available `FlagAHuman` is not inherited by Factory agents. No unsupported SDK registration or fictitious notification API is claimed.

The original investigation established these `HumanRequest` requirements. The owner subsequently approved tracker comments and explicit host-user resolution; `supervisor-escalation.mts` now implements the source-only bridge described below (not a model tool or notification service):

1. On denial, required Factory-wide change, unavailable primitive or unresolved authority, durably fence the affected ticket/project's new supervisor work and persist an immutable actionable request **before** external notification. Include exact review/proposal IDs, bounded findings, original evidence locations, the human question and next action. Preserve all existing saved work and owners.
2. Retain `delivery.state = pending` and attempts on failure/crash. A log message, Board badge, issue label, successful local write or agent statement is not delivery. The outbox writer uses host-owned atomic durable publication outside agent mounts; outbox loss/corruption holds action. The durable journal persists the stop and outbox; the separately explicit delivery adapter performs tracker I/O only after that commit.
3. Deliver to an explicitly operator-approved unattended channel with a stable request idempotency key. Record `notified` only after an actual adapter acknowledgement/receipt, channel and time. Notification errors remain pending and stopped; bounded redelivery must not restart work or spend agent/recovery budgets. Notification acceptance and human resolution are separate events.
4. An authenticated operator resolves/resumes explicitly with retained audit and fresh gates. No automatic reviewer shopping, model escalation, Factory-wide edit, global rollout or authority renewal follows notification.

**Owner decision and residual action prerequisites:** the owner approved a source-only durable idempotent tracker-comment outbox. Ticket requests target that exact issue; project requests require a configured operator issue. Successful API comment identity/URL acknowledges notification, never approval. Resolution is an explicit exact audited local host-user command. The implemented offline bridge/reviewer evidence below discharges those source-boundary prerequisites, not live delivery or provider enforcement. Scoped input application and fresh-analysis/verifier evidence are documented separately below. No service, credential, installation, Factory-wide policy change or pilot is authorized.

This finding does not block source-only contracts, state, snapshot or configuration work that preserves observe-only/inert defaults. It **does** block dependent action activation. No live pilot, paid runtime probe, service/registry mutation, production access or secret retrieval was performed.

## Durable supervisor state and accounting

`cli/src/supervisor-state.mts` persists bookkeeping and audited operator mode fences;
it is not a worker, notification bridge, admission replacement or action authorizer. Nothing calls it
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
including after a material change. The explicit host-user resolution API below
retains denial and records one exact successor or abandonment. It never clears
the denial or turns notification into approval.

Each event has a stable host idempotency ID and exact canonical payload digest.
Exact replay is a no-op, including after restart or display-history eviction;
reusing an ID with different bytes holds. Repeated observations with different
event IDs still reuse the stable incident. One pending `HumanRequest` is kept per
incident; rephrasing cannot replace it, notify it, resume it or request another
reviewer. The state module accepts no invented notification receipt.

Only **proposed** shared `Intent` records may be inserted. A separately authorized applicator may complete its own exact live PID/start/fence intent with retained observation evidence before expiry; `complete-intent` sets only `observed-applied`, never an authorized intent or proof. Intent IDs cannot
be reused. The durable commit must precede any future separately authorized side
effect; this module has no effect callback or authorize/apply operation. A dead
owner's ambiguous intent can only be reconciled by recording explicit retained
observation references (`observed-applied`, `observed-not-applied`, or `unknown`).
Even observed-applied leaves the shared intent `proposed`: it is audit, not host
application authority. The scoped consumer additionally validates the exact immutable artifact, current host authorization, originals, receipt and independent-review provenance. Reconciliation never executes or retries the effect;
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

The state foundation alone grants no notification/review authority. The separately
explicit source-only review/outbox boundary below implements the approved comment
and local-resolution contract. Provider-enforced paid ceilings and atomic
contained/preimage/fenced application with new proof remain activation prerequisites. Defaults remain inert;
there is no automatic supervisor loop or usable live pilot activation adapter. Explicit diagnosis is described below.

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
absent future application asset is imported. Scheduler wakeups and
operator commands are not implemented by diagnosis. The separate outside-lock lifecycle transport below calls this API without changing its authority or budget ownership.

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
semantic equivalence or authorize a proposed gate correction. The fresh
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
change. This is distinct from the implemented source-only human outbox and scoped input application boundaries.

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
delivered by logs, local writes, sidecars or this return value. The separate
outbox adapter below can acknowledge actual tracker receipts under explicit host
authorization; the local command records exact successor permission. Neither
clears denial or supplies missing provider enforcement/application authority. Review,
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
The broker does not install or invoke the separately committed managed-comment
bridge described below and never fabricates its receipt. Missing trusted bridge
integration and explicit action-activation authority hold repair candidates,
pending and stopped. No uncommitted reviewer/notification/application interface is imported.

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
enforced all-in ceilings and known pricing/accounting. The committed offline review/
outbox evidence below is preserved, but does not itself wire broker activation.
Trusted notification/review integration, reviewed application/fresh proof, lifecycle
wiring and explicit one-project pilot approval remain separate activation
prerequisites; offline authorized facts do not discharge them.

Focused unit policy matrices and the extended existing disposable afterPass race
fixture prove host allow/hold/refuse/draft identity and at most one attempt/charge,
with paused/active/unknown/exhausted/CI-wait no-launch cases. Fixtures use injected
clocks/process/container/tracker boundaries, not live models or notification:

```sh
node --test cli/test/supervisor-policy.test.mts cli/test/jam-detect.test.mts cli/test/recovery-claim.test.mts cli/test/recovery-run.test.mts cli/test/runtime-bundle.test.mts
```

## Independent exact-proposal review and host escalation

`orchestrator/gate-review.mts` and `prompt.gate-review.md` compose the entire shared
`ReviewInput`, without supervisor/reviewer transcripts. Original child, parent,
ordered human planning/comments, guidelines, Factory constraints, gate purpose/rule,
failure evidence and prior decisions remain original bytes, including explicit
missing/truncated notices. The exact proposal includes alternatives, risks and
before/after; the snapshot binds run/base/baseline/tip/runtime/dependencies/settings/
policy/admission generation. Missing material context escalates without launching
an approvable review. Relevant changes require a different proposal/input identity.

`cli/src/supervisor-review.mts:reviewGateProposal` is an explicit host API, not a
scheduler or action executor. Act plus current registered/global/unpaused host
authorization is necessary. The fixed configured-family `gateReview` Large model
is independent of diagnosis Mid; no fallback or model/provider escalation exists.
The worker commits finite project/role/global token/cost/call/capacity reservation
before spawn, with PID/start owner, fresh invocation/reviewer UUIDs, fence and at
most configured ten-minute deadline. Every reservation stays fully charged, even
on failure. Unknown cleanup/accounting retains ambiguous capacity and prevents a
replacement. The trusted adapter must enforce all-in provider ceilings even after
controller death. **No shipped default paid Pi adapter proves that capability.**
Absent it, the worker durably requests a human and launches no paid process.

The supplied existing `piAnalysisArgs` invocation uses `--no-session`, no resume,
`--no-tools`, `--no-extensions`, `--no-skills`, `--no-context-files`, explicit
configured subscription extension only and stdin originals. Each call has an empty
private cwd/home/agent directory and a minimal environment; no proposer/prior-review
workspace or transcript is inherited. The trusted adapter must honor these exact
arguments/environment. Host input/process/result sidecars remain outside that cwd
and project mounts. Time, stdout (16 KiB), stderr (8 KiB), cancellation and owned-group
cleanup are bounded. A normal exit does not accept output before pipes close.

Only entire strict JSON with exact input/proposal/invocation/reviewer/model/policy
identity and written rationale can approve or deny. The host assigns audit IDs and
times; model claims cannot establish provenance. Malformed, stale, cancelled, late,
unknown-accounted and inconclusive output holds and creates one bounded actionable
human request. Completion and required human stop publish in **one journal commit**.
A denial retains the original proposal/gate/work and latches across mode/restart/
material changes. A Factory-wide classification directly creates a project-scoped
request, without a reviewer or application. Approval is neither independent
verification nor merge/application authority.

Cached approval requires the new host `reviewCompletions` provenance index, settled
known accounting and exact retained original input/identity bytes. Legacy audit-only
`review` events are never usable approvals and cannot trigger reviewer shopping.
All actual modules/prompts/outbox assets ship in the complete selected inventory;
complete overrides cannot omit them.

### Durable managed comment outbox

`deliverSupervisorRequest` reads the retained human stop before external I/O. Its
current host authorization must explicitly permit notification in act mode; observe,
stopped or absent authorization performs **no tracker write**. Ticket scope targets
only that ticket. Project scope requires an explicit `operatorIssue` in the same
canonical tracker project; there is no arbitrary ticket fallback. This is host API
configuration, not a new TOML setting or installed notifier service.

Before POST, the journal durably records one attempted target and stable managed
marker binding project/incident/request/proposal. The actual adapter uses bounded,
shell-free `gh-axi api` or `glab api` issue-comment endpoints. GitHub's ergonomic
wrapper response is requested losslessly with `--full --jq @base64`; only its
untruncated response envelope and actual API comment ID/body/URL are accepted.
GitLab retains the actual note ID and canonical issue note URL. A successful
local write/log, label, model claim or exit code without that receipt is not delivery.
Only the exact target/marker receipt becomes `notified`; this never resolves the stop.

Failure, process crash or uncertain response remains pending. Subsequent explicit
delivery calls can list the exact target and acknowledge exactly one managed
comment; they **never repeat the POST**, even when the list is empty or eventually
consistent. This intentionally favors missing notification over duplicate unchanged
threads. Unknown/multiple/mis-scoped receipts and a changed target remain pending
for operator reconciliation. There is no automatic retry loop, budget reset,
resume, project mutation or gate mutation. A crash after attempted publication but
before POST also remains pending: an operator must inspect it, not assume it was
safe to repost. Existing owners and saved work are never killed or cleaned up.

### Exact local operator resolution

[`factory supervisor resolve`](factory-cli.md#supervisor-human-request-resolution)
uses the existing private host-user state-directory trust boundary. The command
requires exact incident, request and proposal IDs, a reason, confirmation and either
abandonment or one different exact successor proposal hash. Actor comes from the
local OS identity, not `USER`, a tracker comment, model field or actor flag. Unknown
or unsettled process/accounting still holds. The immutable resolution audit does not
change the denied record, delivery state, original work, charge or recovery budget.

A permitted successor needs a **new material incident**, its exact frozen proposal
and a new independent review. Diagnosis may collect that new material proposal, but
publication/review must match the exact pre-authorized successor hash; it cannot
rephrase or replace the original. Resolution chains retain A→B→C history while only
the current leaf authorizes the next exact review; old authorizations are not eternal
conflicting pins. Cycles and reuse of the original denied incident are refused.
Abandonment permits no replacement. No command automatically launches/resumes work,
converts denial to approval, resets limits or waives Factory constraints. Live host activation and pilot remain separately unimplemented prerequisites; the source lifecycle hook below does not turn a resolution into resumption. The explicit scoped application/fresh-proof source boundary below does not activate them.

Offline evidence (unit policy matrices plus minimal disposable process/tracker-API
and local CLI boundaries, injected clocks/owners, no sleeps or live probes):

```sh
node --test orchestrator/gate-review.test.mts cli/test/supervisor-review.test.mts cli/test/supervisor-command.test.mts cli/test/supervisor-state.test.mts cli/test/supervisor-worker.test.mts cli/test/runtime-bundle.test.mts
```

These prove distinct process/reviewer identities, stdin originals/no inherited
context or tools, denial→actual injected tracker boundary, stop-before-POST,
lost-response reconciliation, failure retention/dedup/restart, exact project route,
no observation writes, legacy audit refusal, retained-original tamper refusal,
A→B→C exact local resolution/fresh diagnosis and unchanged cumulative charges.
They do not prove live model semantics, provider enforcement or delivered live
notifications. No live configuration, install, service, credential, tracker probe,
paid call, gate edit or pilot is performed.

## Exact scoped verification-guidance application

`cli/src/supervisor-gate-apply.mts:applyReviewedGate` is an explicit host API, not a
CLI mode, scheduler or execution owner. Its supported consumer is the existing
configured verification-only Markdown loader. A full exact `before` document is
replaced with its independently reviewed `after` text **in the frozen verification
input**, not in the project checkout, saved worktree, installed runtime or old
proof. Commands in that text are never executed by the applicator. The ordinary
independent verifier evaluates and executes lawful project evidence in its normal
sandbox. This narrow input substitution avoids a pathname check/rename race with
saved work or sandbox writers: no project file is ever replaced.

The host supplies fresh current authorization, explicit one-project pilot permission,
act/enabled/registered/global/unpaused state, the current durable journal `control` record with explicit act/pilot, an exact admission-generation fence,
owned ticket/run/branch/worktree and selected runtime. These are host observations,
not model claims. A stale caller snapshot cannot override durable observe/stop or missing pilot authorization; the application retains the operator-control identity and consumption refuses a changed control fence. Every invocation rechecks the complete exact `ReviewInput`,
retained proposal, denial/supersession/resolution state, fixed-family independent
review, settled accounting and **host `reviewCompletions` provenance plus retained
original input/process identity**. The applicator never launches a reviewer. Missing
or stale approval holds; changed material proposal inputs require fresh review.
Factory-wide or unsupported physical/consumer scope uses the existing durable
human-stop/outbox bridge. Tracker delivery still requires its independent current
authorization and receipt; no live notification is enabled here.

Actual inputs are checked, not just repeated snapshot objects: canonical project
and exact receipt-owned registered Git worktree, current branch/common directory,
historical baseline, target preimage in both root and worktree, current complete
runtime/dependency inventory, normalized settings/family/policy/tracker, and every
configured original instruction's exact reviewed bytes. Symlinks, hardlinks,
foreign owners, secret/protected/config/runtime targets and guidance shared with
another role refuse. Other dirty/untracked/index work and every branch remain
untouched. The private canonical host state directory must be outside project and
agent mounts. Host callers retain existing claim, cancellation and lock-order
responsibilities; this API creates no replacement admission owner.

### Intent, CAS and ambiguous publication

An application ID is deterministic for one exact proposal. Before publication the
host retains original authorization, proposal/rationale/scope/expiry, review/input,
receipt and before/after identities in `intent.json`, then commits the shared
fenced intent by journal revision CAS. Only then can `source.md` be published in
that private application directory using **exclusive creation**, bounded exact
bytes and file/directory fsync. It cannot truncate a prior artifact or project file.
A short host application lock serializes cooperating publishers; there is no
external process or tracker call under it. Fenced live-owner completion records
`observed-applied`; the shared intent remains an audit, not proof or approval.

After a crash, a live/unknown previous owner holds. With an authoritatively dead
PID/start owner, reconciliation compares the retained intent and actual artifact:
exact postimage is observed-applied, absent is observed-not-applied, partial/foreign
bytes are unknown. **No observation retries, repairs or republishes the effect.**
Even an absent artifact needs human reconciliation rather than blind replay. All
original work, charges and old evidence remain retained. Unknown/expired/fenced
artifacts cannot be consumed; no timer, restart or notification resets authority.

### Enforced fresh analysis and independent proof

The explicit `loadExecutionContext({ gate })` host API takes the exact application,
ticket and run capability. It validates the artifact and current authorization
again and substitutes only the named verification source. Every other role and
Factory prompt is unchanged. Each original instruction read is compared with its
reviewed hash, including during composition; a stale callback cannot hide an
actual guideline edit. Application/input/review/fence/expiry and the actual current
candidate SHA enter `identity`/`policyIdentity`. Changing the candidate requires a
new context and new execution analysis; old frozen context is not rewritten.

`analyse({ executionContext, runId, ... })` enforces the actual ticket/run scope
and emits the renewed policy/candidate-bound manifest through the ordinary analysis consumer. Its ticket-input hash and analysis workspace/base/tip must match the reviewed source and exact owned candidate. `runVerifier({ execution: ... })` checks that exact manifest, requirements,
policy and candidate before launching the normal separate verifier; an old manifest cannot authorize it. It also binds the complete frozen ticket text/hash, corrected verification instructions, selected immutable verifier template and owned sandbox workspace; a valid context cannot be paired with stale prompt arguments. It requires a fresh evidence directory so prior FAIL or
INCONCLUSIVE records remain immutable. Context and scope are checked again after
the verifier. Normal immutable-candidate, browser preflight, cleanup, host proof,
exact-SHA publication/CI/review/merge gates remain mandatory. At every publication/push authorization, `postAndDeliver` independently binds the frozen proof's gate input/application/review/fence/expiry/postimage/candidate and verification-source hash to the journaled artifact. Thus even a valid amended-context recheck cannot launder an old same-SHA PASS proof. Approval is **not** a verifier PASS, host proof or merge approval.

Unamended normal/recovery execution and existing-delivery continuation check the
host application journal at their real ticket/run boundaries. They cannot silently
reuse pre-correction analysis/proof—even at the same SHA. Another explicitly
identified ticket/run is unaffected; unknown run scope for the affected ticket
holds rather than guessing. No default CLI/environment selector activates the
amended context. A trusted host integration must explicitly carry its scoped
context through analysis, verification and current delivery rechecks; if that
cannot be done under current ownership/execution contracts, retain the work and
escalate instead of editing the checkout or relaxing Factory.

Offline evidence uses the public applicator, complete runtime/context, actual
analysis consumer with a fixture-owned Pi process, normal separate verifier
boundary, a real local Node evidence command and normal host-proof/delivery APIs.
One disposable Git/filesystem case covers exact scope, saved dirty/index/other-branch
preservation, post-publication crash observation without duplicate action, changed
candidate/guideline/authorization refusal, fresh analysis/verifier proof, same-SHA old PASS refusal under both unamended and valid amended-context rechecks, and retained old FAIL. Unit matrices cover absent/legacy/denied/stale approvals, proposal/project
mismatch, authorization/fence/expiry and unsupported scope. These are source wiring
proofs, **not** live model semantic approval, provider ceiling enforcement, paid
activation or a completed pilot. The explicit lifecycle transport below can connect the host workers, but does not supply live activation or a default execution-context consumer; default paid review/diagnosis still hold.

```sh
node --test cli/test/supervisor-gate-apply.test.mts cli/test/supervisor-review.test.mts cli/test/supervisor-state.test.mts orchestrator/context.test.mts orchestrator/instructions.test.mts orchestrator/handoff.test.mts cli/test/runtime-bundle.test.mts
```

## Outside-lock event and lifecycle transport

`cli/src/commands/tick.mts` collects short local hints before project maintenance
and after completed/failed passes. It calls `SupervisorTickHook.handoff` only after
releasing the tick lock. It never awaits diagnosis, review, notification or gate
application. The existing pass/recovery flow, rotation, dispatch cap, saved absolute
CLI/Node/PATH routing and macOS `factory supervise` scheduler meaning are unchanged.
Off/unknown, cancellation, an unconfirmed pass group, or a failed tick setup drops
new handoff work. Paused/unopted projects can produce a checkpoint hint, not permission.
Read-only refresh is never an authorization source. The default hook has **no host
binding** and performs no model/tracker/action work.

`cli/src/supervisor-schedule.mts:supervisorWakeups` is a narrowly trusted source API,
not an installed worker service, new provider stack, polling/retry scheduler or TOML
activation setting. Its synchronous bounded hint collector coalesces one batch per
project (at most 1024 projects). Explicit host producers can signal checkpoint,
completed pass/run failure, gate refusal, delivery, prerequisites, requirements and
exact audited owner-response changes. Kinds are hints only: the fresh host binding
must collect the complete current original snapshot. Neither tracker responses nor
hint IDs grant approval. There is no new tracker watcher or implicit tracker refresh.
Checkpoint recollection on subsequent ticks observes changes that occurred during an
active worker; hints are not a durable work queue and do not promise lossless delivery.

Handoff schedules microtasks after unlock. Each project has its own short-lived
controller/context; the shared existing journal still atomically enforces one fenced
unsettled decision per project, finite diagnosis/review capacity and cumulative charges.
Another host/process races through those same reservations, never a second budget.
The actual `diagnoseProject` API uses authoritative material identity (excluding only
observation time) and validates retained originals before reusing an unchanged wait,
including after restart. Repeated hints cannot themselves spend a new call. Restart,
mode changes, denial and unknown cleanup never reset charges or reclaim capacity.

Scheduled work is narrower than the explicit diagnosis API: it requires current
registered/enabled/global-on/unpaused authorization, outside-lock assertion and
**durable act/pilot**. Observe/stop or unknown authorization fences scheduled diagnosis
as well as review/action. A trusted host must supply `admissionHold`, backed by the
existing shared implementation/recovery admission owner and an actual finite resource
lease. A read-only diagnosis may coexist with implementation only if that host can
prove independent available capacity without a race; recovery retains project-wide
exclusion. A callback returning no hold is a necessary host assertion, **not a new
atomic mixed-workload lease primitive**. The shipped interfaces do not yet supply
that joint lease, so a production binding must hold absent a demonstrated one. No
supervisor repair launcher is added: non-gate advice remains input to the existing
successful-pass/two-pass jam broker, with its original charge and exclusion gates.

For a gate decision, the transport calls the committed fresh fixed-Large review API
with the exact original proposal/snapshot/journal, and optionally the committed
scoped applicator only after `review-approved`. It rechecks current control/material
identity, cancellation and admission before each stage and through each worker's
current-authorization callback. Review denial/human stop uses the existing durable
outbox; notification remains independently authorized, exact-target and receipt-only.
Absent review/application transport retains the proposal/approval, never fabricates
execution. A returned application still requires **new analysis and independent
verification**. The transport does not launch execution or create a default selector:
a trusted host must explicitly carry `loadExecutionContext({gate})` through the normal
analysis → separate verifier → new host proof → `postAndDeliver` scoped rechecks.
Absent that execution owner/consumer, retain the artifact and escalate rather than
editing a checkout, replaying an uncertain effect or accepting an old same-SHA PASS.

A retained host instance can cancel an exact active controller with `cancel(root)`;
only that controller's diagnosis/reviewer AbortSignal reaches its original trusted
process boundary. Maintenance handoff also rechecks active bindings and aborts on
changed material/control/global/pause authority. Late review output cannot authorize
application. There is no raw-PID kill, implementation-group signal, timer-based owner
reclamation or accounting release. Across processes/restarts, no trustworthy control
channel is shipped: CLI stop honestly remains cancellation-pending for unsettled
workers. PID/start/control evidence must be reconciled by the owning boundary, not
turned into broad kill permission. Cancellation cannot retract an already admitted
tracker POST or published artifact; their ambiguity/observation rules remain intact.

**Residual activation boundaries:** no shipped default adapter demonstrates all-in
provider-enforceable token/cost/accounting after controller death; no production
joint implementation/supervisor resource lease, authenticated cross-process cancel
channel or scoped execution-owner transport is claimed. The CLI still refuses act.
Offline adapters prove source connections only, not those runtime capabilities,
semantic reviewer approval, live notification or a pilot. No global enabling,
install, service/project mutation, paid call or live tracker delivery is performed.
The actual lifecycle helper joins the complete selected runtime inventory.

```sh
node --test cli/test/supervisor-schedule.test.mts cli/test/scheduler.test.mts cli/test/runtime-bundle.test.mts
```

Pure policy/hint tests and one extension of the existing stubbed tick/process boundary
prove two-project isolation, nonblocking pending review, unchanged rotation, exact
in-process cancellation, durable stop/late review refusal and restart wait reuse with
unchanged charges. Existing worker/state/recovery/proof tests retain the shared finite
capacity, denial, admission and independent-proof matrices. Clocks/processes/owners
are injected; no sleeps, services, live agents or tracker delivery are used.

## Reproduce offline evidence

```sh
node --test orchestrator/supervisor-contract.test.mts orchestrator/supervisor-policy.test.mts orchestrator/project-config.test.mts orchestrator/context.test.mts orchestrator/instructions.test.mts orchestrator/models.test.mts orchestrator/workflow.test.mts
node --test cli/test/supervisor-state.test.mts cli/test/runtime-bundle.test.mts
```

Policy and schema matrices are unit tests; one minimal local Node process fixture tests argv/stdin. There is no browser or live notification E2E; offline process/notification adapter evidence is documented below. Run all commit-tier shards and the separate browser lifecycle command in [TESTING.md](../TESTING.md) before delivery. Passing offline tests does not constitute a pilot or prove an unavailable SDK primitive.
