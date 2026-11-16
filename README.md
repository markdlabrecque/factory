# Factory

Factory runs ticket-driven implementation and independent verification in Sandcastle environments. It tracks runs on a local operations Board and can dispatch work manually or on a schedule. See [the glossary](docs/GLOSSARY.md) for the terms used here.

Development implementation in this repository runs through Factory from prepared tickets. Interactive sessions handle investigation, planning, tickets and documentation. See [AGENTS.md](AGENTS.md) for repository policy.

## Project status and feature guide

The first five roadmap slices are implemented: installation, project registration/init, manual execution, scheduling/self-recovery, and project-asset diagnostics/ticket journals. V2 data-only configuration, shared immutable runtimes and complete-input/readiness gates are also implemented. This describes source behavior, not installation on any particular machine. The [roadmap](docs/factory-cli.md#roadmap) separates completed work from deferred work.

| Capability | Reference |
| --- | --- |
| Installation, doctor, Board service and safe uninstall | [Factory CLI](docs/factory-cli.md) |
| V2 configuration, profiles and family/tier policy | [Project configuration](docs/project-config.md) |
| Shared runtime identity, pinning, leases and complete overrides | [Execution context](docs/execution-context.md), [workflow adaptation](orchestrator/ADAPTING.md) |
| Pinned SDK patch, dependency updates and patch removal | [Sandcastle patch maintenance](docs/sandcastle-patch.md) |
| Selection, dependency/conflict analysis, dispatch, run and retry | [Selection explanation](docs/factory-cli.md#selection-explanation), [execution commands](docs/factory-cli.md#slice-three-spec) |
| Linux/macOS scheduling, project opt-in, health and timing | [Scheduler contracts](docs/factory-cli.md#slice-four-scheduler-storage) |
| Bounded recovery, saved-work ownership, reports and explicit reset | [Recovery guide](docs/design/self-recovery.md) |
| Independent verification, frozen host proof and exact-head delivery | [Verification](docs/factory-cli.md#slice-four-shared-verification-and-delivery), [existing-PR follow-through](docs/factory-cli.md#existing-delivery-follow-through) |
| Complete frozen ticket/parent context, filesystem holds and no-commit explanations | [Ticket readiness](docs/ticket-readiness.md) |
| Image capability checks, actual-user sandbox probes and browser provisioning | [Image readiness](docs/image-readiness.md), [environment setup](skills/factory-setup/SKILL.md) |
| Live Board, evidence, ticket stats and project readiness | [Board presentation](docs/board-design-prototype.md#promotion-to-the-board-template), [readiness](docs/factory-cli.md#board-readiness) |
| Ticket comments/sync, verdict correction, archive and restore | [Ticket journal](docs/factory-cli.md#slice-five-ticket-journal) |
| External-merge reconciliation and safe local branch/worktree cleanup | [Reconciliation and cleanup](docs/factory-cli.md#merged-work-reconciliation-and-local-cleanup) |
| Project-asset reports, read-only workflow diagnostics and local event export | [Update](docs/factory-cli.md#project-asset-diagnostics), [workflow status](docs/factory-cli.md#read-only-workflow-identity-report), [telemetry](docs/telemetry.md) |
| Domain relationships and terminology | [Domain model](docs/domain-model.md), [glossary](docs/GLOSSARY.md) |

New projects use `.factory` for configuration, environment assets, worktrees and evidence. `.sandcastle`-only and mixed-layout projects are unsupported and are not converted. Tracked image/environment examples now live in `.factory/`; obsolete copied workflow modules have been retired. [Offline layout acceptance](TESTING.md#supported-layout-acceptance) is complete, including preservation of unsupported projects. This is source/test evidence, not a live rollout or proof that the example image has been built. [Slice 6](docs/factory-cli.md#roadmap) is interactive attach/steer. The [herdr-core attach/steer experiment](docs/research/interactive-agents-herdr-core.md) was approved for adoption, but production integration is not implemented. Standard Factory runs remain noninteractive Pi. A dedicated recovery Board UI is also deferred.

## What belongs where

| Need | Where it belongs |
| --- | --- |
| Change tracker, selection, model family, merge policy or sandbox setup | Project `.factory/factory.toml`. See [project configuration](docs/project-config.md). |
| Add project-specific instructions for a role | Contained Markdown files referenced by TOML. They are additive, not replacements for Factory's safety gates. See [instructions](docs/project-config.md). |
| Change Factory's implementation for all projects | Factory source and a new installed shared runtime. See [execution context](docs/execution-context.md). |
| Change workflow code for one project | An explicit, complete project override, maintained and reviewed by its owner. See [workflow adaptation](orchestrator/ADAPTING.md). |

A new project holds data and environment assets, not a copied executable workflow. Factory selects one complete runtime, including its prompts and private dependencies. Copying individual `main.mts` or dispatcher files into a project does not override it. Project mode requires a complete validated bundle and never fills missing files from Factory. Custom code is opaque: validation and a content identity do not prove its behavior or safety. Configuration explanation reports configured intent, not an override's actual models or stages.

Installed runtime bytes have a content identity. A running invocation and its children keep the selected runtime even when a newer one is published. Both copied and `--link` installs publish independent runtime bytes, so changing a linked checkout requires reinstalling to publish the changes. See [runtime selection and ownership](docs/execution-context.md) and [CLI installation](docs/factory-cli.md).

## Start a project

These examples show syntax, not authorization to install, contact a tracker, build an image or start work. They assume Factory has already been installed by an operator. See [installation and operator commands](docs/factory-cli.md) and [environment setup](skills/factory-setup/SKILL.md) for prerequisites.

```sh
# GitHub personal profile
factory init /path/to/project --profile personal --repo owner/repo --image my-image

# GitLab client profile
factory init /path/to/project --profile client --repo group/project --image my-image --host git.example.com --project-id 42
```

Init creates the data-only `.factory/factory.toml`, environment placeholders, ignore file and dispatch wrapper without overwriting existing files. It does not provision an image or contact a tracker. Both profiles default to the OpenAI family; set `[agent] family = "anthropic"` in the TOML to select Anthropic instead. Profiles also differ in tracker, selection and merge defaults. Review the [complete profile and configuration reference](docs/project-config.md) before use.

```sh
factory config explain --project /path/to/project --json
```

This validates configuration, instructions and the selected runtime without executing project workflow code. It does not check live credentials, image or tracker availability. `factory selection explain` is a separate operation that reads the tracker. See [configuration explanation](docs/factory-cli.md#configuration-explanation) and the [CLI reference](docs/factory-cli.md).

### Model tiers

Factory's standard workflow uses Pi with a fixed family policy and high thinking. It does not offer direct Claude Code as a selectable agent. Put one of these fields in a ticket description:

A Small ticket:

```text
**Model tier:** small
```

A Mid ticket:

```text
**Model tier:** mid
```

A Large ticket:

```text
**Model tier:** large
```

A ticket without a tier field also selects Mid:

```text
Implement the acceptance criteria below.
```

Use only one tier field per ticket. Analysis uses Mid; verification and recovery use Large. Legacy `Model:` and `Pi model:` declarations are rejected. See [model policy and declaration rules](docs/project-config.md) for mappings and validation.

## Supported configuration

Factory requires [version 2 TOML configuration](docs/project-config.md). Missing or version 1 configuration and legacy executable settings are unsupported.

## Operations and verification

The [Factory CLI reference](docs/factory-cli.md) covers dispatch, scheduling, recovery, installation and operator controls. The [execution context](docs/execution-context.md) describes runtime identity and ownership. Factory's host verifies structured evidence and exact delivery identity, but structural checks cannot establish whether an agent's evidence satisfies every acceptance criterion.

Every verification image needs the documented non-root Playwright/Chromium capability. Project-specific layers are optional. See [environment setup](skills/factory-setup/SKILL.md) and [workflow adaptation](orchestrator/ADAPTING.md).

For offline tests, fixture boundaries and optional smoke checks, see [TESTING.md](TESTING.md). Interactive agents use `gh-axi` for ordinary GitHub operations; use plain `gh --attach` for screenshot or video uploads. Factory's runtime uses plain `gh`. See [GitHub media upload details](docs/research/github-media-uploads.md).
