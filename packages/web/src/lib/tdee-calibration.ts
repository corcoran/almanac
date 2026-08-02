/**
 * Pure helpers for the phase card's TDEE section. No Vue, no DOM.
 *
 * TDEE calibration has TWO sequential gates before basis flips to
 * measured_intake: (1) enough distinct weigh-in days (14, per
 * DEFAULT_TDEE_CONFIG.fallbackWindowDays), THEN (2) enough logged meal days (7,
 * per minMealDaysForBackcalc). The TDEE response surfaces whichever gate is
 * outstanding as `days_remaining_to_calibrate` (weigh-ins) OR
 * `meal_days_remaining_to_calibrate` (meals) — never both, and neither once
 * calibrated. We report whichever is active so the chip never says "0 weigh-ins
 * to go" while actually blocked on meals. We never hardcode the thresholds; the
 * weigh-in fraction is reconstructed from days_of_data + daysRemaining.
 */

/** The outstanding-calibration counts pulled from the TDEE response components. */
export type CalibrationGates = {
  /** `components.days_remaining_to_calibrate` — weigh-in days still needed. */
  daysRemaining?: number;
  /** `components.meal_days_remaining_to_calibrate` — meal days still needed. */
  mealDaysRemaining?: number;
};

export type CalibrationProgress = {
  /** Count still needed for the active gate. */
  remaining: number;
  /** Fraction toward the threshold, clamped [0,1]. Weigh-in gate only; meal gate has no denominator, so 0. */
  fraction: number;
  /** "6 weigh-ins to go" / "6 days of meals to go" (singular at 1). */
  caption: string;
};

/**
 * Describe the active calibration gate, or null when nothing is outstanding
 * (the caller then shows no chip). The weigh-in gate takes precedence — it's the
 * first gate, and the response only carries the meal-days count once weigh-ins
 * are satisfied.
 */
export function calibrationProgress(
  daysOfData: number,
  gates: CalibrationGates,
): CalibrationProgress | null {
  if (gates.daysRemaining != null) {
    const remaining = gates.daysRemaining;
    const total = daysOfData + remaining;
    const fraction = total <= 0 ? 0 : Math.min(Math.max(daysOfData / total, 0), 1);
    const noun = remaining === 1 ? "weigh-in" : "weigh-ins";
    return { remaining, fraction, caption: `${remaining} ${noun} to go` };
  }
  if (gates.mealDaysRemaining != null) {
    const remaining = gates.mealDaysRemaining;
    const noun = remaining === 1 ? "day of meals" : "days of meals";
    // No clean denominator for the meal gate from the response, so fraction is
    // left at 0 (the bar reads as "early" rather than implying false progress).
    return { remaining, fraction: 0, caption: `${remaining} ${noun} to go` };
  }
  return null;
}

/** Threshold below which drift is treated as back-calc noise (mirrors PhaseHeader). */
export const DRIFT_THRESHOLD_KCAL = 50;

export type DriftDescriptor = {
  direction: "up" | "down";
  glyph: "↑" | "↓";
  absDelta: number;
  atStart: false;
};

/**
 * Neutral drift descriptor. Returns null when |delta| < threshold (render "≈
 * start" instead). Carries NO good/bad judgment — the app does not compute
 * whether drift is favorable, so the UI must not imply it (rendered dim/grey).
 */
export function driftDescriptor(liveKcal: number, anchorKcal: number): DriftDescriptor | null {
  const delta = liveKcal - anchorKcal;
  if (Math.abs(delta) < DRIFT_THRESHOLD_KCAL) return null;
  return {
    direction: delta > 0 ? "up" : "down",
    glyph: delta > 0 ? "↑" : "↓",
    absDelta: Math.abs(delta),
    atStart: false,
  };
}
