#!/usr/bin/env bash
# Tear down the local dev stack started by up.sh.

set -uo pipefail   # NOT -e — we want to attempt all cleanups even if some fail

PIDFILE=/tmp/almanac-dev-pids

# Stop oauth2-proxy
if docker ps --format '{{.Names}}' | grep -q '^almanac-dev-oauth2-proxy$'; then
  echo "==> stopping oauth2-proxy"
  docker stop almanac-dev-oauth2-proxy >/dev/null
fi

# Kill the pnpm dev processes by PID. We track them in $PIDFILE because pnpm
# spawns child processes that are hard to find generically — and we don't
# want to nuke unrelated user node processes.
if [ -f "$PIDFILE" ]; then
  while IFS=: read -r label pid; do
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "==> killing $label (pid $pid) and its descendants"
      # Kill the whole process group so vite/tsx/etc. children die too.
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done < "$PIDFILE"
  rm -f "$PIDFILE"
fi

# Fallback: kill anything still listening on our dev ports. Catches cases
# where up.sh died mid-launch and the PID file is missing.
for port in 3001 3030 5173; do
  pid=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "==> killing leftover process on :$port (pid $pid)"
    kill -TERM $pid 2>/dev/null || true
  fi
done

echo "✓ teardown complete"
