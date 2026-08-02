# MCP Gaps Priority 1–12 — Changelog

**Merged:** 2026-05-14 (`1a5db7b` on master)
**Branch:** `feature/mcp-gaps-priority-1-12` (merged + deleted)
**Spec:** `docs/superpowers/specs/2026-05-13-mcp-gaps-priority-1-12-design.md`
**Plan:** `docs/superpowers/plans/2026-05-13-mcp-gaps-priority-1-12.md`
**Source audit:** `docs/mcp-gaps.md`

Addresses Gaps 1–4, 6–16 from the audit (plus a TDEE shape bonus that
extends the helpful-early principle from `weight_change` to TDEE).

Gap 5 (bulk import) and Gaps 17–25 remain open.

---

## Discoverability (Gaps 1, 2, 3, 4)

### New MCP tools

- **`list_exercise_groups`** — returns all groups.
- **`list_exercises({ group_id?, include_archived? })`** — optionally filtered
  by group, optionally including archived rows.
- **`list_workout_templates({ include_archived? })`** — returns templates
  with their `items` array (default sets/reps/weight per exercise) **inline**,
  so an agent can choose a template without a second round-trip.

`tools/list` now advertises 38 tools (was 33: +3 list, +2 macros, +0 misc).

### Description fixes

- **`define_exercise`** description no longer references the nonexistent
  `get_exercise_groups`. Now points at `list_exercise_groups`.
- **`define_exercise_group`**, **`define_exercise`**, **`define_workout_template`**
  descriptions now cross-reference sibling tools by name (discovery → create →
  use). An agent reading `tools/list` alone can navigate the schema.

### Supporting changes

- `listTemplates` repo function batches an items query (single SQL `IN (...)`
  rather than N+1).
- `GET /v1/workout-templates` accepts `?include_archived=true`.

---

## Time correctness (Gap 8; free-fixes Gaps 12 + 16)

The biggest cluster. Touches almost every log/read path.

### New schema

- `users.timezone TEXT NOT NULL DEFAULT 'UTC'` — IANA name (e.g.,
  `'America/Toronto'`). Migration `002_user_timezone.sql`.

### New helpers (`@almanac/core/domain/user-day.ts`)

- **`DAY_START_HOUR = 4`** — the rollover hour for "the user's day." A 2am
  drink belongs to yesterday; a 5am coffee to today. Not configurable per-user
  (constant); promote later if needed.
- **`userDayWindow(date, tz) → { startUtc, endUtc }`** — UTC instants
  bracketing a user-local day.
