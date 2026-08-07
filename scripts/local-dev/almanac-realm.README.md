# `almanac-realm.json` — annotated

This realm is a **teaching artifact** as much as a test fixture: read it to
learn Keycloak's client/broker/flow model, not just to make the
integration suite pass. It's imported by `scripts/local-dev/keycloak.sh`,
which copies the file to a temp dir and substitutes the
`__MCP_CLIENT_SECRET__` / `__WEB_CLIENT_SECRET__` placeholders with values
generated at runtime via `openssl rand -hex 32`. **Never put a real secret in
the tracked JSON.**

> **Why is this prose in a README and not `"_comment"` keys in the JSON?**
> JSON has no comment syntax, and the brief's original plan was to carry
> explanatory prose in `"_comment"` / `"_comment_<topic>"` top-level keys,
> since Keycloak's admin REST API generally ignores unknown fields on most
> resources. **It doesn't for realm import.** Verified live against
> `quay.io/keycloak/keycloak:26.7.1`: `--import-realm` deserializes the file
> with Jackson in strict mode, and it rejects **any** unrecognized field —
> not just top-level ones, at every nesting level (client objects, IdP
> configs, etc) — with `UnrecognizedPropertyException` and a failed
> container boot. So all the "why" lives here instead.

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
integration suite** (Task 6): it lets a test obtain a genuinely-signed
`id_token` by POSTing a username/password directly to the token endpoint,
without driving a real browser through a redirect. It is a **test
convenience**, not how real users sign in — production user-facing flows go
through `"standardFlowEnabled": true` (`authorization_code` + PKCE).

### Redirect URIs — no wildcards

```json
"redirectUris": [
  "http://localhost:3030/oauth/callback",
  "http://127.0.0.1:3030/oauth/callback"
]
```

Keycloak (like any OIDC provider) matches `redirect_uri` by **exact string**
against this list at the authorization endpoint. An open or wildcarded
redirect is a classic OAuth vulnerability (it lets an attacker redirect the
authorization code or token to a URI they control). `localhost` and
`127.0.0.1` are both listed because browsers treat them as different origins
even though they resolve to the same host.

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
not to assume the email claim is verified. That's exactly what the
account-linking flow below is for.

## Account linking by verified email

Both identity providers point `firstBrokerLoginFlowAlias` at
`almanac-first-broker-login`, a custom (non-built-in) authentication flow
defined in `authenticationFlows`. It's a copy of Keycloak's built-in "first
broker login" flow with one behavioral change: instead of always creating a
new user for a new IdP identity, it links to an **existing** account when one
already exists with the same verified email (via the `idp-confirm-link` +
`idp-email-verification` executions, chained through the nested sub-flows).

**Net effect:** if a user first signs up via Google as `jane@example.com`,
then later authenticates via GitHub with that same verified
`jane@example.com`, Keycloak links the GitHub identity to the **existing**
account instead of creating a second one. One person, one account, regardless
of which provider they used that day.

## No users baked into the file

`"users": []` — the seeded dev user is created at runtime by
`keycloak.sh` via `kcadm.sh`, keyed on the email argument you pass the
script, with a fixed dev password (`integration-dev-password`, see the
script's usage header — `oidc.integration.test.ts` hardcodes this exact
value). That keeps this file free of anything email-shaped and lets
`--reimport` work without also needing to re-seed a hardcoded identity.
