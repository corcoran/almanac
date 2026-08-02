#!/usr/bin/env bash
# deploy/post-migration-smoke.sh — exercise a freshly-deployed Almanac stack.
#
# Runs INSIDE the docker network because oauth2-proxy (the public listener
# on :24180) doesn't accept inbound X-Forwarded-Email as auth — it only emits
# that header AFTER a Google session. To authenticate without a browser,
# we hit the internal almanac-api:3001 directly via a sidecar curl container
# on the compose network.
#
# Usage:
#   cd ~/almanac
#   TEST_EMAIL=you@example.com bash deploy/post-migration-smoke.sh
#
# Requirements:
#   - docker + jq on the operator's host (curl runs inside a sidecar)
#   - The compose stack is running (`docker compose ps` shows healthy services)
#   - TEST_EMAIL is already bound to a user row (either user_id=1 via
#     ALMANAC_FIRST_LOGIN_EMAIL or auto-provisioned via a prior browser request)
#
# Steps exercised, in order:
#   1. /api/v1/health (internal) + /api/v1/health (public, via oauth2-proxy)
#   2. /api/v1/auth/whoami via X-Forwarded-Email (internal)
#   3. POST /api/v1/auth/tokens to mint a PAT
#   4. GET  /api/v1/users/me with that PAT (Authorization: Bearer)
#   5. POST /mcp/ initialize handshake with the PAT
#   6. DELETE /api/v1/auth/tokens/:id to revoke
#   7. Re-attempt step 4 with the revoked PAT — must 401

set -euo pipefail

TEST_EMAIL="${TEST_EMAIL:?TEST_EMAIL must be set}"
PROJECT="${COMPOSE_PROJECT_NAME:-almanac}"  # default matches the compose dir basename
NETWORK="${PROJECT}_default"
API="http://almanac-api:3001"
MCP="http://almanac-mcp:3030"

# Color helpers for diagnostic output. Falls back to no-color when stdout
# isn't a tty (e.g., CI logs, redirected output).
if [ -t 1 ]; then
  G=$'\033[32m'
  R=$'\033[31m'
  Y=$'\033[33m'
  N=$'\033[0m'
else
  G=''
  R=''
  Y=''
  N=''
fi

step() { echo "${Y}==>${N} $1"; }
ok()   { echo "  ${G}OK${N}: $1"; }
fail() { echo "  ${R}FAIL${N}: $1" >&2; exit 1; }

# Helper: run a curl command in a throwaway container on the compose network.
# Pass curl args as positional args. Sidecar exits cleanly so each call is
# isolated.
sidecar_curl() {
  docker run --rm --network "$NETWORK" curlimages/curl:8.10.1 -s "$@"
}

require() {
  command -v "$1" >/dev/null 2>&1 || fail "missing tool on host: $1"
}
require docker
require jq

# Sanity: stack is up
docker compose ps --status running 2>/dev/null | grep -q almanac-api \
  || fail "almanac-api container is not running. Did you 'docker compose up -d'?"

# ---------------------------------------------------------------------
step "1. Health check (via sidecar on the compose network)"
HEALTH=$(sidecar_curl -f "$API/api/v1/health") || fail "/api/v1/health did not return 2xx"
echo "  $HEALTH" | jq -e '.ok == true' >/dev/null \
  || fail "/api/v1/health did not return {ok: true} (got: $HEALTH)"
ok "health responded"

