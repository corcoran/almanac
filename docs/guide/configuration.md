---
title: Configuration
---

# Configuration

Every environment variable Almanac reads, grouped by subsystem. `.env.example`
carries the same set with inline commentary; this page is the reference.

Local dev reads `.env` directly. In production, `docker-compose.yml` forwards
the relevant variables from the host `.env` into each container — several are
pinned by Compose rather than taken from your file, and those are called out
below.

## Core

Read by the API. `ALMANAC_API_URL` is read by the MCP server.

| Variable | Purpose | Required when |
| --- | --- | --- |
| `ALMANAC_DB_PATH` | SQLite file location. Defaults to `./data/almanac.sqlite`, relative to the API package — set it explicitly when running outside `up.sh`. | always |
| `ALMANAC_API_PORT` / `ALMANAC_API_HOST` | Where the API listens. Defaults `3001` and `127.0.0.1`. | always |
| `ALMANAC_API_URL` | Base URL the MCP server uses to reach the API. Defaults `http://127.0.0.1:3001`. | always |
| `ALMANAC_TRUST_PROXY_HEADERS` | API trusts `X-Forwarded-Email` from oauth2-proxy. Defaults `false`; must be the literal `true` to enable that auth path. | behind a proxy |
| `ALMANAC_ALLOWED_EMAILS` | Email allowlist — a file path (one email per line) or a comma-separated list. Shared by the API and the MCP server. Empty means any authenticated email is allowed. | production |
| `ALMANAC_WEB_PORT` | Port the Vite dev server binds. Defaults `5173`. Set it when running two stacks side by side. | local dev |
| `ALMANAC_DEV_EMAIL` | Email the Vite dev proxy injects as `X-Forwarded-Email`. The API auto-provisions this user. | local dev |
| `ALMANAC_LOG_LEVEL` | Pino level override — one of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. Unset uses debug in dev, info in production. | optional |

::: tip Compose pins three of these
On the `almanac-api` service, `docker-compose.yml` hardcodes
`ALMANAC_TRUST_PROXY_HEADERS=true` and
`ALMANAC_ALLOWED_EMAILS=/emails/allowed-users.txt`, and passes
`ALMANAC_LOG_LEVEL` through from your host `.env`. Setting the first two in
`.env` has no effect in production.
:::

