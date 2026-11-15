# Ticket readiness

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
