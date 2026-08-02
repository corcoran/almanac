# MCP Gaps

Findings from a real-world session where an LLM (with no access to source or
specs) tried to log historical workouts via the MCP and ran into walls. The
underlying app is fine — the gaps are all in what the MCP layer exposes,
how its tools describe themselves, and how it represents data back to the
caller.

Gaps 1–5 are about discoverability (the agent cannot find or interpret what
the MCP offers). Gaps 6–9 surfaced while actually using the tools (the data
the MCP accepts and returns has fidelity holes, and validation contradicts
the documented contract). Gaps 10–13 surfaced while *reading back* the
computed signals — fields that are null without explanation, fields whose
names overstate what they measure, and undocumented enum values. Gaps
14–16 surfaced while logging meals — the system silently treats every
historical entry as if it were "today," and date-range queries are
UTC-bound in a way that misclassifies evening meals. Gap 17 surfaced
during cardio logging — fields that wearables and watches return as a
matter of course (steps) have no home in the schema. Gap 18 surfaced
during sleep logging — `slept_on` semantics fight natural language and
the system has no defense against the resulting off-by-one errors. Gaps
19–23 surfaced from a single `get_today_context` call after all data
was loaded — week-to-date rollups omit cardio/alcohol entirely,
two aggregators disagree about the same dataset, the snapshot lacks
small affordances (most-recent-weight fallback, session dates inside
contributing-sessions arrays) that would make it self-sufficient, and
no aggregate field discloses its window or denominator, leaving the
caller to guess the semantics. Gaps 24–25 surfaced when reasoning about
training and nutrition planning — recommendations are emitted at the
muscle-group level when the user thinks at the template level, and
nutrition phases lack the planned-end date that would let the system
compute progress.

## Why this matters

The MCP is the only surface a conversational agent sees. If a tool's purpose
or relationship to other tools isn't visible from `tools/list`, the agent has
to guess — and guesses are how duplicate exercises, missing templates, and
"defined but never referenced" rows get created. Likewise, if data
round-tripped through the MCP loses information (skipped exercises, local
time), downstream analysis silently degrades.

---

## Gap 1: Concept hierarchy is invisible

Tool descriptions document operations in isolation but never explain how
exercises, exercise groups, workout templates, and workouts relate.

From the MCP alone, an agent cannot tell:

- Whether "Push/Pull/Legs" is a group, a template, or a tag
- That groups are *muscle buckets* (Chest, Quads, …) and templates are
  *split days* (PUSH, PULL, LEGS)
- That templates exist precisely so recurring sessions don't need to be
  redefined exercise-by-exercise every time

**Observed failure:** asked "should PPL be groups or templates?", the agent
had to fall back to reading `docs/original-fitness-app-spec.md` to answer. A user
without that file (or an agent in a deployment without filesystem access) is stuck.

**Suggested fix:** add a tool like `get_schema_glossary` (or bake a one-line
"how this fits with X" into each `define_*` description) that explains the
hierarchy in 3–5 sentences.

---

## Gap 2: No read-side for structural tables

The MCP has `define_exercise_group`, `define_exercise`, and
`define_workout_template` — but no corresponding `list_*` tools.

Consequences:

- Cannot check what already exists before defining → easy to create duplicate
  groups/exercises
- Cannot reference a template by name when logging — `log_workout` requires
  `template_id`, but no tool returns template ids
- After defining things, no way to confirm what was created without bypassing
  the MCP and hitting the API directly

**Suggested fix:** add `list_exercise_groups`, `list_exercises` (filterable
by group), `list_workout_templates`. Each is small, follows the pattern of
existing read tools, no design tradeoffs.

---

## Gap 3: `log_workout` advertises a path you can't take

The `log_workout` description says:

> Use Shape 2 for "today's PUSH same as usual but..." — much shorter.

Shape 2 requires `template_id`. There is no tool that returns template ids.

