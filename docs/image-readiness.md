# Image and sandbox readiness

Factory requires global Playwright and headless Chromium for every ticket, including CLI-only work. Readiness never downloads tools, builds an image, obtains credentials or relaxes verification policy. Provisioning and image rebuilds remain operator actions.

## Checks before work

`dispatch.sh` validates TOML and performs its existing host/image/UID checks, then runs the copied `capabilities.mts` before dependency installation and dispatch/main startup. Its existing interactive missing-image build behavior is unchanged. A background readiness failure stops the pass with provisioning guidance and starts no implementation agent.

The recovery launcher checks reviewed workflow, ownership and budget eligibility, then awaits the same image check before atomic claim-and-charge. It reads `sandbox.image` through the TOML parser. Without TOML it accepts only a single literal legacy `CONFIG.image`, including the shipped TOML-or-legacy fallback. Dynamic, overridden or ambiguous code is unknown. Discovery never imports customized `main.mts`. Use an explicit reviewed configuration rather than executing code to find the image.

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

## Reviewed upgrades

Upgrade the CLI and project workflow together. `factory update --dry-run` identifies missing/outdated helpers; `--apply` may add `capabilities.mts` but keeps customized and project-owned files. Merge `dispatch.sh` and `main.mts` by hand. Review `capabilities.mts`, `handoff.mts`, `recovery.mts`, `recovery-sandbox.mts` and the existing workflow dependencies as one coherent copy, then have the operator confirm `factory recovery review --confirm`. Capability changes invalidate that review.

Do not silently adopt a partial upgrade or enable schedules. Old project-owned startup files need this explicit merge to gain early checks. No installed app, project copy, configured image or running service is changed by updating this repository. See [browser provisioning](../orchestrator/ADAPTING.md#browser-provisioning-and-upgrades) for operator-owned image layers and rebuild guidance, and [testing](../TESTING.md) for offline verification.
