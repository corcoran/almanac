#!/usr/bin/env bash
# Exercise the "through oauth2-proxy" path: requests hit :4180 first, which
# either gates them (browser sign-in) or skips-auth and passes through
# (health probe, /mcp/).
#
# Most of the real flow (Google OAuth dance, cookie handshake) can't be
# automated without a headless browser. What we CAN test:
#   1. oauth2-proxy is reachable
#   2. /api/v1/health passes through (--skip-auth-route)
#   3. /api/v1/auth/whoami is gated (returns 302/403 without a session cookie)
#   4. /mcp/ is reachable through oauth2-proxy (requires a PAT to actually
#      drive — mint one via test-direct.sh first, then re-run with
#      TEST_PAT=alm_... in env to exercise step 4).
#
# For the full SSO test: open http://localhost:4180/ in your browser, sign
# in with Google, and confirm you land on the SPA showing your data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; N=$'\033[0m'
else
  G=''; R=''; Y=''; N=''
fi
step() { echo "${Y}==>${N} $1"; }
ok()   { echo "  ${G}OK${N}: $1"; }
fail() { echo "  ${R}FAIL${N}: $1" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || fail "jq not on PATH"

PROXY=http://127.0.0.1:4180

# ─── 1. oauth2-proxy reachable ────────────────────────────────────────
step "1. oauth2-proxy reachable"
ROOT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$PROXY/")
case "$ROOT_STATUS" in
  302|403) ok "GET / returned HTTP $ROOT_STATUS (gated as expected — Google sign-in page or 403)" ;;
  200)     ok "GET / returned HTTP 200 (you might already have a session cookie cached)" ;;
  *)       fail "unexpected HTTP $ROOT_STATUS from oauth2-proxy. Is the container running? Try: docker logs almanac-dev-oauth2-proxy" ;;
esac

# ─── 2. /api/v1/health passes through ─────────────────────────────────
step "2. /api/v1/health passes through (skip-auth-route)"
HEALTH=$(curl -sf "$PROXY/api/v1/health") \
  || fail "/api/v1/health did not 2xx. Either oauth2-proxy isn't routing or the API isn't responding."
echo "$HEALTH" | jq -e '.ok == true' >/dev/null \
  || fail "/api/v1/health did not return {ok: true}. Got: $HEALTH"
ok "health pass-through works"

# ─── 3. /api/v1/auth/whoami is gated ──────────────────────────────────
# Without a session cookie, oauth2-proxy should NOT let this through.
# Expected: 302 (redirect to sign-in) OR 403 (deny).
step "3. /api/v1/auth/whoami is gated"
WHOAMI_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$PROXY/api/v1/auth/whoami")
case "$WHOAMI_STATUS" in
  302|403|401)
    ok "GET /api/v1/auth/whoami → HTTP $WHOAMI_STATUS without a session (correctly gated)" ;;
  200)
    fail "GET /api/v1/auth/whoami → 200 WITHOUT a session. oauth2-proxy is misconfigured — auth gate is open!" ;;
  *)
    fail "unexpected HTTP $WHOAMI_STATUS" ;;
esac

# ─── 4. /mcp/ passes through with a PAT (optional) ────────────────────
# To actually exercise the MCP layer through oauth2-proxy we need a valid
# PAT (oauth2-proxy itself just `--skip-auth-route`s /mcp/, but the MCP
# listener still requires a Bearer that the API can validate). Minting a
# PAT here would require a session against oauth2-proxy which we don't have
# in this script. Workflow: run test-direct.sh first (it mints a PAT off
# the Vite-injected X-Forwarded-Email path), copy the PAT into TEST_PAT,
# and re-run this script.
if [ -n "${TEST_PAT:-}" ]; then
  step "4. /mcp/ passes through (skip-auth-route) with TEST_PAT"
  MCP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $TEST_PAT" \
    -H "content-type: application/json" \
    -X POST -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
    "$PROXY/mcp/")
  case "$MCP_STATUS" in
    2*|400|406) ok "MCP via oauth2-proxy responded with HTTP $MCP_STATUS (skip-auth + transport alive)" ;;
    401)        fail "MCP rejected the PAT. Was TEST_PAT actually minted against an allowed user?" ;;
    302|403)    fail "oauth2-proxy gated /mcp/ — is the --skip-auth-route='^/mcp/' rule active?" ;;
    *)          fail "unexpected MCP response code $MCP_STATUS" ;;
  esac
else
  step "4. /mcp/ smoke (skipped)"
  echo "  ${Y}SKIP${N}: set TEST_PAT=alm_... in env to exercise the MCP path through oauth2-proxy"
  echo "        (mint a PAT via test-direct.sh first, then re-run this script with TEST_PAT)"
fi

echo ""
echo "${G}oauth2-proxy-path smoke checks passed.${N}"
echo ""
echo "${Y}Next: full browser flow.${N}"
echo "  Open http://localhost:4180/ in your browser and sign in with Google."
echo "  Expected: you land on the Almanac SPA with your data."
