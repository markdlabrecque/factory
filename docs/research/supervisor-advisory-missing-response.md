# Why advisory can lose the HTTP outcome after send authorization

**Finding (2026-11-19):** the installed Pi-login advisory path can record one-use send authorization but lose the distinction between transport rejection and an HTTP error. The offline reproduction confirms that observability defect. It does not establish the live provider's response, show that no request was transmitted, or permit replay.

## Retained evaluation evidence

The one authorized invocation for the [fresh evaluation fixture](https://github.com/markdlabrecque/factory-advisory-eval/issues/1) used installed source `b12e0db1ec46158b7b08bed34fb95229ff4b0cc7`, pinned Pi AI 1.5.2 and OpenAI SDK 7.19.0. The durable send authorization was recorded at `22:44:43.551Z`; the original cleanup receipt recorded group absence at `22:44:44.075Z`, well before the `22:46:28.341Z` grant deadline. An offline signal-zero check also found the exact recorded group absent. Neither observation settles usage.

The original terminal record reopens successfully through `readProviderUsage`. Its raw grant and authorization identities match; it contains no HTTP response metadata, request ID, response ID, raw terminal event or complete stream. The receipt's `identity` reason is the validator's category for missing required request/response identity, not an authentication diagnosis (`supervisor-openai-usage.mts`, `providerUsage`). The reservation is ambiguous, full token debit retained, and no settlement exists. The evidence was not rewritten and no process was terminated by the investigation.

## Where the distinction is lost

1. [`supervisor-openai-request.mts`](https://github.com/markdlabrecque/factory/blob/b12e0db1ec46158b7b08bed34fb95229ff4b0cc7/cli/src/supervisor-openai-request.mts#L105-L151) validates the wire payload, consumes one-use authorization, and returns the native fetch promise without recording whether fetch rejected or returned a response. It obtains response metadata only via Pi's `onResponse` callback. Its terminal callback observes stream events, not HTTP request errors.
2. In the digest-verified `pi-ai-1.5.2.tgz`, `package/dist/api/openai-responses.js:150–155,175–190`, `onResponse` runs only after `client.responses.create(...).withResponse()` resolves. Errors before the callback become a normalized error result. The digest-verified `openai-7.19.0.tgz`, `package/client.mjs:794–841,847–920`, surfaces fetch rejection as a connection error and throws for non-2xx before resolving `.withResponse()`.
3. [`supervisor-runner.mts`](https://github.com/markdlabrecque/factory/blob/b12e0db1ec46158b7b08bed34fb95229ff4b0cc7/cli/src/supervisor-runner.mts#L31-L40) persists selected metadata and emits only assistant text. [`captureProviderEvidence`](https://github.com/markdlabrecque/factory/blob/b12e0db1ec46158b7b08bed34fb95229ff4b0cc7/cli/src/supervisor-openai-usage.mts#L16-L29) deliberately drops error prose. Thus the live record cannot distinguish a fetch rejection from a non-2xx response; an empty 200 stream as reproduced below has a different signature because the hook records status 200.

## Offline reproduction

Extracted the four exact installed archives after checking SHA-256 against the pinned inventory. Ran the real pinned Pi stream with the fixed advisory model, a synthetic bearer-shaped value, an in-memory custom fetch, zero retries, and production metadata selection. Native fetch and socket connect were disabled in the diagnostic process. No Factory invocation, credential access, endpoint traffic, or change to live state was involved.

| Synthetic transport result | Attempts | Pi response-hook status | Terminal event / complete stream |
| --- | ---: | --- | --- |
| Fetch rejection | 1 | None | None / no |
| HTTP 401 | 1 | None | None / no |
| HTTP 429 | 1 | None | None / no |
| HTTP 503 | 1 | None | None / no |
| HTTP 200, empty SSE | 1 | 200 | None / no |

The first four reproduce the live receipt's missing-response shape. They are counterexamples to inferring bad login, rate limit, service failure, or network failure from that shape alone. They are not live root-cause candidates ranked by likelihood.

Independent source inspection also confirmed that buffered metadata can be lost if the worker exits before publication or the request adapter throws after the hooks run. That general failure mode is distinct from this invocation: its terminal file exists and contains matching raw authorization identities, without a serialization-fallback marker. The receipt is not simply missing, and the retained fields are not the runner's empty fallback after an adapter throw.

## Smallest follow-up

At the already-owned native fetch boundary, capture a bounded transport outcome before the SDK interprets it: fetch rejected vs. HTTP response returned, with status and an allowlisted, strictly validated request ID if present. Project fixed categories only; do not persist error bodies, exception strings, authorization headers, or arbitrary headers. Keep this observation distinct from terminal usage; a status or transport failure must not produce known zero usage, clear a charge or owner, or permit another send. A focused offline test with injected fetch can prove the distinction without touching real auth or the network.

The current pilot remains held. Keep its full charge, exclusion and pins unless the supported exact settlement prerequisites are established. Any future live evaluation needs separate approval and must not replay the ambiguous invocation.
