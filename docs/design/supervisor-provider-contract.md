# Constrained advisory Pi request contract

Scope: source/offline T00 selection and T02 direct-request implementation for
[258](https://github.com/markdlabrecque/factory/issues/258) and
[260](https://github.com/markdlabrecque/factory/issues/260).
This selects and implements a supported request surface, **not a complete `DiagnosisBoundary`,
public diagnose command, paid permission or operational acceptance**. Existing paid
launch holds remain. The fixed role is `openai/gpt-6.1-terra`, high thinking.

## Login-backed capability hold

The [ticket 286 investigation](../research/supervisor-openai-boundary.md#pi-login-capability-disposition-ticket-286-2026-11-17)
proves offline that this pinned serializer's OpenAI Sign in with ChatGPT branch
omits the approved `max_output_tokens: 4096` and explicit cache mode, and replaces
the configuration-update sequence with top-level high reasoning. The current
payload gate correctly refuses it before transport. No runtime auth selector,
credential discovery, fallback, dependency change or relaxed payload contract is
introduced. A supported login-specific remote ceiling and compatible usage/cache/
accounting contract remain prerequisites; a bearer-export interface alone is not
sufficient. The API-key contract below remains unchanged. Subscription usage is
not an API invoice, and source findings do not unblock the live evaluation.

## Selected supported surface

Use the **direct Pi-AI OpenAI Responses SDK**, in a fresh trusted owned child, not
Pi print mode or a coding-agent session. Pi's published README, “Calling API
Implementations Directly”, supports
`@earendil-works/pi-ai/api/openai-responses`'s `stream(model, transcript, options)`.
It uses Pi's existing serializer and OpenAI SDK, not another provider stack.
The worker's current print argv must be deliberately adapted in T04; this spike
neither changes the worker nor treats its current argv as enforcing this contract.

Pinned source: `@earendil-works/pi-ai@1.5.2`, resolved OpenAI SDK `7.19.0`,
`@earendil-works/pi-telemetry@1.5.2`, `partial-json@0.1.7`. Unmodified published
archives and SHA-256 identities live in
[`cli/src/supervisor-provider/manifest.json`](../../cli/src/supervisor-provider/manifest.json).
The Pi serializer/catalogue hashes match the earlier
[research](../research/supervisor-openai-boundary.md). Archive metadata was obtained
anonymously from npm and each download verified against npm's SHA-512 integrity.
No credential discovery, lifecycle script or installation ran. T02 generated the
actual provenance lock using anonymous package-lock-only metadata resolution with
fresh temporary HOME/cache and empty npm config; this did not install packages.

The fixture extracts these exact artifacts into a disposable private module tree.
This is the **reachable dependency closure of the selected public subpath**, not a
complete Pi installation: Pi-AI's manifests declare other providers' dependencies
which this path does not import. Original package manifests, source, licenses and
README files are retained in the archives; nothing is rewritten or imitated.
T02 ships this closure, its manifest and actual provenance package/lock files as
complete-runtime assets. The lock records all upstream provider dependencies; the
offline loader deliberately exposes only the selected subpath's four-package
closure, not an all-provider npm installation. It hashes archive bytes, copies the
verified bytes into private scratch before extraction, and verifies original
package versions plus serializer/catalogue hashes before imports. There is no
source/test/host/global dependency fallback or immutable-runtime mutation. Any
enlarged import surface needs a new complete inventory. T00 itself added no
production module; T02 adds the final request adapter and these selected assets.

### Actual ordering and fail-closed primitive

`pi-ai/dist/api/openai-responses.js` builds parameters, awaits `onPayload`, then
calls `client.responses.create`. A rejected direct SDK callback enters the outer
catch and emits a Pi **error result** before transport. It is not necessary for
`stream()` itself to throw. The SDK accepts an injected `fetch` passed to the real
OpenAI client. Validate the final serialized URL/method/body there as well as the
payload hook, consume exactly one permission **before forwarding**, and never
restore it on failure. No mutable/untrusted callback may run between authorization
and send. The actual T02 final transport gate now consumes T01's same-lock journal primitive
in the copied-runtime fixture too. No eligibility bit or injected authorization
callback can substitute for it. A trusted HTTP seam is only below authorization.

An extension `before_provider_request` throw is unsuitable: the extension runner
catches errors and proceeds with the payload. Do not replace the direct gate with
that hook. `onProviderStreamEvent` on the direct SDK is awaited before usage
normalization and exposes parsed terminal provider events; it is not raw HTTP
bytes or an invoice.

Freeze the exact model/provider/API/base URL, text-only transcript, no tools,
resource discovery, fallback, continuation or agent session. Explicit options are
`maxTokens: 4096`, `reasoningEffort: 'high'`, `cacheRetention: 'none'`,
`serviceTier: 'default'`, `maxRetries: 0`, synthetic-only `apiKey` in the fixture,
and no ambient provider environment. The actual pinned catalogue uses
`supportsMidConvoEffort`: **the wire top-level effort is `medium`, followed by a
terminal `configuration_update` input item with effort `high`**. The documented
Responses configuration-update contract makes this effective for the next
response. Validate this exact sequence rather than incorrectly asserting the
wire top-level field is high. No later update or prior assistant turn is allowed.
The final payload explicitly adds `truncation: 'disabled'` through the supported
payload hook and requires server `max_output_tokens: 4096`, `store: false`,
`stream: true`, `prompt_cache_options: { mode: 'explicit' }`, with no cache marks,
background work, tools, previous response, URLs, images or arbitrary extra fields.

## Complete-input and remote spend bound

Primary provider premises, retrieved anonymously for this investigation:

1. [Terra model reference](https://developers.openai.com/api/docs/models/gpt-6.1-terra)
   documents a **1,050,000 token context window** and 128,000 maximum output.
2. [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
   documents that `truncation: disabled` rejects input exceeding the model's context
   window with HTTP 400. Some models reserve their maximum output allowance even
   when a smaller output cap is selected; this can only lower admitted input.
   `max_output_tokens` bounds generated tokens, including reasoning; invisible
   formatting tokens count toward output usage. Configuration updates support
   `reasoning.effort: high` for subsequent responses.
3. The same model page documents Standard rates and long-input/region premiums.
   [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
   documents explicit-only caching; the actual wire policy is checked, not inferred
   from the option's English name.

Use **I = 1,050,000**, a conservative server-admission bound on all accepted input,
including system framing and configuration items, **not** an estimate from bytes
or Pi's local catalogue. Its `272000` context setting is not OpenAI's server
ceiling; calling the direct `stream` avoids `streamSimple`'s estimated context
clamp. Do not increase the catalogue or claim that small fixture input proves
exact tokenization. No token-count request is needed or authorized. Oversize
rejection and actual server enforcement remain provider-contract premises, not
facts established by synthetic HTTP.

Use **O = 4,096**, within the documented output maximum and above the minimum 16.
Reserve **I + O = 1,054,096 tokens**. This large reservation is deliberate: no
small-prompt byte heuristic can justify a smaller token allowance. If any incident,
project or cumulative host budget cannot fit it, refuse before authorization.
T01's policy must preserve that refusal; source feasibility is not a claim of
current configured budget fit or pilot practicality.

For a conservative all-in ceiling, even though explicit-only unmarked input should
not write cache, cover the worst documented 12-hour cache-write input rate and
long-input and regional premiums. Standard input/cache maximum is
`$2.50/M × 2 × 1.10 = $5.50/M`; output is
`$5/M × 1.5 × 1.10 = $8.25/M`. Cache-write rates are total rates, not added again.
Only default/Standard service is allowed: no Fast/priority, Batch, Flex, additional
service fees, tool fees or modality charges. Unknown rates or policy invalidate
this profile. The price premises are versioned as `terra-standard-2026-11-17-v1`;
source snapshots are mutable, not a perpetual billing guarantee.

Exact upward-rounded integer arithmetic (USD/M numerically equals micro-USD/token):

```text
reservedMicroUSD = ceil((1,050,000 × 550 + 4,096 × 825) / 100)
                 = 5,808,792 micro-USD ($5.808792)
```

Reasoning is already in O, never added twice. A regional premium is included
conservatively, not a claim to know an account's regional configuration. Final
request policy plus this finite worst case bounds the accepted remote request
independently of all local processes surviving. Watchdogs cannot establish remote
cancellation. Reservation is monotonic and **never measured actual usage**.

## One request and terminal evidence

The direct API calls only one generation; there is no coding-agent retry,
compaction, overflow recovery, cache warmer, tool loop or queued continuation.
Both SDK and provider retries are zero. A one-shot final transport fence remains
necessary against erroneous extra calls, retries or future changes. The same
suite now induces real SDK 429/503/context-overflow error paths, proving one
transmission and no provider/SDK recovery request. A second adapter entry with the
same grant cannot receive journal permission. Extra tool/cache-warm/continuation
payloads are refused; no agent layer that could generate them is instantiated.
Stop-first commits forbid send; stop during an authorized in-flight request retains
its spent receipt. This is actual journal/gate behavior, not a boolean authority
fixture; later controller-death/cleanup/host composition remains separate.

Retain response/request IDs from response headers and terminal raw parsed
`response.completed` / `response.incomplete` / `response.failed` events, including
model, status, service tier, input total and cache-read/write/retention breakdown,
output/reasoning/total tokens, plus exact invocation/profile/price identity.
Terminal status and valid diagnosis text are separate. `onProviderStreamEvent`
exposes fields before Pi defaults absent counters to zero or computes catalogue
cost. Missing or inconsistent counters, identity, required service/cache detail, terminal
stream or durable write means **unknown**, full charge/exclusion retained. The
supported SDK exposes cached/write totals, not retention-specific write details:
this no-write profile accepts explicit raw write=0 without inventing a retention
field; absent write total or positive write is unknown. Any optional retention
breakdown must agree with zero. The source
[usage receipt helper](../supervisor.md#raw-provider-usage-and-private-receipts)
now validates and privately retains selected original metadata plus a strict
scalar receipt. Its exact derived upper charge uses conservative profile rates,
not measured account dollars; normalized Pi counters/cost are never evidence.
This provider-request suite still does not establish owned cleanup or final
journal/exclusion settlement.

## Executable proof and limits

```sh
node --test cli/test/supervisor-openai-request.test.mts
node cli/test/supervisor-provider-fixture.mts --offline-spike
```

One integration test exercises actual unmodified published Pi/OpenAI serialization
in a child with an isolated environment (fixture PATH/HOME/LANG, except explicit
zero-send debug/TLS-override refusal cases), synthetic
non-secret auth, an injected fetch which never delegates, and disabled native
socket/HTTP/TLS paths and global fetch. Archive hash checks precede imports. No
live provider, token-count, tracker, service, registry, Docker or credentials are
reachable from the fixture. Response/SSE content, current host controls, exclusion binding and remote
request identity are **synthetic**. Output contains the actual captured serialized
payload and raw synthetic usage, never real originals or hidden reasoning. Actual
copied-runtime artifact loading, separately registered child PID/start and final
journal authorization bind the exact wire-body SHA-256. Frozen-input mismatch,
inherited provider debug/TLS configuration and corrupted selected archives hold with
zero sends. A deterministic fixture-side filesystem barrier changes actual copied
prompt/dependency bytes after initial validation; final-gate identity validation
refuses before journal authorization. Actual selected prompt bytes also match their
manifest hash before decoding. All reservations remain charged, with no settlement
claim. Duplicate/oversize terminal evidence has an explicit ambiguity flag.

Observed: stopped/invalid input -> zero transport calls; valid journal grant ->
one constrained request; repeated adapter entry -> no second transmission; terminal
raw fields survive before normalized usage. Actual provider acceptance, billing,
tokenization, useful diagnosis, controller-independent watchdog/owned cleanup,
durable usage settlement, public installed host wiring and paid evaluation are
**not run/not proven** here. Later tasks must supply their own evidence; no public
paid command is enabled by this contract.
