<!-- #137: v1 schema, authority, read-only selection explanation and reviewed manual migration. -->
# Project settings: `.sandcastle/factory.toml`

New Factory projects use versioned TOML, not edits to Factory implementation files.
`factory init --profile personal|client` creates a commented profile with values from
`--repo`, `--image` and (client) `--host` / `--project-id`. Reference profiles are
[personal](../orchestrator/factory.personal.toml) and [client](../orchestrator/factory.client.toml).
Personal retains GitHub, Pi Claude-subscription Sonnet/Opus 5.5 aliases, Opus verification,
Sonnet analysis, `merged` and automatic merging. Client retains GitLab, Claude Code,
`claude-opus-4-8` verification, `sonnet` analysis, two readiness labels, `Internal QA`
and manual merging. Both new profiles have **empty sandbox setup**.

## Authority and validation

When the file is present it supplies **all ordinary settings**. There is no per-field
fallback to `config.mts`, `SELECT` in `dispatch.mts`, or `CONFIG` in `main.mts`.
Omitted optional values use the defaults below, not legacy customizations. No TOML
means legacy behavior, including customized SELECT/CONFIG blocks. An invalid or
unreadable present file fails: it never requests legacy fallback.

`project-config.mts` loads data from an explicit scaffold directory. It never imports
project code. `runtime-config.mts` imports the adjacent legacy config only when TOML
is absent. Workflow entrypoints, shell bootstrap, CLI metadata and Board root lookup
share this parser. Shell validation needs only Node, not project npm dependencies,
and occurs before credentials, Docker, npm or dispatch. Errors identify file/key;
syntax errors include line/column without echoing arbitrary source/commands.

Unknown keys (including nested keys), duplicate keys/tables, unsupported versions,
wrong types/enums/ranges, empty optional strings and unsupported tracker options
are errors. Arrays contain nonempty strings, but may be empty. No includes,
inheritance, environment interpolation, secret resolution, JavaScript expressions
or selection expression language is provided. TOML uses snake_case.

Credentials remain in `.sandcastle/.env` / the agent's existing auth store. Prompts,
script bodies, Dockerfiles, the machine registry (`projects.json`) and scheduler
files stay separate. Never put secrets in TOML.

## Version 1 schema

`version = 1` is required. Required tables/fields are marked **required**. Defaults
are schema defaults; profiles explicitly override some of them.

| Table/key | Values and default |
| --- | --- |
| `tracker.kind` | **required**, `github` or `gitlab` |
| `tracker.project` | **required**, nonempty tracker project path |
| `tracker.host` | GitHub default `github.com`; **required** GitLab hostname, not URL |
| `tracker.project_id` | **required** positive safe integer on GitLab; rejected on GitHub |
| `agent.provider` | **required**, `claude` or `pi` |
| `agent.model` | **required**, fixed verifier/recovery model, approved in aliases |
| `agent.thinking` | optional; Pi only: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `agent.model_aliases` | **required** nonempty alias-to-model-ID table; values approve full IDs too |
| `labels.needs_human` | **required**, workflow human-hold label |
| `labels.done` | **required**, post-merge stage label |
| `selection.milestone` | omitted: any milestone; also scopes graph catalogue |
| `selection.assignee` | omitted: any assignee; `@me` uses tracker identity |
| `selection.author` | omitted: any author |
| `selection.search` | omitted: unrestricted; tracker-native search, not a local expression |
| `selection.exclude_assignees` | `[]`; any matching assignee vetoes, including multi-assignee tickets and `@me` |
| `selection.issue_type` | GitLab only, `issue`, `incident`, `test_case`; omitted: unrestricted (client explicitly uses `issue`) |
| `selection.confidential` | GitLab only, boolean; omitted: both. **false means non-confidential only**, true means confidential only |
| `selection.labels.all` | `["ready-for-agent"]`; all required; `[]` disables this axis |
| `selection.labels.none` | `["blocked", "needs-human", "wontfix"]`; any vetoes; `[]` disables this axis |
| `selection.order.by` | `created`; both trackers: `created`, `updated`, `popularity`. GitLab additionally: `priority`, `due_date`, `relative_position`, `label_priority`, `milestone_due`, `weight` |
| `selection.order.direction` | `asc`; `asc` or `desc` |
| `work.units` | `subtasks`; `issues` or `subtasks` |
| `dispatch.max_concurrent` | `3`, positive safe integer |
| `dispatch.stagger_seconds` | `20`, nonnegative finite number |
| `merge.auto` | `false`, boolean |
| `merge.method` | `squash`; `merge`, `squash`, `rebase` |
| `merge.required_checks` | `[]`, exact check/job names |
| `graph.model` | **required**, approved fixed model for read-only analysis |
| `graph.max_analyses_per_pass` | `5`, positive safe integer |
| `graph.analysis_timeout_minutes` | `10`, positive finite number |
| `graph.conflict_ignore` | `[]`, existing footprint-ignore paths |
| `graph.prune_after_days` | `30`, positive finite number |
| `ci.wait_minutes` | `30`, positive finite number |
| `ci.no_pipeline_minutes` | `5`, positive finite number |
| `sandbox.image` | **required**, nonempty image name |
| `sandbox.setup` | `[]`, ordered array of step tables (normally written `[[sandbox.setup]]`) |
| `sandbox.setup[].command` | **required**, nonempty command string |
| `sandbox.setup[].timeout_ms` | optional positive safe integer; omit to retain sandbox's own timeout |
| `sandbox.setup[].sudo` | `false`, boolean |

