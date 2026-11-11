VERDICT: PASS

# #33 merge integration review (read-only)

Scope: the pending documentation-only merge of `origin/main` `82bec2c` (ticket 46: Factory-only development policy and the self-recovery design docs) into the reviewed #33 repair. This is an integration check, not a reopened full review.

The merge is clean:

- The committed repair is byte-for-byte the tree I passed in review-2.
- The staged merge changes documentation only, exactly upstream's 7 files.
- AGENTS.md and `docs/design/*` are identical to upstream.
- Every upstream line is kept verbatim except five lines that were deliberately merged clause by clause.
- Every reviewed scheduler line is kept in the same way.
- There are no conflict markers, no unmerged entries and no stale scheduler wording.

Review-0 findings 1 to 4 stay PASS. I found nothing that needs fixing in this merge.

## State inspected

- Branch `33-deliver-the-linux-schedule-enable-to-uni`. `HEAD` = `fec1c6656154b6e517e9a334f175bdb6c6755d68`, whose parent is `991180a`. `MERGE_HEAD` = `82bec2c5deadf6438e7f721975c6bc2437517470`, and the merge is still pending.
- The working tree has no changes beyond what is staged.
- Staged: `M AGENTS.md`, `M README.md`, `A docs/design/self-recovery-prompt.md`, `A docs/design/self-recovery.md`, `M docs/factory-cli.md`, `M orchestrator/ADAPTING.md`, `M skills/sandcastle-setup/SKILL.md`. That is 7 files, 78 insertions and 6 deletions.
- I read `/recovery/integration.md`, `git diff --cached HEAD`, the staged versions of the four reconciled docs, `AGENTS.md`, and `docs/design/self-recovery.md` and `self-recovery-prompt.md`.
- I didn't modify, stage or commit anything, and I changed no refs. The only files I wrote are this report and `/recovery/evidence/integration-review/full-suite.tap`.

## Checks and results

| Check | Result |
| --- | --- |
| **fec1c66 is the reviewed tree.** I extracted `991180a` (`git archive`), applied `/recovery/evidence/uncommitted-round3.patch` and compared the result with `git archive fec1c66` using `diff -r`. I also recomputed the review-2 fingerprint from the commit, in the same format (tracked diff against `991180a`, then each new file's contents). | Identical trees. Fingerprint `166146f5fb115a681584d8b01fbf73a8ca670f905523f1e120d5d62f3888984a`, which equals review-2's. |
| **No code or test change since fec1c66.** Checked `git diff --cached HEAD --stat -- cli board orchestrator ':!orchestrator/ADAPTING.md' TESTING.md`, and the same against the working tree. | Empty. The only path under `orchestrator/` that changed is `ADAPTING.md`, which is documentation. |
| **No conflict markers.** Grepped the staged version of all 7 files for `<<<<<<<`, `>>>>>>>`, `=======` and `\|\|\|\|\|\|\|`. Also ran `git ls-files -u` and `git diff --cached --check HEAD`. | No markers, no unmerged entries, no whitespace errors. |
| **Upstream policy and design preserved.** Checked `git diff --cached 82bec2c -- AGENTS.md docs/design`. | Empty, so AGENTS.md (Factory-only development workflow, pointer to the self-recovery design, documentation rule) and both design files equal upstream byte for byte. |
| **Upstream doc additions preserved.** For each of the four docs, I checked that every line upstream added since `dbfd2f3` appears verbatim (`grep -qxF`) in the staged file. | All present except five merged lines: the header comments of README, ADAPTING and SKILL, and the `docs/factory-cli.md` header, Status line and roadmap item 4. I read those and found upstream's clauses appended intact (see below). Upstream's whole "Slice four: self-recovery requirements" section, the two `factory recovery status\|reset --project` command lines, and the Factory-only body paragraphs in README, ADAPTING and SKILL are all present verbatim. |
| **Reviewed scheduler docs preserved.** The same check in the other direction: every line of `fec1c66`'s four docs against the staged files. | All present except the same merged lines. Each still carries the reviewed scheduler wording unchanged, with upstream's clause appended after it. |
| **Merged lines read correctly.** | README header: reviewed content, then "AGENTS.md requires Factory-run implementation ...; self-recovery is a documented proposal only ...". factory-cli header and Status: reviewed slice-four status, then the self-recovery "agreed but not implemented" clauses. Roadmap item 4: the reviewed list (#31, #32, #33 implemented; #34 to #38 to come), then upstream's self-recovery sentence. ADAPTING and SKILL headers: reviewed scheduler clause, then the Factory-only and self-recovery clauses. None of the merged text claims self-recovery is implemented, and none changes a scheduler statement. |
| **Stale wording.** Grepped for `scheduler switches`, `schedule tick`, `schedule on <`, `on\|off\|status [project]`, `timers come with slice four` and `global switch`. | None, apart from the reviewed "**No global switch.**" bullet. `scheduler.json` appears only where the docs say a leftover file is ignored. Upstream's old command line and its "Slice four: scheduler switches" heading were replaced by the reviewed `factory schedule on\|off [--project]` and `status [--project] [--json]` lines and the "Slice four: scheduler storage" heading. |
| **Headings and anchors.** | `docs/factory-cli.md` has the sections "self-recovery requirements" (line 122, the target of `#slice-four-self-recovery-requirements`), "scheduler storage", "launch admission" and "the Linux scheduler", each exactly once. |
| **Unslop.** | No em dashes in the added lines. |
| **Sanity test run.** `node --test orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts` | 118 pass, 0 fail. This is the same count as review-2, as expected for a docs-only merge. |

## Observations (not actionable for this merge)

- **Dangling upstream link.** `docs/slice-4/plan.md` is linked from upstream's README, ADAPTING, SKILL, `docs/factory-cli.md` and `docs/design/self-recovery.md`. The file exists neither in `82bec2c` (`git ls-tree -r 82bec2c docs` lists only the two `docs/design` files) nor in the staged tree. The gap comes from upstream ticket 46, not from this integration. Keeping upstream's text verbatim was correct. Ticket 46's owner should add the plan file or fix the links.
- **Policy versus how this recovery was done.** The new AGENTS.md requires code changes to run through Factory. The #33 repair was made under the user's one-time recovery exception. The merged docs apply the policy to the repository from now on, and none of them claims otherwise, so nothing needs editing here.
- **Attribution.** The `fec1c66` commit message contains no provider attribution line, which fits the recovery constraints. Checking that was outside this integration's scope beyond reading the message.

## Limitations

- This merge introduces no new behaviour. The scheduler PASS still rests on the review-0 to review-2 evidence and the trusted-systemd boundary described there.
- I didn't follow external links or contact GitHub. Link checks were limited to in-repo paths and anchors.
