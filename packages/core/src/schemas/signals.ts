import { z } from "zod";
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from "./common.js";
import { PhaseIntentSchema, PhaseTypeSchema, TdeeSourceSchema } from "./nutrition.js";
import { UntrackedReasonSchema } from "./untracked-periods.js";
import { ActivityLevelSchema, UnitSystemSchema } from "./users.js";

/**
 * Schema for the `Aggregate` wrapper that the signals layer emits for any
 * windowed average/total. The wrapper makes the denominator visible so two
 * aggregators reading the same data can't silently disagree.
 */
export const AggregateSchema = z.object({
  value: z.number(),
  // window_days is nonnegative — 0 is a legitimate "no window applied" signal
  // (e.g. TDEE.components.avg_kcal_in in the profile_baseline tier, where no
  // measured intake window has been used yet).
  window_days: z.number().int().nonnegative(),
  days_with_data: z.number().int().nonnegative(),
});

/**
 * Shared shape for the pre-composed energy-balance summary that appears on
 * both `TodayContextResponseSchema.today.energy_balance` and
 * `DayStatusResponseSchema.summary.energy_balance`. `computeDayStatus`
 * surfaces the same object verbatim, so the two response surfaces are
 * structurally identical by construction — defining the schema once keeps
 * them that way as the shape evolves.
 *
 * Sign convention: negative `net` = deficit (out > in), positive = surplus.
 * `cardio_out`, `workout_out`, and `steps_out` are display-only — they're NOT
 * subtracted from `net`, because `tdee_baseline` already integrates average
 * activity (including NEAT via trend weight). See `signals/today.ts` for the
 * full rationale.
 */
export const EnergyBalanceSchema = z.object({
  food_in: z.number().int(),
  alcohol_in: z.number().int(),
  total_in: z.number().int(),
  tdee_baseline: z.number().int(),
  cardio_out: z.number().int(),
  workout_out: z.number().int(),
  steps_out: z.number().int(),
  net: z
    .number()
    .int()
    .describe(
      "Live exploratory net for today: intake − TDEE as of the last completed day (asOf = today − 1). May differ from the daily_net snapshot (net_kcal, asOf=D−1). Use net_kcal for historical/day-attributed values.",
    ),
});

const StimPhaseSchema = z.enum([
  "too_soon",
  "acceptable",
  "prime",
  "in_window",
  "fading",
  "detrained",
]);

export const StimStateResponseSchema = z.object({
  group_id: IdSchema,
  group_name: z.string(),
  level: z.number(),
  trainable_capacity: z.enum(["depleted", "recovering", "fresh"]),
  phase: StimPhaseSchema,
  last_hit_at: IsoDateTimeSchema.nullable(),
  hours_since_last_hit: z.number().nullable(),
  advice: z.object({
    recommendation: z.string(),
    rationale: z.string(),
    suggested_intensity_pct: z.number(),
  }),
  contributing_sessions: z.array(
    z.object({
      workout_id: IdSchema,
      started_at: IsoDateTimeSchema,
      quality_volume: z.number(),
      context_multiplier: z.number(),
    }),
  ),
});

export const TDEEResponseSchema = z.object({
  kcal: z.number().int().positive(),
  basis: z.enum(["profile_baseline", "measured_intake"]),
  confidence: z.enum(["early", "established"]),
  // Provenance for the kcal value — see core/domain/nutrition.ts TdeeSource.
  // `formula` and `profile_baseline` basis travel together (Mifflin BMR ×
  // activity multiplier); `measured` aligns with the back-calc basis;
  // `user_asserted` only surfaces when something downstream (e.g. a phase
  // snapshot) was provided by the user — computeTDEE itself never emits it.
  source: TdeeSourceSchema,
  window_days: z.number().int().nonnegative(),
  days_of_data: z.number().int().nonnegative(),
  components: z.object({
    avg_kcal_in: AggregateSchema,
    trend_weight_change_kg: z.number(),
    days_remaining_to_calibrate: z.number().optional(),
    // Set when the meal-days guard trips in computeTDEE — enough weight
    // data for back-calc but too few logged meal days. Tells the caller
    // how many more meal days the user needs to log.
    meal_days_remaining_to_calibrate: z.number().optional(),
    // Count of window days the user marked untracked (vacation/sick/deload).
    // Absent or 0 when none. Lets a consumer interpret a thin measured-TDEE
    // window (e.g. window_days: 21, days_of_data: 9, untracked_days_in_window: 5).
    untracked_days_in_window: z.number().int().nonnegative().optional(),
  }),
});

