#!/usr/bin/env bash
# Readiness probes only the exact owned local image, then pins startup; no implementation starts on a readiness hold.
# Validate explicit project/runtime context before credentials or Docker. Only bundled dependencies execute.
# One dispatcher pass with the defaults, against the branch checked out in the current directory.
#   <selected-runtime>/dispatch.sh [--dry-run] [--max N] [--whole-issues]
#   <selected-runtime>/dispatch.sh --issue N [--no-push]
# Extra arguments go to dispatch.mts. With --issue N it runs that one ticket now instead, in the
# foreground (main.mts --issue N, extra arguments to main.mts), after the same checks; the output also
# goes to .sandcastle/logs/run-N.log, where a dispatched run's log goes. `factory run N` uses this.
# Checks tools, logins and .sandcastle/.env from validated v2 tracker and agent-family data.
# Both families run Pi. Anthropic also checks Claude's login, the subscription extension and
# policy models (preflight.mts), plus the container's CLAUDE_CODE_OAUTH_TOKEN. Then checks the image: from a
# terminal a missing or mismatched image is built; without one (the timer) the pass stops and says
# how to build it, so a background pass never starts a long build.
set -euo pipefail
# Same run-state folder as the timer and the board service, so hand-started passes show on the board.
export SANDCASTLE_STATE_DIR="${SANDCASTLE_STATE_DIR:-$HOME/.local/state/factory}"

fail() { echo "dispatch.sh: $*" >&2; exit 1; }

# --issue N picks one ticket. Parsed before the checks so a bad argument fails at once.
original_args=("$@")
issue=""
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --issue) [ $# -ge 2 ] || fail "--issue needs a ticket number."; issue="$2"; shift 2 ;;
    --issue=*) issue="${1#--issue=}"; shift ;;
    *) args+=("$1"); shift ;;
  esac
done
if [ -n "$issue" ]; then
  [[ "$issue" =~ ^[1-9][0-9]*$ ]] || fail "--issue needs a ticket number, got \"$issue\"."
  for a in ${args[@]+"${args[@]}"}; do
    case "$a" in --dry-run | --max | --max=*) fail "$a is for a dispatcher pass, not --issue." ;; esac
  done
fi

root="${FACTORY_PROJECT_ROOT:-}"
runtime="${FACTORY_RUNTIME_ROOT:-}"
[ -n "$root" ] && [ -n "$runtime" ] || fail "missing execution context. Use Factory commands."
[ "$(pwd -P)" = "$root" ] || fail "cwd must be the canonical project root. Use Factory commands."
[ "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)" = "$runtime" ] || fail "script is not from the selected runtime."
node "$runtime/config-read.mts" "$root/.sandcastle" validate || exit 1
if [ "${FACTORY_CONTEXT_BOOTSTRAPPED:-}" != 1 ]; then
  exec node "$runtime/context-process.mts" ${original_args[@]+"${original_args[@]}"}
fi

base="$(git branch --show-current)"
[ -n "$base" ] || fail "detached HEAD. Check out the integration branch first."
git ls-remote --exit-code --heads origin "$base" >/dev/null || fail "branch $base isn't on origin. Push it, or check out the integration branch."

# Read validated, allowlisted data only.
toml_value() { node "$runtime/config-read.mts" "$root/.sandcastle" "$1"; }
kind="$(toml_value kind)"
agent="$(toml_value agent)"
image="$(toml_value image)"
host="$(toml_value host)"
uses_subscription="$(toml_value subscription)"
[ -n "$image" ] || fail "couldn't read sandbox.image from .sandcastle/factory.toml."
case "$kind" in gitlab) tracker_cli=glab ;; github) tracker_cli=gh ;; *) fail "unknown tracker.kind in .sandcastle/factory.toml." ;; esac
[ "$agent" = pi ] || fail "standard workflow requires Pi."
tsx="$(toml_value tsx)"
sandcastle="$(toml_value sandcastle)"

for tool in node git "$tracker_cli" "$agent" docker curl; do
  command -v "$tool" >/dev/null || fail "$tool isn't on the PATH."
done

if [ "$kind" = gitlab ]; then
  [ -n "$host" ] || fail "couldn't read tracker.host from .sandcastle/factory.toml."
  glab auth status --hostname "$host" >/dev/null 2>&1 || fail "glab isn't logged in to $host. Run: glab auth login --hostname $host"
