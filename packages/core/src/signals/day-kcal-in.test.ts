import { describe, expect, it } from "vitest";
import { computeDayKcalIn } from "./day-kcal-in.js";

// computeDayKcalIn is a pure summation: it trusts the caller to pre-filter the
// rows it receives to the target user-day. (See the JSDoc on DayKcalInInput.)
// Day-bucketing is a user-tz question, which the caller already answered via
// `userDayWindow` SQL — slice-filtering inside the helper would re-impose a
// UTC-date bucketing and silently drop events that belong to the user-day but
// happen to fall on a different UTC date.
describe("computeDayKcalIn", () => {
  it("sums meals and alcohol", () => {
    const result = computeDayKcalIn({
      date: "2026-05-12",
      meals: [{ kcal: 350 }, { kcal: 700 }],
      alcoholSessions: [{ est_kcal: 400 }, { est_kcal: 200 }],
    });
    expect(result.date).toBe("2026-05-12");
    expect(result.kcal).toBe(350 + 700 + 400 + 200);
  });

  it("returns zero when nothing logged", () => {
    expect(computeDayKcalIn({ date: "2026-05-12", meals: [], alcoholSessions: [] }).kcal).toBe(0);
  });
});
