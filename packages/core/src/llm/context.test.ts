import { closeAndStartPhase, createMeal, updateUser } from "@almanac/core/repos";
import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { assembleMealContext } from "./context.js";

const TZ = "America/Toronto";
const NOW = new Date("2026-05-21T20:00:00Z"); // 2026-05-21 user-local in Toronto

function user(id: number) {
  return { id, timezone: TZ, preferred_unit_system: "metric", about_me: null };
}

function startCut(db: ReturnType<typeof freshDb>, userId: number) {
  closeAndStartPhase(db, {
    user_id: userId,
    name: "cut",
    intent: "cut",
    phase_type: "cut",
    tdee_at_phase_start: 2400,
    tdee_source: "user_asserted",
    deficit_kcal: -500,
    daily_kcal_target: 1900,
    base_protein_g: 180,
    base_carb_g: 170,
    base_fat_g: 60,
    started_on: "2026-05-01",
  });
}

describe("assembleMealContext todayMacros", () => {
  it("active phase + a logged meal: consumed, target, remaining, status present", () => {
    const db = freshDb();
    const userId = seedUser(db);
    updateUser(db, userId, { timezone: TZ });
    startCut(db, userId);
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-21T16:00:00Z",
      kcal: 500,
      protein_g: 40,
      carb_g: 50,
      fat_g: 15,
    });
    const ctx = assembleMealContext(db, user(userId), NOW);
    expect(ctx.todayMacros).not.toBeNull();
    expect(ctx.todayMacros?.consumed.kcal).toBe(500);
    expect(ctx.todayMacros?.target?.kcal).toBe(1900);
    expect(ctx.todayMacros?.remaining?.kcal).toBe(1400); // 1900 - 500
    expect(ctx.todayMacros?.remaining?.protein_g).toBe(140); // 180 - 40
    expect(ctx.todayMacros?.status).toBeTruthy();
  });

  it("no active phase: consumed present, target/remaining/status null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    updateUser(db, userId, { timezone: TZ });
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-21T16:00:00Z",
      kcal: 500,
      protein_g: 40,
      carb_g: 50,
      fat_g: 15,
    });
    const ctx = assembleMealContext(db, user(userId), NOW);
    expect(ctx.todayMacros?.consumed.kcal).toBe(500);
    expect(ctx.todayMacros?.target).toBeNull();
    expect(ctx.todayMacros?.remaining).toBeNull();
    expect(ctx.todayMacros?.status).toBeNull();
  });

  it("active phase, nothing logged today: consumed all-zero", () => {
    const db = freshDb();
    const userId = seedUser(db);
    updateUser(db, userId, { timezone: TZ });
    startCut(db, userId);
    const ctx = assembleMealContext(db, user(userId), NOW);
    expect(ctx.todayMacros?.consumed.kcal).toBe(0);
    expect(ctx.todayMacros?.consumed.protein_g).toBe(0);
  });

  it("over budget: remaining goes negative, not clamped to zero", () => {
    const db = freshDb();
    const userId = seedUser(db);
    updateUser(db, userId, { timezone: TZ });
    startCut(db, userId); // target 1900 kcal / 180 P
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-21T16:00:00Z",
      kcal: 2200,
      protein_g: 200,
      carb_g: 220,
      fat_g: 80,
    });
    const ctx = assembleMealContext(db, user(userId), NOW);
    expect(ctx.todayMacros?.remaining?.kcal).toBe(-300); // 1900 - 2200
    expect(ctx.todayMacros?.remaining?.protein_g).toBe(-20); // 180 - 200
  });
});
