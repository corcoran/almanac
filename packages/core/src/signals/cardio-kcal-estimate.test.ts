import { describe, expect, it } from "vitest";
import { defined } from "../test-support/index.js";
import {
  type CardioKcalEstimateInput,
  compareKcalEstimates,
  computeCardioKcalEstimate,
} from "./cardio-kcal-estimate.js";

/**
 * Fixture: a 40-year-old 80 kg male doing a 30-minute session at 150 bpm.
 * Used as the base case across the formula tests so the expected numbers
 * can be sanity-checked against the published Keytel coefficients by hand.
 */
const baseInput: CardioKcalEstimateInput = {
  avg_hr: 150,
  duration_min: 30,
  user: {
    dob: "1986-05-21", // 40 years on asOf below
    sex: "male",
    weight_kg: 80,
  },
  asOf: "2026-05-21",
};

describe("computeCardioKcalEstimate", () => {
  describe("happy path — full profile, midpoint of Keytel and METs", () => {
    it("returns basis 'keytel_and_mets' and both component values when profile is complete", () => {
      const r = computeCardioKcalEstimate(baseInput);
      expect(r.basis).toBe("keytel_and_mets");
      expect(r.components.keytel_kcal).not.toBeNull();
      expect(r.components.mets_kcal).toBeGreaterThan(0);
      // est_kcal_hr should be the rounded midpoint of the two components.
      const keytelKcal = defined(r.components.keytel_kcal, "keytel_kcal");
      const expectedMidpoint = Math.round((keytelKcal + r.components.mets_kcal) / 2);
      expect(r.est_kcal_hr).toBe(expectedMidpoint);
    });

    it("Keytel matches the published formula for 40yo 80kg male at 150bpm", () => {
      // Hand-computed:
      //   kJ/min = -55.0969 + 0.6309*150 + 0.1988*80 + 0.2017*40
      //          = -55.0969 + 94.635 + 15.904 + 8.068
      //          = 63.5101 kJ/min
      //   kcal/min = 63.5101 / 4.184 ≈ 15.179
      //   30 min   ≈ 455.4 kcal → rounds to 455.
      const r = computeCardioKcalEstimate(baseInput);
      expect(r.components.keytel_kcal).toBe(455);
    });

    it("METs matches the published formula for 80kg user over 30min at default 6.0 METs", () => {
      // kcal = 6.0 * 3.5 * 80 / 200 * 30 = 252.0 → rounds to 252.
      const r = computeCardioKcalEstimate(baseInput);
      expect(r.components.mets_kcal).toBe(252);
    });

    it("midpoint matches the rounded average of components", () => {
      // (455 + 252) / 2 = 353.5 → rounds to 354.
      const r = computeCardioKcalEstimate(baseInput);
      expect(r.est_kcal_hr).toBe(354);
    });
  });

  describe("Keytel sex coefficient flip", () => {
    it("produces a different (and typically lower) keytel value for female with same HR/weight/age", () => {
      const female = computeCardioKcalEstimate({
        ...baseInput,
        user: { ...baseInput.user, sex: "female" },
      });
      const male = computeCardioKcalEstimate(baseInput);
      expect(female.components.keytel_kcal).not.toBe(male.components.keytel_kcal);
      // For most reasonable HR ranges the female coefficient set yields a
      // lower per-minute burn (literature consistent). Assert the direction
      // rather than a magic number so the test stays honest about *why*.
      expect(defined(female.components.keytel_kcal, "keytel_kcal")).toBeLessThan(
        defined(male.components.keytel_kcal, "keytel_kcal"),
      );
    });
  });

  describe("fallback — profile fields missing", () => {
    it("falls back to mets_only when sex is null", () => {
      const r = computeCardioKcalEstimate({
        ...baseInput,
        user: { ...baseInput.user, sex: null },
      });
      expect(r.basis).toBe("mets_only");
      expect(r.components.keytel_kcal).toBeNull();
      // est_kcal_hr should equal mets_kcal exactly (no midpoint averaging).
      expect(r.est_kcal_hr).toBe(r.components.mets_kcal);
    });

    it("falls back to mets_only when weight_kg is null", () => {
      const r = computeCardioKcalEstimate({
        ...baseInput,
        user: { ...baseInput.user, weight_kg: null },
      });
      expect(r.basis).toBe("mets_only");
      expect(r.components.keytel_kcal).toBeNull();
    });

    it("falls back to mets_only when dob is null", () => {
      const r = computeCardioKcalEstimate({
        ...baseInput,
        user: { ...baseInput.user, dob: null },
      });
      expect(r.basis).toBe("mets_only");
      expect(r.components.keytel_kcal).toBeNull();
    });

    it("uses fallbackWeightKg in METs when weight_kg is null", () => {
      // Without overriding config, fallback is 80 kg — same as baseInput.
      // Verify by passing weight_kg: null and checking mets_kcal still
      // computes to the same value (252).
      const r = computeCardioKcalEstimate({
        ...baseInput,
        user: { ...baseInput.user, weight_kg: null },
      });
      expect(r.components.mets_kcal).toBe(252);
    });
  });

  describe("edge cases", () => {
    it("clamps a pathologically-low Keytel result at 0 instead of returning a negative kcal", () => {
      // Very low HR + very young + very light = formula goes negative.
      // 100bpm, 18yo, 50kg male:
      //   kJ/min = -55.0969 + 0.6309*100 + 0.1988*50 + 0.2017*18
      //          = -55.0969 + 63.09 + 9.94 + 3.6306
      //          = 21.566 → positive. Try lower:
      // 80bpm, 18yo, 50kg male:
      //   kJ/min = -55.0969 + 50.472 + 9.94 + 3.6306 = 8.946 (still pos).
      // 60bpm, 18yo, 50kg male:
      //   kJ/min = -55.0969 + 37.854 + 9.94 + 3.6306 = -3.67 (negative).
      const r = computeCardioKcalEstimate({
        avg_hr: 60,
        duration_min: 30,
        user: { dob: "2008-01-01", sex: "male", weight_kg: 50 },
        asOf: "2026-05-21",
      });
      // Keytel component should be 0 (clamped), not negative.
      expect(r.components.keytel_kcal).toBeGreaterThanOrEqual(0);
    });

    it("scales linearly with duration", () => {
      const r30 = computeCardioKcalEstimate(baseInput);
      const r60 = computeCardioKcalEstimate({ ...baseInput, duration_min: 60 });
      // Both Keytel and METs are linear in time; midpoint of (2x, 2x) = 2x.
      // Allow ±1 kcal because we round components independently then
      // average — the 30-min midpoint rounds before doubling, while the
      // 60-min path computes 2x then rounds, so they can disagree by one.
      expect(Math.abs(r60.est_kcal_hr - r30.est_kcal_hr * 2)).toBeLessThanOrEqual(1);
    });
  });
});

