# sandcastle-helper

Factory runs ticket-driven implementation and independent verification in Sandcastle environments. It tracks runs on a local operations Board and can dispatch work manually or on a schedule. See [the glossary](docs/GLOSSARY.md) for the terms used here.

Development implementation in this repository runs through Factory from prepared tickets. Interactive sessions handle investigation, planning, tickets and documentation. See [AGENTS.md](AGENTS.md) for repository policy.

## What belongs where

| Need | Where it belongs |
| --- | --- |
| Change tracker, selection, model family, merge policy or sandbox setup | Project `.sandcastle/factory.toml`. See [project configuration](docs/project-config.md). |
| Add project-specific instructions for a role | Contained Markdown files referenced by TOML. They are additive, not replacements for Factory's safety gates. See [instructions](docs/project-config.md). |
| Change Factory's implementation for all projects | Factory source and a new installed shared runtime. See [execution context](docs/execution-context.md). |
| Change workflow code for one project | An explicit, complete project override, maintained and reviewed by its owner. See [workflow adaptation](orchestrator/ADAPTING.md). |

A new project holds data and environment assets, not a copied executable workflow. Factory selects one complete runtime, including its prompts and private dependencies. Copying individual `main.mts` or dispatcher files into a project does not override it. Project mode requires a complete validated bundle and never fills missing files from Factory. Custom code is opaque: validation and a content identity do not prove its behavior or safety. Configuration explanation reports configured intent, not an override's actual models or stages.

Installed runtime bytes have a content identity. A running invocation and its children keep the selected runtime even when a newer one is published. Both copied and `--link` installs publish independent runtime bytes, so changing a linked checkout requires reinstalling to publish the changes. See [runtime selection and ownership](docs/execution-context.md) and [CLI installation](docs/factory-cli.md).

## Start a project

These examples show syntax, not authorization to install, contact a tracker, build an image or start work. They assume Factory has already been installed by an operator. See [installation and operator commands](docs/factory-cli.md) and [environment setup](skills/sandcastle-setup/SKILL.md) for prerequisites.

```sh
# GitHub personal profile
factory init /path/to/project --profile personal --repo owner/repo --image my-image

# GitLab client profile
factory init /path/to/project --profile client --repo group/project --image my-image --host git.example.com --project-id 42
```

Init creates the data-only `.sandcastle/factory.toml`, environment placeholders, ignore file and dispatch wrapper without overwriting existing files. It does not provision an image or contact a tracker. Both profiles default to the OpenAI family; set `[agent] family = "anthropic"` in the TOML to select Anthropic instead. Profiles also differ in tracker, selection and merge defaults. Review the [complete profile and configuration reference](docs/project-config.md) before use.

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

## Existing projects and migration

Version 2 TOML is required. Missing or version 1 configuration and legacy executable settings require an owner-led manual migration; this is a breaking change, not an automatic conversion. Review the old settings and workflow before choosing the shared runtime or maintaining a complete override. See [manual migration](docs/project-config.md) and [workflow adaptation](orchestrator/ADAPTING.md). Do not assume `factory init` or an update will migrate customized code.

## Operations and verification

The [Factory CLI reference](docs/factory-cli.md) covers dispatch, scheduling, recovery, installation and operator controls. The [execution context](docs/execution-context.md) describes runtime identity and ownership. Factory's host verifies structured evidence and exact delivery identity, but structural checks cannot establish whether an agent's evidence satisfies every acceptance criterion.

Every verification image needs the documented non-root Playwright/Chromium capability. Project-specific layers are optional. See [environment setup](skills/sandcastle-setup/SKILL.md) and [workflow adaptation](orchestrator/ADAPTING.md).

For offline tests, fixture boundaries and optional smoke checks, see [TESTING.md](TESTING.md). Interactive agents use `gh-axi` for ordinary GitHub operations; use plain `gh --attach` for screenshot or video uploads. Factory's runtime uses plain `gh`. See [GitHub media upload details](docs/research/github-media-uploads.md).
