#!/usr/bin/env bash
# deploy/sync-to-server.sh — stage the minimal operational file set into the
# directory that mirrors to the server.
#
# The server does NOT need the full repo. With CI building images and
# watchtower auto-pulling them (see deploy/README.md), the only files the box
# needs on disk are the *operational* ones:
#
#   docker-compose.yml            the stack definition
#   allowed-users.txt             the oauth2-proxy / API email allowlist
#   scripts/backup-db.sh          the DB snapshot script (cron + update.sh use it)
#   deploy/update.sh              manual pull/rollback lever
#   deploy/post-migration-smoke.sh  post-deploy smoke test
#   deploy/nginx-almanac.conf     host nginx vhost template
#
# This script copies those from the repo root into a target directory. That
# target is a Syncthing-mirrored folder (default ~/sites/almanac) — Syncthing
# pushes it to the server, so there's no scp here. Point it elsewhere with
# DEST_DIR if your sync source lives somewhere else.
#
# Usage:
#   ./deploy/sync-to-server.sh              # stage into ~/sites/almanac
#   DEST_DIR=~/other/path ./deploy/sync-to-server.sh
#   DRY_RUN=1 ./deploy/sync-to-server.sh    # print what would copy, change nothing
#
# .env is INTENTIONALLY NOT staged. The local .env is dev config; the server's
# .env holds prod secrets and is managed directly on the box. (Syncthing is
# receive-only on the server, so a local .env here would propagate and clobber
# the server's — hence we never put one in the synced folder at all.)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${DEST_DIR:-$HOME/sites/almanac}"
DRY_RUN="${DRY_RUN:-0}"

if [ -t 1 ]; then
  G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[34m'; N=$'\033[0m'
else
  G=""; Y=""; B=""; N=""
fi
say()  { echo "${B}==>${N} $*"; }
warn() { echo "${Y}warning:${N} $*" >&2; }

# Files always (re)copied, relative to the repo root. Destination keeps the
# same relative layout (so deploy/* lands under $DEST_DIR/deploy/).
FILES=(
  docker-compose.yml
  allowed-users.txt
  scripts/backup-db.sh
  deploy/update.sh
  deploy/post-migration-smoke.sh
  deploy/nginx-almanac.conf
)

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  would: $*"
  else
    "$@"
  fi
}

if [ "$DRY_RUN" = "1" ]; then
  say "staging into ${DEST_DIR} (DRY_RUN)"
  say "${Y}DRY_RUN=1 — no files will be written${N}"
else
  say "staging into ${DEST_DIR}"
fi

# Preflight: every source file must exist before we touch the destination.
missing=0
for f in "${FILES[@]}"; do
  [ -f "$ROOT/$f" ] || { warn "source missing: $f"; missing=1; }
done
if [ "$missing" = "1" ]; then
  echo "error: one or more source files are missing; aborting" >&2
  exit 1
fi

run mkdir -p "$DEST_DIR/deploy"

for f in "${FILES[@]}"; do
  say "copy $f"
  run cp "$ROOT/$f" "$DEST_DIR/$f"
done

# .env is never staged — see the header. It lives only on the server.
# data/ holds the live SQLite + backups on the server; never staged from here.
run mkdir -p "$DEST_DIR/data"

say "${G}done.${N} Syncthing will mirror ${DEST_DIR} to the server."
