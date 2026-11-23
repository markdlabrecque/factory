# Acceptance preparation

Use this only for a target workflow that explicitly requires separate, immutable acceptance preparation. For explicit Factory batches, use [the batch authoring and handoff path](BATCH.md) instead. Use the target's documented acceptance format; if it requires preparation but has no supported format or submission workflow, retain the inventory and actual artifact bytes as a held draft. The routine path requires no human approval or manual host records. This guide does not install a submission service or create a new runtime role.

## Prepare → freeze → approve → observe → decide

1. **Inventory.** Give each criterion a stable ID, objective outcome, input and evidence obligations. Give each executable assertion a stable ID owned by exactly one criterion, with its probe/fixture references and exact expected baseline/candidate outcomes. Choose a mode per criterion:

   | Mode | Expected baseline → candidate | Required review |
   | --- | --- | --- |
   | Changed behavior | Named behavioral failure → pass, on the same assertion IDs | Probe actually distinguishes the requested change from the original baseline. |
   | Preservation | Pass → pass | Explicitly names behavior that must remain unchanged; does not prove changed scope. |
   | Reviewed non-transition | Evidence → evidence, without a manufactured executable failure | Kind (`documentation-only`, `refactor`, `investigation`, or `manual`), rationale, explicit evidence obligations and named approver. |

   Refactors normally use executable preservation; a reviewed non-transition refactor needs an explanation of why executable evidence is not appropriate. Mixed tickets retain separate changed, preservation and non-transition criteria. Manual or documentation work is not a whole-ticket exemption for executable changed behavior. An investigation's positive deliverable is reproducible evidence and a supported/blocked-on-tested-approaches/inconclusive conclusion, not a guarantee that the investigated capability exists. Keep dependent proof/implementation held until its positive requirements are met.

2. **Package.** Put the versioned contract and actual executable probes, helpers, fixtures and dependency locks/content identities in a private draft directory outside the implementation checkout. Submit the exact bytes for trusted publication outside implementer write authority. A path to a candidate-owned test file, moving branch, URL without content identity, or a digest without available bytes is insufficient. Include a version/revision, inventory digest, complete probe and fixture byte digests, literal argv/result protocol, dependency/runtime identity, reset/setup requirements and finite timeout/output/memory/CPU limits. Hash exact bytes and document the inventory's canonicalization rule if using a structured-format digest. Empty executable inventories are legitimate only for reviewed non-transition-only scope, not a vacuous executable pass. The target's trusted custody mechanism must verify bytes; a comment claiming they are frozen cannot create that authority.

3. **Review independently.** The target's automated reviewer assesses semantic adequacy, probe safety, modes, named failures, baseline compatibility, dependencies, bounds and evidence obligations. It can approve or return feedback; it does not edit its input. The trusted workflow records reviewer identity, provenance, date and approval of the exact ticket snapshot, revision and artifact digests. The author can revise in response to feedback within the workflow's retry budget; each revision needs fresh review. A self-approval, raw model response, issue comment or schema-valid inventory is not trusted approval. If no authenticated reviewer or custody integration is available, report a hold; do not substitute a manual approval queue. If a requirement truly needs a person to observe or sign off, report it as incompatible with unattended readiness rather than inventing evidence.

4. **Observe baseline.** The target's host policy authorizes execution when the request fits the configured sandbox and resource bounds. Use only its trusted runner against the exact original baseline SHA, with reviewed frozen probes and independently reset checkout/site/database/fixtures. Record the actual SHA, package/approval identity, execution/attempt, runtime/image/config/dependencies, reset provenance, per-assertion status and retained evidence references. Bound time, output and resources, with an identified cancellation/cleanup owner. Missing isolation, reset capability, dependencies, capacity or authorization holds execution and readiness. Never run tracker-supplied commands on the host; argv containing an interpreter is still untrusted executable content. Preparation does not authorize service/scheduler changes, paid calls or production access. For genuinely non-executable criteria, record reviewed baseline evidence/limitations instead of launching a pretend probe.