This is a dead-end loop: the description tells the agent to use the
template-based shape, but provides no way to discover what `template_id` to
pass. The only escape is to fall back to Shape 1 (full exercise list), which
defeats the entire purpose of templates.

**Suggested fix:** ships with Gap 2 (`list_workout_templates`).

---

## Gap 4: Tool descriptions reference tools that don't exist

`define_exercise.description` says:

> ID of the exercise group (use get_exercise_groups or list to find one;
> create with define_exercise_group).

`get_exercise_groups` does not exist. Neither does any tool literally named
`list`. The instruction is unimplementable.

This is a documentation lie that wastes tool-call budget when an agent
trusts it.

**Suggested fix:** correct the description — either remove the reference, or
update once Gap 2's `list_exercise_groups` lands.

---

## Gap 5: No bulk/import path for migration

The spec frames the app as a replacement for "a 9-year plain-text workout
log." But importing even four historical sessions costs roughly:

- ~12 `define_exercise_group` calls (muscle groups)
- ~30 `define_exercise` calls
- 3 `define_workout_template` calls (PUSH/PULL/LEGS)
- 4 `log_workout` calls
- 4 `log_weight` calls

≈ **53 tool calls** to onboard four sessions. Nine years of history at this
rate is impractical via the conversational MCP path.

**Suggested fix:** an `import_workout_text` tool that accepts the raw plain
text format (the same format the user already maintains) and parses it into
groups + exercises + workouts. Idempotent on re-runs. This matches the
migration story already in the spec and turns onboarding from a long
conversation into one tool call.

---

## Gap 6: Workout summaries hide skipped exercises

`log_workout` returned:

> Logged workout — RPE 7, 5 exercises.

The template defined 6 exercises; one was skipped via a deviation. The
summary makes it sound like the workout simply *had* 5 exercises, with no
hint that anything was planned-and-not-done. A user reading back the log
later — or an LLM summarizing the session — would never know a leg-lift was
skipped without manually diffing template vs. workout.

**Suggested fix:** the summary string should reflect plan-vs-actual when a
template is involved, e.g. *"Logged workout — RPE 7, 5/6 exercises (1
skipped)."*

---

## Gap 7: Skip-deviations leave no trace in stored workouts

`get_workout 1` returns five exercise instances. The skipped 6th exercise
is **completely absent** from the stored record — no row with `planned_sets:
3, sets: []`, no archived flag, nothing. The only way to know the user
*intended* to do leg lifts is to fetch the template and diff.

This is a real signal-loss problem. "Did the planned exercise but bombed it
(0 reps)" and "skipped the planned exercise entirely" are different facts
about adherence and recovery. Both should be recoverable from the workout
alone, without joining against the template (which may itself change over
time).

**Suggested fix:** persist skip-deviations as exercise instances with
`planned_sets > 0` and `sets: []` (or a dedicated `skipped: true` column).
Either way, the workout record should be self-describing.

---

## Gap 8: No timezone handling — local time silently lost

`log_workout` accepts `started_at` as an ISO 8601 string. There is no
`timezone` field, no hint in the description about whether the API expects
UTC or accepts an offset, and no return value confirming what was actually
stored. Calling it with `"2026-05-08T16:20:00Z"` (UTC) for a workout the
user described as "4:20pm" silently misrepresents the time by however many
hours the user is offset from UTC.

For an app whose entire premise is cross-signal correlation over time
(sleep × workout, alcohol timing × MPS suppression, circadian patterns),
losing local-time fidelity is not cosmetic — it directly degrades the
analyses the spec is built around.

**Observed failure:** in this session I sent `2026-05-08T16:20:00Z`
intending the user's local 4:20pm. If the user is in PT, the database now
believes the workout started at 9:20am local — a 7-hour error that will
distort sleep/workout/circadian correlations forever.

**Suggested fix:** the right design is **store a `timezone` field on the
user profile** (e.g., `America/Toronto`), and have all log tools accept
either a UTC ISO string with offset OR a naked local datetime that the API
interprets in the user's TZ. Rationale: the user's TZ is the *intended*
interpretation of times like "4:20pm" — the caller's TZ is incidental and
will drift (laptop ↔ phone ↔ LLM with no location). Storing TZ on the
user, not derived per-call, makes "log my workout from earlier" unambiguous
regardless of which client sends it.

