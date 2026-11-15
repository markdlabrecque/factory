#!/usr/bin/env bash
# Partition the complete regular-test inventory by sorted file index; list or run one bounded shard.
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=C

if [[ $# -lt 2 || $# -gt 3 || ! $1 =~ ^[1-9][0-9]*$ || ! $2 =~ ^[1-9][0-9]*$ ]]; then
  echo 'Usage: bash scripts/test-shard.sh INDEX COUNT [--list]' >&2
  exit 2
fi
index=$1
count=$2
if (( index > count )) || [[ ${3:-} != '' && ${3:-} != --list ]]; then
  echo 'Invalid shard or mode' >&2
  exit 2
fi

# These are the same three globs as the unsharded suite. Fail rather than omit an empty root.
files=()
for pattern in orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts; do
  [[ -f $pattern ]] || { echo "Missing test file: $pattern" >&2; exit 1; }
  files+=("$pattern")
done
mapfile -t files < <(printf '%s\n' "${files[@]}" | sort)
selected=()
for position in "${!files[@]}"; do
  if (( position % count == index - 1 )); then
    selected+=("${files[position]}")
  fi
done
(( ${#selected[@]} > 0 )) || { echo 'Empty shard' >&2; exit 1; }
if [[ ${3:-} == --list ]]; then
  printf '%s\n' "${selected[@]}"
  exit 0
fi
printf '# Shard %s/%s: %s of %s files\n' "$index" "$count" "${#selected[@]}" "${#files[@]}"
printf '# %s\n' "${selected[@]}"
exec timeout --signal=KILL 180s node --test --test-concurrency=4 --test-reporter=tap --test-timeout=120000 "${selected[@]}"
