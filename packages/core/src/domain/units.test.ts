import { describe, expect, it } from "vitest";
import { displayE1rm, formatAccomplishmentValue } from "./units.js";

describe("displayE1rm — floor to nearest 5 in the display unit", () => {
  it("floors to the lower multiple of 5 (imperial)", () => {
    // 28.5 kg → 62.83 lb → floor5 = 60
    expect(displayE1rm(28.5, "imperial")).toBe(60);
    // 96.5 kg → 212.75 lb → floor5 = 210
    expect(displayE1rm(96.5, "imperial")).toBe(210);
  });
  it("floors to the lower multiple of 5 (metric)", () => {
    // 28.5 kg → floor5 = 25; 96.5 → 95
    expect(displayE1rm(28.5, "metric")).toBe(25);
    expect(displayE1rm(96.5, "metric")).toBe(95);
  });
  it("returns exact multiples of 5 unchanged", () => {
    expect(displayE1rm(45, "metric")).toBe(45); // 45 kg is a multiple of 5
  });
  it("floors small values toward 0 (never negative for real e1RMs)", () => {
    // 2 kg → 4.4 lb → floor5 = 0
    expect(displayE1rm(2, "imperial")).toBe(0);
  });
});

describe("formatAccomplishmentValue — strength_pr floors to 5", () => {
  it("formats a strength_pr value floored to 5 + unit (imperial)", () => {
    expect(formatAccomplishmentValue("strength_pr", 96.5, "imperial")).toBe("210 lb");
  });
  it("formats a strength_pr value floored to 5 (metric)", () => {
    expect(formatAccomplishmentValue("strength_pr", 96.5, "metric")).toBe("95 kg");
  });
  it("does NOT round other weight codes to 5 (weight_milestone keeps 1-dp)", () => {
    // weight_milestone: 4.4 kg → imperial 9.7 lb (1-dp, NOT floored to 5)
    expect(formatAccomplishmentValue("weight_milestone", 4.4, "imperial")).toBe("9.7 lb");
  });
  it("leaves non-weight codes as the bare value", () => {
    expect(formatAccomplishmentValue("weigh_in_streak", 7, "imperial")).toBe("7");
  });
});
