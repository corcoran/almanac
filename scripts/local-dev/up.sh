#!/usr/bin/env bash
# Spin up the full local-dev stack: oauth2-proxy (docker) + API + web + MCP
# (pnpm dev, backgrounded). See scripts/local-dev/README.md for the design.

set -euo pipefail

# Resolve repo root regardless of where this is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Load .env if present. Lines beginning with # are skipped; KEY=VALUE pairs
# are exported. Doesn't handle multi-line values; that's fine for our shape.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
else
  echo "ERROR: .env not found at $REPO_ROOT/.env"
  echo "Copy .env.example and fill in OAUTH2_PROXY_* + ALMANAC_DEV_EMAIL +"
  echo "ALMANAC_MCP_CLIENT_TOKEN (see scripts/local-dev/README.md)."
  exit 1
fi

# Required vars sanity check.
: "${OAUTH2_PROXY_CLIENT_ID:?OAUTH2_PROXY_CLIENT_ID must be set in .env}"
: "${OAUTH2_PROXY_CLIENT_SECRET:?OAUTH2_PROXY_CLIENT_SECRET must be set in .env}"
: "${OAUTH2_PROXY_COOKIE_SECRET:?OAUTH2_PROXY_COOKIE_SECRET must be set in .env}"
: "${ALMANAC_DEV_EMAIL:?ALMANAC_DEV_EMAIL must be set in .env}"
: "${ALMANAC_MCP_CLIENT_TOKEN:?ALMANAC_MCP_CLIENT_TOKEN must be set in .env}"

# allowed-users.txt must exist.
if [ ! -f allowed-users.txt ]; then
  echo "ERROR: allowed-users.txt not found."
  echo "Create one with: echo \"$ALMANAC_DEV_EMAIL\" > allowed-users.txt"
  exit 1
fi

# The API and MCP read the SAME allowlist file oauth2-proxy is mounted, so all
# three layers agree — matching what docker-compose.yml does in prod. Passing
# only $ALMANAC_DEV_EMAIL here (the old behavior) let any OTHER allowlisted
# person clear the OAuth gate and then get 403'd by the API on every request,
# which renders as a signed-in-but-empty UI with no explanation.
ALLOWED_EMAILS_SRC="$REPO_ROOT/allowed-users.txt"

PIDFILE=/tmp/almanac-dev-pids
> "$PIDFILE"

cleanup_on_fail() {
  echo ""
  echo "ERROR during startup — tearing down any partial state."
  "$SCRIPT_DIR/down.sh" || true
  exit 1
}
trap cleanup_on_fail ERR

# ─── 1. Stop any prior oauth2-proxy container ─────────────────────────
docker rm -f almanac-dev-oauth2-proxy >/dev/null 2>&1 || true

# ─── 2. Launch backend services via pnpm dev, backgrounded ────────────
# Each writes its PID to $PIDFILE so down.sh can clean them up.
API_PORT="${ALMANAC_API_PORT:-3001}"
MCP_PORT="${ALMANAC_MCP_PORT:-3030}"

echo "==> starting almanac-api on :${API_PORT}"
ALMANAC_API_HOST=0.0.0.0 \
ALMANAC_TRUST_PROXY_HEADERS=true \
ALMANAC_ALLOWED_EMAILS="$ALLOWED_EMAILS_SRC" \
  pnpm --filter @almanac/api dev > /tmp/almanac-api.log 2>&1 &
echo "api:$!" >> "$PIDFILE"

echo "==> starting almanac-web (vite) on :5173"
ALMANAC_DEV_EMAIL="$ALMANAC_DEV_EMAIL" \
  pnpm --filter @almanac/web dev > /tmp/almanac-web.log 2>&1 &
echo "web:$!" >> "$PIDFILE"

echo "==> starting almanac-mcp (Streamable HTTP) on :${MCP_PORT}"
ALMANAC_MCP_TRANSPORT=http \
ALMANAC_MCP_HOST=0.0.0.0 \
ALMANAC_MCP_PORT="$MCP_PORT" \
ALMANAC_MCP_CLIENT_TOKEN="$ALMANAC_MCP_CLIENT_TOKEN" \
ALMANAC_API_URL="http://127.0.0.1:${API_PORT}" \
ALMANAC_MCP_OAUTH_CLIENT_ID="${OAUTH2_PROXY_CLIENT_ID:-}" \
ALMANAC_MCP_OAUTH_CLIENT_SECRET="${OAUTH2_PROXY_CLIENT_SECRET:-}" \
ALMANAC_MCP_PUBLIC_URL="http://localhost:4180" \
ALMANAC_ALLOWED_EMAILS="$ALLOWED_EMAILS_SRC" \
  pnpm --filter @almanac/mcp dev > /tmp/almanac-mcp.log 2>&1 &
