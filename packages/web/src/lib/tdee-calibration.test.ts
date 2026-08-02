import { defined } from "@almanac/core/test-support";
import { describe, expect, it } from "vitest";
import { calibrationProgress, driftDescriptor } from "./tdee-calibration.js";

describe("calibrationProgress", () => {
  it("reports the weigh-in gate while weigh-ins are still needed", () => {
    // 8 done, 6 weigh-ins to go → total 14, fraction 8/14
    const p = defined(calibrationProgress(8, { daysRemaining: 6 }), "weigh-in gate");
    expect(p.remaining).toBe(6);
    expect(p.fraction).toBeCloseTo(8 / 14);
    expect(p.caption).toBe("6 weigh-ins to go");
  });
  it("uses singular for one weigh-in to go", () => {
    expect(defined(calibrationProgress(13, { daysRemaining: 1 }), "single weigh-in").caption).toBe(
      "1 weigh-in to go",
    );
  });
  it("falls through to the meal-days gate once weigh-ins are complete", () => {
    // Weigh-ins satisfied (no daysRemaining), but 6 meal-days still needed.
    const p = defined(calibrationProgress(14, { mealDaysRemaining: 6 }), "meal gate");
    expect(p.remaining).toBe(6);
    expect(p.caption).toBe("6 days of meals to go");
  });
  it("uses singular for one meal-day to go", () => {
    expect(
      defined(calibrationProgress(14, { mealDaysRemaining: 1 }), "single meal day").caption,
    ).toBe("1 day of meals to go");
  });
  it("prefers the weigh-in gate when both are present", () => {
    const p = defined(
      calibrationProgress(8, { daysRemaining: 6, mealDaysRemaining: 3 }),
      "both gates",
    );
    expect(p.caption).toBe("6 weigh-ins to go");
  });
  it("clamps fraction to [0,1] and handles 0 remaining", () => {
    const p = defined(calibrationProgress(14, { daysRemaining: 0 }), "zero remaining");
    expect(p.fraction).toBe(1);
    expect(p.remaining).toBe(0);
  });
  it("returns fraction 0 (not NaN) when total is 0", () => {
    expect(defined(calibrationProgress(0, { daysRemaining: 0 }), "zero total").fraction).toBe(0);
  });
  it("returns null when neither gate is outstanding (nothing to show)", () => {
    expect(calibrationProgress(14, {})).toBeNull();
  });
});

describe("driftDescriptor", () => {
  it("returns null when |delta| < 50 (within noise)", () => {
    expect(driftDescriptor(2400, 2370)).toBeNull(); // +30
  });
  it("describes downward drift past threshold", () => {
    expect(driftDescriptor(2200, 2370)).toEqual({
      direction: "down",
      glyph: "↓",
      absDelta: 170,
      atStart: false,
    });
  });
  it("describes upward drift past threshold", () => {
    expect(driftDescriptor(2500, 2370)).toEqual({
      direction: "up",
      glyph: "↑",
      absDelta: 130,
      atStart: false,
    });
  });
  it("flags 'at start' when within threshold (for the ≈ start render)", () => {
    const d = driftDescriptor(2360, 2370);
    expect(d).toBeNull();
  });
});
