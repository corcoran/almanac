import { describe, expect, it } from "vitest";
import { sleepColor } from "./sleep-color.js";

describe("sleepColor", () => {
  it("returns red (hue 0) at 0 hours", () => {
    expect(sleepColor(0)).toMatch(/^hsl\(0\.0,\s*55%,\s*55%\)$/);
  });

  it("returns amber (hue 45) at 6 hours", () => {
    expect(sleepColor(6)).toMatch(/^hsl\(45\.0,\s*55%,\s*55%\)$/);
  });

  it("returns green (hue 135) at 8 hours", () => {
    expect(sleepColor(8)).toMatch(/^hsl\(135\.0,\s*55%,\s*55%\)$/);
  });

  it("caps at green (hue 135) past 8 hours", () => {
    expect(sleepColor(10)).toMatch(/^hsl\(135\.0,\s*55%,\s*55%\)$/);
    expect(sleepColor(24)).toMatch(/^hsl\(135\.0,\s*55%,\s*55%\)$/);
  });

  it("interpolates between segments", () => {
    // Halfway through the 0-6h segment → hue 22.5
    expect(sleepColor(3)).toMatch(/^hsl\(22\.5,\s*55%,\s*55%\)$/);
    // Halfway through the 6-8h segment → hue 90
    expect(sleepColor(7)).toMatch(/^hsl\(90\.0,\s*55%,\s*55%\)$/);
  });

  it("is deterministic", () => {
    expect(sleepColor(5.5)).toBe(sleepColor(5.5));
    expect(sleepColor(8)).toBe(sleepColor(8));
  });

  it("clamps negative hours to 0 (red)", () => {
    expect(sleepColor(-1)).toBe(sleepColor(0));
  });
});
