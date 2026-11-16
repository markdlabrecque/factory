# Image and sandbox readiness

Factory requires global Playwright and headless Chromium for every ticket, including CLI-only work. Readiness never downloads tools, builds an image, obtains credentials or relaxes verification policy. Provisioning and image rebuilds remain operator actions.

## Checks before work

Project configuration and environment data come from `.factory/factory.toml` and `.factory/.env`. Shared layout inspection rejects `.sandcastle`-only, mixed and unsafe layouts before image/tracker/container work. Readiness probes do not convert projects or rewrite prior evidence. Project helper mounts use `.factory/sandbox` at the unchanged container path `/opt/sandcastle`. Already-owned exact-container cleanup and settlement remain available during a layout hold. Maintained image source is [`.factory/Dockerfile`](../.factory/Dockerfile); standard images still need the [selected Pi/setup layers](../skills/factory-setup/SKILL.md#image-layers). The [offline layout acceptance](../TESTING.md#supported-layout-acceptance) proves path selection and refusal, not a built or running image.

The selected runtime's `dispatch.sh` validates v2 TOML and performs host/image/UID checks, then runs that runtime's `capabilities.mts` before dispatch/main startup. Runtime dependencies are already prepared in the complete selected bundle; dispatch does not install project packages. Its existing interactive missing-image build behavior is unchanged. A background readiness failure stops the pass with provisioning guidance and starts no implementation agent.

The recovery launcher checks the selected complete workflow, required project-override review, ownership and budget eligibility, then awaits the same image check before atomic claim-and-charge. It reads `sandbox.image` through the v2 TOML parser. Missing, v1, invalid or unreadable TOML is a configuration hold; there is no executable `CONFIG.image` fallback. Discovery never imports customized `main.mts`. Factory-mode recovery needs no per-project executable review; complete project overrides do.

Readiness returns a retryable environment hold separately from a ticket refusal. Pause/off/cancellation checks run before and after probing. A bad image spends no attempt budget and creates no repair sandbox. Neither probe success nor failure renews budgets, resets attempts or changes claims and delivery proof. The async launcher still rechecks admission under the existing atomic lock. Current execution-analysis preparation is also required before launch; a Board assessment cannot replace it, and image readiness cannot replace either prerequisite.

## Owned local image probes

The helper resolves the local image tag to its immutable `sha256:` ID and validates the image user. It creates one `factory-preflight-<uuid>` container with an ownership label, explicit Node entrypoint, non-root UID/GID and networking disabled. `--pull never` prevents a daemon-side pull if the inspected local image disappears. There are no host workspace, evidence, credential or socket mounts and no agent environment injection.

The shared browser probe checks the CLI, resolves global Playwright with CommonJS via `npm root -g`, launches Chromium, reads an inline DOM marker and closes the browser. Its Node watchdog owns a detached process group and kills descendants on the 30-second deadline and on leader exit. Success requires browser cleanup. Host control and exact cleanup commands each have at most 10 seconds. The host also refuses a probe still running after its deadline. Diagnostics use fixed bounded stage names, never arbitrary Docker/browser errors or environment dumps.

Cleanup inspects the exact recorded name, label and immutable image, removes only its confirmed container ID and verifies absence through a successful daemon listing. A failed or uncertain Docker response is a hold. Cancellation still awaits cleanup with a separate, non-cancelled command boundary. Unconfirmed cleanup retains ownership and publishes no success.

## Success cache and locks

Only confirmed success after confirmed cleanup is atomically published under `<state>/capabilities/`. The SHA-256 key includes immutable image ID, UID, GID and the shared probe/watchdog source hash. Records contain those fields and `completedAt`. Tags are resolved on every call. A changed image, user or probe misses the cache; malformed or mismatched records re-probe safely. Failures are not permanent cache entries.

A per-key owner-process lock prevents duplicate probes. A live or unknown owner produces a retryable hold. A dead owner is reconciled against its exact recorded container before releasing the lock; that call still returns a hold and a subsequent call may retry. There is no age-based theft. Malformed ownership, an uncertain container or an interrupted dead-owner reconciliation stays held for operator inspection. Do not delete locks to conceal uncertain cleanup. Cache records are disposable, but are never ticket proof.

## Actual runs still check twice

Startup pins the immutable ID through `FACTORY_READY_IMAGE`. `main.mts` re-resolves readiness and refuses a different ID before constructing a sandbox. Both normal and recovery sandboxes use the tested ID rather than the mutable tag.

After custom sandbox setup, the shared probe runs before the implementer or repair agent, writing `setup-browser-preflight.log`. A setup failure starts neither agent nor verifier. Recovery setup failures detected after admission keep their spent attempt; there is no refund. Independent verification always runs its own separate probe and writes `browser-preflight.log`. Neither setup diagnostics nor an image cache authorizes delivery or replaces actual browser/evidence requirements.

## Runtime and image upgrades

In Factory mode, install the intended Factory source to publish a new immutable runtime bundle. New invocations select it; existing invocations and children keep their pinned bytes. Data-only init does not copy capability helpers into projects, and `factory update --apply` neither installs them nor repairs workflow code.

A complete project override must be maintained as one coherent bundle, including capability, handoff, recovery, sandbox and dependency assets. Validate its manifest and private dependencies, inspect its behavior and explicitly renew recovery review after identity changes. Do not combine a few new helpers with old copied entrypoints or fill missing override files from Factory. See [complete override maintenance](../orchestrator/ADAPTING.md#complete-project-workflow-override).

Configured images remain operator-maintained for both modes. A source update alone does not install a runtime, rebuild an image or enable scheduling. See [image layers](../skills/factory-setup/SKILL.md#image-layers) for provisioning and rebuild guidance, [ticket readiness](ticket-readiness.md#prepared-sandbox-gate) for actual-user filesystem probes and [testing](../TESTING.md) for offline verification.
