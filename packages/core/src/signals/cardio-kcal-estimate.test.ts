import { describe, expect, it } from "vitest";
import { at, defined } from "../test-support/index.js";
import {
  type CardioKcalEstimateInput,
  compareKcalEstimates,
  computeCardioKcalEstimate,
  zoneScaledMets,
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

    it("METs matches the published formula for 80kg user over 30min at 150bpm", () => {
      // Hand-computed:
      //   HRmax  = 208 - 0.7*40 = 180
      //   %HRmax = 150 / 180 = 83.333%
      //   METs   = 8 + (83.333-75)/10 * (10-8) = 9.6667
      //   kcal   = 9.6667 * 3.5 * 80 / 200 * 30 = 406.0 → rounds to 406.
      const r = computeCardioKcalEstimate(baseInput);
      expect(r.components.mets_kcal).toBe(406);
    });

    it("midpoint matches the rounded average of components", () => {
      // Components before rounding: Keytel 455.379, METs 406.0.
      // (455.379 + 406.0) / 2 = 430.69 → rounds to 431.
      const r = computeCardioKcalEstimate(baseInput);
      expect(r.est_kcal_hr).toBe(431);
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
      // dob survives, so the MET term still zone-scales to 9.6667 and
      // mets_kcal lands on the same 406 as the weighed case.
      const r = computeCardioKcalEstimate({
        ...baseInput,
        user: { ...baseInput.user, weight_kg: null },
      });
      expect(r.components.mets_kcal).toBe(406);
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

  describe("zone-scaled MET term", () => {
    it("scales the MET term by %HRmax when age is known", () => {
      const r = computeCardioKcalEstimate(baseInput);
      // 40yo, 80 kg, 30 min at 150 bpm -> 9.6667 METs -> 406 kcal.
      expect(r.components.mets_kcal).toBe(406);
      expect(r.components.met_value_used).toBeCloseTo(9.6667, 3);
      expect(r.components.pct_hrmax).toBeCloseTo(83.3, 1);
      expect(r.components.mets_basis).toBe("zone_scaled");
      // Midpoint of Keytel 455.4 and METs 406.0.
      expect(r.est_kcal_hr).toBe(431);
    });

    it("reproduces the real 45yo 73.5kg session at 142 bpm", () => {
      const r = computeCardioKcalEstimate({
        avg_hr: 142,
        duration_min: 30,
        // 45 on asOf. ageYears floors a 365.25-day division, so a dob landing
        // exactly on the birthday reads 44.
        user: { dob: "1981-05-20", sex: "male", weight_kg: 73.5 },
        asOf: "2026-05-21",
      });
      expect(r.components.keytel_kcal).toBe(417);
      expect(r.components.mets_kcal).toBe(351);
      expect(r.est_kcal_hr).toBe(384);
    });

    it("falls back to the flat MET constant when dob is missing", () => {
      const r = computeCardioKcalEstimate({
        ...baseInput,
        user: { ...baseInput.user, dob: null },
      });
      // No dob means no age, so no HRmax and no zone. Flat 6 METs:
      // 6 x 3.5 x 80 / 200 x 30 = 252.
      expect(r.components.mets_kcal).toBe(252);
      expect(r.components.met_value_used).toBe(6);
      expect(r.components.pct_hrmax).toBeNull();
      expect(r.components.mets_basis).toBe("flat");
      // Keytel also needs age, so this is the mets_only path.
      expect(r.basis).toBe("mets_only");
    });
  });
});

describe("zoneScaledMets", () => {
  it("interpolates between anchors rather than stepping", () => {
    // 40yo -> HRmax 180. 150 bpm is 83.333%, between the 75%/8 and 85%/10
    // anchors: 8 + 0.8333 x 2 = 9.6667.
    expect(zoneScaledMets(150, 40)).toBeCloseTo(9.6667, 3);
  });

  it("returns the anchor value exactly at an anchor", () => {
    // 40yo -> HRmax 180. 75% of 180 is 135 bpm.
    expect(zoneScaledMets(135, 40)).toBeCloseTo(8, 5);
  });

  it("clamps below the lowest anchor", () => {
    // 20% of HRmax is far under the 45% floor.
    expect(zoneScaledMets(36, 40)).toBeCloseTo(2.5, 5);
  });

  it("clamps above the highest anchor", () => {
    // 110% of HRmax is over the 95% ceiling.
    expect(zoneScaledMets(198, 40)).toBeCloseTo(14, 5);
  });

  it("is monotonic in heart rate", () => {
    const values = [100, 120, 140, 160, 180].map((hr) => zoneScaledMets(hr, 40));
    for (let i = 1; i < values.length; i++) {
      expect(at(values, i)).toBeGreaterThanOrEqual(at(values, i - 1));
    }
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
