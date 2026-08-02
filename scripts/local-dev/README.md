# Local dev rehearsal

Helpers for running the full Almanac stack on your laptop with the real
oauth2-proxy + Google sign-in flow. Use these when you want to verify the
production auth path before deploying.

## Two testing paths

```
        ┌─── direct (faster iteration, no Google sign-in) ───┐
        │                                                    │
Browser ┤                                                    ├── almanac-web (Vite, :5173)
        │                                                    │
        └── via oauth2-proxy (full SSO flow, like prod) ─────┘
                          :4180                              └── almanac-api (Fastify, :3001)
                                                                 (Vite proxy → almanac-mcp on :3030)
```

| Path | URL | Auth | Use case |
|---|---|---|---|
| Direct | `http://localhost:5173` | `X-Forwarded-Email: $ALMANAC_DEV_EMAIL` injected by Vite proxy | Fastest iteration; tests web bundle + API + auth middleware without Google in the loop |
| Through oauth2-proxy | `http://localhost:4180` | Real Google session cookie | Tests the full production auth flow end-to-end |

Both paths share the same backend processes — only the front door differs.

## Prerequisites

1. Docker installed and running.
2. A Google OAuth 2.0 Client (the same one you use for production is fine).
3. The client's **Authorized redirect URIs** must include:
   - `http://localhost:4180/oauth2/callback` (this dev rehearsal)
   - `https://almanac.yourdomain.com/oauth2/callback` (production)
4. A `.env` file at the repo root (`~/Work/almanac/.env`). Copy from `.env.example` and fill in real values for:
   - `OAUTH2_PROXY_CLIENT_ID` (from Google console)
   - `OAUTH2_PROXY_CLIENT_SECRET` (from Google console)
   - `OAUTH2_PROXY_COOKIE_SECRET` (generate one — see comment in `.env.example`)
   - For local dev ONLY: `OAUTH2_PROXY_REDIRECT_URL=http://localhost:4180/oauth2/callback`
   - `ALMANAC_DEV_EMAIL=<your-gmail>` (used by the direct path)
   - `ALMANAC_MCP_CLIENT_TOKEN=<your-PAT>` (only consumed by `transport=stdio`; see "MCP token" section below)
5. An `allowed-users.txt` at the repo root with your email:
   ```
   echo "you@gmail.com" > allowed-users.txt
   ```

## Quick start

```bash
# In one terminal — brings up oauth2-proxy (docker) + api + web + mcp (pnpm)
./scripts/local-dev/up.sh

# In another terminal — verify both paths
./scripts/local-dev/test-direct.sh
./scripts/local-dev/test-via-oauth2.sh

# When done
./scripts/local-dev/down.sh
```

## MCP token

For local dev with `transport=http`, your MCP client (Claude Desktop / Code)
just needs ANY valid PAT in its `Authorization: Bearer` header — the MCP
server passes it through to the API, which validates it against
`personal_access_tokens`. Mint a PAT via the web UI (Settings → Tokens) for
your user and paste it into your MCP client config.

`ALMANAC_MCP_CLIENT_TOKEN` is now only consumed when `ALMANAC_MCP_TRANSPORT=stdio`
(where stdio has no incoming HTTP request to extract a bearer from, so the
env var IS the process's identity). For `http` and `sse` transports it is
ignored.

## Claude Desktop / Code MCP config

Add a `dev` entry pointing at your local MCP listener:

```jsonc
{
  "mcpServers": {
    "almanac-dev": {
      "url": "http://127.0.0.1:3030/mcp",
      "headers": {
        "Authorization": "Bearer alm_<your-local-PAT>"
      }
    }
  }
}
```

For Claude Desktop on macOS, this lives at
`~/Library/Application Support/Claude/claude_desktop_config.json`.

For Claude Code:
```bash
claude mcp add --transport http almanac-dev http://127.0.0.1:3030/mcp \
  --header "Authorization: Bearer alm_<your-local-PAT>"
```

Restart Claude Desktop / Code after editing the config.

## Stdio MCP against a local API (no docker, no :3030 listener)

The config above is for the **http** transport (Claude connects to the MCP's
`:3030` listener). The alternative is the **stdio** transport: Claude Code
spawns the MCP as a child process that talks to a local API directly. This is
handy for iterating on the MCP against a real DB without running the full
docker stack. The recipe that works:

1. **Build the workspace** (stdio runs the compiled `dist`, and `@almanac/core`
   resolves to *its* `dist` only under the `production` export condition):
   ```bash
   pnpm --filter @almanac/core build && pnpm --filter @almanac/mcp build
   ```
2. **Run a local API on :3001** against the DB you want to test (use an absolute
   `ALMANAC_DB_PATH`):
   ```bash
   env ALMANAC_DB_PATH=$PWD/data/almanac.sqlite ALMANAC_API_PORT=3001 \
       ALMANAC_TRUST_PROXY_HEADERS=true ALMANAC_ALLOWED_EMAILS=you@gmail.com \
       ALMANAC_FIRST_LOGIN_EMAIL=you@gmail.com pnpm dev:api
   ```
3. **Mint a PAT** in that same DB (the MCP threads it to the API as its identity):
   ```bash
   curl -s -X POST http://127.0.0.1:3001/api/v1/auth/tokens \
     -H 'content-type: application/json' -H 'x-forwarded-email: you@gmail.com' \
     -d '{"name":"local-mcp-dev"}' | jq -r .token
   ```
4. **Register the stdio MCP** in `~/.claude.json` (note `--conditions=production`
   in args — without it, node loads `@almanac/core`'s `.ts` source and crashes
   with `ERR_UNKNOWN_FILE_EXTENSION`):
   ```jsonc
   "almanac": {
     "command": "node",
     "args": ["--conditions=production", "/abs/path/to/packages/mcp/dist/index.js"],
     "env": {
       "ALMANAC_MCP_TRANSPORT": "stdio",
       "ALMANAC_API_URL": "http://127.0.0.1:3001",
       "ALMANAC_MCP_CLIENT_TOKEN": "alm_<the-PAT-from-step-3>"
     }
   }
   ```
   `ALMANAC_MCP_CLIENT_TOKEN` is required in stdio mode (there's no incoming HTTP
   request to pull a bearer from, so the env var IS the process's identity).

Reconnect the MCP (`/mcp` in Claude Code) after editing. The PAT lives in the
DB, so it only works while an API serving that DB is up on :3001 — the docker
stack's API is compose-internal and not reachable here.

## What each script does

- **`up.sh`** — starts oauth2-proxy in docker (one-shot `docker run`, not compose),
  then launches API + web + MCP via `pnpm dev` in the background. Writes PIDs to
  `/tmp/almanac-dev-pids` so `down.sh` knows what to kill.
- **`down.sh`** — kills the pnpm processes, stops the oauth2-proxy container.
- **`test-direct.sh`** — hits `http://localhost:5173/` and `/api/v1/auth/whoami`
  with `X-Forwarded-Email`. Exits 0 on success.
- **`test-via-oauth2.sh`** — hits `http://localhost:4180/api/v1/health` (the
  one path that bypasses oauth2-proxy via `--skip-auth-route`). The full
  browser-flow tests can't be automated easily; this just confirms oauth2-proxy
  is reachable and routing.
