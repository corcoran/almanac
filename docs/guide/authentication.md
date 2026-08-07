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
environment variables, and diagnosing the handful of ways it goes wrong.

Work through it between [Step 4 and Step 6 of the deploy
runbook](/guide/deploy) — you need the client ID and secret before you write
`.env`.

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
   ├── /oauth/google/         ──> almanac-mcp:3030   (skip-auth, Google callback)
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

Nothing is unauthenticated as a result — the MCP server and the API do their own
validation. Every `/mcp` request carries `Authorization: Bearer alm_…`, and the
API checks that token against the `personal_access_tokens` table.

The MCP OAuth 2.1 endpoints (`/.well-known/`, `/authorize`, `/token`,
`/register`, `/revoke`, `/oauth/google/`) are skipped for the same reason: they
are Almanac's *own* OAuth server, implemented in the MCP container, and they must
be publicly reachable for an OAuth-capable client to discover and use them.

### The allowlist is enforced three times

One file — `allowed-users.txt`, one email per line — is read by three
independent components:

| Layer | How it reads the file | What it gates |
| --- | --- | --- |
| oauth2-proxy | `--authenticated-emails-file=/emails/allowed-users.txt` | browser sign-in |
| `almanac-api` | `ALMANAC_ALLOWED_EMAILS=/emails/allowed-users.txt` | auto-provisioning a new user row |
| `almanac-mcp` | `ALMANAC_ALLOWED_EMAILS=/emails/allowed-users.txt` | completing the MCP OAuth 2.1 flow |

Compose mounts the same host file read-only into all three containers. An email
absent from it cannot sign in through the browser, cannot have an account
created for it, and cannot finish an MCP OAuth flow.

An empty or unreadable list means "allow any authenticated email" — the provider
is then your only gate.

::: warning Removing a line does not revoke access
The API's allowlist check applies to *provisioning*, not to every request: a user
who already exists in the database keeps working after you delete their line. To
actually cut off access, remove the account and revoke its tokens as well.
:::

### Everything converges on one token format

Both auth paths end at the same artifact: a PAT prefixed `alm_`, stored as a
SHA-256 hash in SQLite. An OAuth-capable client that completes the MCP OAuth 2.1
flow receives a real PAT as its access token — the same kind of token you would
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
   - **App name** — shown on the Google consent screen when you sign in. Use
     something you'll recognize, e.g. `Almanac`.
   - **User support email** — your own address.
   - **Developer contact information** — your own address again.
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
   https://almanac.example.com/oauth/google/callback
   ```

   The first is oauth2-proxy's browser SSO callback and must match
   `OAUTH2_PROXY_REDIRECT_URL` character-for-character. The second is the MCP
   OAuth 2.1 callback, derived by the MCP server from `ALMANAC_MCP_PUBLIC_URL`.
   You only need the second if you want Claude mobile or ChatGPT to connect by
   URL; without it, PAT-based clients still work.

   Google compares redirect URIs by exact string, including scheme, host,
   port, path, and trailing slash. `http` vs `https`, or a trailing `/`, is a
   mismatch.

   ::: tip Rehearsing locally
   `scripts/local-dev/up.sh` runs oauth2-proxy on `http://localhost:4180`. To use
   the real Google flow locally, also register
   `http://localhost:4180/oauth2/callback` and
   `http://localhost:4180/oauth/google/callback` on the same client.
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
`ALMANAC_MCP_OAUTH_CLIENT_SECRET` to the `OAUTH2_PROXY_*` values, so setting the
two `OAUTH2_PROXY_*` variables configures both consumers. Leave the MCP pair
blank to run the MCP server in PAT-only mode, with no OAuth discovery endpoints.

The MCP server also needs its public origin, which it uses as the OAuth issuer
and to build the Google redirect URI:

```
ALMANAC_MCP_PUBLIC_URL=https://almanac.example.com
```

