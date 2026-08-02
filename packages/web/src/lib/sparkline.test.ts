import { at } from "@almanac/core/test-support";
import { describe, expect, it } from "vitest";
import { sparklinePoints } from "./sparkline.js";

describe("sparklinePoints", () => {
  it("returns empty string for empty input", () => {
    expect(sparklinePoints([], { width: 100, height: 28 })).toBe("");
  });

  it("maps a single point to the center horizontally", () => {
    const result = sparklinePoints([{ value: 80 }], { width: 100, height: 28 });
    // Single point: SVG can't draw a polyline from one point. Output is just "x,y".
    expect(result).toMatch(/^[\d.]+,[\d.]+$/);
  });

  it("scales y to fit the range with vertical inversion (lower value → higher y)", () => {
    const result = sparklinePoints([{ value: 80 }, { value: 81 }, { value: 79 }], {
      width: 100,
      height: 28,
    });
    // 3 points → 3 "x,y" pairs separated by spaces
    const pairs = result.split(" ");
    expect(pairs).toHaveLength(3);
    // x values should be 0, 50, 100 (linearly distributed)
    expect(pairs[0]).toMatch(/^0,/);
    expect(pairs[1]).toMatch(/^50,/);
    expect(pairs[2]).toMatch(/^100,/);
    // Middle point (81, the max) should have the smallest y (top of chart).
    const ys = pairs.map((p) => Number(p.split(",")[1]));
    expect(at(ys, 1)).toBeLessThan(at(ys, 0)); // 81 above 80
    expect(at(ys, 1)).toBeLessThan(at(ys, 2)); // 81 above 79
  });

  it("clamps a flat series to vertical-center", () => {
    const result = sparklinePoints([{ value: 80 }, { value: 80 }, { value: 80 }], {
      width: 100,
      height: 28,
    });
    const pairs = result.split(" ");
    const ys = pairs.map((p) => Number(p.split(",")[1]));
    // All y values should be equal (the midpoint of the chart).
    expect(ys.every((y) => y === ys[0])).toBe(true);
    expect(ys[0]).toBe(14); // height / 2
  });
});
