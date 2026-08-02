#!/usr/bin/env bash
# demo.sh — seed a THROWAWAY db with a full demo dataset and launch the UI on it.
#
# Everything every dashboard panel needs, anchored relative to today: an active
# cut phase, 40 days of meals/weigh-ins/sleep/steps, a PPL split with templates
# and history, stored meals, cardio, an untracked period, and earned wins.
# The AI surfaces (meal chat + insights coach) are unlocked.
#
# This NEVER touches the real dev db or the default ports — it forces a temp
# sqlite file and :3099/:5199 so it can run alongside your live instance.
#
# Usage:
#   scripts/local-dev/demo.sh                      # 127.0.0.1 only
#   scripts/local-dev/demo.sh --lan                # bind 0.0.0.0 (phone testing)
#   scripts/local-dev/demo.sh --days 90            # longer history
#   scripts/local-dev/demo.sh --keep               # reuse an existing demo db
#
# LLM chat needs a key. This script sources .env if present (dev-noauth.sh does
# NOT), or you can export ANTHROPIC_API_KEY yourself. Without it the UI still
# renders but the chat panels report llm_available:false.
#
# Teardown: Ctrl-C (the trap stops both services), then the temp db is left at
# $DEMO_DB for inspection — delete it with: rm -f /tmp/almanac-demo.sqlite*
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# --- Args ---------------------------------------------------------------------
WEB_HOST="127.0.0.1"
DAYS=40
KEEP=0
EMAIL="${ALMANAC_DEV_EMAIL:-demo@example.com}"
while [ $# -gt 0 ]; do
  case "$1" in
    --lan) WEB_HOST="0.0.0.0"; shift ;;
    --days) DAYS="${2:?--days needs a value}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --email) EMAIL="${2:?--email needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# --- Fixed throwaway config (deliberately NOT overridable) --------------------
# Hardcoded so this script can never be pointed at the real db/ports by accident.
DEMO_DB="/tmp/almanac-demo.sqlite"
API_PORT=3099
WEB_PORT=5199

# --- LLM key: source .env if it's there, so the AI panels actually work -------
if [ -f "$REPO_ROOT/.env" ]; then
  echo "==> sourcing .env for LLM credentials"
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "    WARNING: no ANTHROPIC_API_KEY — chat panels will show llm_available:false." >&2
  echo "             export it (or put it in .env) to exercise the AI surfaces." >&2
fi

# --- Seed ---------------------------------------------------------------------
if [ "$KEEP" -eq 1 ] && [ -f "$DEMO_DB" ]; then
  echo "==> reusing existing demo db at $DEMO_DB (--keep)"
else
  echo "==> seeding a fresh demo db at $DEMO_DB (${DAYS} days, as $EMAIL)"
  rm -f "$DEMO_DB" "$DEMO_DB-wal" "$DEMO_DB-shm"
  ALMANAC_DB_PATH="$DEMO_DB" \
    pnpm --filter @almanac/core seed-demo --days "$DAYS" --email "$EMAIL"
fi

PIDFILE=/tmp/almanac-demo-pids
> "$PIDFILE"
cleanup() {
  echo ""
  echo "==> stopping demo services"
  while read -r line; do kill "${line##*:}" 2>/dev/null || true; done < "$PIDFILE"
  rm -f "$PIDFILE"
  echo "    demo db left at $DEMO_DB (rm -f ${DEMO_DB}* to delete)"
}
trap cleanup EXIT INT TERM

# --- API ----------------------------------------------------------------------
echo "==> starting almanac-api on http://127.0.0.1:${API_PORT}"
ALMANAC_DB_PATH="$DEMO_DB" \
ALMANAC_API_HOST="127.0.0.1" \
ALMANAC_API_PORT="$API_PORT" \
ALMANAC_TRUST_PROXY_HEADERS=true \
ALMANAC_ALLOWED_EMAILS="$EMAIL" \
  pnpm --filter @almanac/api dev &
echo "api:$!" >> "$PIDFILE"

# --- Web ----------------------------------------------------------------------
echo "==> starting almanac-web on http://${WEB_HOST}:${WEB_PORT}  (auth as: $EMAIL)"
if [ "$WEB_HOST" = "0.0.0.0" ]; then
  echo "    LAN bind: anyone on this network is authenticated as $EMAIL — trusted networks only."
fi
ALMANAC_DEV_EMAIL="$EMAIL" \
ALMANAC_API_URL="http://127.0.0.1:${API_PORT}" \
  pnpm --filter @almanac/web exec vite --host "$WEB_HOST" --port "$WEB_PORT" --strictPort &
echo "web:$!" >> "$PIDFILE"

echo ""
echo "==> demo UI: http://localhost:${WEB_PORT}"
if [ "$WEB_HOST" = "0.0.0.0" ]; then
  LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
  [ -n "$LAN_IP" ] && echo "    on your phone: http://${LAN_IP}:${WEB_PORT}"
fi
echo "    Ctrl-C to stop."
wait