export const SleepDebtResponseSchema = z.object({
  debt_hours: z.number(),
  window_days: z.number().int(),
  baseline_hours: z.number(),
  avg_hours: z.number(),
  nights_logged: z.number().int(),
});

export const TrendWeightPointResponseSchema = z.object({
  date: IsoDateSchema,
  raw_kg: z.number().nullable(),
  trend_kg: z.number(),
});

export const WeightChangeResponseSchema = z.object({
  value_kg: z.number(),
  over_days: z.number().int().nonnegative(),
  confidence: z.enum(["early", "established"]),
});

/**
 * Macros block: kcal + the three macro breakdowns. Used for both `target` and
 * `intake` — same shape, different semantics (planned vs. actual).
 */
export const MacrosSchema = z.object({
  kcal: z.number(),
  protein_g: z.number(),
  carb_g: z.number(),
  fat_g: z.number(),
});

/**
 * Observed telemetry vs. the phase target: the activity breakdown, signed
 * deltas and the on/off-track verdict. See `core/signals/daily-target.ts` for
 * the formula and the docs/superpowers/specs/2026-05-23-tdee-refactor-design.md
 * spec for the status thresholds.
 *
 * `vs_target` / `vs_maintenance` are signed deltas from intake (negative =
 * below reference). The activity breakdown (`cardio_kcal` / `workout_kcal` /
 * `steps_kcal`) is display-only.
 */
export const ObservedSchema = z.object({
  cardio_kcal: z.number(),
  workout_kcal: z.number(),
  steps_kcal: z.number(),
  vs_target: z.number(),
  vs_maintenance: z.number(),
  status: z.enum(["on_track", "at_risk", "off_track"]),
});

/**
 * Structured target/maintenance/intake/observed for a single user-day. The
 * shape mirrors the spec under "Response shape" — two distinct numbers, never
 * conflated: the static `target` (phase anchor) and the dynamic `observed`
 * telemetry. See docs/superpowers/specs/2026-05-23-tdee-refactor-design.md.
 *
 * `effective_kcal` is intentionally absent — removed in the TDEE refactor (no
 * deprecation cycle; see spec §"Deprecation of effective_kcal").
 */
export const DailyTargetResponseSchema = z.object({
  target: MacrosSchema,
  maintenance: z.object({ kcal: z.number() }),
  intake: MacrosSchema,
  observed: ObservedSchema,
});

export const DayKcalInResponseSchema = z.object({
  date: IsoDateSchema,
  kcal: z.number(),
});

export const DayMacrosTotalsSchema = z.object({
  kcal: z.number(),
  protein_g: z.number(),
  carb_g: z.number(),
  fat_g: z.number(),
  // Breakdown of `kcal` by source. Sums to `kcal` exactly. Exposed because
  // consumers were mentally re-deriving this from separate fields and getting
  // it wrong (counting alcohol twice, or forgetting it). See gap notes.
  kcal_from_food: z.number(),
  kcal_from_alcohol: z.number(),
});

/**
 * Per-day macros response. `day_target` is nullable: a fresh user (no active
 * nutrition phase) has no target/maintenance/observed snapshot, but day_totals
 * (logged meals + alcohol) still always render.
 */
export const DayMacrosResponseSchema = z.object({
  date: IsoDateSchema,
  day_totals: DayMacrosTotalsSchema,
  day_target: DailyTargetResponseSchema.nullable(),
  net_kcal: z
    .number()
    .nullable()
    .describe(
      "Frozen daily NET snapshot: intake − computeTdeeAsOf(D−1). Authoritative per-day value; differs from the live energy_balance.net.",
    ), // null when no intake snapshot
  untracked: z.boolean(),
});

export const DayMacrosRangeResponseSchema = z.object({
  days: z.array(DayMacrosResponseSchema),
});

