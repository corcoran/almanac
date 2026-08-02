#!/usr/bin/env bash
#
# install-hooks.sh — copy the repo's tracked hooks into .git/hooks.
#
# Use this if you'd rather not set core.hooksPath (e.g. you already have
# local-only hooks in .git/hooks you want to keep). Otherwise the simpler
# one-liner is:
#   git config core.hooksPath .githooks
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

src=".githooks"
dst="$(git rev-parse --git-path hooks)"

for hook in "$src"/*; do
  [ -f "$hook" ] || continue
  name="$(basename "$hook")"
  cp "$hook" "$dst/$name"
  chmod +x "$dst/$name"
  echo "installed: $dst/$name"
done

echo "done. Hooks copied into $dst"
