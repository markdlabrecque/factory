# Portable acceptance contract v1

`orchestrator/acceptance-contract.mts` owns import-safe data interfaces, canonical
hashing, structural checks, approval binding and assertion transition policy. It
imports only Node crypto, never project configuration, trackers, processes or models.
It does not execute argv, read files, authenticate reviewers, freeze bundles, admit
work, publish receipts or grant delivery authority. The flat runtime includes this
module now. The host-only custody APIs below freeze reviewed originals; runner,
admission and exact-candidate proof remain later layers.
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

## Standard role ownership and bootstrap prompts

The standard sequence remains analysis → implementer → independent verifier;
recovery is repair → independent verifier. There is no standard runtime test-writer.
The generic implementer/verifier prompts ship from `cli/templates/project/prompt.md`
and `prompt.verify.md` through `cli/src/runtime-assets.mts`; recovery ships from
`orchestrator/prompt.recover.md`. The Drupal examples are not these runtime prompts.
The same instructions apply to both standard model families and GitHub/GitLab.
Full custom overrides remain opaque: their owners must identify their roles and
explicitly adopt the host protocol; a template or manifest alone does not establish
compliance. Additive project instructions remain subordinate to Factory policy.

- **Preparation/reviewer:** freeze probes and fixtures and independently approve
  their exact identity and semantic adequacy. Inadequate acceptance returns here for
  review; neither implementation nor verification may rewrite it to fit a candidate.
- **Implementer/repair:** own behavior and the cheapest appropriate implementation
  tests. Demonstrate changed behavioral red→green with the same assertion IDs;
  satisfy preservation green→green and exact reviewed non-transition evidence
  obligations per criterion. Already-green changed criteria stop for review through
  each role's existing outcome: implementer `blocked`, verifier `INCONCLUSIVE` with
  the criterion `inconclusive`, repair `canProceed: false` with a blocker. Build,
  import, dependency and harness failures, timeouts, skips and unknowns are not red.
  Implementation tests supplement, never replace, frozen acceptance.
- **Trusted runner/host:** own frozen-probe execution, independent clean/reset replay
  and authenticated receipts for the exact candidate. Prompts do not implement this
  authority or permit tracker commands on the host.
- **Independent verifier:** evaluate every original requirement and the adequacy of
  the evidence, reconcile authoritative criterion/assertion IDs and supplied trusted
  receipt identities, and inspect required browser/manual/semantic evidence.
  Trusted replay is necessary under the protocol, not sufficient for PASS; structural
  validity and green output cannot prove English adequacy. Feature labels do not
  waive changed criteria's baseline transition. Recovery keeps the original baseline
  and full scope; the host-validated saved pre-repair start only supplements defect
  reproduction. Historical verdicts are diagnostic, never reusable PASS authority.

These prompts use the host-frozen ticket text substituted into `{{TICKET}}` and
existing producer placeholders, not unwired receipt variables. A criterion with no
recorded mode is treated as changed, the strictest obligation; prompts never infer a
preservation or non-transition exception from missing data. The verifier rejects
missing or mismatched results only when receipts are supplied. Bootstrap tickets can use checkable criteria and
current independent verification before the future runner/admission/proof layers
exist. Missing typed receipts are not evidence that those gates are enforced, and
agents must not fabricate approvals, receipts or evidence. Unavailable required
evidence blocks a success claim. This prompt update alone does not activate the
future host protocol or migrate existing tickets.

Cheap mapped-template contracts cover roles, exceptions, bootstrap honesty and the
existing placeholder sets; existing copied-runtime fixtures cover one-pass literal
substitution and additive instructions. Manual rendered-prompt review remains
necessary to check that the instructions agree, especially feature transitions and
recovery comparisons.

## Host-owned frozen acceptance custody

`orchestrator/acceptance-custody.mts` supplies explicit source APIs, shipped in the
complete flat runtime. They do **not** activate a gate, run probes, fetch tracker
instructions, admit implementation or publish replay/delivery proof. Existing
standard entrypoints are not yet wired to consume these bundles.

### Preparation and trusted review

