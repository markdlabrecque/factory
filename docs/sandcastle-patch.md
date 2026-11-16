# Factory's Sandcastle layout patch

## Status and scope

New private runtime preparation activates this patch. `installRuntimePackages()` runs `npm ci --include=dev --include=optional --ignore-scripts`, then applies the guarded patch before returning to `prepareRuntimeBundle()` for dependency hashing and manifest publication. Existing published bundles are never rewritten. Merely importing the helper does not patch anything.

Factory's supported project callers and the patched SDK use `.factory` together. Preparation failures discard only the new staging directory and leave the prior descriptor and bundle usable. Do not activate against an SDK version without exact-package smoke evidence. No old `.sandcastle` project conversion is provided. Refusing old or mixed project layouts belongs to Factory's project admission checks, not this SDK patch.

Upstream 0.14.0 hardcodes the project directory in several independent paths. Changing only worktree creation would leave pruning, managed-worktree Git checks, environment loading, logs, saved patches and image configuration inconsistent. Factory owns a narrow byte patch rather than a fork or a replacement sandbox lifecycle.

## Owned inputs and upstream pin

- Applicator: `cli/src/sandcastle-patch.mts`.
- Specification: `cli/src/sandcastle-patch.json`, schema 1.
- Source inventory: `cli/src/runtime-assets.mts`. Both inputs are copied into the flat runtime under their basenames. Complete overrides must contain both files too.
- Package: `@ai-hero/sandcastle`, exactly `0.14.0`, as locked in `package-lock.json`.
- Original npm SHA-512 integrity:

  ```text
  sha512-s9B/23nPWL6y2sZkVxksqTge0MqGWr2HtjneGDf/V1npReiqDRlUJUvQ4+7K0oWORLqgHU5wLK0pfukg+UqTqQ==
  ```

The specification records the complete 95-file upstream package inventory, each file's original and patched SHA-256, and byte-offset edits with exact before/after text. Thirteen files change, through 69 bounded substitutions of the project-directory token. Unchanged files have equal hashes and no edits. Offsets refer to original UTF-8 bytes, not character positions; the applicator assembles edits in offset order, without fuzzy matching or global replacement.

The package name, version, metadata, MIT `LICENSE`, bundled upstream sources and source maps retain their original bytes. Source maps are provenance, not patched execution inputs. They still describe the original upstream source; when debugging a patched line, inspect the installed compiled file as well. `/.sandcastle-parent-git` is a container-internal mount name and remains unchanged. No dependency rename, lifecycle hook or shared/global package patch is involved.

## Edit coverage and rationale

| Upstream files/functions | Why this edit exists | Evidence needed to remove it |
| --- | --- | --- |
| `dist/chunk-G2R53CVZ.js`: `isManagedWorktree`, used by `resolveGitDirPins` | Recognize `.factory/worktrees/<name>` and check its Git common directory against the host repository. Creation alone must not bypass managed-worktree safety. | Upstream recognition and Git pin validation accept the configured Factory path, including rejection of a foreign common directory. |
| Same chunk: `create`, `pruneStale` | Create, reuse and prune under the same worktree root. The branch-collision diagnostic names that root too. | Upstream creation, reuse and pruning all honor the same configured directory. |
| Same chunk: `buildRecoveryMessage`, `createPatchDir`, `removePatchDir`, `completeSyncOut` | Save and clean patches under `.factory/patches`; printed recovery commands must refer to the actual worktree and patch paths. | Upstream sync-out storage, cleanup and recovery instructions all honor the configured directory. |
| `dist/index.js`: `resolveEnv` | Read the project's `.factory/.env`, with upstream parsing and provider precedence unchanged. | Upstream env discovery supports the configured directory without changing precedence. |
| Same file: `resolveRunLogging`, `buildSandboxHandle` bound-run logging, `createWorktree` bound-run logging | Put all three default log paths under `.factory/logs`, preserving explicit logging overrides and filename generation. | Every default logging entrypoint honors the directory; explicit paths still win. |
| Same file: `resolvePrompt` diagnostic | The suggested prompt-file path must not direct an operator to an unsupported layout. | The upstream diagnostic names the configured project directory or has no hardcoded project path. |
| `dist/main.js`: `scaffold`, `CONFIG_DIR`, `requireConfigDir`, `buildImageCommand`, `podmanBuildImageCommand`, init/setup guidance | CLI initialization, config existence checks and Dockerfile/Containerfile build-context discovery must agree. Change their user-facing project paths too. Preserve the `sandcastle` command name, build options and UID/GID behavior. | CLI scaffold, existence checks, both image commands and generated guidance all use the configured directory. Test default and explicit Dockerfile behavior separately if upstream changes either. |
| `dist/index.d.ts`: project-root and logging comments | Public declarations must describe the patched runtime. Types and exported names do not change. | Upstream declarations describe configurable paths accurately. |
| `dist/templates/{blank,simple-loop,parallel-planner,sequential-reviewer,parallel-planner-with-review}/main.mts`, plus both review templates' `CODING_STANDARDS.md` and `review-prompt.md` | CLI scaffold output contains executable prompt paths and review instructions. Leaving these untouched would produce a broken new scaffold even with a patched CLI config directory. | Every upstream template resolves prompts, instructions and main entrypoints consistently with the configured directory. |