- **`parseLogTimestamp(input, tz) → Date`** — strict parser. Accepts ISO with
  offset, ISO with Z, naked datetime (interpreted in `tz`), or date-only
  (00:00 in `tz`). Rejects garbage with clear errors (`"2026-13-45"` throws,
  doesn't silently roll forward).
- **`currentUserDate(at, tz)`** — `YYYY-MM-DD` calendar date in `tz`, applying
  the 4am rollover.

### Profile surface

- **`update_user_profile`** MCP tool accepts `timezone`. IANA validation
  happens at the API schema layer (`UserUpdateSchema` uses `Intl.DateTimeFormat`
  to confirm the zone exists).
- **`get_today_context`** response now includes `user.timezone`.

### Log routes (POST + PATCH)

`log_meal`, `log_workout`, `log_cardio`, `log_alcohol`, `log_weight` (plus
their `update_*` PATCH counterparts) accept their timestamp parameter in
**either** form:

- ISO with offset (`"2026-05-08T16:20:00-04:00"`) → stored UTC as-is.
- Naked datetime (`"2026-05-08T16:20:00"`) → interpreted in profile TZ,
  converted to UTC.

Storage column remains UTC. `alcohol_sessions.ended_at` also normalized.

### Date-range reads

`get_meals`, `get_cardio_recent`, `get_alcohol_recent`, `get_sleep_recent`
accept `from_date` / `to_date` (`YYYY-MM-DD`). API converts to a UTC range
via `userDayWindow` against the user's profile TZ. Legacy `from` / `to`
(ISO with offset) still accepted.

### "Today" boundary (Gap 12)

`getTodayContext` and `today.*` blocks compute "today" using the user-TZ
4am-anchored window. A 22:00 EDT workout no longer leaks into tomorrow's
`today.workouts`. A 21:00 EDT meal correctly counts toward today's `kcal_in`.

### Downstream helpers no longer double-filter

`computeDayKcalIn` and `computeDailyTarget` previously re-applied a UTC
date-string filter that silently dropped late-evening EDT events. Helpers
are now pure summations; callers (which already pre-filter via SQL window)
are trusted.

---

## Honest aggregates (Gaps 6, 7, 10, 11, 13 + TDEE)

### Skipped exercises persist (Gap 7)

New column `exercise_instances.skipped_at TIMESTAMP NULL`. When `log_workout`
processes a `skip` deviation, the row is persisted with `sets: []` and
`skipped_at = workout.started_at`. Distinguishable from "bombed" (tried,
zero reps): bombed has `sets: []` + `skipped_at: null`.

Migration `003_exercise_instances_skipped_at.sql`.

**Stim signal** filters skipped rows out before computing `last_hit_at`
and `contributing_sessions` — a skip doesn't falsely refresh recovery state.

### Workout summary (Gap 6)

`summarizeWorkout` now emits `"Logged workout — RPE 7, 4/5 exercises (1 skipped)."`
when template-driven. Plain count when no template.

### `trainable_capacity` named enum (Gap 13)

Returns `'depleted' | 'recovering' | 'fresh'` instead of magic numbers (20/50/100).
Mapping: pct ≤ 25 → depleted, ≤ 75 → recovering, > 75 → fresh.

### Stim `level` always populated (Gap 10)

`level` is now always a number 0–100. Three tiers:

1. **Baseline data available** → comparative ratio
   `(recentCredit / baselineCredit) × 100`, capped at 100. "100 ≈ doing
   your usual." Richest signal. (Cap discards surge signal; use `phase`
   for overtraining instead.)
2. **Baseline thin but recent activity** → decay-weighted recent credit /
   `earlyDaysCeiling` (default 7000), capped at 100. Honest about thin
   data, but week-one users still see signal.
3. **No sessions** → 0.

### `weight_change` shape (Gap 11)

Renamed `change_30d_kg` → `weight_change`, with embedded window and confidence:

```json
"weight_change": { "value_kg": -0.3, "over_days": 4, "confidence": "early" }
```

Both halves describe the same 30-day-bounded slice. `confidence` flips to
`"established"` at `over_days >= 30`. Returns null only when < 2 readings exist.

### TDEE adopts helpful-early pattern (bonus)

Response shape changed from `{ kcal_per_day, confidence: 4-tier, ... }` to:

```json
"tdee": {
  "kcal": 2480,
  "basis": "profile_baseline" | "measured_intake",
  "confidence": "early" | "established"
}
```

- `basis: "profile_baseline"` — Mifflin BMR × activity multiplier from the
  user's profile. Used when fewer than `fallbackWindowDays` (14) of weight
  data exist.
- `basis: "measured_intake"` — energy-balance back-calc from logged kcal
  and trend-weight delta.
- `confidence: "established"` after `establishedThresholdDays` (60) days of
  weight data.

`kcal` floored at BMR — pathological inputs can't produce negative or
sub-resting "TDEE."

---

## Historical / template paths (Gaps 9, 14, 15)

### `log_workout` accepts `template_id` alone (Gap 9)

`FromTemplateShape.deviations` now defaults to `[]`. Sending
`{ template_id, started_at, rpe }` alone now logs the template as written —
no ceremonial empty array required.

### `log_meal` summary keyed to meal's user-day (Gap 14)

Old: `"Logged meal — ... Today: 0/2350 (0%)."` for backfilled meals.

New: `"Logged meal for 2026-05-08 — 620 kcal, 30p / 80c / 25f. 2026-05-08 total: 1798/2350 (76%)."`

Response shape changed: the `today` block is removed; the response now
returns `{ id, day, summary, day_totals, day_target }`. Callers who want
today's totals call `get_macros_today` (still exists) or
`get_macros_for_date({ date: <today> })`.

### New macros tools (Gap 15)

- **`get_macros_for_date({ date })`** — kcal/protein/carb/fat totals + the
  active phase's effective targets for a specific user-day. Date interpreted
  in profile TZ; 2am snacks bucket to the previous day.
- **`get_macros_range({ from_date, to_date })`** — array of per-day records.
  Bounded to 90 days; longer ranges return 400.

