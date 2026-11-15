# Shared workflow execution context

The standard workflow separates executable runtime bytes from project data.
`cli/src/runtime-assets.mts` is the single assembly inventory. A complete flat
bundle contains the workflow, Board helpers, TOML parser, Factory templates and
private locked dependencies. A project does not supply individual executable or
template overrides to this workflow.

## Launcher contract

A trusted launcher selects a prepared runtime once and supplies:

| Input | Contract |
| --- | --- |
| `FACTORY_PROJECT_ROOT` | Existing canonical absolute checkout root |
| `FACTORY_RUNTIME_ROOT` | Existing canonical absolute selected workflow directory. Installed bundles are named by content ID; explicit project overrides need not be. |
| `FACTORY_RUNTIME_ID` | The selected manifest's source content ID |
| `FACTORY_RUNTIME_DEPENDENCIES` | Selected private dependency snapshot hash, pinned for descendants |
| `FACTORY_WORKFLOW_MODE` | Resolver-selected `factory` or `project` |
| `FACTORY_HOST_RUNTIME_ROOT`, `FACTORY_HOST_RUNTIME_ID`, `FACTORY_HOST_RUNTIME_DEPENDENCIES` | Validated installed host bundle and dependency snapshot whose runtime-store lease protects launcher dependencies, including for project mode |
| cwd | The project root, not the runtime directory or a checkout subdirectory |
| `SANDCASTLE_STATE_DIR` | Absolute shared state directory. Omission uses `$HOME/.local/state/factory`. |

`orchestrator/context.mts` validates the complete runtime inventory, Node/platform
metadata and private dependency snapshot. The executing module must belong to that
runtime. Missing context, wrong cwd, aliases, changed bytes or an incomplete bundle
fail before workflow preflight. There is no adjacent-config, copied-module or
project-package fallback. Low-level entrypoints tell the caller to use Factory
commands rather than guessing a checkout.

The context loads only `<project>/.sandcastle/factory.toml`, schema version 2.
The asset directory must be canonical; config symlinks cannot escape the checkout.
Missing or v1 settings require manual migration. Validation runs before credential,
Docker or admission work. The data-only `config-read.mts` bridge returns allowlisted
scalars, not generated shell or arbitrary settings JSON.

## Code and project paths

Runtime code, executable helpers and all four Factory prompt templates come from
the selected bundle. SDK entrypoints use Node with the bundle's absolute
`node_modules/tsx/dist/cli.mjs`. Interactive image builds use the bundle's absolute
Sandcastle executable. Dispatch never installs project dependencies and never
resolves an executable through project `npm`, `npx` or `node_modules`.

Git and `.env` use the checkout. Sandbox image/setup settings come from its TOML.
Logs, evidence, recovery artifacts and implementation worktrees retain their
`.sandcastle` layout. Analysis worktrees and shared records retain their shared
state layout. `.sandcastle/sandbox` is an explicitly mounted project helper
directory; an empty project receives no installed sample image or Drupal setup.
`codePath` and `projectPath` reject lexical traversal between these roots.

## Frozen inputs and proof

Normal startup resolves the implementation tier once from the ticket's current
description. The run stores `implementationModel` and `modelChoice`, including
family, tier, source, resolved model, description revision and policy identity.
Later assessment refreshes do not overwrite those attempt fields. Pi is fixed;
analysis uses family Mid, verification and recovery use family Large with high
thinking. Recovery does not inherit the old implementer tier. Provider provisioning
failure never selects another family or model. OpenAI token handoff and explicit
subscription-extension loading retain their existing credential boundaries.

The context snapshots normalized settings, runtime inventory/dependency identity,
Factory template bytes/hashes and the additive-input hash map. Execution analyses
carry `policyIdentity`; an absent or different identity requires fresh analysis.
Assessment freshness and recovery preparation also include this policy identity.
Existing actual footprints, implementer blockers, saved work, evidence and attempt
budgets are not reset by that invalidation.

Host proofs contain the complete runtime file inventory, not a second curated
executable list. Proof settings include normalized configuration and the frozen
runtime/template/additive identities. Current-input checks run before admission
and verification/delivery authorization. Existing-delivery continuation compares
the entire selected inventory and settings before it can reuse a proof. Changing
settings or templates requires fresh authority; TOML comments alone do not.
Requirement, historical baseline, immutable verifier, independent browser probe,
claim, exact-SHA CI and merge checks remain separate mandatory gates.

## Process ownership

The shell bootstrap holds its own runtime lease through preflight and foreground
execution. Dispatcher, normal/recovery execution, analysis preparation and provider
preflight processes own separate lease tokens. A dispatcher acquires a separate
child token before spawn, transfers it to the detached child's PID/start identity,
and passes that capability to the child. The child consumes it rather than using
the dispatcher's token. Descendants inherit the pinned project/runtime identity,
not an installed descriptor that might change during the pass.

