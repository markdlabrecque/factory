#!/usr/bin/env bash
# Stand-in for `ddev` inside the Sandcastle sandbox, where there is no DDEV. Project scripts and tests
# that shell out to `ddev drush ...`, `ddev wp ...`, `ddev composer ...` or `ddev exec ...` run the same
# command directly against the sandbox's own site. Installed as /usr/local/bin/ddev; never used on the host.
set -euo pipefail
ROOT="${SANDCASTLE_WORKSPACE:-/home/agent/workspace}"
URI="${BASE_URL:-http://127.0.0.1}"
cmd="${1:-}"
[ $# -gt 0 ] && shift
cd "$ROOT"
case "$cmd" in
  drush) exec vendor/bin/drush --uri="$URI" "$@" ;;
  wp) exec wp --url="$URI" "$@" ;;
  composer) exec composer "$@" ;;
  exec) exec "$@" ;;
  *)
    echo "ddev (Sandcastle shim): '$cmd' is not available in the sandbox; only drush, wp, composer and exec are." >&2
    exit 1
    ;;
esac
