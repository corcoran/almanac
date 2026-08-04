# MCP Authentication Architecture

Almanac's MCP server supports two authentication methods that work in parallel. Both produce the same result: a Personal Access Token (PAT) stored in SQLite that the API validates on every request.

## Two Auth Paths, One Token Format

```
Claude mobile / ChatGPT          Claude Code / Desktop
        |                                |
   OAuth 2.1 flow                   Manual PAT
   (automatic)                    (copy-paste)
        |                                |
   Google sign-in                  Settings UI
        |                          "Create token"
        |                                |
   Mint PAT via API                 PAT stored
        |                           in SQLite
        v                                v
   ┌─────────────────────────────────────────┐
   │   Bearer alm_XXXX on every /mcp call   │
   │   API validates against                 │
   │   personal_access_tokens table          │
   └─────────────────────────────────────────┘
```

### Path 1: OAuth 2.1 (Claude mobile, ChatGPT, any MCP client with OAuth support)

The user enters `https://almanac.example.com/mcp` as the server URL. The client handles everything automatically:

1. **Discovery** -- client fetches `/.well-known/oauth-protected-resource/mcp`, learns the authorization server URL
2. **AS metadata** -- client fetches `/.well-known/oauth-authorization-server`, discovers endpoints
3. **Dynamic client registration** -- client POSTs to `/register`, gets a `client_id`
4. **Authorization** -- client opens `/authorize` in a browser, which redirects to Google sign-in
5. **Google callback** -- after sign-in, Google redirects to `/oauth/google/callback` with an auth code
6. **Token exchange** -- the MCP server exchanges the Google code for a Google token, extracts the email, checks the allowlist, then calls `POST /api/v1/auth/tokens` internally to mint a real PAT
7. **Access** -- client receives the PAT as the OAuth access token and uses it as `Authorization: Bearer <token>` on all subsequent `/mcp` requests

The PAT is stored in SQLite and survives container restarts. It shows up in the web Settings panel and can be revoked from there.

### Path 2: Manual PAT (Claude Code, Claude Desktop stdio, any client that supports static bearer tokens)

1. User logs into the web UI at `https://almanac.example.com`
2. Opens Settings (avatar menu top-right) and clicks "Create token"
3. Copies the cleartext token (shown once)
4. Configures their MCP client with the token

**Claude Code** (`~/.claude.json` or project config):
```json
{
  "mcpServers": {
    "almanac": {
      "type": "url",
      "url": "https://almanac.example.com/mcp",
      "headers": {
        "Authorization": "Bearer alm_XXXXX"
      }
    }
  }
}
```

