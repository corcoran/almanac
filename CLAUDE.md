# Almanac — Agent Notes

## Code navigation (LSP)

A TypeScript **LSP** tool is available (the `typescript-lsp` plugin, backed by
`typescript-language-server`). Prefer it over `grep` for **symbol-level** queries —
it's type-resolved, so it ignores `dist/` build output, comments, and same-name
false matches. Use it for: go-to-definition, find-references, hover (inferred
types), document/workspace symbols, and call hierarchy (who-calls-X / X-calls).

Two caveats specific to this repo:

- **Aim the cursor *inside* the identifier.** Positions are 1-based; targeting the
  very start of a declaration can resolve to the keyword instead of the name. Read
  the line first, then point a few chars into the symbol.
- **It's package-scoped — it misses cross-package barrel imports.** This is a pnpm
  monorepo where `api`/`web`/`mcp` import core symbols via `@almanac/core/*`
  barrels (not direct source paths), so `findReferences` on a `core` symbol won't
  list its `api`/`web` call sites. For an **exhaustive monorepo-wide sweep, pair
  LSP with a `grep` on the imported name** (as the release-removal work needed).

## Prose: comments, changelog, docs

**One operator, one deployment — nobody else has installed this.** Write for
someone who wants to get on with the task, not for a stressed stranger
migrating a fleet. Verbosity is the default failure mode here — every pass has
needed cutting, never expanding.

**There is no installed base, so there are no upgrade notes.** Never write "on
an existing deployment…", "before updating, add…", or a migration path for a
change that shipped in the same release. If a change needs an action, the user
takes it once, at deploy time, from the release notes — not from a permanent
warning box aimed at operators who do not exist. Document the *current* state
of things; the fact that it used to be different is git history.

**The filter: does this help the next reader do their job?** Not "is it true"
or "was it hard to work out". If it doesn't help, it's noise.

