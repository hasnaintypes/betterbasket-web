#!/bin/sh
# Decides whether CI must run the full task graph instead of only affected packages.
# Usage: changed-paths.sh <base-ref> <head-ref>
# Prints: RUN_ALL=true|false   (true when root/CI/config files changed or the diff cannot be computed)
base="$1"; head="${2:-HEAD}"

if [ -z "$base" ] || ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1 \
   || ! git rev-parse --verify --quiet "$head^{commit}" >/dev/null 2>&1; then
  echo "RUN_ALL=true"; exit 0   # unresolved base (shallow clone, force-push, new branch): be safe
fi

files=$(git diff --name-only --diff-filter=ACMRD "$base" "$head" 2>/dev/null) || { echo "RUN_ALL=true"; exit 0; }

if echo "$files" | grep -Eq '^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|\.nvmrc)$|^\.github/|^packages/config/'; then
  echo "RUN_ALL=true"
else
  echo "RUN_ALL=false"
fi
