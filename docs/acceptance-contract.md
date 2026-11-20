# Portable acceptance contract v1

`orchestrator/acceptance-contract.mts` owns import-safe data interfaces, canonical
hashing, structural checks, approval binding and assertion transition policy. It
imports only Node crypto, never project configuration, trackers, processes or models.
It does not execute argv, read files, authenticate reviewers, freeze bundles, admit
work, publish receipts or grant delivery authority. The flat runtime includes this
module now; custody, runner, admission and exact-candidate proof are later layers.
No existing ticket is automatically migrated or made ready by these functions.

## Trust and identity

A preparer freezes an `AcceptanceContract` with stable IDs and a positive revision.
Each criterion states objective behavior, a mode and explicit evidence obligations.
Assertions name objective behavior, input/fixture references, a probe and exact
baseline/candidate expectations. Probe bundle and fixture artifacts name portable
relative paths and SHA-256 of **exact bytes** (no newline/encoding normalization).
Paths are data, not instructions to read files. ID namespaces are criteria,
assertions, probes and fixtures; bundle artifact IDs are local to each probe.
Assertions have exactly one owning criterion; probes and fixtures cannot be orphaned.
Probe fixture lists cover their assertions. IDs must remain stable across observations.

`validateAcceptanceContract(unknown)` returns `valid` with an inert JSON snapshot,
or a typed `hold`. Unknown/missing fields, unsupported versions/modes, empty required
inventories, duplicate IDs/references/paths, dangling references, contradictory modes
and invalid bounds fail closed. No defaults infer missing intent. Non-transition-only
contracts legitimately have empty assertions/probes/fixtures. An executable criterion
cannot be converted to a non-transition exception while keeping its transitions.

`acceptanceIdentity(contract)` validates and returns version 1 plus:

- `contractDigest`: SHA-256 of canonical whole contract (including revision, evidence,
  bounds, rationale and exception approver; excluding approval).
- `probeDigest`: SHA-256 of the complete ordered probe inventory, including bundle
  byte digests, argv, protocol and limits.
- `fixtureDigest`: SHA-256 of the complete ordered fixture inventory.

`canonicalAcceptanceJSON` sorts object keys using JavaScript UTF-16 key ordering;
array order and exact strings remain significant. Only finite JSON data is accepted,
with a 32-level nesting and 1 MiB UTF-8 canonical byte ceiling. Cycles, accessors,
symbols and sparse arrays fail. `acceptanceHash` hashes those canonical UTF-8 bytes.
Reordering keys preserves identity; changing content or array order invalidates it.
A digest is not a signature, an artifact existence check or a judgment of adequacy.
Custody must verify the actual frozen bytes, including runner dependencies; a preparer
claiming a digest is insufficient. Content digests alone do not bind Git SHA or runtime.

### Trusted approval ingress

`checkAcceptanceApproval(contract, ingress)` calls
`TrustedApprovalIngress.lookup(identity)` with a frozen identity copy. **Only a trusted
host-owned authenticated record store may implement this interface.** Do not create
one by parsing an issue comment, model response or candidate-owned approval file.
This explicit dependency identifies where later custody/admission must supply trust;
this pure module cannot authenticate whoever calls it. A malicious caller can lie
about ingress and observations; that is not host authority.

The returned `ApprovalRecord` must have exactly these fields:

```ts
{
  version: 1,
  id: 'review-17',
  identity: acceptanceIdentity(contract),
  approvedRevision: contract.revision,
  reviewer: { kind: 'human', name: 'reviewer@example.invalid' },
  decision: 'approve',
  semanticAdequacy: true,
  provenance: 'host-review-store:review-17',
  reviewedAt: '2026-11-20T16:00:00.000Z'
}
```

`independent-reviewer` is also supported. The host must establish independence and
provenance; a name string does not prove independence. Deny, inconclusive, unavailable,
malformed, mismatched or non-semantic approvals hold. Revision and all three digests
must match. A non-transition exception's approver must equal the named reviewer.
Every change requires a new review bound to the new content; there is no override or
mode downgrade. Checking a trusted review's declaration is **not** a deterministic
proof that the English requirements or probes are sufficient. Independent semantic
verification remains mandatory even after replay passes.

