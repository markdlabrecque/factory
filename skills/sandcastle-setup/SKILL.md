---
name: sandcastle-setup
description: Set up a project's Sandcastle scaffold from composable layers - GitLab issue tracker via `glab`, a single-container web runtime (Apache, PHP-FPM, MariaDB, Composer), Drupal (Drush) or WordPress (WP-CLI), and Playwright for self-checking. Use when setting up Sandcastle with GitLab or for a Drupal/WordPress project, or when `.sandcastle/` still holds the Custom tracker sentinels.
---

# Sandcastle setup (layers)

Sandcastle has no built-in GitLab tracker (maintainer points to `Custom`; upstream #511, #521). Instead of improvising from `SETUP_ISSUE_TRACKER.md`, apply fixed layers from `layers/`. The scaffold is copied into the project, so no fork of Sandcastle is needed.

## Detect (defaults; confirm with the user, don't ask from scratch)
Inspect the project root first and propose these as the answers:
- **Drupal:** `composer.json` requires `drupal/core`, `drupal/core-recommended` or `drupal/cms`, or `web/core/` / `docroot/core/` exists. Docroot is the dir holding `core/` (usually `web/`). Layers: web + Drupal + Playwright.
- **WordPress:** `wp-config.php`, `wp-content/` or `wp-includes/` at the root or in `web/`/`public/`/`wp/`, or `composer.json` requires `johnpbloch/wordpress*` or `roots/wordpress*`. Docroot is the dir holding `wp-config.php` (or `wp-load.php`). Layers: web + WordPress + Playwright.
- **PHP_VERSION:** `.ddev/config.yaml` `php_version`, else `composer.json` `config.platform.php`, else the minor from `require.php`, else 8.3. Use the minor only (`8.3`).
- **Both or neither matched:** ask. Not a PHP/web project: offer tracker layer only.
- **Tracker:** the GitLab layer is the default when `git remote get-url origin` points at a GitLab host (e.g. git.affinitybridge.com); use that host as `GITLAB_HOST`.
Report what was detected and why (which file matched) in one line, then confirm.

**Database:** MariaDB for both Drupal and WordPress (decided 2026-11-05). SQLite deferred: Drupal supports it natively, WordPress needs the SQLite Database Integration plugin, and prod dumps are MySQL-shaped.

## Layers (ask which apply)
| Layer | Dir | Needs |
| --- | --- | --- |
| Tracker: GitLab | `layers/tracker-gitlab/` | `GITLAB_HOST` (default git.affinitybridge.com), `LABEL` (default `Sandcastle`), `GLAB_VERSION` |
| Runtime: web | `layers/runtime-web/` | `PHP_VERSION`; Docker only (services need root); docroot from Detect |
| CMS: Drupal | `layers/cms-drupal/` | web runtime |
| CMS: WordPress | `layers/cms-wordpress/` | web runtime |
| Browser: Playwright | `layers/browser-playwright/` | `PLAYWRIGHT_VERSION` (npm); works without the web layer too |

Substitute `{{VARS}}` in snippets with the chosen values. Pin versions; look up current ones.

## Status
- Verified (2026-11-05): web + Drush launcher + Playwright layers build on `node:22-bookworm`; running as root, `start-web.sh` serves PHP 8.3 with a working MariaDB connection and headless Chromium loads the page.
- **Not verified:** the GitLab layer (`glab` flags, install URL); starting services via a Sandcastle sandbox hook (`sudo: true`) with the non-root `agent` user; Drush against a real Drupal project; the WP-CLI layer.

## Steps
1. Run **Detect** above and confirm the layers and values. Check the branch is clean. If `.sandcastle/` doesn't exist, `npx sandcastle init` with tracker **Custom** and the **Docker** provider (always Docker, not Podman).
2. **Fail loudly if the scaffold moved.** Grep `.sandcastle/` for `No issue tracker configured`, `<view command`, `<close command`, `TODO: install your issue tracker`. If any is missing, stop and say which.
3. Tracker layer: substitute list/view/close from `tracker-gitlab/commands.md` for the markers; put `.env` lines from `env.snippet` into `.sandcastle/.env` and `.env.example`; **leave `GITLAB_TOKEN` empty, tell the user to fill it** (never fetch it from 1Password).
4. Image layers: replace the Dockerfile's `# TODO: install your issue tracker's CLI` line with the chosen `*.Dockerfile.snippet` files, in order: glab, web, CMS, Playwright. Copy `runtime-web/start-web.sh` into `.sandcastle/` (the web snippet COPYs it; it must be in the build context).
5. Web layer: add a sandbox hook in `main.ts`, e.g. `hooks: { sandbox: { onSandboxReady: [{ command: "start-web.sh <detected docroot>", sudo: true }] } }`. Project code reaches Playwright's global install via `NODE_PATH=$(npm root -g)` (ESM ignores it; use CJS or install `playwright` in the project).
6. Verify: `glab auth status --hostname <host>`; build the image (`npx sandcastle docker build-image`); a `maxIterations: 1` run on a throwaway ticket where the agent starts the web layer, loads the page with Playwright, and closes the ticket.
7. Prompt conventions: state the label; commit messages start with the ticket ref (`#425: ...`); `glab mr create` titles start `#<iid>: `; tell the agent to check its work with the web server and Playwright before committing.

## Reuse
Commit the edited `.sandcastle/`. Next project: rerun this skill, changing only host, label and CMS.