Backed by new API route `GET /v1/signals/macros` with three modes:
`?date=YYYY-MM-DD`, `?from_date=&to_date=`, `?at=<ISO>` (resolves to the
user-day containing the instant).

---

## Migrations applied

| File | Purpose |
|---|---|
| `002_user_timezone.sql` | `ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'` |
| `003_exercise_instances_skipped_at.sql` | `ALTER TABLE exercise_instances ADD COLUMN skipped_at TEXT` |

Forward-only. Pre-launch — no data backfill needed (existing users get
`timezone = 'UTC'`; existing exercise instances get `skipped_at = NULL`).

---

## Tests

- Baseline (before branch): **429** passing (core 213, api 108, mcp 108).
- After merge: **530** passing (core 265+1 skipped, api 137, mcp 128).
- **Net: +101 tests.** Full typecheck clean. Biome format clean across the
  touched files.
- HTTP test harness (`tests/scripts/run-all.sh`): **199 passed, 0 failed**
  against the live API. Two assertions updated to match the new shapes:
  - `10-workouts`: skip now persisted as a row with `skipped_at` set
    (was: absent).
  - `11-signals`: TDEE confidence `seeding/low/medium/high` → `early/established`;
    new `basis` field; `kcal_per_day` → `kcal`.

A new end-to-end test in `packages/mcp/src/e2e.test.ts` exercises the
priority 1–12 surface in one conversation flow.

---

## Known scope-out items (open follow-ups)

From the audit, still untouched:

- **Gap 5** — bulk text import path.
- **Gap 17** — `log_cardio` has no `steps` field.
- **Gap 18** — `slept_on` (wake-date) semantics fight natural-language input.
- **Gap 19** — `week_to_date` ignores cardio and alcohol totals.
- **Gap 20** — `week_to_date.avg_kcal_in` and `tdee.components.avg_kcal_in`
  still use different denominators. (TDEE's half got cleaner with the new
  shape, but the windowing disagreement isn't disclosed.)
- **Gap 21** — `today.body_weight_kg` is null when no reading exists for today;
  no most-recent fallback.
- **Gap 22** — `contributing_sessions[]` entries lack a date.
- **Gap 23** — Aggregate fields generally don't disclose `window_days` /
  `days_with_data`. (`weight_change` and `tdee` do; others don't.)
- **Gap 24** — No `get_recommended_template`; recommendations are
  muscle-group-level.
- **Gap 25** — `start_nutrition_phase` has no `planned_end_on`.

---

## Mid-flight design decisions worth noting

Things that diverged from the plan or where review caught real problems:

- **Stim `level` — kept the comparative-ratio primary path.** Plan called
  for a single decay formula; the existing comparative-ratio math
  (`recent / baseline × 100`) was a richer signal, so it stayed as the
  primary path and the decay-based fallback only kicks in for week-one
  users with thin baseline data.
- **TDEE — adapted the existing 4-tier Mifflin/measured path** to the
  new `{ kcal, basis, confidence }` shape rather than tearing it down.
- **Day-aggregation helpers became pure summations.** Initial Task 9
  fixed only the SQL queries; reviewer caught that `computeDayKcalIn`
  and `computeDailyTarget` had their own UTC-slice filters that silently
  dropped late-evening EDT events. Fixed by making the helpers trust
  the caller's pre-filter.
- **Skipped exercises use `workout.started_at` as `skipped_at`** (not
  log-time), so retro-logged workouts produce coherent timestamps.
- **`parseLogTimestamp` validates strictly.** Initial implementation used
  `Date.UTC` which silently normalized `2026-13-45` → next year. Now
  rejects with a clear error, matching the explicit-error principle for
  user-facing input.
- **`?at` on `GET /v1/signals/macros` returns 400 on malformed input**
  (was 500 — `parseLogTimestamp` throw caught by the catch-all handler).
- **Stim signal ignores skipped rows.** Task 13 added skipped exercise
  rows; reviewer caught that they were polluting `last_hit_at` and
  contributing-volume math. Filter added at the `today.ts` mapping site.
- **Plan invented ghost fields.** `list_exercises` plan included
  `group_name` and `list_workout_templates` plan included `exercise_name`
   — the API didn't return either. Both removed before merge.
