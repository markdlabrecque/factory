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
- `displayFreshness`, and the `ReadinessToken` and `ReadinessRead` types.
- `readinessLines(read, label?)` for the shared safe human projection, including observation versus authorization, exact operation/path/errno, identity, next actor/action and automatic recheck.
- `scopedReadiness(read, scope)` to retain freshness while recomputing the aggregate over only that scope. A ticket failure must not become a project failure.

The caller supplies an existing canonical shared-state root. Files live in its no-follow `readiness` directory, under a SHA-256 project-root filename. There is one current envelope per project and at most three prior timestamp/status diagnostic summaries, not a journal. Reads accept only regular files up to `MAX_REPORT_BYTES`, 256 KiB, and use no-follow nonblocking opens. These are size-bounded synchronous local reads, not an asynchronous filesystem deadline service. Publications use private exclusive temporary files, file/directory fsync and rename. A post-rename fsync failure attempts to withdraw only the newly owned report and still throws the direct failure. It never authorizes launch, even if a damaged filesystem also prevents withdrawal. Report files are mode 0600 and the new store directory is mode 0700. Parent state ownership belongs to the caller.

A short exclusive per-project lock covers allocation and compare/publication, never the filesystem observation. Competing locks fail with `EEXIST`; there is no unsafe stale-lock stealing. A process crash can leave a lock or private temporary file requiring operator inspection. Missing, pending, malformed, unreadable or identity-stale data is never healthy authority. Write errors propagate directly. A launch consumer must emit that observed operation/error and hold launch; it must not swallow the error or fall back to a previously healthy report.

For a launch: allocate token, run a fresh active probe with that identity/owner, publish, and proceed to other gates only if the report is ready and publication returned true. Error, cancellation, unknown, blocked or superseded publication holds launch. Default doctor/status/Board polling use passive observations or report reads, never active probes.

## Runtime and coverage boundary

The closed runtime inventory ships `orchestrator/readiness.mts` as `readiness.mts`, the schema as `readiness-schema.mts`, and `board/readiness.mts` as `readiness-store.mts` to avoid a flat-layout name collision. CLI diagnostics use these modules without introducing another readiness schema. The text projection ships in the existing `readiness-store.mts` inventory asset. CLI-only input resolution lives in `cli/src/readiness.mts`; no extra executable project module is required. Launch, Board and sandbox wiring are separate consumers. Sandbox adapters can publish version-1 sandbox-phase checks, but host observations do not prove effective sandbox-user/mount access. Custom workflows remain opaque internally; this core does not import them or introduce a new override protocol.

Focused fixture tests are `orchestrator/readiness.test.mts`, `board/readiness.test.mts` and `cli/test/readiness*.test.mts`. They use temporary directories, local Git and injected filesystem faults. They do not operate on installed apps, registered projects, Docker, authentication, service managers or production systems.

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

A stale success instead starts with `Current project readiness: unknown (stale)`. The old operation remains an observation, not a claim about current write ability. Missing, pending and invalid reports name their state and safe errno when known; no cached success is substituted. Invalid current configuration/runtime identity also yields unknown rather than displaying a mismatched green report.

Doctor first explains that `--probe-filesystem` creates, writes, renames and removes private files, and can create ordinary missing artifact directories, then prints the explicit recheck command using the existing `--project` selector. Default doctor retains write-unproven checks. A matching recent saved active observation can be displayed separately, but doctor never overwrites it. Host checks cannot establish access as the actual sandbox user.

The CLI currently has no frozen ticket-input or execution-specific report producer in its dependency baseline. `ticket show` therefore exposes `input: {state:"unknown", reason, coverage:[], contentHash:null, references:[]}` and a separate `executionReadiness` unknown with historical execution reference/stage/note when present. It never guesses coverage from a title, follows source URLs, opens arbitrary evidence/log paths or fetches tracker comments to fill that gap. Later producer integration must use the collector's complete coverage/hash/source references, explicit ticket attribution and execution identity; it must not reuse a historical execution as current project readiness.

Offline CLI fixtures cover zero runs, separate scopes, multiple holds, missing/pending/invalid/stale reports, path spaces, JSON-only output, passive mutation/process/network/secret traps, owned active cleanup and operation-specific failure. Run:

```sh
node --test cli/test/readiness*.test.mts cli/test/status.test.mts cli/test/ticket.test.mts board/readiness.test.mts orchestrator/readiness.test.mts
```
