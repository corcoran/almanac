---
title: Connecting assistants
---

# Connecting assistants

How to point an AI assistant at your Almanac instance. There are two ways in,
and both end at the same artifact — a Personal Access Token (PAT) that the API
validates on every request.

- **OAuth 2.1** — the client discovers Almanac's OAuth server, walks you through
  sign-in, and receives a token automatically. Claude mobile and ChatGPT work
  this way.
- **Manual PAT** — you mint a token in the web Settings panel and paste it into
  the client config. Claude Code and any client that supports a static bearer
  token work this way.

This page covers the client side. For how the two paths are implemented on the
server — the proxy routing, the three-layer allowlist, and the auth failure
modes — see [Authentication](/guide/authentication).

## Which path do you need?

| Client | Path | What you enter |
| --- | --- | --- |
| Claude mobile | OAuth 2.1 | the `/mcp` URL |
| ChatGPT | OAuth 2.1 | the `/mcp` URL |
| Claude Code | Manual PAT | the `/mcp` URL + a `Bearer alm_…` header |
| Claude Desktop | Either | the `/mcp` URL, via `mcp-remote` for the OAuth flow |

::: warning A local URL only works for local clients
Claude Code, and anything else running on the same machine, can reach
`localhost` or a LAN address. Claude's and ChatGPT's web and mobile apps cannot:
they connect from the vendor's servers, so `localhost` is *their* localhost and
a `192.168.x` address isn't routable from outside your network. Those clients
need Almanac published at a public HTTPS domain — see the
[deploy runbook](/guide/deploy). The app detects this and adjusts the connect
instructions it shows you.
:::

::: warning Connecting a custom MCP server is a paid feature
On both Claude and ChatGPT, adding your own remote MCP server is gated behind
their paid plans, and which plans qualify has changed more than once. Check the
current terms before assuming someone can connect.

This bites hardest when adding other people: a free-plan account cannot add
Almanac as an MCP server no matter how the server is deployed. They can still
use Almanac fully through the web dashboard, including the built-in AI meal
assistant and insights coach, which run on the server's own API key and need
nothing from the user.
:::

## Minting a PAT

1. Sign in to the web UI at `https://almanac.example.com`.
2. Open the user menu (top-right) → **Settings** → **Tokens**.
3. Click **Create token** and name it after the client — "Claude Code", "Claude
   Desktop".
4. Copy the cleartext token. It starts with `alm_`.

::: danger The cleartext is shown exactly once
Only a SHA-256 hash is stored, so a lost token cannot be recovered. Revoke it
from Settings → Tokens and mint a new one.
:::

Tokens obtained through the OAuth flow land in the same list and can be revoked
from the same place.

## Connecting Claude Code

Register the server by URL in `~/.claude.json` or your project config:

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

Restart the client. The `almanac` tools should appear under the `almanac`
server, and calling `ping` should return `{ok: true, …}`.

For **local dev with a PAT**, point at `http://localhost:4180/mcp` instead —
that's oauth2-proxy, which passes `/mcp` through to the MCP container. If you're
running the no-Docker script there's no proxy, so run the MCP server in stdio
transport against the local API; `scripts/local-dev/dev-noauth.sh` prints the
exact command on startup.

## Connecting Claude mobile and ChatGPT

Enter the server URL and let the client do the rest:

```
https://almanac.example.com/mcp
```

No token to paste. The client discovers Almanac's OAuth endpoints, opens a
browser for sign-in with whichever SSO provider you configured, and receives a
PAT as its access token. That token appears in Settings → Tokens like any other,
and survives container restarts because it lives in SQLite.

Behind the scenes the client runs the standard MCP OAuth 2.1 flow: discovery,
authorization server metadata, dynamic client registration, browser
authorization, provider callback, and token exchange. Only the last step is
Almanac-specific — the MCP server verifies the provider token, extracts the
email, checks it against the allowlist, and mints a real PAT. The
[Authentication](/guide/authentication#mcp-bypasses-sso) page has the details.

::: tip Registration is not persistent, and that's fine
Dynamically registered OAuth clients, pending authorization flows, short-lived
auth codes, and Streamable HTTP sessions are all held in memory and are lost on
restart. Clients re-register and re-authorize on their own, and a stale session
ID returns a 404 that prompts the client to start a new session with its
existing PAT. The only thing that has to survive a restart is the PAT itself,
and that's in the database.
:::

## Connecting Claude Desktop

Claude Desktop can use either path.

**With a PAT**, configure it the same way as Claude Code.

**With OAuth**, bridge through `mcp-remote`, which triggers the browser flow for
you:

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

## Verifying the connection

Before debugging a client, confirm the endpoint itself is reachable and
authenticating. A request with no token must be rejected:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  https://almanac.example.com/mcp
```

A `401` proves the route is wired and PAT validation is running. Repeat the same
request with `-H 'Authorization: Bearer alm_<your-token>'`.

| Status | Meaning |
| --- | --- |
| 2xx / 400 / 406 | Working. Auth and transport are alive. |
| 401 with a token | The PAT is wrong, revoked, or bound to a different user. |
| 404 | Wrong path. The MCP listener checks for `/mcp` exactly. |
| 502 | `almanac-mcp` is down. Check `docker compose logs almanac-mcp`. |

**2xx, 400, and 406 all indicate success here** — they prove the auth and
transport layers are alive. A barebones POST that doesn't advertise SSE in its
`Accept` header commonly gets 406, which is fine.

Once connected, tell the assistant what you ate in plain language — "two eggs,
toast and butter, and a flat white". It should estimate the calories and macros,
log them, and show you what it recorded. The meal then appears in the web UI and
via `get_macros_today`.

If a token authenticates as the wrong account, or sign-in works but Almanac
returns 403, see
[Authentication → Verifying and failure modes](/guide/authentication#verifying-and-failure-modes).

## Next steps

- [Architecture](/guide/architecture) — what happens after a tool call arrives
- [Authentication](/guide/authentication) — the server side of both auth paths
- [Configuration](/guide/configuration) — the MCP and OAuth variables
