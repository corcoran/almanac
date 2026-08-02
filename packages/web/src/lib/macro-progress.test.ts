import { describe, expect, it } from "vitest";
import {
  macroFillFraction,
  type RemainingLabel,
  remainingLabel,
  ringFillFraction,
  ringLabel,
} from "./macro-progress.js";

describe("macroFillFraction", () => {
  it("is consumed/target when under target", () => {
    expect(macroFillFraction(116, 180)).toBeCloseTo(116 / 180);
  });
  it("caps at 1 when at or over target", () => {
    expect(macroFillFraction(168, 165)).toBe(1);
    expect(macroFillFraction(180, 180)).toBe(1);
  });
  it("is 0 when nothing consumed", () => {
    expect(macroFillFraction(0, 180)).toBe(0);
  });
  it("is 0 (not NaN) when target is 0", () => {
    expect(macroFillFraction(0, 0)).toBe(0);
    expect(macroFillFraction(10, 0)).toBe(1);
  });
});

describe("remainingLabel", () => {
  it("reports grams left when under target", () => {
    const r: RemainingLabel = remainingLabel(180, 116);
    expect(r).toEqual({ magnitude: 64, word: "left", over: false });
  });
  it("reports grams over when intake exceeds target", () => {
    const r = remainingLabel(165, 168.5);
    expect(r).toEqual({ magnitude: 3.5, word: "over", over: true });
  });
  it("rounds to 1 decimal and treats exact target as 0 left", () => {
    expect(remainingLabel(70, 70)).toEqual({ magnitude: 0, word: "left", over: false });
  });
});

describe("ringFillFraction", () => {
  it("is consumed/target capped at 1", () => {
    expect(ringFillFraction(1380, 1900)).toBeCloseTo(1380 / 1900);
    expect(ringFillFraction(2020, 1900)).toBe(1);
  });
  it("is 0 when target is 0", () => {
    expect(ringFillFraction(100, 0)).toBe(1);
    expect(ringFillFraction(0, 0)).toBe(0);
  });
});

describe("ringLabel", () => {
  it("shows kcal left when under target", () => {
    expect(ringLabel(1900, 1380)).toEqual({ magnitude: 520, word: "left", over: false });
  });
  it("shows kcal over when intake exceeds target", () => {
    expect(ringLabel(1900, 2020)).toEqual({ magnitude: 120, word: "over", over: true });
  });
});
