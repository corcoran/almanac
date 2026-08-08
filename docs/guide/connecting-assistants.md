---
title: Connecting assistants
---

# Connecting assistants

How to point an AI assistant at your Almanac instance. There are two ways in,
and both end at the same artifact: a Personal Access Token (PAT) that the API
validates on every request.

- With OAuth 2.1, the client discovers Almanac's OAuth server, walks you
  through sign-in, and receives a token automatically. Claude mobile and
  ChatGPT work this way.
- With a manual PAT, you mint a token in the web Settings panel and paste it
  into the client config. Claude Code and any client that supports a static
  bearer token work this way.

This page covers the client side. For how the two paths are implemented on the
server, including the proxy routing, the three-layer allowlist, and the auth
failure modes, see [Authentication](/guide/authentication).

## Which path do you need?

| Client | Path | What you enter |
| --- | --- | --- |
| Claude mobile | OAuth 2.1 | the `/mcp` URL |
| ChatGPT | OAuth 2.1 | the `/mcp` URL |
| Claude Code | Manual PAT | the `/mcp` URL + a `Bearer alm_…` header |
| Claude Desktop | Either | the `/mcp` URL, via `mcp-remote` for the OAuth flow |

<!--@include: ./_local-url-warning.md-->

<!--@include: ./_paid-plan-warning.md-->

## Minting a PAT

1. Sign in to the web UI at `https://almanac.example.com`.
2. Open the user menu (top-right) → **Settings** → **Tokens**.
3. Click **Create token** and name it after the client: "Claude Code", "Claude
   Desktop".
4. Copy the cleartext token. It starts with `alm_`.

::: danger The cleartext is shown exactly once
Only a SHA-256 hash is stored, so a lost token cannot be recovered. Revoke it
from Settings → Tokens and mint a new one.
:::

Tokens obtained through the OAuth flow land in the same list and can be revoked
from the same place.

## Connecting Claude Code

```bash
claude mcp add --transport http almanac https://almanac.example.com/mcp \
  --header "Authorization: Bearer alm_XXXXX"
```

`/mcp` speaks **Streamable HTTP**, so the transport must be `http`. Registering
it as `sse` (a different protocol that opens with a `GET` and posts to a
separate endpoint) fails with `HTTP 405`, however valid your token is.

Or write the same thing into `~/.claude.json` (or your project config) by hand:

```json
{
  "mcpServers": {
    "almanac": {
      "type": "http",
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

For **local dev with a PAT**, point at `http://localhost:4180/mcp` instead:
that's oauth2-proxy, which passes `/mcp` through to the MCP container. Without
the proxy, run `pnpm --filter @almanac/mcp dev` and point at
`http://127.0.0.1:3030/mcp`: `http` is the default transport and the MCP server
validates the PAT itself, so the config shape doesn't change.

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
Almanac-specific: the MCP server verifies the provider token, extracts the
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

<!--@include: ./_mcp-probe.md-->

Once connected, tell the assistant what you ate in plain language: "two eggs,
toast and butter, and a flat white". It should estimate the calories and macros,
log them, and show you what it recorded. The meal then appears in the web UI and
via `get_macros_today`.

## Next steps

- [Architecture](/guide/architecture): what happens after a tool call arrives
- [Authentication](/guide/authentication): the server side of both auth paths
- [Configuration](/guide/configuration): the MCP and OAuth variables