## Modes and structured outcomes

| Per-criterion mode | Baseline | Candidate | Policy |
| --- | --- | --- | --- |
| `changed` | `expected-behavioral-fail` with exact `failureId` | `pass` | Already green holds for independent review; do not manufacture red. |
| `preservation` | `pass` | `pass` | Explicitly preserved behavior; cannot satisfy changed scope. |
| `non-transition` | Reviewed evidence | Reviewed evidence | No executable assertions; explicit exception kind, rationale, evidence obligations and approver. |

Non-transition kinds are `documentation-only`, `refactor`, `investigation` and
`manual`. Refactoring can instead use executable preservation criteria. Mixed work
keeps changed criteria alongside preservation and reviewed non-transition criteria;
a manual/documentation exception cannot waive changed executable scope. A reviewer,
not a parser, decides whether the classification is truthful.

`ResultEnvelope` contains exactly `version: 1`, `phase: 'baseline' | 'candidate'`,
`identity`, `assertions` and `evidence`. `checkAcceptanceResults(contract, ingress,
observed, phase)` rechecks approval and exact identity. It reconciles every assertion
ID exactly once, rejecting extra, missing, duplicate or unknown results. The caller
supplies the expected phase independently of the envelope. It must check **both**
phases with the same contract/identity; a candidate-only pass does not establish red.
This is phase policy, not a replay receipt or proof chain.

Each assertion result has `assertionId`, `status`, `failureId` and an array of evidence
references. Allowed statuses are `pass`, `expected-behavioral-fail`, `harness-error`,
`build-error`, `import-error`, `dependency-error`, `timeout`, `skipped`, `missing`,
`unknown` and `inconsistent`. Only `expected-behavioral-fail` carries a non-null
failure ID. It must match the assertion's named failure. A matching nonzero process
exit is **not** sufficient: an import failure must remain `import-error`, never be
normalized to red. All nonbehavioral statuses hold as infrastructure/unavailable;
contradictory fields or unknown status hold as invalid results. Baseline pass for a
changed assertion has the distinct `already-green` hold. Wrong behavioral outcomes
hold as `behavior-mismatch`. There is no synthetic red or silent mode switch.

Successful assertion observations require nonempty evidence references. Criterion
evidence is `{ criterionId, requirement, reference }` for each declared requirement,
exactly once. Unknown/duplicate obligations fail. All candidate criteria, and
non-transition criteria in either phase, require this evidence. Baseline executable
criteria need assertion evidence but need not already have candidate manual/browser
obligations. References are opaque provenance, not fetched or semantically verified
by this module. Non-executable evidence must be independently reviewed; nonempty
strings cannot establish its adequacy.

`valid` means structural policy satisfaction only. Holds carry `code`, `path`, safe
`reason` and `nextActor: 'preparer-or-reviewer'`; callers must not reinterpret them as
permission to retry, execute or deliver. Approval, proof and cleanup authority remain
separate.

## Bounded probe/result protocol

`assertions-v1` is a structured JSON result protocol, not shell syntax. `argv` is a
nonempty literal argument vector; the trusted runner must spawn it directly **only
inside an explicitly authorized bounded sandbox**, never via shell interpolation or
on the host. A vector containing a shell/interpreter is still untrusted executable
content and grants no host permission. The frozen bundle must contain the intended
entrypoint and necessary helper bytes; adequacy and baseline compatibility require
review. The runner, not contract import, supplies trusted executable resolution,
clean state, dependencies and assertion reconciliation. Untrusted stdout or a
candidate's own reports cannot be substituted for independently observed results.

