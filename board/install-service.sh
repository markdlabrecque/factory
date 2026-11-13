#!/usr/bin/env bash
# Install (or update) the Sandcastle board as a systemd user service on Linux.
# Copy the complete standalone board, including admission/assessment/journal imports and the manual-refresh worker.
#   ./install-service.sh            install + start
#   ./install-service.sh --uninstall
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/.local/share/sandcastle-board"
UNIT="$HOME/.config/systemd/user/sandcastle-board.service"

if [ "${1:-}" = "--uninstall" ]; then
  systemctl --user disable --now sandcastle-board.service || true
  rm -f "$UNIT"; systemctl --user daemon-reload
  echo "removed (state in ~/.local/state/sandcastle and code in $APP left in place)"; exit 0
fi

NODE="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
mkdir -p "$APP" "$(dirname "$UNIT")" "$HOME/.local/state/sandcastle"
cp "$HERE/board.mts" "$HERE/admission.mts" "$HERE/assessment.mts" "$HERE/journal.mts" "$HERE/tickets.mts" "$HERE/refresh-worker.mts" \
  "$HERE/board-server.mts" "$HERE/board.template.html" "$APP/"
sed "s#__NODE__#$NODE#" "$HERE/sandcastle-board.service" > "$UNIT"
systemctl --user daemon-reload
systemctl --user enable --now sandcastle-board.service
systemctl --user restart sandcastle-board.service
echo "Board: http://127.0.0.1:4444"
echo "Keep it up when logged out: loginctl enable-linger $USER"
echo "Point runs at the same state: export SANDCASTLE_STATE_DIR=\$HOME/.local/state/sandcastle"
