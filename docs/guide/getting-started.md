---
title: Getting started
---

# Getting started

Almanac is a log, and the value shows up when an assistant reads it back and tells you something you'd have missed on your own. So the target here isn't a running server, it's your data in the database with an AI reading it.

Start on your own machine with sign-in switched off, then add real authentication and a domain later, once you want it from your phone. Each step below exists because you outgrew the one before it.

::: tip Want a look before you commit?
`scripts/local-dev/demo.sh` seeds a throwaway instance with 40 days of invented data. Every panel fills up, nothing touches your real setup, and `rm -f /tmp/almanac-demo.sqlite*` deletes it afterward. Good for a five minute look, but not much beyond that, because the whole point is your own numbers.
:::

## Requirements

Node 20 or newer and pnpm 9 or newer. Docker matters later, when you add real sign-in, and not before. SQLite ships bundled inside `better-sqlite3`, so there's no database server to install or configure.

## 1. Run it

Almanac has two chat surfaces built into the web UI: a meal assistant that turns "chicken burrito bowl" into editable macros, and a coach that reads your logged history. Both run on your Anthropic key rather than your Claude subscription, so export it before you start, because `dev-noauth.sh` doesn't read `.env`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm install
scripts/local-dev/dev-noauth.sh you@example.com
```

Skip the key if you'd rather, in which case everything else works the same and those two panels stay hidden.

That's the whole setup: no `.env` file, no Docker, no OAuth client to register anywhere. The API and web server run on header-trust auth, which means the Vite dev proxy injects the same `x-forwarded-email` header oauth2-proxy sends in production, so the UI needs no login and acts as whatever address you passed it. Migrations run on boot, Ctrl-C stops both processes, and the script prints the URL to open.

## 2. Set up your profile

Almanac can't compute anything until it knows your timezone, date of birth, height, sex, units, and activity level. Fill those in first, then log a body weight, because a nutrition phase won't start without one and TDEE has nothing to anchor to.

Now start a phase: cut, bulk, or maintenance. Your TDEE begins as an estimate derived from the profile you just filled in, then calibrates toward a measured value across roughly two weeks of weigh-ins, so expect the early numbers to move around.

## 3. Connect your assistant

Mint a PAT under Settings, then Tokens. You see the cleartext once, so copy it immediately, then start the MCP server in a second terminal:

```bash
pnpm --filter @almanac/mcp dev
```

It listens on `http://127.0.0.1:3030/mcp` and checks the PAT itself, with no proxy in front. Point your client at it:

```json
{
  "mcpServers": {
    "almanac": {
      "type": "http",
      "url": "http://127.0.0.1:3030/mcp",
      "headers": {
        "Authorization": "Bearer alm_XXXXX"
      }
    }
  }
}
```

`/mcp` speaks Streamable HTTP, so the transport has to be `http`. A deployed instance uses this exact config shape, and only the URL changes. [Connecting assistants](/guide/connecting-assistants) walks through each client.

::: tip No MCP? The web panels do the same job
Adding a custom MCP server takes a paid tier on both Claude and ChatGPT, and phones can't reach a local instance at all. The two in-app chat panels sidestep both problems, running on the Anthropic key you exported in step 1. They're gated behind a per-user flag that starts at 0, so flip it once and reload the dashboard:

```bash
sqlite3 data/almanac.sqlite "UPDATE users SET llm_logging_enabled = 1 WHERE email = 'you@example.com';"
```

[Configuration](/guide/configuration#turning-the-ai-surfaces-on) has the MCP and API routes to the same flag.
:::

## 4. Talk to it

Here's the part worth getting to.

Say what you ate in plain language: "two eggs, toast and butter, and a flat white." It works out the calories and macros, logs them, and shows you what it recorded, and by the time you check the web UI the meal is already there.

Then start asking it things. How's my week looking? Am I actually in a deficit? What should I train today? The answers come off your logged numbers instead of generic advice, and they sharpen with every day you add.

## 5. Add real sign-in

Header-trust auth authenticates anyone who can reach the port as you, which is fine on one machine and stops being fine the moment you want Almanac from a second one.

<!--@include: ./_local-url-warning.md-->

Bring up the full stack with SSO sitting in front of it:

```bash
cp .env.example .env
# set your OAuth credentials, then:
scripts/local-dev/up.sh
```

`.env.example` documents every variable inline, and [Configuration](/guide/configuration) is the complete reference. Google is the default, though any provider works: GitHub needs a client ID and secret and nothing else, and any OpenID Connect issuer such as Keycloak, Authentik, or Zitadel works once you set an issuer URL. [Authentication](/guide/authentication) is the walkthrough.

| Service | Port | What it is |
| --- | --- | --- |
| `almanac-api` | `:3001` | Fastify API, trusts proxy headers |
| `almanac-web` | `:5173` | Vite dev server |
| `almanac-mcp` | `:3030` | Streamable HTTP + OAuth 2.1 |
| `oauth2-proxy` | `:4180` | Docker container, SSO |

`scripts/local-dev/down.sh` stops everything.

Your MCP config doesn't change here, because a PAT still authenticates it directly while oauth2-proxy gates the browser and leaves MCP alone. Once the full stack is up you can point at `http://localhost:4180/mcp` to go through the proxy the way a deployed instance does, though either address works.

## 6. Put it on a domain

A public HTTPS host is what makes Almanac reachable from your phone, and it's the only way Claude mobile and ChatGPT can connect at all. The [deploy runbook](/guide/deploy) covers DNS, TLS, nginx, OAuth, and first boot.

<!--@include: ./_paid-plan-warning.md-->

## Working on Almanac

`scripts/local-dev/screenshot.mjs` captures the running UI headlessly, driving your system Chrome through `playwright-core` so nothing downloads a bundled browser. Capture height doesn't depend on your display, so a full-page dashboard shot works fine on a laptop screen.

```bash
node scripts/local-dev/screenshot.mjs                        # full dashboard
node scripts/local-dev/screenshot.mjs --preset both          # desktop + mobile
node scripts/local-dev/screenshot.mjs --scene meal-lookup    # AI modal (real LLM call)
```

Output defaults to 984 px wide at 1×. `--scene` clicks a modal open before capturing, and `--help` lists what's available.

`demo.sh` takes `--days 90` for a longer history and `--lan` to bind `0.0.0.0` for phone testing. Unlike `dev-noauth.sh` it does source `.env`, so your `ANTHROPIC_API_KEY` reaches the AI panels without exporting anything.

::: warning Binding to the LAN
`--lan` on either script authenticates anyone on your network as that email. Only use it on a network you trust.
:::

## Next steps

[Connecting assistants](/guide/connecting-assistants) covers MCP clients and PATs in depth, [Configuration](/guide/configuration) lists every environment variable, [Deploy](/guide/deploy) is the production walkthrough, and [Architecture](/guide/architecture) explains how the MCP layer fits together.
