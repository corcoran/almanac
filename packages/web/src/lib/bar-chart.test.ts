import { at } from "@almanac/core/test-support";
import { describe, expect, it } from "vitest";
import { sleepBarGeometry } from "./bar-chart.js";

const DIMS = { width: 280, height: 60, gap: 4 };

// A 7-day ascending window helper for May 2026.
function window7(startDay: number): string[] {
  return Array.from({ length: 7 }, (_, i) => `2026-05-${String(startDay + i).padStart(2, "0")}`);
}

describe("sleepBarGeometry", () => {
  it("renders one bar per window date, all ghosts when no nights logged", () => {
    const result = sleepBarGeometry([], window7(16), DIMS);
    expect(result.bars).toHaveLength(7);
    expect(result.bars.every((b) => b.logged === false)).toBe(true);
    expect(result.bars.every((b) => b.hours === null)).toBe(true);
    expect(result.bars.every((b) => b.heightPct === 0)).toBe(true);
    // Empty → scale falls back to the 8h target, reference line at the top.
    expect(result.referenceLinePct).toBe(100);
  });

  it("places logged nights in their calendar slot and ghosts the rest", () => {
    const nights = [
      { slept_on: "2026-05-16", hours: 7 },
      { slept_on: "2026-05-22", hours: 6 },
    ];
    const result = sleepBarGeometry(nights, window7(16), DIMS);
    expect(result.bars).toHaveLength(7);
    expect(result.bars.map((b) => b.logged)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(at(result.bars, 0).hours).toBe(7);
    expect(at(result.bars, 6).hours).toBe(6);
    expect(at(result.bars, 3).slept_on).toBe("2026-05-19");
    expect(at(result.bars, 3).heightPct).toBe(0);
  });

  it("preserves window-date order in the bars array", () => {
    const result = sleepBarGeometry([], window7(16), DIMS);
    expect(result.bars.map((b) => b.slept_on)).toEqual(window7(16));
  });

  it("scales bars relative to max(8h, observed max), ignoring ghosts", () => {
    const nights = [
      { slept_on: "2026-05-15", hours: 6.5 },
      { slept_on: "2026-05-16", hours: 9 },
      { slept_on: "2026-05-17", hours: 8 },
      { slept_on: "2026-05-18", hours: 7 },
    ];
    const dates = ["2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18"];
    const result = sleepBarGeometry(nights, dates, DIMS);
    expect(result.bars).toHaveLength(4);
    expect(at(result.bars, 1).heightPct).toBe(100);
    expect(at(result.bars, 2).heightPct).toBeCloseTo(88.89, 0);
    expect(result.referenceLinePct).toBeCloseTo(88.89, 0);
  });

  it("clamps reference line to 100% when no night exceeds 8h", () => {
    const nights = [
      { slept_on: "2026-05-15", hours: 6 },
      { slept_on: "2026-05-16", hours: 7 },
    ];
    const result = sleepBarGeometry(nights, ["2026-05-15", "2026-05-16"], DIMS);
    expect(result.referenceLinePct).toBe(100);
    expect(at(result.bars, 0).heightPct).toBe(75);
  });

  it("classifies logged bars by 8h target; ghosts are never short", () => {
    const nights = [
      { slept_on: "2026-05-15", hours: 6 },
      { slept_on: "2026-05-17", hours: 8.5 },
    ];
    const dates = ["2026-05-15", "2026-05-16", "2026-05-17"];
    const result = sleepBarGeometry(nights, dates, DIMS);
    expect(at(result.bars, 0).isShort).toBe(true);
    expect(at(result.bars, 1).isShort).toBe(false); // ghost (2026-05-16)
    expect(at(result.bars, 2).isShort).toBe(false); // 8.5h ok
  });
});