The JSON is the exact per-file edit/hash authority. The table groups edits by behavior, not just by spelling. Before removing an edit, trace the new upstream call sites. A new option used by one entrypoint is not enough to remove the other edits. Search executable files, declarations and templates, including alternative quoting and composed paths. Treat source-map matches separately from runtime consumers.

## Application and integration API

Source-tree callers import:

```ts
import { prepareSandcastlePackage } from './sandcastle-patch.mts';
```

`cli/src/runtime-bundle.mts` imports this helper and calls it at the end of `installRuntimePackages(directory)`, after successful npm installation and before the bundle transaction hashes dependencies. In a flat runtime the import is identical. The injected `PackageInstaller` seam represents complete package preparation for offline synthetic fixtures; it is not a production version-skip or fallback. Complete override maintainers must prepare their private SDK with this same guarded helper before regenerating their reviewed manifest. The helper reads its specification via `import.meta.url`, so the adjacent JSON is inventoried and shipped.

The function takes a canonical, newly installed, unpublished private runtime directory, containing its lockfile and `node_modules`. It returns `{ state: 'original' | 'patched', changed: string[] }`. `state` describes the input. A successful original application currently lists thirteen changed files; a complete repetition returns `patched` and an empty list.

The caller must own the staging directory exclusively. Never pass a project, an existing bundle, or shared/global `node_modules`. The helper refuses any runtime already containing `runtime-manifest.json`, even for repeat application. It also rejects package path symlinks, file symlinks, hardlinked files, special files, wrong package metadata, unsupported lock versions/integrity, missing/extra files, unexpected hashes and mixed original/patched states. It validates the entire package and calculates all postimages before the first write. It then writes only changed files and reads all output bytes back. A write failure or interruption makes the staging directory unusable. Discard it through the existing runtime preparation `finally` cleanup; do not retry a partially patched directory or publish it.

Safe repetition means every changed file matches its exact postimage and every other package file still matches its original hash. It does not mean accepting an arbitrary package that happens to contain `.factory`. The pure `planSandcastlePatch(spec, lock, files)` function exposes the same validation and deterministic byte plan for cheap fixture tests. Normal preparation must use the pinned `prepareSandcastlePackage` wrapper, not inject a different specification.

`RUNTIME_ASSETS` includes both patch inputs. Editing either changes source identity and creates a new content-addressed runtime path. Dependency hashing includes the altered package bytes because the hash walks every private dependency file. Validation and reuse never reapply or repair a bundle. Keep `npm ci --include=dev --include=optional --ignore-scripts`; patching is an explicit preparation step, not an npm lifecycle script. Do not add a permissive catch or version-skip branch.

## Offline verification

The regular suite uses small owned synthetic byte fixtures, not a copy of the SDK. They prove lock/version/preimage/postimage guards, complete repetition, partial-state refusal, unchanged bytes and one real temporary package-filesystem boundary. Runtime-bundle tests prove both patch inputs affect source identity, enforce npm-before-patch ordering and propagate patch refusal through the existing publication rollback boundary. Fixture installers use synthetic SDK behavior. The offline real-package smoke exercises the activated production installer with only its npm command redirected to an isolated offline cache.

```sh
node --test cli/test/sandcastle-patch.test.mts cli/test/runtime-bundle.test.mts
bash scripts/test-shard.sh 1 4
bash scripts/test-shard.sh 2 4
bash scripts/test-shard.sh 3 4
bash scripts/test-shard.sh 4 4
timeout --signal=KILL 30s node --test --test-reporter=tap --test-timeout=15000 orchestrator/browser-provisioning.test.mts
```

