# Constrained advisory Pi request contract

Scope: source/offline T00 investigation for [258](https://github.com/markdlabrecque/factory/issues/258).
This selects a supported integration surface, **not a shipped `DiagnosisBoundary`,
public diagnose command, paid permission or operational acceptance**. Existing paid
launch holds remain. The fixed role is `openai/gpt-6.1-terra`, high thinking.

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
[`cli/test/fixtures/supervisor-pi/manifest.json`](../../cli/test/fixtures/supervisor-pi/manifest.json).
The Pi serializer/catalogue hashes match the earlier
[research](../research/supervisor-openai-boundary.md). Archive metadata was obtained
anonymously from npm and each download verified against npm's SHA-512 integrity.
No package manager, lifecycle script, credential discovery or installation ran.

The fixture extracts these exact artifacts into a disposable private module tree.
This is the **reachable dependency closure of the selected public subpath**, not a
complete Pi installation: Pi-AI's manifests declare other providers' dependencies
which this path does not import. Original package manifests, source, licenses and
README files are retained in the archives; nothing is rewritten or imitated.
Production T02/T04 must ship this selected closure with explicit asset identity, or
pin the full dependency graph in real package manifests/lockfiles. It must not use
this test path or depend on a host Pi/global `node_modules`. Any enlarged import
surface needs a new complete inventory. No production module/dependency is added
by T00, and the fixture archives are deliberately not runtime assets yet.

### Actual ordering and fail-closed primitive

`pi-ai/dist/api/openai-responses.js` builds parameters, awaits `onPayload`, then
calls `client.responses.create`. A rejected direct SDK callback enters the outer
catch and emits a Pi **error result** before transport. It is not necessary for
`stream()` itself to throw. The SDK accepts an injected `fetch` passed to the real
OpenAI client. Validate the final serialized URL/method/body there as well as the
payload hook, consume exactly one permission **before forwarding**, and never
restore it on failure. No mutable/untrusted callback may run between authorization
and send. T01 supplies journal authorization, not this fixture's synthetic
eligibility bit. The final production gate must consume that same-lock primitive.

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
necessary against erroneous extra calls, retries or future changes; T02 must
extend this same suite for induced retry/overflow/warming attempts, not duplicate
it. The offline spike forces a second real SDK call through a shared spent fence:
one admitted transmission, second rejected before forwarding. It does not prove
host crash/replay safety or the journal authorization still to be built in T01.

Retain response/request IDs from response headers and terminal raw parsed
`response.completed` / `response.incomplete` / `response.failed` events, including
model, status, service tier, input total and cache-read/write/retention breakdown,
output/reasoning/total tokens, plus exact invocation/profile/price identity.
Terminal status and valid diagnosis text are separate. `onProviderStreamEvent`
exposes fields before Pi defaults absent counters to zero or computes catalogue
cost. Missing or inconsistent counters, identity, service/cache detail, terminal
stream or durable write means **unknown**, full charge/exclusion retained.
T03 owns validation, bounded private retention and exact derived cost; this spike
only demonstrates the actual SDK surface, not durable settlement.

## Executable proof and limits

```sh
node --test cli/test/supervisor-openai-request.test.mts
node cli/test/supervisor-provider-fixture.mts --offline-spike
```

One integration test exercises actual unmodified published Pi/OpenAI serialization
in a child with an empty environment (only fixture PATH/HOME/LANG), synthetic
non-secret auth, an injected fetch which never delegates, and disabled native
socket/HTTP/TLS paths and global fetch. Archive hash checks precede imports. No
live provider, token-count, tracker, service, registry, Docker or credentials are
reachable from the fixture. Response/SSE content, permission eligibility and
request identity are **synthetic**. Output contains the actual captured serialized
payload and raw synthetic usage, never real originals or hidden reasoning.

Observed: invalid permission -> zero transport calls; valid permission -> one
captured request with server output cap and disabled truncation; forced extra
request -> no second transmission; terminal raw fields survive before normalized
usage. Actual provider acceptance, billing, tokenization, useful diagnosis,
controller-independent lifecycle, durable authorization/settlement, copied-install
host wiring and paid evaluation are **not run/not proven** here. T01–T13 must
supply their own evidence; no public paid command is enabled by this contract.