Each probe requires positive integer timeout, output, memory and CPU limits. Current
ceilings: 300,000 ms, 1,048,576 output bytes, 8192 MiB, 8 CPUs. Collections and argument
vectors have at most 256 entries. Contracts additionally allow at most **256 aggregate
criterion evidence obligations**, counted as criterion/requirement pairs across all
criteria and modes (the same requirement text in two criteria counts twice). This
matches the 256-record result evidence ceiling, so every declared obligation can
have its own record. A total of 256 is valid within the other bounds; 257 fails as
`invalid-contract` before approval, even if each criterion's list is individually
within bounds. Strings are bounded (argv arguments may be empty, but argv[0] may
not). Contract, approval and public canonical/hash inputs retain the **1 MiB**
canonical UTF-8 JSON ceiling. Result snapshots alone have a separate fixed **2 MiB**
ceiling (`ACCEPTANCE_LIMITS.resultBytes`); they retain the same JSON/depth checks,
256-entry collection limits and exact identity/approval reconciliation. Callers cannot
raise either ceiling. Probe stdout remains independently capped at 1 MiB; the host
runner assembles the result envelope from observations and retained references, not
by treating the whole envelope as one probe's stdout.

### Result capacity argument

Every admitted inventory has a structurally satisfying representation in **both**
phases, assuming the expected outcomes and genuine evidence are available. Choose
one nonempty reference per assertion and criterion obligation (for sizing, `"x"`),
all declared criterion obligations even in baseline, and each assertion's expected
status and exact failure ID (or null). This is a capacity argument, not permission
to fabricate references or outcomes. Candidate has one more phase-name byte;
baseline's named failure status/ID is larger, so both are bounded independently:

- All serialized requirement strings together are a subset of the contract's
  canonical bytes, hence at most 1,048,576 bytes. This accounts for UTF-8, quotes,
  backslashes, control escapes and lone-surrogate escapes, not just string length.
- At most 256 criterion records add at most 160 bytes each **excluding** the
  serialized requirement string: an 80-character ASCII ID, keys, punctuation and
  the one-character reference, including record separators.
- At most 256 assertion records use at most 320 bytes each, including an
  80-character assertion ID, 80-character failure ID, the longest successful status
  (`expected-behavioral-fail`), one-character evidence, keys and separators.
- Version, phase, three 64-character digests, identity/envelope keys and collection
  delimiters fit in 512 bytes. Even allowing 1,024 additional accounting bytes,
  the total is below **1 MiB + 128 KiB**, comfortably below the 2 MiB result cap.

Thus maximum IDs, aggregate counts and mandatory serialized overhead cannot strand
an approved inventory. Optional/longer references still consume the fixed result
budget and can overflow; that fails closed as `invalid-results`, never a pass.
The 256/257 aggregate admission rule remains necessary independently of byte sizing.

Enforcement, cancellation, overflow handling and resource/cleanup ownership belong
to the future runner. Exceeding a bound cannot yield expected behavioral red. Runner
receipts must additionally bind exact baseline/candidate SHA, frozen byte identity,
approval, execution/attempt, runtime/image/config/dependencies and clean/reset
provenance. These interfaces do not implement receipt authentication or custody.

## Portable mixed-ticket example

The canonical JSON below is consumed directly by the unit fixtures. Digests are
synthetic illustrative byte identities, **not** a published frozen bundle or trusted
approval. The same data works with GitHub or GitLab and either standard model family;
tracker/runtime selectors intentionally are not in this portable inventory.

