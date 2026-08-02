export type AccomplishmentsConfig = {
  weighInStreakDays: readonly number[];
  workoutConsistencyWeeks: readonly number[];
  targetAdherenceStreakDays: readonly number[];
  // Lifetime/volume cumulative milestone tiers.
  workoutTotalTiers: readonly number[];
  volumeTotalKgTiers: readonly number[];
  mealTotalTiers: readonly number[];
  weighInTotalTiers: readonly number[];
  // Look-back window (days) for streak detection and the "recent wins" read.
  streakLookbackDays: number;
  recentWindowDays: number;
  // Strength-PR detector. A set qualifies for an e1RM PR only if its reps are
  // 1..strengthPrRepCap (above that, 1RM extrapolation is unreliable). e1RM is
  // rounded to strengthPrE1rmRoundingKg for both the win `value` and dedup_key.
  strengthPrRepCap: number;
  strengthPrE1rmRoundingKg: number;
  // Look-back window (days) for the phase-completion scan: a phase whose
  // ended_on is older than this is not re-derived. dedup_key = phase.id is the
  // real once-per-phase guarantee; this is just a cost bound on the scan.
  phaseCompletionLookbackDays: number;
  // Sleep-recovery density rule: fire when >= sleepDensityMinNights of the last
  // sleepDensityWindowNights nights are at/above the sleep-debt signal's
  // baselineHours. (baselineHours itself comes from DEFAULT_SLEEP_CONFIG — not
  // duplicated here — preserving "reuse the signal's threshold".)
  sleepDensityWindowNights: number;
  sleepDensityMinNights: number;
};

export const DEFAULT_ACCOMPLISHMENTS_CONFIG: AccomplishmentsConfig = {
  weighInStreakDays: [7, 14, 30, 60, 100],
  workoutConsistencyWeeks: [4, 8, 12],
  targetAdherenceStreakDays: [7, 14, 30],
  workoutTotalTiers: [50, 100, 250, 500, 1000],
  volumeTotalKgTiers: [100_000, 250_000, 500_000, 1_000_000, 5_000_000],
  mealTotalTiers: [100, 500, 1000, 2500],
  weighInTotalTiers: [50, 100, 250, 500],
  streakLookbackDays: 120,
  // 7-day dashboard window: accomplishments are a daily-use, recent-momentum
  // view. Records persist forever (rows are never deleted); only the celebration
  // is time-boxed, and prior_best still searches all history.
  recentWindowDays: 7,
  strengthPrRepCap: 12,
  strengthPrE1rmRoundingKg: 0.5,
  phaseCompletionLookbackDays: 60,
  sleepDensityWindowNights: 7,
  sleepDensityMinNights: 4,
};
