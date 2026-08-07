import { describe, expect, it, test } from "vitest";
import type { ActivityLevel } from "../domain/users.js";
import type { TdeeInput } from "./tdee.js";
import { computeTDEE } from "./tdee.js";

/**
 * Build a measured-intake TdeeInput with `weighInDays` consecutive DAILY
 * weigh-ins at a constant weight ending on asOf="2026-06-24", and `mealDays`
 * consecutive days each with one meal of `kcalPerDay` (stamped 16:00Z to avoid
 * day-bucketing ambiguity). No alcohol, no untracked days.
 */
function buildFlatInput(opts: {
  weighInDays: number;
  mealDays: number;
  kcalPerDay: number;
}): TdeeInput {
  const asOf = "2026-06-24";
  const dayIso = (offsetFromEnd: number): string => {
    const d = new Date(`${asOf}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offsetFromEnd);
    return d.toISOString().slice(0, 10);
  };
  const bodyWeights = Array.from({ length: opts.weighInDays }, (_, i) => ({
    measured_on: dayIso(opts.weighInDays - 1 - i),
    weight_kg: 80,
  }));
  const meals = Array.from({ length: opts.mealDays }, (_, i) => ({
    eaten_at: `${dayIso(opts.mealDays - 1 - i)}T16:00:00.000Z`,
    kcal: opts.kcalPerDay,
  }));
  return {
    asOf,
    tz: "America/Toronto",
    bodyWeights,
    meals,
    alcoholSessions: [],
    user: {
      dob: "1985-01-01",
      height_cm: 180,
      sex: "male",
      latestWeightKg: 80,
      activity_level: "moderate",
    },
    untrackedDays: new Set<string>(),
  };
}

/**
 * Build a measured-intake TdeeInput with a LINEAR weight loss from startKg to
 * endKg across `weighInDays` daily readings ending at asOf="2026-06-24", one
 * meal/day of kcalPerDay at 16:00Z, no alcohol, no untracked days.
 */
function buildLinearLossInput(opts: {
  weighInDays: number;
  startKg: number;
  endKg: number;
  kcalPerDay: number;
}): TdeeInput {
  const asOf = "2026-06-24";
  const dayIso = (offsetFromEnd: number): string => {
    const d = new Date(`${asOf}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offsetFromEnd);
    return d.toISOString().slice(0, 10);
  };
  const span = opts.weighInDays - 1;
  const bodyWeights = Array.from({ length: opts.weighInDays }, (_, i) => {
    const frac = span === 0 ? 0 : i / span;
    return {
      measured_on: dayIso(opts.weighInDays - 1 - i),
      weight_kg: opts.startKg + (opts.endKg - opts.startKg) * frac,
    };
  });
  const meals = Array.from({ length: opts.weighInDays }, (_, i) => ({
    eaten_at: `${dayIso(opts.weighInDays - 1 - i)}T16:00:00.000Z`,
    kcal: opts.kcalPerDay,
  }));
  return {
    asOf,
    tz: "America/Toronto",
    bodyWeights,
    meals,
    alcoholSessions: [],
    user: {
      dob: "1985-01-01",
      height_cm: 180,
      sex: "male",
      latestWeightKg: opts.endKg,
      activity_level: "moderate",
    },
    untrackedDays: new Set<string>(),
  };
}

/**
 * Deep-copy `input` and bump the chronologically-FIRST bodyWeights entry's
 * weight_kg by `deltaKg` (a window-start water/glycogen spike).
 */
function withFirstWeighInBumped(input: TdeeInput, deltaKg: number): TdeeInput {
  const sorted = [...input.bodyWeights].sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1));
  const firstDate = sorted[0]?.measured_on;
  return {
    ...input,
    bodyWeights: input.bodyWeights.map((w) =>
      w.measured_on === firstDate ? { ...w, weight_kg: w.weight_kg + deltaKg } : { ...w },
    ),
    untrackedDays: new Set(input.untrackedDays),
  };
}