The shard deadlines and separate browser-lifecycle gate are unchanged; see [TESTING.md](../TESTING.md#supported-layout-acceptance) for supported-layout preservation and the distinction between synthetic acceptance and actual-package evidence. The browser-lifecycle gate uses fixture processes, not the Docker image smoke.

The exact-package check is separate and opt-in:

```sh
node scripts/test-runtime-packages.mts /absolute/operator-supplied/npm-cache /absolute/path/to/npm/bin/npm-cli.js
```

Do not populate that cache as part of this check. The script requires existing cache content for the lockfile, copies only applicable locked tarball content into a temporary cache, and uses a temporary HOME plus empty npm user/global configuration. It invokes the explicitly supplied npm CLI with `--offline --include=dev --include=optional --ignore-scripts`. Missing tarballs or npm CLI are unavailable prerequisites, not permission to fetch, log in, read credentials or enable install scripts. Report the missing prerequisite and block activation.

The smoke applies the patch inside the temporary install callback, before bundle hashing. It checks full repeat application and validates the published dependency snapshot. `scripts/smoke-sandcastle-patch.mts` copies the private dependencies into a separate disposable probe and appends export accessors for otherwise private upstream functions there only. No tracked fixture contains the upstream implementation; no probe edits touch the published package. Local Git fixtures exercise creation, reuse, managed recognition, orphan pruning and removal. Real upstream functions read a sentinel env file, generate/write the default log, and create/clean patch directories and format recovery guidance. An explicit logging path remains unchanged. The real CLI invokes fake `docker` and `podman` executables that record build argv. Default contexts must be `.factory`, where inert Dockerfile/Containerfile fixtures live; explicit file options must retain the upstream current-directory context. Full argv assertions also preserve Docker's UID/GID arguments. There is no Docker daemon, image build, agent, tracker, registry or service-manager call. SDK probes execute in a sanitized child environment. The Git fixture has no remote and disables hooks; dirty managed-worktree reuse avoids even an origin refresh attempt.

This is a bounded directory-consumer smoke, not a sandbox lifecycle replacement or a claim that an agent/container ran. Unit guards and whole-package hashes cover deterministic byte drift. The exact-package smoke covers the actual upstream behavior those byte edits change. Production activation remains blocked unless both pass for the candidate pin.

## Updating the SDK

1. In a development checkout, inspect the proposed upstream release and its package metadata/license. Obtain package bytes through the operator's approved process, outside ordinary tests. Never use a live installed/shared package as the mutation target. Preserve the original package and verify its tarball SHA-512 against the proposed lockfile integrity.
2. Inspect all upstream executable chunks, entrypoints, declarations and templates. Trace the functions in the coverage table, then search for additional project-directory consumers. Check managed-worktree recognition and Git safety, not just path creation. Separate project paths from package names, global state and container-internal names. If narrow path edits no longer work, stop for a design decision rather than replacing SDK lifecycle code.
3. Update `package.json`/`package-lock.json` through the approved dependency-update process. Review the resolved exact version/integrity and any transitive changes. Do not just relax the specification's version check. An SDK lock update without matching reviewed specification changes must fail closed once preparation is activated.
4. Build a new specification from the verified original package. Sort all regular file paths lexically. Record each original SHA-256. For each reviewed edit, record its UTF-8 byte offset, exact before text and replacement; keep offsets ascending and non-overlapping. Assemble the postimage from original byte slices plus those replacements, then record its SHA-256. For unchanged files, keep equal hashes and empty edits. Include new/removed package files in the inventory; do not blindly reuse old chunk names. Preserve licensing and provenance. Update `schema`, pin and integrity only as required by the reviewed format/pin.
5. Run the pure planner against the original bytes. Compare the output byte-for-byte with independently reviewed scratch edits, then run it again against those postimages. Review the spec diff and update the coverage/removal table and exact counts in this guide. Byte offsets and hashes make application deterministic, but do not replace review of the semantic edit locations.
6. Run the focused tests, full commit-tier suite and exact-package smoke above using an existing operator-supplied offline cache. Update smoke accessors when upstream functions/chunk names change, and retain tests of each directory consumer. Missing smoke prerequisites block activation/publication. Do not weaken checks to get an update through.
7. Commit lockfile, specification, helper changes if needed, tests and this guide together. Through the separate authorized release process, prepare a fresh private bundle, apply before dependency hashing and validate its final manifest. The new source identity must differ. Never mutate an existing content-addressed bundle or operator artifact as an update shortcut.

## Rollback and removal

Rollback selects a prior intact, validated source/dependency bundle through the normal release mechanism. Do not reverse-patch a live bundle or edit its manifest. An old bundle whose layout is `.sandcastle` is not a safe fallback for a `.factory` project; Factory's admission/ownership rules must still refuse incompatible layouts. This patch provides no migration or recovery-artifact conversion.

An upstream contribution can propose a project-directory option consistently threaded through the consumers in the coverage table. Remove each owned edit only after the upstream replacement passes its listed behavior checks. When upstream covers all consumers and preserves Factory's safety contracts, pin that reviewed release, remove the patch call/helper/spec and their inventory entries in the same change, and rerun focused/full/offline evidence before publishing a new bundle. Do not silently skip the patch on an unknown release or keep a no-op compatibility shim that hides missing coverage.
