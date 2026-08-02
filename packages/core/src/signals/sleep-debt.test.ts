import { describe, expect, it } from "vitest";
import { DEFAULT_SLEEP_CONFIG } from "./config.js";
import { computeSleepDebt } from "./sleep-debt.js";

describe("computeSleepDebt", () => {
  it("zero debt when meeting baseline every night", () => {
    const logs = Array.from({ length: 7 }, (_, i) => ({
      slept_on: `2026-05-${String(6 + i).padStart(2, "0")}`,
      hours: 8,
    }));
    const r = computeSleepDebt(logs, "2026-05-12", DEFAULT_SLEEP_CONFIG);
    expect(r.debt_hours).toBe(0);
    expect(r.avg_hours).toBe(8);
  });

  it("accumulates deficit-only debt", () => {
    const logs = [
      { slept_on: "2026-05-10", hours: 6 }, // -2
      { slept_on: "2026-05-11", hours: 9 }, // +1, ignored
      { slept_on: "2026-05-12", hours: 5 }, // -3
    ];
    const r = computeSleepDebt(logs, "2026-05-12", {
      windowDays: 3,
      baselineHours: 8,
    });
    expect(r.debt_hours).toBe(5);
    expect(r.nights_logged).toBe(3);
  });

  it("excludes untracked (vacation) nights from debt and average", () => {
    const logs = [
      { slept_on: "2026-05-10", hours: 6 }, // -2 (tracked)
      { slept_on: "2026-05-11", hours: 4 }, // vacation — would add -4 debt
      { slept_on: "2026-05-12", hours: 8 }, // tracked
    ];
    const untracked = new Set(["2026-05-11"]);
    const r = computeSleepDebt(logs, "2026-05-12", { windowDays: 3, baselineHours: 8 }, untracked);
    // Only 05-10 (6h) and 05-12 (8h) count: debt = 2, avg = 7, 2 nights.
    expect(r.debt_hours).toBe(2);
    expect(r.avg_hours).toBe(7);
    expect(r.nights_logged).toBe(2);
  });
});
