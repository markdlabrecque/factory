---
name: sandcastle-setup
description: Set up Factory project environments and Sandcastle image layers for GitHub or GitLab, including Pi, Playwright, optional web, Drupal, WordPress and ddev compatibility. Use when preparing or adapting a project's Factory sandbox.
---

<!-- Project environment setup uses v2 data and a selected shared runtime; custom executable workflows require a complete reviewed override. -->
# Sandcastle setup

## Detect and confirm

Inspect the checkout and propose the tracker, image, agent family and optional layers before changing it. Confirm consequential choices with the user. A GitHub remote suggests the personal profile; a GitLab remote suggests client. Both profiles select OpenAI Pi by default. Tracker choice does not select a different agent family.

- Drupal: look for Drupal dependencies in `composer.json` or a `web/core` or `docroot/core` directory. Identify the docroot and project Drush.
- WordPress: look for `wp-config.php`, `wp-content`, `wp-includes` or WordPress Composer dependencies. Identify the docroot.
- For PHP, use the DDEV PHP version if present, otherwise Composer's platform or PHP requirement; propose a minor version. Ask when the stack is ambiguous.
- If project tests call `ddev`, propose the compatibility shim. Web and CMS layers are optional; Playwright and headless Chromium are required for every standard Factory verifier.

## Choose where changes go

| Task | Place |
| --- | --- |
| Image, sandbox startup, selection, merge, tracker or family | v2 `.factory/factory.toml` |
| Script bodies and Docker build context | Project-owned environment files and helper scripts |
| Common or role-specific testing and environment advice | Checkout Markdown referenced by `[instructions]` |
| Change stages, prompts or executable policy | Complete project workflow override, reviewed by its owner |

Read [project configuration](../../docs/project-config.md) for the schema and [adapting Factory](../../orchestrator/ADAPTING.md) for instruction composition and complete overrides. Do not patch the shared default runtime or install Factory runtime packages into the project. An override is trusted executable code, not a partial overlay or a guarantee of standard gates or model policy.

## Prepare the project

1. For a new project, use `factory init [path] --profile personal|client --repo <namespace/project> --image <image>`. Client also requires `--host <gitlab-host> --project-id <number>`. Confirm the inputs before running it. Init creates v2 TOML, an empty private `.env`, `.env.example`, `.gitignore` and a dispatch wrapper. It registers the project after successful writes, preserves existing files and does not build an image, install project runtime dependencies, authenticate or copy workflow code and prompts. Both profiles use OpenAI Pi. Personal enables automatic merge; client leaves merge to a person. Review the generated selection and merge values.
2. Configure `sandbox.image`, selection and merge settings in TOML. Keep startup scripts separate. For web setup, remove the existing `setup = []` before adding a setup table. This is a fragment, not a complete configuration:

   ```toml
   [sandbox]
   image = "my-project-image"

   [[sandbox.setup]]
   command = 'start-web.sh web'
   sudo = true
   ```

   Substitute the confirmed docroot and make the helper available in the sandbox. Setup commands are trusted project code executed inside the sandbox, not a security boundary. See the schema for quoting and optional timeouts.
3. Put test and fixture guidance in contained Markdown, with common instructions before implementation, verification, analysis or recovery instructions. Configure their paths in `[instructions]`; see [adapting Factory](../../orchestrator/ADAPTING.md#project-data-and-instructions). Factory reads literal text and retains its own templates and gates. Instruction edits can require fresh analysis or verification.
4. Provision the selected Pi family on host and image. OpenAI needs a working host Pi login and a Pi-capable image. Anthropic needs the `pi-claude-subscription` provider and its host login, plus the provider, Claude Code CLI and a user-supplied container credential. The provider uses Claude Code internally; direct Claude Code is not a selectable Factory agent. Never obtain credentials on the user's behalf. A missing provider or credential is a hold, not a reason to switch families.

The standard policy uses Pi with high thinking. Ticket descriptions may declare `Model tier: small`, `mid` or `large`; missing means Mid. Factory code owns exact mappings, analysis uses Mid, and verification and recovery use Large. No project model aliases or per-role model settings are supported. The [model policy](../../docs/project-config.md) lists the current mappings and parsing rules.

If asked about interactive attach/steer, consult the [herdr-core experiment](../../docs/research/interactive-agents-herdr-core.md). Adoption was approved, but production integration is not implemented. The experiment used interactive Claude Code rather than the current standard Pi workflow. Keep it separate from normal environment setup; it is not a supported backend or an installation prerequisite.

## Image layers

Use the confirmed snippets in `layers/`, pinning versions and adapting the project's Dockerfile and build context:

| Layer | Source | When |
| --- | --- | --- |
| Pi | `layers/agent-pi/pi.Dockerfile.snippet` | All standard Factory images. The subscription-provider section is for the Anthropic family, regardless of profile. |
| Tracker | `layers/tracker-github/` or `layers/tracker-gitlab/` | Optional CLI packages for an explicitly reviewed custom environment. Standard Factory tracker reads/writes run on the host; do not inject tracker credentials into standard agent sandboxes. The command-substitution notes are historical. |
| Browser | `layers/browser-playwright/` | Every standard Factory verifier, including static projects and recovery. |
| Web | `layers/runtime-web/` | PHP/web projects needing services. |
| CMS | `layers/cms-drupal/` or `layers/cms-wordpress/` | As detected and confirmed. |
| ddev compatibility | `layers/compat-ddev/` | When project scripts call ddev inside the sandbox. |

The Pi snippet's comment calls its subscription section personal-only; choose that section by `agent.family`, not by profile. Keep credentials out of the image. For Playwright, use the project's locked `playwright-core` version when applicable; otherwise use the supplied layer's version. Install browser dependencies as root and leave the browser readable and executable by the sandbox user. Copy the chosen web and compatibility helpers into the build context as required by their snippets.

Review [image readiness](../../docs/image-readiness.md) before rebuilding an existing image. Image capability checks, sandbox setup and the independent verifier browser check are separate. Ask before a build or live smoke test; do not present source inspection as a successful image test. The dispatcher uses the selected bundle's private Sandcastle executable, not project `npx` or a project npm install.

## Inspect and hand off

Use `factory config explain [--project <name|path>] [--json]` to inspect configuration and selected runtime without executing custom workflow code. `factory selection explain <ticket> [--project <name|path>] [--json]` performs tracker reads and explains configured selection intent; custom workflow behavior remains opaque. A dispatch dry run can make tracker and analysis calls, so obtain approval before running it. Consult [Factory CLI](../../docs/factory-cli.md) for commands, recovery and scheduler consequences.

For a complete override, start from a published complete bundle and follow [the override procedure](../../orchestrator/ADAPTING.md#complete-project-workflow-override), including explicit manifest regeneration and full executable recovery review. Changes to the selected override or dependencies invalidate that review. Identity is not a safety guarantee. Never confirm review or enable a schedule on the operator's behalf without authorization.

For GitHub, check [verification media prerequisites](../../docs/research/github-media-uploads.md). For automated checks, follow [TESTING.md](../../TESTING.md): use isolated fixtures and stub external boundaries, not real credentials, services or provider installations. Report what was configured, what remains for the operator and which checks actually ran.
