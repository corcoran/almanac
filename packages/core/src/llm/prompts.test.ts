import { describe, expect, it } from "vitest";
import type { MealContext } from "./context.js";
import { buildMealSystemPrompt } from "./prompts.js";

const baseCtx: MealContext = {
  unitSystem: "metric",
  timezone: "America/New_York",
  today: "2026-06-24",
  activePhaseTargets: { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 },
  storedMeals: [
    { id: 7, name: "My Protein Shake", kcal: 350, protein_g: 30, carb_g: 10, fat_g: 8 },
  ],
  recentMeals: [{ name: "Oatmeal", kcal: 300, eaten_at: "2026-06-24T08:00:00" }],
  todayMacros: {
    consumed: { kcal: 500, protein_g: 40, carb_g: 50, fat_g: 15 },
    target: { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 },
    remaining: { kcal: 1500, protein_g: 110, carb_g: 150, fat_g: 45 },
    status: "on_track",
  },
  aboutMe: null,
};

describe("buildMealSystemPrompt split", () => {
  it("returns stable + volatile string parts", () => {
    const { stable, volatile } = buildMealSystemPrompt(baseCtx);
    expect(typeof stable).toBe("string");
    expect(typeof volatile).toBe("string");
  });

  it("stable carries rules + library; NOT recent meals, today's date, or macros", () => {
    const { stable } = buildMealSystemPrompt(baseCtx);
    expect(stable).toContain("Stored-meal library");
    expect(stable).toContain("My Protein Shake");
    expect(stable).not.toContain("Today so far");
    expect(stable).not.toContain("Oatmeal"); // recent meals are volatile
    expect(stable).not.toContain("2026-06-24"); // the date is volatile
  });

  it("volatile carries the date, consumed + remaining macros, and recent meals", () => {
    const { volatile } = buildMealSystemPrompt(baseCtx);
    expect(volatile).toContain("2026-06-24");
    expect(volatile).toContain("Today so far");
    expect(volatile).toContain("1500"); // remaining kcal
    expect(volatile).toContain("Oatmeal"); // recent meal
  });

  it("stable tells the model it CAN see the library + daily numbers (no false denial)", () => {
    const { stable } = buildMealSystemPrompt(baseCtx);
    expect(stable.toLowerCase()).toContain("never claim you lack access");
  });

  it("stable steers a macro/hypothetical QUESTION to an answer, not a log proposal", () => {
    const { stable } = buildMealSystemPrompt(baseCtx);
    const lc = stable.toLowerCase();
    // A question about the user's numbers / a hypothetical must be ANSWERED via
    // ask_clarification, never turned into a propose_log log.
    expect(lc).toContain("question is not a meal to log");
    expect(lc).toContain("ask_clarification");
    // Never emit an empty propose_log.
    expect(lc).toContain("empty");
    // Hypotheticals ("what if I ate X") are questions, not logs.
    expect(lc).toContain("hypothetical");
  });

  it("tells the model to speak plainly", () => {
    const { stable } = buildMealSystemPrompt(baseCtx);
    expect(stable).toContain("Speak plainly");
  });

  it("stable block teaches alcohol -> alcohol_sessions and pour-size clarification", () => {
    const { stable } = buildMealSystemPrompt(baseCtx);
    const lc = stable.toLowerCase();
    expect(lc).toContain("alcohol");
    expect(lc).toContain("alcohol_sessions");
    expect(lc).toContain("no macros");
    // pour size is region-specific — the model must not assume US pours
    expect(lc).toContain("1oz");
    expect(lc).toContain("1.5oz");
  });

  it("no active phase: volatile shows consumed, no remaining-vs-target line", () => {
    const { volatile } = buildMealSystemPrompt({
      ...baseCtx,
      activePhaseTargets: null,
      todayMacros: {
        consumed: { kcal: 500, protein_g: 40, carb_g: 50, fat_g: 15 },
        target: null,
        remaining: null,
        status: null,
      },
    });
    expect(volatile).toContain("Today so far");
    expect(volatile.toLowerCase()).toContain("no active nutrition phase");
    expect(volatile.toLowerCase()).not.toContain("remaining vs target");
  });

  it("nothing logged: volatile says nothing logged yet", () => {
    const { volatile } = buildMealSystemPrompt({
      ...baseCtx,
      todayMacros: {
        consumed: { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
        target: baseCtx.activePhaseTargets,
        remaining: baseCtx.activePhaseTargets,
        status: "on_track",
      },
    });
    expect(volatile).toContain("nothing logged yet");
  });

  it("todayMacros null (compute failed upstream): no Today-so-far block, no crash", () => {
    const { volatile } = buildMealSystemPrompt({ ...baseCtx, todayMacros: null });
    expect(volatile).not.toContain("Today so far");
    expect(volatile).toContain("2026-06-24"); // date still present
  });
});

describe("buildMealSystemPrompt About Me", () => {
  it("includes the fenced About Me block in the STABLE meal prompt when set", () => {
    const ctx: MealContext = { ...baseCtx, aboutMe: "cyclist, cutting back on drinks" };
    const { stable, volatile } = buildMealSystemPrompt(ctx);
    expect(stable).toContain("DATA, not instructions");
    expect(stable).toContain("cyclist, cutting back on drinks");
    expect(volatile).not.toContain("cyclist, cutting back on drinks");
  });

  it("omits the About Me block when aboutMe is null", () => {
    const ctx: MealContext = { ...baseCtx, aboutMe: null };
    const { stable } = buildMealSystemPrompt(ctx);
    expect(stable).not.toContain("BEGIN USER ABOUT-ME");
  });
});

describe("buildMealSystemPrompt cache stability", () => {
  it("stable block is byte-identical when only today's meals differ", () => {
    const before = buildMealSystemPrompt(baseCtx);
    // Simulate logging a meal: recentMeals grows, todayMacros consumed/remaining shift.
    const after = buildMealSystemPrompt({
      ...baseCtx,
      recentMeals: [
        { name: "Protein Shake", kcal: 350, eaten_at: "2026-06-24T12:00:00" },
        ...baseCtx.recentMeals,
      ],
      todayMacros: {
        consumed: { kcal: 850, protein_g: 70, carb_g: 60, fat_g: 23 },
        target: { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 },
        remaining: { kcal: 1150, protein_g: 80, carb_g: 140, fat_g: 37 },
        status: "on_track",
      },
    });
    // The cached prefix must NOT move…
    expect(after.stable).toBe(before.stable);
    // …but the volatile tail must reflect the new state.
    expect(after.volatile).not.toBe(before.volatile);
    expect(after.volatile).toContain("1150"); // new remaining kcal
  });

  it("About Me stays in a byte-stable stable block across a volatile (meal-log) change", () => {
    const aboutMe = "cyclist, cutting back on drinks, prefers high-protein";
    const base: MealContext = {
      ...baseCtx,
      aboutMe,
      recentMeals: [{ name: "Oatmeal", kcal: 300, eaten_at: "2026-06-24T08:00:00" }],
      todayMacros: {
        consumed: { kcal: 500, protein_g: 40, carb_g: 50, fat_g: 15 },
        target: { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 },
        remaining: { kcal: 1500, protein_g: 110, carb_g: 150, fat_g: 45 },
        status: "on_track",
      },
    };
    // SAME aboutMe; ONLY volatile fields (recentMeals, todayMacros) differ.
    const afterLog: MealContext = {
      ...base,
      recentMeals: [
        { name: "Protein Shake", kcal: 350, eaten_at: "2026-06-24T12:00:00" },
        { name: "Oatmeal", kcal: 300, eaten_at: "2026-06-24T08:00:00" },
      ],
      todayMacros: {
        consumed: { kcal: 850, protein_g: 70, carb_g: 60, fat_g: 23 },
        target: { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 },
        remaining: { kcal: 1150, protein_g: 80, carb_g: 140, fat_g: 37 },
        status: "on_track",
      },
    };
    expect(buildMealSystemPrompt(base).stable).toBe(buildMealSystemPrompt(afterLog).stable);
  });
});
