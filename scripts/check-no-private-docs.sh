#!/bin/sh
# Fails if any git-tracked file references the local `docs/` directory (private documentation).
# External URLs such as https://nextjs.org/docs/... and the `/docs` Swagger route are allowed.
cd "$(git rev-parse --show-toplevel)" || exit 2
hits=$(git grep -nE '(^|[^A-Za-z0-9_./-])docs/' -- . ':!.gitignore' ':!scripts/check-no-private-docs.sh' ':!scripts/check-no-private-docs.test.mjs' 2>/dev/null)
if [ -n "$hits" ]; then
  echo "Tracked files must not reference the private docs/ directory:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "ok: no tracked file references docs/"
