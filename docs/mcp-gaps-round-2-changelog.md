# MCP Gaps Round 2 — Changelog

**Branch:** `feature/mcp-gaps-round-2`
**Spec:** `docs/superpowers/specs/2026-05-14-mcp-gaps-round-2-design.md`
**Plan:** `docs/superpowers/plans/2026-05-14-mcp-gaps-round-2.md`
**Source audits:** `docs/mcp-gaps.md` (Gaps 17–25, minus 5) + `docs/mcp-gaps-2026-05-14.md` (Gaps 26–30).

Closes **14 gaps** across the 25-item audit in a single branch: bootstrap-via-MCP,
honest aggregate wrappers, schema completeness, sleep wake-date ergonomics, and
template-level training recommendations. Gap 5 (bulk text import) remains
explicitly out of scope — it's a separate project.

---

## Cluster A — Bootstrap & first-run (Gaps 27, 29)

### New MCP tool: `bootstrap_user`

```ts
bootstrap_user({ name, dob?, height_cm?, sex?, timezone?, preferred_unit_system? })
```

Wraps a new `POST /v1/users` route. Returns 201 + the created user, or
409 Conflict if a user already exists. Empty-DB 401 error message now
points at `bootstrap_user` instead of the bare `seed-user` CLI.

### `seedUserAndPhase` → `seedUser`

The bootstrap path no longer auto-creates a maintenance phase. First
user-driven `start_nutrition_phase` is now phase id **1** (was 2). The
`bmrMifflin`/`ageYears`/`defaultPhaseTargets` helpers were dead code
after the refactor and got removed.

The MCP `tools/list` count goes 38 → **40** with `bootstrap_user` and
`get_recommended_template` (Cluster E).

---

## Cluster B — Aggregate honesty (Gaps 19, 20, 23, 28)

The widest shape change in this round.

### New `Aggregate` type

```ts
type Aggregate = {
  value: number;
  window_days: number;
  days_with_data: number;
};
```

Defined in `packages/core/src/signals/aggregate.ts`. Always present
(never null); zero-data returns the wrapper with `days_with_data: 0` so
callers can tell "no data" apart from "summed to zero." The wrapper makes
the denominator visible at the call site, eliminating the silent
"two aggregators reading the same name with different windows" failure
mode the audit called out.

### `week_to_date` rewrite

```ts
week_to_date: {
  workouts_count: Aggregate;            // value = count; days_with_data = days trained
  cardio_sessions_count: Aggregate;
  cardio_minutes: Aggregate;
  cardio_kcal: Aggregate;
  alcohol_drinks_count: Aggregate;
  alcohol_kcal: Aggregate;
  drinking_days_count: Aggregate;
  avg_kcal_in: Aggregate;
  avg_protein_g: Aggregate;
  sleep_avg_hours: Aggregate;
  sleep_debt: SleepDebt;                // unchanged — already self-documenting
}
```

`days_with_data` is computed per field:

- Workouts: distinct `date(started_at)` count (multiple sessions in one
  day still count as one day with data).
- Cardio / alcohol: distinct `date(started_at)` count for the field's
  table.
- Meals: distinct days with logged meals.
- Sleep: nights with logged sleep.

### TDEE `components.avg_kcal_in`

Promoted from a scalar to `Aggregate`. In the profile-baseline tier
(thin data) it emits `{ value: 0, window_days: 0, days_with_data: 0 }`
— honest about being a tentative number. In the measured-intake tier,
`window_days` is 14 or 21 and `days_with_data` is the actual count of
meal-days in the window.

### `phase.days_in` + `days_remaining`

`get_today_context.phase` now ships:

- `days_in: number` — always populated; user-local days since
  `started_on`. 0 the day the phase started, 13 on day 14.
- `days_remaining: number | null` — populated when the phase has
  `planned_end_on`. **Allowed to be negative** when the phase has
  overrun its plan; lets a caller spot the overrun without re-computing.

