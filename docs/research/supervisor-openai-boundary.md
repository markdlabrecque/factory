# OpenAI fixed-Mid boundary for a saved-run advisory supervisor

Research date: 2026-11-17 UTC. Scope: owner-approved, explicit advisory diagnosis for one named ticket and its saved run; OpenAI only. This is research, not activation approval, implementation, or a replacement for the authoritative supervisor contract.

## Follow-up: executable constrained-path investigation

The [constrained provider contract](../design/supervisor-provider-contract.md)
selects the supported direct Pi-AI OpenAI Responses SDK surface and records its
actual pinned-artifact offline request trace. The published serializer/catalogue
hashes match this investigation. Its direct payload hook fails closed before
transmission; the extension runner's superficially similar hook does not. It uses
a conservative provider-context admission bound, not a byte/token estimate.
This does **not** retrofit the unchanged print invocation or ship a paid boundary:
journal authorization, durable settlement, lifecycle ownership and real host
composition remain required. Fixture eligibility and HTTP/SSE are synthetic;
remote acceptance, billing and paid evaluation remain untested/unauthorized.
The findings below describe the original unchanged-print investigation.

## Finding

**The fixed model is supported in the inspected current packaged Pi catalogue and documented by OpenAI. The existing Factory Pi print invocation does not, however, demonstrate the `DiagnosisBoundary` required for paid diagnosis. Keep that boundary held.** The blocker is not model existence, and neither switching providers nor building a second provider stack is justified.

OpenAI documents a server-side generated-token ceiling that includes reasoning and invisible formatting tokens. That is a useful primitive which does not depend on the Factory controller staying alive. It is **not** a combined input/output dollar cap, an exactly-one-request guarantee, a kill-group guarantee, or a promise of retrievable accounting after losing a stream. A conservative finite *derived* token/cost reservation is feasible in principle for one completely bounded request; the current invocation does not establish the necessary premises.

No paid call, input-token-count request, authenticated model listing, live model request, credential access, installation, service, scheduler, Git-state change, or test work was performed. Only this findings file was created. Research was performed directly, without subagents. No auth files, `.env`, user model configuration, settings files, or secret environment values were read. Public packaged provider data is distinguished below from user configuration.

## Versions and evidence limits

- Repository: `markdlabrecque/factory`, inspected checkout commit `879a598f2c9227d03a58690c7f329c3cbb78bacd`; initial working tree clean. Origin spelling: `github-personal:markdlabrecque/factory`.
- Local `pi` command resolved to `/home/mark/.pi/agent/bin/pi`. That public shell launcher reads `install/current-version`, whose value was `1.5.2`, and dispatches to that release's `node_modules/.bin/pi`. The CLI was **not executed**, avoiding startup/config/auth discovery.
- Inspected packaged `@earendil-works/pi-coding-agent`, `pi-ai`, and `pi-agent-core`: all **1.5.2**, read from their package manifests. Repository metadata identifies `https://github.com/earendil-works/pi`, respective `packages/coding-agent`, `packages/ai`, and `packages/agent` directories. Pi-AI declares `openai: 7.19.0`; that is its declared dependency, not a separately verified runtime SDK resolution.
- Local source root, abbreviated **P** below: `/home/mark/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/`. Citations like `P/pi-ai/dist/...` identify shipped executable library files, not user configuration. No upstream Git commit for these installed artifacts was established; package version and hashes are the reproducible evidence, not an assumed upstream tag.
- Factory's setup snippet `skills/factory-setup/layers/agent-pi/pi.Dockerfile.snippet:3` installs `@earendil-works/pi-coding-agent@{{PI_VERSION}}`. The inspected local host release does not prove every Factory execution host/image uses that release, nor prove this owner's OpenAI account entitlement, billing configuration, or effective Pi settings. Those were intentionally not inspected.
- The OpenAI pages below were fetched without credentials and returned HTTP 200 on the research date. They are mutable public documentation, not runtime measurements or account-specific contracts. The older help-center project-budget article returned HTTP 403; its contents are **not** used as evidence. The current first-party spend-limits guide supplies stronger, more specific evidence.

Selected artifact SHA-256 hashes:

