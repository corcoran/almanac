# Almanac Deploy Runbook

This is the runbook for deploying Almanac to a publicly-hosted server
behind nginx + oauth2-proxy + Docker Compose. Target audience: the
operator (you) doing this once.

The companion design doc is
[`docs/superpowers/specs/2026-06-04-ci-ghcr-deploy-design.md`](../docs/superpowers/specs/2026-06-04-ci-ghcr-deploy-design.md);
this README is the operator-facing walkthrough of that spec. It supersedes the
build-on-server flow from the earlier
[`docs/superpowers/specs/2026-05-22-deployment-design.md`](../docs/superpowers/specs/2026-05-22-deployment-design.md):
images are now built in CI and published to GHCR, and the server pulls them
rather than building locally.

## Prerequisites

- A Linux server with:
  - Docker Engine >= 24 + Docker Compose v2 plugin
  - nginx
  - certbot (or your preferred ACME client)
  - A real domain you control (e.g. `almanac.yourdomain.com`)
- A Google OAuth client created in the Google Cloud Console (this is the
  same shape as the one used by your existing oauth2-proxy stack, if any).
- SSH access to the server with sudo.

## Architecture overview

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

- **Browser** -> cookie via oauth2-proxy -> forwards `X-Forwarded-Email` to api
- **MCP client** -> personal access token -> bypasses oauth2-proxy via
  `--skip-auth-route=^/mcp/`, validated directly by almanac-mcp / almanac-api

## The deploy directory

Almanac's source lives in a deploy directory on the server, and **its path
varies by site** — there's no fixed `~/almanac`. On prod it's
`~/sync/almanac`, for example. Throughout this runbook, `$ALMANAC_DIR` stands
in for whatever that path is on the box you're on. Set it once per shell
session so the commands below paste cleanly:

```
export ALMANAC_DIR=~/sync/almanac    # adjust per site
cd "$ALMANAC_DIR"
```

(`deploy/update.sh` doesn't need this — it derives its own location and `cd`s
to the repo root itself, so `./deploy/update.sh` works from anywhere in the
tree.)

## Step 1: DNS

Point `almanac.yourdomain.com` (or whatever subdomain you want) at your
server's public IP. Wait for propagation:

```
dig +short almanac.yourdomain.com
```

should return the right IP.

## Step 2: TLS certificate

```
sudo certbot certonly --nginx -d almanac.yourdomain.com
```

Should land certs at `/etc/letsencrypt/live/almanac.yourdomain.com/`.

## Step 3: Host nginx vhost

Copy and customize the template:

```
sudo cp "$ALMANAC_DIR"/deploy/nginx-almanac.conf \
        /etc/nginx/sites-available/almanac.conf
sudo sed -i 's/__DOMAIN__/almanac.yourdomain.com/g' \
        /etc/nginx/sites-available/almanac.conf
sudo ln -s /etc/nginx/sites-available/almanac.conf \
           /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

At this point requests to `https://almanac.yourdomain.com` return 502 —
nothing is listening on 24180 yet. That's expected; the next steps fix it.

## Step 4: Put Almanac on the server

