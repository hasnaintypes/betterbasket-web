#!/bin/sh
# Fixture tests for changed-paths.sh (creates a throwaway repository).
set -eu
script="$(cd "$(dirname "$0")" && pwd)/changed-paths.sh"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cd "$tmp"; git init -q; git config user.email t@t; git config user.name t
mkdir -p apps/web docs packages/config .github/workflows
echo a > apps/web/a.ts; echo r > README.md; echo p > package.json; echo l > pnpm-lock.yaml
echo x > packages/config/x.js; echo w > .github/workflows/ci.yml; echo t > turbo.json
git add -A; git commit -qm base; base=$(git rev-parse HEAD)
fail=0
check() { # name expected  (current HEAD vs base)
  got=$(sh "$script" "$base" HEAD); if [ "$got" = "RUN_ALL=$2" ]; then echo "PASS $1"; else echo "FAIL $1: got $got want RUN_ALL=$2"; fail=1; fi; }
reset() { git reset -q --hard "$base"; }
echo "# docs only" >> README.md; git commit -qam c; check "docs-only change" false; reset
echo more >> apps/web/a.ts; git commit -qam c; check "source-only change" false; reset
echo more >> pnpm-lock.yaml; git commit -qam c; check "lockfile change" true; reset
echo more >> turbo.json; git commit -qam c; check "turbo.json change" true; reset
echo more >> .github/workflows/ci.yml; git commit -qam c; check "workflow change" true; reset
echo more >> packages/config/x.js; git commit -qam c; check "shared config change" true; reset
git mv apps/web/a.ts apps/web/b.ts; git commit -qm c; check "rename of a source file" false; reset
git rm -q package.json; git commit -qm c; check "deleted root manifest" true; reset
got=$(sh "$script" "" HEAD); [ "$got" = "RUN_ALL=true" ] && echo "PASS empty base" || { echo "FAIL empty base: $got"; fail=1; }
got=$(sh "$script" deadbeef HEAD); [ "$got" = "RUN_ALL=true" ] && echo "PASS unresolvable base" || { echo "FAIL unresolvable base: $got"; fail=1; }
exit $fail
