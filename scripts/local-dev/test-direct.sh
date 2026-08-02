#!/usr/bin/env bash
# Exercise the "direct" path: browser hits Vite at :5173 directly, bypassing
# oauth2-proxy. Vite's proxy injects X-Forwarded-Email so the API sees an
# authenticated request.
#
# Tests:
#   1. Vite serves index.html on /
#   2. Vite proxies /api/v1/auth/whoami → API → echoes our dev email
#   3. We can mint a PAT and authenticate with it
#   4. The MCP listener accepts our PAT and responds

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi
: "${ALMANAC_DEV_EMAIL:?ALMANAC_DEV_EMAIL must be set in .env}"

if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; N=$'\033[0m'
else
  G=''; R=''; Y=''; N=''
fi
step() { echo "${Y}==>${N} $1"; }
ok()   { echo "  ${G}OK${N}: $1"; }
fail() { echo "  ${R}FAIL${N}: $1" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || fail "jq not on PATH"

WEB=http://127.0.0.1:5173
API="http://127.0.0.1:${ALMANAC_API_PORT:-3001}"
MCP="http://127.0.0.1:${ALMANAC_MCP_PORT:-3030}"

# ─── 1. Vite serves the SPA ───────────────────────────────────────────
step "1. Vite SPA reachable"
curl -sf "$WEB/" -o /dev/null || fail "Vite did not respond at $WEB/. Is 'pnpm dev:web' running?"
ok "GET $WEB/ → 200"

# ─── 2. /api/v1/auth/whoami through Vite proxy ────────────────────────
step "2. whoami via Vite proxy (X-Forwarded-Email injection)"
WHOAMI=$(curl -sf "$WEB/api/v1/auth/whoami") \
  || fail "/api/v1/auth/whoami via Vite proxy did not return 2xx. Is the API up and TRUST_PROXY_HEADERS=true?"
echo "$WHOAMI" | jq -e --arg E "$ALMANAC_DEV_EMAIL" '.email == $E' >/dev/null \
  || fail "whoami did not echo our dev email ($ALMANAC_DEV_EMAIL). Got: $WHOAMI"
ok "whoami matched email=$ALMANAC_DEV_EMAIL"

# ─── 3. Mint a PAT and use it directly against the API ────────────────
step "3. Mint a PAT, use it directly"
TOKEN_RESPONSE=$(curl -sf \
  "$WEB/api/v1/auth/tokens" \
  -H "content-type: application/json" \
  -X POST -d '{"name":"test-direct-smoke"}') \
  || fail "POST /api/v1/auth/tokens failed"
TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token')
TOKEN_ID=$(echo "$TOKEN_RESPONSE" | jq -r '.id')
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || fail "no token in response"
ok "minted token id=$TOKEN_ID prefix=$(echo "$TOKEN" | cut -c1-8)"

curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/v1/users/me" >/dev/null \
  || fail "Bearer-authed request to API direct did not succeed"
ok "PAT authenticated to API direct"

# ─── 4. Hit /mcp/ with the freshly-minted PAT ─────────────────────────
# The MCP listener accepts any non-empty Bearer and threads it to the API;
# the API does the real PAT lookup. So we reuse $TOKEN (the PAT minted in
# step 3) rather than relying on a static env-var gate-check value.
step "4. MCP /mcp/ accepts the minted PAT"
MCP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -X POST -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  "$MCP/mcp")
case "$MCP_STATUS" in
  2*|400|406) ok "MCP responded with HTTP $MCP_STATUS (auth + transport alive)" ;;
  401)        fail "MCP rejected the PAT. Was it actually minted against \$ALMANAC_DEV_EMAIL's user, or did the API fail to recognize it?" ;;
  404)        fail "MCP returned 404. Is the MCP listener up on :3030?" ;;
  *)          fail "unexpected MCP response code $MCP_STATUS" ;;
esac

# ─── 5. Cleanup: revoke the test PAT ──────────────────────────────────
curl -sf "$WEB/api/v1/auth/tokens/$TOKEN_ID" -X DELETE >/dev/null \
  || fail "failed to clean up test PAT"

echo ""
echo "${G}Direct-path smoke checks passed.${N}"