`prepareAcceptanceBundle({ ticket, contract, artifacts, approvals })` is a pure
bounded preparation API. `ticket` is the full `FrozenTicketInput` produced by
`freezeTicketInput`; `frozenTicketIdentity` recomputes the source content hash,
rendered text and rendered SHA-256 rather than trusting declared hashes. The full
original input is retained, not just a summary. `artifacts` supplies exact byte
arrays indexed by the contract's portable paths. Missing/extra/duplicate artifacts,
conflicting file/directory paths, mismatched digests and oversized inputs hold.
Repeated identical paths across probes/fixtures may share the same exact bytes.

`TrustedCustodyApprovalIngress.lookup({ ticket, acceptance })` must be implemented
by the authenticated, access-controlled **host** review store. It returns the v1
`ApprovalRecord` only when that review covers both the exact frozen requirements
(`contentHash`, `renderedSha256`) and the exact acceptance identity. This stronger
lookup scope prevents a valid contract review from silently approving changed ticket
requirements. The returned review still passes the existing contract approval
validator. There is no caller-supplied approval JSON parameter, tracker self-approval
or checksum-only approval path. As with the pure contract ingress, this callback is
an explicit trust boundary: a malicious caller implementing a lying ingress is not
authenticated by JavaScript or by a reviewer name string.

`resolveAcceptanceArtifacts(sourceRoot, contract)` optionally reads local files
using the reviewed SHA-256 as the immutable selector. It does not accept remote
URLs, branch names, fetch instructions or commands. There is no moving-revision
resolution: a preparer must supply bytes matching the reviewed digest. Every path
ancestor must be canonical, files must be regular single-link files, and symlinks,
hard links, traversal, special files, size overflow and unstable reads hold. Descriptor
reads are bounded even if a file grows between stat and read. No newline or encoding
normalization changes probe/fixture bytes.

Custody adds fixed bounds: 256 distinct artifacts, 1 MiB per artifact, 16 MiB total
artifact bytes, 8 MiB serialized frozen ticket, 1 MiB per contract/approval/manifest
record. These do not relax the portable contract's existing ceilings. Large probe
inventories require smaller reviewed bundles, not an automatic bound increase.

### Store, publication and resume

`freezeAcceptanceBundle({ root, agentMounts, ...preparation })` requires an existing
canonical host-owned private root (0700 recommended). It returns a saved
`{ version: 1, id }` pointer. The content-addressed bundle identity hashes a canonical
manifest binding both ticket hashes, the complete acceptance identity, authoritative
criterion inventory digest, exact approval digest, and every original file's size
and byte hash. A new review, changed requirements, contract, probe or fixture yields
a new identity after fresh approval; nothing edits a historical identity in place.

The caller must enumerate **every** agent mount, including project/code/runtime,
evidence, helper, file mounts and any future mounts. Root/mount equality, either
ancestor relationship, aliases and unknown mount paths refuse. Check again before
any later mount is exposed. The private root must not live in repository code,
mutable execution evidence, or any directory an agent can mount. The API cannot
discover omitted mounts or defend against a malicious same-UID host process: host
API access and mount construction remain trusted responsibilities, not a claim that
0400 files alone isolate an implementer running on the host.

Publication exclusively reserves the final identity directory, writes each original
0400 with exclusive creation and fsync, and atomically links a completed seal only
after all originals and manifest are complete. Concurrent publishers may reuse only
a fully validated identical original; a loser observing partial publication holds.
A partial marker, unknown file, incomplete inventory, unsafe file or invalid hash
cannot yield a usable bundle. There is no overwrite, retry-repair, automatic deletion
or garbage collection. Interrupted/unknown directories are retained for investigation.

`readAcceptanceBundle(root, agentMounts, savedPointer)` is the resume/repair path.
It validates the private canonical store and exact closed inventory, rehashes all
original bytes, recomputes ticket/contract/criteria/approval bindings, and reestablishes
directory durability before returning independent byte copies. Reads never fetch
replacement probes, call current tracker approval, or rewrite historical proof.
Missing or tampered originals throw `AcceptanceCustodyHold` with a preparer/reviewer
next actor and remain held. Re-running freeze cannot repair an existing identity.
Save the original pointer with the execution/attempt; resume and repair must keep
using it rather than selecting the latest freshly prepared bundle. Binding that
pointer into execution/proof records belongs to the downstream runner/proof work.