echo "mcp:$!" >> "$PIDFILE"

# Wait for API to be reachable. Migrations need to run before anything else
# is useful.
echo "==> waiting for api to come up"
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${API_PORT}/api/v1/health" >/dev/null 2>&1; then
    echo "    api up (took ${i}s)"
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    echo "ERROR: api never came up. Tail /tmp/almanac-api.log for details."
    cleanup_on_fail
  fi
done

# ─── 3. Launch oauth2-proxy ───────────────────────────────────────────
# Standalone docker run (no compose) so we can point it at host services.
# --add-host=host.docker.internal:host-gateway makes the container reach
# the host loopback on Linux; on Docker Desktop it's automatic but adding
# it is harmless.

echo "==> starting oauth2-proxy on :4180"
docker run -d --rm \
  --name almanac-dev-oauth2-proxy \
  --add-host=host.docker.internal:host-gateway \
  -p 127.0.0.1:4180:4180 \
  -v "$REPO_ROOT/allowed-users.txt:/emails/allowed-users.txt:ro" \
  quay.io/oauth2-proxy/oauth2-proxy:v7.6.0 \
    --http-address=0.0.0.0:4180 \
    --provider=google \
    --cookie-secret="$OAUTH2_PROXY_COOKIE_SECRET" \
    --cookie-secure=false \
    --cookie-samesite=lax \
    --redirect-url="http://localhost:4180/oauth2/callback" \
    --client-id="$OAUTH2_PROXY_CLIENT_ID" \
    --client-secret="$OAUTH2_PROXY_CLIENT_SECRET" \
    --authenticated-emails-file=/emails/allowed-users.txt \
    --set-xauthrequest=true \
    --pass-user-headers=true \
    --skip-auth-route='^/mcp' \
    --skip-auth-route='^/.well-known/' \
    --skip-auth-route='^/authorize' \
    --skip-auth-route='^/token' \
    --skip-auth-route='^/register' \
    --skip-auth-route='^/revoke' \
    --skip-auth-route='^/oauth/google/' \
    --skip-auth-route='^/api/v1/health$' \
    --upstream="http://host.docker.internal:${MCP_PORT}/.well-known/" \
    --upstream="http://host.docker.internal:${MCP_PORT}/authorize" \
    --upstream="http://host.docker.internal:${MCP_PORT}/token" \
    --upstream="http://host.docker.internal:${MCP_PORT}/register" \
    --upstream="http://host.docker.internal:${MCP_PORT}/revoke" \
    --upstream="http://host.docker.internal:${MCP_PORT}/oauth/" \
    --upstream="http://host.docker.internal:${MCP_PORT}/mcp" \
    --upstream="http://host.docker.internal:${API_PORT}/api/" \
    --upstream=http://host.docker.internal:5173/ >/dev/null

# Wait for oauth2-proxy to be ready (its /api/v1/health passthrough is the
# simplest probe).
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:4180/api/v1/health >/dev/null 2>&1; then
    echo "    oauth2-proxy up (took ${i}s)"
    break
  fi
  sleep 1
  if [ "$i" = "15" ]; then
    echo "ERROR: oauth2-proxy never came up."
    echo "  docker logs almanac-dev-oauth2-proxy"
    cleanup_on_fail
  fi
done

trap - ERR

cat <<EOF

✓ Local dev stack is up.

  Direct (bypass oauth2-proxy):
    http://localhost:5173

  Via oauth2-proxy (Google sign-in flow):
    http://localhost:4180

  Logs:
    tail -f /tmp/almanac-api.log
    tail -f /tmp/almanac-web.log
    tail -f /tmp/almanac-mcp.log
    docker logs -f almanac-dev-oauth2-proxy

  Smoke tests:
    ./scripts/local-dev/test-direct.sh
    ./scripts/local-dev/test-via-oauth2.sh

  Tear down:
    ./scripts/local-dev/down.sh
EOF