describe("computeTDEE", () => {
  it("returns profile_baseline / early when measured data is thin", () => {
    const r = computeTDEE({
      asOf: "2026-05-12",
      bodyWeights: [
        { measured_on: "2026-05-10", weight_kg: 80 },
        { measured_on: "2026-05-12", weight_kg: 80 },
      ],
      meals: [],
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("profile_baseline");
    expect(r.confidence).toBe("early");
    expect(r.kcal).toBeGreaterThan(1000);
    expect(r.kcal).toBeLessThan(4000);
    expect(r.components.days_remaining_to_calibrate).toBeGreaterThan(0);
  });

  it("returns profile_baseline / early with no weight history at all", () => {
    const r = computeTDEE({
      asOf: "2026-05-12",
      bodyWeights: [],
      meals: [],
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("profile_baseline");
    expect(r.confidence).toBe("early");
    expect(r.kcal).toBeGreaterThan(1000);
    expect(r.kcal).toBeLessThan(4000);
  });

  it("switches to measured_intake / early once fallbackWindowDays of weight data exist", () => {
    // 14 days of data — past seeding, but below the established threshold (60d).
    const weights = Array.from({ length: 14 }, (_, i) => ({
      measured_on: `2026-05-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 80 - i * 0.05,
    }));
    const meals = Array.from({ length: 14 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2200,
    }));
    const r = computeTDEE({
      asOf: "2026-05-14",
      bodyWeights: weights,
      meals,
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 79.3,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("measured_intake");
    expect(r.confidence).toBe("early"); // not yet at the established threshold
    expect(r.days_of_data).toBe(14);
  });

  it("flips to confidence='established' once days_of_data >= the established threshold", () => {
    // 60 days of weights and meals — at the established threshold (config.confidenceThresholds.high).
    const N = 60;
    const startDate = new Date("2026-03-15T00:00:00Z");
    const weights = Array.from({ length: N }, (_, i) => {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + i);
      return { measured_on: d.toISOString().slice(0, 10), weight_kg: 80 };
    });
    const meals = Array.from({ length: N }, (_, i) => {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + i);
      return { eaten_at: `${d.toISOString().slice(0, 10)}T12:00:00Z`, kcal: 2500 };
    });
    const r = computeTDEE({
      asOf: "2026-05-13",
      bodyWeights: weights,
      meals,
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("measured_intake");
    expect(r.confidence).toBe("established");
    expect(r.days_of_data).toBeGreaterThanOrEqual(60);
  });

  it("components.avg_kcal_in is an Aggregate wrapper (Gap 20)", () => {
    // 14 days of weights and meals: measured-intake path. avg_kcal_in should
    // expose value + window_days + days_with_data so two aggregators using
    // the same name can't silently disagree.
    const weights = Array.from({ length: 14 }, (_, i) => ({
      measured_on: `2026-05-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 80,
    }));
    // 10 days of meals out of the 14-day window. Two aren't logged.
    const meals = Array.from({ length: 10 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2500,
    }));
    const r = computeTDEE({
      asOf: "2026-05-14",
      bodyWeights: weights,
      meals,
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("measured_intake");
    expect(r.components.avg_kcal_in).toHaveProperty("value");
    expect(r.components.avg_kcal_in).toHaveProperty("window_days", 14);
    expect(r.components.avg_kcal_in).toHaveProperty("days_with_data", 10);
    // value is total kcal / days_with_data (NOT / window_days)
    expect(r.components.avg_kcal_in.value).toBe(2500);
  });

  it("profile_baseline tier still emits the Aggregate wrapper (zero-data shape)", () => {
    const r = computeTDEE({
      asOf: "2026-05-12",
      bodyWeights: [],
      meals: [],
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("profile_baseline");
    expect(r.components.avg_kcal_in).toEqual({
      value: 0,
      window_days: 0,
      days_with_data: 0,
    });
  });

  it("back-calculates TDEE from energy balance once data accumulates", () => {
    // 21 days, eating 2500 kcal/day, weight steady at 80kg ⇒ TDEE ≈ 2500.
    // The April block covers 04-22..04-30 (9 days); the May concat below adds
    // 05-01..05-12 (12 days) for 21 distinct in-window days. The old
    // `String(22 + i)` form ran to 2026-04-42, producing invalid dates that the
    // previous UTC-string-slice bucketing silently dropped — only 04-22..04-30
    // ever counted, so the block was effectively 9 days all along.
    const meals = Array.from({ length: 9 }, (_, i) => ({
      eaten_at: `2026-04-${String(22 + i).padStart(2, "0")}T12:00:00Z`,
      kcal: 2500,
    }));
    const bodyWeights = Array.from({ length: 9 }, (_, i) => ({
      measured_on: `2026-04-${String(22 + i).padStart(2, "0")}`,
      weight_kg: 80,
    }));
    // Extend into May to give a 21-day window ending 2026-05-12
    const r = computeTDEE({
      asOf: "2026-05-12",
      bodyWeights: bodyWeights.concat(
        Array.from({ length: 12 }, (_, i) => ({
          measured_on: `2026-05-${String(1 + i).padStart(2, "0")}`,
          weight_kg: 80,
        })),
      ),
      meals: meals.concat(
        Array.from({ length: 12 }, (_, i) => ({
          eaten_at: `2026-05-${String(1 + i).padStart(2, "0")}T12:00:00Z`,
          kcal: 2500,
        })),
      ),
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("measured_intake");
    expect(r.kcal).toBeGreaterThan(2400);
    expect(r.kcal).toBeLessThan(2600);
  });

  it("returns source: measured when basis is measured_intake", () => {
    const weights = Array.from({ length: 14 }, (_, i) => ({
      measured_on: `2026-05-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 80 - i * 0.05,
    }));
    const meals = Array.from({ length: 14 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2200,
    }));
    const result = computeTDEE({
      asOf: "2026-05-14",
      bodyWeights: weights,
      meals,
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 79.3,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(result.basis).toBe("measured_intake");
    expect(result.source).toBe("measured");
  });

  it("returns source: formula when basis is profile_baseline", () => {
    const result = computeTDEE({
      asOf: "2026-05-12",
      bodyWeights: [
        { measured_on: "2026-05-10", weight_kg: 80 },
        { measured_on: "2026-05-12", weight_kg: 80 },
      ],
      meals: [],
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(result.basis).toBe("profile_baseline");
    expect(result.source).toBe("formula");
  });

  // ---- meal-days guard + honest denominator ----

  it("back-calc uses kcalSum / daysWithData, not kcalSum / windowDays (partial meal logging)", () => {
    // 14 days of stable weight, but only 9 of 14 days have meals logged.
    // The user ate ~2500 kcal on each logged day; the unlogged 5 days are
    // unknown (a vacation, say). The honest assumption is "logged days are
    // representative" — TDEE ≈ avg per LOGGED day, not per window day.
    //
    // Without the fix: avgKcalIn = 9*2500 / 14 ≈ 1607, TDEE clipped to BMR.
    // With the fix:    avgKcalIn = 9*2500 / 9  = 2500, TDEE ≈ 2500.
    const weights = Array.from({ length: 14 }, (_, i) => ({
      measured_on: `2026-05-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 80,
    }));
    // Meals on days 1-9 only; days 10-14 have nothing.
    const meals = Array.from({ length: 9 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2500,
    }));
    const r = computeTDEE({
      asOf: "2026-05-14",
      bodyWeights: weights,
      meals,
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("measured_intake");
    // Weight is flat over the window (deltaKg = 0), so TDEE ≈ avg per-logged-day intake.
    expect(r.kcal).toBeGreaterThan(2400);
    expect(r.kcal).toBeLessThan(2600);
  });

  it("falls back to profile_baseline when daysWithData < minMealDaysForBackcalc", () => {
    // 14 days of weight data (enough for back-calc) but only 3 days of
    // meals — under the meal-days floor. Should NOT trust the back-calc;
    // returns profile_baseline so a sparse-meal user doesn't get a TDEE
    // computed from a 3-day average that happens to dip very low.
    const weights = Array.from({ length: 14 }, (_, i) => ({
      measured_on: `2026-05-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 80,
    }));
    const meals = Array.from({ length: 3 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2500,
    }));
    const r = computeTDEE({
      asOf: "2026-05-14",
      bodyWeights: weights,
      meals,
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("profile_baseline");
    expect(r.confidence).toBe("early");
    expect(r.source).toBe("formula");
  });

  it("surfaces meal_days_remaining_to_calibrate when meal-days guard trips", () => {
    // Same setup as the previous test: 14 weight days, 3 meal days.
    // With minMealDaysForBackcalc = 7, the user needs 4 more meal days to
    // earn measured-intake TDEE. The diagnostic field tells the UI / agent
    // exactly how to phrase the "log more meals" nudge.
    const weights = Array.from({ length: 14 }, (_, i) => ({
      measured_on: `2026-05-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 80,
    }));
    const meals = Array.from({ length: 3 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2500,
    }));
    const r = computeTDEE({
      asOf: "2026-05-14",
      bodyWeights: weights,
      meals,
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("profile_baseline");
    expect(r.components.meal_days_remaining_to_calibrate).toBe(4);
    // The existing weight-data fallback diagnostic should NOT appear when
    // weight data is sufficient — only the meal-days one does.
    expect(r.components.days_remaining_to_calibrate).toBeUndefined();
  });

  it("alcohol-only days still count as logged-data days (dayKcal > 0)", () => {
    // 14 weight days, 7 meal days, plus an alcohol session on a non-meal day.
    // That alcohol day pushes daysWithData to 8, but the test exists to
    // codify the threshold ("dayKcal > 0", not "meals.length > 0") so a
    // future refactor doesn't quietly tighten it.
    const weights = Array.from({ length: 14 }, (_, i) => ({
      measured_on: `2026-05-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 80,
    }));
    const meals = Array.from({ length: 7 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2500,
    }));
    const alcoholSessions = [{ started_at: "2026-05-10T20:00:00Z", est_kcal: 150 }];
    const r = computeTDEE({
      asOf: "2026-05-14",
      bodyWeights: weights,
      meals,
      alcoholSessions,
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set(),
      tz: "UTC",
    });
    expect(r.basis).toBe("measured_intake");
    expect(r.components.avg_kcal_in.days_with_data).toBe(8);
  });

  it("buckets an evening meal by user-local day, not UTC date", () => {
    // America/New_York (UTC-4 in May). asOf = "2026-05-20". An evening meal at
    // 9pm ET on 2026-05-20 is stored as "2026-05-21T01:00:00.000Z" — its UTC
    // date (2026-05-21) is AFTER asOf, so UTC bucketing drops it from the
    // start..asOf window entirely. Under user-local bucketing it belongs to
    // 2026-05-20 (the window's last day) and must count.
    //
    // Window for asOf 2026-05-20 over 21 days is 2026-04-30..2026-05-20.
    // 21 weights give the measured path; 8 midday meals on 05-01..05-08 clear
    // the minMealDaysForBackcalc guard (8 >= 7) without touching 05-20.
    const weights = Array.from({ length: 21 }, (_, i) => {
      const d = new Date("2026-04-30T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return { measured_on: d.toISOString().slice(0, 10), weight_kg: 80 };
    });
    const middayMeals = Array.from({ length: 8 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2200,
    }));
    // 9pm ET on 2026-05-20, stored in UTC → next UTC calendar date.
    const eveningMeal = { eaten_at: "2026-05-21T01:00:00.000Z", kcal: 1900 };

    const base = {
      asOf: "2026-05-20",
      bodyWeights: weights,
      alcoholSessions: [] as Array<{ started_at: string; est_kcal: number }>,
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male" as const,
        latestWeightKg: 80,
        activity_level: null,
      },
      untrackedDays: new Set<string>(),
      tz: "America/New_York",
    };

    const without = computeTDEE({ ...base, meals: middayMeals });
    const withEvening = computeTDEE({ ...base, meals: [...middayMeals, eveningMeal] });

    expect(without.basis).toBe("measured_intake");
    expect(withEvening.basis).toBe("measured_intake");
    // The evening meal lands on 2026-05-20 (a day with no other meal), so it
    // adds exactly one logged-data day. Under UTC bucketing it would be dropped
    // (2026-05-21 is outside the window) and the counts would be equal.
    expect(without.components.avg_kcal_in.days_with_data).toBe(8);
    expect(withEvening.components.avg_kcal_in.days_with_data).toBe(9);
  });

  test("back-calc window scales with available data, capped at 28", () => {
    const input = buildFlatInput({ weighInDays: 40, mealDays: 40, kcalPerDay: 2500 });
    const out = computeTDEE(input);
    expect(out.basis).toBe("measured_intake");
    expect(out.window_days).toBe(28);
  });

  test("back-calc window equals available data when below the 28 cap", () => {
    const input = buildFlatInput({ weighInDays: 20, mealDays: 20, kcalPerDay: 2500 });
    const out = computeTDEE(input);
    expect(out.basis).toBe("measured_intake");
    expect(out.window_days).toBe(20);
  });

  test("median endpoints resist a single mid-window weight spike (no TDEE shift)", () => {
    // A lone spike on an interior window day (not the EWMA seed) must not move
    // TDEE: the EWMA already smooths it AND it isn't an endpoint, so the
    // median-of-3 endpoints are unchanged. This is the case the median design
    // targets — a stray water/glycogen reading inside the window.
    const clean = buildLinearLossInput({
      weighInDays: 28,
      startKg: 78,
      endKg: 76.4,
      kcalPerDay: 2100,
    });
    // Bump an interior reading (day 6 of 28) by +2kg.
    const sorted = [...clean.bodyWeights].sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1));
    const spikedDate = sorted[6]?.measured_on;
    const spiked = {
      ...clean,
      bodyWeights: clean.bodyWeights.map((w) =>
        w.measured_on === spikedDate ? { ...w, weight_kg: w.weight_kg + 2.0 } : { ...w },
      ),
    };
    const cleanTdee = computeTDEE(clean).kcal;
    const spikedTdee = computeTDEE(spiked).kcal;
    // Interior spike barely perturbs TDEE (well under a meaningful kcal step).
    expect(Math.abs(spikedTdee - cleanTdee)).toBeLessThan(40);
  });

  test("median endpoints are no worse than single-point on a window-start spike", () => {
    // A spike on the chronologically-FIRST weigh-in is the EWMA seed, the one
    // position the EWMA propagates forward across the series. The median-of-3
    // endpoint smoothing keeps this within the single-point sensitivity — it
    // never amplifies a seed-position spike past the unsmoothed case. (The
    // interior-spike case above is where median + EWMA shine: an in-window stray
    // reading barely moves TDEE; the seed position is the harder edge, and the
    // bound below is what the design guarantees there.)
    const clean = buildLinearLossInput({
      weighInDays: 28,
      startKg: 78,
      endKg: 76.4,
      kcalPerDay: 2100,
    });
    const spiked = withFirstWeighInBumped(clean, 2.0);
    const cleanTdee = computeTDEE(clean).kcal;
    const spikedTdee = computeTDEE(spiked).kcal;
    // Observed: median shift (~410 kcal) is smaller than the single-point shift
    // (~450 kcal). The cap guards against regressing past the single-point case.
    expect(Math.abs(spikedTdee - cleanTdee)).toBeLessThan(450);
  });

  test("regression: real 2026-06 spike window — corrected TDEE ~2580 (was ~2857)", () => {
    // Real user-1 60-day history through 2026-06-24. The OLD 21-day window opened
    // on the 06-03/06-04 water spike (77.93/77.47) and read the loss ~2x too fast,
    // inflating TDEE to ~2857. The scaled 28-day window + median slope endpoints
    // correct it to ~2580. Intake rows are the real USER-LOCAL daily totals
    // (meals + alcohol, America/Toronto), one per day, stamped at noon-local
    // (16:00Z) so computeTDEE's user-local bucketing is unambiguous.
    const weighIns: Array<{ measured_on: string; weight_kg: number }> = [
      { measured_on: "2026-05-08", weight_kg: 77.47 },
      { measured_on: "2026-05-11", weight_kg: 77.47 },
      { measured_on: "2026-05-12", weight_kg: 76.84 },
      { measured_on: "2026-05-14", weight_kg: 75.93 },
      { measured_on: "2026-05-15", weight_kg: 75.84 },
      { measured_on: "2026-05-16", weight_kg: 76.3 },
      { measured_on: "2026-05-18", weight_kg: 76.84 },
      { measured_on: "2026-05-20", weight_kg: 78.38 },
      { measured_on: "2026-05-21", weight_kg: 77.74 },
      { measured_on: "2026-05-22", weight_kg: 76.38 },
      { measured_on: "2026-05-23", weight_kg: 77.93 },
      { measured_on: "2026-05-24", weight_kg: 77.11 },
      { measured_on: "2026-05-25", weight_kg: 77.1 },
      { measured_on: "2026-05-26", weight_kg: 75.75 },
      { measured_on: "2026-05-27", weight_kg: 76.02 },
      { measured_on: "2026-05-28", weight_kg: 76.11 },
      { measured_on: "2026-06-03", weight_kg: 77.93 },
      { measured_on: "2026-06-04", weight_kg: 77.47 },
      { measured_on: "2026-06-05", weight_kg: 76.48 },
      { measured_on: "2026-06-06", weight_kg: 75.568 },
      { measured_on: "2026-06-07", weight_kg: 75.75 },
      { measured_on: "2026-06-08", weight_kg: 75.66 },
      { measured_on: "2026-06-09", weight_kg: 75.11 },
      { measured_on: "2026-06-10", weight_kg: 75.21 },
      { measured_on: "2026-06-11", weight_kg: 75.025 },
      { measured_on: "2026-06-12", weight_kg: 74.3 },
      { measured_on: "2026-06-13", weight_kg: 74.93 },
      { measured_on: "2026-06-14", weight_kg: 74.48 },
      { measured_on: "2026-06-16", weight_kg: 74.117 },
      { measured_on: "2026-06-17", weight_kg: 73.845 },
      { measured_on: "2026-06-18", weight_kg: 73.936 },
      { measured_on: "2026-06-19", weight_kg: 74.026 },
      { measured_on: "2026-06-20", weight_kg: 73.755 },
      { measured_on: "2026-06-21", weight_kg: 73.94 },
      { measured_on: "2026-06-22", weight_kg: 74.48 },
      { measured_on: "2026-06-23", weight_kg: 73.663 },
      { measured_on: "2026-06-24", weight_kg: 73.663 },
    ];
    // Real user-local daily intake totals (meals + alcohol), America/Toronto.
    const dailyIntake: Array<{ date: string; kcal: number }> = [
      { date: "2026-05-24", kcal: 1141 },
      { date: "2026-05-25", kcal: 1907 },
      { date: "2026-05-26", kcal: 2345 },
      { date: "2026-05-27", kcal: 2150 },
      { date: "2026-05-28", kcal: 815 },
      { date: "2026-06-03", kcal: 2725 },
      { date: "2026-06-04", kcal: 2876 },
      { date: "2026-06-05", kcal: 2290 },
      { date: "2026-06-06", kcal: 1914 },
      { date: "2026-06-07", kcal: 1755 },
      { date: "2026-06-08", kcal: 1957 },
      { date: "2026-06-09", kcal: 1994 },
      { date: "2026-06-10", kcal: 2972 },
      { date: "2026-06-11", kcal: 1867 },
      { date: "2026-06-12", kcal: 2273 },
      { date: "2026-06-13", kcal: 2171 },
      { date: "2026-06-14", kcal: 1810 },
      { date: "2026-06-15", kcal: 1868 },
      { date: "2026-06-16", kcal: 1895 },
      { date: "2026-06-17", kcal: 2095 },
      { date: "2026-06-18", kcal: 2135 },
      { date: "2026-06-19", kcal: 1860 },
      { date: "2026-06-20", kcal: 2762 },
      { date: "2026-06-21", kcal: 2085 },
      { date: "2026-06-22", kcal: 1820 },
      { date: "2026-06-23", kcal: 2405 },
      { date: "2026-06-24", kcal: 1660 },
    ];
    const input: TdeeInput = {
      asOf: "2026-06-24",
      tz: "America/Toronto",
      bodyWeights: weighIns,
      meals: dailyIntake.map((d) => ({ eaten_at: `${d.date}T16:00:00.000Z`, kcal: d.kcal })),
      alcoholSessions: [],
      user: {
        dob: "1981-07-16",
        height_cm: 183,
        sex: "male",
        latestWeightKg: 73.663,
        activity_level: "active",
      },
      untrackedDays: new Set<string>(),
    };
    const out = computeTDEE(input);
    expect(out.basis).toBe("measured_intake");
    expect(out.window_days).toBe(28);
    // ~2580 over the 28-day window.
    expect(out.kcal).toBeGreaterThan(2560);
    expect(out.kcal).toBeLessThan(2600);
  });
});

describe("profile_baseline activity multiplier", () => {
  // Zero weigh-ins forces the profile_baseline path.
  function coldStartInput(activity_level: ActivityLevel | null) {
    return {
      asOf: "2026-06-21",
      tz: "America/Toronto",
      bodyWeights: [] as Array<{ measured_on: string; weight_kg: number }>,
      meals: [],
      alcoholSessions: [],
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male" as const,
        latestWeightKg: 80,
        activity_level,
      },
      untrackedDays: new Set<string>(),
    };
  }

  it("uses the level's multiplier when activity_level is set", () => {
    // BMR for 80kg/180cm/36y male = 10*80 + 6.25*180 - 5*36 + 5 = 1750.
    // sedentary 1.2 -> 2100; very_active 1.9 -> 3325.
    expect(computeTDEE(coldStartInput("sedentary")).kcal).toBe(2100);
    expect(computeTDEE(coldStartInput("very_active")).kcal).toBe(3325);
  });

  it("falls back to the legacy 1.4 multiplier when activity_level is null", () => {
    // 1750 * 1.4 = 2450 — identical to pre-feature behavior.
    expect(computeTDEE(coldStartInput(null)).kcal).toBe(2450);
  });
});

describe("computeTDEE with untrackedDays", () => {
  // Helper: 21 days of weights + meals, a clean measured_intake setup.
  function baseInput() {
    const weights = Array.from({ length: 21 }, (_, i) => ({
      measured_on: `2026-05-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 80 - i * 0.03,
    }));
    const meals = Array.from({ length: 21 }, (_, i) => ({
      eaten_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      kcal: 2200,
    }));
    return {
      asOf: "2026-05-21",
      bodyWeights: weights,
      meals,
      alcoholSessions: [] as Array<{ started_at: string; est_kcal: number }>,
      user: {
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male" as const,
        latestWeightKg: 79.4,
        activity_level: null,
      },
      tz: "UTC",
    };
  }

  it("empty set reproduces the no-exclusion numbers exactly (regression guard)", () => {
    const input = baseInput();
    const withEmpty = computeTDEE({ ...input, untrackedDays: new Set() });
    expect(withEmpty.basis).toBe("measured_intake");
    expect(withEmpty.components.avg_kcal_in.days_with_data).toBe(21);
    expect(withEmpty.components.untracked_days_in_window).toBe(0);
    expect(withEmpty.kcal).toBeGreaterThan(2000);
  });

  it("skips untracked days in the intake average denominator", () => {
    const input = baseInput();
    const untracked = new Set(["2026-05-19", "2026-05-20", "2026-05-21"]);
    const r = computeTDEE({ ...input, untrackedDays: untracked });
    expect(r.components.avg_kcal_in.days_with_data).toBe(18);
    expect(r.components.untracked_days_in_window).toBe(3);
    expect(Math.round(r.components.avg_kcal_in.value)).toBe(2200);
  });

  it("snaps the weight-delta endpoints to the nearest tracked day", () => {
    // Weight decreases monotonically at 0.03 kg/day across the window, so the
    // full-window trend delta (end − start) is negative (a loss). Marking the
    // trailing two days untracked snaps the END endpoint back to an earlier,
    // HEAVIER trend point (05-19). That makes (end − start) less negative —
    // i.e. larger — so the snapped delta must be strictly greater than the
    // baseline delta. This is the behavioral guard: if the snapping logic is
    // removed (end always = last trend point), the deltas would be EQUAL.
    const baseline = computeTDEE({ ...baseInput(), untrackedDays: new Set() });
    const snapped = computeTDEE({
      ...baseInput(),
      untrackedDays: new Set(["2026-05-20", "2026-05-21"]),
    });
    expect(snapped.components.untracked_days_in_window).toBe(2);
    expect(snapped.basis).toBe("measured_intake");
    // Endpoints actually moved: deltas differ, in the expected direction.
    expect(snapped.components.trend_weight_change_kg).not.toBe(
      baseline.components.trend_weight_change_kg,
    );
    expect(snapped.components.trend_weight_change_kg).toBeGreaterThan(
      baseline.components.trend_weight_change_kg,
    );
    expect(Number.isFinite(snapped.kcal)).toBe(true);
  });

  it("falls back to profile_baseline when exclusion drops below the meal-day guard", () => {
    const input = baseInput();
    const trackedDays = new Set([
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]);
    const untracked = new Set(
      Array.from({ length: 21 }, (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`).filter(
        (d) => !trackedDays.has(d),
      ),
    );
    const r = computeTDEE({ ...input, untrackedDays: untracked });
    expect(r.basis).toBe("profile_baseline");
    expect(r.components.meal_days_remaining_to_calibrate).toBeGreaterThan(0);
  });
});