# Bonus: public health check via the oauth2-proxy listener (no auth needed
# because of the --skip-auth-route=^/api/v1/health$ rule in docker-compose.yml).
PUBLIC_HEALTH=$(curl -sf http://127.0.0.1:24180/api/v1/health 2>/dev/null) \
  || fail "public /api/v1/health did not pass through oauth2-proxy; is --skip-auth-route=^/api/v1/health\$ added?"
echo "  $PUBLIC_HEALTH" | jq -e '.ok == true' >/dev/null \
  || fail "public health did not return {ok: true} (got: $PUBLIC_HEALTH)"
ok "public health pass-through via oauth2-proxy works"

# ---------------------------------------------------------------------
step "2. whoami via X-Forwarded-Email (internal)"
WHOAMI=$(sidecar_curl -f -H "X-Forwarded-Email: $TEST_EMAIL" "$API/api/v1/auth/whoami") \
  || fail "/api/v1/auth/whoami did not return 2xx; is ALMANAC_TRUST_PROXY_HEADERS=true?"
echo "  $WHOAMI" | jq -e --arg E "$TEST_EMAIL" '.email == $E' >/dev/null \
  || fail "whoami did not echo our email ($TEST_EMAIL); got: $WHOAMI"
ok "whoami matched $TEST_EMAIL"

# ---------------------------------------------------------------------
step "3. Mint a PAT"
TOKEN_RESPONSE=$(sidecar_curl -f \
  -H "X-Forwarded-Email: $TEST_EMAIL" \
  -H "content-type: application/json" \
  -X POST -d '{"name":"smoke-test"}' \
  "$API/api/v1/auth/tokens") \
  || fail "POST /api/v1/auth/tokens failed"
TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token')
TOKEN_ID=$(echo "$TOKEN_RESPONSE" | jq -r '.id')
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] \
  || fail "mint response did not contain a cleartext token (got: $TOKEN_RESPONSE)"
[ -n "$TOKEN_ID" ] && [ "$TOKEN_ID" != "null" ] \
  || fail "mint response did not contain an id (got: $TOKEN_RESPONSE)"
ok "minted token id=$TOKEN_ID prefix=$(echo "$TOKEN" | cut -c1-8)"

# ---------------------------------------------------------------------
step "4. Use the PAT against an authenticated endpoint"
# /api/v1/users/me requires auth and exists for every bound user. Picking this
# over /today-context because today-context requires a nutrition phase row,
# which a fresh deploy won't have.
sidecar_curl -f -H "Authorization: Bearer $TOKEN" "$API/api/v1/users/me" >/dev/null \
  || fail "Bearer-authed request to /api/v1/users/me did not succeed"
ok "PAT authenticated to /api/v1/users/me"

# ---------------------------------------------------------------------
step "5. Hit /mcp with the PAT"
# Minimal MCP initialize request via Streamable HTTP. We don't parse the
# response shape — a real session-init handshake involves session-id
# tracking that's overkill for a smoke check. We just confirm the auth +
# transport layers are alive: 2xx, 400 (malformed), or 406 (Accept-header
# mismatch — common with a barebones POST that doesn't advertise SSE) all
# prove the MCP service is reachable. NOTE: the listener's pathname check
# is `/mcp` exact (no trailing slash); calling `$MCP/mcp/` 404s.
MCP_STATUS=$(sidecar_curl -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -X POST -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  "$MCP/mcp")
case "$MCP_STATUS" in
  2*|400|406) ok "MCP responded with HTTP $MCP_STATUS (auth + transport alive)" ;;
  401)        fail "MCP rejected the PAT. Was it actually minted against TEST_EMAIL's user? Or is it revoked?" ;;
  404)        fail "MCP returned 404 — is the upstream wired correctly? Check 'docker compose logs almanac-mcp'" ;;
  *)          fail "unexpected MCP response code $MCP_STATUS" ;;
esac

# ---------------------------------------------------------------------
step "6. Revoke the PAT"
# DELETE returns 204 No Content. curl -sf treats 204 as success.
sidecar_curl -f -H "X-Forwarded-Email: $TEST_EMAIL" \
  -X DELETE "$API/api/v1/auth/tokens/$TOKEN_ID" \
  || fail "DELETE /api/v1/auth/tokens/$TOKEN_ID failed"
ok "PAT $TOKEN_ID revoked"

# ---------------------------------------------------------------------
step "7. Revoked PAT is rejected"
HTTP=$(sidecar_curl -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$API/api/v1/users/me")
[ "$HTTP" = "401" ] \
  || fail "revoked PAT returned HTTP $HTTP against /api/v1/users/me (expected 401)"
ok "revoked PAT correctly 401s"

echo ""
echo "${G}All smoke checks passed.${N}"
