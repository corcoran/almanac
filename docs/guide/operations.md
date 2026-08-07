---
title: Operations
---

# Operations

Running an Almanac deploy after the initial stand-up: shipping updates, rolling
one back, taking backups, and verifying that a deploy actually landed.

If you haven't stood the stack up yet, start with [Deploy](/guide/deploy). This
page assumes a running stack, a `$ALMANAC_DIR` on the server, and the
operational file set from Step 4 of that page.

```bash
export ALMANAC_DIR=~/almanac
cd "$ALMANAC_DIR"
```

## Updating a running deploy

After the one-time stand-up, a deploy is just two moves, and the second one is
automatic.

**1. Cut a release.** From `master`, run the release script with the bump you
want. It computes the next version, checks the tree is clean and up to date,
requires a matching `CHANGELOG.md` entry, and prompts before tagging and
pushing:

```bash
scripts/push-tag.sh patch    # or: minor | major
```

Pushing the tag triggers the release workflow
([`.github/workflows/release.yml`](https://github.com/corcoran/almanac/blob/master/.github/workflows/release.yml)),
which builds the api/web/mcp images and publishes them to GHCR tagged by
version, `latest`, and the short commit SHA. Wait for the workflow to finish —
the images must exist before the server can pull them.

::: tip Verify the release before expecting the server to move
Two things must be true. First, the tag reached origin:

```bash
git ls-remote --tags origin "vX.Y.Z"
```

Second, the workflow finished successfully — a failed build leaves no new
image, and watchtower will sit there having nothing to pull:

```bash
gh run list --workflow=release.yml --limit 5
```

Until that run is green, nothing on the server will change. If you find
yourself debugging a "stale" server, check this first.
:::

**2. Pull and swap.** This happens **automatically**: the `watchtower` service
polls GHCR and recreates the changed containers within ~5 minutes of the new
`:latest` images landing. You don't have to SSH in. The manual
`./deploy/update.sh` remains as the rollback / force lever (see
[If a deploy goes wrong](#if-a-deploy-goes-wrong)).

**This is not zero-downtime.** Compose recreates each changed container
stop-then-start, so each service has a brief gap (seconds) while its container
restarts. For a single-user or small-group tracker that's fine. The recreate is
ordered: per `docker-compose.yml`, `oauth2-proxy` waits on the api/mcp/web
healthchecks and `almanac-mcp` waits on `almanac-api`, so the proxy only swings
onto the API once `/api/v1/health` is green (its `start_period` covers
migrations running on boot).

::: tip Verify the server actually took the update
The health route reports the running build, so this is a direct answer rather
than an inference:

```bash
curl -sf http://127.0.0.1:24180/api/v1/health | jq .
```

Compare `version` and `commit` against the release you just cut. `commit` is the
git SHA baked into the image at build time — if it still shows the old value,
the swap has not happened yet (or has failed). Also confirm
`migrations_applied` moved if the release carried a migration.

From your laptop rather than the server, the same route is public:

```bash
curl -sf https://almanac.example.com/api/v1/health | jq '.version, .commit'
```
:::

**If the version doesn't move within ~10 minutes**, work through it in this
order:

1. **Did the image publish?** `gh run list --workflow=release.yml` — a red run
   means there is nothing to pull.
2. **Is watchtower running and looking?** `docker logs almanac-watchtower`
   shows each poll cycle. With `WATCHTOWER_POLL_INTERVAL: "300"` you should see
   activity at least every five minutes.
3. **Is the container labelled?** Watchtower runs with `--label-enable` and only
   touches containers carrying
   `com.centurylinklabs.watchtower.enable=true`:
   ```bash
   docker inspect -f '{{index .Config.Labels "com.centurylinklabs.watchtower.enable"}}' almanac-api
   ```
   That must print `true`.
4. **Is a tag pinned?** If `ALMANAC_TAG` is set in `.env`, the container is
   running a version tag that rarely moves and watchtower has nothing to do:
   ```bash
   grep -n '^ALMANAC_TAG' "$ALMANAC_DIR/.env"
   ```
5. **Force it manually.** `./deploy/update.sh` pulls and swaps immediately, and
   tails the API log so a failing migration is visible.

### Auto-deploy (watchtower)

The `watchtower` service in `docker-compose.yml` makes deploys hands-off: it
polls GHCR every 5 minutes and, when a watched service's `:latest` digest
changes, pulls the new image and recreates that container — dependency-ordered,
respecting healthchecks, the same as `update.sh` does manually. **After the
one-time setup, a deploy is just step 1: tag and push. The server updates
itself.**

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

::: tip Verify watchtower is configured the way you think
Confirm the poll interval, label scoping, and cleanup are in effect:

```bash
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' almanac-watchtower \
  | grep WATCHTOWER
```

You should see `WATCHTOWER_LABEL_ENABLE=true`, `WATCHTOWER_CLEANUP=true`, and
`WATCHTOWER_POLL_INTERVAL=300`. Then watch it work:

```bash
docker logs --tail=50 almanac-watchtower
```

Silence in that log for well over five minutes means it isn't polling — check
whether the container is actually up with `docker compose ps`.
:::

::: warning Notifications are off unless you set a recipient
`WATCHTOWER_EMAIL_TO` defaults to blank in `.env.example`, which disables
notifications entirely. Watchtower then fails silently — a broken pull looks
exactly like a quiet week. Either set a recipient and confirm the mail actually
arrives, or treat the health-route `commit` check above as your only signal and
run it deliberately after each release.
:::

**No pre-pull DB backup.** Unlike `update.sh`, watchtower does not snapshot the
DB before swapping. That's an accepted tradeoff: the nightly
`scripts/backup-db.sh` cron (see [Backups](#backups)) is the safety net. If a
release carries a risky migration and you want a fresh snapshot first, deploy
that one manually with `./deploy/update.sh` (which backs up first), or run
`scripts/backup-db.sh` by hand before pushing the tag.

There is a second, narrower safety net that costs you nothing: the API itself
snapshots the database at startup whenever there are **pending migrations**,
writing `data/backups/pre-<tag>-<timestamp>.sqlite` and logging `pre-migration
snapshot written` with the path. A plain restart with no schema change writes
nothing. That covers the watchtower path — but it is a last resort, not a
substitute for scheduled backups, because it only ever captures the moment
immediately before a migration.

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

`deploy/update.sh` wraps pull-and-swap with a pre-deploy DB backup and an API
log tail:

```bash
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

::: tip Rehearse before you commit to a swap
`DRY_RUN=1` pulls the images and prints exactly which services would be
recreated, changing nothing:

```bash
DRY_RUN=1 ./deploy/update.sh
```

The script pulls first and then short-circuits before `up -d`, so this both
warms the image cache and tells you the blast radius. If the plan lists
services you didn't expect to move, stop and find out why before running it for
real.
:::

::: tip Verify a manual update landed
`update.sh` ends by printing `docker compose ps` and then tailing
`almanac-api`. Read both — the tail is where a failing migration surfaces.
After detaching with Ctrl-C, confirm the running build:

```bash
docker compose ps
curl -sf http://127.0.0.1:24180/api/v1/health | jq '.version, .commit, .migrations_applied'
```
:::

**`update.sh` fails on its first line** — it preflights `docker compose
version` and exits 1 if Compose isn't reachable. It also runs
`./scripts/backup-db.sh` relative to the repo root it derives from its own
location, so a sparse checkout missing `scripts/` breaks here. Confirm both
exist:

```bash
docker compose version
ls -l "$ALMANAC_DIR/scripts/backup-db.sh"
```

**The backup step fails** — `backup-db.sh` exits non-zero when the database
file doesn't exist at `ALMANAC_DB_PATH` or when the `sqlite3` CLI isn't
installed on the host, and it names which in the error. Fix the cause rather
than reaching for `SKIP_BACKUP=1`; skipping the snapshot before a migration is
exactly the situation the snapshot exists for.

### If a deploy goes wrong

Every published image stays in GHCR (tagged by version), so the fastest
rollback is to pin a prior tag and redeploy:

```bash
cd "$ALMANAC_DIR"
ALMANAC_TAG=0.2.0 ./deploy/update.sh
```

This is **transient** — the next bare `./deploy/update.sh` goes back to
`:latest`. To make the rollback stick while you sort out the bad release,
persist `ALMANAC_TAG=0.2.0` in `$ALMANAC_DIR/.env`, then unset it once a good
`latest` is published.

::: tip Verify the rollback took
The health route's `version` should now report the pinned release:

```bash
curl -sf http://127.0.0.1:24180/api/v1/health | jq '.version, .commit'
```

If it still shows the bad build, the pinned tag probably doesn't exist in GHCR —
`docker compose pull` would have errored. Scroll back through the `update.sh`
output for the pull failure rather than assuming the swap silently declined.
:::

::: warning A rollback does not undo a migration
Migrations run forward on boot and have no down-path. Pinning an older image
gets you older *code* against a database that has already been migrated
forward. That is usually harmless — but if the bad release's migration is what
broke you, code rollback alone will not fix it. Restore the snapshot as well,
per the next block.
:::

If a migration corrupted data, restore the snapshot `update.sh` took just
before (newest file in `data/backups/`), then bring the prior images back:

```bash
docker compose down
cp data/backups/almanac-<stamp>.sqlite data/almanac.sqlite
ALMANAC_TAG=0.2.0 docker compose pull
ALMANAC_TAG=0.2.0 docker compose up -d
```

Find the right snapshot before you copy anything. `backup-db.sh` writes
`almanac-<UTC-stamp>.sqlite`; the API's own pre-migration snapshots are named
`pre-<tag>-<UTC-stamp>.sqlite`. Newest last:

```bash
ls -lt "$ALMANAC_DIR/data/backups/" | head
```

::: danger Move the current database aside; don't overwrite it
The `cp` above destroys the live file. If your diagnosis is wrong, that is
unrecoverable. Rename instead of clobbering, so you can go back:

```bash
docker compose down
mv data/almanac.sqlite data/almanac.sqlite.broken
cp data/backups/almanac-<stamp>.sqlite data/almanac.sqlite
```

Also remove any stale `-wal` / `-shm` siblings of the old file before booting —
SQLite in WAL mode leaves them behind, and a journal from a different database
file is not something you want the API to open.
:::

::: tip Verify the restore
Check the file is a valid SQLite database and that it holds the data you
expect, *before* bringing the stack back up:

```bash
sqlite3 data/almanac.sqlite "PRAGMA integrity_check;"
sqlite3 data/almanac.sqlite "SELECT id, email FROM users;"
```

`integrity_check` must print `ok`. Then boot, and confirm the API comes up
healthy:

```bash
ALMANAC_TAG=0.2.0 docker compose up -d
docker compose ps
curl -sf http://127.0.0.1:24180/api/v1/health | jq .
```
:::

Old pulled images accumulate. Periodically — but **never right before a
deploy** — reclaim space:

```bash
docker image prune -f
```

The reason for the timing caveat: pruning removes the older image layers you
would roll back *to*. Prune when you're confident in the current release, not
while you're standing next to a fresh one.

## Backups

Wire `scripts/backup-db.sh` into a cron job. The script honors `ALMANAC_DB_PATH`,
so the server's data directory works without edits. Use absolute paths — cron
doesn't see your shell's `$ALMANAC_DIR`:

```bash
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

### How the script behaves

Worth knowing before you rely on it:

- It uses `sqlite3 .backup`, the **online backup API**, so it is safe to run
  while the API holds the database open. It also forces a WAL checkpoint into
  the snapshot, so the output is a single self-contained file — you do not need
  to copy `-wal` / `-shm` alongside it.
- Output is `data/backups/almanac-<UTC-stamp>.sqlite`, where the stamp is
  `YYYYMMDDTHHMMSSZ`.
- It **prunes automatically**, keeping the newest 30 by default. Override with
  `ALMANAC_BACKUP_KEEP`.
- It exits non-zero with a message on stderr when the database file is missing
  or the `sqlite3` CLI isn't installed.

::: tip Verify before you trust the schedule
Run it by hand first — this is a read-only operation against the live database:

```bash
cd "$ALMANAC_DIR"
./scripts/backup-db.sh
echo "exit: $?"
```

A successful run prints a `backup:` line with the output path and size, any
`pruned:` lines, and a `kept: N backup(s) in ...` summary. Then confirm the
snapshot is actually usable — a backup you have never opened is a hypothesis,
not a backup:

```bash
ls -lt data/backups/ | head -3
sqlite3 "$(ls -t data/backups/almanac-*.sqlite | head -1)" \
  "PRAGMA integrity_check; SELECT COUNT(*) FROM users;"
```

`ok` from `integrity_check` and a plausible user count.
:::

::: warning Confirm cron ran, don't assume it
The most common backup failure is a cron entry that never fires — a missing
`sqlite3` on the `PATH` cron uses, a wrong directory, or a crontab edited under
a different user than the one that owns `$ALMANAC_DIR`. The morning after you
add the entry, check the log and the directory:

```bash
tail -20 "$HOME/almanac-backup.log"
ls -lt "$ALMANAC_DIR/data/backups/" | head -3
```

The newest snapshot should be from last night's run. If the log is empty,
compare `crontab -l` against the block above and check `ALMANAC_BACKUP_KEEP`
isn't pruning faster than you expect.
:::

::: danger A backup on the same disk is not a backup
`data/backups/` shares the disk, the filesystem, and the failure domain with
the live database. It protects against a bad migration; it does not protect
against disk failure, a deleted directory, or a lost server. Copy the snapshots
off the host on whatever cadence matches how much data you can afford to
re-enter.
:::

## The post-migration smoke test

`deploy/post-migration-smoke.sh` exercises a freshly-deployed stack end to end.
Run it after the initial stand-up and after any update that carries a
migration.

```bash
cd "$ALMANAC_DIR"
TEST_EMAIL=you@example.com bash deploy/post-migration-smoke.sh
```

It runs **inside the docker network**, using a throwaway
`curlimages/curl` sidecar on the compose network, because oauth2-proxy (the
public listener on `127.0.0.1:24180`) doesn't accept inbound
`X-Forwarded-Email` as auth — it only *emits* that header after an SSO session.
The only host tools needed are `docker` and `jq`.

Requirements the script checks or assumes:

- `docker` and `jq` on the host — it aborts with `missing tool on host` if
  either is absent
- the compose stack is running; it aborts if `almanac-api` isn't in
  `docker compose ps --status running`
- `TEST_EMAIL` is set — it exits immediately if not
- the compose project name defaults to `almanac`; override with
  `COMPOSE_PROJECT_NAME` if your deploy directory has a different basename, or
  the sidecar will attach to a network that doesn't exist

What the seven steps prove, in order:

| Step | Check | What a failure tells you |
| --- | --- | --- |
| 1 | `/api/v1/health` internally, then publicly through oauth2-proxy | Internal failure = the API is down. Public failure = the `--skip-auth-route=^/api/v1/health$` rule is missing. |
| 2 | `/api/v1/auth/whoami` with `X-Forwarded-Email` | The API isn't trusting proxy headers — check `ALMANAC_TRUST_PROXY_HEADERS=true`. |
| 3 | `POST /api/v1/auth/tokens` mints a PAT | Token minting is broken, or `TEST_EMAIL` isn't allowlisted. |
| 4 | `GET /api/v1/users/me` with `Authorization: Bearer` | Bearer auth path is broken. |
| 5 | `POST /mcp` initialize handshake with the PAT | 401 = PAT bad or revoked. 404 = MCP upstream misrouted; check `docker compose logs almanac-mcp`. |
| 6 | `DELETE /api/v1/auth/tokens/:id` revokes | Revocation is broken. |
| 7 | The revoked PAT is rejected with 401 | Revocation isn't taking effect — a serious auth finding. |

::: tip Verify
The script is `set -euo pipefail` and aborts on the first failure, so exit
status is the whole signal:

```bash
TEST_EMAIL=you@example.com bash deploy/post-migration-smoke.sh
echo "exit: $?"
```

`exit: 0` and a closing `All smoke checks passed.` A failure prints a `FAIL:`
line naming the step, and the table above maps that to a cause.
:::

::: warning It mints and revokes a real token
Step 3 creates a PAT named `smoke-test` against `TEST_EMAIL`'s user, and step 6
revokes it. If the script aborts between those two steps, that token is left
live — check Settings → Tokens and revoke it by hand.
:::

**Step 5 returning 2xx, 400, or 406 is success**, not a partial pass. The script
accepts all three because a barebones POST that doesn't advertise SSE in its
`Accept` header commonly gets a 406, and any of the three proves the auth and
transport layers are alive. Only 401, 404, and unexpected codes are failures.

## Appendix: importing an existing database

Skip this for a fresh install. It applies only if you've been running Almanac
elsewhere (locally, or a prior host) and want to bring that data to the server.

Copy the existing SQLite file into the server's `data/` directory — the host
side of compose's `./data:/data` mount — **before first boot**:

```bash
mkdir -p "$ALMANAC_DIR"/data
scp /path/to/almanac.sqlite you@server:"$ALMANAC_DIR"/data/almanac.sqlite
```

Keep a snapshot of the source DB somewhere safe first, in case you need to redo
the import. Then boot as in Step 8; the migration runner brings the schema
current on startup.

::: danger Copy the WAL, or copy a checkpointed snapshot
A live Almanac database runs in WAL mode, which means recent writes may sit in
the `-wal` sibling rather than the main file. `scp`-ing only
`almanac.sqlite` from a running instance can silently leave the newest data
behind — and the main file's mtime will not warn you, because it doesn't
change on every write.

Take a checkpointed snapshot at the source instead and copy that. The backup
script does exactly this:

```bash
# on the source machine
./scripts/backup-db.sh
scp data/backups/almanac-<stamp>.sqlite you@server:"$ALMANAC_DIR"/data/almanac.sqlite
```

`sqlite3 .backup` forces the WAL into the output, so the result is a single
self-contained file with nothing left behind.
:::

::: tip Verify before first boot
Confirm the file arrived intact and holds the accounts you expect. Do this
*before* `docker compose up -d`, while a mistake is still cheap:

```bash
cd "$ALMANAC_DIR"
sqlite3 data/almanac.sqlite "PRAGMA integrity_check;"
sqlite3 data/almanac.sqlite "SELECT id, email, is_admin FROM users;"
```

`integrity_check` prints `ok`, and the `users` table lists your real accounts.
If `users` is empty or the file doesn't parse, do not boot — you'll be creating
a fresh instance and the first-admin bootstrap will fire against an empty table
(see [Deploy Step 9](/guide/deploy#step-9-first-browser-login)).
:::

::: tip Verify after first boot
The migration runner brings an imported schema forward on startup. Confirm it
ran and that your data survived:

```bash
docker compose logs --tail=100 almanac-api | grep -i 'pre-migration snapshot'
curl -sf http://127.0.0.1:24180/api/v1/health | jq '.migrations_applied'
sqlite3 data/almanac.sqlite "SELECT COUNT(*) FROM users;"
```

Because an imported database usually has pending migrations, the API writes its
own `data/backups/pre-<tag>-<stamp>.sqlite` snapshot before applying them and
logs the path — that is your rollback point if the import goes sideways.
:::

**File ownership matters.** The container writes to `/data` through the
`./data:/data` bind mount. An imported file copied in as `root` may not be
writable by the container's user, and SQLite also needs to create `-wal` and
`-shm` siblings in that directory. If the API logs a read-only or permission
error on boot, check ownership on both the file and the directory.

## Next steps

- [Deploy](/guide/deploy) — the one-time stand-up
- [Authentication](/guide/authentication) — OAuth setup and auth failure modes
- [Configuration](/guide/configuration) — every environment variable
