<!-- Adapting project data, additive instructions and complete workflow overrides for the shared Factory runtime. -->
# Adapting Factory to a project

Factory selects a complete runtime for each invocation. In the default `factory` mode, executable code, prompts and private dependencies come from the installed shared bundle. Project files provide data and environment assets. Copied `.factory/main.mts`, prompts or individual helpers do not override the shared runtime. A dispatch and its detached children retain their selected runtime even if another bundle is published.

## Choose the smallest customization

| Need | Where it belongs |
| --- | --- |
| Tracker, labels, ticket selection, concurrency, merge, image or startup commands | `.factory/factory.toml`, schema v2 |
| Project test commands, fixtures or stack-specific advice for agents | Repository Markdown listed in `[instructions]` |
| Change workflow stages, model policy, prompts or executable behavior | Complete project workflow override, maintained and reviewed by its owner |

The [project configuration reference](../docs/project-config.md) owns the schema and defaults. The [CLI reference](../docs/factory-cli.md) owns operator commands, scheduling and recovery. Environment setup is covered by the [Factory setup skill](../skills/factory-setup/SKILL.md). Do not patch the published shared default for a single project or add Factory runtime dependencies to the project. The [Sandcastle patch maintenance guide](../docs/sandcastle-patch.md) owns the shared SDK patch, coordinated dependency updates and eventual removal, including private SDK preparation for complete overrides.

## Project data and instructions

The repository's [`.factory/Dockerfile`](../.factory/Dockerfile), [environment example](../.factory/.env.example) and [ignore rules](../.factory/.gitignore) are maintained source assets. They are not a copied executable workflow or a ready-to-run standard Pi image. Use the setup skill's selected layers; init does not copy the Dockerfile.

Both `factory init` profiles create only `factory.toml`, `.env`, `.env.example`, `.gitignore` and `factory-dispatch.sh` under `.factory/`. They do not copy runtime modules or prompts. Personal uses GitHub and automatic merge by default; client uses GitLab and manual merge by default. Both select the OpenAI Pi family. Review generated settings and provision the image and selected Pi family separately; init does not authenticate, build an image or install a provider.

Set `sandbox.image` to the project image and use ordered `[[sandbox.setup]]` entries for startup. Keep script bodies in project-owned helper files and make them available to the sandbox. Remove the profile's `setup = []` before adding setup tables. Commands are trusted code run inside the sandbox; TOML is not a security boundary. For example, this is a fragment, not a complete configuration:

```toml
[sandbox]
image = "my-project-image"

[[sandbox.setup]]
command = 'start-web.sh web'
sudo = true
```

Set `[selection]`, `[selection.labels]`, `[selection.order]` and `[merge]` for ticket and delivery policy. `factory config explain` reports normalized configuration and runtime identity without executing project workflow code; `factory selection explain` uses tracker reads and reports configured selection intent. Neither certifies custom code behavior. See the CLI reference for arguments and side effects.

Create Markdown files inside the checkout, then reference them in this TOML fragment:

```toml
[instructions]
common = ["docs/factory-common.md"]
implementation = ["docs/factory-implementation.md"]
verification = ["docs/factory-verification.md"]
analysis = []
recovery = []
```

Put shared environment and test conventions in common, implementation commands in implementation, and independent evidence and test advice in verification. Common precedes role-specific text; canonical duplicate paths are read once. Files must exist, resolve inside the checkout and be Markdown, not secret paths. Text is inserted literally into the appropriate Factory template. It is additive, not a replacement for template, evidence, admission, verification, delivery or recovery requirements. Changes to instructions, settings or runtime inputs can invalidate analysis and proof authority; active invocations keep their frozen inputs.

## Model policy

The standard workflow uses Pi with high thinking. `[agent] family` selects `openai` or `anthropic`; no model IDs, aliases, providers or thinking settings are accepted as project configuration. A ticket's own standalone `Model tier: small`, `mid` or `large` selects the implementation tier; absent means Mid. Analysis uses Mid, verification and recovery use Large. Invalid or conflicting declarations hold the ticket. See [model policy and parsing](../docs/project-config.md) for exact IDs and rules.

Provision the selected family on the host and in the image. OpenAI uses the host Pi login. Anthropic uses the Pi subscription provider, its host prerequisites, and the container provider and credential. Claude Code is used internally by that provider, not a selectable direct agent. Neither family falls back to the other when provisioning fails. The setup skill covers the image layers and [image readiness](../docs/image-readiness.md) covers browser checks.

