# Ticket readiness

Readiness is an observation, not permission to execute, verify or deliver. A saved healthy report never authorizes launch. Existing admission fencing, image/browser gates, independent verification, exact-SHA delivery, cleanup and recovery accounting remain in force.

## Start with the observation, not a retry

Tracker selection says which tickets match the project's policy. Factory admission separately decides whether a selected ticket may start. A project hold can exist with zero runs. It does not remove tracker selection, manufacture a queued/stopped execution, or label every ticket needs-human. A ticket-input or workspace hold affects that ticket, not unrelated eligible work.

Use the [CLI commands and exit examples](factory-cli.md#readiness-diagnosis) to inspect the project first, then the ticket. A clean `git status` proves neither write access nor complete tracker input. Conversely, a successful filesystem probe cannot establish that the parent plan was collected.

| Observation | Meaning and limit |
| --- | --- |
| Project scope | Host checkout, selected runtime/configured inputs and required Factory paths. Required blocked/unknown checks hold new launches before analysis/admission. |
| `ticket-input` scope | Required structured child/immediate-parent reads, or a content-hash comparison. Complete transport does not establish semantic plan adequacy. |
| `ticket-workspace` scope | Selected branch/path/registration conflict. Existing work is not disposable just because no process is running. |
| `sandbox` scope | Standard workflow's effective container-user/mount/Git observations after setup, before implementation/repair. Host success does not establish these facts. |
| Current ready | Required operations passed at the recorded time and identity. Not future access, agent success or delivery authority. |
| Blocked or required unknown | A failed operation or missing required fact holds launch. Optional unsupported capacity metrics alone do not. |
| Missing, pending, invalid or stale report | Current readiness is unknown, not proof that the filesystem failed and not a reusable success. |

Inspect `scope`, `phase`, check time, operation/path/errno, runtime/config/context identity, generation, next actor/action and automatic policy together. The display freshness window is 60 seconds. Status and Board check stored age/root association only; doctor also resolves the current runtime/config/instruction identity. A recent status/Board observation can therefore describe an older selection. No reader renews its timestamp. One current envelope per project is not permanent ticket/phase history; later host or sandbox producers can replace it, and only retained checks are visible.

### Safe next actions by example

These are synthetic scenarios, not diagnoses of a real incident. Except for the labeled text projection below, descriptions summarize check fields rather than promise exact terminal wording.

| Example and observed fact | Claim boundary | Next actor and action | Recheck and preserved work |
| --- | --- | --- | --- |
| Missing parent planning context: ticket 7's parent comment read fails with `read-failed`, or a later page/bound fails. The source hold names the parent and `notes` operation. | This establishes incomplete transport, not an empty plan or filesystem failure. An agent saying "I cannot see the plan" is an attributed claim, not a captured-byte inventory. | Operator inspects the named structured source, pagination and bounds. Maintainer investigates oversized/malformed responses. Do not clip the plan or bypass the hold. | Next collection/eligible launch pass checks again. No partial frozen input is accepted; prior snapshots, proofs and saved work stay intact. A stopped execution is not implicitly retried. |
| Permission-denied evidence path: the host's required create operation under `/fixture/sample/.sandcastle/evidence` returns `EACCES`, even with clean Git status. | The errno identifies a failed access operation at that time, not who changed ownership or whether a container could write there. An agent's filesystem explanation remains a claim unless independently observed. | Operator inspects that exact path, its parents, access policy and mount with the responsible owner. Probes do not repair access. Do not apply recursive chmod/chown or remove the evidence. | Next launch actively rechecks. A project hold creates no new ticket run/admission. Existing branches, evidence and stopped history remain. |
| Unavailable report: status shows missing/invalid/pending, or launch prints `publish-report`/report-write failure after an earlier healthy observation. | Missing data does not prove access failure; direct publication failure does prove the named save operation failed. Neither permits fallback to old green data. | Operator inspects the named state/report operation and any owner/lock before deciding a next action. Use explicit doctor probing only with its write effects understood. | Passive reads remain unknown until a usable producer report exists. Doctor does not publish over launch reports. Next eligible launch rechecks; do not remove locks by age or discard work to obtain a green display. |
| Branch collision: `inspect-worktree-registration` reports ticket 7's existing branch, occupied destination or matching stale registration. | This establishes a ticket workspace conflict, not a shared project failure or proof that the branch is abandoned. | Operator inspects refs, Git registrations, ownership receipt, saved run and dirty/untracked work before deciding how to resume. Do not force-delete, prune or adopt the conflict to make a normal launch pass. | Next eligible pass rechecks that ticket; unrelated tickets remain eligible. The check never deletes branches/worktrees or silently retries a stopped execution. |
| Container-only failure: host checks pass, then the standard sandbox probe reports required workspace/evidence access blocked as the actual agent UID/GID. | Host usability did not guarantee mount access. Zero implementation/repair starts is a pre-agent fact, not an agent diagnosis or an implementer no-commit result. | Operator inspects the effective identity, reported mount/path and exact container cleanup state with the image/project owner. Inspect saved input/work before considering another attempt. | The already admitted recovery attempt stays charged exactly once; no refund/reset. Exact-owned teardown/settlement continues independently of launch holds. Unconfirmed absence retains ownership/capacity and blocks further work. A later permitted attempt gets fresh probes under existing budgets, not an automatic retry caused by readiness success. |

Host-known recovery holds occur before a new attempt is admitted or charged, including the recheck after image readiness. A failure discovered only after container creation keeps the admitted charge. Primary failure and cleanup uncertainty must both remain visible. A timeout/cancellation can leave owned private probes; never infer successful cleanup from process exit or recursively remove old probe directories. Settlement can continue during a project hold/pause under the existing global scheduler policy.

If a normal implementer makes zero commits, inspect its execution-scoped no-commit artifact and saved work before deciding whether to relaunch. Factory's commit count, clean/dirty/unknown Git observation and push-not-attempted state are observed facts. Quoted final assistant text is an agent claim. If capture is unavailable, cause is unknown; a log reference is not an inferred explanation. A claim of "already complete" never substitutes for independent verification or exact-SHA delivery. Readiness adds no stopped-run retry policy and does not disable the separate opt-in recovery policy.

## Structured ticket context

`orchestrator/ticket-context.mts` owns collection, content identity and rendering of tracker task input. It is import-safe and does not load project configuration, invoke a tracker, save reports or launch an agent on import. Complete transport is not a judgment that a plan is adequate. There is no keyword classifier.

The standard workflow uses this contract before analysis and normal/recovery agents. `ticket-input.mts` freezes one collected snapshot and its rendered bytes per invocation. Analysis, implementation, repair and independent verification receive the full child specification and immediate-parent planning comments as untrusted task data. Role-specific configured instructions and read-only analysis tools remain separate. A collected success cannot replace independent verification, exact-SHA delivery, image/browser readiness or recovery ownership and budget gates.

### Frozen input, holds and evidence

`freezeTicketInput(contextSource, iid)` returns `{ context, text, hash, textHash }`. `hash` is the included-source content identity from the collector. `textHash` is SHA-256 of the exact rendered UTF-8 `TICKET` prompt argument, including coverage and collection metadata. Prompt substitution is one pass; placeholders in tracker text are data.

Before an analysis agent starts, the selected runtime must also pass its configured instruction/template freshness check. Dispatch excludes an incomplete ticket from analysis and admission without creating a stopped record or needs-human label. It recollects immediately before claiming a normal launch. The entrypoint collects independently, freezes those bytes and checks again after claim adoption, before creating the workspace. It does not silently replace a frozen prompt after an edit. A later race holds work rather than delivering from stale input.

`TicketInputHold` exposes the original source-specific `.hold` and a shared `.check: ReadinessCheck` with ticket-input scope. The message names child/parent, ticket, operation and safe reason, never raw tracker stderr. Recovery preparation returns code `ticket-input`, scope `ticket`, before admission or a new budget charge. Other unreadable configuration remains a configuration hold. Collection is retried on the next pass, not by silently retrying stopped executions. Ticket-only observations must not overwrite a project filesystem report.

`saveTicketInput(directory, input)` writes three exclusive host-owned files:

- `ticket-context.json`: complete canonical structured snapshot.
- `ticket-context.txt`: exact rendered prompt argument, without an added newline.
- `ticket-sources.json`: content and rendered hashes, source references/counts/coverage and collection limits/times.

Execution evidence lives outside sandbox mounts at `<state>/ticket-inputs/<project-ticket-key>/<executionId>/`, with `<attemptId>/` for recovery. Read-only analysis uses `<state>/ticket-inputs/<project-ticket-key>/analysis/<uuid>/`. These files are not rewritten on subsequent tracker reads or retries. Agent evidence remains in its existing execution/attempt directory. A publication failure stops that invocation. The container receives rendered task data, not host tracker credentials or this host evidence directory.

Analysis cache identities, execution manifests and requirement/proof freshness use the same included child/parent source hash. Relevant parent body or human planning-comment edits invalidate analysis and old delivery authority. Generated Factory notes remain excluded, so posting verification does not invalidate its own proof. Older child-only hashes are stale, not migrated or rewritten. Current eligibility, dependency, claim, branch/base/tip and exact-SHA gates still apply. Fresh source collection runs before verification, delivery and existing-delivery continuation, including adapter authorization after CI. Active prompts remain frozen while those checks see current tracker bytes. Remote tracker edits and merge cannot be made one atomic transaction.

Complete project overrides retain their own internal prompt implementation. These standard workflow helpers do not impose a new custom-workflow protocol or prove that an arbitrary override adopts the frozen-input contract.

### Consumer interface

```ts
import { collectTicketContext, renderTicketContext } from './ticket-context.mts';
import { contextSource } from './tracker.mts';

const result = collectTicketContext(contextSource, iid);
if (result.status === 'hold') {
  // Display source, sourceIid, operation, reason, nextActor and nextAction.
  // Do not launch with a partial context or substitute an old success.
} else {
  const snapshot = result.context;
  const promptData = renderTicketContext(snapshot);
  // The consumer owns freezing/saving these bytes and snapshot.contentHash.
}
```

`tracker.mts` and both configured adapters export `contextSource: TicketContextSource`. Its `ticket`, `notes` and `parentOf` methods each perform one bounded structured read. These are separate from the legacy unbounded graph/display calls, which remain available to existing consumers. The context path never calls `viewText` or parses human `issue view` output.

`structuredContextSource(identity, transport, gitlabProjectId?)` in `ticket-context-source.mts` constructs the same adapter with an injected transport for offline fixtures. The transport receives API argv and a `ReadBudget` with remaining UTF-8 output bytes and milliseconds. Production bridges use host `gh` or `glab` with their existing login, a kill timeout and `maxBuffer`, without forwarding stderr into the snapshot or hold. Tests use only fixture-owned commands and synthetic replies.

### Snapshot and coverage

`TicketContext` version 1 contains:

- Tracker kind, host and project identity.
- Child number, title, complete description, canonical issue URL and ordered included comments.
- The immediate parent with the same fields, or `null` only after a successful parent lookup. GitHub uses native sub-issue hierarchy. GitLab follows a parent only for a Task, preserving existing work-unit semantics. It does not treat every linked issue as a parent.
- Comment ID, canonical comment URL, author, creation/update timestamps and full body. Responses retain source order. GitHub comments use API creation order; GitLab requests ascending creation order.
- A `coverage` entry for each completed ticket body, comment stream and child parent lookup. Entries identify role, issue number, operation, complete status, page count and response bytes. Comment entries count included and excluded notes. Empty comments and a proven absent parent are valid, not errors.
- Collection start/end timestamps, total raw-response UTF-8 bytes, request count and applied limits, plus `contentHash`.

Bodies and human comments are not trimmed, normalized or clipped. Human decisions inside `<details>` and `<summary>` survive intact. Filtering reuses `graph.mts`'s `isSandcastleNote`: system notes, the exact `<!-- sandcastle -->` marker anywhere in a note, and the established `## Sandcastle verification:` prefix are excluded. Arbitrary human details/summary markup is not a filter.

Only the child and immediate parent are read. No ancestors, linked URLs, attachments, credentials or external resources are fetched. URLs in the snapshot are provenance, never fetch instructions.

### Completion and bounds

`TICKET_CONTEXT_LIMITS` defines code-owned defaults, not project configuration:

| Limit | Default | Accounting |
| --- | --- | --- |
| `maxBytes` | 4 MiB | Sum of raw JSON response UTF-8 bytes, including excluded notes and response metadata |
| `maxPages` | 100 | Total structured requests, including ticket bodies and parent lookup, not just comment pages |
| `timeoutMs` | 30,000 ms | Whole collection deadline; each subprocess receives only the remaining time |

Comment requests use 100 rows per page. A full page requires another numbered page, including an empty terminal page when the count is an exact multiple of 100. A short page establishes completion under the tracker list API contract. Duplicate note IDs, malformed pages, missing hierarchy facts, missing issues, GraphQL errors and invalid pagination do not establish completion. Pagination is sequential and source-ordered, not a transactional tracker snapshot. Later edits require a fresh collection and comparison by the consumer.

Tests may inject `limits` and `now` into `collectTicketContext`. Source implementations must honor the budget and report raw response byte counts. The collector also checks bytes, page count and elapsed time around every read. It never returns a partial snapshot on failure, including failure while reading the parent.

### Holds

`TicketContextResult` is either `{ status: 'complete', context }` or a version-1 `TicketContextHold` with `status: 'hold'`. A hold identifies tracker/project, requested child, failing child/parent role and number, operation and reason. Reasons are `read-failed`, `timeout`, `byte-limit`, `page-limit`, `malformed` or `pagination`.

Holds name the operator as next actor, provide a safe inspection/retry action and declare `automaticRecheck: 'next-collection'`. That is a policy hint for callers, not an automatic retry mechanism in this module. Bound failures require inspecting source size/pagination with the maintainer; they never recommend clipping context or silently increasing a project threshold. Other failures require inspecting the named structured read and retrying collection. Do not bypass a hold by treating failed comments as empty or failed parent lookup as parentless. Raw error text is not exposed because it may contain credentials or tracker output.

### Hash and renderer

`ticketContextHash` returns a full SHA-256 digest over a fixed, versioned JSON tuple of tracker identity, child and parent identities/URLs, exact titles/descriptions and included comment IDs/URLs/authors/bodies in order. Whitespace is significant. Relevant parent decisions change the hash. Excluded Factory/system notes, collection timestamps, comment timestamps, coverage counts and budget changes do not. The hash is a content key, not a credential, semantic completeness judgment or delivery authorization.

`renderTicketContext` is the sole canonical renderer. It wraps the complete snapshot JSON in an explicit untrusted-task-data envelope. JSON escapes embedded newlines; angle brackets are escaped so tracker markup cannot forge structural delimiters. Consumers should retain the returned bytes unchanged as prompt evidence. This boundary does not claim to prevent all prompt injection, and tracker content never gains permission to read credentials or follow links.

### Offline validation

```sh
node --test orchestrator/ticket-context*.test.mts
```

Fixtures cover both trackers, multi-page child/parent discussion, generated-note filtering, byte-exact hashing, absence versus failed reads, malformed/incomplete pagination, global bounds and actual fixture subprocess timeouts/output limits. `orchestrator/fixtures/ticket-context-161-162.json` retains the public full task descriptions and parent discussion captured on 2026-11-15, not local logs. Regression tests compare those exact descriptions and parent planning-comment bytes after canonical rendering; API wrappers and timestamps are synthetic. No live tracker, auth, agent, Docker, registry or service manager is called. Runtime inventory tests ensure both context modules ship in the shared runtime.

## Filesystem probe contract

`orchestrator/readiness.mts` is import-safe and takes resolved data, never executable project configuration. It exports:

- `observeReadiness(input, options?) -> Promise<ReadinessReport>` for passive observation. It never writes and reports required write capability as `unknown`, operation `write-unproven`, including when an intended directory is absent.
- `probeFilesystem(input, options?) -> Promise<ReadinessReport>` for an explicit fresh active observation. It tests exclusive create, write, rename and remove using random `.factory-probe-<uuid>` files. Rename replaces only a second exclusively created probe, never a user file.
- `collectReadiness(input, phase, io?) -> ReadinessReport` as the synchronous fixture-injection boundary. Production consumers must use the bounded worker APIs above, not this unbounded low-level helper.
- The schema types, validators, status/freshness policies and identity helpers from `readiness-schema.mts`.

`ReadinessInput` contains `identity`, `owner` and `paths`. Identity has canonical absolute `projectRoot`, `runtimeIdentity`, `configIdentity` and `contextFingerprint`. Callers compute the fingerprint from their resolved invocation context, including all relevant input identities. Owner has `invocationId`, `ownerId` and the store-issued `generation` token.

Each `ReadinessPath` has `id`, `scope`, `role`, absolute `path`, canonical `trustedRoot`, `access` and optional `create`. Scopes are `project`, `ticket-input`, `ticket-workspace`, `sandbox`. Roles are `checkout`, `git-dir`, `git-common-dir`, `base`, `project-asset`, `runtime`, `state`, `artifact`, `worktree-parent`. Access is `read-file`, `read-directory` or `write-directory`.

The caller supplies the complete required path inventory. Include checkout, resolved Git directory, common directory and required base metadata, every required runtime/configured asset, and intended artifact/state/worktree parent locations. The probe does not discover Git layout, interpret refs, read settings or execute Git. Resolve linked worktree metadata with the existing trusted resolver before calling it. External common directories, shared state and installed runtime use their own explicit trusted roots. Project assets, checkout and project artifacts must use the canonical project root. There is no copied `.sandcastle/main.mts` or project `node_modules` requirement. Dirty checkouts are not rejected.

Only `artifact`, `state` and `worktree-parent` roles permit `write-directory`. `create: true` permits component-by-component creation of explicitly intended missing Factory directories under the existing trusted root. It does not create a missing trusted root. Passive observations never create them. There is no recursive deletion, chmod, chown, sudo, Git repair, network, credential read or package installation. File probes open a regular file and read at most one byte to establish access without copying bodies into reports. This is not a full-content integrity check.

Descendant symlinks, dangling links and escaped paths fail closed. Active operations pin directory descriptors, reject symlinks with no-follow opens, and revalidate named directory identity immediately before mutation. Operations use `/proc/self/fd` on Linux and `/dev/fd` on macOS so a replaced path cannot redirect a write into its replacement. If the platform/filesystem cannot support descriptor-relative directory access, required operations block rather than fall back to unsafe path writes. The trusted roots themselves must already be canonical. Cleanup checks probe device/inode ownership and never recursively removes directories. Intended created directories remain after a later failure.

`ProbeOptions` has `signal?: AbortSignal` and `timeoutMs?: number`. Default deadline is 10 seconds, with an accepted range of 1 through 60,000 ms. A worker contains synchronous filesystem operations. Timeout rejects with `ETIMEDOUT`, cancellation with `ECANCELED`, and invalid input with `EINVAL`; callers must hold launch on any rejection. In-progress kernel filesystem operations cannot be rolled back or forcibly canceled by JavaScript. Terminating a worker may leave a uniquely named private probe or an intended directory. Do not claim cleanup was confirmed on timeout/cancellation, and do not delete arbitrary old probes automatically. Normal completed observations retain both the primary and any owned-cleanup failures.

Writable locations also get `statfs` observations. Actual `ENOSPC`/`EDQUOT` operations and confirmed zero available bytes/inodes block. Small nonzero availability is not a new threshold. Unsupported or unavailable metrics are optional `unknown` checks with null metrics, not failed required access checks. Filesystems reporting no inode accounting expose inodes as unavailable.

## Shared report schema

`ReadinessReport` version 1 has `identity`, `owner`, `observedAt`, `phase`, `status` and `checks`. Phases are `passive`, `active`, `sandbox`. Every check retains:

- `id`, `scope`, `phase`, `observedAt`, `required`, and `status` of `ready`, `blocked` or `unknown`.
- `operation`, `path`, optional safe `errno`, and a bounded fixed-purpose `reason`.
- `nextActor` of `operator`, `factory` or `none`, `nextAction`, and `automaticRecheck` of `next-launch` or `none`.
- Optional `capacity` with decimal-string `bytesAvailable` and `inodesAvailable`, or null for unavailable metrics.

Required blocked checks make the report blocked; otherwise any required unknown check makes it unknown. An empty report is unknown. Optional unavailable metrics do not turn successful required probes into a failure. The validator rejects unknown fields, excessive checks, control characters, inconsistent status and malformed timestamps. Reports contain no file bodies, secrets or arbitrary command/error output. Consumers must supply safe source labels/paths and must not put credentials in identity or check fields. `safeErrno` retains only a bounded errno-shaped code, never the original error message.

`DISPLAY_FRESHNESS_MS` is 60,000. `displayFreshness(report, identity, now?, maxAgeMs?)` returns `current` or `stale` by identity and clock, including future timestamps as stale. This is a display policy only. `identityKey` hashes all four identity fields, and `projectKey` hashes canonical project root for the local store filename.

## Atomic report store

`board/readiness.mts` exports the following synchronous local-state operations:

- `beginReadiness(stateRoot, identity, { invocationId, ownerId }) -> ReadinessToken`. Allocate before observing. The random generation becomes the current token and the report becomes pending.
- `publishReadiness(stateRoot, token, report) -> boolean`. True means atomically saved for that current token. False means superseded and must not be presented as a saved success. Identity and all owner fields must match. An older observation cannot replace a newer generation, even across processes or runtime/config changes.
- `readReadiness(stateRoot, identity, now?, maxAgeMs?) -> ReadinessRead`. Returns `{ state: 'current' | 'stale', report }` or `{ state: 'missing' | 'pending' | 'invalid', reason, errno? }`. Reading never creates directories or runs probes.
- `readStoredReadiness(stateRoot, registeredProjectRoot, now?, maxAgeMs?) -> ReadinessRead`. Reads the same envelope without resolving project code or inventing a current config/runtime identity. The caller must supply a trusted canonical registered root, never a browser-supplied path. Token and report project roots must exactly match the requested root, including for pending envelopes. Freshness here compares observation age only; the stored identity is not evidence that the current selected configuration still matches.
- `displayFreshness`, and the `ReadinessToken` and `ReadinessRead` types.
- `readinessLines(read, label?)` for the shared safe human projection, including observation versus authorization, exact operation/path/errno, identity, next actor/action and automatic recheck.
- `scopedReadiness(read, scope)` to retain freshness while recomputing the aggregate over only that scope. A ticket failure must not become a project failure.

The caller supplies an existing canonical shared-state root. Files live in its no-follow `readiness` directory, under a SHA-256 project-root filename. There is one current envelope per project and at most three prior timestamp/status diagnostic summaries, not a journal. Reads accept only regular files up to `MAX_REPORT_BYTES`, 256 KiB, and use no-follow nonblocking opens. These are size-bounded synchronous local reads, not an asynchronous filesystem deadline service. Publications use private exclusive temporary files, file/directory fsync and rename. A post-rename fsync failure attempts to withdraw only the newly owned report and still throws the direct failure. It never authorizes launch, even if a damaged filesystem also prevents withdrawal. Report files are mode 0600 and the new store directory is mode 0700. Parent state ownership belongs to the caller.

A short exclusive per-project lock covers allocation and compare/publication, never the filesystem observation. Competing locks fail with `EEXIST`; there is no unsafe stale-lock stealing. A process crash can leave a lock or private temporary file requiring operator inspection. Missing, pending, malformed, unreadable or identity-stale data is never healthy authority. Write errors propagate directly. A launch consumer must emit that observed operation/error and hold launch; it must not swallow the error or fall back to a previously healthy report.

For a launch: allocate token, run a fresh active probe with that identity/owner, publish, and proceed to other gates only if the report is ready and publication returned true. Error, cancellation, unknown, blocked or superseded publication holds launch. Default doctor/status/Board polling use passive observations or report reads, never active probes.

## No-commit explanations

Normal implementer runs with zero commits save a bounded `no-commit.json` under `.sandcastle/evidence/<ticket>/<executionId>/`. The stopped or waiting note uses the shared display-only `attentionText` projection from `readiness-schema.mts`. It separates Factory's observed zero commits, Git worktree state of clean/dirty/unknown, implementing phase and push-not-attempted state from the quoted agent explanation. Missing `blocked.json` is explicit. It never manufactures a dependency from a complaint about missing context, and a no-change or already-complete claim is not verified success.

The supported capture contract was inspected in the locked `@ai-hero/sandcastle` 0.14.0 declarations and implementation. `SandboxRunResult` exposes `iterations[].sessionFilePath`, `stdout`, `commits` and `logFilePath`, not `finalMessage`. Its Pi adapter parses `agent_end.messages` for the last assistant result, but the runner falls back to raw process stdout when that result is absent. `sandbox.run` does not accept the top-level `run` API's structured `output` option. Consequently this diagnostic does not trust stdout as a final reply and never searches arbitrary log lines for a cause.

The implementer's existing SDK Pi capture is directed to an execution-specific `.sandcastle/diagnostic-sessions/<executionId>` store outside HTTP evidence. The diagnostic reads only the final iteration's contained regular captured session file, with no-follow/nonblocking open and a 256 KiB limit. It accepts a final Pi `message` entry with assistant role, `stopReason: "stop"` and text content. A missing/oversized/unreadable/malformed session, unsupported shape, tool continuation or error reply means explanation unavailable and cause unknown. There is no log or prior-execution fallback. This is a capture contract, not a guarantee every provider/SDK version supplies a final session entry. The SDK itself still owns capture and may retain a larger raw session outside the evidence route; the 256 KiB limit bounds this diagnostic's read, not the SDK's capture.

Only up to 4096 characters of sanitized reply enter `no-commit.json` and the note. Control/terminal sequences, absolute paths, URLs and recognized credential forms are redacted. This is not a universal secret classifier. Do not put secrets in task input or agent replies. Raw sessions and logs are not copied into evidence or posted by this feature. Evidence references use the execution ID and fixed artifact name, never an arbitrary host path. An SDK log reference is retained only as a bounded safe filename under the known `.sandcastle/logs` directory; other paths are unavailable and are never read by the diagnostic. Failure to save diagnostic evidence is explicitly reported, withdraws the artifact reference and cannot authorize continuation.

With no dependency report the next actor is the operator, to inspect ticket context and execution evidence before deciding whether to relaunch. There is no new automatic retry. With a report, existing `readBlocked()` and `blockedOutcome()` policy alone decides whether to wait for a dependency or request human review, including malformed reports and unknown dependency reads. Existing labels/comments and dependency relaunch behavior are unchanged; the explanation grants no push, merge, close, verification or retry authority. This does not disable the separate existing opt-in recovery policy.

Normal admission clears the current note and assigns a new execution/evidence identity. Diagnostic artifacts are exclusive-create and execution-scoped; note publication uses the existing claim-fenced `setStage` writer. A prior execution's session cannot become the current explanation. No-commit exits occur after the owning sandbox's close boundary. A close failure retains both the diagnostic/primary error and teardown failure. An exact-container inspection must also confirm absence before the runtime lease's cleanup is confirmed; missing identity or uncertain inspection retains cleanup ownership. Dirty worktree retention remains SDK-owned. Diagnostic capture itself adds no sandbox access probes; the prepared sandbox gate below is separate.

Focused fixtures in `orchestrator/no-commit.test.mts` exercise the missing-plan explanation, missing final reply/report, blocked and malformed reports, clean/dirty/unknown Git observations, conflicting success claims, stale sessions, bounded redaction and cleanup-before-exit. Entrypoint children use fake SDK, Docker and tracker boundaries plus disposable local Git, never real agents or services.

## Runtime and coverage boundary

The closed runtime inventory includes `orchestrator/no-commit.mts` as `no-commit.mts`. It ships `orchestrator/readiness.mts` as `readiness.mts`, the schema as `readiness-schema.mts`, `orchestrator/sandbox-readiness.mts` as `sandbox-readiness.mts`, and `board/readiness.mts` as `readiness-store.mts` to avoid a flat-layout name collision. It also ships the host gate, shared data-only identity helper and shell preflight helper described below. Standalone Board installs ship host-gate dependencies for explicit reassessment, with `readiness-probe.mts` separate from the Board's `readiness.mts` store; polling still starts no active probe. CLI diagnostics use these modules without introducing another readiness schema. The text projection ships in the existing `readiness-store.mts` inventory asset. CLI diagnostic input resolution lives in `cli/src/readiness.mts`; no executable project module is required. The Board consumes the store through the passive registered-root projection described below. Host observations do not prove effective sandbox-user/mount access.

Complete custom workflow overrides remain internally opaque unless their implementation invokes the shared sandbox helper. Factory does not import installed helpers into an override, execute an override to explain its coverage, or impose a handshake. An override copied from the standard implementation may retain its helper calls; arbitrary custom code is not covered by that observation.

Focused core fixture tests are `orchestrator/readiness.test.mts`, `board/readiness.test.mts` and `cli/test/readiness*.test.mts`. Sandbox tests are `orchestrator/sandbox-readiness.test.mts`, the normal/recovery entrypoint fixtures, and `orchestrator/recovery-runner.test.mts`. They use temporary directories, local Git, local Node children and injected external boundaries. They do not operate on installed apps, registered projects, Docker, authentication, service managers or production systems.

## Prepared sandbox gate

The standard normal and recovery workflows run `probeSandbox(input, proc?)` after configured setup and the mandatory setup-browser preflight, before constructing the first implementer/repair provider. Image readiness remains before container creation; independent verifier browser/proof gates remain after implementation. A required blocked, unknown, canceled, timed-out, invalid or unpublished report invokes zero implementation/repair agents. Normal pre-agent failure is a sandbox-readiness stop, not an implementer no-commit result. Recovery failure at this boundary consumes the already admitted attempt, without a refund or a new charge.

`SandboxProbeInput` supplies the exact container ID/name, canonical shared state, report identity, invocation ID, optional explicit ticket attribution, exact baseline and starting tip, explicit evidence mount path, expected UID/GID, checkout-relative required files and optional expected SHA-256 hashes, cancellation signal and timeout. Normal probes use frozen implementation instructions; recovery uses frozen recovery instructions. Host-owned `.sandcastle/factory.toml` and runtime templates are not guessed to exist in a worktree. Their readability/integrity belongs to the resolved host context, and frozen additive text still travels in the prompt.

The helper executes Node directly through `docker exec <exact-container> node -e ...` as the container's default user, never root or a host credential wrapper. It verifies effective UID/GID, resolves the current workspace and Git metadata/index through the real Git configuration, reads required files with no-follow regular-file checks, checks frozen instruction hashes and resolves exact baseline/tip commits. Private workspace/evidence operations test exclusive create, write, fsync, rename and removal. Git writability uses a disposable alternate index in a private directory next to the resolved real index and `read-tree` of the baseline. Git optional index refresh, split-index writes, fsmonitor commands, external diffs and text conversions are disabled for observations. Probes never write actual refs/index/locks, repair safe-directory settings, change ownership or remove user work. Before/after hashes cover real index bytes, HEAD, refs, porcelain status and binary staged/unstaged diffs, including dirty input.

Completed probes clean only known files inside inode-pinned private directories. A failed operation retains its sanitized errno and the separate work-preservation/cleanup checks. Reports contain effective identity, resolved paths and exact container ownership, not file contents or raw subprocess errors. `sandboxReadinessHold(report)` formats the required failure. `recordSandboxCleanup(state, report, confirmed)` appends exact-container teardown facts under the same fenced generation without erasing the probe cause.

The default probe deadline is 15 seconds. The Docker client is killed on cancellation/deadline, output is capped at 128 KiB, and each Git command has a 1.5-second bound and 4 MiB output cap. There is also a 20-second client watchdog. Kernel filesystem stalls and abrupt container/client loss cannot guarantee probe-file cleanup. Such incomplete probes report unknown work/probe cleanup and hold launch; do not recursively remove old probe directories. Linux container `/proc/self/fd` support is required for pinned directory operations. Reports are observations, not a guarantee of future access.

Normal workflow errors unwind through `finally`, then exit. `closeSandbox(sandbox, proc?)` bounds SDK close and independently confirms the exact `sandboxId` absent because the locked SDK can swallow Docker removal errors. Unconfirmed teardown retains the runtime cleanup lease and ownership receipt, records the exact identity and stops delivery. Existing normal admission-claim lifetime rules are unchanged. Recovery keeps its existing exact-name cleanup-pending record and persistent recovery claim until settlement confirms absence. Primary readiness and cleanup errors both survive. See the [fixture-backed SDK/identity/path/teardown map](sandbox-readiness-map.md).

## CLI observation examples

A project with zero executions can still have a project hold:

```text
Project: sample (me/sample)  /fixture/sample
Current project readiness: blocked | active | checked 2026-11-15T12:00:00Z
  Identity: <runtime identity> / <configuration identity> / <context fingerprint>
  Observation: <invocation> / <generation>; not launch authorization.
  project/active logs: blocked; create "/fixture/sample/.sandcastle/logs" [EACCES]; Required filesystem operation failed
    Next actor: operator; Inspect create access at the reported path. Automatic recheck: next-launch.
No runs yet.
```

A stale success instead starts with `Current project readiness: unknown (stale)`. The old operation remains an observation, not a claim about current write ability. Missing, pending and invalid reports name their state and safe errno when known; no cached success is substituted. Status and ticket show use the same registered-root `readStoredReadiness` projection as Board. Freshness there describes the stored observation's age, not a revalidation of current configuration/runtime. Doctor separately resolves current identity before crediting any saved write observation.

Human doctor output explains that `--probe-filesystem` creates, writes, renames and removes private files, and can create ordinary missing artifact directories, then prints the explicit recheck command using the existing `--project` selector. Default doctor retains write-unproven checks. A matching recent saved active observation can be displayed separately, but doctor never overwrites it. Host checks cannot establish access as the actual sandbox user.

`ticket show` reads the standard workflow's frozen input producer through `readSavedTicketInput` in `ticket-input-evidence.mts`. The run records `ticketInput: {hash, renderedSha256, attemptId?}`; paths are derived from the current execution/attempt identity under host state, never from arbitrary evidence paths. The passive reader accepts only bounded, nonsymlink source manifests for the matching project, ticket and source hash. JSON reports `input.state:"frozen"` with coverage, contentHash, renderedSha256 and source references. This means saved execution input, not current tracker freshness or launch authority. Missing, malformed, mismatched or legacy evidence remains `input: {state:"unknown", reason, coverage:[], contentHash:null, references:[]}`. It never guesses coverage from a title, follows source URLs, reads task bodies/logs, or fetches tracker comments. `executionReadiness` remains separate and unknown without its own producer. Current ticket holds are projected through `ticketReadiness` and `input.readiness` when a check has explicit matching `ticket` attribution. No attribution is inferred from a check path/id/owner, and historical execution input never becomes current project readiness.

Offline CLI fixtures cover zero runs, separate scopes, multiple holds, missing/pending/invalid/stale reports, path spaces, JSON-only output, passive mutation/process/network/secret traps, owned active cleanup and operation-specific failure. Run:

```sh
node --test cli/test/readiness*.test.mts cli/test/status.test.mts cli/test/ticket.test.mts board/readiness.test.mts orchestrator/readiness.test.mts
```

## Host launch ordering

`orchestrator/launch-readiness.mts` consumes already selected project/runtime/config/state data. It does not select a second runtime, import override code or manage recovery budgets. `projectLaunchReadiness(input)` performs fresh host checks and publishes through the shared fenced store. `readinessReason(report)` gives the caller a hold reason. The pure `readinessIdentity` in `orchestrator/readiness-identity.mts` computes the same host/doctor identity from resolved data, without probing or selecting a runtime. Identity binds the canonical project root, selected runtime ID, raw configuration bytes, private dependency identity and configured instruction hashes. Ticket content does not pretend to be part of a project filesystem fingerprint.

The checks cover checkout and actual Git/common directories, a requested local origin base, selected runtime access, configuration and configured instruction files, shared state, analysis-worktree parent and ordinary project logs/evidence/sandbox/worktrees/recovery directories. The runtime resolver still validates the complete closed asset/dependency inventory. Only intended Factory directories and owned disposable probes are created. Missing/unreadable configured input, unsafe paths, unknown operations, cancellation and report-publication failure hold launch. Publication errors print the safe operation/path/errno directly. A superseded publisher cannot replace the newer observation with a retry.

The shared CLI `runDispatchSh` gate runs before executing either the standard shell or an explicit complete override. Manual run, dispatch and scheduled dispatch therefore share the same host report and refuse before opaque workflow code can create work. The standard shell repeats host readiness before remote/auth/image preflight. Direct standard dispatcher/main entrypoints also probe freshly, so a saved report or an earlier CLI pass cannot authorize them. Project checks run once per dispatch phase, not once per selected issue; detached children establish their own fresh boundary. Explicit Board reassessment and never-opted scheduled refresh can start host analysis agents, so both also gate before invoking the selected refresh entrypoint, including complete overrides. Passive status and Board GET/polling do not enter these launch paths.

A project hold precedes tracker ticket analysis, new queue/run records, claims and containers. It does not change remote selection, add needs-human labels, post tracker comments, rewrite parked/stopped history or implicitly retry a stopped run. Ordinary selection resumes on a later successful pass. Readiness success never overrides pause/off/unknown scheduling policy, capacity or ownership. The scheduler passes cancellation into the asynchronous gate and rechecks its existing scheduling predicate after readiness, before spawning; a canceled or newly paused/off/unknown pass cannot spawn late.

Host launch paths use the landed `freezeTicketInput` and configured `contextSource`, not a second collector or human issue output. The same frozen input feeds analysis, hashing and report success. A `TicketInputHold.check` is appended with its typed source/operation/path/reason and explicit ticket attribution, while preserving project checks. Collection checks are published in the active launch report phase; no source is recollected merely to format diagnostics. A missing child/parent/comment source holds only that ticket. `ticketWorkspaceProblem` reads actual Git worktree registrations and local/origin branch names. It refuses a selected ticket's existing branch, occupied/unsafe destination or stale matching registration. It ignores unrelated valid worktrees and does not reject an ordinary dirty checkout. It never deletes, prunes or adopts work. Analysis workspaces must have their expected detached registration before reuse; missing registrations are preserved for inspection, not silently recreated or pruned.

The dispatcher checks ticket input/workspace before analysis/queue decisions and repeats immediately before claiming a launch. Main checks again before setup and protected workspace creation. Final Git creation/access remains authoritative; a change after observation is still possible and surfaces as a race/refusal, not permission to remove the conflict. `recordTicketInput(stateRoot, report, frozenInputOrHold, expectedHash?)` and `recordTicketLaunch(stateRoot, report, iid, workspaceProblem?)` retain bounded ticket checks in the same report with explicit shared `ticket: String(iid)` attribution. The input publisher consumes the already-frozen input or landed typed hold; it does not collect a second snapshot. `recordReadinessCheck` preserves the observation's original generation, so a superseded writer cannot allocate a new token just to overwrite a newer report. Project probes retain recent same-identity ticket observations without treating them as new authority. The report's aggregate status can be blocked by a ticket check while `readinessReason` gates only the required project checks. A failed ticket does not turn healthy project-scope checks into a project-wide hold. Report writes are required, not best-effort diagnostics.

Recovery preparation gates before its helper or analysis agent. Recovery launch adds fresh project probes to the existing pre-charge flow and repeats after image readiness, before `claimRecovery`. It also uses `freezeTicketInput` with the same bounded `commandContextSource` transport as the tracker adapters to compare the current included-source hash with the existing preparation. It publishes the typed source hold or hash mismatch without replacing that preparation or any frozen prompt. Local target/preparation refusals keep their existing types and read-only policy. Existing preparation/manifests, branch/worktree ownership, activity generation, capacity, cancellation and admission-time local checks remain authoritative. No second attempt ledger, refund or budget reset is introduced. A host-known readiness failure admits/charges nothing. A failure discovered after an owned container starts retains the existing charged-attempt/cleanup rules.

Recovery settlement and exact-owned-container cleanup do not call the launch gate. Scheduled maintenance runs before dispatch gates, including during a project hold or project pause under the existing global-off/unknown/cancellation policy. A hold must not hide unconfirmed cleanup or discard saved work/evidence. Standard workflow host checks do not prove the effective sandbox user can access mounts. An override receives the host-owned project gate, but its internal ticket/sandbox behavior remains opaque; no new custom-workflow protocol is imposed.

Focused offline fixtures include `orchestrator/launch-readiness.test.mts`, `orchestrator/refresh.test.mts`, `cli/test/run.test.mts`, `cli/test/recovery-prepare.test.mts` and `cli/test/recovery-run.test.mts`. They cover shared zero-effect holds, ticket isolation and explicit attribution, fresh success, late path/image-readiness races, dirty/unrelated worktrees, missing registrations, publication failure, zero pre-charge attempts and cleanup during holds. External operations use fixture-owned stubs only.

## Board projection

`board/readiness-view.mts` exports `buildReadinessData(stateRoot, registryFile?, now?)`. It reads only the trusted local project registry and the shared store. The default registry is `$FACTORY_HOME/.config/factory/projects.json`, or the equivalent under the user's home. It never resolves paths supplied by HTTP, imports project modules, reads project configuration/logs or runs a probe. Registry reads use no-follow, nonblocking regular-file opens, at most 256 KiB and at most 256 projects. Roots must be absolute, normalized and unique. Invalid, missing or oversized registry data gives a safe unknown reason, not an empty healthy assertion.

The response is `{ generatedAt, projects: [{ name, root, observation }], reason? }`. `observation` is the existing `ReadinessRead`, not a second report schema. `GET /api/readiness` returns this independently of the unchanged `/api/runs` run snapshot. The HTML bootstrap adds the same timestamped data as `readiness`; file/evidence pages do not poll. Live readiness polling is bounded to one in-flight request, every ten seconds, paused in hidden tabs. A failed poll displays unknown instead of leaving cached green data. Reports remain subject to the 60-second display age policy, including future dates.

Checks may carry an optional `ticket` numeric string, one to twenty digits starting with a nonzero digit, only on non-project scopes. This is an additive field in the shared version-1 `ReadinessCheck` validator. Producers must set it explicitly when attribution is known. Readers never infer a ticket from check IDs, paths, invocation IDs, project names or run order. Existing unattributed ticket/sandbox checks remain visible as unattributed, not project holds. A ticket hold can therefore appear before a run exists. A shared project hold appears once, regardless of queued/parked card count; it creates no cards or tracker labels. Ticket failures do not change the project-only status calculation.

The Board renders scope/phase, operation/path/safe errno and reason, checked time/runtime/config/context/generation, next actor/action and automatic recheck as plain text. Report fields must already satisfy the shared safe-producer contract. It does not print raw task input, transcripts, credentials or setup commands. Unknown checks and missing/pending/invalid/stale observations are never shown as healthy. A current observation is explicitly a stored observation, not proof that current runtime/config/context still matches. No configuration or tracker read is performed to establish that match. Launch producers remain responsible for fresh checks.

New successful observations remove current failure notices. Existing historical run stops, evidence and the store's bounded prior status summaries are not rewritten. There is still one current envelope per project, not a ticket-history database; the Board can show only checks retained in that envelope. Optional producer reports absent during rollout remain unknown. Opaque custom workflow internals remain untested.

`board/readiness-view.test.mts` executes production DOM renderer fragments with text-only fixture elements and calls the exported HTTP handler with in-memory request/response objects. It covers zero runs, one shared hold with several old cards, explicit ticket scopes, later ready observations, missing/invalid/stale data, HTML-like input, escaping, traversal and cross-root association. GET fixtures trap process and filesystem writes and refuse project/log reads. Flat-runtime and both standalone installer fixtures include the projection, store and schema without executing project override code. No browser or listening endpoint is required by these new fixtures.
