#!/usr/bin/env bash
# deploy/update.sh — update a running Almanac deploy by pulling CI-built images.
#
# Images are built and published to GHCR by .github/workflows/release.yml on
# tag push. This script does NOT build — it pulls the tagged images and swaps
# containers. `docker compose pull` fetches while the old containers keep
# serving (no impact); the subsequent `up -d` recreates only the services
# whose image digest changed, dependency-ordered (compose waits on each
# service's healthcheck before bringing oauth2-proxy onto it).
#
# This is NOT zero-downtime: each recreated service has a brief gap (seconds)
# while its single container restarts. For a single-user / small-group personal
# tracker that's expected and fine.
#
# Usage (on the deploy server, from anywhere in the deploy tree — the script
# finds its own repo root):
#   ./deploy/update.sh
#
# Env overrides:
#   ALMANAC_TAG       image tag to pull (default: latest). Pin to roll back,
#                     e.g. ALMANAC_TAG=0.2.0 ./deploy/update.sh. NOTE: transient
#                     — the next bare run reverts to latest. Persist in .env to
#                     make a rollback stick.
#   ALMANAC_DB_PATH   path to the live SQLite (default: ./data/almanac.sqlite)
#   SKIP_BACKUP=1     don't snapshot the DB first (not recommended)
#   DRY_RUN=1         pull, then print the recreate plan via `up -d --dry-run`,
#                     change no running containers
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -t 1 ]; then
  G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[34m'; N=$'\033[0m'
else
  G=""; Y=""; B=""; N=""
fi
say() { echo "${B}==>${N} $*"; }

# Preflight: compose must be reachable and the stack should already exist.
if ! docker compose version >/dev/null 2>&1; then
  echo "error: 'docker compose' not available" >&2
  exit 1
fi

# 1. Snapshot the DB before anything that might run a migration. The online
#    backup is safe while the API holds the DB open.
if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  say "backing up the database"
  ./scripts/backup-db.sh
else
  say "${Y}skipping DB backup (SKIP_BACKUP=1)${N}"
fi

# 2. Pull the CI-built images. Running containers are untouched here — the old
#    stack keeps serving until the swap in the next step.
say "pulling images (tag ${ALMANAC_TAG:-latest}, running containers untouched)"
docker compose pull

# Dry-run short-circuit: show what WOULD be recreated, then stop.
if [ "${DRY_RUN:-0}" = "1" ]; then
  say "${Y}DRY_RUN=1 — printing recreate plan, no changes will be made${N}"
  docker compose up -d --dry-run
  exit 0
fi

# 3. Swap: recreate only the services whose image changed, dependency-ordered.
#    Compose waits on each service's healthcheck (the API's covers migrations
#    via start_period) before swinging oauth2-proxy onto it.
say "recreating changed services"
docker compose up -d

# 4. Show the result and tail the API log so a failing migration / unhealthy
#    boot is visible immediately. Ctrl-C to stop tailing — the stack stays up.
say "current container state:"
docker compose ps
echo
say "${G}deploy complete.${N} tailing almanac-api (Ctrl-C to detach; stack stays up):"
docker compose logs -f --tail=50 almanac-api