The [herdr-core attach/steer experiment](../docs/research/interactive-agents-herdr-core.md) has an adoption decision, but no production integration. It tested interactive Claude Code, not the current standard Pi workflow. It is not a supported agent backend or a setup prerequisite; terminal status, detachment and idle are not Factory completion or delivery authority.

## Complete project workflow override

Use this only when data and additive instructions cannot express the change. Project mode selects one complete checkout-contained bundle, not a partial overlay. The owner maintains the closed inventory in [`cli/src/runtime-assets.mts`](../cli/src/runtime-assets.mts), including prompts, helpers, package manifests and private `node_modules`. Unknown source files, missing files, symlinks in source assets, invalid dependencies or stale hashes fail validation. No installed file fills a gap.

1. Start with a complete published Factory runtime bundle, including its private dependencies. Copy it into a new directory inside the project, preserving file modes. Never edit the published bundle itself.
2. Review and edit the relevant stages or `model-policy.mts` in that copy. Keep the full inventory and compatible private dependencies. Changes to package manifests or dependencies require the owner to maintain a complete locked private dependency snapshot. Extra source helpers are not accepted by the closed inventory.
3. Regenerate the manifest using a trusted Factory checkout and explicitly write the returned value. The following example runs from the project root. Replace the absolute Factory checkout path and the directory if needed; the directory must already exist and resolve canonically inside the checkout. This writes only the override manifest.

```sh
node --input-type=module -e '
  import { realpathSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { regenerateRuntimeManifest } from "/path/to/factory/orchestrator/workflow.mts";
  const directory = realpathSync(".factory/workflow");
  const manifest = regenerateRuntimeManifest(directory);
  writeFileSync(join(directory, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
'
```

4. Select that directory in the project's existing v2 TOML. This is a fragment; do not add a second `[workflow]` table.

```toml
[workflow]
mode = "project"
directory = ".factory/workflow"
```

5. Inspect the complete executable bundle and its dependencies, then have the operator review recovery with `factory recovery review --project <name-or-path>` and, only after review, `factory recovery review --confirm --project <name-or-path>`. Factory mode needs no per-project executable review. In project mode a changed mode, directory, inventory, code or dependencies invalidates review. An invalid manifest cannot be repaired by review. See [recovery review](../docs/factory-cli.md) for the full operator contract.

The manifest identifies source bytes, modes and Node metadata and separately records a dependency digest. It is not a signature or a safety certificate. A valid custom bundle is trusted executable code; validation does not prove it follows the standard model map, stages or internal gates. Review does not itself authorize admission, proof reuse, cleanup or delivery. Changes require fresh review and may require fresh analysis or verification. Do not automatically resume scheduling.

Factory's host-owned project filesystem gate still runs before selected custom run/dispatch and explicit analysis-refresh entrypoints, including scheduled paths. This is not evidence that an override collects complete child/parent input or probes its actual sandbox user/mounts. Those internals remain opaque. Standard workflows freeze structured ticket input and probe after setup before implementation/repair; an override that retains those helper calls can retain that behavior, but Factory neither supplies missing helpers from the installed runtime nor imposes a new override protocol. Passive status/doctor/Board readers do not execute an override to test it. See [readiness coverage and safe recovery](../docs/ticket-readiness.md#runtime-and-coverage-boundary).

For overrides adapting the standard verifier, `BASE_SHA` still names the original
implementation base and `TIP_SHA` the exact candidate. `RECOVERY_START_SHA` is
`(none)` in ordinary verification; the standard recovery runner supplies an exact
host-validated attempt start only for behavioral reproduction. Adopt the updated
handoff and prompt together; prompt text and additive instructions cannot authorize
another comparison or change the proof base. Complete overrides stay independently
reviewed; this does not add a required asset or change the evidence schema.

## Operation

Version 2 TOML is required. Missing or v1 configuration is unsupported and does not fall back to executable configuration.

Use `factory dispatch` and `factory run` rather than copied module entrypoints. A dry run can perform analysis and tracker reads; it is not an offline check. For scheduler, recovery, delivery and evidence behavior, use the [CLI reference](../docs/factory-cli.md). Standard Factory verification requires Playwright and headless Chromium even for non-web projects. Custom images remain owner-maintained. Tests and their offline boundaries are in [TESTING.md](../TESTING.md).