Every eligibility filter combines with **AND**. Any excluded label or parent
assignee vetoes. Ordering only changes priority, never eligibility. GitHub rejects
GitLab-only fields/order choices rather than ignoring them. GitLab's false
confidentiality filter uses reliable returned facts over every page; missing facts
fail the read. GitLab paginates all selection results; GitHub's 1,000-result Search
boundary fails with unknown rather than implying deselection. Retained assessments
and queued-card hiding keep their existing failure-safe behavior.

If `labels.needs_human` is not in `selection.labels.none`, validation returns an
actionable warning; it does **not** silently add it. Readiness and exclusion labels
have no second authority under `[labels]`.

Aliases match case-insensitively. Aliases differing only in case may resolve to the
same ID, but conflicting mappings fail. Verifier and graph models must be approved
alias values. Each ticket/Task description still declares its own implementer
(`**Model:** <alias or full ID>`); no default implementer or label routing is added.
A running attempt's model stays frozen despite later configuration/description edits.

Selected parents with children confer eligibility on open children without requiring
child readiness labels. Child exclusion labels still veto. Parents with all children
closed are advanced by normal dispatch, not launched. Without children an issue is
a work unit. `--whole-issues` overrides `work.units` for that invocation.

`dispatch.max_concurrent` is checked against **all active runs and reservations on
the shared board**, not a redesigned per-project/global split. Atomic admission,
manual-start exceptions and launch pacing are unchanged. `--max N` overrides the
cap with a positive safe integer; the CLI rejects unsafe integers before shell
preflight. Dispatch logs the cap/work override sources.

Merge settings preserve SHA-guarded CI and tracker delivery behavior. An exact
required check/job must pass, not skip. An empty required list retains the existing
all-checks gate. GitLab's project strategy still controls merge/rebase; squash
requests squash. Missing/pending CI parks the open PR/MR; existing GitHub failed-CI
behavior is unchanged.

### Startup commands and quoting

Commands remain trusted project code, run **inside the sandbox**, in order; TOML
is not a security boundary. Prefer calling reviewed scripts rather than embedding
script bodies. Remove an explicit `setup = []` before adding step tables:

```toml
[sandbox]
image = "sandcastle-example"

[[sandbox.setup]]
command = 'start-web.sh /home/agent/workspace/web'
sudo = true

[[sandbox.setup]]
command = '/opt/sandcastle/bootstrap-site.sh'
timeout_ms = 600000
```

Single-quoted TOML literal strings need no backslash escaping. Double-quoted basic
strings use TOML escapes. For multiline commands use triple-single-quoted literal
strings or triple-double-quoted basic strings. Do not put credentials in commands.
The host parser never evaluates the strings or interpolates environment variables;
the sandbox's shell interprets them only at normal startup.

## Read-only selection explanation

```sh
factory selection explain 137 [--project <registered-name-or-path>] [--json]
```

Shows config path/mode, normalized selection/work/dispatch values and per-key
`explicit`/`default` sources, eligibility (`selected`, `not-selected`, `unknown`),
structured reasons and separate execution holds. It reads a ticket and complete
native selection membership; local reasons are only reported for reliably returned
facts. Native search mismatches may remain a combined tracker-filter reason rather
than an invented precise mismatch. Incomplete/failed retrieval is **unknown**, never
confirmed deselection. Subtask inheritance and all-children-closed are reported.

Run/assessment holds are historical observations. Missing/stale facts, current
capacity, conflicts, admission and prerequisites are explicitly unknown; eligible
does **not** promise that execution can start. This command does not analyze, call
`ensureLabels`, write run/assessment/journal data or mutate a tracker. Legacy mode
is honestly unsupported/unknown: it never executes customized SELECT/main/dispatch
or config code to guess settings. Full support requires reviewed TOML migration.