---

## Cluster C — Phase planned end (Gap 25)

### Migration `004_nutrition_phases_planned_end_on.sql`

```sql
ALTER TABLE nutrition_phases ADD COLUMN planned_end_on TEXT;
```

### `start_nutrition_phase` accepts `planned_end_on`

```ts
start_nutrition_phase({ ..., planned_end_on?: 'YYYY-MM-DD' })
```

Surfaced via `phase.days_remaining` (Cluster B). The schema/repo also
permit `planned_end_on` updates via PATCH for corrections ("told you
July 1, actually June 30").

---

## Cluster D — Snapshot completeness (Gaps 21, 22, 26)

### `today.most_recent_weight` fallback (Gap 21)

```ts
today: {
  ...,
  body_weight_kg: number | null,           // null if no reading TODAY
  most_recent_weight: {
    value_kg: number,
    on_date: string,                       // YYYY-MM-DD
  } | null,                                // null only when zero readings ever
}
```

`body_weight_kg` stays null when no reading today — preserves the "did
the user weigh themselves today?" signal. `most_recent_weight` is the
always-available fallback so a downstream summary can say "current
weight 71.2 kg (as of 5/12)" without losing the skipped-day fact.

### `contributing_sessions[].started_at` (Gap 22)

Stim entries now include the session timestamp:

```ts
contributing_sessions: Array<{
  workout_id: number,
  started_at: string,                      // ISO 8601 — NEW
  quality_volume: number,
  context_multiplier: number,
}>
```

Lets callers reason about the spec's decay-curve narrative ("0–7d
neutral, 7–14d mild fade") without a second round-trip to fetch each
workout by id.

### Alcohol kcal canonical via `log_alcohol` (Gap 26)

`log_meal.description` updated to warn against logging drinks as
meals. Audit confirmed `computeDayKcalIn` and `GET /v1/signals/macros`
already merge `meals.kcal + alcohol_sessions.est_kcal` correctly — no
code change needed there. The doc fix prevents future LLM-driven
double-counting.

---

## Cluster E — Log-time fidelity & recommendations (Gaps 17, 18, 24, 30)

### Migration `005_cardio_sessions_steps.sql`

```sql
ALTER TABLE cardio_sessions ADD COLUMN steps INTEGER;
```

### `steps` on cardio (Gap 17)

```ts
log_cardio({ ..., steps?: number })
update_cardio({ ..., steps?: number | null })
```

Daily totals computable via `SUM(steps)` over the user-day window — no
separate `log_daily_steps` table (avoids the double-counting risk that
bit Gap 26).

### `log_sleep` accepts `night_of` alias (Gaps 18, 30)

```ts
log_sleep({
  // EITHER:
  slept_on?: 'YYYY-MM-DD',     // wake date (existing semantics)
  // OR:
  night_of?: 'YYYY-MM-DD',     // date sleep started — server normalizes to slept_on
  hours: number,
  quality?: 1-5,
  notes?: string,
})
```

Zod refine rejects both/neither with a clear message. Server stores
`slept_on` (API contract unchanged); the alias is purely an MCP-layer
ergonomic affordance. The success summary echoes **both** dates so an
off-by-one error is visible at log time:

> `Logged sleep — night of Tue 2026-05-12 → woke Wed 2026-05-13 — 7.5h, 4/5.`

### `get_recommended_template` (Gap 24)

New MCP tool + new `GET /v1/signals/recommend-template?top_n=N` route.

**Scoring**: `prime_groups_hit - 2 × too_soon_groups_hit`. Ties broken
alphabetically by template name (stable ordering).

```ts
get_recommended_template({ top_n?: number }) → {
  recommendations: Array<{
    template_id: number,
    template_name: string,
    score: number,
    reasoning: {
      prime_groups_hit: string[],
      too_soon_groups_hit: string[],
      neutral_groups_hit: string[],
    },
  }>,
}
```

The route deliberately re-walks the stim inputs that `today.ts` already
gathers — the duplication is flagged as a `TODO: extract
computeStimStatesForUser` if a third caller appears.

---

## Migrations applied

| File | Purpose |
|---|---|
| `004_nutrition_phases_planned_end_on.sql` | `ALTER TABLE nutrition_phases ADD COLUMN planned_end_on TEXT` |
| `005_cardio_sessions_steps.sql` | `ALTER TABLE cardio_sessions ADD COLUMN steps INTEGER` |

Forward-only. Pre-launch — no data backfill needed.

---

## Tests

Net **+18 tests** across packages:

- `core`: aggregate (+4), recommend-template (+6), today (+8 for
  aggregates / most_recent_weight / days_in / days_remaining),
  tdee (+2), stim (+1), nutrition-phases.repo (+3),
  cardio.repo (+3), bootstrap (rewrite, net unchanged).
- `api`: users.test.ts (+4 for POST /v1/users), signals.test.ts (+2
  for recommend-template).
- `mcp`: bootstrap-user (+2), get-recommended-template (+2), log-sleep
  (rewritten — +3 net for night_of cases + idempotency), log-cardio
  (+1 for steps), format (rewrite of summarizeSleep tests).
- `mcp/e2e`: third end-to-end test covering the round-2 surface.

Full suite: **51 test files, 138 mcp tests** + **141 api** + **287
core** = **566 tests**. Typecheck clean across all three packages.
Biome format applied; existing lint warnings (pre-this-round) untouched.

---

## Out of scope (deferred)

- **Gap 5** — bulk text import. Separate project.
- **`meals.category` enum + alcohol rejection at write time** — relying
  on docstring + canonical-source design (Cluster D). If misclassifications
  keep happening in practice, add this in a future round.
- **Per-stim alcohol-window overlay** — week_to_date totals only; the
  per-stim "0–6h / 6–24h / 24h+" overlay is a follow-up.
- **`log_daily_steps` separate tool** — steps live on `log_cardio` only.
- **`computeStimStatesForUser` helper extraction** — recommended in the
  plan; deferred since only two callers currently duplicate.

---

## Tool surface delta

Before: 38 tools (post priority 1–12).
After: **40 tools** (+2 net).

New tools:

- `bootstrap_user`
- `get_recommended_template`

Schema additions on existing tools (additive, no removals):

- `log_cardio`, `update_cardio` — `steps`.
- `log_sleep` — `night_of` (alias for `slept_on`).
- `start_nutrition_phase` — `planned_end_on`.
- `log_meal` — description update only.

Response shape changes (breaking, pre-launch):

- `get_today_context.week_to_date.*` — most fields become Aggregate wrappers.
- `get_today_context.today.most_recent_weight` — new field.
- `get_today_context.phase.days_in` / `days_remaining` — new fields.
- `get_today_context.tdee.components.avg_kcal_in` — becomes Aggregate.
- `stim_states[].contributing_sessions[].started_at` — new field.
- `log_sleep` response summary — reworded.

---

## Mid-flight notes worth surfacing

- **`AggregateSchema` allows `window_days: 0`** (not `positive()`) — the
  profile_baseline TDEE tier legitimately has "no window applied yet."
- **`night_of` normalization is MCP-only.** The API still accepts
  `slept_on` exclusively; the alias is purely an ergonomic affordance.
- **Server-side `tools/call` doesn't currently wrap thrown handler
  errors.** The e2e test asserts the 409 path via `.rejects.toThrow`
  rather than `isError: true`. A future round could add a generic
  try/catch to the dispatcher so all handler errors surface as
  `isError: true` (matches MCP spec intent), but it wasn't in scope here.
- **Existing lint warnings (122) are pre-existing**, not introduced by
  this round. They mirror what was on master before the branch started.