Surface it via `get_today_context` and `update_user_profile` so callers
can read/write it. Tool descriptions should state the convention
explicitly — UTC-with-offset, or local-interpreted-via-profile-TZ —
instead of leaving callers to guess.

---

## Gap 9: `log_workout` rejects "did the template exactly as written"

The `log_workout` schema marks `deviations` as **optional**. The
description says:

> Use Shape 2 for "today's PUSH same as usual but..." — much shorter.

The natural reading: send `template_id` alone when the session matched
the template's defaults verbatim. But doing so returns:

> Provide exactly one of `exercises` (full-session shape) or `deviations`
> (template-based shape).

So template-based logging *requires* either `deviations: []` (an empty
array still counts as "provided") or at least one deviation. There is no
way to express "executed the template as written" without sending a
ceremonial empty array — and nothing in the schema or description says so.

**Observed failure:** logged 3 workouts that matched their templates
exactly. All three rejected on first attempt; succeeded only after I
discovered I had to send `deviations: []`.

This penalizes the cleanest-possible case (perfect adherence to plan) and
punishes any caller that reads the schema literally.

**Suggested fix:** treat missing `deviations` as `[]` when `template_id`
is present, OR update the description to say *"when using a template, pass
`deviations: []` if no deviations occurred"*. The first is strictly
better — fewer required ceremony fields, no documentation to read.

---

## Gap 10: Stim-state `level` is always null

`get_today_context` returns 13 muscle-group stim entries, all with
`level: null` — even for groups trained 4 hours ago that are clearly in
the depleted/recovering range. Other fields (`phase`, `trainable_capacity`,
`advice`) are populated and consistent.

The spec describes "per-muscle-group stimulation meters" as 0–100% bars,
which strongly implies `level` is meant to be that percentage. It is the
single most user-facing number in the spec, and it's empty.

This forces an LLM summarizing "how am I doing today" to either skip the
field entirely or invent a value from the other fields. Both are bad.

**Suggested fix:** either implement `level` (the apparent original
intent), or remove it from the response if it's deferred — silently null
fields make agents distrust the whole payload.

---

## Gap 11: `change_30d_kg` reported with 4 days of data

`trend_weight.change_30d_kg: -0.05` is returned even though only 4 weight
readings exist (5/8 → 5/12). The number cannot meaningfully be a 30-day
change — there's no 30-day window to compute over.

The spec *itself* sets the precedent for honesty here: TDEE is gated
behind a 14-day calibration period and labeled as `"calibrating, X days
remaining"`. Trend-weight should follow the same discipline.

