import { at } from "@almanac/core/test-support";
import { describe, expect, it } from "vitest";
import {
  formatStepsShort,
  stepsAverage,
  stepsBarGeometry,
  stepsChartRange,
  stepsWindowDates,
} from "./steps-chart.js";

describe("stepsWindowDates", () => {
  it("is 14 days ending at the target day, crossing month ends", () => {
    const dates = stepsWindowDates("2026-10-05");
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe("2026-09-22");
    expect(dates[13]).toBe("2026-10-05");
  });
});

describe("stepsChartRange", () => {
  it("fetches the 14-day window with an exclusive upper bound", () => {
    const r = stepsChartRange("2026-10-05");
    expect(r.from).toBe("2026-09-22");
    expect(r.to).toBe("2026-10-06");
    expect(r.dates).toEqual(stepsWindowDates("2026-10-05"));
  });
});

describe("stepsBarGeometry", () => {
  const window = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];

  it("scales bars to the busiest logged day and marks the target", () => {
    const bars = stepsBarGeometry(
      [
        { on_date: "2026-10-02", steps: 5000 },
        { on_date: "2026-10-03", steps: 10000 },
        { on_date: "2026-10-05", steps: 7500 },
      ],
      window,
      "2026-10-05",
    );
    expect(bars.map((b) => b.heightPct)).toEqual([50, 100, 0, 75]);
    expect(at(bars, 2).logged).toBe(false);
    expect(bars.map((b) => b.isTarget)).toEqual([false, false, false, true]);
  });

  it("marks an unlogged target day as a target ghost", () => {
    const bars = stepsBarGeometry([{ on_date: "2026-10-02", steps: 5000 }], window, "2026-10-05");
    const last = at(bars, 3);
    expect(last.logged).toBe(false);
    expect(last.isTarget).toBe(true);
  });

  it("ignores logs outside the window", () => {
    const bars = stepsBarGeometry(
      [
        { on_date: "2026-09-01", steps: 40000 },
        { on_date: "2026-10-02", steps: 5000 },
      ],
      window,
      "2026-10-05",
    );
    expect(at(bars, 0).heightPct).toBe(100);
  });
});

describe("stepsAverage", () => {
  it("averages logged days in the window only, rounded", () => {
    expect(
      stepsAverage(
        [
          { on_date: "2026-10-02", steps: 5000 },
          { on_date: "2026-10-03", steps: 10001 },
          { on_date: "2026-09-01", steps: 40000 },
        ],
        ["2026-10-02", "2026-10-03", "2026-10-04"],
      ),
    ).toBe(7501);
  });

  it("is null with nothing logged", () => {
    expect(stepsAverage([], ["2026-10-02"])).toBeNull();
  });
});

describe("formatStepsShort", () => {
  it.each([
    [850, "850"],
    [9412, "9.4k"],
    [9960, "10k"],
    [15400, "15k"],
  ])("%d → %s", (n, s) => {
    expect(formatStepsShort(n)).toBe(s);
  });
});