Generate the cookie secret fresh — do not reuse one from another deployment, and
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
```

## Using a different provider

Almanac is tested with Google only. oauth2-proxy itself supports GitHub, GitLab,
Azure, Keycloak, and generic OIDC, and the browser half of Almanac's auth is
mostly provider-agnostic — but three things stand between you and a working
non-Google deployment. None is insurmountable; all three are real work.

**1. The provider flag is not env-driven.** `docker-compose.yml` hardcodes:

```yaml
- "--provider=google"
```

The client ID, client secret, cookie secret, and redirect URL beside it all
interpolate from `.env`, so they need no file edit. The provider does. Changing
it means editing a tracked file and carrying that diff across every `git pull`
on the server.

**2. MCP OAuth 2.1 is Google-specific independently of oauth2-proxy.**
`ALMANAC_MCP_OAUTH_CLIENT_ID` and `ALMANAC_MCP_OAUTH_CLIENT_SECRET` do not feed
oauth2-proxy at all — they feed Almanac's own OAuth 2.1 authorization server in
`packages/mcp`, which redirects to Google's authorization endpoint and exchanges
codes against Google's token endpoint. The `--skip-auth-route=^/oauth/google/`
line and the `/oauth/google/callback` route exist for that implementation.
Swapping oauth2-proxy's provider leaves this untouched: browser SSO would use
your new provider while the MCP OAuth flow still tries to talk to Google.
Setting the MCP OAuth pair to blank disables the flow and leaves PAT-only mode,
which does work with any browser provider.

**3. Almanac's identity model is email-based end to end.** The API keys users off
the `x-forwarded-email` header and auto-provisions accounts from that address;
all three allowlist layers compare email strings from `allowed-users.txt`. Some
oauth2-proxy providers gate on organization or team membership rather than
emitting a verified email — GitHub, for example, is usually configured with
`--github-org` / `--github-team`. With such a provider you would need both a
configuration that reliably supplies an email header and an allowlist strategy
that still makes sense.

Making the provider configurable is tracked as future work. Until then, treat a
non-Google deployment as a fork rather than a configuration change, and consult
the [oauth2-proxy provider
docs](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/) for
the flags your provider needs.

## Verifying and failure modes

After `docker compose up -d`, visit `https://almanac.example.com/` in a browser.
A correct setup redirects you to Google, then lands you on the Almanac SPA. The
sections below cover what happens when it doesn't.

### Google shows `redirect_uri_mismatch`

**Symptom:** Google's error page appears instead of the account chooser, naming
`redirect_uri_mismatch` (often with `Error 400`).

**Cause:** the redirect URI oauth2-proxy sent does not exactly match any URI
registered on the OAuth client. oauth2-proxy sends whatever is in
`OAUTH2_PROXY_REDIRECT_URL`.

**Fix:** compare the two strings character by character. Check scheme (`https`,
not `http`), the hostname, the absence of a port, the `/oauth2/callback` path,
and the absence of a trailing slash. Google's error page shows the URI it
received — copy it into the console's Authorized redirect URIs rather than
retyping it. After editing `.env`, recreate the container:

```bash
docker compose up -d oauth2-proxy
```

Console changes can take a minute or two to take effect on Google's side.

### Sign-in works but Almanac returns 403

**Symptom:** Google sign-in completes, then you get a 403 or an "email is not in
the allowed users list" response rather than the SPA.

**Cause:** the address is not in `allowed-users.txt`. Which layer rejected it
tells you where: oauth2-proxy rejects before you ever reach Almanac, while the
API's 403 (`Email is not in the allowed users list`) happens after the proxy let
you through.

**Fix:** add the address, one per line, to `$ALMANAC_DIR/allowed-users.txt`.
oauth2-proxy watches the file and reloads it without a restart. The API and MCP
server read it once at startup, so restart them to pick up the change:

```bash
docker compose restart almanac-api almanac-mcp
```

Also check for the mundane causes: a typo, a stray trailing space, a
`#`-commented line, or a Google account whose primary address differs from the
one you expected.

### A cached SSO session claims the first admin

**Symptom:** you sign in on a fresh instance and don't have admin tooling, or
`is_admin` belongs to an address you didn't intend.

**Cause:** the first account created on an empty `users` table is bootstrapped as
admin. It's decided by whoever signs in first, not by who owns the server. A
browser holding a Google session from a previous deployment, a test instance, or
a different account will sail through sign-in and claim admin without ever
prompting you to choose an account.

**Fix:** before the first login on a fresh install, sign out of Google entirely
or use a private window, so you're forced to pick the account deliberately. To
check who got it, and repair it if needed:

```bash
sqlite3 "$ALMANAC_DIR/data/almanac.sqlite" \
  "SELECT id, email, is_admin FROM users;"
sqlite3 "$ALMANAC_DIR/data/almanac.sqlite" \
  "UPDATE users SET is_admin = 1 WHERE email = 'you@example.com';"
```

Admin is not exclusive — promoting yourself demotes no one, and no data is lost
either way. Only the admin-only tools (listing users, per-user AI access and
token limits) are gated.

### A PAT owns the wrong account

**Symptom:** everything appears to work, but your assistant's writes never show
up in the dashboard, and onboarding prompts you thought you'd completed keep
coming back.

**Cause:** a PAT is bound to whichever account minted it. If you created the
token while the browser was signed in as a different identity — the same mix-up
as above — your MCP client writes to that account while the SPA shows yours.
Nothing errors, because both accounts are legitimate.

**Fix:** find out which account owns the data:

```bash
sqlite3 "$ALMANAC_DIR/data/almanac.sqlite" \
  "SELECT u.email, COUNT(t.id) AS templates
     FROM users u LEFT JOIN workout_templates t ON t.user_id = u.id
    GROUP BY u.id;"
```

Then mint a fresh PAT while signed in as the right account and repoint the MCP
client at it. Revoke the stray token from Settings → Tokens.

## Next steps

- [Connect an assistant](/guide/connecting-assistants) — mint a PAT and wire up
  an MCP client.
- [Configuration](/guide/configuration) — every environment variable, including
  the OAuth ones covered here.