export const TrainingHistorySummarySchema = z.object({
  window_days: z.number().int(),
  sessions: z.number().int().nonnegative(),
  by_split: z.array(
    z.object({
      template_name: z.string(),
      sessions: z.number().int(),
      last_trained: z.string(),
      avg_rpe: z.number().nullable(),
      rpe_vs_baseline: z.enum(["up", "down", "steady"]).nullable(),
      deviation_rate: z.number(),
      notable_deviation: z.string().nullable(),
    }),
  ),
  load_progression: z.array(
    z.object({
      exercise_name: z.string(),
      direction: z.enum(["climbing", "stalled", "dropping"]),
      from_kg: z.number(),
      to_kg: z.number(),
    }),
  ),
  frequency_note: z.string().nullable(),
});

export const RecommendTemplateResponseSchema = z.object({
  recommendations: z.array(
    z.object({
      template_id: IdSchema,
      template_name: z.string(),
      score: z.number(),
      // "actionable" = score reflects a real timing signal (some prime/
      // in_window/too_soon group was hit). "low" = degenerate score-0 case
      // (everything overdue/untrained), so the ranking is noise and consumers
      // should not present it as confident advice. See recommend-template.ts.
      confidence: z.enum(["actionable", "low"]),
      // Secondary sort key after `score`: average hours since last hit across
      // the template's muscle groups. Untrained groups count as 999_999h
      // (sentinel for "infinitely recovered") so JSON-serializes cleanly and
      // pushes the average up. See recommend-template.ts JSDoc.
      avg_recovery_hours: z.number(),
      reasoning: z.object({
        prime_groups_hit: z.array(z.string()),
        in_window_groups_hit: z.array(z.string()),
        too_soon_groups_hit: z.array(z.string()),
        neutral_groups_hit: z.array(z.string()),
        // fading/detrained groups — signal a training gap (the layoff case).
        overdue_groups_hit: z.array(z.string()),
      }),
    }),
  ),
});

/** Calendar pill phase enum — subset of StimPhase, emitted phases only. */
export const CalendarPhaseSchema = z.enum(["too_soon", "acceptable", "prime", "in_window"]);

export const CalendarPastSessionSchema = z.object({
  date: IsoDateSchema,
  workout_id: IdSchema,
  template_id: IdSchema,
  template_name: z.string(),
});

export const CalendarPillSegmentSchema = z.object({
  date: IsoDateSchema,
  phase: CalendarPhaseSchema,
  is_proposed: z.boolean(),
});

export const CalendarPillEntrySchema = z.object({
  template_id: IdSchema,
  template_name: z.string(),
  last_hit_at: IsoDateTimeSchema,
  segments: z.array(CalendarPillSegmentSchema),
});

export const CalendarResponseSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM (01-12)"),
  tally: z.object({
    total: z.number().int().nonnegative(),
    by_template: z.record(z.string(), z.number().int().nonnegative()),
  }),
  past_sessions: z.array(CalendarPastSessionSchema),
  pill_segments: z.array(CalendarPillEntrySchema),
  untracked_bands: z.array(
    z.object({
      from: IsoDateSchema,
      to: IsoDateSchema,
      reason: UntrackedReasonSchema,
    }),
  ),
});

export const AlcoholOverlayResponseSchema = z.object({
  workout_id: IdSchema,
  drinks_peak_mps_zone: z.number(),
  drinks_sleep_zone: z.number(),
  drinks_recovered_zone: z.number(),
  total_drinks_in_window: z.number(),
  est_kcal_in_window: z.number().int(),
});

/**
 * The active-phase block on TodayContext. Inherits every NutritionPhase field
 * (including the four TDEE refactor fields) plus two derived fields
 * (days_in / days_remaining). Kept inline (not composed via `.extend` on
 * NutritionPhaseResponseSchema) because the `_verify.test.ts` drift check
 * uses a strict structural Equals against the `PhaseSummary` TS type — Zod's
 * `.extend` produces a `ZodObject` whose `z.infer` shape doesn't always
 * collapse to a flat object literal, breaking the Equals check.
 */
const PhaseSummarySchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  name: z.string(),
  intent: PhaseIntentSchema,
  phase_type: PhaseTypeSchema.nullable(),
  tdee_at_phase_start: z.number().int().nullable(),
  tdee_source: TdeeSourceSchema.nullable(),
  deficit_kcal: z.number().int().nullable(),
  daily_kcal_target: z.number().int(),
  base_protein_g: z.number().int(),
  base_carb_g: z.number().int(),
  base_fat_g: z.number().int(),
  started_on: IsoDateSchema,
  planned_end_on: IsoDateSchema.nullable(),
  ended_on: IsoDateSchema.nullable(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
  days_in: z.number().int().nonnegative(),
  days_remaining: z.number().int().nullable(),
});

/**
 * Composite "today" payload — see signals/today.ts for the full definition.
 *
 * `phase`, `today.target`, `today.maintenance`, and `today.observed` are all
 * nullable: a new user (or one between phases) sees the dashboard load with
 * the no-phase branch (Task 6). `today.intake` and the phase-independent
 * fields (weight, sleep, workouts, cardio, alcohol, energy_balance, tdee,
 * stim_states, week_to_date, trend_weight) stay non-nullable.
 */
export const TodayContextResponseSchema = z.object({
  now: IsoDateTimeSchema,
  // Resolved user-local calendar day (after the 4am DAY_START_HOUR rollover)
  // that `now` belongs to. Between midnight and 4am local this differs from
  // `now`'s date portion — surfacing it keeps consumers from inferring the
  // wrong date off `now` and contradicting get_day_status.date.
  today_date: IsoDateSchema,
  user: z.object({
    id: IdSchema,
    name: z.string(),
    timezone: z.string(),
    preferred_unit_system: UnitSystemSchema,
    activity_level: ActivityLevelSchema.nullable(),
  }),
  phase: PhaseSummarySchema.nullable(),
  today: z.object({
    kcal_in: z.number(),
    protein_g_in: z.number(),
    carb_g_in: z.number(),
    fat_g_in: z.number(),
    meals_logged_today: z.boolean(),
    target: MacrosSchema.nullable(),
    maintenance: z.object({ kcal: z.number() }).nullable(),
    intake: MacrosSchema,
    observed: ObservedSchema.nullable(),
    body_weight_kg: z.number().nullable(),
    most_recent_weight: z
      .object({
        value_kg: z.number(),
        on_date: IsoDateSchema,
      })
      .nullable(),
    sleep: z.object({ hours: z.number(), quality: z.number().int().nullable() }).nullable(),
    // Today's step log. `null` (no row) is distinct from `{ count: 0,
    // est_kcal: 0 }` (explicit zero) — see today.ts for the rationale.
    steps: z
      .object({
        id: IdSchema,
        count: z.number().int(),
        est_kcal: z.number().int(),
      })
      .nullable(),
    workouts: z.array(
      z.object({
        id: IdSchema,
        template_name: z.string().nullable(),
        rpe: z.number(),
      }),
    ),
    cardio: z.array(
      z.object({
        id: IdSchema,
        modality: z.string().nullable(),
        duration_min: z.number().int().nullable(),
        est_kcal: z.number().int(),
      }),
    ),
    alcohol: z.array(
      z.object({
        id: IdSchema,
        drinks_count: z.number(),
        est_kcal: z.number().int(),
      }),
    ),
    // Pre-composed energy-balance summary. Exposed so consumers don't have to
    // remember the formula and risk double-counting activity.
    //
    // Key rule: `net = total_in − tdee_baseline`. TDEE already encompasses
    // average cardio+workouts+steps (it's back-calculated from energy balance
    // over the trailing window), so adding today's cardio_out / workout_out /
    // steps_out a second time would double-count. They're exposed for
    // visibility only. See `EnergyBalanceSchema` for the field-level
    // documentation and the sign convention.
    energy_balance: EnergyBalanceSchema,
  }),
  week_to_date: z.object({
    workouts_count: AggregateSchema,
    cardio_sessions_count: AggregateSchema,
    cardio_minutes: AggregateSchema,
    cardio_kcal: AggregateSchema,
    alcohol_drinks_count: AggregateSchema,
    alcohol_kcal: AggregateSchema,
    drinking_days_count: AggregateSchema,
    avg_kcal_in: AggregateSchema,
    avg_protein_g: AggregateSchema,
    sleep_avg_hours: AggregateSchema,
    sleep_debt: SleepDebtResponseSchema,
  }),
  stim_states: z.array(StimStateResponseSchema),
  tdee: TDEEResponseSchema,
  trend_weight: z.object({
    current_kg: z.number().nullable(),
    weight_change: WeightChangeResponseSchema.nullable(),
  }),
  /**
   * `true` once the user has logged at least one body weight reading — the
   * minimum the TDEE back-calc needs to ever produce a measured estimate.
   * The web UI uses this to render a "log your weight first" prompt.
   */
  profile_complete: z.boolean(),
  unexplained_gap: z
    .object({
      from: IsoDateSchema,
      to: IsoDateSchema,
      days: z.number().int().positive(),
    })
    .nullable(),
  phase_adherence: z
    .object({
      logged_days: z.number().int(),
      on_track_days: z.number().int(),
      avg_delta_kcal: z.number().nullable(),
    })
    .nullable(),
});

