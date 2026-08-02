# @almanac/web

Vue 3 + Vite frontend for Almanac. See the design spec at
`docs/superpowers/specs/2026-05-15-almanac-web-frontend-design.md`.

## Dev

From the repo root:

    pnpm dev:all        # runs api + mcp + web concurrently

Then open http://127.0.0.1:5173.

`ALMANAC_DEV_EMAIL` must be set so the Vite dev proxy can inject
`X-Forwarded-Email` on every request to `/api/*`, mirroring what
oauth2-proxy does in production. The browser never sees a secret.

For fish:

    for line in (grep -v '^#' .env | grep -v '^$'); set -gx (string split -m 1 = $line); end
    pnpm dev:all

## Test

    pnpm --filter @almanac/web test

## Production deployment

The browser code calls `/api/v1/...` with no auth header. In production,
oauth2-proxy sits in front of the API, authenticates the user via
Google SSO, and forwards `X-Forwarded-Email` on every request. The API
container trusts that header when `ALMANAC_TRUST_PROXY_HEADERS=true`
and resolves it to a user row (auto-provisioning on first sight). See
the repo-root `docker-compose.yml` for the wiring.

## Right pane (today snapshot)

The right pane is a read-only at-a-glance dashboard composed of five blocks:

- **Phase header** — your active nutrition phase (cut/bulk/recomp/maintenance),
  day number, and base macros.
- **Remaining today** — kcal + P/C/F still available against today's
  activity-adjusted target.
- **Macros — last 7 days** — daily totals grid with today rightmost.
- **Weight** — today's reading + EMA trend + 14-day sparkline (respects
  your kg/lb preference).
- **Sleep** — last night + 7-day debt + 7-night histogram with an 8h
  target line.

All five blocks render from data the API already exposes; no logging
happens from the right pane (per spec §1, manual entry stays in the
MCP loop for v1). After a workout submits, the today snapshot is
refreshed automatically so the dashboard doesn't go stale.

### Calendar

Below the sleep block, a month grid shows:

- **Past-session chips** — one per completed workout, colored by template.
- **Pill bars** — per template, forward-extending from the last completed
  session. Phases: too_soon (dashed outline) → acceptable (faded solid) →
  prime (solid, full color) → in_window (slightly faded). Bars truncate
  at fading (no display past 7 days of stimulus decay).
- **★ marker** — on the next proposed prime day, when that day is
  today-or-future. If you've slipped past prime, no ★ until the next
  pill (after a new session).
- **Prev/next nav** — past months show only chips + tally (no forward
  bars, since they only make sense relative to "now").

## Active session

Clicking a template in the idle view starts a session. Session state
is persisted to `localStorage` on every action — set ticks, edits, adds,
exercise additions, skips, RPE — so a refresh mid-workout resumes where
you left off (spec §4.4 optimistic UI).

On End Session, the in-progress workout is POSTed to
`/v1/workouts`. If you diverged from the template (changed reps or
weight, added sets, added exercises ad-hoc), an end-session dialog
asks whether to save the changes back to the template or treat them
as session-only. Three options:

- **Save all** — every flagged divergence propagates to the template
  (via `PUT /v1/workout-templates/:id/items`).
- **Pick which to save** — checkbox list; you select per-divergence.
- **Don't save** — the workout is logged; the template is untouched.

Missed sets (completed fewer than planned), skipped exercises, and
session-level reorders are treated as session noise and never propagate
to the template (spec §7.2).

If the workout POST fails, the session is retained in localStorage
with a `pending_submit` flag — retry from End Session. If the workout
POST succeeds but the template PUT fails, only the PUT will be
retried (no double-POST), and a green banner appears at the top of
the active session reading "Workout saved (id N). Finalize template
changes below or skip to discard them." so it's clear the next End
Session click won't re-submit the workout. On resume, if the API
already shows a workout with the same `started_at`, the local session
is cleared with a notice (you submitted from another device).

### Known limitations

- Skipped exercises reach the server as exercise instances with empty
  `sets` arrays. This logs them as "bombed" rather than formally
  distinguishing "skipped" from "bombed." The formal distinction
  requires the `FromTemplate` workout-body shape (`{op: "skip"}`
  deviations) — a Stage 3+ refactor.
- The "stale-state on resume" check uses `started_at` equality. A clock
  skew or duplicate-millisecond start could in theory produce false
  positives; Stage 5 may add a client-side UUID to make this
  unambiguous.

## Boundary

This package may import only from `@almanac/core/types` and
`@almanac/core/schemas`. No `db`/`repos`/`signals` runtime modules.
All data flows over HTTP via the `/api` proxy: Vite in dev, nginx in
prod. The web bundle is environment-agnostic.