The server no longer builds anything — images come from GHCR (see "Updating a
running deploy" below). It does not need the source tree at all. The full
**minimal operational file set** is:

| File | Why the server needs it |
| --- | --- |
| `docker-compose.yml` | the stack definition |
| `allowed-users.txt` | the oauth2-proxy / API email allowlist |
| `scripts/backup-db.sh` | DB snapshot (cron + `update.sh` call it) |
| `deploy/update.sh` | manual pull / rollback lever |
| `deploy/post-migration-smoke.sh` | post-deploy smoke test |
| `deploy/nginx-almanac.conf` | host nginx vhost template |
| `data/` (directory) | live SQLite + backups live here |

Plus a `.env` — but that one is **managed directly on the server**, never
synced (see below). That's it — no `packages/`, no `node_modules`, no git
checkout required.

**Getting those files onto the box.** Two supported ways:

- **A continuously-synced folder** (the prod setup). The laptop has a
  Syncthing-mirrored directory (`~/sites/almanac`) that pushes to the server's
  `$ALMANAC_DIR`. The server's Syncthing folder is **receive-only**, so it never
  pushes local server edits back. [`deploy/sync-to-server.sh`](sync-to-server.sh)
  stages *only* the files above from your working tree into that synced folder —
  run it whenever `docker-compose.yml` / scripts change:

  ```
  ./deploy/sync-to-server.sh                 # stages into ~/sites/almanac
  DEST_DIR=~/other/sync ./deploy/sync-to-server.sh
  DRY_RUN=1 ./deploy/sync-to-server.sh       # preview, write nothing
  ```

  **`.env` is deliberately not staged.** Because the server folder is
  receive-only, any `.env` placed in the synced folder would propagate and
  overwrite the server's prod secrets. So the script never touches `.env` at
  all — create and edit it directly on the server at `$ALMANAC_DIR/.env`
  (Step 6).

- **A one-off sparse checkout / `git clone`** of just those files, if you're not
  using a sync folder. Point `$ALMANAC_DIR` at the result and `cd` in:

  ```
  export ALMANAC_DIR=~/sync/almanac    # adjust per site
  git clone <repo-url> "$ALMANAC_DIR"   # or sparse-checkout the deploy files
  cd "$ALMANAC_DIR"
  ```

## Step 5: Google OAuth console

In Google Cloud Console -> your OAuth client -> Authorized redirect URIs,
add `https://almanac.yourdomain.com/oauth2/callback`.

## Step 6: `.env` at `$ALMANAC_DIR/.env`

Create the env file (NOT committed). Start from `.env.example` and fill in:

```
cp .env.example .env
vim .env
```

Required values for deploy:

- `OAUTH2_PROXY_CLIENT_ID` — from Google OAuth Console
- `OAUTH2_PROXY_CLIENT_SECRET` — from Google OAuth Console
- `OAUTH2_PROXY_COOKIE_SECRET` — generate fresh, do NOT reuse:
  ```
  python -c 'import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'
  ```
- `OAUTH2_PROXY_REDIRECT_URL=https://almanac.yourdomain.com/oauth2/callback`
- `ALMANAC_MCP_CLIENT_TOKEN` — leave as a placeholder for the server deploy.
  Compose runs the MCP server in `transport=http` (the default), and in that
  mode the env var is NOT consumed — each incoming MCP client connection
  brings its own PAT in the Authorization header, validated by the API.
  Set it to any string, or remove the line entirely. (The var still matters
  for operators running an `ALMANAC_MCP_TRANSPORT=stdio` MCP locally pointed
  at the server's API — there it's the PAT the stdio process uses.)
- `ALMANAC_FIRST_LOGIN_EMAIL=your-email@gmail.com` — **ONE-SHOT**. Binds
  your existing `user_id=1` row to your Google email on first boot. Remove
  this line after step 11 below.

## Step 7: `allowed-users.txt`

```
cp allowed-users.txt.example allowed-users.txt
vim allowed-users.txt
```

One email per line. Start with just your own; add friends later.

## Step 8: Data migration (optional — only if you have an existing laptop DB)

If you've been using Almanac locally and want your historical data on the
server: copy the laptop's SQLite over.

On your laptop (the server target is your deploy dir's `data/` — that's the
host side of compose's `./data:/data` mount):

```
scp ~/Work/almanac/data/almanac.sqlite \
    you@server:<your-deploy-dir>/data/almanac.sqlite
```

If you're starting fresh on the server, skip this — the API will create
a blank DB on first boot.

(Even if you're skipping, ensure the directory exists:)

```
mkdir -p "$ALMANAC_DIR"/data
```

## Step 9: Snapshot the laptop DB (only if you did step 8)

Your laptop's SQLite is the canonical source of truth right now. Before
the server starts mutating its copy, snapshot the laptop version:

```
cp ~/Work/almanac/data/almanac.sqlite \
   ~/almanac-snapshot-"$(date +%Y%m%d-%H%M)".sqlite
```

If anything goes wrong in the next steps, you can re-scp this snapshot
back into place.

## GHCR login (one-time)

The almanac images live in a **private** GHCR namespace
(`ghcr.io/corcoran/almanac-{api,web,mcp}`), so the server has to authenticate
before it can pull. Do this once per server.

Create a **classic** GitHub Personal Access Token scoped to **`read:packages`
only** (not the fine-grained kind — classic, single scope). Then log Docker in.
The prod server runs fish:

```fish
read -s -P "PAT: " GHCR_PAT
echo $GHCR_PAT | docker login ghcr.io -u corcoran --password-stdin
```

bash equivalent:

```bash
read -s -p "PAT: " GHCR_PAT
echo "$GHCR_PAT" | docker login ghcr.io -u corcoran --password-stdin
```

**Run this as the same user that runs `./deploy/update.sh`.** The credential is
written to that user's `~/.docker/config.json` and is per-user — logging in as
`root` or some other account won't help the user who actually deploys.

When the PAT expires or is revoked, `docker compose pull` starts failing with
`denied` / `unauthorized` — **and so does watchtower's auto-pull** (it reuses
this same `~/.docker/config.json`), which then silently stops shipping releases.
The fix is to mint a fresh `read:packages` classic PAT and re-run the `docker
login` above; watchtower picks up the refreshed creds on its next poll. Set
`WATCHTOWER_EMAIL_TO` (see [Auto-deploy](#auto-deploy-watchtower)) so a failed
pull lands in your inbox instead of going unnoticed.

## Step 10: First boot

First boot **pulls** the published images rather than building them. This
requires the GHCR login above to be done first, and at least one release to
have been published to GHCR (see "Updating a running deploy" for how releases
are cut).

```
cd "$ALMANAC_DIR"
docker compose pull
docker compose up -d
docker compose logs -f almanac-api
```

Watch for:

- migrations applied (`Applied migration 7` etc.)
- `Server listening at http://0.0.0.0:3001`
- (If you set `ALMANAC_FIRST_LOGIN_EMAIL`): a log line indicating the
  email binding fired

Then in another terminal:

```
docker compose ps
```

All four containers should be "Up."

## Step 11: Verify the email binding

```
docker compose exec almanac-api sh -c \
  "node -e 'const db=require(\"better-sqlite3\")(\"/data/almanac.sqlite\"); console.log(db.prepare(\"SELECT id, name, email FROM users\").all())'"
```

You should see your `user_id=1` with `email` set to your Google email. If
not, the binding hook didn't fire — re-check `ALMANAC_FIRST_LOGIN_EMAIL`
in `.env` and that there's a `user_id=1` row with `email IS NULL`.

## Step 12: Remove the one-shot env var

After step 11 confirms the binding, edit `$ALMANAC_DIR/.env` and remove the
`ALMANAC_FIRST_LOGIN_EMAIL=...` line. Then:

```
docker compose up -d almanac-api
```

The container picks up the absence and skips the hook on all future boots.

## Step 13: First browser login

Visit `https://almanac.yourdomain.com/`. Click through Google SSO. You
should land on the SPA with your historical data rendered (if you
migrated) or a blank slate (if you didn't).

## Step 14: Mint your first PAT

Click the user icon (top-right) -> Settings -> Tokens -> "Create token."
Name it something like "Claude Desktop on my laptop." The cleartext is
shown ONCE — copy it immediately.

## Step 15: Configure Claude Desktop / Code / ChatGPT

In your MCP config, point at the hosted MCP:

```jsonc
{
  "mcpServers": {
    "almanac": {
      "url": "https://almanac.yourdomain.com/mcp/",
      "headers": { "Authorization": "Bearer alm_<your-token>" }
    }
  }
}
```

Restart your client. The `ping` tool should return `{ok: true, ...}`.

## Step 16: Add friends

For each friend:

1. Append their email to `$ALMANAC_DIR/allowed-users.txt` (oauth2-proxy
   reloads on file change — no container restart).
2. Tell them to visit `https://almanac.yourdomain.com/`.
3. First Google sign-in auto-provisions their user row.
4. They go to Settings -> Tokens -> mint their own PAT for their MCP client.

## Updating a running deploy

Steps 1–16 are the one-time stand-up. For every deploy *after* that — new
code, a bugfix, a migration — you want to swap in fresh images without
tearing the stack down first.

Source does **not** need to be synced to the server anymore. Images are built
in CI and published to GHCR, so the server's job is just to pull and swap. A
deploy is now two moves:

**1. Cut a release (from your laptop).** Tag the commit you want to ship and
push the tag. That push triggers the release workflow
([`.github/workflows/release.yml`](../.github/workflows/release.yml)), which
builds the api/web/mcp images and publishes them to
`ghcr.io/corcoran/almanac-{api,web,mcp}` tagged by version, `latest`, and the
short commit SHA:

```
git tag v0.3.0
git push origin v0.3.0
```

Wait for the workflow to finish (the images must exist before the server can
pull them).

**2. Pull + swap (on the server).** This happens **automatically** — the
`watchtower` service polls GHCR and recreates the changed containers within
~5 minutes of the new `:latest` images landing. You don't have to SSH in. See
[Auto-deploy (watchtower)](#auto-deploy-watchtower) below for how it works and
how to disable it. The manual `./deploy/update.sh` still exists as the rollback
/ force lever (see [If a deploy goes wrong](#if-a-deploy-goes-wrong)).

**This is not zero-downtime.** Compose's default recreate is stop-then-start
per container, so each changed service has a brief gap (seconds) while its
single container restarts. For a single-user / small-group tracker that's
fine. The recreate *is* ordered, though: per
[`docker-compose.yml`](../docker-compose.yml), `oauth2-proxy` waits on the
api/mcp/web healthchecks and `almanac-mcp` waits on `almanac-api`, so the
proxy only swings onto the API once the API's `/api/v1/health` is green
(its `start_period` covers migrations running on boot).

### Auto-deploy (watchtower)

The `watchtower` service in [`docker-compose.yml`](../docker-compose.yml) makes
deploys hands-off: it polls GHCR every 5 minutes and, when a watched service's
`:latest` digest changes (i.e. you cut a release in step 1), pulls the new image
and recreates that container — dependency-ordered, respecting healthchecks, same
as `update.sh` does manually. **So after the one-time setup below, a deploy is
just step 1 — tag and push. The server updates itself.**

> **Image: the maintained fork.** The original `containrrr/watchtower` was
> archived 2025-12-17 (no further releases, fixes, or security updates), so the
> compose uses the community fork `ghcr.io/nicholas-fedor/watchtower`, which
> continues the same codebase. Labels, env vars, and the shoutrrr notifier are
> unchanged; only the image reference differs.

How it's scoped and wired:

- **Opt-in per service.** Watchtower runs with `--label-enable`, so it only
  touches containers carrying `com.centurylinklabs.watchtower.enable=true`. Just
  the three almanac services have it. **oauth2-proxy is deliberately excluded** —
  its image is pinned (`v7.6.0`) and must never auto-move.
- **Private-registry auth.** The almanac images are private, so watchtower mounts
  the deploying user's `~/.docker/config.json` (read-only) and pulls with the
  same creds your [`docker login ghcr.io`](#ghcr-login-one-time) wrote. **If that
  PAT expires, auto-pulls fail** — which is why the email below matters.
- **Email on update/error.** Watchtower mails via shoutrrr SMTP to your mail
  server (`mail.example.com:25`, no auth — it's our own relay). Turn it on by
  setting `WATCHTOWER_EMAIL_TO` in `$ALMANAC_DIR/.env`; leave it blank and
  watchtower runs silently (you'd only notice a stale app or a failed pull by
  checking `docker logs almanac-watchtower`). Server, port, from-address, and
  the HELO name have sensible defaults (see `.env.example`). **`WATCHTOWER_EMAIL_HELO`
  must be an FQDN** — shoutrrr's default HELO is the literal `localhost`, which a
  strict postfix rejects with `504 5.5.2 ... need fully-qualified hostname`; the
  default `almanac.example.com` satisfies it. (This is why the notifier is wired as
  a `WATCHTOWER_NOTIFICATION_URL` shoutrrr URL rather than the legacy
  `WATCHTOWER_NOTIFICATION_EMAIL_*` vars — only the URL form exposes `clienthost`,
  the HELO name.)
- **Cleanup.** `--cleanup` removes the old image after each successful swap so
  pulled layers don't accumulate.

**No pre-pull DB backup.** Unlike `update.sh`, watchtower does *not* snapshot the
DB before swapping. That's an accepted tradeoff here because the nightly
`scripts/backup-db.sh` cron (see [Backups](#backups)) is the safety net. If you're
shipping a release with a risky migration and want a fresh snapshot first, deploy
that one manually with `./deploy/update.sh` (which backs up first) instead of
letting watchtower pick it up — or just run `scripts/backup-db.sh` by hand before you
push the tag.

**Interaction with `ALMANAC_TAG` rollback.** Watchtower keys off the *tag* a
container was started with — always `:latest` here. If you pin a rollback
(`ALMANAC_TAG=0.2.0`, see [If a deploy goes wrong](#if-a-deploy-goes-wrong)),
those containers are now running `:0.2.0`, which watchtower also watches but
which rarely moves — so a pin won't get stomped by a new `:latest`. But it also
won't auto-resume `:latest` updates until you un-pin (clear `ALMANAC_TAG`) and
recreate. While pinned, `update.sh` stays your deploy lever.

**To disable auto-deploy** (go back to fully-manual `update.sh`): either remove
the `watchtower` service from `docker-compose.yml`, or stop it —
`docker compose stop watchtower` (it won't come back on `up -d` if you also
remove it, or will if it's only stopped and you re-`up`).

### The one-command version

[`deploy/update.sh`](update.sh) wraps the pull-and-swap with a pre-deploy DB
backup and an API log tail:

```
cd "$ALMANAC_DIR"
./deploy/update.sh
```

It: `scripts/backup-db.sh` → `docker compose pull` → `up -d` → `docker compose ps`
→ tails `almanac-api` so a failing migration is visible immediately (Ctrl-C
to detach; the stack stays up). It does **not** fetch source — there's nothing
to sync; the images come from GHCR. (It does require the [GHCR login](#ghcr-login-one-time)
to be in place for the deploying user.)

Useful env overrides:

- `ALMANAC_TAG=0.2.0 ./deploy/update.sh` — pull and run a specific published
  tag instead of `latest`. This is the rollback lever (below). **Transient:**
  it only affects this one invocation — the next bare `./deploy/update.sh`
  reverts to `:latest`. To pin it durably, set `ALMANAC_TAG=0.2.0` in
  `$ALMANAC_DIR/.env`.
- `DRY_RUN=1 ./deploy/update.sh` — pull, then print the `up -d --dry-run`
  recreate plan and stop. Shows exactly what *would* change, mutates nothing.
- `SKIP_BACKUP=1` — skip the DB snapshot (not recommended for a deploy that
  carries a migration).
- `ALMANAC_DB_PATH=...` — override the SQLite path if your data dir isn't the
  default `./data/almanac.sqlite`.

### If a deploy goes wrong

Every published image is still in GHCR (tagged by version), so the fastest
rollback is to pin a prior tag and redeploy:

```
cd "$ALMANAC_DIR"
ALMANAC_TAG=0.2.0 ./deploy/update.sh
```

Remember this is **transient** — the next bare `./deploy/update.sh` goes back
to `:latest`. If you need the rollback to stick (e.g. while you sort out the
bad release), persist `ALMANAC_TAG=0.2.0` in `$ALMANAC_DIR/.env`, then unset it
once a good `latest` is published again.

If a migration corrupted data, restore the snapshot `update.sh` took just
before (newest file in `data/backups/`), then bring the prior images back up:

```
docker compose down
cp data/backups/almanac-<stamp>.sqlite data/almanac.sqlite
ALMANAC_TAG=0.2.0 docker compose pull
ALMANAC_TAG=0.2.0 docker compose up -d
```

(Or, if `latest` is still the good one, just `docker compose pull && docker
compose up -d`.)

Old pulled images accumulate over time. Periodically — but **never right before
a deploy** — reclaim space:

```
docker image prune -f
```

## Smoke test

After step 15, run the post-migration smoke script. The script runs inside
the docker network (oauth2-proxy doesn't accept inbound `X-Forwarded-Email`
as auth; see the comment block at the top of the script) so the only host
tools needed are `docker` and `jq`:

```
cd "$ALMANAC_DIR"
TEST_EMAIL=your-email@gmail.com bash deploy/post-migration-smoke.sh
```

Should exit 0. Failures are diagnostic. The MCP step (5) accepts the
freshly-minted PAT directly — the MCP listener captures each connection's
Bearer and threads it to the API for validation. A 401 here means the PAT
itself is bad (revoked, or not bound to TEST_EMAIL's user).

## Backups

Wire the existing `scripts/backup-db.sh` into a cron job. The script honors
`ALMANAC_DB_PATH` so the server's data directory layout works without
edits:

```
crontab -e
# Add. Notes:
#  - Use a real absolute path — cron doesn't see your shell's $ALMANAC_DIR;
#    the example below is the prod dir, adjust per site.
#  - MAILTO + the redirect below mail you ONLY on failure: stdout goes to the
#    log (so successful nightly runs stay silent), but stderr flows to cron,
#    which mails it. scripts/backup-db.sh exits non-zero and writes to stderr on
#    failure (db locked, disk full, sqlite3 missing), so a broken backup
#    lands in your inbox instead of dying quietly in the log.
MAILTO=you@example.com
0 4 * * * cd ~/sync/almanac && ALMANAC_DB_PATH=$HOME/sync/almanac/data/almanac.sqlite ./scripts/backup-db.sh >> $HOME/almanac-backup.log
```

**Cron email requires a working MTA.** The `MAILTO` line only delivers if the
box has postfix/sendmail/msmtp installed and configured to relay somewhere you
actually read. Minimal server installs often ship none — in that case the mail
is generated and silently dropped. Verify with a deliberately-failing test run
(e.g. point `ALMANAC_DB_PATH` at a nonexistent file) and confirm the mail
arrives before trusting it. If the box has no MTA and you don't want to set one
up, drop `MAILTO`, keep `2>&1` to fold stderr back into the log, and monitor
the logfile (or an external dead-man's-switch like healthchecks.io) instead.

Backups land in `<deploy-dir>/data/backups/` per the existing script. Adjust
the destination path if you want them off-server (recommended once a
weekly rhythm is established).

## Rollback (if anything in steps 1-13 goes wrong)

```
cd "$ALMANAC_DIR"
docker compose down

# If you migrated the laptop DB and want to start over:
rm data/almanac.sqlite
# Re-scp from your snapshot:
cp ~/almanac-snapshot-*.sqlite data/almanac.sqlite

# Fix the issue, then retry from step 10.
```

Your laptop instance was never touched — keep using it while you debug
the server.

## Cleanup once the deploy is stable

After a week or two of stable use:

- Remove the laptop instance OR migrate its diff into the server
- Add off-site backups (S3, Backblaze, etc.) using the script output