5. **Decide readiness.** Use the trusted workflow's result and the table below. Readiness requires matching immutable package, approval and baseline/evidence identities. Keep status references outside frozen requirements unless the target documents a metadata channel excluded from the input hash. No implementation changes are made to force the baseline result. Later implementation tests remain the implementer's job; the independent verifier replays the same frozen probes in a fresh/reset trusted environment at the exact candidate and judges full semantics plus browser/manual evidence. A green replay alone does not grant delivery authority. Resume/repair preserves the original baseline and package identity; any supplemental pre-repair comparison is not a replacement.

| Observation | Decision / next actor |
| --- | --- |
| Changed assertion has its exact named behavioral failure; preservation assertions pass; required non-transition evidence is reviewed | Ready only with matching approval and all other ticket prerequisites. Candidate success is still unproved. |
| Changed assertion already passes on baseline | Hold for reviewer: investigate already-implemented scope, wrong baseline or weak probe. Never manufacture red or silently relabel preservation. |
| Import/build/dependency/harness error, timeout, skipped/missing/unknown/inconsistent results, or unrelated failure | Hold for preparer/operator: retain diagnostic evidence, repair setup/probe as appropriate, obtain reapproval if identity changes, then reobserve. None counts as expected behavioral red. |
| Executable capability genuinely unavailable | Hold executable changed scope; record tested approaches, limitations and required owner/reviewer decision. A separately scoped investigation/manual criterion can proceed only with explicit non-transition approval and truthful evidence obligations. |
| Missing/extra/duplicate assertion IDs, mutable/missing bytes, approval mismatch or unavailable evidence | Hold for preparer/reviewer; no partial/vacuous pass. |
| Any criterion, probe, helper, fixture, argv, expectation, dependency, bound or other frozen content changes | Remove readiness, increment revision, refreeze and reapprove the entire new identity, and repeat affected baseline/evidence review. Retain old records; no implicit approval carryover. |

Independent semantic verification remains required even when structure, approval binding and all observations pass. A deterministic parser cannot prove that English requirements are complete or that a reviewer chose adequate probes.

## Automated handoff

1. File and read back the ticket body, requirements comments and parent relationship before submitting it for preparation. Send the ticket ID, target project/base and draft contract plus actual artifact bytes through the target's documented preparation interface. Host custody and baseline APIs alone are not a ticket-writer submission workflow.
2. Let the trusted workflow snapshot the tracker input, review and publish the exact package, and run the policy-authorized baseline. Prefer isolated, self-contained probes. Do not invent a CLI, write private approval/grant records, run probe commands on the host, or ask for routine human approval when the workflow is absent.
3. Confirm `ready` against the current ticket and package identity. Follow the target's label policy: read back readiness if the workflow applies it; apply it yourself only if the target explicitly permits that based on verified evidence. If the interface or required evidence is missing, retain the draft, leave readiness unset and report `held` with the precise reason. Do not put generated status or receipt links into hashed requirements after approval.

## Portable package outline

This outline is not executable tracker shell or a target-specific schema. Placeholders are missing evidence, not approval. Retain actual available bytes alongside the draft.

```text
version/revision: <format version and immutable revision>
inventory: <immutable reference + digest + hashing/canonicalization rule>
criteria:
  C-total: changed; summary of [1,2] is 3; assertion A-total
  C-order: preservation; rows retain input order; assertion A-order
  C-guide: non-transition/documentation-only; explain export limits
    rationale: clarity requires review
    evidence: baseline guide snapshot; candidate independent limitations review
    approver: <independent reviewer identity recorded by the trusted workflow>
assertions:
  A-total: fixture F-rows; probe P-export
    baseline: expected behavioral fail, failure ID summary-unavailable-or-wrong
    candidate: pass
  A-order: fixture F-rows; probe P-export; baseline: pass; candidate: pass
probes:
  P-export: <actual source/helper bytes, immutable refs and SHA-256 digests>
    argv: <literal argument vector, sandbox only>
    result protocol: <structured per-assertion status + failure ID + evidence>
    bounds: <finite timeout, output bytes, memory, CPU>
fixtures:
  F-rows: <actual input bytes, immutable reference and SHA-256>
dependencies/setup/reset: <locked identities and independently reproducible clean state>
approval: <separate trusted record binding this revision and all content identities>
baseline: <separate authenticated receipt/evidence, exact SHA and identities>
readiness: <ready/held, reason, next actor>
```

