# Almanac deploy runbook

How to deploy Almanac to a server behind nginx, oauth2-proxy, and Docker
Compose. The stack pulls prebuilt images from GHCR, so the server never
builds anything.

Everything after the initial stand-up is hands-off: cut a release and the
server updates itself (see [Updating a running deploy](#updating-a-running-deploy)).

## Prerequisites

- A Linux server with:
  - Docker Engine 24+ and the Docker Compose v2 plugin
  - nginx
  - certbot, or your preferred ACME client
  - A domain you control (e.g. `almanac.example.com`)
- An OAuth client from your SSO provider. The stack ships configured for
  Google, so the examples below use a Google OAuth client, but oauth2-proxy
  also supports GitHub, GitLab, and any generic OIDC provider — swap
  `--provider` in `docker-compose.yml` and use that provider's credentials.
- SSH access to the server with sudo.

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
  `--skip-auth-route=^/mcp/`, validated directly by almanac-mcp / almanac-api.

## The deploy directory

The server needs a directory holding the operational files (below); its path
is up to you. Throughout this runbook, `$ALMANAC_DIR` stands in for that path.
Set it once per shell session so the commands paste cleanly:

```
export ALMANAC_DIR=~/almanac    # wherever you keep it
cd "$ALMANAC_DIR"
```

(`deploy/update.sh` derives its own location, so `./deploy/update.sh` works
from anywhere in the tree without `$ALMANAC_DIR`.)

## Step 1: DNS

Point your domain at the server's public IP and wait for propagation:

```
dig +short almanac.example.com
```

should return the right IP.

## Step 2: TLS certificate

```
sudo certbot certonly --nginx -d almanac.example.com
```

Certs land at `/etc/letsencrypt/live/almanac.example.com/`.

## Step 3: Host nginx vhost

Copy and customize the template:

```
sudo cp "$ALMANAC_DIR"/deploy/nginx-almanac.conf \
        /etc/nginx/sites-available/almanac.conf
sudo sed -i 's/__DOMAIN__/almanac.example.com/g' \
        /etc/nginx/sites-available/almanac.conf
sudo ln -s /etc/nginx/sites-available/almanac.conf \
           /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Requests to `https://almanac.example.com` return 502 for now — nothing is
listening on 24180 yet. The next steps fix that.

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

```
export ALMANAC_DIR=~/almanac
git clone https://github.com/corcoran/almanac "$ALMANAC_DIR"
cd "$ALMANAC_DIR"
```

You can sparse-checkout just the files above if you'd rather not have the whole
tree, but a full clone is harmless — the server only ever runs the compose file
and scripts, never builds from source.

## Step 5: OAuth provider

In your SSO provider's console (Google Cloud Console for the default Google
setup), add the callback URL to your OAuth client's authorized redirect URIs:

```
https://almanac.example.com/oauth2/callback
```

## Step 6: Create `.env`

```
cp .env.example .env
vim .env
```

Required values for a deploy:

- `OAUTH2_PROXY_CLIENT_ID` — from your OAuth provider
- `OAUTH2_PROXY_CLIENT_SECRET` — from your OAuth provider
- `OAUTH2_PROXY_COOKIE_SECRET` — generate fresh, do not reuse:
  ```
  python -c 'import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'
  ```
- `OAUTH2_PROXY_REDIRECT_URL=https://almanac.example.com/oauth2/callback`
- `ALMANAC_MCP_CLIENT_TOKEN` — leave as a placeholder. Compose runs the MCP
  server in `transport=http`, where this var is not consumed: each MCP client
  connection brings its own PAT in the Authorization header, validated by the
  API. Set it to any string or remove the line. (It only matters for an
  operator running an `ALMANAC_MCP_TRANSPORT=stdio` MCP locally against the
  server's API, where it's the PAT that stdio process uses.)

Leave the LLM variables unset unless you want the AI surfaces; see the LLM
section in the root README and `.env.example`.

## Step 7: `allowed-users.txt`

```
cp allowed-users.txt.example allowed-users.txt
vim allowed-users.txt
```

One email per line. Start with just your own; add others later (Step 12).

## Step 8: First boot

First boot pulls the published images and starts the stack. The almanac images
are public on GHCR, so no registry login is needed.

```
cd "$ALMANAC_DIR"
docker compose pull
docker compose up -d
docker compose logs -f almanac-api
```

Watch for:

- migrations applied (`Applied migration 7`, etc.)
- `Server listening at http://0.0.0.0:3001`

Then in another terminal:

```
docker compose ps
```

All four containers should be "Up."

> **Private images?** If you forked Almanac and publish your images to a
> *private* GHCR namespace, run `docker login ghcr.io` once (as the user that
> runs deploys) with a `read:packages` token before pulling. Public images —
> the default — need no login.

## Step 9: First browser login

Visit `https://almanac.example.com/` and sign in through your SSO provider. You
land on the SPA with a blank slate. Your first sign-in auto-provisions your
user account from your verified email.

## Step 10: Mint your first PAT

Click the user icon (top-right) -> Settings -> Tokens -> "Create token." Name it
something like "Claude Desktop." The cleartext is shown once — copy it
immediately.

## Step 11: Connect an assistant

In your MCP client config, point at the hosted MCP:

```jsonc
{
  "mcpServers": {
    "almanac": {
      "url": "https://almanac.example.com/mcp/",
      "headers": { "Authorization": "Bearer alm_<your-token>" }
    }
  }
}
```

Restart the client. The `ping` tool should return `{ok: true, ...}`. For
OAuth-capable clients (Claude mobile, ChatGPT), you can instead just enter the
`/mcp/` URL and let the OAuth flow handle sign-in.

## Step 12: Add other users

For each person:

1. Append their email to `$ALMANAC_DIR/allowed-users.txt` (oauth2-proxy reloads
   on file change — no container restart).
2. Have them visit `https://almanac.example.com/`.
3. Their first sign-in auto-provisions their user row.
4. If they want to use their own assistant, they mint a PAT under
   Settings -> Tokens for their MCP client.

> **Check their plan before promising step 4.** Connecting a custom MCP server
> is a paid-plan feature on both Claude and ChatGPT, and the qualifying tiers
> have changed more than once — verify the current terms rather than assuming.
> Someone on a free plan cannot add Almanac to their assistant at all.
>
> They are not stuck, though: the web dashboard does everything the MCP tools
> do, and the built-in AI meal assistant and insights coach run on the server's
> `ANTHROPIC_API_KEY`, so they work for every signed-in user regardless of what
> AI subscription they have. Enable them per-user with
> `admin_set_user_llm_access` (or `UPDATE users SET llm_logging_enabled = 1`).

## Smoke test

After Step 11, run the post-migration smoke script. It runs inside the docker
network (oauth2-proxy doesn't accept inbound `X-Forwarded-Email` as auth; see
the comment block at the top of the script), so the only host tools needed are
`docker` and `jq`:

```
cd "$ALMANAC_DIR"
TEST_EMAIL=you@example.com bash deploy/post-migration-smoke.sh
```

Should exit 0. The MCP step accepts the freshly-minted PAT directly; a 401 there
means the PAT is bad (revoked, or not bound to `TEST_EMAIL`'s user).

## Updating a running deploy

After the one-time stand-up, a deploy is just two moves, and the second one is
automatic.

**1. Cut a release.** From `master`, run the release script with the bump you
want. It computes the next version, checks the tree is clean and up to date,
requires a matching `CHANGELOG.md` entry, and prompts before tagging and
pushing:

```
scripts/push-tag.sh patch    # or: minor | major
```

Pushing the tag triggers the release workflow
([`.github/workflows/release.yml`](../.github/workflows/release.yml)), which
builds the api/web/mcp images and publishes them to GHCR tagged by version,
`latest`, and the short commit SHA. Wait for the workflow to finish — the images
must exist before the server can pull them.

**2. Pull and swap.** This happens **automatically**: the `watchtower` service
polls GHCR and recreates the changed containers within ~5 minutes of the new
`:latest` images landing. You don't have to SSH in. The manual
`./deploy/update.sh` remains as the rollback / force lever (see
[If a deploy goes wrong](#if-a-deploy-goes-wrong)).

**This is not zero-downtime.** Compose recreates each changed container
stop-then-start, so each service has a brief gap (seconds) while its container
restarts. For a single-user or small-group tracker that's fine. The recreate
is ordered: per [`docker-compose.yml`](../docker-compose.yml), `oauth2-proxy`
waits on the api/mcp/web healthchecks and `almanac-mcp` waits on `almanac-api`,
so the proxy only swings onto the API once `/api/v1/health` is green (its
`start_period` covers migrations running on boot).

### Auto-deploy (watchtower)

The `watchtower` service in [`docker-compose.yml`](../docker-compose.yml) makes
deploys hands-off: it polls GHCR every 5 minutes and, when a watched service's
`:latest` digest changes, pulls the new image and recreates that container —
dependency-ordered, respecting healthchecks, the same as `update.sh` does
manually. **After the one-time setup, a deploy is just step 1: tag and push.
The server updates itself.**

> **Image: a maintained fork.** The original `containrrr/watchtower` was
> archived in December 2025, so the compose uses the community fork
> `ghcr.io/nicholas-fedor/watchtower`, which continues the same codebase.
> Labels, env vars, and the shoutrrr notifier are unchanged; only the image
> reference differs.

How it's scoped and wired:

- **Opt-in per service.** Watchtower runs with `--label-enable`, so it only
  touches containers carrying `com.centurylinklabs.watchtower.enable=true` —
  just the three almanac services. **oauth2-proxy is deliberately excluded**:
  its image is pinned and must never auto-move.
- **Registry auth.** For public images (the default) no credentials are needed.
  Watchtower mounts the deploying user's `~/.docker/config.json` read-only, so
  if you run private images it reuses whatever `docker login` wrote.
- **Email on update/error.** Watchtower can mail via shoutrrr SMTP. Turn it on
  by setting `WATCHTOWER_EMAIL_TO` in `$ALMANAC_DIR/.env`; leave it blank and
  watchtower runs silently (you'd notice a stale app only by checking
  `docker logs almanac-watchtower`). Server, port, from-address, and the HELO
  name have defaults in `.env.example`. **`WATCHTOWER_EMAIL_HELO` must be an
  FQDN** — shoutrrr's default HELO is the literal `localhost`, which a strict
  postfix rejects with `504 5.5.2 ... need fully-qualified hostname`.
- **Cleanup.** `--cleanup` removes the old image after each successful swap so
  pulled layers don't accumulate.

**No pre-pull DB backup.** Unlike `update.sh`, watchtower does not snapshot the
DB before swapping. That's an accepted tradeoff: the nightly
`scripts/backup-db.sh` cron (see [Backups](#backups)) is the safety net. If a
release carries a risky migration and you want a fresh snapshot first, deploy
that one manually with `./deploy/update.sh` (which backs up first), or run
`scripts/backup-db.sh` by hand before pushing the tag.

**Interaction with `ALMANAC_TAG` rollback.** Watchtower keys off the *tag* a
container was started with — normally `:latest`. If you pin a rollback
(`ALMANAC_TAG=0.2.0`, see below), those containers run `:0.2.0`, which rarely
moves, so a pin won't get stomped by a new `:latest`. It also won't auto-resume
`:latest` updates until you clear `ALMANAC_TAG` and recreate. While pinned,
`update.sh` stays your deploy lever.

**To disable auto-deploy** (go back to fully-manual `update.sh`): remove the
`watchtower` service from `docker-compose.yml`, or stop it with
`docker compose stop watchtower`.

### The one-command update

[`deploy/update.sh`](update.sh) wraps pull-and-swap with a pre-deploy DB backup
and an API log tail:

```
cd "$ALMANAC_DIR"
./deploy/update.sh
```

It runs `scripts/backup-db.sh` -> `docker compose pull` -> `up -d` ->
`docker compose ps`, then tails `almanac-api` so a failing migration is visible
immediately (Ctrl-C to detach; the stack stays up).

Useful env overrides:

- `ALMANAC_TAG=0.2.0 ./deploy/update.sh` — pull and run a specific published tag
  instead of `latest`. The rollback lever (below). **Transient** — it affects
  only this invocation; the next bare `./deploy/update.sh` reverts to `:latest`.
  To pin durably, set `ALMANAC_TAG=0.2.0` in `$ALMANAC_DIR/.env`.
- `DRY_RUN=1 ./deploy/update.sh` — pull, then print the `up -d --dry-run`
  recreate plan and stop. Mutates nothing.
- `SKIP_BACKUP=1` — skip the DB snapshot (not recommended for a migration).
- `ALMANAC_DB_PATH=...` — override the SQLite path if your data dir isn't the
  default `./data/almanac.sqlite`.

### If a deploy goes wrong

Every published image stays in GHCR (tagged by version), so the fastest
rollback is to pin a prior tag and redeploy:

```
cd "$ALMANAC_DIR"
ALMANAC_TAG=0.2.0 ./deploy/update.sh
```

This is **transient** — the next bare `./deploy/update.sh` goes back to
`:latest`. To make the rollback stick while you sort out the bad release,
persist `ALMANAC_TAG=0.2.0` in `$ALMANAC_DIR/.env`, then unset it once a good
`latest` is published.

If a migration corrupted data, restore the snapshot `update.sh` took just
before (newest file in `data/backups/`), then bring the prior images back:

```
docker compose down
cp data/backups/almanac-<stamp>.sqlite data/almanac.sqlite
ALMANAC_TAG=0.2.0 docker compose pull
ALMANAC_TAG=0.2.0 docker compose up -d
```

Old pulled images accumulate. Periodically — but **never right before a
deploy** — reclaim space:

```
docker image prune -f
```

## Backups

Wire `scripts/backup-db.sh` into a cron job. The script honors `ALMANAC_DB_PATH`,
so the server's data directory works without edits. Use absolute paths — cron
doesn't see your shell's `$ALMANAC_DIR`:

```
crontab -e
# Adjust the path to your deploy dir. The MAILTO + redirect below mail you
# ONLY on failure: stdout goes to the log (successful runs stay silent), while
# stderr flows to cron, which mails it. backup-db.sh exits non-zero and writes
# to stderr on failure (db locked, disk full, sqlite3 missing).
MAILTO=you@example.com
0 4 * * * cd $HOME/almanac && ALMANAC_DB_PATH=$HOME/almanac/data/almanac.sqlite ./scripts/backup-db.sh >> $HOME/almanac-backup.log
```

**Cron email needs a working MTA.** The `MAILTO` line only delivers if the box
has postfix/sendmail/msmtp installed and relaying somewhere you read. Minimal
server installs often ship none, in which case the mail is silently dropped.
Verify with a deliberately-failing run (e.g. point `ALMANAC_DB_PATH` at a
nonexistent file) before trusting it. If the box has no MTA, drop `MAILTO`, keep
`2>&1` to fold stderr into the log, and monitor the logfile (or an external
dead-man's-switch like healthchecks.io) instead.

Backups land in `<deploy-dir>/data/backups/`. Once you have a weekly rhythm,
move them off-server (S3, Backblaze, etc.) — recommended.

## Appendix: importing an existing database

Skip this for a fresh install. It applies only if you've been running Almanac
elsewhere (locally, or a prior host) and want to bring that data to the server.

Copy the existing SQLite file into the server's `data/` directory — the host
side of compose's `./data:/data` mount — **before first boot**:

```
mkdir -p "$ALMANAC_DIR"/data
scp /path/to/almanac.sqlite you@server:"$ALMANAC_DIR"/data/almanac.sqlite
```

Keep a snapshot of the source DB somewhere safe first, in case you need to redo
the import. Then boot as in Step 8; the migration runner brings the schema
current on startup.
