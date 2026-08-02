import { describe, expect, it } from "vitest";
import { suggestMacros } from "./macro-suggest.js";

describe("suggestMacros", () => {
  it("anchors protein to bodyweight at 2.4 g/kg on a cut", () => {
    // 80kg * 2.4 = 192g protein. fat = 25% of 1900 / 9 = 52.77 -> 53g.
    // carbs = (1900 - 192*4 - 53*9) / 4 = (1900 - 768 - 477) / 4 = 163.75 -> 164g.
    const m = suggestMacros({ weightKg: 80, targetKcal: 1900, phaseType: "cut" });
    expect(m).toEqual({ protein_g: 192, carb_g: 164, fat_g: 53 });
  });

  it("uses 2.3 g/kg protein on a bulk", () => {
    // 80kg * 2.3 = 184g.
    const m = suggestMacros({ weightKg: 80, targetKcal: 3000, phaseType: "bulk" });
    expect(m.protein_g).toBe(184);
  });

  it("uses 2.2 g/kg protein on maintenance", () => {
    // 80kg * 2.2 = 176g.
    const m = suggestMacros({ weightKg: 80, targetKcal: 2400, phaseType: "maintenance" });
    expect(m.protein_g).toBe(176);
  });

  it("floors carbs at 0 when protein+fat already exceed the target", () => {
    const m = suggestMacros({ weightKg: 120, targetKcal: 900, phaseType: "cut" });
    expect(m.carb_g).toBe(0);
    expect(m.protein_g).toBeGreaterThan(0);
  });

  it("rounds all macros to whole grams", () => {
    const m = suggestMacros({ weightKg: 72.5, targetKcal: 2137, phaseType: "cut" });
    expect(Number.isInteger(m.protein_g)).toBe(true);
    expect(Number.isInteger(m.carb_g)).toBe(true);
    expect(Number.isInteger(m.fat_g)).toBe(true);
  });
});