```json
{
  "version": 1,
  "id": "export-summary",
  "revision": 1,
  "criteria": [
    {
      "id": "C-feature",
      "behavior": "Summary export returns the total for the supplied rows.",
      "mode": "changed",
      "assertionIds": ["A-summary"],
      "evidenceRequirements": ["independent replay transcript"],
      "exception": null
    },
    {
      "id": "C-preserve",
      "behavior": "Existing row export retains row order.",
      "mode": "preservation",
      "assertionIds": ["A-order"],
      "evidenceRequirements": ["independent replay transcript"],
      "exception": null
    },
    {
      "id": "C-manual",
      "behavior": "Operator documentation explains summary export limitations.",
      "mode": "non-transition",
      "assertionIds": [],
      "evidenceRequirements": ["independent documentation review"],
      "exception": {
        "kind": "documentation-only",
        "rationale": "Clarity and completeness require human review, not a fabricated failing assertion.",
        "approver": "reviewer@example.invalid"
      }
    }
  ],
  "assertions": [
    {
      "id": "A-summary",
      "behavior": "Summary total is 3 for rows with amounts 1 and 2.",
      "input": "rows fixture: amounts [1,2]",
      "fixtureIds": ["F-rows"],
      "probeId": "P-export",
      "baseline": "expected-behavioral-fail",
      "candidate": "pass",
      "failureId": "summary-unavailable-or-wrong"
    },
    {
      "id": "A-order",
      "behavior": "Export retains the fixture's row order.",
      "input": "rows fixture: row IDs [first,second]",
      "fixtureIds": ["F-rows"],
      "probeId": "P-export",
      "baseline": "pass",
      "candidate": "pass",
      "failureId": null
    }
  ],
  "probes": [
    {
      "id": "P-export",
      "bundle": [
        { "id": "B-export", "path": "probes/export.mjs", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      ],
      "argv": ["node", "probes/export.mjs"],
      "fixtureIds": ["F-rows"],
      "protocol": "assertions-v1",
      "bounds": { "timeoutMs": 10000, "outputBytes": 65536, "memoryMiB": 256, "cpus": 1 }
    }
  ],
  "fixtures": [
    { "id": "F-rows", "path": "fixtures/rows.json", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  ]
}
```

The example's deterministic identities (not approval) are:

- Contract: `cd5f9534ae411be3adc1a0a451c4982e64f2d8fb3f951a1373172ec182d1a4b9`
- Probes: `4de2262201b1d04f3fa0468541ab159f11435834c0366ccbd64ccdceaf2ab338`
- Fixtures: `d7de8b81058cd4751ff81521de464aca7a3ca1a3e14e8b3e76bc1d05cef66ba5`

### Genuine feature: baseline-compatible missing-behavior probe

Use a baseline-loadable public module, not a static import of a not-yet-existing
export. For example, after a successful import of the existing export module and
fixture, inspect the optional capability. Absence of the new function is the named
behavioral failure. An import exception is infrastructure, not absence of behavior:

```js
let api;
try { api = await import(existingModuleURL); }
catch { report('A-summary', 'import-error', null); }
if (api) {
  if (typeof api.summary !== 'function') {
    report('A-summary', 'expected-behavioral-fail', 'summary-unavailable-or-wrong');
  } else {
    // report handles structured evidence and runner-owned protocol serialization.
    // Unexpected throws are harness/dependency errors unless explicitly reviewed
    // as part of this named behavioral assertion, not generic red normalization.
    const total = await api.summary(rows);
    report('A-summary', total === 3 ? 'pass' : 'expected-behavioral-fail',
      total === 3 ? null : 'summary-unavailable-or-wrong');
  }
}
```

This is a probe design sketch, not a complete runnable bundle. Freeze actual source,
fixtures and dependencies and obtain independent semantic approval before admission.
A baseline that cannot load its existing API needs a repaired probe/setup review,
not an artificial red. An already-green new feature must stop for review of scope,
expectations or whether the ticket is already implemented.

### Genuinely non-executable acceptance

For an investigation/manual review only, retain `C-manual`, change its exception
kind to `investigation` or `manual` with a truthful rationale, and set assertions,
probes and fixtures to empty arrays. Freeze and approve that **different** identity.
In both phases supply a criterion evidence record naming `C-manual`, requirement
`independent documentation review`, and a host-retained independent review reference.
No synthetic executable failure is necessary or permitted. This is only appropriate
if no changed executable behavior is concealed. For mixed work, retain `C-feature`
and `C-preserve` exactly as separate obligations. Tests exercise both the mixed
example and the evidence-only variant.

## Verification

```sh
node --test orchestrator/acceptance-contract.test.mts
```

Pure units cover schema, identity/approval and failure taxonomy using the documented
example, including 256 aggregate criterion evidence obligations reconciling in both
phases and rejection of 257 before approval. Long-ID/4000-unit requirement regressions
cover results larger than 1 MiB, maximum criterion/assertion inventories in both
phases, ASCII/escaped/UTF-8/lone-surrogate serialization and fail-closed result
budget overflow. A bounded denied-capability Node import
smoke check checks that import does not write, launch children, contact a tracker or
print output. This is not a live
sandbox acceptance test or a deterministic substitute for independent review.
