#!/usr/bin/env bash
# The landing page ships byte-identical: docs/public/index.html is copied to the
# build output root verbatim by VitePress. If a generated page ever collides
# with it, this fails the build rather than silently replacing the hand-authored
# design.
set -euo pipefail

SRC="docs/public/index.html"
BUILT="docs/.vitepress/dist/index.html"

if [ ! -f "$BUILT" ]; then
  echo "FAIL: $BUILT does not exist. Did 'pnpm docs:build' run?" >&2
  exit 1
fi

if ! diff -q "$SRC" "$BUILT" >/dev/null; then
  echo "FAIL: built landing page differs from source." >&2
  diff "$SRC" "$BUILT" >&2 || true
  exit 1
fi

echo "OK: landing page is byte-identical to $SRC"
