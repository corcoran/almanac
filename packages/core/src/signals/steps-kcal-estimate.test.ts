import { describe, expect, it } from "vitest";
import { DEFAULT_STEPS_KCAL_CONFIG } from "./config.js";
import { estimateStepsKcal } from "./steps-kcal-estimate.js";

describe("estimateStepsKcal", () => {
  it("returns 0 for 0 steps regardless of weight", () => {
    expect(estimateStepsKcal({ steps: 0, weight_kg: 80 })).toBe(0);
    expect(estimateStepsKcal({ steps: 0, weight_kg: null })).toBe(0);
  });

  it("scales linearly with steps at fixed weight", () => {
    const a = estimateStepsKcal({ steps: 5000, weight_kg: 80 });
    const b = estimateStepsKcal({ steps: 10000, weight_kg: 80 });
    expect(b).toBeCloseTo(a * 2, 0);
  });

  it("scales linearly with body weight at fixed steps", () => {
    const light = estimateStepsKcal({ steps: 10000, weight_kg: 60 });
    const heavy = estimateStepsKcal({ steps: 10000, weight_kg: 120 });
    expect(heavy).toBeCloseTo(light * 2, 0);
  });

  it("lands in the 300-500 range at the canonical 10k steps × 80kg point", () => {
    expect(estimateStepsKcal({ steps: 10000, weight_kg: 80 })).toBe(400);
  });

  it("uses fallbackWeightKg when weight_kg is null", () => {
    const withNull = estimateStepsKcal({ steps: 10000, weight_kg: null });
    const withFallback = estimateStepsKcal({
      steps: 10000,
      weight_kg: DEFAULT_STEPS_KCAL_CONFIG.fallbackWeightKg,
    });
    expect(withNull).toBe(withFallback);
  });

  it("rounds to an integer", () => {
    // 1 step × 0.0005 × 80 = 0.04 — rounds down to 0
    expect(estimateStepsKcal({ steps: 1, weight_kg: 80 })).toBe(0);
    // 13 steps × 0.0005 × 80 = 0.52 — rounds up to 1
    expect(estimateStepsKcal({ steps: 13, weight_kg: 80 })).toBe(1);
  });

  it("clamps negative inputs to zero", () => {
    // Repos enforce non-negative steps, but the signal still guards.
    expect(estimateStepsKcal({ steps: -100, weight_kg: 80 })).toBe(0);
  });
});
