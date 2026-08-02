#!/usr/bin/env bash
# Snapshot the almanac SQLite DB to ./data/backups/, keep the last N.
# Uses `sqlite3 .backup` so it's safe to run while the API is live.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DB_PATH="${ALMANAC_DB_PATH:-$ROOT/data/almanac.sqlite}"
BACKUP_DIR="$ROOT/data/backups"
KEEP="${ALMANAC_BACKUP_KEEP:-30}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "error: db not found at $DB_PATH" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "error: sqlite3 CLI not installed" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/almanac-$STAMP.sqlite"

# Online backup: safe while API holds the DB open. Forces a WAL checkpoint
# into the snapshot so the output is a single self-contained file.
sqlite3 "$DB_PATH" ".backup '$OUT'"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "backup: $OUT ($SIZE)"

# Prune: keep newest $KEEP, delete the rest.
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/almanac-*.sqlite 2>/dev/null | tail -n +$((KEEP + 1)))
if (( ${#OLD[@]} > 0 )); then
  for f in "${OLD[@]}"; do
    rm -- "$f"
    echo "pruned: $f"
  done
fi

REMAINING="$(ls -1 "$BACKUP_DIR"/almanac-*.sqlite 2>/dev/null | wc -l)"
echo "kept: $REMAINING backup(s) in $BACKUP_DIR"
