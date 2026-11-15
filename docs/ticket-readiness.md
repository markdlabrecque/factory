# Ticket readiness

Readiness is an observation, not permission to execute, verify or deliver. A saved healthy report never authorizes launch. Existing admission fencing, image/browser gates, independent verification, exact-SHA delivery, cleanup and recovery accounting remain in force.

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

The caller supplies an existing canonical shared-state root. Files live in its no-follow `readiness` directory, under a SHA-256 project-root filename. There is one current envelope per project and at most three prior timestamp/status diagnostic summaries, not a journal. Reads accept only regular files up to `MAX_REPORT_BYTES`, 256 KiB, and use no-follow nonblocking opens. These are size-bounded synchronous local reads, not an asynchronous filesystem deadline service. Publications use private exclusive temporary files, file/directory fsync and rename. A post-rename fsync failure attempts to withdraw only the newly owned report and still throws the direct failure. It never authorizes launch, even if a damaged filesystem also prevents withdrawal. Report files are mode 0600 and the new store directory is mode 0700. Parent state ownership belongs to the caller.

A short exclusive per-project lock covers allocation and compare/publication, never the filesystem observation. Competing locks fail with `EEXIST`; there is no unsafe stale-lock stealing. A process crash can leave a lock or private temporary file requiring operator inspection. Missing, pending, malformed, unreadable or identity-stale data is never healthy authority. Write errors propagate directly. A launch consumer must emit that observed operation/error and hold launch; it must not swallow the error or fall back to a previously healthy report.

For a launch: allocate token, run a fresh active probe with that identity/owner, publish, and proceed to other gates only if the report is ready and publication returned true. Error, cancellation, unknown, blocked or superseded publication holds launch. Default doctor/status/Board polling use passive observations or report reads, never active probes.

## Runtime and coverage boundary

The closed runtime inventory ships `orchestrator/readiness.mts` as `readiness.mts`, the schema as `readiness-schema.mts`, and `board/readiness.mts` as `readiness-store.mts` to avoid a flat-layout name collision. These modules alone do not wire launch, CLI, Board or sandbox consumers. Sandbox adapters can publish version-1 sandbox-phase checks, but host observations do not prove effective sandbox-user/mount access. Custom workflows remain opaque internally; this core does not import them or introduce a new override protocol.

Focused fixture tests are `orchestrator/readiness.test.mts` and `board/readiness.test.mts`. They use temporary directories, local Git and injected filesystem faults. They do not operate on installed apps, registered projects, Docker, authentication, service managers or production systems.
