# `almanac-realm.json` — annotated

This realm is a **teaching artifact** as much as a test fixture: read it to
learn Keycloak's client/broker/flow model, not just to make the
integration suite pass. It's imported by `scripts/local-dev/keycloak.sh`,
which copies the file to a temp dir and substitutes the
`__MCP_CLIENT_SECRET__` / `__WEB_CLIENT_SECRET__` placeholders with values
generated at runtime via `openssl rand -hex 32`. **Never put a real secret in
the tracked JSON.**

> **Why is this prose in a README and not in the JSON?** Keycloak's
> `--import-realm` deserializes strictly and rejects any unrecognized field at
> any nesting level, so the realm file can carry no comments of its own.

## Session lifetimes

```json
"ssoSessionIdleTimeout": 2592000,
"ssoSessionMaxLifespan": 2592000,
"ssoSessionIdleTimeoutRememberMe": 2592000,
"ssoSessionMaxLifespanRememberMe": 2592000
```

Tuned for a **personal app** used by one person on their own devices — not
Keycloak's out-of-the-box defaults (30 min idle / 10 h max), which would
force a single self-hoster to re-authenticate almost daily. `2592000` seconds
= 30 days for both idle and max lifespan, so a sign-in lasts roughly a month
of normal use before Keycloak asks again.

**If you deploy this realm shape for multiple users, or on a less-trusted
device fleet, lower these.** 30-day sessions are a deliberate convenience
trade-off for a single self-hoster, not a general recommendation.

## Clients: `almanac-mcp` and `almanac-web`

Both are `"publicClient": false` (confidential) — deliberately, and for the
same underlying reason even though they front different things:

- **`almanac-mcp`** is the backend service behind Almanac's MCP OAuth
  provider. It's a server-side component that can hold a secret safely and
  exchange it during the `authorization_code` flow.
- **`almanac-web`** is consumed by `oauth2-proxy`, which is *also*
  server-side and holds its own secret. A browser SPA with no backend would
  instead be a **public** client (no secret, PKCE-only) — a browser cannot
  keep anything confidential. Neither of these clients is that shape.

Both set `"directAccessGrantsEnabled": true`, which enables the OAuth2
Resource Owner Password Credentials grant. This exists **for the local
integration suite**: it lets a test obtain a genuinely-signed
`id_token` by POSTing a username/password directly to the token endpoint,
without driving a real browser through a redirect. It is a **test
convenience**, not how real users sign in — production user-facing flows go
through `"standardFlowEnabled": true` (`authorization_code` + PKCE).

### Redirect URIs — no wildcards

```json
"redirectUris": [
  "http://localhost:4180/oauth2/callback",
  "http://127.0.0.1:4180/oauth2/callback"
]
```

Keycloak (like any OIDC provider) matches `redirect_uri` by **exact string**
against this list at the authorization endpoint. An open or wildcarded
redirect is a classic OAuth vulnerability (it lets an attacker redirect the
authorization code or token to a URI they control). `localhost` and
`127.0.0.1` are both listed because browsers treat them as different origins
even though they resolve to the same host.

Both clients are normally reached through oauth2-proxy on `4180`, so both list
it: `/oauth2/callback` for the browser (`almanac-web`) and `/oauth/callback`
for MCP (`almanac-mcp`). The MCP callback is built from
`ALMANAC_MCP_PUBLIC_URL`, which is the origin users reach Almanac at — not the
MCP server's own port. `3030` is listed only for running the MCP server
directly, without a proxy in front.

Serve Almanac on any other port or host and you must add that exact callback
here, or authorization fails with `invalid_redirect_uri`.

## Identity providers: Google and GitHub (present but disabled)

```json
"enabled": false
```

Both broker stanzas are present so the shape of "how do I add a social login
to Keycloak" is discoverable by reading the file, but `enabled: false` means
importing this realm never tries to reach either provider or accept a live
sign-in. To actually turn one on:

1. Register an OAuth app on the provider's side first:
   - **Google** — Google Cloud Console → APIs & Services → Credentials → an
     OAuth 2.0 Client ID. Authorized redirect URI to register there:
     `http://localhost:8085/realms/almanac/broker/google/endpoint` (adjust
     host/port for a non-local deployment).
   - **GitHub** — Settings → Developer settings → OAuth Apps. Authorization
     callback URL to register there:
     `http://localhost:8085/realms/almanac/broker/github/endpoint`.
2. Paste the resulting client ID/secret into the matching `config` block in
   the realm (or via the Keycloak admin console), and flip `enabled: true`.

`trustEmail` differs between the two: `true` for Google, `false` for GitHub —
GitHub accounts can have unverified or private emails, so Keycloak is told
not to assume the email claim is verified.

## Account linking

Both identity providers use Keycloak's built-in `first broker login` flow. A
provider identity with no matching account creates one; a provider identity
whose email matches an existing account links to it, so one person keeps one
account whichever provider they signed in with.

Linking to an existing account asks you to prove you own it, either by email
confirmation or by entering that account's password. **This realm configures no
SMTP**, so the email option is unavailable and the password is the only route —
expect a password prompt the first time you link a provider to an account that
already exists. Configure `smtpServer` if you want the email path.

## No users baked into the file

`"users": []` — the seeded dev user is created at runtime by
`keycloak.sh` via `kcadm.sh`, keyed on the email argument you pass the
script, with a fixed dev password (`integration-dev-password`, see the
script's usage header — `oidc.integration.test.ts` hardcodes this exact
value). That keeps this file free of anything email-shaped and lets
`--reimport` work without also needing to re-seed a hardcoded identity.
