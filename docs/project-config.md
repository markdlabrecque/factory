<!-- Project-root v2 data, fixed model policy, shared execution identity and manual migration. -->
# Project settings: `.sandcastle/factory.toml`

New Factory projects use versioned TOML, not edits to Factory implementation files.
`factory init --profile personal|client` creates a commented profile with values from
`--repo`, `--image` and (client) `--host` / `--project-id`. Reference profiles are
[personal](../orchestrator/factory.personal.toml) and [client](../orchestrator/factory.client.toml).
Both profiles default to the OpenAI family and have empty sandbox setup. They retain their tracker, selection and merge differences.

## Authority and validation

The v2 data loader requires `factory.toml` and never imports project code. Missing
or version 1 configuration fails with manual migration guidance. There is no
converter or per-field legacy fallback. Syntax errors identify the file and location
without echoing source text. Runtime, dispatch, analysis, recovery, refresh,
scaffolding and selection use v2. The runtime derives all agent settings from the
selected family's Factory policy. It never imports `config.mts` as a fallback.

Shared entrypoints load this file from the explicit canonical project context, not
from the installed module directory. They require a complete selected runtime and
project-root cwd. Runtime templates and private dependencies stay in the bundle;
`.env`, sandbox helpers and artifacts stay in the project. See the
[execution context contract](execution-context.md) for launcher inputs, leases,
analysis/proof invalidation and the routing boundary.

Unknown keys (including nested keys), duplicate keys/tables, unsupported versions,
wrong types/enums/ranges, empty optional strings and unsupported tracker options
are errors. Arrays contain nonempty strings, but may be empty. No includes,
inheritance, environment interpolation, secret resolution, JavaScript expressions
or selection expression language is provided. TOML uses snake_case.

Credentials remain in `.sandcastle/.env` / the agent's existing auth store. Prompts,
script bodies, Dockerfiles, the machine registry (`projects.json`) and scheduler
files stay separate. Never put secrets in TOML.

## Version 2 schema

`version = 2` is required. Required tables/fields are marked **required**. Defaults
are schema defaults; profiles explicitly override some of them.

| Table/key | Values and default |
| --- | --- |
| `tracker.kind` | **required**, `github` or `gitlab` |
| `tracker.project` | **required**, nonempty tracker project path |
| `tracker.host` | GitHub default `github.com`; **required** GitLab hostname, not URL |
| `tracker.project_id` | **required** positive safe integer on GitLab; rejected on GitHub |
| `agent.family` | `openai` or `anthropic`; default `openai` |
| `workflow.mode` | `factory` or `project`; default `factory` |
| `workflow.directory` | required repository-relative directory in project mode; rejected in factory mode |
| `instructions.common`, `.implementation`, `.verification`, `.analysis`, `.recovery` | ordered arrays of repository-relative Markdown paths, default `[]` |
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

Factory owns model IDs and thinking. OpenAI uses `openai`, Anthropic uses
`pi-claude-subscription`; both use Pi with high thinking. Small, Mid and Large map
respectively to OpenAI gpt-6-luna, gpt-6.1-terra and gpt-6.1-sol, or Anthropic
claude-haiku-5-5, claude-sonnet-5-5 and claude-opus-5-5. Analysis uses Mid;
verification and recovery use Large. Tickets may declare `Model tier: small`,
`mid` or `large`; absent declarations default to Mid. Old Model and Pi model
fields are rejected by dispatch, refresh and direct runs. No automatic fallback is
provided. Host analysis explicitly passes `--thinking high`; sandbox implementation,
verification and recovery also use Pi with high thinking. The current description's
resolution includes family, tier, source, model, description revision and policy
identity. Normal startup freezes this as `modelChoice` alongside `implementationModel`
in the run record. Later refreshes change current assessments, not that attempt.
Delivery proofs bind the model-policy and resolver files, so policy drift requires
fresh verification.

Path shape is checked while parsing. Consumers must call the exported checkout
path resolver before use to reject missing paths, escaping symlinks and wrong file
types. Instruction composition and workflow selection belong to later tasks.
The current shared runtime accepts empty instruction lists only. Nonempty lists
produce an explicit execution hold until the instruction-file consumer is available;
the parser still validates their v2 shape. The empty frozen text/hash interface does
not read files or replace Factory templates.

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

## Existing projects

Version 1 and missing configuration are unsupported by the v2 loader. The owner
must migrate existing projects manually before running the upgraded workflow.
No deployed project is changed automatically. Stop scheduling and transcribe old settings into a reviewed v2 profile yourself. Init refuses unsupported existing configuration and does not overwrite settings or migrate a legacy scaffold. Update does not repair project data or workflow overrides.

Replace custom agent providers, model IDs, aliases and thinking settings with
`[agent] family = "openai"` or `"anthropic"`. Remove `graph.model`. Replace ticket
`Model:` / `Pi model:` fields with `Model tier: small|mid|large`, or omit the field
for Mid. Review the schema table above for selection, sandbox and CI settings;
move old executable `SELECT` and `CONFIG` values into the corresponding TOML tables.
Prompts and script bodies stay separate. Reconfirm recovery review after checking
the copied workflow. Scheduling never resumes automatically.

## Parser maintenance

The pinned published **smol-toml 1.9.1** ESM parser is vendored, unmodified, under
`orchestrator/vendor/smol-toml/` with its BSD-3-Clause license, package scope and
[upstream/update notes](../orchestrator/vendor/smol-toml/UPSTREAM.md). It ships in the Factory runtime, installed apps and standalone Board copies, not new project scaffolds. `.gitattributes` exempts
these generated JS files from trailing-space checks to preserve upstream bytes.
Updating it requires review
of the published archive and coordinated replacement of all ESM modules/license,
then parser, bootstrap, copied-install and full fixture tests. Never replace it
with an unresolved project npm import: validation precedes npm bootstrap.