// --- Day status ------------------------------------------------------------

/**
 * Severity bucket for a day-status nudge.
 *   info    — FYI, here's a thing
 *   warn    — you should probably do something
 *   concern — this is a pattern, worth a conversation
 */
export const NudgeSeveritySchema = z.enum(["info", "warn", "concern"]);

/**
 * Nudge codes are stable identifiers — UI / LLM consumers can switch on them.
 * The `details` shape varies per code (discriminated union below).
 */
export const NudgeCodeSchema = z.enum([
  "low_intake_today",
  "no_workout_streak",
  "stale_weight_log",
  "stale_sleep_log",
  "unlogged_steps",
]);

export const DayStatusNudgeSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("low_intake_today"),
    severity: NudgeSeveritySchema,
    message: z.string(),
    details: z.object({
      kcal_in: z.number(),
      avg7d_kcal_in: z.number(),
      fraction: z.number(),
    }),
  }),
  z.object({
    code: z.literal("no_workout_streak"),
    severity: NudgeSeveritySchema,
    message: z.string(),
    details: z.object({
      days_since_last: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    code: z.literal("stale_weight_log"),
    severity: NudgeSeveritySchema,
    message: z.string(),
    details: z.object({
      days_since_last: z.number().int().nonnegative().nullable(),
    }),
  }),
  z.object({
    code: z.literal("stale_sleep_log"),
    severity: NudgeSeveritySchema,
    message: z.string(),
    details: z.object({
      days_since_last: z.number().int().nonnegative().nullable(),
    }),
  }),
  z.object({
    code: z.literal("unlogged_steps"),
    severity: NudgeSeveritySchema,
    message: z.string(),
    details: z.object({
      hour_local: z.number().int(),
    }),
  }),
]);

export const DayStatusResponseSchema = z.object({
  date: IsoDateSchema,
  summary: z.object({
    kcal_in: z.number(),
    kcal_target: z.number().int(),
    kcal_delta: z.number(),
    protein_g_in: z.number(),
    protein_g_target: z.number().int(),
    energy_balance: EnergyBalanceSchema,
    workout_done: z.boolean(),
    sleep_logged: z.boolean(),
    weight_logged: z.boolean(),
    alcohol_logged: z.boolean(),
    meals_logged: z.boolean(),
    steps_logged: z.boolean(),
    status: z.enum(["on_track", "at_risk", "off_track"]).nullable(),
  }),
  nudges: z.array(DayStatusNudgeSchema),
});

// --- Next-best-action -------------------------------------------------------

export const NextBestActionSchema = z.object({
  code: z.enum([
    "complete_profile",
    "log_initial_weight",
    "start_nutrition_phase",
    "create_workout_templates",
    "log_yesterday_sleep",
    "log_yesterday_steps",
    "low_intake_today",
    "no_workout_streak",
    "stale_weight_log",
    "stale_sleep_log",
    "unlogged_steps",
  ]),
  tier: z.enum(["onboarding", "previous_day", "today"]),
  title: z.string(),
  detail: z.string(),
  suggested_tool: z.string(),
  suggested_args: z.record(z.string(), z.unknown()).optional(),
  severity: z.enum(["info", "warn", "concern"]).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const NextBestActionResponseSchema = z.object({
  as_of: IsoDateSchema,
  onboarding_complete: z.boolean(),
  headline: NextBestActionSchema.nullable(),
  actions: z.array(NextBestActionSchema),
  all_clear: z.boolean(),
});
