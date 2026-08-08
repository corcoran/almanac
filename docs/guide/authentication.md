---
title: Authentication
---

# Authentication

Almanac has no password database and no login form. Every browser session is
authenticated by an external OAuth provider through
[oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/), and every machine
client (Claude, ChatGPT, anything speaking MCP) authenticates with a personal
access token minted from the web UI.

This page covers the part the deploy runbook assumes you already have: creating
the OAuth client in Google Cloud Console, mapping its values onto Almanac's
environment variables, and diagnosing the handful of ways it goes wrong. Google
is the default rather than a requirement: [Using a different
provider](#using-a-different-provider) covers GitHub, any OIDC provider, and
running your own.

Work through it between [Step 4 and Step 6 of the deploy
runbook](/guide/deploy), since you need the client ID and secret before you
write `.env`.

## How auth fits together

Four containers run in the Compose stack, and **only oauth2-proxy binds a host
port** (`127.0.0.1:24180`). The API, MCP server, and web SPA use `expose:`, so
they are reachable only from inside the Docker network. That isolation is
load-bearing: the API trusts the `X-Forwarded-Email` header, so anything that
could reach the API directly could claim any identity.

```
Internet
   |
 host nginx (:443, TLS)
   |
 oauth2-proxy (127.0.0.1:24180 -> :4180)
   |
   ├── /mcp                   ──> almanac-mcp:3030   (skip-auth, PAT validated by the API)
   ├── /.well-known/          ──> almanac-mcp:3030   (skip-auth, OAuth discovery)
   ├── /authorize /token      ──> almanac-mcp:3030   (skip-auth, MCP OAuth 2.1)
   ├── /register /revoke      ──> almanac-mcp:3030   (skip-auth, MCP OAuth 2.1)
   ├── /oauth/                ──> almanac-mcp:3030   (skip-auth, provider callback)
   ├── /api/v1/health         ──> almanac-api:3001   (skip-auth, public probe)
   ├── /api/                  ──> almanac-api:3001   (SSO for browsers, PAT for machines)
   └── /                      ──> almanac-web:80     (SSO, serves the SPA)
```

### Browsers go through SSO

A browser request to any non-skipped path hits oauth2-proxy first. With no valid
session cookie it is redirected to Google; after sign-in, oauth2-proxy sets a
session cookie (`--cookie-expire=720h`, so 30 days) and forwards the request
upstream with `--set-xauthrequest=true` and `--pass-user-headers=true`. The API
reads the resulting `x-forwarded-email` header and resolves it to a user row.

The API only trusts that header when `ALMANAC_TRUST_PROXY_HEADERS=true`, which
Compose sets for `almanac-api`. Running the API without a proxy in front leaves
the header path off, so identity can't be spoofed with a request header.

### MCP bypasses SSO

Machine clients cannot complete an interactive browser login, so oauth2-proxy is
told to let their traffic through untouched:

```
--skip-auth-route=^/mcp
```

Nothing is unauthenticated as a result: the MCP server and the API do their own
validation. Every `/mcp` request carries `Authorization: Bearer alm_…`, and the
API checks that token against the `personal_access_tokens` table.

The MCP OAuth 2.1 endpoints (`/.well-known/`, `/authorize`, `/token`,
`/register`, `/revoke`, `/oauth/`) are skipped for the same reason: they are
Almanac's own OAuth server and must be publicly reachable.

The skip rule is anchored at `^/oauth/`, so a custom
`ALMANAC_MCP_OAUTH_CALLBACK_PATH` **must stay under `/oauth/`**. A path outside
it passes validation but gets intercepted by oauth2-proxy, and sign-in never
completes.

### The allowlist is enforced three times

One file, `allowed-users.txt`, one email per line, is read by three
independent components:

| Layer | How it reads the file | What it gates |
| --- | --- | --- |
| oauth2-proxy | `--authenticated-emails-file=/emails/allowed-users.txt` | browser sign-in |
| `almanac-api` | `ALMANAC_ALLOWED_EMAILS=/emails/allowed-users.txt` | auto-provisioning a new user row |
| `almanac-mcp` | `ALMANAC_ALLOWED_EMAILS=/emails/allowed-users.txt` | completing the MCP OAuth 2.1 flow |

Compose mounts the same host file read-only into all three containers. An email
absent from it cannot sign in through the browser, cannot have an account
created for it, and cannot finish an MCP OAuth flow.

An empty or unreadable list means "allow any authenticated email": the provider
is then your only gate.

<!--@include: ./_allowlist-revoke-warning.md-->

### Everything converges on one token format

Both auth paths end at the same artifact: a PAT prefixed `alm_`, stored as a
SHA-256 hash in SQLite. An OAuth-capable client that completes the MCP OAuth 2.1
flow receives a real PAT as its access token, the same kind of token you would
paste by hand. That is why tokens obtained through either route show up in
Settings → Tokens and can be revoked there.

## Creating the Google OAuth client

You need one OAuth client. Both oauth2-proxy and Almanac's MCP OAuth server use
it, with two different redirect URIs registered on it.

Throughout, replace `almanac.example.com` with your own domain.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and sign in
   with the account that should own the OAuth client. This does not have to be
   the account you use Almanac with.

2. **Create or select a project.** Use the project picker in the top bar →
   **New Project**. The name is internal; something like `almanac` is fine. Wait
   for it to finish creating, then make sure it is the selected project before
   continuing.

3. **Configure the OAuth consent screen.** Navigate to **APIs & Services → OAuth
   consent screen**.
   - **User type: External.** Internal is only available on Google Workspace
     domains and restricts sign-in to that domain. External works for personal
     Gmail accounts.
   - **App name**: shown on the Google consent screen when you sign in. Use
     something you'll recognize, e.g. `Almanac`.
   - **User support email**: your own address.
   - **Developer contact information**: your own address again.
   - **Scopes**: add none. Almanac requests only `openid` and `email`, which
     Google treats as non-sensitive defaults and does not require you to declare
     here. Adding scopes only creates a verification burden.
   - **Test users**: if the app stays in "Testing" status, only the addresses
     listed here can sign in. Add every address that will use the instance, or
     publish the app. For a personal deployment, leaving it in Testing with your
     own address added is the simplest option.

4. **Create the client.** Navigate to **APIs & Services → Credentials** →
   **Create Credentials** → **OAuth client ID**.

5. **Application type: Web application.** Give it a name (internal only).

6. **Add the authorized redirect URIs.** Under **Authorized redirect URIs**, add
   these two, exactly:

   ```
   https://almanac.example.com/oauth2/callback
   https://almanac.example.com/oauth/callback
   ```

   The first is oauth2-proxy's browser SSO callback and must match
   `OAUTH2_PROXY_REDIRECT_URL` character-for-character. The second is the MCP
   OAuth 2.1 callback, built from `ALMANAC_MCP_PUBLIC_URL` plus
   `ALMANAC_MCP_OAUTH_CALLBACK_PATH`, which defaults to `/oauth/callback`. You
   only need the second if you want Claude mobile or ChatGPT to connect by URL;
   without it, PAT-based clients still work.

   Google compares redirect URIs by exact string, including scheme, host,
   port, path, and trailing slash. `http` vs `https`, or a trailing `/`, is a
   mismatch.

   ::: tip Rehearsing locally
   `scripts/local-dev/up.sh` runs oauth2-proxy on `http://localhost:4180`. To use
   the real Google flow locally, also register
   `http://localhost:4180/oauth2/callback` and
   `http://localhost:4180/oauth/callback` on the same client.
   :::

7. **Copy the client ID and client secret.** Google shows both once on creation;
   the ID stays visible in Credentials afterwards, and the secret can be
   re-downloaded from the client's detail page. These go straight into `.env` in
   the next section.

## Console values → environment variables

Written into `.env` on the server (deploy runbook Step 6):

| Google Cloud Console | Environment variable | Also used by |
| --- | --- | --- |
| OAuth client ID | `OAUTH2_PROXY_CLIENT_ID` | MCP OAuth 2.1 (`ALMANAC_MCP_OAUTH_CLIENT_ID`) |
| OAuth client secret | `OAUTH2_PROXY_CLIENT_SECRET` | MCP OAuth 2.1 (`ALMANAC_MCP_OAUTH_CLIENT_SECRET`) |
| Authorized redirect URI | `OAUTH2_PROXY_REDIRECT_URL` | must match exactly |
| *(not from the console)* | `OAUTH2_PROXY_COOKIE_SECRET` | generate fresh; never reuse |

`docker-compose.yml` defaults `ALMANAC_MCP_OAUTH_CLIENT_ID` and
`ALMANAC_MCP_OAUTH_CLIENT_SECRET` to the `OAUTH2_PROXY_*` values, so with
Google, where one client serves both consumers, setting the two
`OAUTH2_PROXY_*` variables is enough. Set the `ALMANAC_MCP_OAUTH_*` pair
explicitly when your provider wants two separate clients.

The MCP server also needs its public origin, plus the OIDC issuer it delegates
sign-in to:

```
ALMANAC_MCP_PUBLIC_URL=https://almanac.example.com
ALMANAC_MCP_OIDC_ISSUER=https://accounts.google.com
```

The public origin is the OAuth issuer Almanac advertises to MCP clients, and the
base it prepends to `ALMANAC_MCP_OAUTH_CALLBACK_PATH` to build the redirect URI
it sends your provider. `ALMANAC_MCP_OIDC_ISSUER` is where Almanac fetches
`/.well-known/openid-configuration` to learn the provider's authorization,
token, and JWKS endpoints: nothing about the provider is hardcoded.

Those four (issuer, client ID, client secret, public URL) must be set together
or all left blank. All blank runs the MCP server in PAT-only mode, with no OAuth
discovery endpoints. A partial set fails at boot naming what's missing, rather
than quietly behaving like an intentional PAT-only deployment.

Generate the cookie secret fresh. Do not reuse one from another deployment, and
do not commit it:

```bash
python -c 'import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'
```

A complete OAuth block in `.env` looks like:

```bash
OAUTH2_PROXY_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
OAUTH2_PROXY_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
OAUTH2_PROXY_COOKIE_SECRET=<output of the command above>
OAUTH2_PROXY_REDIRECT_URL=https://almanac.example.com/oauth2/callback
ALMANAC_MCP_PUBLIC_URL=https://almanac.example.com
ALMANAC_MCP_OIDC_ISSUER=https://accounts.google.com
```

## Using a different provider

Almanac's identity model is **an email address**. The API reads
`x-forwarded-email`, resolves or provisions a user row, and never asks how that
address was proven. Both auth layers in front of it are configurable, so the
provider is a `.env` choice rather than a fork.

Four options, in order of how many people want them. **Most self-hosters should
stop after the first or second**: you do not need to run an identity server to
use Almanac.

### 1. Google (the default)

Nothing to change. Leave `OAUTH2_PROXY_PROVIDER` unset and set
`ALMANAC_MCP_OIDC_ISSUER=https://accounts.google.com`. The [Google OAuth client
walkthrough](#creating-the-google-oauth-client) above is the whole setup.

### 2. GitHub (browser SSO, no infrastructure)

oauth2-proxy has a dedicated GitHub provider. Register an OAuth app under
**Settings → Developer settings → OAuth Apps** with the authorization callback
URL `https://almanac.example.com/oauth2/callback`, then:

```bash
OAUTH2_PROXY_PROVIDER=github
OAUTH2_PROXY_CLIENT_ID=<github oauth app client id>
OAUTH2_PROXY_CLIENT_SECRET=<github oauth app client secret>
OAUTH2_PROXY_REDIRECT_URL=https://almanac.example.com/oauth2/callback
```

No `--scope` flag is needed: oauth2-proxy's GitHub provider already defaults to
`user:email read:org`, which is what supplies the email.

::: warning GitHub only emits an email that is verified and primary
oauth2-proxy's GitHub provider populates the email header only when the address
is both **verified** and marked **primary** on the GitHub account. A user whose
email is private, or whose primary address is unverified, arrives with an empty
header and Almanac returns 401. Confirm the account has a verified primary email
before blaming the deployment. This is the real shape of the "identity is
email-based" constraint, and it is why GitHub suits a personal instance better
than a mixed group.
:::

`--github-org` and `--github-team` are sometimes described as required. They are
not, and they have nothing to do with the email header: they **restrict which
GitHub users may sign in** at all. Almanac already has `allowed-users.txt` for
that, so you only want them if you would rather gate on org membership than
maintain an email list.

GitHub is browser SSO only. It publishes no OIDC discovery document for user
login: its OIDC provider exists for GitHub Actions workload identity, not
sign-in, so it cannot back the MCP OAuth flow. Leave the four
`ALMANAC_MCP_*` OAuth variables blank and machine clients use PATs, which works
with any browser provider. If you want OAuth-capable MCP clients on GitHub
identities, broker GitHub through an OIDC provider (see below).

### 3. Any OIDC provider

Anything OIDC-compliant (Keycloak, Authentik, Zitadel, Okta, Entra ID) needs
only an issuer URL. There is no per-provider code in Almanac: both layers read
`<issuer>/.well-known/openid-configuration` and take the authorization, token,
and JWKS endpoints from it.

```bash
OAUTH2_PROXY_PROVIDER=oidc
OAUTH2_PROXY_OIDC_ISSUER_URL=https://idp.example.com/realms/almanac
OAUTH2_PROXY_CLIENT_ID=<browser client id>
OAUTH2_PROXY_CLIENT_SECRET=<browser client secret>

ALMANAC_MCP_OIDC_ISSUER=https://idp.example.com/realms/almanac
ALMANAC_MCP_OAUTH_CLIENT_ID=<mcp client id>
ALMANAC_MCP_OAUTH_CLIENT_SECRET=<mcp client secret>
ALMANAC_MCP_PUBLIC_URL=https://almanac.example.com
```

The two client pairs may be the same client (Google's model) or two distinct
ones (Keycloak's). Compose defaults the `ALMANAC_MCP_OAUTH_*` pair to the
`OAUTH2_PROXY_*` values, so set them explicitly only when they differ.

Set `OAUTH2_PROXY_BACKEND_LOGOUT_URL` to the issuer's `end_session_endpoint`
as well, or signing out of Almanac leaves the provider session running and the
next request signs you straight back in:

```bash
OAUTH2_PROXY_BACKEND_LOGOUT_URL=https://idp.example.com/realms/almanac/protocol/openid-connect/logout?id_token_hint={id_token}
```

Register `https://almanac.example.com/oauth/callback` as a redirect URI on the
MCP client. Almanac verifies the `id_token` signature against the issuer's JWKS
and requires `email_verified` to be true, so the provider must issue a verified
email claim.

::: tip `keycloak` is a deprecated provider value
Use `keycloak-oidc`, or plain `oidc`. oauth2-proxy's legacy `keycloak` provider
is deprecated in favour of `keycloak-oidc`.
:::

### 4. Running your own identity provider

**Only worth it if you want multiple users or multiple sign-in methods.** For a
single person signing in with an account they already have, options 1 and 2 are
strictly less to operate. What an identity provider buys you is **brokering**:
Keycloak can federate upstream to Google, GitHub, and local username/password
accounts at the same time while presenting Almanac with a single OIDC issuer.

```
Almanac ──> Keycloak ──┬──> Google      (you, with the account you already use)
   (one issuer)        ├──> GitHub      (a contributor)
                       └──> local users (a family member with no Google account)
```

Because Almanac keys on email, brokering Google yields the same address as
signing in with Google directly, so accounts, PATs, and logged data all still
match.

#### Try it locally first

`scripts/local-dev/keycloak.sh` boots a Keycloak on port `8085` with a seeded
`almanac` realm: two clients (`almanac-web` for oauth2-proxy, `almanac-mcp` for
the MCP OAuth flow), freshly generated secrets, and a user with the email you
pass it.

```bash
scripts/local-dev/keycloak.sh you@example.com            # embedded H2, ephemeral
scripts/local-dev/keycloak.sh you@example.com --persist  # Postgres + volume
scripts/local-dev/keycloak.sh --print-env                # re-print the env block
scripts/local-dev/keycloak.sh --down                     # teardown
```

It prints a ready-to-paste `.env` block on success. Secrets are generated per
run with `openssl rand -hex 32` and never written into the tracked realm JSON.
`scripts/local-dev/almanac-realm.README.md` annotates every non-obvious choice
in that realm; read it if you want to learn the model rather than just run it.

::: warning Two things to know
Keycloak silently skips importing a realm that already exists, so in `--persist`
mode editing `almanac-realm.json` and re-running appears to do nothing. The
script detects this and points you at `--reimport`.

The fixture runs `start-dev`, which disables HTTPS and hostname enforcement. It
is never a production identity provider, whatever database backs it.
:::

#### Configuring the realm by hand

The seeded realm is a starting point, not a finished configuration. To enable the
pre-seeded (but disabled) Google and GitHub identity providers, add users, or
inspect the account-linking flow, use Keycloak's admin console:

| | |
|---|---|
| Console | `http://localhost:8085` → **Administration Console** |
| Username | `admin` |
| Password | `admin` |

The startup banner prints these too, so you do not have to come back here for
them. `scripts/local-dev/almanac-realm.README.md` is an annotated tour of what
the realm already contains and which fields each identity provider needs.

Console changes are lost on `--down` or a restart unless you started with
`--persist`. Rotating a client secret there also invalidates the `.env` block the
script printed, so copy the new value out, or re-up to regenerate both.

#### Running one for real

`docker-compose.yml` carries a production-shaped `keycloak` service (Postgres,
named volume, `start` rather than `start-dev`) behind a Compose **profile**, so
it is inert by default:

```bash
docker compose up -d                      # api, web, mcp, oauth2-proxy — no Keycloak
docker compose --profile keycloak up -d   # the stack plus Keycloak
```

**Set these in `.env` before running that profile:**

| Variable | Purpose |
| --- | --- |
| `KEYCLOAK_ADMIN_PASSWORD` | Bootstrap admin console password. **Required** |
| `KEYCLOAK_DB_PASSWORD` | Postgres password, read by both the `keycloak` and `keycloak-db` services. They must match, so set it once. **Required** |
| `KEYCLOAK_HOSTNAME` | Public HTTPS URL you authenticate against. Defaults to a placeholder domain |
| `KEYCLOAK_ADMIN_USER` | Admin username. Defaults to `admin` |

::: danger Unset passwords do not fail, they blank
Compose supplies no default for the two password variables. Left unset they
resolve to an empty string, so Keycloak starts with a **blank admin password**
rather than refusing to boot. It warns; it does not stop. Generate both before
the first `--profile keycloak up`:

```bash
python -c 'import secrets,string;print("".join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))'
```
:::

Terminate TLS in front of Keycloak with host nginx, like the rest of the stack.
The profile runs it in production mode (`start`, not `start-dev`), which enforces
hostname and TLS strictness, so `KEYCLOAK_HOSTNAME` must be the real public HTTPS
URL. Then create a realm and the two clients, mirroring
`scripts/local-dev/almanac-realm.json` with your own hostname and fresh secrets.
`keycloak.sh` cannot do this for you: the issuer URL is baked into every issued
token and validated by Almanac, so a `localhost` issuer cannot work off-box.

#### Two details that trip people up

**The discovery URL has no `/auth` prefix.** Since Keycloak v17 it is:

```
https://kc.example.com/realms/almanac/.well-known/openid-configuration
```

Guides written for Keycloak 16 and earlier still show
`/auth/realms/…`, which now 404s.

**Session lifetimes come from the IdP, not the proxy.** `--cookie-expire=720h`
does not override Keycloak's own session (30 min idle / 10 h max by default), so
the shipped realm sets `ssoSessionIdleTimeout` and `ssoSessionMaxLifespan` to 30
days. **Lower them if you are running for several people or on
devices you trust less.**

### After the switch

A user signing in through a new provider for the first time is auto-provisioned
with `timezone: UTC` and `preferred_unit_system: metric`, because there is
nothing else to infer them from. The onboarding card prompts for both on first
load, and that is expected behavior, not a bug. An existing user whose email is
unchanged keeps their profile, data, and tokens.

The allowlist behaves identically whichever provider you pick: it compares email
strings, and the provider is the only thing deciding who reaches it. For flags
beyond the ones covered here, see the [oauth2-proxy provider
docs](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/).

::: tip Almanac is dogfooded on Google
Google is the configuration running in production daily. GitHub and generic OIDC
are covered by tests and manual verification, and the Keycloak path has an
integration suite against a real Keycloak, but they see less mileage. Report
anything that looks wrong.
:::

## Next steps

- [Connect an assistant](/guide/connecting-assistants): mint a PAT and wire up
  an MCP client.
- [Configuration](/guide/configuration): every environment variable, including
  the OAuth ones covered here.
