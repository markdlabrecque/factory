# Advisory source acceptance and operator-held evaluation

This reference owns the source release matrix, sanitized evidence index and future
operator procedure. It does **not** authorize installation, configuration, credentials,
a paid call or pilot. See [authority contracts](supervisor.md), [CLI contracts](factory-cli.md#explicit-advisory-diagnosis)
and [test commands](../TESTING.md#source-acceptance-release-pack).
The companion [machine-readable index](supervisor-acceptance.json) pins the immutable
T12 baseline; current T13 final-head gates belong in the PR/epic delivery ledger,
not an invented self-hash in this document.

## Current status and next gate — 2026-11-17

**Source/offline delivery is complete.** [Epic 257](https://github.com/markdlabrecque/factory/issues/257)
and all fourteen child tasks were completed through separate reviewed PRs into
`develop`. The final source acceptance merge is
[`85c61ad11d35512cde8cacfd41e23710d7f17429`](https://github.com/markdlabrecque/factory/commit/85c61ad11d35512cde8cacfd41e23710d7f17429)
via [PR 285](https://github.com/markdlabrecque/factory/pull/285). Its final delivery
ledger records 1,084 mandatory-suite passes, 12 separate lifecycle passes,
eight documentation checks, independent review and six green hosted checks on
the reviewed head. These are completed source gates, not live-provider evidence.

Subsequent, separately approved local work installed the accepted source from
`/home/mark/Projects/factory/code`; the installed and source workflow digests
matched, and local/Tailscale Board HTTP checks passed. This is one local operational
observation, not general installed compatibility, rollout or pilot acceptance.
The installed host/selected runtime used for evaluation is
`6f123be45e5393170bc681beb0e7dd6bdf9c587119ef706359b26895bfe18efe`, distinct from
historical fixture identities below.

The [private evaluation ledger](https://github.com/markdlabrecque/factory-advisory-eval/blob/main/EVALUATION.md)
records a genuine managed OpenAI/Pi run in a separate tracker namespace. It stopped
on the deliberately missing operator-approved original, preserved work and retained
real execution/custody/failure evidence. Real installed host preparation, without
invoking the provider boundary, accepted that saved run and finite policy with no
preflight hold and no supervisor reservation or exclusion acquired.
**Real advisory generation, its usage/settlement, useful advice and live unchanged
reuse remain NOT RUN.** The real implementation call does not prove that advisory
provider boundary.

The current goal is [ticket 286](https://github.com/markdlabrecque/factory/issues/286):
prove and, if compatible, implement the existing OpenAI provider's Pi login-backed
authentication with the explicitly revised subscription target/accounting contract
and retained ownership guarantees. The pinned Pi serializer omits output-cap/cache fields for ChatGPT
login requests; accepting a bearer token alone is not sufficient. The chosen next
step is supported login-backed source work, not obtaining a separate API key.
The [original investigation](research/supervisor-openai-boundary.md#pi-login-capability-disposition-ticket-286-2026-11-17)
recorded **BLOCKED under the original hard-bound contract**. The owner then
explicitly approved a revised subscription contract: 4,096-output-token best-effort
local/post-response target, no guaranteed remote cap or API-dollar ceiling, honest
token logging and unchanged one-call/ownership/replay safeguards. Source support
now adds explicit `--auth pi-login` and a matching private subscription profile
through the real owned pipeline, not a token accepted under the API-key profile.
The [provider contract](design/supervisor-provider-contract.md#owner-approved-subscription-profile)
details its limitations. Known overruns remain known and require a human rather
than publishing advice; unknown usage/cleanup retains charge/exclusion/pins.

New evidence is **synthetic/offline only**: actual pinned login serializer and
journal permission; bounded fake auth and failures; known subscription settlement,
original-receipt runtime/exclusion release and auth-free reuse in the existing
normal producer; unknown subscription/no-replay in copied public journey B.
Journey A continues to exercise known API-key behavior. No live login, token export,
backend acceptance, real usage or cleanup was tested. Historical acceptance JSON
stays immutable; this change does not install, activate, consume/reset an
operational allowance or authorize evaluation resumption. After final source
review/checks and separately approved controlled installation, recheck the retained run,
policy, controls and truthful rollout attestation before resuming the approved
one-call evaluation. Changed profile/spend premises require owner review; no
ambiguous replay, new allowance or implementation rerun is implied.

At the 2026-11-17 22:13 UTC handoff, the global scheduler timer was enabled/active;
Factory, the evaluation project, Convoke and R2 were paused, and Island Health was
not opted in. This is a dated observation, not a permanent configuration or an
instruction to enable/unpause anything. Re-read current controls before any work.
Broader autonomy, remedies and the original action acceptance remain separate.

## Historical acceptance checkpoint and evidence boundaries

The following T12/T13 checkpoint describes evidence before the final PR 285 merge.
Its pending source-gate wording is historical; the completed source disposition and
current operational gates are recorded above. Original artifacts and results are
retained without promoting synthetic/offline evidence to live-provider proof.

Baseline: develop merge `7734ba95c8358b49db87733be8a2d477775d8549`, reviewed
head `f9ef921e74a60aa81fc8deb5b8bf0583b4910dbf`, base
`158df745bb2e3b24892cd809c60f3df3c3f53823`.
The index retains all thirteen source merges (T00–T12), artifact digests and exact
fixture runtime/dependency identities. Those identities describe disposable fixtures,
**not shipping installed runtime IDs**. Evidence under `/tmp/factory-257-live` is
local, not a durable remote attachment; missing/unavailable bytes block independent
reproduction until restored or regenerated by the offline commands. Hashes establish
identity, not correctness, remote availability or permission.

T12's hosted [run 44139063054](https://github.com/markdlabrecque/factory/actions/runs/44139063054)
had six green checks; its parent gates were 295/239/346/204 = 1084 passes plus
12 separate lifecycle passes; independent focused review had 10 passes. These are
**historical**, not T13 acceptance. T13 needs actual current-head focused/docs,
all four unchanged shards, separate lifecycle, independent safety review, latest
base reconciliation and six hosted checks, followed only by an ordinary SHA-guarded
merge if authorized. Parent release coordination records final head, reviewed head,
base/merge SHA, check URLs, findings/disposition and actual counts after those gates.
Local T13 verification on this documentation working tree passed: focused supervisor
115, documentation 8, mandatory shards 295/239/346/204 = 1084 and separate lifecycle
12; logs are `271-focused.log`, `271-docs.log`, `271-shard-{1,2,3,4}.log` and
`271-lifecycle.log` under the evidence root. They do not assert a future final SHA,
hosted checks or independent review. At this pre-merge checkpoint,
release/merge acceptance was **BLOCKED**; PR 285 subsequently finalized those
source gates as recorded above. No child closure automatically
establishes epic acceptance: explicitly compare this matrix and the epic's public
CLI/Board, ownership, accounting, complete-original and no-effects requirements.

Historical [audit PR 255](https://github.com/markdlabrecque/factory/pull/255) remains
unmerged/red, not green or acceptance evidence; do not cherry-pick it. Its older
component-proof-only framing is obsolete for the merged advisory path: two actual
copied public CLI journeys now connect the real host and pinned SDK. That progress
does not retroactively accept that PR, prove remote behavior, or complete original
[acceptance 243](https://github.com/markdlabrecque/factory/issues/243), broader
[autonomy 231](https://github.com/markdlabrecque/factory/issues/231) or
[continuation 228](https://github.com/markdlabrecque/factory/issues/228).
All remain separate; ready-for-agent stays absent. Source acceptance is not an
installed MVP, remote acceptance, model-quality evaluation or completed pilot.

### Human acceptance matrix

Artifact paths below are relative to `/tmp/factory-257-live`; the JSON index hashes
the retained artifacts. Actual local execution may consume synthetic inputs;
“actual” never promotes the latter into provider/operator/platform proof.

| Claim | Actual artifact / cheapest proof | Synthetic boundary or explicit blocker |
| --- | --- | --- |
| Fixed exact API/model, complete bounded request | `260-transport-evidence.json`, `270-artifacts/journey-a.json` request; real digest-pinned serializer and final gate | HTTP/SSE synthetic; remote server acceptance NOT RUN |
| Finite all-in token/cost reservation | `260-index.json`; [provider premises](design/supervisor-provider-contract.md#complete-input-and-remote-spend-bound), arithmetic/profile units | Server admission and price premises, not locally measured tokenization or an invoice |
| No hidden second generation | `260-transport-evidence.json`; induced real SDK error/retry paths; journey A unchanged reuse | Transport denied outbound; no real provider retry experiment |
| Known or honestly unknown terminal usage | `261-index.json`; journey A settlement/receipt; journey B null actual | Raw parsed SSE fields synthetic; normalized Pi defaults are not usage proof |
| Controller-independent local bound | `262-index.md`, journey B owned process/cleanup and post-directory-fsync SIGKILL | Native processes/IPC/fsync actual; watchdog does not prove remote cancellation |
| One owner across managed conflicts | `263-index.md`, `264-index.json`, journey B admission/manual-run refusal | Shared-store interprocess/entry guards actual; unmanaged/old installed writers NOT PROVEN |
| Complete originals and fresh basis | `265-delivery.md`, journeys' frozen source hashes/basis/prior set | Tracker originals fixture-owned; missing/stale/oversized originals hold, never truncate |
| Reserve before request, monotonic crash settlement | `267-final-index.md`, journeys' revisions/grants/send receipts/charges | Native store/host/process composition actual; known response/usage synthetic |
| Selected bundle/dependency identity | `266-index.md`, journeys' manifests/protected leases; four archive hashes in JSON | No-op installer not SDK proof; actual loader is proof. Installed compatibility NOT RUN |
| Public CLI/Board advice and stop | `270-index.json`, journeys A/B; A fresh status/explain/Board/reuse, B durable Human after fsync/controller loss | Exactly two copied journeys, not direct worker calls; Board production projection, not browser E2E |
| No effects, work preserved | journeys' dirty/index/refs/worktree/raw-run comparisons and rejecting program traps; `264-index.json` | Normal producer sandbox/agent/Docker synthetic. No dispatch/recovery/review/gate edit/delivery/notification authorized |
| Historical T13 release checkpoint | Original logs/results and final [PR 285 ledger](https://github.com/markdlabrecque/factory/pull/285) per TESTING.md | Pending at document creation; source gates finalized in PR 285, not live-provider acceptance |
| T14 real provider acceptance and useful diagnosis | **NOT RUN / BLOCKED** pending separate explicit paid operational approval and eligible host | Out of source epic scope; synthetic typed wait/SSE JSON is not useful model judgment |

A: one request, known input 25/output 10/reasoning 8/total 35, derived upper charge
220 micro-USD; cumulative charged remains 1,054,096 tokens / 5,808,792 micro-USD.
Journal ends revision 6, admission holds and protected pins released after exact
receipts/cleanup. Fresh CLI reuse adds no request/reservation/charge/hold/pin.
B: one request; terminal usage absent, actual null, full same reservation retained,
revision 6, stopped/human-required/ambiguous, exclusion and protected pins retained.
Public stop exits 1 pending; passive status exits 0, replacement diagnosis and
managed manual run exit 1; the controller exits SIGKILL only after real human
journal parent-directory fsync. Native group absence is distinct from accounting
certainty. No-send is not inferred from missing records.

## Capability and price prerequisites (read before any future approval)

* Fixed OpenAI Mid `openai/gpt-6.1-terra`, high thinking, fresh tool-free direct
  Pi-AI Responses route; no fallback/escalation, sessions or continuation.
  Pi-AI/telemetry **1.5.2**, OpenAI **7.19.0**, partial-json **0.1.7** are the
  four archive closure in `cli/src/supervisor-provider/manifest.json` and the index.
  Global/external Pi print CLI is a separate compatibility surface, not this adapter.
  Its version/login/flags are neither finite-bound evidence nor silent fallback.
  A changed SDK/CLI ABI, archive, complete override or dependency selection holds
  until separately reviewed and proved; do not install/update anything here.
* Use only existing [primary provider research](research/supervisor-openai-boundary.md)
  and the [versioned contract](design/supervisor-provider-contract.md). Profile
  `terra-standard-2026-11-17-v1` assumes server `truncation: disabled`, accepted
  all-in input bound I=1,050,000 and server output cap O=4,096 including reasoning.
  Reserve **1,054,096 tokens / 5,808,792 micro-USD ($5.808792)** before send.
  Fixed default/Standard service only; conservative input $5.50/M and output
  $8.25/M cover documented cache-write, long-input and regional premiums. Unknown
  or changed price/service/server premises are a **BLOCKER**, not a new assumption.
  This is fixed policy reservation versus usage-derived upper actual charge,
  never actual billed dollars; account alerts/soft budgets cannot substitute.
* Actual request fields: POST `/v1/responses`, exact model, stream true, store false,
  max_output_tokens 4096, service_tier default, explicit unmarked cache and disabled
  truncation. Pinned serializer emits top-level reasoning medium followed by final
  configuration_update high, effective for the next response. Do not “correct”
  this to an invented top-level-high trace. Zero SDK retries plus one-use final
  gate prevent further generations. Parsed terminal identity/cache/service/input/
  output/reasoning/total fields must validate before known usage; missing means unknown.
* Registered canonical source-owned current saved run with sealed normal custody,
  complete stable child/parent/comments/guidelines/Factory/gate/failure/prior-decision
  originals, compatible host/selected bundle, host-only mounts/resources and exact
  admission ownership are mandatory. Status/explain are passive, not readiness,
  rollout validation, provider probes or authorization.

## Future operator-held procedure — do not execute under source approval

1. Obtain **separate explicit paid approval** naming project, current ticket/run,
   one additional call, maximum exposure and observation window. It must already
   be eligible under global **ON**, registered opted-in/unpaused project and finite
   host/project/role controls. Do **not** turn on Factory services, opt in or unpause
   a project merely to diagnose. A new advisory-specific authorization switch is
   deferred. If the existing controls are inappropriate, remain BLOCKED.
2. Record a measured passive baseline with the exact selected host/Node/CLI paths,
   source/runtime/dependency/profile identities, UTC observation, saved-run/basis/
   original hashes, journal revision, existing owners/holds/pins and cumulative
   host/project/role calls/tokens/micro-USD. Also privately compare dirty/staged/
   untracked work, index, refs, parked worktrees and raw run bytes. Distinguish
   cumulative **charged reservation** from known derived usage and count unknown
   reservations at their **full reserve**, never zero. Passive read absence is not
   zero capacity or proof of installed quiescence.
3. A future approved human, not this change, provisions finite private
   `Paths.config/supervisor.json` using the [strict host schema](project-config.md#advisory-host-policy-source-foundation)
   and all finite `[supervisor]`/diagnosis/review TOML limits. No public provisioning
   command exists. For one additional call, each applicable cumulative remaining
   allowance must fit at least 1,054,096 tokens, 5,808,792 micro-USD and one call,
   with host capacity one; add these to the measured cumulative history, not a
   fresh home/store or reset. Preserve tighter incident limits and configured
   timeout. This arithmetic is not permission to raise a cap or retry unknown work.
4. Independently quiesce older managed runtimes and unmanaged work sharing state;
   inspect legacy records and host-only isolation. Admission **v2** migrates validated
   v1 on commit only; old v1 readers reject v2. Protected runtime leases are also
   **v2**, incompatible with old GC/readers. Mixed versions are unsafe. Human
   attestation does not discharge unknown custody/claims or establish automated
   quiescence. A future approved operator may supply the exact
   [rollout record](factory-cli.md#operator-rollout-attestation): strict version 1,
   canonical project/structured tracker and host/hostDependencies/selected/dependencies,
   canonical UTC recordedAt/expiresAt window <=24h and explicit true
   olderRuntimesQuiesced/unmanagedWorkQuiesced. Current UID owns canonical directory
   0700 and regular single-link file 0600, bounded 16 KiB stable fatal UTF-8, outside
   project/runtime mounts. Full configured timeout must fit. The CLI reads it fresh
   before authorization/publication and pins identity in policy/grant; it never
   creates it. Renewal is not basis, spend reset, enable or replay authority.
5. Inspect the exact project, using its already selected compatible CLI (replace
   selector with the approved registered canonical path; do not execute placeholders):

   ```sh
   factory supervisor status --project <name-or-path> --json
   factory supervisor explain --project <name-or-path> --json
   ```

   Compare revisions across `--offset <nonnegative-integer>` pages. Holds are
   successful observations (exit 0), not permission. No auth retrieval now or as
   part of inspection. Only a future explicitly approved API-key environment
   handoff via `OPENAI_API_KEY` is supported; no auth-file discovery/1Password.
6. Only after all prerequisites and paid authorization, explicitly invoke once:

   ```sh
   factory supervisor diagnose <ticket> --project <name|path> --json
   ```

   **Not a dry run: this can SPEND.** Exit 0 proposed/reused; 2 retained human-required;
   1 held/invalid/failed; SIGINT/SIGTERM return 130/143 after owned cancellation.
   Capture sanitized IDs/accounting/output kind, then fresh status/explain and
   passive Board observations. Exact unchanged reuse is free but is not permission
   to probe a changed basis. Do not loop/retry. Have a human judge rationale against
   complete originals, correctness, lawful alternatives and usefulness separately
   from typed JSON validation. T14 remains NOT RUN until that evidence exists.

## Stop, held reconciliation and rollback

```sh
factory supervisor stop --project <name-or-path>
```

Stop writes a durable fence; exit 0 only with no unsettled workers, exit 1 means
cancellation pending. Already authorized work may remain remote/inflight. Wait on
its existing owned deadline/termination boundary and inspect exact original receipts;
PID death/pipe close/timeout/HTTP success is neither cleanup nor remote cancellation.
Never raw-PID kill or reconstruct groups/grants. Preserve full charge and exclusion.

Known closure uses original immutable grant/authorization/known terminal usage,
process/cleanup receipts and fresh whole-group ESRCH. Normal host closure releases
exact runtime lease then admission hold. Interrupted known closure has **API only**
`reconcileSupervisorHost(paths, originalHold, originalLease)` and read-only
`inspectSupervisorHost`; no public `--reconcile` flag or operator reconciliation
command exists. A qualified separately approved source integration must use exact
original records, not a hand-built token. Foreign successors refuse; release never
refunds cumulative charge. If no supported operator path exists, stay held and
escalate rather than invent a shell repair.

Unknown usage/cleanup, absent receipts, no-send uncertainty or early controller loss:
**remain BLOCKED**, retain journal, full reserve, admission hold and runtime pins;
no replacement, journal/lease deletion, new state/home, reset/refund, replay or
version downgrade. Existing exact `factory supervisor resolve` syntax is in
[human resolution](factory-cli.md#supervisor-human-request-resolution); it refuses
unsettled accounting, and abandonment/material-successor audit is not approval,
reset, launch or release. Delivery receipts and tracker comments are not resolutions.

Rollback first means fence new supervisor work and preserve evidence. Old binaries
cannot safely read v2 admission/protected leases; reverting code alone is **not**
a state rollback. Keep compatible readers/writers/GC and pins until exact closure;
never strip exclusions or restore an old journal to regain allowance. Installation,
service shutdown, migration and any wider rollback need separate human authorization.
There is no automatic one-way schema downgrade or safe uncertain replay procedure.

## Reproducible sanitized release pack

Run only the offline commands in TESTING.md. `FACTORY_270_EVIDENCE` is a test-harness
output directory, **not a production capability flag**. The harness's raw fixture
exports contain synthetic prompts/stdout/base64 originals; keep them local and do
not attach them wholesale. The committed JSON is an allowlist projection:
source/base/merge IDs; file SHA-256/byte counts; fixture platform/runtime/dependency/
archive/profile IDs; command verbs/exits/state; journal revision, basis/source
hashes, grant/send/usage/process/cleanup IDs; reserved/nullable known usage; hold/pin
counts and explicit effect/preservation assertions. No auth headers, fake or real
keys, raw prompts/stdout/stderr, hidden/encrypted reasoning, raw terminal text or
complete originals belong in attachments. Retain private originals separately for
trusted inspection. Label every platform/operator/SSE assertion synthetic and every
operational omission NOT RUN. Independently verify digests and findings; an index alone is not a test result.
For this retained baseline, the following read-only check verifies every indexed
artifact against local bytes (no network, credentials, production state or installation):

```sh
python3 - <<'PY'
import hashlib, json, pathlib
index = json.loads(pathlib.Path('docs/supervisor-acceptance.json').read_text())
root = pathlib.Path(index['artifactRoot'])
for artifact in index['artifacts']:
    data = (root / artifact['path']).read_bytes()
    assert len(data) == artifact['bytes'], artifact['path']
    assert hashlib.sha256(data).hexdigest() == artifact['sha256'], artifact['path']
print('All retained baseline artifact digests match')
PY
```

Offline reruns generate fresh fixture paths/process/receipt identities, not identical
journey bytes: retain those new raw exports privately, build the same metadata
allowlist, and index their actual new digests alongside exact source/gate identities.
Never reuse this baseline's receipt IDs as runtime authority. If artifacts are missing or storage/inodes fail, report
an infrastructure blocker—never delete evidence, reduce deadlines/coverage or waive gates.
