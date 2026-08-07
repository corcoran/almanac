import { DEFAULT_STEPS_KCAL_CONFIG, type StepsKcalConfig } from "./config.js";

export type StepsKcalEstimateInput = {
  steps: number;
  /** Latest body weight at the time the steps were taken. Null → use fallback. */
  weight_kg: number | null;
};

/**
 * Estimate kcal burned from a daily step count. Linear in `steps × weight_kg`
 * with a single coefficient (`kcalPerStepPerKg`).
 *
 * The TDEE back-calculator MUST NOT add this output to its energy-balance
 * equation: that calc already includes NEAT via the trend-weight signal, so
 * piping steps in would double-count. This estimate is for per-day display
 * and for the avg-activity baseline ONLY.
 */
export function estimateStepsKcal(
  input: StepsKcalEstimateInput,
  config: StepsKcalConfig = DEFAULT_STEPS_KCAL_CONFIG,
): number {
  const w = input.weight_kg ?? config.fallbackWeightKg;
  // Clamp to non-negative — a negative kcal burn is nonsensical. Mirrors the
  // pathological-input guard in cardio-kcal-estimate.ts.
  return Math.max(0, Math.round(input.steps * config.kcalPerStepPerKg * w));
}
