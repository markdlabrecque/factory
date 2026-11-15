# Ticket readiness

Readiness is an observation, not permission to execute, verify or deliver. A saved healthy report never authorizes launch. Existing admission fencing, image/browser gates, independent verification, exact-SHA delivery, cleanup and recovery accounting remain in force.

## Structured ticket context

`orchestrator/ticket-context.mts` owns collection, content identity and rendering of tracker task input. It is import-safe and does not load project configuration, invoke a tracker, save reports or launch an agent on import. Complete transport is not a judgment that a plan is adequate. There is no keyword classifier.

This is a collection contract, not launch wiring. Existing launch, analysis-cache, proof and prompt consumers are unchanged by this module. Consumers must explicitly adopt it, freeze its output and apply their own freshness and admission policy. A collected success cannot replace independent verification, exact-SHA delivery, image/browser readiness or recovery ownership and budget gates.

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

The closed runtime inventory includes `orchestrator/no-commit.mts` as `no-commit.mts`. It ships `orchestrator/readiness.mts` as `readiness.mts`, the schema as `readiness-schema.mts`, `orchestrator/sandbox-readiness.mts` as `sandbox-readiness.mts`, and `board/readiness.mts` as `readiness-store.mts` to avoid a flat-layout name collision. CLI diagnostics use these modules without introducing another readiness schema. The text projection ships in the existing `readiness-store.mts` inventory asset. CLI-only input resolution lives in `cli/src/readiness.mts`; no extra executable project module is required. The Board consumes the store through the passive registered-root projection described below. Host observations do not prove effective sandbox-user/mount access.

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

Doctor first explains that `--probe-filesystem` creates, writes, renames and removes private files, and can create ordinary missing artifact directories, then prints the explicit recheck command using the existing `--project` selector. Default doctor retains write-unproven checks. A matching recent saved active observation can be displayed separately, but doctor never overwrites it. Host checks cannot establish access as the actual sandbox user.

The CLI currently has no frozen ticket-input or execution-specific report producer in its dependency baseline. `ticket show` therefore exposes `input: {state:"unknown", reason, coverage:[], contentHash:null, references:[]}` and a separate `executionReadiness` unknown with historical execution reference/stage/note when present. It never guesses coverage from a title, follows source URLs, opens arbitrary evidence/log paths or fetches tracker comments to fill that gap. Current ticket holds are already projected through `ticketReadiness` and `input.readiness` when a check has explicit matching `ticket` attribution. No attribution is inferred from a check path/id/owner. Later coverage producer integration must use the collector's complete coverage/hash/source references and execution identity; it must not reuse a historical execution as current project readiness.

Offline CLI fixtures cover zero runs, separate scopes, multiple holds, missing/pending/invalid/stale reports, path spaces, JSON-only output, passive mutation/process/network/secret traps, owned active cleanup and operation-specific failure. Run:

```sh
node --test cli/test/readiness*.test.mts cli/test/status.test.mts cli/test/ticket.test.mts board/readiness.test.mts orchestrator/readiness.test.mts
```

## Board projection

`board/readiness-view.mts` exports `buildReadinessData(stateRoot, registryFile?, now?)`. It reads only the trusted local project registry and the shared store. The default registry is `$FACTORY_HOME/.config/factory/projects.json`, or the equivalent under the user's home. It never resolves paths supplied by HTTP, imports project modules, reads project configuration/logs or runs a probe. Registry reads use no-follow, nonblocking regular-file opens, at most 256 KiB and at most 256 projects. Roots must be absolute, normalized and unique. Invalid, missing or oversized registry data gives a safe unknown reason, not an empty healthy assertion.

The response is `{ generatedAt, projects: [{ name, root, observation }], reason? }`. `observation` is the existing `ReadinessRead`, not a second report schema. `GET /api/readiness` returns this independently of the unchanged `/api/runs` run snapshot. The HTML bootstrap adds the same timestamped data as `readiness`; file/evidence pages do not poll. Live readiness polling is bounded to one in-flight request, every ten seconds, paused in hidden tabs. A failed poll displays unknown instead of leaving cached green data. Reports remain subject to the 60-second display age policy, including future dates.

Checks may carry an optional `ticket` numeric string, one to twenty digits starting with a nonzero digit, only on non-project scopes. This is an additive field in the shared version-1 `ReadinessCheck` validator. Producers must set it explicitly when attribution is known. Readers never infer a ticket from check IDs, paths, invocation IDs, project names or run order. Existing unattributed ticket/sandbox checks remain visible as unattributed, not project holds. A ticket hold can therefore appear before a run exists. A shared project hold appears once, regardless of queued/parked card count; it creates no cards or tracker labels. Ticket failures do not change the project-only status calculation.

The Board renders scope/phase, operation/path/safe errno and reason, checked time/runtime/config/context/generation, next actor/action and automatic recheck as plain text. Report fields must already satisfy the shared safe-producer contract. It does not print raw task input, transcripts, credentials or setup commands. Unknown checks and missing/pending/invalid/stale observations are never shown as healthy. A current observation is explicitly a stored observation, not proof that current runtime/config/context still matches. No configuration or tracker read is performed to establish that match. Launch producers remain responsible for fresh checks.

New successful observations remove current failure notices. Existing historical run stops, evidence and the store's bounded prior status summaries are not rewritten. There is still one current envelope per project, not a ticket-history database; the Board can show only checks retained in that envelope. Optional producer reports absent during rollout remain unknown. Opaque custom workflow internals remain untested.

`board/readiness-view.test.mts` executes production DOM renderer fragments with text-only fixture elements and calls the exported HTTP handler with in-memory request/response objects. It covers zero runs, one shared hold with several old cards, explicit ticket scopes, later ready observations, missing/invalid/stale data, HTML-like input, escaping, traversal and cross-root association. GET fixtures trap process and filesystem writes and refuse project/log reads. Flat-runtime and both standalone installer fixtures include the projection, store and schema without executing project override code. No browser or listening endpoint is required by these new fixtures.