### Independent runner copies

`copyAcceptanceForRunner(root, agentMounts, pointer, destination)` rehashes originals
and creates a new private, exclusive directory of exact probe/fixture files with
0400 permissions. Its private parent and destination must be outside all implementer
mounts and must not overlap originals. Candidate code never supplies expected results.
The trusted independent runner obtains the authoritative contract through the host
read API, not a candidate file. It may mount its copy read-only into its own trusted
execution context, **never mount originals** or share that context with implementation.
Copies are disposable and cannot mutate original bytes; failed/partial copies remain
for explicit investigation. This API does not authorize execution or prove clean
checkout/site/database reset. Those guarantees belong to the independent runner.

Keep every custody return value host-private. The implementer receives requirements
and diagnostic summaries, not these authoritative artifacts or an ingress capability.
No current prompt, CLI or scheduler gains a new authority path from these APIs.

## Baseline receipt policy component (not an execution runner)

`orchestrator/acceptance-receipt.mts` supplies `checkAcceptanceReceipt(contract,
approvals, observed, expectedBinding, now)`, a pure baseline-only policy check.
The expected binding is independently supplied by trusted host orchestration, not
copied from the observed receipt. It compares execution, bundle, approval ID and
canonical approval digest, exact Git SHA, selected runtime/private dependencies,
immutable image/config/setup identities, reset provenance and sandbox owner ID.
Every binding field must match, with no extra or missing binding fields.

Version 1 receipts contain exactly `version`, `binding`, `startedAt`, `deadline`,
`finishedAt`, `cleanup` and `results`. Integer timestamps must describe a positive
finite execution window no longer than the contract's 300,000 ms ceiling. Completion
before start, after deadline or after the supplied current observation holds, as does
unconfirmed cleanup. The independently retained review must match both approval ID
and digest; another approval for the same contract cannot substitute. The existing
contract checker then reconciles baseline assertion inventory, transition outcomes
and required non-transition evidence against a single snapshot of that review.

This component **does not authenticate observations or enforce cleanup**. Its
`cleanup` field and timestamps must eventually come from a durable owned execution
boundary; accepting caller-supplied values is not that boundary. It does not reserve
capacity, persist receipts, create/reset a sandbox, bound a running process or grant
candidate-proof/implementation authority. No `acceptance-runner.mts` is implemented
in this increment and no entrypoint consumes this check. Execution ownership,
independent deadline enforcement, reset adapters and retained receipt publication
remain outstanding. In particular, a green policy unit is not T3-ownership or
T3-isolation acceptance and does not change custody's independent review status.

## Verification

```sh
node --test orchestrator/acceptance-contract.test.mts orchestrator/acceptance-custody.test.mts orchestrator/acceptance-receipt.test.mts orchestrator/ticket-input.test.mts
```

Custody uses pure preparation/binding tests plus a disposable filesystem boundary
covering exclusive publication, rehash, mount exclusions, private copies, missing and
tampered originals, symlink/hard-link/size refusal, retained interrupted publication,
and two concurrent native Node publishers synchronized with IPC. No live tracker,
agent, Docker, credentials, service manager or browser is used. Full commit-tier
shards and the independent browser-lifecycle gate remain mandatory.

Pure units cover schema, identity/approval and failure taxonomy using the documented
example, including 256 aggregate criterion evidence obligations reconciling in both
phases and rejection of 257 before approval. Long-ID/4000-unit requirement regressions
cover results larger than 1 MiB, maximum criterion/assertion inventories in both
phases, ASCII/escaped/UTF-8/lone-surrogate serialization and fail-closed result
budget overflow. A bounded denied-capability Node import
smoke check checks that import does not write, launch children, contact a tracker or
print output. This is not a live
sandbox acceptance test or a deterministic substitute for independent review.
