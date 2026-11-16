# Local execution observations

Factory records local observations of execution transitions, recovery phases and a bounded set of explicit control requests. These files are not an admission ledger, ticket journal, proof store or scheduler history. Nothing reads telemetry to authorize work, renew a budget, accept a verdict or decide whether cleanup is required.

## Export

```sh
factory telemetry export
factory telemetry export --project my-project --ticket 42 --format json
factory telemetry export --project /path/to/checkout --since 2026-11-01T00:00:00Z
```

The default is JSONL on stdout. Its first line has `type: "metadata"`, `version: 1`, `coverage: "observed-only"`, `identityGaps` and `diagnostics`. Each subsequent line has `type: "event"` and the event fields below. `--format json` prints one object with `version`, `coverage`, `identityGaps`, `diagnostics` and `events`. No output file is created. Redirect stdout yourself if you want a file.

Without `--project`, export includes every locally recorded project, even projects no longer registered. A project filter resolves a registered name or checkout path to its tracker project without executing project config. A positive safe-integer `--ticket` requires `--project`, since ticket numbers are not unique across projects. `--since` is inclusive on `observedAt` and requires an ISO-8601 timestamp with a timezone. Invalid format, ticket or timestamp arguments fail before project or event IO.

Export snapshots directory entries without writer locks, creates no directories, reconciles no records and emits no telemetry about itself. Files published after a directory's snapshot may appear only on a later export. Missing telemetry yields an empty report and exit 0. Unknown versions, corrupt events, foreign stream identities, sequence anomalies and unrecoverable reads yield diagnostics and exit 1, alongside any valid selected events. Diagnostics contain categories and safe stream hashes, not raw file contents or exceptions. Invalid events are excluded, never repaired or overwritten. A project-only filter may report unreadable data in another stream because corrupt data cannot establish its project identity.

## Coverage and attribution

Coverage is always `observed-only`, including a new installation with no diagnostics. A process can crash after an authoritative write but before publishing its event. Recorder errors warn on stderr and leave the command's authoritative result unchanged. Missing events never prove that an action did not happen.

`identityGaps` counts selected events whose `identityComplete` is false. Legacy observations do not receive invented execution IDs. Older project copies, archived telemetry and unobserved manual work all leave gaps that this count cannot quantify. Do not compute a baseline intervention rate as though this were complete historical data. There is no historical backfill.

CLI and Board controls have `actorIdentity: "unknown"`. A supported request entrypoint establishes that Factory received a control request, not that a named human made it. An outside merge, requirement edit, chat message, commit or arbitrary CLI invocation does not establish an operator action. Factory does not inspect chat or commits to infer actors.

## Version 1 event contract

Each event is one immutable JSON object.

| Field | Meaning |
| --- | --- |
| `version` | `1` |
| `eventId` | Producer identity, stable for retries when the producer has an operation identity |
| `streamKey` | SHA-256 of the canonical JSON tuple `[project, ticket-or-null]` |
| `sequence` | Positive append sequence within this stream only |
| `observedAt` | Time of the observed persisted transition or explicit request/result |
| `recordedAt` | Time assigned at first publication, retained on identical-ID replay |
| `project`, optional `ticket` | Tracker project and positive ticket ID |
| optional `executionId` | Normal execution identity assigned by normal admission |
| optional `recoveryAttemptId` | Repair attempt UUID, separate from the normal execution identity |
| `identityComplete` | Required execution identity is known; recovery also needs its attempt identity. Explicit controls without an execution identity are marked false |
| `eventKind` | One of the kinds below |
| optional `from`, `to` | Stage, phase or settlement result, as applicable |
| `reasonCode` | One of the reason codes below, never classified from arbitrary prose |
| `origin` | `runner`, `recovery`, `scheduler`, `reconciliation`, `cli` or `board` |
| optional `operationId` | Correlates an explicit control request and result |
| optional `action`, `result`, `actorIdentity` | Explicit-control metadata only |

Event kinds are `execution-admitted`, `stage-changed`, `parked-reason-changed`, `recovery-admitted`, `recovery-phase-changed`, `recovery-settled`, `action-requested` and `action-result`.

Reason codes are `dependency-unsatisfied`, `dependency-unknown`, `conflict`, `capacity`, `analysis-stale`, `environment-unready`, `verification-fail`, `verification-inconclusive`, `publication-failed`, `ci-pending`, `ci-failed`, `requirements-changed`, `ownership-unknown`, `operator-pause`, `budget-exhausted`, `process-exited`, `merged` and `unspecified`. Known structured queue codes are used directly. Exact delivery codes `checks-pending` and `checks-missing` map to `ci-pending`; `checks-failed` maps to `ci-failed`. Legacy notes, arbitrary error text and unstructured recovery reasons remain `unspecified`. The enum is not a claim that every old producer supplies structured reasons.

