---
title: Deploy
---

# Deploy

How to deploy Almanac to a server behind nginx, oauth2-proxy, and Docker
Compose. The stack pulls prebuilt images from GHCR, so the server never builds
anything.

This page covers the one-time stand-up: DNS through to a working assistant
connection. Everything after that — updates, backups, rollback — lives in
[Operations](/guide/operations). Once the stand-up is done, deploys are
hands-off: cut a release and the server updates itself.

Work through the steps in order. Each one ends with a **Verify** block: run it,
confirm the result, and only then move on. A failure at step *n* is far cheaper
to diagnose than the same failure discovered at step *n+4*.

## Prerequisites

Have all of these before you start. Each is a hard requirement, not a
nice-to-have.

**A domain you control, with DNS you can edit.** Almanac is served over HTTPS
from a hostname (e.g. `almanac.example.com`), and the OAuth redirect URI is
registered against that exact hostname. You need to be able to create an A (or
AAAA) record pointing at the server. A domain whose DNS you can't change will
block you at Step 1 and again at Step 5.

**A Linux host running Docker, with ports 80 and 443 free.** Specifically:

- Docker Engine 24+ and the Docker Compose v2 plugin (`docker compose`, not the
  legacy `docker-compose`)
- nginx on the host — the TLS terminator; it proxies to oauth2-proxy inside the
  Compose stack
- certbot, or your preferred ACME client
- Ports **80** and **443** unbound on the host. certbot's `--nginx` challenge
  needs 80, and the vhost listens on both. If something else already holds
  them (Apache, another nginx, a Traefik container publishing `:80`), stop or
  relocate it first.
- Port **24180** on `127.0.0.1` free. Compose binds `127.0.0.1:24180:4180` for
  oauth2-proxy. This is loopback-only by design — it must never be exposed
  publicly.

Confirm the ports before you begin:

```bash
sudo ss -lntp '( sport = :80 or sport = :443 or sport = :24180 )'
```

::: tip Verify
Empty output, or only `nginx` on 80/443, is what you want. Anything else on 80
or 443 needs to be dealt with now. Anything at all on 24180 will make Step 8
fail with a port-binding error.
:::

**Docker itself working for your user:**

```bash
docker compose version
docker run --rm hello-world
```

::: tip Verify
`docker compose version` prints `Docker Compose version v2.x`. If it errors,
the Compose v2 plugin isn't installed and nothing in this runbook will work. If
`hello-world` fails with a permission error on the socket, add yourself to the
`docker` group and start a new login shell.
:::

**An OAuth client from your SSO provider.** The stack ships configured for
Google, so the examples below use a Google OAuth client, but oauth2-proxy also
supports GitHub, GitLab, and any generic OIDC provider — swap `--provider` in
`docker-compose.yml` and use that provider's credentials. See
[Authentication](/guide/authentication) for the full walkthrough, including
what changes for a non-Google provider.

**SSH access to the server with sudo.** Steps 2 and 3 write to `/etc`.

**Host tooling for the later steps:** `sqlite3` (for the ownership checks in
Step 9 and for backups) and `jq` (required by the smoke test). Install both
now — the smoke test aborts immediately if `jq` is missing:

```bash
sudo apt install sqlite3 jq        # Debian/Ubuntu
```

## Architecture

```
Internet -> host nginx (TLS) -> 127.0.0.1:24180 (oauth2-proxy in compose)
                                  |
                                  v
                                  +--------------------------+
                                  |  default docker network  |
                                  |  almanac-web   :80       |  <- /
                                  |  almanac-api   :3001     |  <- /api/
                                  |  almanac-mcp   :3030     |  <- /mcp/
                                  +--------------------------+
```

Auth flows:

- **Browser** -> cookie via oauth2-proxy -> forwards `X-Forwarded-Email` to the API.
- **MCP client** -> personal access token -> bypasses oauth2-proxy via
  `--skip-auth-route=^/mcp`, validated directly by almanac-mcp / almanac-api.