describe("compareKcalEstimates", () => {
  it("returns null when within tolerance (<20% by default)", () => {
    // 100 user vs 110 hr → 10/110 = 9.1%, under threshold.
    expect(compareKcalEstimates(100, 110)).toBeNull();
  });

  it("returns a warning when user_est is >20% higher than hr_est", () => {
    // 150 user vs 100 hr → (150-100)/100 = +50%.
    const w = compareKcalEstimates(150, 100);
    expect(w).not.toBeNull();
    expect(defined(w, "w").delta_pct).toBe(50);
    expect(defined(w, "w").user_est_kcal).toBe(150);
    expect(defined(w, "w").hr_est_kcal).toBe(100);
    expect(defined(w, "w").message).toContain("higher than");
  });

  it("returns a warning when user_est is >20% lower than hr_est", () => {
    // 60 user vs 100 hr → -40%.
    const w = compareKcalEstimates(60, 100);
    expect(w).not.toBeNull();
    expect(defined(w, "w").delta_pct).toBe(-40);
    expect(defined(w, "w").message).toContain("lower than");
  });

  it("returns null when user_est is missing", () => {
    expect(compareKcalEstimates(null, 100)).toBeNull();
    expect(compareKcalEstimates(undefined, 100)).toBeNull();
  });

  it("returns null when hr_est is 0 or negative (degenerate input)", () => {
    expect(compareKcalEstimates(100, 0)).toBeNull();
    expect(compareKcalEstimates(100, -10)).toBeNull();
  });

  it("respects a custom threshold from config", () => {
    // 15% delta — would not fire at default 20% threshold; fires at 10%.
    expect(compareKcalEstimates(115, 100)).toBeNull();
    expect(
      compareKcalEstimates(115, 100, {
        defaultMets: 6,
        fallbackWeightKg: 80,
        mismatchThresholdPct: 10,
      }),
    ).not.toBeNull();
  });
});