Project-less legacy writers use the reserved identity `unknown` and mark identity incomplete. Global scheduler controls use `factory:global`. A project pause remains possible for a deleted or incomplete checkout. If the command cannot resolve its tracker identity, it uses `factory:unresolved:<SHA-256 of registered root>` and marks identity incomplete, without exporting the path. These reserved streams appear in an unfiltered export.

## Supported producers

Persisted Board writers observe normal admissions, real stage transitions, changes to a parked reason, delivery/merge transitions and crash reconciliation. A heartbeat, repeated reason or a direct launcher PID handoff emits no transition. A repair retains the normal execution ID and gets its own attempt UUID; each repair phase is not a fresh implementation. The launcher records admission and settlement; the runner records phase changes only after its host-owned attempt record is saved. Legacy attempt records without a telemetry state directory have no runner-phase coverage. Existing stage arrays, original verdicts, proof files, evidence and journals are not used to reconstruct events.

Explicit controls are limited to these entrypoints:

| Entrypoint | `action` |
| --- | --- |
| `factory retry` | `retry` |
| `factory recovery reset` | `recovery-reset` |
| `factory recovery review --confirm` | `recovery-review` |
| `factory schedule on` or `off`, global or project | `schedule-on`, `schedule-off` |
| `factory update --apply` | `update-apply` |
| `factory ticket comment`, `verdict`, `archive`, `restore` | `ticket-comment`, `ticket-verdict`, `ticket-archive`, `ticket-restore` |
| Validated Board archive POST with `x-factory: 1` | `ticket-archive`, origin `board` |

A request and its result share an `operationId`. Result is `changed`, `no-op`, `refused` or `failed`. No result means unknown outcome, including a crash mid-command. Validation that cannot identify a target can fail before a request event. A failed comment/verdict delivery records `failed` with `publication-failed` even though its local journal entry remains saved. A successful local update/archive records the observed local result, not a claim about remote state. Schedule on refreshes global launch configuration. Global off reports no-op only when the existing manager query confirms it was already off and no tick/pass cancellation was needed. An unknown prior manager state is not asserted to have been off.

Read-only commands, `ticket sync`, direct shared helper calls, scheduled/install helpers and automatic cleanup do not become explicit control events. HTTP method/header rejections are not archive requests. No dashboard, remote analytics, shell arguments, raw comments, prompts, logs, environment values, credentials, arbitrary exceptions or model-cost data are stored.

## Publication and lock order

Files live at `<state>/telemetry/<streamKey>/<12-digit-sequence>-<eventId>.json`, below rather than beside the Board's run JSON files. The state root follows `SANDCASTLE_STATE_DIR`, otherwise the caller's normal state root. New directories use mode 0700 and files mode 0600.

Writers serialize within a stream using a process-identity lock in its `.writer` directory. A dead process can be reclaimed. Live, unknown or corrupt owners are not stolen by age; a bounded wait fails observationally instead. Acquisition and stale-owner reclamation serialize through `lock.reap` inside `.writer`; an abandoned guard fails closed. Inspect the named process and paths before removing a guard manually while Factory is stopped. Event content is fsynced in a temporary file, exclusively hard-linked into place and followed by a directory fsync. Incomplete temporary files are not events. A repeated ID with the same canonical producer payload returns the original sequence and recording time. A different payload for that ID is an error. Events are never overwritten or pruned.

Board writes queue their observations until admission critical sections have released their locks, including when a later authoritative operation throws. Recovery phase and settlement observations follow their persistence operations. Explicit control results run after admission/journal/recovery mutations return. A telemetry lock is never held while a producer takes an authoritative lock.

Export preserves stream sequence and merges stream heads deterministically by `recordedAt`, stream key and sequence. Occurrence time is separate. There is no global causal order, and clock rollback does not reorder a stream's events.

## Upgrade and retention

The selected complete runtime includes `board/execution-events.mts`, assembled beside `board.mts` and `recovery.mts`. `orchestrator/execution-events.mts` is a repository import bridge, not a second runtime implementation. Data-only init does not copy these helpers into projects, and `factory update` does not repair executable workflow files. In Factory mode, publish updated runtime bytes with `factory install`; existing invocations retain their pinned bundle. Complete project overrides require owner-maintained code, manifest and private dependencies, with renewed recovery review when their reviewed identity changes. A missing mandatory helper makes a bundle incomplete. Standalone Board installation also prepares a complete runtime. See [runtime selection](execution-context.md#workflow-selection) and [override maintenance](../orchestrator/ADAPTING.md#complete-project-workflow-override).

There is no automatic retention deletion or telemetry-specific pruning/purge command, and `factory clean` does not manage telemetry. `factory uninstall --purge` removes Factory's shared state directory, including telemetry stored there; ordinary uninstall keeps it. Disk usage grows with observed transitions and controls. Operators may archive old telemetry directories while Factory is stopped. Archive whole stream directories to retain their internal sequence; archived data is outside subsequent exports unless restored. Keep original run evidence and journals separately. Export never fills missing history from them.