Only oauth2-proxy binds a host port. `almanac-api`, `almanac-mcp`, and
`almanac-web` use `expose:` in `docker-compose.yml`, which makes them reachable
only from inside the Docker network. That isolation is load-bearing, not
cosmetic: the API trusts the `X-Forwarded-Email` header
(`ALMANAC_TRUST_PROXY_HEADERS: "true"`), so anything that could reach
`almanac-api:3001` directly could claim any identity. Never add a `ports:`
mapping to those three services.

## The deploy directory

The server needs a directory holding the operational files (below); its path is
up to you. Throughout this runbook, `$ALMANAC_DIR` stands in for that path. Set
it once per shell session so the commands paste cleanly:

```bash
export ALMANAC_DIR=~/almanac    # wherever you keep it
cd "$ALMANAC_DIR"
```

(`deploy/update.sh` derives its own location, so `./deploy/update.sh` works
from anywhere in the tree without `$ALMANAC_DIR`.)

::: warning `$ALMANAC_DIR` is a shell variable, not a system setting
It vanishes when the shell exits, and cron never sees it. Re-export it in each
new session, and use absolute paths in anything scheduled — see
[Backups](/guide/operations#backups).
:::

## Step 1: DNS

Point your domain at the server's public IP and wait for propagation:

```bash
dig +short almanac.example.com
```

should return the right IP.

::: tip Verify
The output is one line: your server's public IP, and nothing else. Compare it
against what the server actually thinks its address is:

```bash
curl -s https://api.ipify.org; echo
```

The two must match.
:::

**If `dig` returns nothing**, the record hasn't propagated yet or was never
created. Query the authoritative nameserver directly to distinguish the two —
if the authoritative server has the record but your resolver doesn't, it's
propagation and you wait; if the authoritative server also has nothing, the
record isn't there:

```bash
dig +short NS example.com
dig +short almanac.example.com @<one-of-those-nameservers>
```

**If `dig` returns a CNAME chain or a proxy IP** (Cloudflare's orange cloud,
for example), certbot's `--nginx` challenge in Step 2 will fail because the
challenge request never reaches your server. Set the record to DNS-only for the
duration of the stand-up, or use a DNS-01 challenge instead.

**Do not proceed until this resolves correctly.** Every subsequent step —
certificate issuance, the OAuth redirect URI, the browser login — is keyed to
this hostname.

## Step 2: TLS certificate

```bash
sudo certbot certonly --nginx -d almanac.example.com
```

Certs land at `/etc/letsencrypt/live/almanac.example.com/`.

::: tip Verify
The files exist and the certificate names your domain:

```bash
sudo ls -l /etc/letsencrypt/live/almanac.example.com/
sudo openssl x509 -in /etc/letsencrypt/live/almanac.example.com/fullchain.pem \
  -noout -subject -dates
```

You want `fullchain.pem` and `privkey.pem` present, a `subject` naming your
domain, and a `notAfter` date roughly 90 days out. Those two filenames are what
the nginx template in Step 3 references — if your ACME client writes different
names, note them now and adjust the `ssl_certificate` lines.
:::

**If certbot fails with a challenge error**, the usual causes are, in order of
likelihood: DNS not yet propagated (go back to Step 1), port 80 blocked by a
firewall or cloud security group, or something other than nginx holding port
80. Let's Encrypt also rate-limits repeated failures against the same
hostname — use `--dry-run` while you debug so a burst of failures doesn't lock
you out for the rest of the week.

**Renewal** is handled by certbot's own systemd timer or cron entry on most
distributions. Confirm it exists rather than assuming:

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

## Step 3: Host nginx vhost

Copy and customize the template:

```bash
sudo cp "$ALMANAC_DIR"/deploy/nginx-almanac.conf \
        /etc/nginx/sites-available/almanac.conf
sudo sed -i 's/__DOMAIN__/almanac.example.com/g' \
        /etc/nginx/sites-available/almanac.conf
sudo ln -s /etc/nginx/sites-available/almanac.conf \
           /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The template defines two server blocks: a `:443 ssl` vhost whose single
`location /` proxies to `http://127.0.0.1:24180`, and a `:80` vhost that
redirects to HTTPS. It also sets `proxy_http_version 1.1`, `proxy_buffering
off`, and `proxy_read_timeout 3600s` — those exist for MCP Streamable HTTP,
which holds a connection open for the duration of an AI session. Don't remove
them, or long tool calls will be cut off mid-flight.

Three lines in the template depend on your host, and all three fail loudly
rather than silently — but the errors don't say what to change:

**`http2 on;`** is a standalone directive as of nginx 1.25.1. On anything older
nginx rejects it with `unknown directive "http2"`; delete the line and use the
older parameter form instead:

```nginx
listen 443 ssl http2;
```

**The two certbot includes** carry the cipher suite, protocol floor, and DH
params:

```nginx
include /etc/letsencrypt/options-ssl-nginx.conf;
ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
```

A `certbot --nginx` run writes both. If you issued certs another way —
`certonly`, acme.sh, a manual copy — those files may not exist, and nginx
refuses to start when an `include` target is missing. Either drop the two lines
and set your own `ssl_protocols` / `ssl_ciphers`, or generate the params
yourself:

```bash
sudo openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
```

**`listen 443 ssl;` claims every interface.** On a host with more than one
public IP — a VPS with several addresses, or a box already serving other sites
— bind explicitly in both server blocks, or this vhost may answer for hostnames
it shouldn't:

```nginx
listen 203.0.113.10:443 ssl;
listen 203.0.113.10:80;
```

::: tip Verify
`sudo nginx -t` prints `syntax is ok` and `test is successful` — the `&&` above
means the reload only runs if it did. Then confirm no `__DOMAIN__` placeholders
survived the `sed`:

```bash
grep -c __DOMAIN__ /etc/nginx/sites-available/almanac.conf
```

That must print `0`. Finally, confirm the vhost answers:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://almanac.example.com/
```
:::

**A `502` here is the expected, correct result at this stage** — nothing is
listening on 24180 yet. Step 8 fixes it. Anything else needs attention now:

| Response | Cause |
| --- | --- |
| `502` | Expected. oauth2-proxy isn't running yet. |
| Connection refused | nginx isn't listening on 443, or a firewall blocks it. |
| TLS certificate error | The `ssl_certificate` paths don't match what certbot wrote in Step 2. |
| A different site's content | Another vhost claims this hostname, or the `default_server` is winning. Check `grep -rn server_name /etc/nginx/sites-enabled/`. |

**If `nginx -t` fails**, the message names the cause:

| `nginx -t` says | Fix |
| --- | --- |
| `duplicate server_name` | Another enabled vhost claims the hostname. Remove or rename it — nginx otherwise serves whichever loaded first, and the symptom looks like a broken deploy long after you've forgotten the conflict. |
| `unknown directive "http2"` | nginx is older than 1.25.1. Delete `http2 on;` and use `listen 443 ssl http2;` instead. |
| `open() ".../options-ssl-nginx.conf" failed` | Certbot never wrote it (you used `certonly` or another client). Drop both certbot `include`/`ssl_dhparam` lines and set your own `ssl_protocols` / `ssl_ciphers`. |
| `cannot load certificate` | The `ssl_certificate` paths don't match what Step 2 produced. Check `sudo ls /etc/letsencrypt/live/`. |
| `bind() to 0.0.0.0:443 failed` | Another process holds 443 — often an old nginx vhost or Apache. `sudo ss -ltnp \| grep :443`. |

## Step 4: Put the operational files on the server

The server doesn't need the source tree — images come from GHCR. It only needs
this **minimal operational file set**:

| File | Why the server needs it |
| --- | --- |
| `docker-compose.yml` | the stack definition |
| `allowed-users.txt` | the oauth2-proxy / API email allowlist |
| `scripts/backup-db.sh` | DB snapshot (cron + `update.sh` call it) |
| `deploy/update.sh` | manual pull / rollback lever |
| `deploy/post-migration-smoke.sh` | post-deploy smoke test |
| `deploy/nginx-almanac.conf` | host nginx vhost template |
| `data/` (directory) | live SQLite + backups live here |

Plus a `.env`, created directly on the server (Step 6) and never committed.

The simplest way to get these onto the box is a clone of the repo:

```bash
export ALMANAC_DIR=~/almanac
git clone https://github.com/corcoran/almanac "$ALMANAC_DIR"
cd "$ALMANAC_DIR"
```

You can sparse-checkout just the files above if you'd rather not have the whole
tree, but a full clone is harmless — the server only ever runs the compose file
and scripts, never builds from source.

::: tip Verify
Every file in the table is present and the two scripts are executable:

```bash
cd "$ALMANAC_DIR"
ls -l docker-compose.yml deploy/update.sh deploy/post-migration-smoke.sh \
      scripts/backup-db.sh deploy/nginx-almanac.conf
docker compose config --quiet && echo "compose file parses"
```

`docker compose config --quiet` exits 0 and prints nothing when the file is
valid. It will warn about unset variables — that's expected until Step 6.
:::

**If you sparse-checked-out**, note that `deploy/update.sh` resolves its own
repo root as the parent of its own directory and then runs
`./scripts/backup-db.sh` from there. Both paths must exist relative to
`$ALMANAC_DIR`, or the update lever fails on its first line.

::: warning Importing an existing database
If you are migrating an existing Almanac database from another host, copy it
into `$ALMANAC_DIR/data/` **now, before first boot** — see [Importing an
existing database](/guide/operations#appendix-importing-an-existing-database).
Booting first creates an empty database, and the first sign-in against it
claims admin (Step 9).
:::

## Step 5: OAuth provider

In your SSO provider's console (Google Cloud Console for the default Google
setup), add the callback URL to your OAuth client's authorized redirect URIs:

```
https://almanac.example.com/oauth2/callback
```

If you also want OAuth-capable clients (Claude mobile, ChatGPT) to connect to
the MCP endpoint by URL rather than by pasting a token, register the second
callback as well:

```
https://almanac.example.com/oauth/callback
```

**[Authentication](/guide/authentication) is the full walkthrough** — creating
the project, configuring the consent screen, the test-users trap, and which
console value maps to which environment variable. Read it now if you haven't
set up an OAuth client before; you need the client ID and secret in hand
before Step 6.

::: tip Verify
You have three values written down: the client ID (ends in
`.apps.googleusercontent.com`), the client secret, and the exact redirect URI
string as registered. Google compares redirect URIs by exact string match —
scheme, host, path, and trailing slash all count. Copy them; don't retype them.
:::

## Step 6: Create `.env`

```bash
cd "$ALMANAC_DIR"
cp .env.example .env
vim .env
```

Required values for a deploy:

- `OAUTH2_PROXY_CLIENT_ID` — from your OAuth provider
- `OAUTH2_PROXY_CLIENT_SECRET` — from your OAuth provider
- `OAUTH2_PROXY_COOKIE_SECRET` — generate fresh, do not reuse:
  ```bash
  python -c 'import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'
  ```
- `OAUTH2_PROXY_REDIRECT_URL=https://almanac.example.com/oauth2/callback`
- `ALMANAC_MCP_CLIENT_TOKEN` — leave as a placeholder. Compose runs the MCP
  server in `transport=http`, where this var is not consumed: each MCP client
  connection brings its own PAT in the Authorization header, validated by the
  API. Set it to any string or remove the line. (It only matters for an
  operator running an `ALMANAC_MCP_TRANSPORT=stdio` MCP locally against the
  server's API, where it's the PAT that stdio process uses.)

If you want OAuth-capable MCP clients, also set the public origin the MCP
server advertises as its OAuth issuer, plus the OIDC issuer it delegates
sign-in to:

```bash
ALMANAC_MCP_PUBLIC_URL=https://almanac.example.com
ALMANAC_MCP_OIDC_ISSUER=https://accounts.google.com
```

`ALMANAC_MCP_OAUTH_CLIENT_ID` and `ALMANAC_MCP_OAUTH_CLIENT_SECRET` default to
the `OAUTH2_PROXY_*` values in `docker-compose.yml`, so with Google — one client
serving both consumers — the two `OAUTH2_PROXY_*` variables are enough.

Those four (issuer, client ID, client secret, public URL) must be set together
or all left blank. All blank is PAT-only mode; a partial set fails at boot
naming what is missing.

::: warning Upgrading: the MCP callback path changed
The MCP OAuth callback was `/oauth/google/callback` and now defaults to
`/oauth/callback`. Register the new URI on your OAuth client, or set
`ALMANAC_MCP_OAUTH_CALLBACK_PATH=/oauth/google/callback` to keep the old one.
Browser SSO (`/oauth2/callback`) is unaffected.
:::

Leave the LLM variables unset unless you want the AI surfaces; see
[Configuration](/guide/configuration) and `.env.example`.

If you forked the repo and publish images to your own GHCR namespace, set
`ALMANAC_IMAGE_OWNER` to your GitHub username or org — `docker-compose.yml`
defaults it to `corcoran`.

::: tip Verify
Confirm Compose resolves every variable it needs, without printing secrets to
your terminal:

```bash
docker compose config --quiet && echo "all variables resolve"
```

Then check the interpolated values landed where you expect, redacting as you
read:

```bash
docker compose config | grep -E 'OAUTH2_PROXY|MCP_OAUTH|redirect-url'
```

An empty value renders as an empty string, not an error — Compose does not
require variables to be set. That is exactly why this check matters: a typo'd
variable name silently produces a blank client ID, and the failure only surfaces
as an opaque OAuth error in Step 9.
:::

::: danger Never commit `.env`
It holds the OAuth client secret and cookie secret. The repo's `.gitignore`
excludes it, but if you created the deploy directory some other way, confirm:
`git check-ignore -v .env` should print the matching ignore rule. Keep the file
mode tight — `chmod 600 .env`.
:::

## Step 7: `allowed-users.txt`

```bash
cp allowed-users.txt.example allowed-users.txt
vim allowed-users.txt
```

One email per line. Start with just your own; add others later (Step 12).

This single file is read by three independent components — oauth2-proxy
(`--authenticated-emails-file`), `almanac-api`, and `almanac-mcp` (both via
`ALMANAC_ALLOWED_EMAILS`) — all mounted read-only from the same host path. See
[the allowlist section in Authentication](/guide/authentication#the-allowlist-is-enforced-three-times)
for what each layer actually gates.

::: tip Verify
The file exists at the path Compose mounts, and contains your address:

```bash
cat "$ALMANAC_DIR/allowed-users.txt"
```

Check for the mundane failures while you're looking: a trailing space after an
address, a leftover `your-email@example.com` line from the example file, or a
Google account whose primary address differs from the one you assumed.
:::

::: warning An empty file means "allow anyone"
An empty or unreadable allowlist is interpreted as no restriction — your OAuth
provider becomes the only gate. If `docker-compose.yml` mounts a path that
doesn't exist on the host, Docker creates a *directory* there, and the
allowlist silently becomes empty. Confirm it is a regular file with content
before first boot.
:::

## Step 8: First boot

First boot pulls the published images and starts the stack. The almanac images
are public on GHCR, so no registry login is needed.

```bash
cd "$ALMANAC_DIR"
docker compose pull
docker compose up -d
docker compose logs -f almanac-api
```

Watch for the API coming up. On a first boot against an empty database the
migration runner creates the schema; on a later boot with pending migrations
the API writes a snapshot first and logs `pre-migration snapshot written` with
the backup path.

Then in another terminal:

```bash
docker compose ps
```

All four containers should be "Up."

::: tip Verify
Two checks, in this order.

**1. Container state.** Every service is running, and the three almanac
services report healthy — they all define healthchecks in
`docker-compose.yml`, and `oauth2-proxy` has `depends_on: condition:
service_healthy` for all three, so it will not start until they are:

```bash
docker compose ps
```

Expect five containers — `almanac-api`, `almanac-mcp`, `almanac-web`,
`almanac-oauth2-proxy`, `almanac-watchtower`. Healthchecks have a
`start_period` (20s for the API, 10s for MCP and web), so allow a few tens of
seconds before judging a `starting` state as broken.

**2. The API answers.** This is the authoritative check, and it works from the
host because `--skip-auth-route=^/api/v1/health$` makes the probe public:

```bash
curl -sf http://127.0.0.1:24180/api/v1/health | jq .
```

The route returns four fields — `ok`, `migrations_applied`, `version`, and
`commit`. Success is `ok: true` with a non-zero `migrations_applied`; `commit`
tells you exactly which build is running, which is the fastest way to confirm
later that an update actually landed.
:::

**Failure modes at this step:**

**`curl` gets connection refused on 24180** — oauth2-proxy isn't running.
Because it depends on all three healthchecks, the usual cause is that one of
them never went healthy. Find the unhealthy one, then read its log:

```bash
docker compose ps
docker compose logs --tail=100 almanac-api
```

**oauth2-proxy exits immediately at start** — almost always a missing or
malformed value from `.env`. `--cookie-secret` in particular must decode to 16,
24, or 32 bytes; a hand-typed string usually doesn't. Regenerate it with the
`python` command from Step 6.

**Port bind error on 24180** — something else already holds it. Re-run the
`ss` check from the prerequisites.

**The API restarts in a loop** — read the log rather than guessing. A failed
migration, an unreadable database file, or a bad mount permission all present
this way:

```bash
docker compose logs --tail=200 almanac-api
```

Note that the `./data:/data` mount means the SQLite file is owned by the
container's user on the host. If you pre-seeded `data/almanac.sqlite` (Step 4),
its permissions must let the container write to it *and* to the containing
directory — SQLite in WAL mode creates `-wal` and `-shm` siblings.

**The health probe returns a 4xx from oauth2-proxy instead of JSON** — the
`--skip-auth-route=^/api/v1/health$` rule isn't in effect. Confirm it survived
any edit you made to `docker-compose.yml`:

```bash
docker compose config | grep 'skip-auth-route'
```

> **Private images?** If you forked Almanac and publish your images to a
> *private* GHCR namespace, run `docker login ghcr.io` once (as the user that
> runs deploys) with a `read:packages` token before pulling. Public images —
> the default — need no login.

## Step 9: First browser login

Visit `https://almanac.example.com/` and sign in through your SSO provider. You
land on the SPA with a blank slate. Your first sign-in auto-provisions your
user account from your verified email.

::: danger Read this before you sign in — the first account becomes the admin
**The first account created on a fresh instance is bootstrapped as admin.** It
is decided by whoever signs in first, not by who owns the server. Two ways this
goes wrong, both common:

1. **A cached SSO session claims admin.** A browser already holding a Google
   session — from a previous deployment, a test instance, or a personal account
   you weren't thinking about — sails straight through without prompting you to
   pick an account, and *that* identity takes the admin flag. **Sign out of
   Google entirely, or use a private window, before this first login.**

2. **A PAT ends up owning the wrong account.** A token belongs to whichever
   account minted it. Mint one while signed in as the wrong identity and your
   assistant writes to that account while the dashboard shows yours. Nothing
   errors — the data is just somewhere you aren't looking, and onboarding
   prompts you thought you'd finished keep reappearing.

Both symptoms, their diagnostic SQL, and the repair are covered in detail in
[Authentication → Verifying and failure
modes](/guide/authentication#a-cached-sso-session-claims-the-first-admin).
Neither is destructive: admin is not exclusive, and no data is lost either way.
:::

::: tip Verify
Confirm which account was actually created, and that it holds admin, before you
do anything else:

```bash
sqlite3 "$ALMANAC_DIR/data/almanac.sqlite" \
  "SELECT id, email, is_admin FROM users;"
```

One row, your address, `is_admin` = 1. If the email is wrong, fix it now — per
the link above — rather than after you've logged a month of data.
:::

**If the browser never reaches Google**, or reaches it and comes back with an
error, the failure is in the OAuth configuration rather than the deploy. Check
the proxy's own log first; it names the reason:

```bash
docker compose logs --tail=100 oauth2-proxy
```

## Step 10: Mint your first PAT

Click the user icon (top-right) -> Settings -> Tokens -> "Create token." Name it
something like "Claude Desktop." The cleartext is shown once — copy it
immediately.

::: tip Verify
The token starts with `alm_`. Confirm a row landed, without exposing the secret
— only a SHA-256 hash is stored, so there is nothing to read back even if you
wanted to:

```bash
sqlite3 "$ALMANAC_DIR/data/almanac.sqlite" \
  "SELECT t.id, t.name, u.email
     FROM personal_access_tokens t JOIN users u ON u.id = t.user_id;"
```

Check the `email` column names the account you intend to use. This is the
cheapest possible moment to catch the wrong-account PAT problem from Step 9.
:::

**The cleartext is shown exactly once.** If you lose it, you cannot recover it —
revoke that token from Settings → Tokens and mint a new one.

## Step 11: Connect an assistant

In your MCP client config, point at the hosted MCP:

```jsonc
{
  "mcpServers": {
    "almanac": {
      "url": "https://almanac.example.com/mcp",
      "headers": { "Authorization": "Bearer alm_<your-token>" }
    }
  }
}
```

Restart the client. The `ping` tool should return `{ok: true, ...}`. For
OAuth-capable clients (Claude mobile, ChatGPT), you can instead just enter the
`/mcp` URL and let the OAuth flow handle sign-in.

::: tip Verify
Before debugging the client, confirm the endpoint itself is reachable and
authenticating. A request with no token must be rejected:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  https://almanac.example.com/mcp
```

A `401` proves the route is wired and PAT validation is running. Repeat with
your token:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Authorization: Bearer alm_<your-token>' \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  https://almanac.example.com/mcp
```

**2xx, 400, and 406 all indicate success here** — they prove the auth and
transport layers are alive. A barebones POST that doesn't advertise SSE in its
`Accept` header commonly gets 406, which is fine. This is the same interpretation
`deploy/post-migration-smoke.sh` applies in its step 5.
:::

| Status | Meaning |
| --- | --- |
| 2xx / 400 / 406 | Working. Auth and transport are alive. |
| 401 with a token | The PAT is wrong, revoked, or bound to a different user. |
| 404 | Wrong path. The MCP listener checks for `/mcp` exactly — no trailing slash — when called internally. |
| 502 | `almanac-mcp` is down. Check `docker compose logs almanac-mcp`. |

**Connecting a custom MCP server is a paid-plan feature** on both Claude and
ChatGPT, and the qualifying tiers have changed more than once. Verify the
current terms rather than assuming.

## Step 12: Add other users

For each person:

1. Append their email to `$ALMANAC_DIR/allowed-users.txt` (oauth2-proxy reloads
   on file change — no container restart).
2. Have them visit `https://almanac.example.com/`.
3. Their first sign-in auto-provisions their user row.
4. If they want to use their own assistant, they mint a PAT under
   Settings -> Tokens for their MCP client.

::: warning oauth2-proxy reloads; the API and MCP do not
oauth2-proxy watches `allowed-users.txt` and picks up changes without a
restart. `almanac-api` and `almanac-mcp` read `ALMANAC_ALLOWED_EMAILS` once at
startup, so a newly added address can pass the proxy and still be refused by
the API with "Email is not in the allowed users list." Restart those two after
editing the file:

```bash
docker compose restart almanac-api almanac-mcp
```
:::

::: tip Verify
After their first sign-in, the row exists:

```bash
sqlite3 "$ALMANAC_DIR/data/almanac.sqlite" \
  "SELECT id, email, is_admin FROM users ORDER BY id;"
```

A new user should appear with `is_admin` = 0. Only the first account on an empty
table is bootstrapped as admin.
:::

::: warning Removing a line does not revoke access
The allowlist check gates *provisioning*, not every request. A user who already
exists in the database keeps working after you delete their line. To actually
cut off access, remove the account and revoke its tokens too.
:::

> **Check their plan before promising step 4.** Connecting a custom MCP server
> is a paid-plan feature on both Claude and ChatGPT, and the qualifying tiers
> have changed more than once — verify the current terms rather than assuming.
> Someone on a free plan cannot add Almanac to their assistant at all.
>
> They are not stuck, though: the web dashboard does everything the MCP tools
> do, and the built-in AI meal assistant and insights coach run on the server's
> `ANTHROPIC_API_KEY`, so they work for every signed-in user regardless of what
> AI subscription they have. They stay hidden until you set each user's
> `llm_logging_enabled` flag, which has no web UI —
> see [turning the AI surfaces on](/guide/configuration#turning-the-ai-surfaces-on)
> for the MCP, API, and SQL routes.

## Smoke test

After Step 11, run the post-migration smoke script. It runs inside the docker
network (oauth2-proxy doesn't accept inbound `X-Forwarded-Email` as auth; see
the comment block at the top of the script), so the only host tools needed are
`docker` and `jq`:

```bash
cd "$ALMANAC_DIR"
TEST_EMAIL=you@example.com bash deploy/post-migration-smoke.sh
```

Should exit 0. The MCP step accepts the freshly-minted PAT directly; a 401 there
means the PAT is bad (revoked, or not bound to `TEST_EMAIL`'s user).

The script exercises seven things in order — see
[Operations](/guide/operations#the-post-migration-smoke-test) for the full
breakdown of each step and how to read a failure. It is worth running now, at
the end of the stand-up, and again after every update that carries a migration.

::: tip Verify
The script uses `set -euo pipefail` and aborts on the first failure, so a clean
run means every check passed:

```bash
TEST_EMAIL=you@example.com bash deploy/post-migration-smoke.sh
echo "exit: $?"
```

`exit: 0` and a final `All smoke checks passed.` line. Any earlier abort prints
a `FAIL:` line naming the step that broke.
:::

## You're done

The stand-up is complete. From here on:

- **Updates are automatic.** The `watchtower` service polls GHCR every five
  minutes and recreates the almanac containers when a new `:latest` image
  lands. Cutting a release is the only manual step. See
  [Operations → Updating a running deploy](/guide/operations#updating-a-running-deploy).
- **Set up backups now, not later.** Nothing schedules them for you. See
  [Operations → Backups](/guide/operations#backups).
- **Bookmark the rollback lever.** `ALMANAC_TAG=<version> ./deploy/update.sh`
  pins a prior published image. See
  [Operations → If a deploy goes wrong](/guide/operations#if-a-deploy-goes-wrong).

## Next steps

- [Operations](/guide/operations) — updates, backups, rollback, and the smoke test
- [Authentication](/guide/authentication) — OAuth provider setup and auth failure modes
- [Connecting assistants](/guide/connecting-assistants) — MCP clients and PATs
- [Configuration](/guide/configuration) — every environment variable
