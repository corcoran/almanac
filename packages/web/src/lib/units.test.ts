import { describe, expect, it } from "vitest";
import {
  cmToFtIn,
  displayWeightToKg,
  ftInToCm,
  kgToDisplayWeight,
  weightUnitLabel,
} from "./units.js";

describe("units", () => {
  it("kgToDisplayWeight passes through for metric", () => {
    expect(kgToDisplayWeight(80, "metric")).toBe(80);
    expect(kgToDisplayWeight(82.5, "metric")).toBe(82.5);
  });

  it("kgToDisplayWeight converts to lb for imperial", () => {
    expect(kgToDisplayWeight(80, "imperial")).toBeCloseTo(176.4, 1);
    expect(kgToDisplayWeight(100, "imperial")).toBeCloseTo(220.5, 1);
  });

  it("kgToDisplayWeight handles null", () => {
    expect(kgToDisplayWeight(null, "metric")).toBeNull();
    expect(kgToDisplayWeight(null, "imperial")).toBeNull();
  });

  it("displayWeightToKg converts lb back to kg", () => {
    expect(displayWeightToKg(176.4, "imperial")).toBeCloseTo(80, 1);
    expect(displayWeightToKg(82.5, "metric")).toBe(82.5);
  });

  it("weightUnitLabel returns 'lb' or 'kg'", () => {
    expect(weightUnitLabel("metric")).toBe("kg");
    expect(weightUnitLabel("imperial")).toBe("lb");
  });

  it("cmToFtIn splits cm into feet + inches", () => {
    // 180 cm = 70.87 in → rounds to 71 in = 5'11".
    expect(cmToFtIn(180)).toEqual({ feet: 5, inches: 11 });
    // 152.4 cm = exactly 60 in = 5'0".
    expect(cmToFtIn(152.4)).toEqual({ feet: 5, inches: 0 });
  });

  it("ftInToCm combines feet + inches into whole cm", () => {
    expect(ftInToCm(5, 11)).toBe(180); // 71 in * 2.54 = 180.34 → 180
    expect(ftInToCm(6, 0)).toBe(183); // 72 in * 2.54 = 182.88 → 183
    expect(ftInToCm(5, 0)).toBe(152); // 60 in * 2.54 = 152.4 → 152
  });

  it("cmToFtIn / ftInToCm round-trip within a cm", () => {
    const { feet, inches } = cmToFtIn(178);
    expect(Math.abs(ftInToCm(feet, inches) - 178)).toBeLessThanOrEqual(1);
  });
});
