#!/usr/bin/env bash
# Prepare the shared complete runtime and ship data-only workflow resolution for read-only Board refresh.
# #153: delivery checkpoint validation is a mandatory board import.
# #137: include offline TOML metadata/parser for standalone refresh lookup.
# Install (or update) the Sandcastle board as a launchd user agent on macOS.
# Copy the complete standalone board, including admission/assessment/journal imports and the manual-refresh worker.
#   ./install-launchd.sh            install + start
#   ./install-launchd.sh --uninstall
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/.local/share/sandcastle-board"
LABEL="com.sandcastle.board"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed (state in ~/.local/state/sandcastle and code in $APP left in place)"; exit 0
fi

NODE="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
mkdir -p "$APP" "$(dirname "$PLIST")" "$HOME/.local/state/sandcastle"
"$NODE" "$HERE/prepare-runtime.mts" "$HERE/.." "$HOME/.local/share/sandcastle-board-runtime"
cp "$HERE/execution-events.mts" "$HERE/delivery.mts" "$HERE/board.mts" "$HERE/admission.mts" "$HERE/assessment.mts" "$HERE/journal.mts" "$HERE/tickets.mts" "$HERE/refresh-worker.mts" \
  "$HERE/readiness.mts" "$HERE/readiness-view.mts" "$HERE/../orchestrator/readiness-schema.mts" \
  "$HERE/board-server.mts" "$HERE/board.template.html" "$APP/"
cp "$HERE/../orchestrator/project-config.mts" "$HERE/../orchestrator/model-policy.mts" "$HERE/../orchestrator/workflow.mts" "$APP/"
cp "$HERE/../cli/src/runtime-assets.mts" "$HERE/../cli/src/runtime-bundle.mts" "$APP/"
mkdir -p "$APP/vendor"
cp -R "$HERE/../orchestrator/vendor/smol-toml" "$APP/vendor/"
sed -e "s#__NODE__#$NODE#" -e "s#__HOME__#$HOME#g" "$HERE/$LABEL.plist" > "$PLIST"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Board: http://127.0.0.1:4444"
echo "Point runs at the same state: export SANDCASTLE_STATE_DIR=\$HOME/.local/state/sandcastle"