The allowlist is enforced at three independent layers, all reading the same
file. See [Authentication → The allowlist is enforced three times](/guide/authentication#the-allowlist-is-enforced-three-times).

## MCP

Read by the MCP server.

| Variable | Purpose | Required when |
| --- | --- | --- |
| `ALMANAC_MCP_TRANSPORT` | `stdio`, `http`, or `sse` (legacy, deprecated — emits a startup warning). Defaults to `http`. | always |
| `ALMANAC_MCP_PORT` / `ALMANAC_MCP_HOST` | Where the MCP server listens. HTTP and SSE only; ignored under stdio. Defaults `3030` and `127.0.0.1`. | http/sse |
| `ALMANAC_MCP_CLIENT_TOKEN` | Static PAT the MCP process uses for its own API calls. Consumed **only** under `stdio` — stdio has no incoming request to read a bearer from, so this is the process's identity. Boot fails if it's missing under stdio. | stdio |

Under `http` and `sse`, each client connection brings its own bearer in the
`Authorization` header, validated by the API against `personal_access_tokens`.
`ALMANAC_MCP_CLIENT_TOKEN` is unread in those modes.

Compose pins the MCP service to `ALMANAC_MCP_TRANSPORT=http`,
`ALMANAC_MCP_HOST=0.0.0.0`, `ALMANAC_MCP_PORT=3030`, and
`ALMANAC_API_URL=http://almanac-api:3001`.

## OAuth 2.1 (MCP + browser SSO)

The stack ships configured for Google as the SSO provider, so the variables
below name Google credentials. oauth2-proxy also supports GitHub, GitLab, and
any generic OIDC provider — swap `--provider` in `docker-compose.yml` and supply
that provider's client ID and secret in the same variables. See
[Authentication → Using a different provider](/guide/authentication#using-a-different-provider).

| Variable | Purpose | Required when |
| --- | --- | --- |
| `OAUTH2_PROXY_CLIENT_ID` | OAuth client ID, shared by oauth2-proxy and MCP | production |
| `OAUTH2_PROXY_CLIENT_SECRET` | OAuth client secret | production |
| `OAUTH2_PROXY_COOKIE_SECRET` | oauth2-proxy session cookie encryption key. Generate fresh; never reuse one across deployments. | production |
| `OAUTH2_PROXY_REDIRECT_URL` | oauth2-proxy callback URL (`https://<domain>/oauth2/callback`) | production |
| `ALMANAC_MCP_OAUTH_CLIENT_ID` | Client ID for the MCP OAuth flow. Compose defaults it to `${OAUTH2_PROXY_CLIENT_ID}`. | MCP OAuth mode |
| `ALMANAC_MCP_OAUTH_CLIENT_SECRET` | Client secret for the MCP OAuth flow. Compose defaults it to `${OAUTH2_PROXY_CLIENT_SECRET}`. | MCP OAuth mode |
| `ALMANAC_MCP_PUBLIC_URL` | Public origin for the MCP OAuth issuer (`https://<domain>`), also used to build the provider redirect URI | MCP OAuth mode |

Leave the three `ALMANAC_MCP_OAUTH_*` / `ALMANAC_MCP_PUBLIC_URL` values blank to
run the MCP server in **PAT-only mode** — no OAuth discovery endpoints, manual
token required. A blank `ALMANAC_MCP_PUBLIC_URL` is treated as unset rather than
failing URL validation, which is what lets Compose pass `${…:-}` safely.

Two redirect URIs must be registered with the provider: one for oauth2-proxy's
web SSO and one for the MCP OAuth flow. The walkthrough is in
[Authentication → Creating the Google OAuth client](/guide/authentication#creating-the-google-oauth-client).

## Deploy-only

Read by `docker-compose.yml`, not by application code.

| Variable | Purpose | Default |
| --- | --- | --- |
| `ALMANAC_IMAGE_OWNER` | GHCR namespace Compose pulls images from. Set this if you fork the repo and publish your own images. | `corcoran` |
| `ALMANAC_TAG` | Image tag to run. Pin it to a version to roll back to a specific release. | `latest` |

Rolling back with `ALMANAC_TAG` is covered in
[Operations → If a deploy goes wrong](/guide/operations#if-a-deploy-goes-wrong).

## Watchtower auto-deploy notifications

Deploy-only and optional. The `watchtower` Compose service emails on container
updates and errors via shoutrrr SMTP. Set `WATCHTOWER_EMAIL_TO` to turn
notifications on; leave it blank and watchtower runs silently.

| Variable | Purpose | Default |
| --- | --- | --- |
| `WATCHTOWER_EMAIL_TO` | Recipient. Blank turns notifications off. | unset (silent) |
| `WATCHTOWER_EMAIL_FROM` | Sender address | `watchtower@almanac.example.com` |
| `WATCHTOWER_EMAIL_SERVER` | SMTP host | `mail.example.com` |
| `WATCHTOWER_EMAIL_PORT` | SMTP port | `25` |
| `WATCHTOWER_EMAIL_HELO` | HELO/EHLO hostname | `almanac.example.com` |

::: warning `WATCHTOWER_EMAIL_HELO` must be an FQDN
A strict postfix rejects shoutrrr's `localhost` default with
`504 5.5.2 … need fully-qualified hostname`. The Compose default supplies an
FQDN, but it is an example domain — set your own.
:::

Watchtower's own behavior flags (`WATCHTOWER_LABEL_ENABLE`, `WATCHTOWER_CLEANUP`,
`WATCHTOWER_POLL_INTERVAL`, and the `WATCHTOWER_NOTIFICATION*` set) are
hardcoded in `docker-compose.yml` and are not meant to be overridden from
`.env`. See [Operations → Auto-deploy (watchtower)](/guide/operations#auto-deploy-watchtower).

## LLM / AI surfaces

Optional, and read by the API only. Both AI surfaces — the **AI Meal Assistant**
and the **AI insights coach** — are gated behind the same `ALMANAC_LLM_ENABLED`
switch (off by default), so they stay dark until explicitly turned on. The
production `docker-compose.yml` already forwards these from the host `.env` to
the `almanac-api` service.

The two surfaces use **separate models**: meal parsing is a cheap extraction
task and stays on Haiku, while the coach does harder multi-signal reasoning and
defaults to Sonnet.

**Anthropic is currently the only supported provider.** `ALMANAC_LLM_PROVIDER`
exists as a seam and is validated at boot, but `anthropic` is the only accepted
value — anything else fails fast rather than silently misbehaving. Adding
another provider means implementing one branch behind that seam; it's a
plausible future change, not something that works today.

| Variable | Purpose | Default |
| --- | --- | --- |
| `ALMANAC_LLM_ENABLED` | Master switch for both AI surfaces (meal chat + insights coach) | `false` |
| `ANTHROPIC_API_KEY` | Anthropic key. Without it both AI surfaces are hidden (`llm_available=false`). | — |
| `ALMANAC_LLM_PROVIDER` | Provider seam. Only `anthropic` is supported; any other value fails at boot. | `anthropic` |
| `ALMANAC_LLM_MODEL` | Model for the **meal assistant** (the cheap parser) | `claude-haiku-4-5` |
| `ALMANAC_LLM_INSIGHTS_MODEL` | Model for the **insights coach** — harder reasoning, so a stronger default | `claude-sonnet-4-6` |
| `ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT` | Soft daily token limit — drives the "~N logs left" indicator; warns but never blocks | unset (no soft limit) |
| `ALMANAC_LLM_HARD_DAILY_TOKEN_CAP` | Hard daily token ceiling — a 429 circuit-breaker | unset (no hard cap) |
| `ALMANAC_LLM_TOKENS_PER_SEARCH` | Flat token charge per web search when there's no recent search history to average | `2500` |
| `ALMANAC_LLM_HARD_DAILY_SEARCH_CAP` | Max web searches per user-local day. At the cap, search is disabled for the turn but meals still log. | unset (uncapped) |

::: warning `ALMANAC_LLM_PROVIDER` has no effect under Compose
It is read by the application (`packages/core/src/llm/config.ts`) but
`docker-compose.yml` does not forward it into the `almanac-api` container, so
setting it in `.env` changes nothing on a Compose deployment. That is harmless
today — `anthropic` is the only accepted value, and it is already the default.
The variable becomes live if a second provider is ever implemented behind the
seam.
:::

### What it costs

**This runs on your own API key, so the AI surfaces cost real money per use.**
Two things keep that small. The cheaper model does the high-volume work — meal
parsing on Haiku, with only the coach reaching for Sonnet — and the system
prompts are split so the large stable part is served from Anthropic's 1-hour
prompt cache instead of being re-billed on every turn.

In practice, dogfooding over a couple of months, **an active user costs roughly
5–10¢ on a day they use it** — nothing on days they don't. Your mileage will
vary with usage and current model pricing, so treat that as an order of
magnitude, not a quote.

### The guardrails

`ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT` drives the visible "~N logs left"
counter, `ALMANAC_LLM_HARD_DAILY_TOKEN_CAP` is a real circuit breaker that
starts returning 429s, and `ALMANAC_LLM_HARD_DAILY_SEARCH_CAP` bounds web
searches specifically. All three are per-user-per-day, and an admin can override
the limit for one person with `admin_set_user_daily_limit`.

::: danger Left unset, there is no cap
That's deliberate, but worth knowing before you invite other people.
:::

Each of the numeric limits treats an empty string as unset. That matters in
production, where Compose passes `"${VAR:-}"` and an unset variable arrives as
`""` rather than absent — without that coercion a blank cap would parse as `0`,
fail validation, and crashloop the API at boot.

## Turning the AI surfaces on

`ALMANAC_LLM_ENABLED=true` and an `ANTHROPIC_API_KEY` are necessary but not
sufficient. **Both AI surfaces stay hidden until a per-user flag is also set**,
and there is no toggle for it in the web UI — the dashboard only reads the flag
to decide whether to show the chat entry points.

::: warning The chat buttons won't appear until you do this
The web UI shows the meal assistant and insights coach only when whoami reports
`llm_logging_enabled = 1` **and** `llm_available = true`. The env vars give you
the second; the per-user flag gives you the first. Setting only the env vars
looks like nothing happened.
:::

Pick whichever you have in front of you.

**Through an assistant (MCP).** The flag is keyed by user id, not email, so
list first:

```
admin_list_users
admin_set_user_llm_access  user_id=<id>  enabled=true
```

`admin_list_users` returns every user with their id, email, LLM access flag,
daily token limit, and admin flag. Both tools are admin-only and the API
enforces it — a non-admin's call is rejected by the route, not just hidden.

**Through the API**, if you already know the id:

```bash
curl -X PATCH https://almanac.example.com/api/v1/admin/users/<id> \
  -H "Authorization: Bearer alm_…" \
  -H "Content-Type: application/json" \
  -d '{"llm_logging_enabled": 1}'
```

The flag is `1` or `0`, not `true`/`false` — the body schema is strict and
rejects booleans. (The MCP tool above takes `enabled=true` and converts.)

**Directly in SQLite**, which is the one path that takes an email:

```bash
sqlite3 "$ALMANAC_DIR/data/almanac.sqlite" \
  "UPDATE users SET llm_logging_enabled = 1 WHERE email = 'you@example.com';"
```

Verify it took, whichever route you used:

```bash
sqlite3 "$ALMANAC_DIR/data/almanac.sqlite" \
  "SELECT email, llm_logging_enabled FROM users;"
```

Reload the dashboard and the chat entry points appear.

### Web search needs one more switch

Web search is enabled per-organization in the [Anthropic
Console](https://console.anthropic.com/) under **Settings → Privacy**. Until
it's on there, the AI surfaces still work — searches just fail.

Searches draw a **flat charge** from the same daily token budget
(`ALMANAC_LLM_TOKENS_PER_SEARCH`, default `2500`). The real token cost is still
recorded for accounting; the budget is billed the flat amount.

## Next steps

- [Getting started](/guide/getting-started) — install and run locally
- [Deploy](/guide/deploy) — where these variables get written on a server
- [Authentication](/guide/authentication) — the OAuth variables in context
- [Operations](/guide/operations) — updates, backups, recovery