| Packaged file relative to P | SHA-256 |
| --- | --- |
| `pi-ai/dist/providers/data/openai.json` | `df2fe1f312051bbe29801ef903ab370c701a74a680f1370e96eb465eacd1d82d` |
| `pi-ai/dist/api/openai-responses.js` | `c35b80b2eb7f84b0ea1d939784943038956aefec7b624ed7862ebe2fd9d40c4b` |
| `pi-coding-agent/dist/cli/args.js` | `6c1a82465ba2e809068e84605c650cbe44cbff700ab691e79bfe390360817f35` |

## Source register

### Authoritative repository sources at the commit above

- **R1**: [`orchestrator/model-policy.mts`](../../orchestrator/model-policy.mts), `MODEL_POLICY`, `ROLE_TIERS`, `AGENT_POLICY`, `modelForRole` (lines 1–15). Policy identity `factory-model-policy-v2`; supervisor = fixed Mid `openai/gpt-6.1-terra`; thinking `high`.
- **R2**: [`orchestrator/models.mts`](../../orchestrator/models.mts), `piAnalysisArgs` (lines 156–163).
- **R3**: [`cli/src/supervisor-worker.mts`](../../cli/src/supervisor-worker.mts), `DiagnosisBoundary` (lines 21–31), fixed-model preflight and invocation/reservation (lines 127–151), termination/accounting and publication in `diagnoseProject` (remaining function).
- **R4**: [`orchestrator/supervisor-policy.mts`](../../orchestrator/supervisor-policy.mts), `BudgetLimits`, `CallPreflight`, `supervisorCallHold`; [`docs/supervisor.md`](../supervisor.md), activation/advisory boundary; [`docs/project-config.md`](../project-config.md), fixed family tiers and supervisor limits. Configured budgets are prerequisites, not proof that the provider enforces them.

### Primary OpenAI documentation (retrieved 2026-11-17)

