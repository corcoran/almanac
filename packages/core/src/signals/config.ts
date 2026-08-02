export type StimPhase = "too_soon" | "acceptable" | "prime" | "in_window" | "fading" | "detrained";

export type StimConfig = {
  // Phase boundaries in hours since last hit
  phaseBoundariesHours: {
    tooSoon: number; // 0..48
    acceptable: number; // 48..72
    prime: number; // 72..120
    inWindow: number; // 120..168
    fading: number; // 168..336 (7d–14d)
    // anything beyond 336h is detrained
    detrainedFrom: number;
  };
  // Trainable-capacity curve (% retained, by hours since last hit). Typed as a
  // non-empty tuple so the curve-tail access is provably defined (no assertion).
  capacityCurve: readonly [
    { untilHours: number; pct: number },
    ...{ untilHours: number; pct: number }[],
  ];
  // Advisor recommendations
  advice: Record<
    StimPhase,
    { recommendation: string; suggestedIntensityPct: number; rationale: string }
  >;
  // Decay curve for adaptation level
  decay: {
    fullCreditUntilHours: number; // 168 (7d)
    halfwayFadeAtHours: number; // 240 (10d → 0.85)
    fastFadeAtHours: number; // 504 (21d → 0.5)
    longTailTauHours: number; // 336 (14d τ after 21d)
  };
  // Bodyweight exercise handling
  bodyweight: {
    fallbackKg: number; // used when no body_weights row exists
    defaultMultiplier: number; // applied to body-weight reading (per-exercise refinement deferred)
  };
  // Baseline window for level normalization
  baselineWindow: {
    daysBack: number; // window start = now - daysBack
    daysOmittedAtEnd: number; // window end   = now - daysOmittedAtEnd
    minSessionsForBaseline: number; // below this, level falls back to the decay-based score
  };
  // `level` field shaping. We always populate level (no null) so early-days
  // users see signal instead of a hole.
  level: {
    // Used when baseline data is sparse (week-one user). Recent decay-weighted
    // credit is divided by this ceiling and capped at 100. Tune empirically:
    // a single hard session for an ~80kg lifter should land in the 60-80 range.
    earlyDaysCeiling: number;
  };
};

export const DEFAULT_STIM_CONFIG: StimConfig = {
  phaseBoundariesHours: {
    tooSoon: 48,
    acceptable: 72,
    prime: 120,
    inWindow: 168,
    fading: 336,
    detrainedFrom: 336,
  },
  capacityCurve: [
    { untilHours: 24, pct: 20 },
    { untilHours: 48, pct: 50 },
    { untilHours: 72, pct: 80 },
    { untilHours: 120, pct: 100 },
    { untilHours: 168, pct: 95 },
    { untilHours: 240, pct: 90 },
    { untilHours: 336, pct: 75 },
    { untilHours: 504, pct: 55 },
    { untilHours: Number.POSITIVE_INFINITY, pct: 35 },
  ],
  advice: {
    too_soon: {
      recommendation: "rest",
      suggestedIntensityPct: 0,
      rationale: "Hit recently — another session would likely be junk volume.",
    },
    acceptable: {
      recommendation: "normal_session",
      suggestedIntensityPct: 90,
      rationale: "Recovered enough to train, especially for fast-recovering groups.",
    },
    prime: {
      recommendation: "normal_session",
      suggestedIntensityPct: 100,
      rationale: "Ideal restimulation window — push.",
    },
    in_window: {
      recommendation: "normal_session",
      suggestedIntensityPct: 100,
      rationale: "Still good, train soon.",
    },
    fading: {
      recommendation: "light_reminder",
      suggestedIntensityPct: 87,
      rationale: "Stimulus decaying — deliberate session at ~85–90%, RPE 7 ceiling.",
    },
    detrained: {
      recommendation: "light_reminder",
      suggestedIntensityPct: 75,
      rationale: "Real adaptation loss — drop ~25%, rebuild over 2 sessions.",
    },
  },
  decay: {
    fullCreditUntilHours: 168,
    halfwayFadeAtHours: 240,
    fastFadeAtHours: 504,
    longTailTauHours: 336,
  },
  // Bodyweight handling (§5.2.1 of the spec)
  bodyweight: {
    fallbackKg: 75, // when no body_weights row exists at all
    defaultMultiplier: 1.0, // per-exercise refinement is post-v1
  },
  // Baseline-window for level normalization (§5.2.2 of the spec)
  baselineWindow: {
    daysBack: 21, // window starts now - 21d
    daysOmittedAtEnd: 7, // window ends now - 7d  (i.e., the 14-day band from 21d ago → 7d ago)
    minSessionsForBaseline: 2, // fewer → level falls back to the decay-based score (week-one path)
  },
  level: {
    // Picked so a typical hard session (~4000-5000 quality_volume) lands in
    // the 60-80 range; exceptional sessions saturate at 100. Tune later.
    earlyDaysCeiling: 7000,
  },
};

export type TdeeConfig = {
  defaultWindowDays: number;
  fallbackWindowDays: number;
  /**
   * Upper bound on the measured back-calc window. The window is
   * clamp(daysAvailable, fallbackWindowDays, maxBackcalcWindowDays): as wide as
   * the user's data allows, capped here. A wider window de-weights any single
   * window-edge weight spike (water/glycogen), which a shorter window reads as a
   * too-fast loss rate and inflates TDEE.
   */
  maxBackcalcWindowDays: number;
  kcalPerKg: number;
  seedActivityMultiplier: number;
  // Days of weight data required before `confidence` flips from "early" to
  // "established". Below this, the energy-balance back-calc still runs but is
  // tagged "early" so callers know the trend has wide noise bars.
  establishedThresholdDays: number;
  // Minimum days-with-meal-data required to trust the back-calc. Without this
  // guard, a sparse-logger (or vacationing user) gets TDEE computed from a
  // 2- or 3-day average, which the energy-balance equation then extrapolates
  // across the full window — silently producing a wildly wrong number.
  // 7 = one honest week of logged meals.
  minMealDaysForBackcalc: number;
};

