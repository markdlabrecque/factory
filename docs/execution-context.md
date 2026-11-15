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
| `FACTORY_RUNTIME_ROOT` | Existing canonical absolute bundle directory, named by its content ID |
| `FACTORY_RUNTIME_ID` | The selected manifest's content ID |
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

## Deliberate integration boundaries

Issue #164 owns top-level CLI, scheduler and Board selection/routing, complete
project-workflow overrides and the corresponding recovery review policy. This
change does not discover descriptors or switch modes in low-level entrypoints.
Selection explanation can consume an already supplied context; it does not select
a runtime itself. Existing copied-launch callers without context fail closed until
the routing change supplies it. Do not treat a copied scaffold as a prepared bundle.

Issue #165 owns data-only scaffolding and instruction-file validation/loading,
ordering and composition. `FrozenAdditive` and `freezeAdditive(text, hashes)` are
the narrow input interface. The current runtime uses the empty value only. Nonempty
configured instruction lists are held with an explicit diagnostic instead of
silently ignored. No project file can replace a Factory template. The later
instruction consumer must bind the bytes it loads through this same hash interface.

These changes are source contracts, not deployment or migration instructions.
They neither install a runtime into a real project nor resume schedules.
