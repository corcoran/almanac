/**
 * Pure math for the Remaining card's calorie ring and macro bars. No Vue, no
 * DOM — same convention as sparkline.ts / bar-chart.ts.
 *
 * The bars/ring FILL by consumed fraction (a satisfying "progress" gesture),
 * while the displayed NUMBER is what's REMAINING (target − intake). Over-target
 * is carried by the label word ("over"), never by color — see the spec's
 * "informs, never scolds" policy.
 */

export type RemainingLabel = {
  /** Absolute value, rounded to 1 decimal (trailing .0 handled at render). */
  magnitude: number;
  word: "left" | "over";
  over: boolean;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Consumed fraction of a macro, clamped to [0, 1]. target 0 → full when any intake. */
export function macroFillFraction(intake: number, target: number): number {
  if (target <= 0) return intake > 0 ? 1 : 0;
  return Math.min(intake / target, 1);
}

/** Remaining = target − intake, expressed as magnitude + "left"/"over". */
export function remainingLabel(target: number, intake: number): RemainingLabel {
  const remaining = round1(target - intake);
  if (remaining < 0) {
    return { magnitude: Math.abs(remaining), word: "over", over: true };
  }
  return { magnitude: remaining, word: "left", over: false };
}

/** Calorie ring fill fraction (consumed), clamped to [0, 1]. */
export function ringFillFraction(intakeKcal: number, targetKcal: number): number {
  return macroFillFraction(intakeKcal, targetKcal);
}

/** Calorie ring center label: magnitude + "left"/"over" (ring stays purple either way). */
export function ringLabel(targetKcal: number, intakeKcal: number): RemainingLabel {
  return remainingLabel(targetKcal, intakeKcal);
}
