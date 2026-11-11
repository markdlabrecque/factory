#!/usr/bin/env bash
# Schedule dispatcher passes for one project on Linux (systemd user units). One timer per project;
# all of them share the run cap and board through ~/.local/state/factory.
#   install-dispatch.sh [<repo>] [--name <name>]   install or update; <repo> defaults to the current
#                                                  repo, <name> to the repo folder's name
#   install-dispatch.sh --uninstall <name>
# The timer uses whatever branch is checked out in <repo> as the base.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
UNITS="$HOME/.config/systemd/user"
CONF="$HOME/.config/sandcastle/dispatch"
fail() { echo "install-dispatch.sh: $*" >&2; exit 1; }

repo="" name="" uninstall=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="${2:-}"; shift 2 ;;
    --uninstall) uninstall=1; name="${2:-}"; shift $(( $# > 1 ? 2 : 1 )) ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) repo="$1"; shift ;;
  esac
done

if [ -n "$uninstall" ]; then
  [ -n "$name" ] || fail "--uninstall needs the project's name (ls $CONF)."
  systemctl --user disable --now "sandcastle-dispatch@$name.timer" || true
  rm -f "$CONF/$name.env"
  echo "Removed the $name timer. The shared unit files stay for other projects."
  exit 0
fi

command -v systemctl >/dev/null || fail "systemctl not found; this installer is for Linux with systemd."
repo="$(cd "${repo:-.}" && git rev-parse --show-toplevel)" || fail "${repo:-.} isn't inside a git repository."
[ -x "$repo/.sandcastle/dispatch.sh" ] || fail "$repo/.sandcastle/dispatch.sh is missing or not executable."
branch="$(git -C "$repo" branch --show-current)"
[ -n "$branch" ] || fail "$repo is on a detached HEAD; check out the integration branch first."
name="${name:-$(basename "$repo")}"
case "$name" in *[!A-Za-z0-9._-]*|"") fail "name \"$name\" may only use letters, digits, . _ and -; pass --name." ;; esac
if [ -f "$CONF/$name.env" ] && ! grep -qxF "SANDCASTLE_REPO=\"$repo\"" "$CONF/$name.env"; then
  fail "\"$name\" is already used by another repo ($(sed -n 's/^SANDCASTLE_REPO=//p' "$CONF/$name.env")); pass --name."
fi

# The units run without your shell profile, so record where the tools live now.
dirs=()
for tool in node glab claude docker git; do
  bin="$(command -v "$tool")" || fail "$tool isn't on the PATH."
  dirs+=("$(dirname "$bin")")
done
path=""
for dir in "${dirs[@]}" /usr/local/bin /usr/bin /bin; do
  case ":$path:" in *":$dir:"*) ;; *) path="${path:+$path:}$dir" ;; esac
done

mkdir -p "$UNITS" "$CONF" "$HOME/.local/state/factory"
printf 'SANDCASTLE_REPO="%s"\nPATH="%s"\n' "$repo" "$path" > "$CONF/$name.env"
cp "$HERE/sandcastle-dispatch@.service" "$HERE/sandcastle-dispatch@.timer" "$UNITS/"
systemctl --user daemon-reload
systemctl --user enable --now "sandcastle-dispatch@$name.timer"

echo "Scheduled $name: $repo, base $branch (the branch checked out there)."
if [ -f "$UNITS/sandcastle-dispatch.timer" ]; then
  echo "An old single-project timer is installed too. Remove it so passes don't double up:"
  echo "  systemctl --user disable --now sandcastle-dispatch.timer && rm $UNITS/sandcastle-dispatch.{service,timer}"
fi
echo "The timer won't build the image. If you haven't yet, run once from a terminal: (cd $repo && .sandcastle/dispatch.sh --dry-run)"
echo "Status: systemctl --user list-timers 'sandcastle-dispatch@*'    Logs: journalctl --user -u sandcastle-dispatch@$name"
echo "Keep timers running when logged out: loginctl enable-linger $USER"