A process releases only its own token. Normal and recovery runs mark cleanup
pending while they own sandbox resources and release only after their cleanup
boundary confirms completion. Uncertain cleanup leaves the lease record in place.
PID/start ownership, stale-owner handling and uninstall rules remain those of the
runtime store; leases add no age-based reclamation or garbage collection. They do
not replace recovery claims, exact-container cleanup or settlement.

## Workflow selection

`orchestrator/workflow.mts` selects one complete workflow using canonical checkout
identity, v2 TOML and a trusted installed runtime descriptor. Selection reads data
and hashes files, never importing project executable modules. CLI run/dispatch,
scheduler readiness and dispatch/refresh, Board refresh, recovery preparation,
image readiness and recovery launch use this resolver. Copied `.sandcastle`
main/dispatch files cannot override Factory mode. `cli/src/runs.mts` still resolves
registered checkout and data-only tracker identity, not executable paths.

Factory mode uses the descriptor's validated content-addressed bundle. Project
mode uses only the explicit repository-relative `workflow.directory`. It requires
the same versioned complete inventory, package/lock metadata and private dependency
snapshot. The source tree is closed: only inventoried files, their parent directories,
`runtime-manifest.json` and private `node_modules` are permitted. Additional helpers
or metadata files are rejected, including symlinks outside the listed inventory.
Missing/unknown inventories, stale hashes, illegal paths, source symlinks
and missing dependencies fail without fallback. Dependency links must remain inside
private `node_modules` and resolve to existing entries. No installed helper or
prompt fills a hole in an override. Project overrides are trusted custom code, not
a sandbox or permission to bypass installed host admission/review contracts.

A fresh invocation reads the current descriptor. Its children inherit the selected
root, source ID, private dependency hash, mode and host identity rather than
rediscovering a newer descriptor. Regenerating a manifest after a dependency-only
edit does not authorize inherited children to use those new bytes.
Scheduler recovery preparation and launch retain their completed pass's selection
and saved Node/PATH. Changing workflow mode/root/identity within an invocation
fails and requires a fresh invocation. Active processes keep independent runtime
lease tokens; the host runtime store remains protected in project mode too.

Factory-mode recovery needs no per-project executable review. Project-mode review
is host-owned and binds mode, workflow root, complete source ID/file hashes and
private dependency hash. Edits or a different override directory invalidate review.
A review cannot repair an invalid manifest, reset history/budgets or authorize
admission, proof reuse, cleanup or delivery by itself.

Board services receive `FACTORY_RUNTIME_DESCRIPTOR` from trusted installation
configuration. Standalone Board installation uses the same bundle builder and
records `~/.local/share/sandcastle-board-runtime/runtime.json`; Factory installation
supplies its own `runtime.json`. Missing descriptors and missing/ambiguous checkouts
publish token-fenced assessment failures. Board never falls back to local dispatch
files. Refresh remains read-only with respect to runs, admission and tracker mutation,
with bounded process groups and existing request coalescing.

### Maintaining a complete code override

Start with a copy of a prepared bundle in a checkout-contained directory. Review
all custom executable changes, keep its private dependencies complete, then use
the trusted Factory checkout's pure helper to calculate a new manifest. For example,
from the project root, replacing both paths with the intended absolute paths:

```sh
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  import { regenerateRuntimeManifest } from "/path/to/factory/orchestrator/workflow.mts";
  const directory = "/path/to/project/workflow";
  writeFileSync(directory + "/runtime-manifest.json",
    JSON.stringify(regenerateRuntimeManifest(directory), null, 2) + "\\n");
'
```

The helper only reads and hashes files; the caller explicitly writes its result.
It does not install packages, migrate projects or confer review authority. Configure
`workflow.mode = "project"` with the repository-relative directory and explicitly
confirm recovery review after inspecting the complete override. A stale manifest
is an error, never a reason to run Factory code instead.

## Remaining integration boundaries

Low-level entrypoints consume explicit context; they do not discover descriptors.
`factory config explain` resolves and validates the selected runtime without importing
its executable modules, preparing bundles or acquiring leases. A project override's
actual behavior remains opaque. Do not treat an old copied scaffold as a prepared bundle.

Configured instruction files are validated and frozen separately for implementation,
verification, analysis and recovery. Common files precede role files and canonical
aliases are deduplicated. Their role-specific hashes participate in policy identity;
current-input checks reload them and revoke authority on changes. Frozen text is
inserted literally in an additive section, never as a replacement Factory template.
Missing or invalid configured files fail closed.

These changes are source contracts, not deployment or migration instructions.
They neither install a runtime into a real project nor resume schedules.
