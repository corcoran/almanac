import { describe, expect, it } from "vitest";
import { expandProgramPreset, PROGRAM_PRESETS } from "./template-presets.js";

describe("PROGRAM_PRESETS catalog", () => {
  it("ships exactly PPL and Upper/Lower", () => {
    expect(PROGRAM_PRESETS.map((p) => p.id)).toEqual(["ppl", "upper_lower"]);
  });

  it("PPL has 3 templates, Upper/Lower has 2", () => {
    const ppl = PROGRAM_PRESETS.find((p) => p.id === "ppl");
    const ul = PROGRAM_PRESETS.find((p) => p.id === "upper_lower");
    expect(ppl?.templates.map((t) => t.name)).toEqual(["Push", "Pull", "Legs"]);
    expect(ul?.templates.map((t) => t.name)).toEqual(["Upper", "Lower"]);
  });

  it("every preset item is well-formed: non-empty name+group, no preset weight, sane sets/reps", () => {
    for (const program of PROGRAM_PRESETS) {
      for (const tpl of program.templates) {
        expect(tpl.items.length).toBeGreaterThan(0);
        for (const item of tpl.items) {
          expect(item.exerciseName.trim().length).toBeGreaterThan(0);
          expect(item.groupName.trim().length).toBeGreaterThan(0);
          expect(item.default_sets).toBeGreaterThan(0);
          // reps either null or a positive int
          if (item.default_reps !== null) {
            expect(Number.isInteger(item.default_reps)).toBe(true);
            expect(item.default_reps).toBeGreaterThan(0);
          }
          // presets never prescribe a weight (personal)
          expect("default_weight_kg" in item).toBe(false);
        }
      }
    }
  });

  it("only uses canonical group names", () => {
    const allowed = new Set(["Chest", "Back", "Shoulders", "Legs", "Arms"]);
    for (const program of PROGRAM_PRESETS) {
      for (const tpl of program.templates) {
        for (const item of tpl.items) {
          expect(allowed.has(item.groupName)).toBe(true);
        }
      }
    }
  });
});

describe("expandProgramPreset", () => {
  it("returns the program's templates verbatim", () => {
    const ppl = PROGRAM_PRESETS.find((p) => p.id === "ppl");
    if (!ppl) throw new Error("ppl preset missing");
    const expanded = expandProgramPreset(ppl);
    expect(expanded.templates).toEqual(ppl.templates);
  });
});