Exit **0** means eligible or excluded was successfully evaluated. Exit **1** means
invalid config, failed retrieval or unknown eligibility; bad usage follows normal
CLI error handling. JSON has stable named `source`, `settings`, `eligibility`,
`reasons` and `executionHolds` fields (plus `inheritedFrom`).

## Manual migration: existing projects

No app install, `factory init` repair or `factory update --apply` opts an existing
legacy workflow into TOML. Init checks for pre-existing config/main/dispatch/shell
files **before** repairing gaps; without TOML it skips TOML creation and prints
migration guidance. Existing TOML is never overwritten. Update classifies TOML as
project-owned even when missing; helpers/parser are Factory-owned under existing
edited-file protections. `main.mts`, `dispatch.sh`, prompts and legacy config remain
protected from automatic replacement.

1. Have a person stop/wait for scheduling and in-flight work through normal controls.
   Do not retrieve credentials, contact production, resume scheduling or rewrite
   arbitrary customized workflow code as part of migration.
2. Run `factory update --dry-run`. Review workflow/helper upgrades **together**:
   main/dispatch/shell, refresh/analyze/preflight, tracker facade and adapters,
   models, `runtime-config.mts`, `project-config.mts`, `config-read.mts`,
   `selection.mts`, and the entire `vendor/smol-toml/` directory. Preserve reviewed
   behavioral customizations explicitly. Merely adding TOML to an unupgraded
   workflow is **not sufficient**; explain rejects known legacy adapter imports.
3. Choose a profile as a starting point, then transcribe **every** ordinary setting
   below, including custom SELECT/CONFIG values. Do not assume profile defaults
   match a customized project. There is no automated TypeScript conversion.

| Legacy source | TOML destination |
| --- | --- |
| `TRACKER.kind`, `.project`, `.host` / `.gitlabHost`, `.projectId` | `tracker.kind`, `.project`, `.host`, `.project_id` |
| `TRACKER.milestone` | `selection.milestone` |
| `AGENT.provider`, `.model`, `.thinking`, `.modelAliases` | `agent.provider`, `.model`, `.thinking`, `[agent.model_aliases]` |
| `MERGE.auto`, `.method`, `.requiredChecks` | `merge.auto`, `.method`, `.required_checks` |
| `LABELS.ready`, `.exclude` | `selection.labels.all`, `.none` |
| `LABELS.needsHuman`, `.done` | `labels.needs_human`, `.done` |
| `SUBTASKS.enabled` | `work.units`: true → `subtasks`, false → `issues` |
| `GRAPH.model`, `.maxAnalysesPerPass`, `.analysisTimeoutMinutes`, `.conflictIgnore`, `.pruneAfterDays` | `graph.model`, `.max_analyses_per_pass`, `.analysis_timeout_minutes`, `.conflict_ignore`, `.prune_after_days` |
| `SELECT.assignee`, `.author`, `.search`, `.excludeAssignees`, `.issueType`, `.confidential` | `selection.assignee`, `.author`, `.search`, `.exclude_assignees`, `.issue_type`, `.confidential` |
| `SELECT.order`, `.sort` | `selection.order.by` (`created_at` → `created`, `updated_at` → `updated`), `.direction` |
| `SELECT.maxConcurrent`, `.staggerSeconds` | `dispatch.max_concurrent`, `.stagger_seconds` |
| `CONFIG.image`, `.ciWaitMinutes`, `.noPipelineMinutes` | `sandbox.image`, `ci.wait_minutes`, `.no_pipeline_minutes` |
| `CONFIG.sandboxSetup` | ordered `[[sandbox.setup]]`: `command`, `sudo`, `timeoutMs` → `timeout_ms` |

4. Validate with isolated read-only fixtures or `node .sandcastle/config-read.mts
   <absolute-scaffold-dir> validate`, then `factory selection explain <ticket>
   --project <name>`. Explain contacts only the configured tracker with read-only
   calls. Review the diff. Do not use a dispatcher dry run as a no-side-effect
   validator: it has broader preflight and label behavior.
5. Review recovery again with `factory recovery review --confirm` after reviewing
   the executable helpers/parser inventory. Configuration itself remains project-owned.
   Scheduling resumes only through a person's normal explicit action.

## Parser maintenance

The pinned published **smol-toml 1.9.1** ESM parser is vendored, unmodified, under
`orchestrator/vendor/smol-toml/` with its BSD-3-Clause license, package scope and
[upstream/update notes](../orchestrator/vendor/smol-toml/UPSTREAM.md). It ships in
scaffolds, installed apps and standalone Board copies. `.gitattributes` exempts
these generated JS files from trailing-space checks to preserve upstream bytes.
Updating it requires review
of the published archive and coordinated replacement of all ESM modules/license,
then parser, bootstrap, copied-install and full fixture tests. Never replace it
with an unresolved project npm import: validation precedes npm bootstrap.