**Claude Desktop** (stdio via mcp-remote, if OAuth browser flow doesn't work locally):
```json
{
  "mcpServers": {
    "almanac": {
      "command": "npx",
      "args": ["mcp-remote", "https://almanac.example.com/mcp"]
    }
  }
}
```
This uses mcp-remote as a bridge and triggers the OAuth flow automatically.

## Architecture: How Requests Flow

```
Internet
    |
  nginx (:443, TLS termination)
    |
  oauth2-proxy (:4180)
    |
    ├── /mcp/*                 ──> almanac-mcp:3030  (skip-auth, PAT validated by API)
    ├── /.well-known/oauth-*   ──> almanac-mcp:3030  (skip-auth, public discovery)
    ├── /authorize             ──> almanac-mcp:3030  (skip-auth, redirects to Google)
    ├── /token                 ──> almanac-mcp:3030  (skip-auth, exchanges auth codes)
    ├── /register              ──> almanac-mcp:3030  (skip-auth, dynamic client reg)
    ├── /oauth/google/*        ──> almanac-mcp:3030  (skip-auth, Google callback)
    ├── /api/*                 ──> almanac-api:3001   (SSO-gated for browser, PAT for machines)
    └── /*                     ──> almanac-web:80     (SSO-gated, serves the SPA)
```

Key points:
- oauth2-proxy handles **browser SSO** for the web UI and API (Google sign-in, session cookies, `X-Forwarded-Email` headers)
- The MCP container handles its **own auth** (OAuth 2.1 discovery + flow, PAT validation via the API)
- oauth2-proxy's `--skip-auth-route` lets MCP and OAuth traffic pass through without SSO
- oauth2-proxy's `--upstream` routes by path prefix to the right container
- No nginx changes needed beyond the standard TLS reverse proxy to oauth2-proxy

## Key Files

| File | Role |
|------|------|
| `packages/mcp/src/oauth-provider.ts` | `OAuthServerProvider` implementation. Handles Google redirect, callback, auth code minting, PAT minting via API, token verification. In-memory stores for auth codes and registered clients. |
| `packages/mcp/src/index.ts` | Express app with `mcpAuthRouter` (SDK-provided). Mounts OAuth endpoints at `/`, Google callback at `/oauth/google/callback`, MCP Streamable HTTP at `/mcp`. Falls back to PAT-only mode when OAuth env vars are unset. |
| `packages/mcp/src/config.ts` | Env var schema including `ALMANAC_MCP_OAUTH_CLIENT_ID`, `ALMANAC_MCP_OAUTH_CLIENT_SECRET`, `ALMANAC_MCP_PUBLIC_URL`, `ALMANAC_ALLOWED_EMAILS`. |
| `packages/api/src/auth.ts` | API auth middleware. Validates PATs against `personal_access_tokens` table. Also accepts `X-Forwarded-Email` from oauth2-proxy (browser path). Checks `ALMANAC_ALLOWED_EMAILS` before auto-provisioning new users. |
| `packages/core/src/repos/personal-access-tokens.repo.ts` | PAT CRUD. `mintToken()` generates `alm_XXXX` tokens, stores SHA-256 hash. |
| `docker-compose.yml` | Service definitions. oauth2-proxy skip-auth-routes and upstream routing for MCP OAuth paths. |

## Environment Variables (MCP OAuth)

| Variable | Required | Description |
|----------|----------|-------------|
| `ALMANAC_MCP_OAUTH_CLIENT_ID` | For OAuth | Google OAuth client ID (same as `OAUTH2_PROXY_CLIENT_ID`) |
| `ALMANAC_MCP_OAUTH_CLIENT_SECRET` | For OAuth | Google OAuth client secret |
| `ALMANAC_MCP_PUBLIC_URL` | For OAuth | Public URL, e.g. `https://almanac.example.com`. Used as OAuth issuer and for Google redirect URI. |
| `ALMANAC_ALLOWED_EMAILS` | Optional | File path or comma-separated emails. Shared by both API and MCP. Controls which emails can auto-provision via the API's proxy header path and which can complete the MCP OAuth flow. Existing users (already in the DB) bypass the API check. Empty = allow any authenticated email. |

When the OAuth vars are unset, the MCP server runs in PAT-only mode (no OAuth discovery endpoints, manual token required).

In production, `ALMANAC_ALLOWED_EMAILS` and oauth2-proxy's `--authenticated-emails-file` both point to the same `allowed-users.txt` file. Three layers of enforcement, one file, one env var.

## Google Cloud Console Setup

The same Google OAuth client ID is shared between oauth2-proxy (web SSO) and the MCP OAuth flow. Two redirect URIs must be registered:

1. `https://almanac.example.com/oauth2/callback` -- oauth2-proxy's web SSO
2. `https://almanac.example.com/oauth/google/callback` -- MCP OAuth flow

For local dev, add:
1. `http://localhost:4180/oauth2/callback`
2. `http://localhost:4180/oauth/google/callback`

## MCP SDK Integration

The OAuth server is built on the `@modelcontextprotocol/sdk` (v1.29.0+) auth module:

- **`mcpAuthRouter(options)`** -- Express middleware that mounts all RFC-required endpoints: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/{path}`, `/authorize`, `/token`, `/register`, `/revoke`
- **`OAuthServerProvider`** interface -- we implement 6 methods:
  - `clientsStore` -- in-memory map of dynamically registered clients
  - `authorize()` -- redirects to Google's consent screen
  - `challengeForAuthorizationCode()` -- returns stored PKCE challenge
  - `exchangeAuthorizationCode()` -- verifies Google token, checks allowlist, mints PAT via API
  - `exchangeRefreshToken()` -- not implemented (PATs don't expire)
  - `verifyAccessToken()` -- checks in-memory cache, falls back to API validation

## What's In-Memory vs Persistent

| Data | Storage | Survives restart? |
|------|---------|-------------------|
| Registered OAuth clients | In-memory Map | No -- clients re-register automatically |
| Pending auth flows (state params) | In-memory Map | No -- stale flows fail gracefully |
| Auth codes | In-memory Map | No -- codes are short-lived (5 min) anyway |
| Access tokens (PATs) | SQLite via API | Yes |
| Streamable HTTP sessions | In-memory Map | No -- server returns 404 for stale session IDs, prompting clients to re-initialize |

The only thing that matters across restarts is the PAT itself, and that's in the database. Clients that lose their registration simply re-register and re-authorize -- the OAuth spec handles this gracefully. Streamable HTTP sessions are ephemeral; after a container restart, clients receive a 404 for their stale session ID and automatically establish a new session using their existing PAT.

## Relevant Specs

- [MCP Authorization (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) -- the MCP OAuth 2.1 spec
- [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) -- OAuth 2.0 Protected Resource Metadata
- [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) -- OAuth 2.0 Authorization Server Metadata
- [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) -- OAuth 2.0 Dynamic Client Registration
- [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) -- PKCE (Proof Key for Code Exchange)