export const DEFAULT_TDEE_CONFIG: TdeeConfig = {
  defaultWindowDays: 21,
  fallbackWindowDays: 14,
  maxBackcalcWindowDays: 28,
  kcalPerKg: 7700,
  seedActivityMultiplier: 1.4,
  establishedThresholdDays: 60,
  minMealDaysForBackcalc: 7,
};

/**
 * Cold-start activity multipliers (Mifflin BMR × factor → maintenance
 * estimate). Only used on the `profile_baseline` TDEE path. A user with
 * `activity_level === null` falls back to DEFAULT_TDEE_CONFIG.seedActivityMultiplier.
 */
export const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const satisfies Record<"sedentary" | "light" | "moderate" | "active" | "very_active", number>;

export type SleepConfig = {
  windowDays: number;
  baselineHours: number;
};

export const DEFAULT_SLEEP_CONFIG: SleepConfig = {
  windowDays: 7,
  baselineHours: 8,
};

export type TrendWeightConfig = {
  halfLifeDays: number;
};

export const DEFAULT_TREND_WEIGHT_CONFIG: TrendWeightConfig = {
  halfLifeDays: 10,
};

export type DayStatusConfig = {
  /**
   * "Way lower than normal" intake threshold. If today's kcal intake is below
   * this fraction of the trailing 7-day average, we flag `low_intake_today`.
   * 0.3 = under 30% of avg. Captures fasting-day weirdness without firing on
   * one merely-light day. The 7-day average is computed over tracked days
   * only — untracked (vacation/sick/deload) days are excluded so a lightly-
   * logged vacation doesn't drag the baseline down. (This differs from
   * `week_to_date.avg_kcal_in.value`, which does not apply that exclusion.)
   */
  lowIntakeFractionOfAvg: number;
  /**
   * Maximum consecutive days with no resistance workout before we flag
   * `no_workout_streak`. Cardio-only days don't reset the counter — the
   * intent is "you stopped training", not "you stopped moving".
   */
  noWorkoutMaxDays: number;
  /**
   * Maximum consecutive days with no body-weight log before we flag
   * `stale_weight_log`.
   */
  noWeightMaxDays: number;
  /**
   * Maximum consecutive days with no sleep log before we flag
   * `stale_sleep_log`.
   */
  noSleepMaxDays: number;
  /**
   * User-local hour-of-day past which an unlogged steps day triggers the
   * `unlogged_steps` nudge. Below this hour we don't fire because the user
   * legitimately hasn't had the chance to walk yet. 20 (8pm) is the default —
   * late enough that meaningful walking is in the past, early enough that
   * the nudge can still prompt a log before sleep.
   */
  unloggedStepsHourThreshold: number;
  /**
   * Minimum length (in consecutive days with no logged data of any kind) of a
   * trailing run before `get_today_context.unexplained_gap` surfaces it as a
   * mark-able gap. 4 days is long enough that a normal weekend skip doesn't
   * fire, short enough to catch a returning-from-vacation week. The run must
   * also be current (its last day >= today-1) — see signals/today.ts.
   */
  gapDetectionMinDays: number;
};

export const DEFAULT_DAY_STATUS_CONFIG: DayStatusConfig = {
  lowIntakeFractionOfAvg: 0.3,
  noWorkoutMaxDays: 7,
  noWeightMaxDays: 3,
  noSleepMaxDays: 2,
  unloggedStepsHourThreshold: 20,
  gapDetectionMinDays: 4,
};

export type CardioKcalConfig = {
  /**
   * Default METs value used when the user logs cardio with a heart rate but
   * we don't have a modality-specific MET lookup. 6.0 is a midpoint between
   * brisk walking (~4) and easy running (~8), reasonable for cycling and
   * mixed-modality sessions. Tune per-user later if needed.
   */
  defaultMets: number;
  /**
   * Weight (kg) used in the METs formula when the user has no body-weight
   * logs at all. Picked to be conservative enough that early-onboarding
   * estimates don't fly wildly high or low. Real users will overwrite this
   * with their first weigh-in.
   */
  fallbackWeightKg: number;
  /**
   * Sanity-check threshold for the kcal estimate comparison: when the
   * user-provided est_kcal deviates from the HR-derived estimate by more
   * than this percentage, we surface a warning. 20% balances noise (HR
   * formulas are inherently noisy) against signal (a 50% gap is real).
   */
  mismatchThresholdPct: number;
};

export const DEFAULT_CARDIO_KCAL_CONFIG: CardioKcalConfig = {
  defaultMets: 6.0,
  fallbackWeightKg: 80,
  mismatchThresholdPct: 20,
};

export type StepsKcalConfig = {
  /**
   * Kcal per step per kg of body weight. 0.0005 gives ~400 kcal at 10k steps /
   * 80 kg, within the standard 300–500 kcal/day NEAT range for moderate
   * walking. Single tunable knob; modality-specific adjustments are deferred.
   */
  kcalPerStepPerKg: number;
  /**
   * Body weight used when no body_weights row predates the step log's
   * on_date. Matches the cardio-kcal fallback so early-onboarding estimates
   * stay consistent across signals.
   */
  fallbackWeightKg: number;
};

export const DEFAULT_STEPS_KCAL_CONFIG: StepsKcalConfig = {
  kcalPerStepPerKg: 0.0005,
  fallbackWeightKg: 80,
};
