#!/usr/bin/env bash
# dev-noauth.sh — local dev WITHOUT docker or Google OAuth.
#
# Runs the API + web (Vite) with header-trust auth: the Vite dev proxy injects
# the `x-forwarded-email` header that oauth2-proxy would emit in prod, and the
# API trusts it (ALMANAC_TRUST_PROXY_HEADERS=true). No oauth2-proxy container,
# no .env required — just an email to act as.
#
# For the full prod-like stack (real Google sign-in via oauth2-proxy in docker),
# use up.sh instead. For MCP, see the stdio snippet this script prints at the end.
#
# Usage:
#   scripts/local-dev/dev-noauth.sh you@example.com          # web on 127.0.0.1
#   scripts/local-dev/dev-noauth.sh you@example.com --lan     # web on 0.0.0.0 (LAN)
#   ALMANAC_DEV_EMAIL=you@example.com scripts/local-dev/dev-noauth.sh
#
# Env overrides (all optional): ALMANAC_DB_PATH, ALMANAC_API_PORT, WEB_PORT.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# --- Args ---------------------------------------------------------------------
DEV_EMAIL=""
WEB_HOST="127.0.0.1"
for arg in "$@"; do
  case "$arg" in
    --lan) WEB_HOST="0.0.0.0" ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) DEV_EMAIL="$arg" ;;
  esac
done
# Fall back to the env var if no positional email was given.
DEV_EMAIL="${DEV_EMAIL:-${ALMANAC_DEV_EMAIL:-}}"
if [ -z "$DEV_EMAIL" ]; then
  echo "ERROR: a dev email is required (it's the identity the Vite proxy injects)." >&2
  echo "  usage: $0 you@example.com [--lan]" >&2
  exit 2
fi

# --- Config (overridable) -----------------------------------------------------
# Shares up.sh's DB so both no-docker and prod-like dev see the same data.
export ALMANAC_DB_PATH="${ALMANAC_DB_PATH:-$REPO_ROOT/data/almanac.sqlite}"
export ALMANAC_API_HOST="127.0.0.1"   # API stays loopback; devices reach it via the Vite proxy.
export ALMANAC_API_PORT="${ALMANAC_API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-5173}"

mkdir -p "$(dirname "$ALMANAC_DB_PATH")"

PIDFILE=/tmp/almanac-dev-noauth-pids
> "$PIDFILE"
cleanup() {
  echo ""
  echo "==> stopping dev-noauth services"
  while read -r line; do kill "${line##*:}" 2>/dev/null || true; done < "$PIDFILE"
  rm -f "$PIDFILE"
}
trap cleanup EXIT INT TERM

# --- API: header-trust auth, fresh-or-shared DB, migrations auto-run on boot --
echo "==> starting almanac-api on http://127.0.0.1:${ALMANAC_API_PORT}  (db: $ALMANAC_DB_PATH)"
ALMANAC_TRUST_PROXY_HEADERS=true \
ALMANAC_ALLOWED_EMAILS="$DEV_EMAIL" \
  pnpm --filter @almanac/api dev &
echo "api:$!" >> "$PIDFILE"

# --- Web: Vite proxies /api → the API and injects x-forwarded-email -----------
echo "==> starting almanac-web on http://${WEB_HOST}:${WEB_PORT}  (auth as: $DEV_EMAIL)"
if [ "$WEB_HOST" = "0.0.0.0" ]; then
  echo "    LAN bind: anyone on this network is authenticated as $DEV_EMAIL — trusted networks only."
fi
ALMANAC_DEV_EMAIL="$DEV_EMAIL" \
ALMANAC_API_URL="http://127.0.0.1:${ALMANAC_API_PORT}" \
  pnpm --filter @almanac/web exec vite --host "$WEB_HOST" --port "$WEB_PORT" --strictPort &
echo "web:$!" >> "$PIDFILE"

# --- MCP helper ---------------------------------------------------------------
# MCP isn't started here — run it in a second terminal when you want it. http is
# the default transport and validates the PAT itself, so oauth2-proxy is not
# involved and the client config is the same shape as a deployed instance.
cat <<EOF

──────────────────────────────────────────────────────────────────────────────
Web UI:  http://${WEB_HOST}:${WEB_PORT}
API:     http://127.0.0.1:${ALMANAC_API_PORT}

MCP — mint a PAT in Settings, then in another terminal:
  ALMANAC_API_URL=http://127.0.0.1:${ALMANAC_API_PORT} \\
    pnpm --filter @almanac/mcp dev

  It listens on http://127.0.0.1:3030/mcp. Point your client there with
  "type": "http" and Authorization: Bearer <your-PAT>.

Claude Preview: it attaches to a running server (doesn't launch one). Leave this
running, then point Preview at the Web UI above — set .claude/launch.json's
\`url\` to match http://${WEB_HOST}:${WEB_PORT}.

Ctrl-C to stop API + web.
──────────────────────────────────────────────────────────────────────────────
EOF

wait