**Suggested fix:** return `null` (or a `confidence`/`window_days_actual`
field) until ≥30 days of data exist. Same model as TDEE's `confidence:
"seeding"` + `days_remaining_to_calibrate`.

---

## Gap 12: `today.workouts` includes yesterday's workout

`get_today_context` returned `today.workouts: [{id: 4, ...}]`. Workout 4
is the LEGS session at `2026-05-13T00:00:00Z` — that's *5/12 8:00pm
EDT*, i.e. yesterday in the user's local time. "Today" claims it as
today's workout because the lookback is computed in UTC, not the user's
TZ.

This compounds Gap 8: without a stored user TZ, "today" is whatever the
server thinks today is, which is wrong any time the user trains in the
evening. For an evening trainer (most people), this misclassifies
recovery state on a daily basis.

**Suggested fix:** ships with Gap 8 — once the user has a stored TZ, all
"today" boundaries should be computed in that TZ.

---

## Gap 13: `trainable_capacity` enum is undocumented

Stim entries return `trainable_capacity: 20 | 50 | 100`. Nothing in the
MCP describes:

- What scale this is (percent? abstract score?)
- What the three values mean (20 = depleted? overworked? do-not-train?)
- Whether values between (e.g. 75) are possible or these are fixed
  buckets

An LLM can *guess* from co-occurring fields (20 always pairs with
`phase: too_soon` + `recommendation: rest`; 100 always pairs with
`phase: prime`), but those guesses go untested. A new caller — or this
caller next session — has to re-derive the meaning from scratch.

**Suggested fix:** document the enum in the `get_today_context`
description, OR replace the magic numbers with named values
(`"depleted" | "recovering" | "fresh"`), OR add a `legend` block to the
response.

---

## Gap 14: `log_meal` summary is always "Today" regardless of date

Every `log_meal` response embedded a summary like:

> Logged meal — 200 kcal, 20p / 18c / 6f. Today: 0/2350 (0%).

…even when the meal's `eaten_at` is days in the past. Logging a 620-kcal
pizza that was eaten on Friday returned "Today: 0/2350 (0%)" — implying
no progress on today's target, when in fact the meal isn't even *for*
today.

The `today` block (`kcal_in`, `protein_g_in`, `effective_kcal`) returned
on every meal ignores which day the meal belongs to. For batch-loading
historical data (the entire premise of Gap 5's bulk import), every line
of the response is uninformative noise.

**Suggested fix:** the embedded summary should reflect the day of the
*meal just logged*, e.g. *"Logged meal for May 8 — 620 kcal. May 8 total:
1798/2350 (76%)."* Today's totals can stay in a separate field if needed.

---

## Gap 15: No per-day macro rollup for past dates

`get_macros_today` returns today's totals only. There is no
`get_macros_for_date(YYYY-MM-DD)` or equivalent. To answer "did I hit my
protein target on May 8?", a caller has to:

1. Call `get_meals` with a date window
2. Sum `kcal`/`protein_g`/`carb_g`/`fat_g` themselves
3. Re-fetch the phase target separately to compare

The spec frames this app as historical pattern-finding (workout × sleep
× macros over weeks). Without a per-day macros endpoint, every analysis
of a non-current day requires the caller to reimplement aggregation.

**Suggested fix:** add `get_macros_for_date(date)` (and/or
`get_macros_range(from, to)`) that returns the same shape as
`get_macros_today` but for an arbitrary date. Pairs naturally with
fixing Gap 8 so "date" is unambiguous.

---

## Gap 16: Date-range queries use UTC boundaries, splitting local days

Querying meals for "Friday May 8" with `from: 2026-05-08T00:00:00Z` and
`to: 2026-05-09T00:00:00Z` returned 5 of the 6 meals actually eaten on
Friday in the user's TZ. The missing meal — a protein cookie at
`2026-05-09T01:00:00Z` (9:00pm EDT Friday) — fell into Saturday because
the query window is in UTC.

Same root cause as Gap 8 and Gap 12: the system has no concept of "the
user's day." Every date-shaped read is silently wrong by hours for
evening eaters/exercisers. The error compounds when callers try to
verify totals: I expected 1798 kcal for Friday, got 1686, was missing
exactly the cookie that crossed the UTC boundary.

**Suggested fix:** ships with Gap 8. Once a user TZ exists, all
date-range tools should accept a *date* (`from_date: "2026-05-08"`) and
compute the boundary in user-local time, OR clearly document that
boundaries are UTC and require callers to pass timestamps with offsets
that match the user's day.

**Real-world impact (measured this session):** the user logged meals
for 4 days (Fri/Sat/Mon/Tue), with a true daily average of **1929
kcal**. UTC bucketing split their evening meals across 5 calendar days
and reported **1658 kcal** — a **271 kcal/day under-report (~14% off)**.
For someone in maintenance, 271 kcal/day is the difference between
maintaining weight and losing roughly 1.5 lb/month. The bug is not
cosmetic — it directly distorts the most consequential number the app
shows.

---

## Gap 17: `log_cardio` has no `steps` field

`log_cardio` accepts `duration_min`, `avg_hr`, `distance_km`,
`modality`, `est_kcal`, and `notes` — but no `steps`. Every modern
fitness watch reports steps as the primary cardio metric (often the
*only* metric for casual walks). Forcing it into `notes` makes it
unqueryable for trends ("avg daily steps over 30 days?") and unparseable
for downstream analysis.

**Observed friction:** logging a 4300-step walk and a 7700-step day, I
had to embed both numbers in free-text notes. The data is in the system
but not in a form the system can compute on.

**Suggested fix:** add `steps` (optional integer) to `log_cardio`. Bonus
points for `daily_steps` as a separate top-level concept since steps
accumulate across the day independently of any single "session."

---

## Gap 18: `slept_on` semantics fight natural-language input

`log_sleep.slept_on` is documented as the **wake date** ("the morning
after the night being logged"). Technically unambiguous — but it
collides with how people actually talk about sleep.

When a user says *"Friday's sleep"*, they almost always mean the night
that began on Friday (Fri→Sat). With `slept_on = wake date`, that maps
to `2026-05-09` (Saturday). It is extremely easy — even with the
description in front of you — to log it as `2026-05-08` and silently
shift every night by one day.

**Observed failure:** in this session I read the user's "Friday's sleep
7h38m" and logged it under `slept_on: 2026-05-08`. The user noticed and
corrected; the entries were rejected and re-sent. With less attention
that error would have stuck and contaminated every sleep × workout
correlation downstream.

**Suggested fix (any one):**
- Accept `night_of` (date the night *started*) as an alternative to
  `slept_on`, and let callers pick the framing that matches their input
- Echo back the wake-date interpretation in the success summary
  ("Logged sleep for night of Fri May 8 → woke Sat May 9 — 7.6h, 4/5"),
  so an off-by-one error is visible at log time
- Rename `slept_on` to `wake_date` so the field name carries its
  own warning

The first option is the most forgiving; the second is the cheapest
behavioral fix; the third is the cheapest schema fix.

---

## Gap 19: `week_to_date` ignores cardio and alcohol

`get_today_context.week_to_date` includes `workouts_count`,
`avg_kcal_in`, `avg_protein_g`, `sleep_avg_hours`, and `sleep_debt`. It
does **not** include cardio totals (kcal burned, sessions, minutes) or
alcohol totals (drinks, kcal, drinking days).

This is not a missing query — `get_cardio_recent` and
`get_alcohol_recent` exist. The gap is in the **default cross-signal
snapshot**: a tool literally named "today context" silently omits two
of the spec's named recovery signals. The spec promises an "alcohol
effect overlay on stim pills" with 0–6h / 6–24h / 24h+ windows; the
data is in the database but is not reflected anywhere in
`get_today_context`'s recovery state.

**Suggested fix:** add `week_to_date.cardio_kcal`,
`cardio_minutes`, `cardio_sessions_count`, `alcohol_drinks_count`,
`alcohol_kcal`, `drinking_days_count`. Stim entries should also surface
"recent alcohol within X hours" so the overlay the spec describes is
actually computable from the snapshot alone.

---

## Gap 20: TDEE and `week_to_date` disagree on the same data

`get_today_context` returned, in the same call:

```
week_to_date.avg_kcal_in: 1658
tdee.components.avg_kcal_in: 0
tdee.components.days_remaining_to_calibrate: 10
```

Both fields purport to summarize meal data, but disagree by ~1700
kcal. After investigation: `week_to_date` divides total kcal by *days
that had data* over the last 7 days (5 days = 1658). The TDEE
component appears to require a longer window (likely 14+ days), and
since most of that window has no data, it reports `0` rather than a
partial estimate.

This is *probably* defensible logic — TDEE needs more data than a
weekly summary — but **the response doesn't say so**. A user or LLM
reading these two fields side-by-side has no way to know they're
computed over different windows; the natural interpretation is "two
aggregators looking at the same data, one of them is broken." The
response should make the windowing visible (e.g.
`tdee.components.window_days_required: 14`) instead of silently
zeroing the field.

**Suggested fix:** add `window_days` (and `days_with_data`) to every
aggregate field. Pairs with Gap 23.

---

## Gap 21: `today.body_weight_kg` is null when the scale is skipped

`today.body_weight_kg: null` after I had logged weights through 5/12
(yesterday). The current-day field is null because there's no reading
*for today*, even though a reading from yesterday is the obvious
fallback for a trend-based app.

For someone who weighs themselves daily, this is fine. For anyone with
realistic adherence (skipped mornings, traveling, sick) the field is
empty most days and the snapshot loses a value it should be able to
provide.

**Suggested fix:** fall back to `most_recent_weight` (with the date)
when no reading exists for today. Or add a separate
`most_recent_weight_kg` + `most_recent_weight_on` pair so the snapshot
is self-sufficient without erasing the "did the user weigh today?"
signal.

---

## Gap 22: `contributing_sessions` lacks a date

Each stim entry returns:

```
"contributing_sessions": [
  { "workout_id": 4, "quality_volume": 4840.92, "context_multiplier": 1 }
]
```

No `started_at`, no date. To reason about *when* a session contributed
(critical for the spec's decay-curve narrative — "0–7d neutral, 7–14d
mild fade, …"), the consumer must fetch each workout by id separately.

**Suggested fix:** include `started_at` (or just the ISO date) on each
contributing-session entry. Trivially additive, no schema break.

---

## Gap 23: Aggregate field semantics are undocumented

`week_to_date.avg_kcal_in: 1658` is computed as *total kcal / days that
had data*, not *total kcal / 7*. Without reading the source, a user
seeing 1658 for a week where they ate Friday + Saturday + Monday +
Tuesday could reasonably guess any of:

- Sum / 7 (rolling 7-day calendar avg → 1102)
- Sum / 5 (days-with-data → 1658) ✅ actual
- Sum / 4 (just Mon-Thu of current week)
- Sum of last 7 actual days regardless of having data

Each gives a wildly different number. The field is named identically
in `get_today_context` and `tdee.components`, but the two use different
denominators (Gap 20).

This isn't unique to kcal — every "avg" or "rate" field has the same
problem. `sleep_avg_hours`, `avg_protein_g`, `change_30d_kg`, the
trend-weight EMA, all of them.

**Suggested fix:** every aggregate field should ship alongside its
`window_days` and `days_with_data`. For example:

```json
"avg_kcal_in": 1658,
"avg_kcal_in_window_days": 7,
"avg_kcal_in_days_with_data": 5
```

Or wrap each aggregate in an object:

```json
"avg_kcal_in": { "value": 1658, "window_days": 7, "days_with_data": 5 }
```

The wrapper is uglier but makes the semantics impossible to miss.

---

## Gap 24: Recommendations are muscle-group-level; users think template-level

`get_today_context.stim_states` returns 13 muscle-group entries with
phase and advice. For a coach doing per-muscle programming this is
useful. For a user on a fixed split (PPL, upper/lower, full-body) it
is **the wrong granularity**: the user's question is *"is today PUSH,
PULL, or LEGS?"*, not *"how primed are my obliques?"*

The system already has both halves of the answer:

- Each template (`workout_template`) declares which exercises it
  contains
- Each exercise belongs to a muscle group
- Each muscle group has a current `phase` (`prime` / `too_soon` / etc.)

It just doesn't connect them. A `get_recommended_template` tool would
walk: which template's exercises hit the most `prime` groups and the
fewest `too_soon` groups → that's the recommendation. Output reduces
13 lines of stim state to one sentence:

> "PULL day. Back, biceps, side/rear delts, traps, obliques, forearms
> all in prime window. Estimated session value: high."

**Suggested fix:** add `get_recommended_template` (or surface the
recommendation inline in `get_today_context`). The scoring rule is the
interesting design question — simplest viable: `score = sum(prime
groups hit) - 2 × sum(too_soon groups hit)`, then return the
top-scoring template with reasoning. Users on no-template programming
can still fall back to the per-group view; users on a fixed split get
the answer they're actually asking for.

**Why this matters:** the spec frames the app as "advisor, not
scorekeeper." Per-group output is a scorecard. Per-template output is
advice. They are not the same thing.

---

## Gap 25: `start_nutrition_phase` has no `planned_end_on`

The schema accepts `started_on` but no `planned_end_on` (or
`target_end_on`, `duration_weeks`, etc.). When the user said "the cut
ends July 1," that date had nowhere structured to go and got dropped
into `notes`.

This blocks several obvious computations:

- "You're 12 days into a 61-day cut, ~20% complete"
- "At your current trend (-0.3 lb/week), you'll finish 4 lb light of
  your goal — consider extending or steepening"
- "12 days remaining; if you average 1900 kcal/day from here you'll
  net X lb"

All of these require knowing when the phase is *supposed* to end. The
existing `ended_on` field only fires when the phase actually closes
(via `start_nutrition_phase` starting a new one) — it's the *actual*
end, not the planned one.

**Suggested fix:** add optional `planned_end_on` to
`start_nutrition_phase`. Surface "days into phase" and "days remaining"
in `get_today_context.phase`. This is a small schema add but unlocks
the whole class of cut/bulk progress reasoning the spec implies but
can't currently compute.

---

## Priority

Priorities 1–12 were addressed by the `feature/mcp-gaps-priority-1-12`
branch — see `docs/superpowers/specs/2026-05-13-mcp-gaps-priority-1-12-design.md`
and `docs/superpowers/plans/2026-05-13-mcp-gaps-priority-1-12.md`.

1. ✅ **Treat missing `deviations` as `[]`** (Gap 9) — `FromTemplateShape.deviations`
   defaults to `[]`; `log_workout` accepts `{ template_id, started_at, rpe }` alone.
2. ✅ **Add the three `list_*` tools** (Gap 2) — `list_exercise_groups`,
   `list_exercises`, `list_workout_templates` (with items inline).
3. ✅ **Fix the `define_exercise` description** (Gap 4) — `group_id` now
   references `list_exercise_groups`, not the bogus `get_exercise_groups`.
4. ✅ **Decide on timezone convention + add user TZ field** (Gap 8) —
   `users.timezone` column added, `userDayWindow`/`parseLogTimestamp` helpers
   in `@almanac/core/domain`. Log routes normalize naked-local timestamps via
   user TZ; date-range reads accept `from_date`/`to_date`. **Free fixes for
   Gaps 12 (today-includes-yesterday) and 16 (date-range-splits-local-days)
   land with this.** `DAY_START_HOUR = 4` (a 2am drink belongs to yesterday).
5. ✅ **Add `get_macros_for_date` (and `_range`)** (Gap 15) — new
   `GET /v1/signals/macros` route (date | range | at modes) + two MCP tools.
6. ✅ **Fix `log_meal` "Today" summary to reflect the meal's date** (Gap 14) —
   tool now GETs `/v1/signals/macros?at=<eaten_at>` and emits
   `"Logged meal for 2026-05-08 — ..."`.
7. ✅ **Persist skip-deviations** (Gap 7) — `exercise_instances.skipped_at`
   column added; skipped rows persist with `sets: []` + `skipped_at` set, so
   bombed vs skipped is distinguishable. Stim signal filters skipped rows from
   `last_hit_at` and contributing-volume math.
8. ✅ **Hierarchy hints in `define_*` descriptions** (Gap 1) — each `define_*`
   description cross-references its discovery/sibling tools by name.
9. ✅ **Improve workout summary** (Gap 6) — `summarizeWorkout` emits
   `"N/M exercises (X skipped)"` when template-driven.
10. ✅ **Rename `trainable_capacity` to named enum** (Gap 13) —
    `'depleted' | 'recovering' | 'fresh'` replaces the magic numbers.
11. ✅ **Implement stim `level`** (Gap 10) — always populated 0–100. Primary
    path is the comparative ratio (your-recent ÷ your-baseline × 100, capped);
    fallback is decay-weighted recent credit for week-one users; 0 with no
    sessions. Helpful early, never null.
12. ✅ **Replace `change_30d_kg` with `weight_change`** (Gap 11) — new shape
    `{ value_kg, over_days, confidence }`. Both halves describe the same
    30-day-bounded slice; confidence flips at `over_days >= 30`. TDEE also
    adopts the helpful-early pattern: `{ kcal, basis, confidence }`, never
    null, always returns a usable number.
13. **Bulk import** (Gap 5) — bigger scope; deferred as a separate project.

---

Priorities 13–21 (Gaps 17–25 minus 5) were addressed by the
`feature/mcp-gaps-round-2` branch — see
`docs/superpowers/specs/2026-05-14-mcp-gaps-round-2-design.md` and
`docs/superpowers/plans/2026-05-14-mcp-gaps-round-2.md`.

14. ✅ **`steps` on cardio** (Gap 17) — new `cardio_sessions.steps INTEGER`
    column; `log_cardio` and `update_cardio` accept it. Daily totals
    computable via SUM(steps) per user-day.
15. ✅ **Sleep wake-date ergonomics** (Gaps 18, 30) — `log_sleep` accepts
    either `slept_on` (wake date, existing) OR `night_of` (date sleep
    started). Server normalizes to `slept_on`. Success summary echoes
    BOTH dates so off-by-one errors are visible at log time.
16. ✅ **`week_to_date` cardio + alcohol** (Gap 19) — `cardio_sessions_count`,
    `cardio_minutes`, `cardio_kcal`, `alcohol_drinks_count`, `alcohol_kcal`,
    `drinking_days_count` added. All Aggregate-wrapped.
17. ✅ **TDEE / week_to_date denominator visible** (Gap 20) — TDEE's
    `components.avg_kcal_in` is now an `Aggregate`. Two aggregators using
    the same name can no longer silently disagree about the window.
18. ✅ **`today.most_recent_weight` fallback** (Gap 21) — `body_weight_kg`
    stays null when no reading today (preserves "did the user weigh
    themselves" signal); `most_recent_weight: { value_kg, on_date }`
    provides the latest known value.
19. ✅ **`contributing_sessions[].started_at`** (Gap 22) — stim entries now
    expose the session timestamp so callers can reason about decay timing
    without a second round-trip.
20. ✅ **Aggregate wrapper everywhere** (Gap 23) — `week_to_date.*` fields
    plus `tdee.components.avg_kcal_in` become `{ value, window_days,
    days_with_data }`. Zero-data returns the wrapper with
    `days_with_data: 0`, never null.
21. ✅ **`get_recommended_template`** (Gap 24) — new MCP tool. Scoring:
    `prime_groups_hit - 2 × too_soon_groups_hit`. Returns ranked
    recommendations with reasoning (which groups are prime/too_soon).
22. ✅ **`planned_end_on` on nutrition phases** (Gap 25) — schema column +
    `start_nutrition_phase` accepts it. `get_today_context.phase` gains
    `days_in` and `days_remaining` (negative when the phase has overrun).
23. ✅ **Alcohol kcal canonical via `log_alcohol`** (Gap 26) — `log_meal`
    description warns against logging drinks as meals. `computeDayKcalIn`
    and `GET /v1/signals/macros` were already merging both sources
    correctly; the doc fix prevents future double-counting.
24. ✅ **`bootstrap_user` MCP tool** (Gap 27) — new tool + `POST /v1/users`
    route. Empty-DB 401 error message points at it. CLI dependency removed.
25. ✅ **`phase.days_in`** (Gap 28) — bundled with Gap 25 in
    `get_today_context.phase`.
26. ✅ **Drop auto-seeded phase** (Gap 29) — `seedUserAndPhase` →
    `seedUser`. First user-driven `start_nutrition_phase` is now phase id 1
    instead of 2.