- **O1**: [GPT-6.1 Terra model reference](https://developers.openai.com/api/docs/models/gpt-6.1-terra), model identity, reasoning support, context/output lengths, pricing, snapshots.
- **O2**: [Create a response](https://developers.openai.com/api/reference/resources/responses/methods/create), `max_output_tokens`, `truncation`, `usage`, service tier, tools, background and storage parameters.
- **O3**: [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning), “Managing the context window” and “Allocating space for reasoning.”
- **O4**: [Token counting](https://developers.openai.com/api/docs/guides/token-counting#understand-output-token-counts), input-count endpoint and “Understand output token counts.” Documentation only: no count request was made.
- **O5**: [API pricing](https://developers.openai.com/api/docs/pricing), Standard / Batch / Fast prompt-caching tables.
- **O6**: [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), GPT-5.6-and-later cache writes, lifetimes, explicit-only mode and returned input usage.
- **O7**: [Spend limits](https://developers.openai.com/api/docs/guides/spend-limits), alerts versus hard spend limits, propagation delay and error codes.
- **O8**: [Cancel a response](https://developers.openai.com/api/reference/resources/responses/methods/cancel), cancellation restricted to responses created with `background: true`.

### Packaged implementation sources (all under P, version 1.5.2)

- **L1**: `pi-ai/dist/providers/data/openai.json`, JSON path `openai-responses["chat:gpt-6.1-terra"]` (one-line public packaged data file); loader `pi-ai/dist/providers/openai.models.js`.
- **L2**: `pi-ai/dist/api/openai-responses.js`, `stream` (request options/retry around lines 130–191), `streamSimple`, `buildParams` (around lines 245–314).
- **L3**: `pi-ai/dist/api/simple-options.js`, `clampMaxTokensToContext`, `buildBaseOptions`; `pi-ai/dist/utils/provider-retry.js`, `retryProviderRequest`.
- **L4**: `pi-ai/dist/api/openai-responses-shared.js`, `finalizeResponse` (around lines 486–530) and stream event handling.
- **L5**: `pi-coding-agent/dist/cli/args.js`, `parseArgs`; `pi-coding-agent/dist/modes/print-mode.js`, `runPrintMode` (JSON subscription around lines 86–90; text output around lines 112–135).
- **L6**: `pi-coding-agent/dist/core/settings-defaults.js`; `pi-coding-agent/dist/core/settings-manager.js`, settings accessors; `pi-coding-agent/dist/core/agent-session.js`, retry handling and `_checkCompaction` (around lines 2487 onward).
- **L7**: `pi-coding-agent/dist/core/sdk.js`, `buildRequestOptions` (around lines 193–209), provider dispatch/cache warming; `pi-coding-agent/dist/core/cache-warmer.js`, `start`, `schedule`, `refresh`.
- **L8**: `pi-coding-agent/dist/core/model-resolver.js`, `resolveCliModel`; `pi-agent-core/dist/agent-loop.js`, agent continuation loops.

## Exact model: positive evidence, not an old-catalogue inference

R1 fixes the model. L1 positively contains `id: "gpt-6.1-terra"`, provider `openai`, API `openai-responses`, base URL `https://api.openai.com/v1`, `reasoning: true`, high-effort mapping, `maxTokens: 128000`, and pricing. O1 explicitly documents `gpt-6.1-terra`, reasoning efforts `none`, `low`, `medium`, `high`, `xhigh`, `max`, and 128,000 maximum output tokens. O2 also includes the exact model in its model enumeration. **There is no basis here to label the fixed model unsupported.** No claim is made about older Pi releases or another catalogue.

One important version/evidence discrepancy: **L1 has `contextWindow: 272000`; O1 currently says 1,050,000 context window.** L1 also includes a long-input price tier above 272,000 tokens. A local conservative context setting is not evidence that OpenAI's public model has only that context. Conversely, the public larger context is not evidence that this Pi release will admit it. Resolve which finite bound is used in the actual constrained request path; do not silently increase Pi limits or substitute a model.

## Evidence table: required capability versus what exists

| Requirement | Evidence and actual behavior | Assessment for current invocation |
| --- | --- | --- |
| Fixed OpenAI Mid, no family/model substitution | R1; R3 compares `boundary.model` to the exact policy model. L1 contains that exact model. L8 has generic fallback-model paths for unresolved IDs, but those are not evidence of a fallback for this positively resolved ID. | Identity available. Must validate actual resolved provider/API/model and disallow generic fallback paths in a paid adapter. |
| Read-only, no agent tools | R3 replaces R2's read-only tool list with `--no-tools`; disables discovered extensions, skills and context files, supplies frozen originals on stdin, uses a fresh invocation/no session. L5 recognizes those flags. | Valuable isolation, not a spend/call-count control. Verify an empty actual provider tool set; do not confuse supported model tools with tools enabled for this request. |
| Finite generated tokens including reasoning | O2: `max_output_tokens` is an upper bound including visible output and reasoning, minimum 16. O4 adds invisible formatting tokens. L2 sends the option, clamped to at least 16. L3 uses model `maxTokens` when not explicitly supplied and fits it to estimated context room. | Provider primitive exists, but R2/R3 do not pass the per-reservation output allowance. Default model maximum is not the project's all-in budget. `--thinking high` is effort, not a token cap. |
| Input plus output token ceiling | No combined `max_total_tokens` budget is established by these sources. O2 default disabled truncation rejects inputs exceeding context; O4 documents a separate count endpoint. Pi estimates input to choose an output limit (L3), not a proven exact input-token upper bound. | Not demonstrated for the frozen **complete serialized request**, including Pi system prompt/framing. Prompt bytes alone and stdout bytes are not all-in tokens. |
| Strict dollar ceiling | O1/O5/O6 give model/token price schedules, not a per-request max-USD field. Cache writes and tier premiums matter. R3 supplies `reservation` only to the boundary. | Reservation arithmetic needs proven request bounds and worst-case applicable pricing; the existing invocation does not install such enforcement. |
| At most one generation request, no retry | L2 explicitly sets SDK `maxRetries: 0`; L3's provider retry helper defaults to zero but can be configured via options. L7 forwards effective provider settings. Separately L6 defaults agent retry to enabled, max 3. | Do **not** say the SDK's zero setting proves no retries. Agent retries remain possible; effective provider retry settings were deliberately not read. |
| No hidden extra model requests | L6 defaults automatic compaction on and contains overflow/length compact-and-retry paths. L7 also includes cache warming, default `idle`, capable of replaying requests. L8's agent loop is not intrinsically a one-request transport. | Print “single-shot” means prompt/result lifecycle, not a proven single billable call. Disable/bound compaction, continuation, warming and every request source. Warming is conditional/timed, not asserted to occur in every short print run. |
| Survives Factory controller death | R3's timer and stdout checks run in the controller; detached child ownership is recorded. O2's server output cap can survive local death once in the accepted request. | Controller timers/abort/group kill cannot alone cap an already accepted remote request. Local deadline/group cleanup needs an independently surviving enforcement mechanism; remote spend needs the precommitted request ceiling. |
| Authoritative terminal token usage | O2/O4 define response usage. L4 maps terminal provider usage, subtracts cache reads/writes from ordinary input, records output/reasoning/total. | Terminal usage is useful evidence for a completed request, but successful text output is not usage evidence. Reasoning is part of output, not an additional quantity to add again. |
| Accounting after failure/death | L2 starts usage at zeros; L4 fills it on terminal events and permits absent usage. L5 text mode emits assistant text, not provider accounting. L2 sends `store: false`. | Missing stream/terminal usage is ambiguous, **not zero**. Do not infer retrieval or refund after local abort, child exit, lost connection, or controller death. R3 correctly retains reservation/capacity when usage or cleanup is unknown. |
| Account-level budgets | O7: spend alerts leave traffic running; opt-in hard organization/project spend limits can reject with 429, but enforcement is not instantaneous and spend can exceed the configured amount. | Alerts/ordinary budget thresholds are soft; even documented hard limits are not exact per-diagnosis all-in caps. No account controls were inspected or changed. |

### Current invocation and the stub/flag distinction

For this OpenAI policy R2/R3 construct:

```text
pi -p --model openai/gpt-6.1-terra --thinking high --no-tools
   --no-extensions --no-skills --no-context-files --no-session
```

No `--max-tokens`, `--max-cost`, `--max-calls`, or retry-disable flag is present in that invocation; L5's CLI parser does not establish such budget flags. Library-level `maxTokens`, retry settings, and request hooks are not automatically CLI controls. Do not add invented CLI flags to a proposed run command.

Likewise `deadline`, `maxOutputBytes`, `reservation`, `pricingKnown`, `accountingKnown`, `enforceable`, `terminate`, and `usage` in R3 are **host adapter requirements/data**, not OpenAI API fields or shipped enforcement. Setting their booleans to true in an offline adapter does not prove a provider boundary. No tests or fixtures were inspected for this research, and no test result is offered as provider evidence.

## Conservative budget/accounting derivation

For a single text-only Responses request, with **proven complete input upper bound** `I`, **server-accepted generated-token maximum** `O >= 16`, no extra calls/tools and fixed service/cache/region policy, reserve:

- Tokens: `T_reserve = I + O`. O4 states generated usage includes invisible formatting and reasoning. Do not add `reasoning_tokens` again to `output_tokens` or `total_tokens`.
- Cost: `C_reserve = ceil_microUSD((I * p_input_worst + O * p_output_worst) / 1,000,000)` when prices are USD per million tokens. Use exact/rational arithmetic and round **up**, including applicable charges; do not floor a worst-case cost.
- `p_input_worst` must cover uncached input **and** allowed cache writes, not optimistically assume every token gets a cache-read discount. O6 states cache-write prices are total rates, not surcharges on ordinary input. Either prove caching policy and applicable rates, or reserve the worst allowed rate.

O1/O5 currently quote Standard Terra: ordinary input $1/M, cached input $0.05/M, 30-minute writes $1.25/M, 12-hour writes $2.50/M, output $5/M. O1 documents full-request multipliers above 272K input (2× input/cache, 1.5× output), Fast 2× Standard, and regional processing +10% where available. These conditions cannot be ignored merely because the base model row is cheap. A narrow adapter should explicitly fix the applicable service/cache policy and accepted input range instead of multiplying an unspecified menu of tiers. This is a derivation conditional on those premises, **not** a newly claimed OpenAI hard dollar-cap contract.

A very large conservative context-derived reservation could be finite, but (a) the sources do not establish that Pi's estimate is an authoritative bound on the serialized request, (b) a context/output relationship must follow the exact model's documented admission rules, and (c) such a reservation may exceed project/shared allowances. Do not equate “finite” with “fits the approved budget.” A smaller proven bound is needed to make a small advisory pilot practical. The documented input-count endpoint is another API request and not used by the present invocation; adopting it would require explicit scope/call-policy treatment and exact request equivalence, not a silent preflight call.

For settlement, raw terminal provider usage must be associated with the exact invocation/request/model and validated for completeness. Record response/request identity, stop/incomplete status, input totals, cache-read/write breakdown including retention-specific rates, output total and reasoning detail, actual service tier, price version, and upward-rounded derived cost. L4 normalizes usage and computes catalogue-based costs; it does not preserve all the raw retention-specific breakdown in its normalized usage object. A Pi catalogue cost is a client calculation, not an authoritative provider invoice. Provider token counters plus verified pricing can support a derived actual charge, clearly distinguished from billed-account reconciliation.

Missing terminal evidence, default zero counters, a failed attempt with unknown remote acceptance, unknown cache/service tier pricing, or lost accounting must return `null`/unknown to the boundary and retain the entire charge/capacity. Do not replay an uncertain request, release it on PID absence, or treat the reserved worst case as known actual usage. R3 already embodies this hold behavior.

## Feasible minimal integration versus blockers

### Reuse, do not replace

Keep fixed model policy, `diagnoseProject`, frozen saved-run inputs, journal reservation-before-spawn, proposal-only parsing, and unknown-accounting holds. For the narrow MVP, admission should remain explicit: one owner-approved named ticket with its exact saved run; no automatic project inventory scanning, scheduler activation, repair execution, or provider fallback is needed to resolve this boundary.

The smallest useful **implementation scope for a later approved change** is hardening the existing Pi path plus one trusted host boundary, not a separate OpenAI client implementation:

1. Pin/validate the actual Pi/Pi-AI release and positively resolve the exact model/provider/API/endpoint before paid launch. Freeze all effective runtime inputs without discovering arbitrary user model overrides or extensions.
2. Provide an auditable supported path to enforce the complete input bound and `max_output_tokens` on the actual serialized OpenAI request, reject unexpected tools/service/cache settings, and refuse every extra generation request. Explicitly disable agent/provider retries, compaction, continuation and cache warming; do not rely on the word “print.” No such surface is proven by the current argv.
3. Capture terminal provider usage durably in the surviving boundary while passing only validated assistant diagnosis text back to R3's `parseDiagnosis`. Pi JSON events are a possible existing observation surface (L5), **not a drop-in change**: R3 currently expects plain diagnosis JSON and bounds stdout accordingly. JSON event envelopes/thinking/usage require a bounded parser and separate accounting/output treatment. Raw terminal evidence is needed to distinguish missing counters from true zero and retain pricing details.
4. Enforce owned-group deadline/cleanup independently of the controller and retain exact ownership/fence/process identity. Separately prove the remote request remains within its preaccepted ceiling even if all local processes die. O8 does not offer cancellation of this ordinary foreground stream via the background cancel endpoint.
5. Demonstrate request count, accepted payload bounds, crash behavior, terminal usage association, and ambiguous-accounting holds with offline transport-level evidence before proposing an owner-authorized paid pilot. No live call is needed or authorized by this research.

These are prerequisites, not a claim that a current `DiagnosisBoundary` adapter exists. The library exposes useful options/hooks (L2/L7), but using a new extension, changing the invocation, or changing Pi must be explicitly scoped against R3's “only supplied fresh Pi invocation” requirement. Research does not silently authorize it. Account budgets are only secondary defense and cannot replace these prerequisites.

### Concrete blockers and smallest next owner decision

**Established blockers for an unchanged print invocation:** no per-reservation serialized request/input/output gate; no established one-generation-call policy across retry/compaction/warming; text stdout is not authoritative final usage; no demonstrated controller-independent enforcement/accounting adapter. Exact model support is **not** a blocker.

If the existing approved MVP scope already authorizes a focused existing-Pi hardening change, there is no new provider/model/product decision to ask the owner: the parent can scope that work and retain paid-work holds until its evidence exists. If that scope permits **only the unchanged current print argv**, the smallest real owner decision is:

> May this MVP include the minimal existing-Pi invocation/runtime hardening and trusted boundary needed for fixed Terra request ceilings, exactly-one-call behavior, durable usage capture, and independent cleanup, while retaining unknown-accounting holds; or should paid diagnosis remain disabled?

Do not ask the owner to choose a different provider/model, approve an alternative stack, supply credentials, or accept an arbitrary budget before this specific integration question is resolved. No provider guarantee discovered here justifies weakening `DiagnosisBoundary`.
