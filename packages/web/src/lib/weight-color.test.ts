import { describe, expect, it } from "vitest";
import { weightColor } from "./weight-color.js";

describe("weightColor", () => {
  it("returns a neutral color for null (bodyweight)", () => {
    expect(weightColor(null)).toMatch(/hsl\(0,\s*0%,\s*70%\)/);
  });

  it("returns a deterministic color for the same weight", () => {
    expect(weightColor(80)).toBe(weightColor(80));
    expect(weightColor(82.5)).toBe(weightColor(82.5));
  });

  it("returns different colors for different weights", () => {
    expect(weightColor(80)).not.toBe(weightColor(85));
    expect(weightColor(80)).not.toBe(weightColor(82.5));
  });

  it("returns an HSL string with fixed saturation and lightness", () => {
    const color = weightColor(80);
    expect(color).toMatch(/^hsl\(\d+(\.\d+)?,\s*50%,\s*65%\)$/);
  });
});
