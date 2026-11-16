<!-- Project-root v2 configuration, fixed model policy and shared execution identity. -->
# Project settings: `.factory/factory.toml`

Supported new projects keep all project data under `.factory`. Shared layout inspection refuses any `.sandcastle` entry, mixed layouts, directory/config symlinks and unknown access before configuration becomes authority. There is no old-layout conversion or fallback. Init may add missing data to an existing safe source-assets-only `.factory` directory; existing commands require a regular, readable `factory.toml` and the usual schema/runtime checks. Historical records and ownership paths are not translated. Global Factory homes, package names and `SANDCASTLE_STATE_DIR` are unchanged.

Repository-owned image and environment examples are [`.factory/Dockerfile`](../.factory/Dockerfile), [`.factory/.env.example`](../.factory/.env.example) and [`.factory/.gitignore`](../.factory/.gitignore). These are source inputs, not an initialized project or a complete provisioned Pi image. Init generates profile-specific data and does not copy the Dockerfile or obsolete workflow code. Review the [setup layers](../skills/factory-setup/SKILL.md#image-layers) before building. The SDK's matching directory behavior is maintained through the [pinned Sandcastle patch](sandcastle-patch.md), not a project configuration option.

New Factory projects use versioned TOML, not edits to Factory implementation files.
`factory init --profile personal|client` creates a commented profile with values from
`--repo`, `--image` and (client) `--host` / `--project-id`. Reference profiles are
[personal](../orchestrator/factory.personal.toml) and [client](../orchestrator/factory.client.toml).
Both profiles explicitly select OpenAI and have empty sandbox setup. Personal uses GitHub, the `merged` done label, one readiness label and automatic merging. Client uses GitLab, the `Internal QA` done label, both `Ready to do` and `ready-for-agent`, issue type `issue` and manual merging. These profile values are not all schema defaults.

## Inspecting effective settings

Use `factory config explain [--project <name|path>] [--json]` to inspect normalized settings, per-key `explicit` or `default` sources, instruction hashes, warnings and validated runtime identity. An explicitly supplied value is `explicit` even when it equals the default. An omitted optional value is `default`, including when it remains absent rather than receiving a concrete value. Setup command bodies are omitted. The command reads local configuration and runtime files without executing project workflow code, launching processes or changing state. It exits 1 on validation errors.

Project overrides have opaque behavior: configured values do not prove which models or stages custom code uses. Even in Factory mode, explain reports actual policy unknown when the selected policy file differs from the CLI's policy. See [Factory CLI](factory-cli.md#configuration-explanation).

## Authority and validation

The v2 data loader requires `factory.toml` and never imports project code. Missing
or version 1 configuration is unsupported and fails validation. There is no
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

Credentials remain in `.factory/.env` / the agent's existing auth store. Prompts,
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
| `instructions.common`, `.implementation`, `.verification`, `.analysis`, `.recovery`, `.supervisor`, `.gateReview` | ordered arrays of repository-relative Markdown paths, default `[]` |
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

## Complete examples

These are complete v2 configurations. The first uses the GitHub personal profile's distinguishing settings and OpenAI. Omitted fields use schema defaults. Replace the project and image with your own values.

```toml
version = 2
[tracker]
kind = "github"
project = "owner/repo"
[agent]
family = "openai"
[labels]
needs_human = "needs-human"
done = "merged"
[merge]
auto = true
[sandbox]
image = "sandcastle-personal"
```

This example uses GitLab client selection and Anthropic. Choosing a model family is independent of tracker choice. The host and project ID are examples, not live project details.

```toml
version = 2
[tracker]
kind = "gitlab"
project = "group/project"
host = "git.example.com"
project_id = 42
[agent]
family = "anthropic"
[labels]
needs_human = "needs-human"
done = "Internal QA"
[selection]
issue_type = "issue"
[selection.labels]
all = ["Ready to do", "ready-for-agent"]
[sandbox]
image = "sandcastle-client"
```

## Factory model policy and ticket tiers

In the standard Factory workflow, `model-policy.mts` owns the model mapping. Both families use Pi with high thinking, including host analysis and sandbox roles. Anthropic's Pi subscription provider may invoke Claude Code internally; it is not a selectable direct Claude Code agent.

| Family | Small | Mid | Large |
| --- | --- | --- | --- |
| `openai` | `openai/gpt-6-luna` | `openai/gpt-6.1-terra` | `openai/gpt-6.1-sol` |
| `anthropic` | `pi-claude-subscription/claude-haiku-5-5` | `pi-claude-subscription/claude-sonnet-5-5` | `pi-claude-subscription/claude-opus-5-5` |

Implementation uses the ticket tier, analysis and supervisor diagnosis use Mid, and verification, recovery and independent gate review use Large. The new fixed model roles are `supervisor` and `gateReview`; neither inherits a ticket tier or permits fallback/escalation. Put a standalone `**Model tier:** small`, `mid` or `large` in the current unit's description. Plain `Model tier: mid` also works. Values are case-insensitive; repeated identical tiers are accepted. Omission selects Mid. Empty, unsupported or conflicting tiers are rejected. Standalone legacy `Model:` and `Pi model:` fields are rejected even when their value is an exact model ID or a valid tier appears elsewhere. Prose, code blocks, indented code, blockquotes, HTML comments, tracker comments, parent descriptions and labels do not select a tier.

Old TOML keys `agent.provider`, `agent.model`, `agent.thinking`, `agent.model_aliases` and `graph.model` are rejected, not translated. There are no per-role family or model settings. The current description's
resolution includes family, tier, source, model, description revision and policy
identity. Normal startup freezes this as `modelChoice` alongside `implementationModel`
in the run record. Later refreshes change current assessments, not that attempt.
Delivery proofs bind the model-policy and resolver files, so policy drift requires
fresh verification.

## Optional supervisor policy

Omission is `{ enabled: false }`; it adds no model calls or scheduler. Logical observation is free of paid diagnosis. `enabled = true` is only a policy prerequisite, **not action mode** or permission to start a worker. Mode belongs to explicit operator state, never ticket readiness or TOML. Disabled/unregistered projects and stopped mode cannot admit paid diagnosis/review. Observe can receive bounded diagnosis proposals only, with the same finite reservations and known provider enforcement/accounting; it cannot admit reviews or actions. The [supervisor contract](supervisor.md#configuration-model-and-paid-call-foundation) retains the notification/reviewer/application blockers.

This is an optional fragment for an otherwise complete configuration, not recommended production budgets:

```toml
[supervisor]
enabled = true
max_tokens = 100000
max_cost_usd = 10
max_calls = 10
[supervisor.diagnosis]
max_tokens = 60000
max_cost_usd = 6
max_calls = 6
timeout_seconds = 600
[supervisor.review]
max_tokens = 40000
max_cost_usd = 4
max_calls = 4
timeout_seconds = 600
```

Enabling policy or providing any limit requires **all** project/diagnosis/review token, cost and call limits. Tokens/calls are positive safe integers; cost is positive finite USD. Each role's limits must not exceed project limits. These are cumulative ceilings, not per-call allowances or rolling windows: settled usage plus outstanding worst-case reservations count against both project and role budgets, without an automatic reset. Omitted policy has no implicit paid allowance. Each role's `timeout_seconds` defaults to 600, is a positive safe integer and may only lower that ceiling. Two diagnoses per unchanged incident and one active project decision are nonconfigurable upper bounds. The project call cap is an additional total across incidents and roles.

Unknown pricing, incomplete/unrecorded usage, failed accounting, missing global budget/capacity admission, or an unbounded/unreserved provider request holds new paid work. The explicit [diagnosis worker](supervisor.md#bounded-diagnosis-and-retained-memory) reserves all input/output tokens and worst-case provider charges atomically before spawning, enforces the fixed timeout and retains reservations on unknown completion. Without a demonstrated all-in provider enforcement/accounting adapter it holds paid work; a process timeout or stdout cap is not a token/cost ceiling. Mode/restart/model activity never renew budgets. This policy helper provides necessary checks, not the journal or global admission owner.

Unknown supervisor keys (including `mode`, exact `model`, `provider`, fallback or escalation selectors) are rejected with secret-safe schema errors. Config does not clear denial, authorize Factory-wide changes or replace independent verification.

## Additive instructions

Instruction paths are repository-relative Markdown files. Paths cannot be absolute, use backslashes or contain `..`. Each resolved component must stay inside the checkout; missing files, directories, escaping links and secret-path aliases fail closed. For each role, Factory reads common files in order, then that role's files in order, deduplicating canonical paths at their first occurrence. Literal text and hashes are frozen for the invocation. Editing an instruction requires fresh analysis or proof authority; an active snapshot retains its original text.

These instructions add to Factory's templates. They do not override host proof, admission, verification, delivery or recovery gates. Review their contents as trusted project instructions.

The following is a fragment to add to an otherwise complete configuration. The files must exist in the checkout:

```toml
[instructions]
common = ["docs/agent-common.md"]
implementation = ["docs/agent-implementation.md"]
verification = []
analysis = []
recovery = []
supervisor = []
gateReview = []
```

## Workflow selection

`workflow.mode` defaults to `factory`, using the installed runtime. In `project` mode, `workflow.directory` is required and names an existing repository-contained directory. It is forbidden in Factory mode. This fragment selects a complete project override, not individual replacement files:

```toml
[workflow]
mode = "project"
directory = ".factory/workflow"
```

Workflow selection validates the complete versioned runtime inventory, source hashes and private dependencies. The inventory is defined in `cli/src/runtime-assets.mts`. Broken overrides never fall back to installed code, and copied local main/dispatch files never select an override implicitly. Project-mode recovery review binds the selected source and dependency identity. A valid manifest establishes identity and integrity, not that custom code is safe or follows Factory's gates. Custom workflow behavior is opaque and must be reviewed by its owner. See [workflow selection and manifest maintenance](execution-context.md#workflow-selection).

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

This is a sandbox fragment, not a complete configuration:

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

## Parser maintenance

The pinned published **smol-toml 1.9.1** ESM parser is vendored, unmodified, under
`orchestrator/vendor/smol-toml/` with its BSD-3-Clause license, package scope and
[upstream/update notes](../orchestrator/vendor/smol-toml/UPSTREAM.md). It ships in the Factory runtime, installed apps and standalone Board copies, not new project scaffolds. `.gitattributes` exempts
these generated JS files from trailing-space checks to preserve upstream bytes.
Updating it requires review
of the published archive and coordinated replacement of all ESM modules/license,
then parser, bootstrap, copied-install and full fixture tests. Never replace it
with an unresolved project npm import: validation precedes npm bootstrap.