else
  gh auth status --hostname "$host" >/dev/null 2>&1 || fail "gh isn't logged in to $host. Run: gh auth login --hostname $host"
fi
# The ticket analysis runs this agent on the host with its own login. With pi and the pi-claude-subscription
# provider that login is claude's, and the container runs use CLAUDE_CODE_OAUTH_TOKEN (checked below).
subscription=0
if [ "$uses_subscription" = true ]; then
  subscription=1
  node "$runtime/preflight.mts" >&2 || exit 1
else
  # The OpenAI family passes a per-run token from the host's Pi login to the container.
  pi auth check --provider openai >/dev/null 2>&1 || fail "pi has no working OpenAI login. Run pi, then /login, and pick Sign in with ChatGPT."
fi
docker info >/dev/null 2>&1 || fail "Docker isn't running, or this user can't reach it."

# The CLI behind pi-claude-subscription uses the project's .env, not the host login.
# An empty Messages request checks the credential: bad gets 401, good gets 400.
# No tokens are used, and the secret is never printed or placed on a command line.
# OpenAI needs no container credential here; each run receives a token from the host login.
env_file=.sandcastle/.env
[ -f "$env_file" ] || fail "no $env_file. Run: cp .sandcastle/.env.example $env_file, then fill it in."
if [ "$subscription" = 1 ]; then
  env_value() { sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$1=[\"']?([^\"'#[:space:]]*).*/\2/p" "$env_file" | tail -n 1; }
  if token="$(env_value CLAUDE_CODE_OAUTH_TOKEN)" && [ -n "$token" ]; then
    key_name=CLAUDE_CODE_OAUTH_TOKEN
    auth_header="Authorization: Bearer $token"
  else
    fail "CLAUDE_CODE_OAUTH_TOKEN in $env_file is empty. Run: claude setup-token, and paste the token there."
  fi
  status="$(printf '%s\n' "$auth_header" | curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H @- \
    -H 'anthropic-version: 2023-06-01' -H 'anthropic-beta: oauth-2025-04-20' -H 'content-type: application/json' \
    -d '{}' https://api.anthropic.com/v1/messages)" || fail "couldn't reach api.anthropic.com to check $key_name."
  unset token auth_header
  case "$status" in
    401 | 403) fail "$key_name in $env_file was rejected. For a new token run: claude setup-token" ;;
    400 | 200) ;;
    *) fail "checking $key_name got HTTP $status from api.anthropic.com. Try again shortly." ;;
  esac
fi

# Sandcastle runs the container as this user, and refuses an image built for another UID.
problem=""
if ! user="$(docker image inspect "$image" --format '{{.Config.User}}' 2>/dev/null)"; then
  problem="image $image doesn't exist"
elif [ -n "$user" ] && [ "${user%%:*}" != "$(id -u)" ]; then
  problem="image $image was built for UID ${user%%:*}, not $(id -u)"
fi
if [ -n "$problem" ]; then
  build="node '$sandcastle' docker build-image --image-name '$image'"
  [ -t 0 ] || fail "$problem. Build it from a terminal in $root: $build"
  echo "$problem; building it (takes a few minutes)."
  node "$sandcastle" docker build-image --image-name "$image"
fi

# No agent installation or dispatch starts until the isolated image capability probe succeeds.
ready_image="$(node "$runtime/capabilities.mts" "$image" "$(id -u)" "$(id -g)" "$SANDCASTLE_STATE_DIR")" || fail "image readiness failed; provision/rebuild the configured image before retrying."
export FACTORY_READY_IMAGE="$ready_image"

if [ -n "$issue" ]; then
  mkdir -p .sandcastle/logs
  log=".sandcastle/logs/run-$issue.log"
  echo "Running #$issue on $base in the foreground; the output also goes to $log."
  set +e
  node "$tsx" --tsconfig "$runtime/runtime.tsconfig.json" "$runtime/main.mts" --base "$base" --issue "$issue" ${args[@]+"${args[@]}"} 2>&1 | tee -a "$log"
  exit "${PIPESTATUS[0]}"
fi
exec node "$runtime/dispatch.mts" --base "$base" ${args[@]+"${args[@]}"}
