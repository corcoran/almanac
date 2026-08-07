---
title: Getting started
---

# Getting started

How to get Almanac running on your own machine. This page covers local
development — one command brings up the API, the web UI, the MCP server, and
the SSO proxy. For a public, TLS-terminated install on a server, see the
[deploy runbook](/guide/deploy).

## Requirements

- Node 20 or newer
- pnpm 9 or newer
- Docker (for production; optional for local dev)

SQLite ships bundled via `better-sqlite3`, so there is no database server to
install or configure.

## 1. Install

```bash
pnpm install
```

## 2. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` and set your OAuth credentials and dev email. `.env.example`
documents each variable inline; [Configuration](/guide/configuration) is the
full reference. The stack defaults to Google, but any provider works — GitHub
needs only a client ID and secret, and any OpenID Connect issuer (Keycloak,
Authentik, Zitadel) works by setting an issuer URL. See
[Authentication](/guide/authentication) for the walkthrough.

::: tip Skipping OAuth entirely
If you don't need a real sign-in path, you can skip this step and the whole
Docker layer. Jump to [Without Docker](#without-docker-no-oauth) below.
:::

## 3. Start everything

```bash
scripts/local-dev/up.sh
```

This starts:

| Service | Port | What it is |
| --- | --- | --- |
| `almanac-api` | `:3001` | Fastify API, trusts proxy headers |
| `almanac-web` | `:5173` | Vite dev server |
| `almanac-mcp` | `:3030` | Streamable HTTP + OAuth 2.1 |
| `oauth2-proxy` | `:4180` | Docker container, SSO |

Stop everything with `scripts/local-dev/down.sh`.

### Without Docker (no OAuth)

If you don't need a real sign-in path, skip `.env`, Docker, and
oauth2-proxy entirely:

```bash
scripts/local-dev/dev-noauth.sh you@example.com          # web on 127.0.0.1
scripts/local-dev/dev-noauth.sh you@example.com --lan    # web on 0.0.0.0 (other devices)
```

This runs the API and web with **header-trust auth**: the Vite dev proxy injects
the `x-forwarded-email` header that oauth2-proxy would emit in production, so
the UI needs no login and acts as the email you pass. Migrations run
automatically on API boot. Ctrl-C stops both.

::: warning The `--lan` caveat
Binding the web server to `0.0.0.0` means anyone on your network is
authenticated as that email. Use it only on a trusted network.
:::

For **MCP** in this mode, run it in stdio transport against the local API — mint
a PAT in the web Settings panel first. The script prints the exact command on
startup.

### Demo instance (populated with fake data)

To see the UI fully populated — every panel non-empty, both AI surfaces
unlocked — without touching your real data:

```bash
scripts/local-dev/demo.sh              # 127.0.0.1
scripts/local-dev/demo.sh --lan        # LAN, for phone testing
scripts/local-dev/demo.sh --days 90    # longer history
```

This seeds a throwaway SQLite file and runs the API and web on `:3099` /
`:5199`, so it can run alongside your normal dev stack. The data is anchored
relative to today — an active cut phase, 40 days of meals, weigh-ins, sleep,
steps, and a PPL split with session history — so it never goes stale.

It sources `.env` for `ANTHROPIC_API_KEY`; without one the UI still renders but
the AI panels report `llm_available: false`. Ctrl-C stops it, and
`rm -f /tmp/almanac-demo.sqlite*` deletes the data.

### Screenshots

`scripts/local-dev/screenshot.mjs` captures the running UI headlessly, driving
your system Chrome via `playwright-core` (no bundled browser download). Capture
height is independent of your display, so a full-page dashboard shot works on
any screen:

```bash
node scripts/local-dev/screenshot.mjs                        # full dashboard
node scripts/local-dev/screenshot.mjs --preset both          # desktop + mobile
node scripts/local-dev/screenshot.mjs --scene meal-lookup    # AI modal (real LLM call)
```

Defaults to 984 px wide at 1×. `--scene` clicks a modal open before capturing;
`--help` lists the available scenes.

## 4. Connect Claude Code to MCP

Register the MCP server by URL:

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

For local dev with a PAT, point at `http://localhost:4180/mcp`. For
OAuth-capable clients (Claude mobile, ChatGPT), use the public URL on its own —
the OAuth flow handles the rest.

[Connecting assistants](/guide/connecting-assistants) covers minting a token and
wiring up each client in detail, including the constraints below.

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

## 5. Verify

Open Claude Code. The `almanac` tools should show up under the `almanac` server.
Tell Claude what you ate in plain language — "two eggs, toast and butter, and a
flat white" — and it should estimate the calories and macros itself, log them,
and show you what it recorded. The meal then appears in the web UI and via
`get_macros_today`.

## Next steps

- [Configuration](/guide/configuration) — every environment variable
- [Connecting assistants](/guide/connecting-assistants) — MCP clients and PATs
- [Deploy](/guide/deploy) — the production walkthrough
- [Architecture](/guide/architecture) — how the MCP layer works
