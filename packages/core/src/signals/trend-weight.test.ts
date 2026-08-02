import { describe, expect, it } from "vitest";
import { DEFAULT_TREND_WEIGHT_CONFIG } from "./config.js";
import { computeTrendWeight, computeWeightChange } from "./trend-weight.js";

describe("computeTrendWeight", () => {
  it("returns trend equal to raw on the first day", () => {
    const out = computeTrendWeight([{ measured_on: "2026-05-01", weight_kg: 80 }]);
    expect(out[0]?.trend_kg).toBeCloseTo(80, 5);
  });

  it("smooths a noisy series toward the mean", () => {
    const series = [
      { measured_on: "2026-05-01", weight_kg: 80 },
      { measured_on: "2026-05-02", weight_kg: 82 },
      { measured_on: "2026-05-03", weight_kg: 78 },
      { measured_on: "2026-05-04", weight_kg: 80 },
    ];
    const out = computeTrendWeight(series);
    expect(out.length).toBe(4);
    // After 4 points, the trend should be within ±1 of the simple mean (80).
    expect(out[3]?.trend_kg).toBeGreaterThan(79);
    expect(out[3]?.trend_kg).toBeLessThan(81);
  });

  it("fills missing-day gaps by holding trend; raw_kg null for those days", () => {
    const series = [
      { measured_on: "2026-05-01", weight_kg: 80 },
      { measured_on: "2026-05-03", weight_kg: 81 },
    ];
    const out = computeTrendWeight(series, DEFAULT_TREND_WEIGHT_CONFIG);
    // Three entries: 5/1, 5/2 (hold), 5/3 (update).
    expect(out.map((p) => p.date)).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
    expect(out[1]?.raw_kg).toBeNull();
    expect(out[1]?.trend_kg).toBeCloseTo(out[0]?.trend_kg ?? 0, 5);
  });
});

describe("computeWeightChange", () => {
  it("returns null when no readings exist", () => {
    expect(computeWeightChange([])).toBeNull();
  });

  it("returns null when only one reading exists", () => {
    expect(computeWeightChange([{ measured_on: "2026-05-09", weight_kg: 80 }])).toBeNull();
  });

  it("returns { value_kg, over_days, confidence='early' } when < 30 days span", () => {
    const result = computeWeightChange([
      { measured_on: "2026-05-09", weight_kg: 80 },
      { measured_on: "2026-05-12", weight_kg: 79.7 },
    ]);
    expect(result).toEqual({ value_kg: -0.3, over_days: 3, confidence: "early" });
  });

  it("returns confidence='established' when over_days >= 30", () => {
    const result = computeWeightChange([
      { measured_on: "2026-04-08", weight_kg: 80 },
      { measured_on: "2026-05-08", weight_kg: 79 },
    ]);
    expect(result?.confidence).toBe("established");
    expect(result?.over_days).toBeGreaterThanOrEqual(30);
  });

  it("slices to the most recent 30 days when readings span longer", () => {
    const result = computeWeightChange([
      { measured_on: "2026-01-01", weight_kg: 85 }, // outside window
      { measured_on: "2026-04-15", weight_kg: 82 }, // inside (24d before last)
      { measured_on: "2026-05-09", weight_kg: 79 }, // last
    ]);
    // Window: last=2026-05-09, window starts 2026-04-09. So 2026-04-15 is in.
    // first in window: 2026-04-15 (82kg); last: 2026-05-09 (79kg); over_days=24
    expect(result).toEqual({ value_kg: -3.0, over_days: 24, confidence: "early" });
  });
});