**Debugging a thing is not documenting it.** Errors hit while building a
feature — a mistyped redirect URI, a config that had to be tried twice — are
session detail, not permanent hazards. Write the setup step ("register this
callback"), not the failure you happened to see getting there. Existing
troubleshooting sections are a separate, deliberate thing; do not confuse
adding to them with narrating your own session.

- **Never explain WHY something was changed.** That's what git history is for.
  A comment saying what a line replaced, what bug it fixed, or which version
  it was verified against is noise — it goes in the commit message.
- **Do explain what is non-obvious right now.** A load-bearing invariant, a
  footgun that will bite, an ordering that looks arbitrary but isn't. Keep it
  to the fact and its consequence.
- **Comments go stale.** Anything naming a current default, a pinned version,
  or "we do X for now" will be wrong within months and nobody will notice.
- **Changelog entries: what changed, why it matters, one or two sentences.**
  Skip migration playbooks and risk framing — say the upgrade action only when
  there genuinely is one (e.g. "add this redirect URI first").
- **Docs: no stacked admonition boxes.** Three warnings restating the same
  caveat is worse than one sentence. Prefer a table to a paragraph.

Rough smell test: a comment longer than the function it describes, or a
changelog bullet longer than three lines, is probably explaining itself
rather than the code.

### Voice for user-facing prose

**Scope: everything under `docs/` and `README.md`.** Code comments and
changelog entries keep the rules above and are not covered here.

The goal is prose that reads like a sharp email to a smart friend, with no AI
signature on it.

Banned words: delve, harness, realm, testament, tapestry, cutting-edge,
elevate, foster, revolutionize.

No em-dashes anywhere. Use a comma, colon, period, or parentheses. This is the
loudest tell and the easiest to backslide on.

Vary sentence length, and never let three in a row share a structure or a
length. Short doesn't mean fragments: when two short sentences cover the same
thought, join them with a comma or a conjunction instead of stacking them. Save
the genuinely short sentence for when you want the beat.

Bullets are good, and encouraged for technical detail that someone will scan
rather than read. What's banned is the shape they usually take:

- **Bold lead-in.** Followed by an em-dash or a period, then the sentence.
- **Another one.** Repeated forty times down the page.

Write the bullet as a sentence instead. If a term needs emphasis, put it where
it falls naturally rather than always at the front.

Start at the value and stop when it's said. No "in this guide we'll", no
closing paragraph restating what was just read.

Active voice, contractions, specifics. Write 40 days, 768 px, two weeks of
weigh-ins, not "a configurable window" when the number is known.

`docs/guide/getting-started.md` and `README.md` are written this way and are
the reference. The other guide pages predate it and still carry em-dashes
throughout, so don't treat them as the model.

## Null safety

This codebase compiles with `noUncheckedIndexedAccess` (see `tsconfig.base.json`),
so indexed access (`arr[i]`) and optional fields are typed `T | undefined`. The
non-null assertion operator (`!`) is **lint-blocked** (`noNonNullAssertion` in
`biome.json`) — it overrides the compiler with zero runtime safety. Do not use it.

When a value is non-null, prove it at the source, in this priority order:

1. **Type-level narrowing** (no runtime cost):
   - Type-guard `.filter()` predicates: `arr.filter((x): x is Foo => x.id !== null)`
     — the result is narrowed, no `!` on later access.
   - Parse strings into named values instead of destructuring `.split()`:
     `const year = Number(s.slice(0, 4))` rather than `const [y] = s.split("-"); y!`.
   - Non-empty tuple types for by-construction-non-empty arrays:
     `readonly [T, ...T[]]`.
   - Control-flow narrowing: check `const`s with `!== undefined` before use.

2. **Throwing guards** (when the type can't express it):
   - `requireUserId(req)` (`packages/api/src/auth.ts`) — narrows the optional
     `req.userId` to `number` on authenticated routes, throws 401 otherwise.
   - `requireNonEmpty(arr, ctx)` / `first(arr)` / `last(arr)`
     (`packages/core/src/signals/array.ts`) — for arrays proven non-empty by an
     earlier guard or by construction.
   - In tests: `nthCall(mock, n)`, `at(arr, i)`, `defined(value, ctx)`
     (`packages/core/src/test-support/assertions.ts`) — replace `mock.calls[n]!`,
     `arr[i]!`, `found!`.

The guardrail (`noUncheckedIndexedAccess`) stays on. The fix for a `T | undefined`
is to handle the `undefined` case (narrow, guard, or fallback), never to assert it away.

### Vue files

`.vue` files are linted by biome (its `<script>` blocks are checked for
`noNonNullAssertion`), but `noUnusedVariables` / `noUnusedImports` are turned
off for `.vue` in the `overrides` block — biome can't see `<template>` usage of
`<script setup>` bindings, so those rules misfire. `vue-tsc` typechecks `.vue`
with `noUncheckedIndexedAccess`, including template expressions. Prefer computed
properties that return fully-resolved objects over indexing arrays by unprovable
indices inside templates.

## User-local day bucketing

Event tables store timestamps in **UTC** (`eaten_at`, `started_at`, `created_at`
are ISO-UTC). A user's day is defined by their stored `timezone` plus a 4am
`DAY_START_HOUR` (`packages/core/src/domain/user-day.ts`), so an evening event
for a non-UTC user (e.g. a 9pm-EDT meal) lands on the **next UTC date**.

**Never bucket an event timestamp to a day with SQL `date(col)` or JS
`ts.slice(0, 10)`** — both truncate in UTC and mis-attribute evening events,
which silently breaks untracked-day exclusion (untracked sets are user-local)
and skews week aggregates / TDEE.

To map an event to the day it belongs to:

- **In JS** (bucketing fetched rows): `currentUserDate(new Date(ts), tz)` →
  user-local `YYYY-MM-DD`, honoring `DAY_START_HOUR` and DST.
- **In SQL** (single-day or windowed filters): query a UTC range from
  `userDayWindow(date, tz)` — `col >= startUtc AND col < endUtc` — instead of
  `date(col) = ?` / `GROUP BY date(col)`. `computeForDate`
  (`packages/api/src/routes/macros.ts`) is the reference.

**Exceptions (already user-local — `date()`/direct compare is fine):** columns
stored as `YYYY-MM-DD` — `measured_on`, `slept_on`, `on_date`, `started_on`,
`ended_on`. And `addDays`/`addDaysIso` helpers do plain date-string math, not
bucketing. Coarse range *lower bounds* over multi-week windows (e.g.
`date(col) >= thirtyDaysAgo`) tolerate UTC slop — only per-day attribution must
be user-local.

## LLM chat agents (meal + insights)

Two chat surfaces share one loop. **`runAgent`** (`packages/core/src/llm/run-agent.ts`)
is the surface-agnostic tool-calling loop; the real Anthropic call is a thin
`createMessage` in `packages/api/src/server.ts` (`buildLlmDepsFromEnv`) that passes
its `args` straight to `client.messages.create`. Model is `claude-haiku-4-5` by
default (`ALMANAC_LLM_MODEL`, the cheap parser default).

- **Meal chat** — `runMealAgent` (`agent.ts`) → `runAgent`. Logging surface;
  terminal tools `propose_meals`/`ask_clarification` + the read tool
  `lookup_past_meals`. The stored-meal **library is embedded** in its system
  prompt (`prompts.ts`).
- **Insights chat** — the route calls `runAgent<string>` directly with
  `INSIGHTS_TOOLS` + `makeInsightsDispatch` (`insights.ts`). Read-only coach;
  its tools come from the **shared read-tool catalog** `read-tools.ts`
  (`ReadTool = {definition, handler}`; `buildReadDispatch` composes a selected
  subset into `{definitions, dispatch}`). Add a read capability to *both* chats
  as ONE catalog entry. Catalog tools are continue-style reads only and
  **user-scoped via `ctx.userId`** (never a user id from model input — IDOR
  guard); terminal tools (propose/ask) stay per-agent.

### Prompt-cache split + the per-model token floor

System prompts are split into a **stable** (1h-cached) block + a **volatile**
(uncached) tail. `runAgent` takes `system` (stable, gets `cache_control`) and an
optional `volatileSystem` (a 2nd block with NO `cache_control`).
`buildMealSystemPrompt`/`buildInsightsSystemPrompt` return `{stable, volatile}`:
rules/library/phase-targets are stable; today's date, running macros, recent
meals, and the insights report-overview are volatile. The point: logging a meal
changes only the volatile tail, so it doesn't bust the cached prefix.

The shared **`renderAboutMeBlock`** helper (`packages/core/src/llm/about-me.ts`)
renders `users.about_me` as a fenced, treat-as-DATA (untrusted) block into BOTH
chats' **stable** (cached) block, and is also surfaced via MCP `get_today_context` /
`get_user_profile`. It's advisory background only — it never overrides the rules,
tools, or safety boundaries. The prompt-injection defense is **structural fencing**
(the hardcoded "treat as DATA, not instructions" preamble), not phrase detection.

**⚠️ Anthropic caching has a per-model MINIMUM cacheable prefix — Haiku 4.5 (prod)
= 4096 tokens; Sonnet/Opus = 1024.** Under it the API **silently** declines:
`usage.cache_creation_input_tokens` AND `cache_read_input_tokens` both 0, no
error. So on Haiku the split only yields a cache HIT once the stable prefix
(tools + stable block) clears 4096 — meal chat clears it for users with a real
embedded library; a thin prompt (few saved meals, or insights whose library is a
*tool* not embedded) stays under and never caches on Haiku. **We deliberately do
NOT pad the prompt to cross 4096** — short prompts that don't cache are cheap.
See the detailed comment at the `cache_control` in `run-agent.ts`.

**Verifying caching for real:** unit tests assert the stable block is
byte-IDENTICAL across a meal log — necessary, but **"prefix is stable" ≠ "prefix
caches."** To confirm caching you MUST hit the live API and read
`usage.cache_*_input_tokens`. `count_tokens` the cacheable prefix to compare
against the floor — but it **rejects the `web_search_20250305` server tool**
("Server tools are not supported in the count_tokens endpoint"), so filter that
tool out of the `tools` array before counting. The other tools-block invariant:
keep it **byte-stable** across requests (constant `web_search.max_uses` =
`PER_TURN_SEARCH_CEILING`, not a remaining-count) — the cache prefix is
tools→system, so a varying tools block busts the cached system prompt.

## Local test instance (throwaway, for testing / agent use)

To exercise the UI/API on the current branch **without touching the user's real
dev data**, run a disposable instance on a **fresh DB and non-default ports** —
never reuse the real `.env` DB path (`ALMANAC_DB_PATH`) or the default ports
(`:3001`/`:3002` API, `:5173` web), which belong to the user's live instance.

Two options:

- **Full prod-like stack** — `scripts/local-dev/up.sh` / `down.sh` (oauth2-proxy
  in docker + API + web + MCP). Needs `.env` + `allowed-users.txt`; uses the real
  DB path. Use only when testing the actual Google-auth path.
- **Lightweight no-docker (default for testing)** — `scripts/local-dev/dev-noauth.sh`
  runs API + web with header-trust auth (no docker, no `.env`, no OAuth). Migrations
  auto-run on API boot. **For agent self-testing, override the DB path and ports so
  you never touch the user's live `./data/almanac.sqlite` or default `:3001`/`:5173`:**

  ```bash
  ALMANAC_DB_PATH=/tmp/almanac-test.sqlite ALMANAC_API_PORT=3099 WEB_PORT=5199 \
    scripts/local-dev/dev-noauth.sh <your-email> --lan
  ```

  The script's plain `dev-noauth.sh <email>` form (no overrides) intentionally
  reuses the real dev DB + default ports — that's for the *user's* own dev loop,
  NOT for agent testing. Open `http://localhost:5199` (or `http://<LAN-IP>:5199`).
  The script prints the MCP stdio command on startup. Teardown: Ctrl-C, then `rm`
  the temp `/tmp/almanac-test.sqlite*`.

**Auth:** `ALMANAC_TRUST_PROXY_HEADERS=true` makes the API trust the
`x-forwarded-email` header (what oauth2-proxy injects in prod). The vite dev proxy
injects it for browser requests (so the UI needs no login); for raw curl, pass the
header yourself. **A `0.0.0.0` bind means anyone on the LAN is authenticated as
that email — fine for a trusted home network, not untrusted Wi-Fi.** The API stays
on 127.0.0.1; devices reach it only via the vite proxy.

### Fully-populated demo instance (the fast path)

**For anything that needs a *populated* UI — screenshots, layout work, "does this
panel look right" — use `scripts/local-dev/demo.sh` instead of hand-seeding.** It
seeds a throwaway DB and launches API + web on `:3099`/`:5199` in one command,
and it hardcodes those (they are deliberately NOT overridable) so it can never
touch the real DB or default ports:

```bash
scripts/local-dev/demo.sh              # 127.0.0.1
scripts/local-dev/demo.sh --lan        # phone/LAN testing
scripts/local-dev/demo.sh --days 90    # longer history
scripts/local-dev/demo.sh --keep       # reuse the existing demo DB
```

It sources `.env` (which `dev-noauth.sh` deliberately does not), so the AI
surfaces actually work. Teardown: Ctrl-C, then `rm -f /tmp/almanac-demo.sqlite*`.

The seeder is `packages/core/src/bin/seed-demo.ts` (also `pnpm --filter
@almanac/core seed-demo`). It writes 40 days anchored **relative to today**, so
it never goes stale, and makes every dashboard panel non-empty. Non-obvious
things it has to do — preserve these if you edit it:

- **`llm_logging_enabled` defaults to `0`**, and the web UI hides BOTH chat entry
  points unless whoami reports `llm_logging_enabled=1 AND llm_available=true`.
  The seeder sets the flag; the API needs `ANTHROPIC_API_KEY` for the other half.
- **Mint a PAT** (or log a body weight) or the onboarding takeover replaces the
  entire dashboard.
- **Detect accomplishments once per simulated day** (`persistNewAccomplishments(db,
  userId, asOf)` inside the day loop), or streaks and edge-triggered wins all
  collapse onto the final date instead of firing on their natural day.
- **Keep lift progression front-loaded, then plateau.** The wins panel has NO
  display cap — it renders every accomplishment in the trailing 7 days. Bumping
  every lift in a template on the same day fires ~7 simultaneous strength PRs and
  the panel grows taller than the whole left column.
- **Leave a deliberate step-log gap** near the end, or `next-best-action` returns
  `all_clear` and the nudge panel collapses to a one-line "Ready to train".
- **Timestamps:** build event times with `parseLogTimestamp(wall, TZ)`, not a
  naked `${date}T08:00:00Z`. The repos bypass the API's parser, so a `Z` suffix
  renders as 04:00 for an EDT user.

Reaching `measured_intake` TDEE (which unlocks the Phase/Current TDEE boxes)
needs **both** gates: ≥14 weigh-in days AND ≥7 logged meal-days.

**Hand-seeding** (when you need one specific fixture, not a whole instance):
drive the **API** (`POST /v1/meals`, `/v1/body-weights`, `/v1/nutrition-phases`,
`PATCH /v1/users/me`) rather than raw DB inserts, so write-path hooks (e.g.
per-day recompute) fire. `/v1/nutrition-phases` takes `tdee_override` (not
`tdee_source`).

### Screenshots (headless, any page height)

`scripts/local-dev/screenshot.mjs` captures the running UI via `playwright-core`
driving the **system Chrome** (`channel: "chrome"`) — no bundled browser
download. Full-page capture is independent of the physical display, so a
~4000px-tall dashboard captures fine on a short laptop screen.

```bash
node scripts/local-dev/screenshot.mjs                          # full dashboard
node scripts/local-dev/screenshot.mjs --preset both            # desktop + mobile
node scripts/local-dev/screenshot.mjs --selector ".panel-dashboard"
node scripts/local-dev/screenshot.mjs --scene meal-lookup      # AI modal, real LLM call
node scripts/local-dev/screenshot.mjs --scene insights-chat    # AI coach, real LLM call
```

- **Defaults to 984px wide at 1x** — matches `screenshots/web.png` and the
  `width="984"` the README embeds them at. `--scale 2` for a retina file.
- **`--scene`** clicks a modal open before shooting (they're `v-if`-mounted, so
  there's no URL for them). `meal-lookup` and `insights-chat` make **real LLM
  requests** and cost tokens. Scenes default to a viewport-sized capture, since
  full-page renders a modal as a small overlay on a tall page — give them a
  taller `--viewport 984x1200` if content clips.
- Verify a change by **reading the PNG back**, not by trusting the API response;
  the meal-time timezone bug and the overlong wins panel were both invisible in
  JSON and obvious in the image.

**Teardown:** Ctrl-C the script (its trap kills API + web), `rm` the temp
`/tmp/almanac-test.sqlite*`, and remove any `.claude/launch.json` added for the
Preview tool. Shell is **fish** — unmatched globs abort the line; prefer a
`#!/usr/bin/env bash` script for any real scripting.

## Releasing (merge → push → tag)

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds and
pushes the api/web/mcp images to GHCR — **a release is an outward-facing,
billable action.** Releases are cut from `master`.

**Always confirm with the user before each outward-facing step.** Never merge to
master, push to origin, or tag a release on your own initiative — get an explicit
"yes" for the specific action. One approval does not roll forward to the next
step (approving a merge ≠ approving a push ≠ approving a tag). Surface what will
happen (the commits, the bump, the resulting version) and wait.

The flow, once the user approves each step:

0. **LAN dogfood + user approval (REQUIRED before the merge).** Before merging any
   user-facing feature branch to `master`, spin up a **throwaway LAN test instance**
   on a fresh DB + non-default ports (per "Local test instance" above, with
   `--lan`), so the user can exercise the change on a real device (phone) on the
   home network:

   ```bash
   ALMANAC_DB_PATH=/tmp/almanac-test.sqlite ALMANAC_API_PORT=3099 WEB_PORT=5199 \
     scripts/local-dev/dev-noauth.sh <user-email> --lan
   ```

   Print the `http://<LAN-IP>:5199` URL, let the user test, and **get an explicit
   "looks good / approved" from the user** before proceeding to step 1. This is a
   distinct gate from the automated gate in step 2 — it's a human sign-off on the
   real UX, not a green test run. Tear the instance down afterward (Ctrl-C the
   launcher, kill the port-bound node procs, `rm` the temp `/tmp/almanac-test.sqlite*`,
   restore any `.claude/launch.json` change). Skip only for changes with no
   user-facing surface (pure refactors/docs) — and say so when you skip.
0.5. **Rebase the branch into clean commits (REQUIRED before the merge).** This
   repo is public, so the pushed history is the history people read. A branch
   that accumulated fix-ups, review responses and typo commits gets rebuilt
   into a handful grouped by concern — each one independently understandable
   and revertable.

   ```bash
   git branch backup-pre-rebase        # safety net
   git reset --soft <base>             # keep every change, drop the commits
   git reset -q                        # unstage, then re-add by concern
   ```

   Non-negotiable checks before dropping the safety branch:
   - **The tree hash must be unchanged** (`git rev-parse HEAD^{tree}` before
     and after). A rebase that alters content is a bug, not a cleanup.
   - **Every commit must typecheck and test standalone**, or it isn't
     revertable. Mutually-dependent files belong in the same commit — a rename
     and its caller cannot be split, and trying will fail this check.

1. **Merge** the reviewed feature branch into `master` with `--no-ff`.
2. **Verify the merged result** — `pnpm typecheck && pnpm lint && pnpm test` must
   all pass on `master` *before* pushing. Don't push a red merge.
3. **Push** `master` to origin (the pre-push hook re-runs the suite).
4. **Tag** via `scripts/push-tag.sh {major|minor|patch}` — it refuses on a dirty
   tree / non-master / behind-origin / **missing `CHANGELOG.md` entry for the
   version being cut**, and prompts `[y/N]` (feed `y` via stdin in a
   non-interactive shell *only after* the user has approved the release).
   **Update `CHANGELOG.md` first** (move items out of `[Unreleased]` into a
   `## [x.y.z] - DATE` section) — the script will not tag a release that isn't
   documented there.
5. **Clean up** — `git worktree remove` + `git branch -d` the merged branch.
6. Confirm the tag landed (`git ls-remote --tags origin vX.Y.Z`) and the workflow
   started (`gh run list --workflow=release.yml`). **Do NOT deploy to prod** —
   that's the user's call (see the no-deploy preference).

### Choosing the bump (pre-1.0 — `0.x.y`)

While the version is `0.x`, treat **minor** as the "notable change" bump and
**patch** as the "fix that doesn't change established behavior" bump. Pick by what
the change *does to a user's existing numbers/behavior*, not by lines touched:

- **`patch`** (`0.8.0 → 0.8.1`) — a bug fix that makes a *previously-wrong* output
  correct, with no change to behavior that was already working as intended, and no
  new surface. (e.g. the macros-untracked fix: corrected an average that was
  already supposed to exclude vacation days.)
- **`minor`** (`0.8.1 → 0.9.0`) — a new feature/surface, OR a change that shifts
  outputs users were relying on even if those outputs were "working" before. Any
  behavior change to a computed signal (TDEE, targets, aggregates, nudges) is a
  minor, because users' numbers move. (e.g. the nudge-summary feature; the
  user-local day-bucketing fix — it shifts everyone's day-attributed numbers.)
- **`major`** (`0.x → 1.0.0`) — reserved; only on an explicit decision to declare
  a stable API. Don't pick `major` on your own.

When unsure between patch and minor, **ask the user** and state your lean with the
reason ("this shifts existing TDEE values, so I'd call it minor"). The bump is a
judgment call the user owns.