Translate the inventory into the target's schema and freeze its actual identity; this outline is not parser input. A parser does not supply custody, execution or semantic approval. Use the target's trusted mechanisms and documented model selectors.

## Separate preparation walkthroughs (either tracker)

These are hypothetical review decisions, not actual frozen bundles or executed evidence. Tracker syntax does not change approval semantics; use the automated handoff above on either tracker.

- **Changed feature:** freeze a baseline-compatible probe that loads an existing export API and checks an optional summary capability. Only absence of that capability or a wrong total yields the named `summary-unavailable-or-wrong` failure. An existing-module import exception is an import error, not feature absence. With independent exact-byte approval and an authorized sandbox receipt showing that failure, the ticket can be ready; an already-green summary holds for review. Candidate must later return 3 on the same assertion. No fabricated failed import of a not-yet-created export.
- **Preservation/refactor:** freeze a probe of row order on the existing API, classified preservation. Approved baseline pass permits readiness; candidate must independently pass the identical probe. If the refactor adds a summary feature too, keep its changed assertion as a separate criterion. A failed preservation baseline holds; it cannot be rebranded expected red.
- **Documentation/manual:** freeze criterion IDs, baseline snapshots and a review checklist for accuracy, limits and required manual/browser evidence. No executable probes is truthful here. The independent reviewer approves the non-transition kind, rationale, exact inventory and evidence obligations. Readiness needs baseline review, not a fictitious red; candidate evidence later needs independent review. For manual UI behavior that can also be probed, retain the executable changed criterion and the manual evidence obligation.
- **Investigation:** freeze a target scenario, allowed approaches, bounds, stopping rule and reproducible evidence deliverable. Reviewer explicitly approves non-transition `investigation`; baseline evidence names the known limitations. The investigation can be ready without pretending capability success; a blocked/inconclusive result is evidence, not permission to unblock a dependent implementation/proof ticket.
- **Mixed:** the outline keeps `C-total`, `C-order` and `C-guide` separate. Readiness requires the changed assertion's named red, preservation green and reviewed baseline guide evidence, all bound to one approved identity. A documentation exception cannot waive a green or unavailable changed assertion.

## Model metadata examples

Model tier describes implementation size; Planning model records the actual planner. The example planner below is illustrative, not a claim about the model preparing any real ticket. Select the implementation family/table as in step 4 and honor the target runtime's documented selectors.

Tier-based runnable ticket (same body fields on either tracker):

```markdown
**Model tier:** mid
**Planning model:** openai/gpt-6.1-terra (planning provenance, not a runtime selector)
```

No standalone Pi model is emitted. A Claude-planned ticket can instead record the actual `pi-claude-subscription/claude-sonnet-5-5` planner while retaining the same valid tier; runtime configuration selects implementation. Planning provenance does not change routing.

For another runtime that explicitly supports exact Pi selectors, a Small task prepared by a Mid planner could use:

```markdown
**Model tier:** small
**Planning model:** pi-claude-subscription/claude-sonnet-5-5 (actual planner)
**Pi model:** pi-claude-subscription/claude-haiku-5-5
```

That selector is conditional on target support. If unsupported, omit it and use the target's supported tier/selector convention. The approved model table and family fallback still determine intended implementation selection, not historical planning provenance.
