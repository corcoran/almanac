import type { Connection } from "@almanac/core/db";
import {
  closeAndStartPhase,
  createBodyWeight,
  createCardioSession,
  createMeal,
  createOrUpdateStepLog,
  updateUser,
} from "@almanac/core/repos";
import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { computeDailyTargetForDate, computeTdeeForUser } from "./inputs.js";

function setup(tz = "America/Toronto") {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, { timezone: tz });
  return { db, userId };
}

/**
 * Seed 14 consecutive days (ending 2026-05-21) of weigh-ins + 2200-kcal meals so
 * computeTDEE flips its `basis` to `measured_intake`. Mirrors the known-good
 * seeding in accomplishments.test.ts / tdee.test.ts.
 */
function seedMeasuredTdee(db: Connection, userId: number): void {
  for (let i = 0; i < 14; i++) {
    const d = `2026-05-${String(8 + i).padStart(2, "0")}`;
    createBodyWeight(db, { user_id: userId, measured_on: d, weight_kg: 80 - i * 0.05 });
    createMeal(db, {
      user_id: userId,
      eaten_at: `${d}T16:00:00Z`,
      kcal: 2200,
      protein_g: 150,
      carb_g: 200,
      fat_g: 70,
    });
  }
}

function startCutPhase(db: Connection, userId: number): void {
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

describe("computeTdeeForUser", () => {
  it("assembles weigh-ins/meals/alcohol and returns measured_intake once enough data exists", () => {
    const { db, userId } = setup();
    seedMeasuredTdee(db, userId); // 14 days ending 2026-05-21
    // 'now' is the day AFTER the last seeded day, so all 14 seeded days are
    // COMPLETED (the live window ends on today − 1 = 2026-05-21).
    const tdee = computeTdeeForUser(db, userId, new Date("2026-05-22T20:00:00Z"));
    expect(tdee.basis).toBe("measured_intake");
    expect(tdee.kcal).toBeGreaterThan(0);
  });

  it("returns profile_baseline when there is no logged data", () => {
    const { db, userId } = setup();
    const tdee = computeTdeeForUser(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(tdee.basis).toBe("profile_baseline");
  });

  it("throws when the user does not exist", () => {
    const { db } = setup();
    expect(() => computeTdeeForUser(db, 9999, new Date("2026-05-21T20:00:00Z"))).toThrow();
  });

  it("anchors Mifflin on a today-dated weigh-in even though the back-calc window ends yesterday", () => {
    const { db, userId } = setup();
    // 2026-08-07T16:00Z = 12:00 in Toronto → user-local today is 2026-08-07.
    // The back-calc window ends 2026-08-06, so this weigh-in is outside it —
    // but it must still anchor the profile-baseline formula.
    createBodyWeight(db, { user_id: userId, measured_on: "2026-08-07", weight_kg: 60 });
    const tdee = computeTdeeForUser(db, userId, new Date("2026-08-07T16:00:00Z"));
    expect(tdee.basis).toBe("profile_baseline");
    // BMR(60kg, 180cm, 36y, male) = 600 + 1125 − 180 + 5 = 1550; ×1.4 seed
    // multiplier = 2170. The fabricated-80kg fallback would read 2450.
    expect(tdee.kcal).toBe(2170);
  });

  it("ignores a future-dated weigh-in for the Mifflin anchor", () => {
    const { db, userId } = setup();
    createBodyWeight(db, { user_id: userId, measured_on: "2026-08-09", weight_kg: 60 });
    const tdee = computeTdeeForUser(db, userId, new Date("2026-08-07T16:00:00Z"));
    // No usable anchor → the 80kg baseline, unchanged: BMR(80) = 1750 × 1.4.
    expect(tdee.kcal).toBe(2450);
  });

  it("excludes the in-progress day from the intake window (ends on the last completed day)", () => {
    const { db, userId } = setup();
    // 20 completed days of flat ~2000-kcal intake + daily weigh-ins, ending the
    // day BEFORE 'today' (2026-05-21). 'today' itself gets a deliberately tiny
    // 200-kcal partial log. The live displayed TDEE must end its back-calc
    // window on the last COMPLETED day (today − 1 = 2026-05-20), so today's
    // half-logged 200 must NOT enter the intake average.
    for (let i = 0; i < 20; i++) {
      const d = `2026-05-${String(1 + i).padStart(2, "0")}`; // 2026-05-01 .. 2026-05-20
      createBodyWeight(db, { user_id: userId, measured_on: d, weight_kg: 80 - i * 0.02 });
      createMeal(db, {
        user_id: userId,
        eaten_at: `${d}T16:00:00Z`,
        kcal: 2000,
        protein_g: 150,
        carb_g: 200,
        fat_g: 70,
      });
    }
    // The in-progress day: a tiny partial meal. With a Toronto tz a 16:00Z stamp
    // is noon local, squarely inside the 2026-05-21 user-day.
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-21T16:00:00Z",
      kcal: 200,
      protein_g: 20,
      carb_g: 20,
      fat_g: 5,
    });

    const tdee = computeTdeeForUser(db, userId, new Date("2026-05-21T20:00:00Z"));
    // If today were included, the average would be dragged toward
    // (20*2000 + 200)/21 ≈ 1914. With today excluded it stays at 2000.
    expect(tdee.components.avg_kcal_in.value).toBe(2000);
    // And today's partial intake must not be counted as a data day: the window
    // ends at 2026-05-20, so days_with_data caps at the 20 completed days.
    expect(tdee.components.avg_kcal_in.days_with_data).toBeLessThanOrEqual(20);
  });
});

describe("computeDailyTargetForDate", () => {
  it("returns no_phase when the user has no active phase", () => {
    const { db, userId } = setup();
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-21T16:00:00Z",
      kcal: 1800,
      protein_g: 180,
      carb_g: 170,
      fat_g: 55,
    });
    const result = computeDailyTargetForDate(db, userId, "America/Toronto", "2026-05-21");
    expect(result.kind).toBe("no_phase");
    // totals + mealCount are present even with no phase, so a caller can still
    // render intake (the macros route returns day_totals in this case).
    expect(result.totals.kcal).toBe(1800);
    expect(result.mealCount).toBe(1);
  });

  it("returns ready with a computed dayTarget and meal aggregation on an on-track day", () => {
    const { db, userId } = setup();
    startCutPhase(db, userId);
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-21T16:00:00Z",
      kcal: 1800,
      protein_g: 180,
      carb_g: 170,
      fat_g: 55,
    });
    const result = computeDailyTargetForDate(db, userId, "America/Toronto", "2026-05-21");
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.mealCount).toBe(1);
    expect(result.totals.kcal_from_food).toBe(1800);
    expect(result.totals.kcal_from_alcohol).toBe(0);
    expect(result.totals.kcal).toBe(1800);
    expect(result.dayTarget.observed.status).toBe("on_track");
    expect(result.dayTarget.intake.kcal).toBe(1800);
  });

  it("reports mealCount 0 (ready) for a phase day with no meals — caller decides null", () => {
    const { db, userId } = setup();
    startCutPhase(db, userId);
    const result = computeDailyTargetForDate(db, userId, "America/Toronto", "2026-05-21");
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.mealCount).toBe(0);
  });

  it("folds alcohol kcal into intake and exposes the split", () => {
    const { db, userId } = setup();
    startCutPhase(db, userId);
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-21T16:00:00Z",
      kcal: 1600,
      protein_g: 180,
      carb_g: 150,
      fat_g: 50,
    });
    createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-21T17:00:00Z",
      modality: "run",
      duration_min: 30,
      est_kcal: 300,
    });
    const result = computeDailyTargetForDate(db, userId, "America/Toronto", "2026-05-21");
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.totals.kcal_from_food).toBe(1600);
    expect(result.dayTarget.observed.cardio_kcal).toBe(300);
  });

  it("includes snapshotted step kcal in the observed block", () => {
    const { db, userId } = setup();
    startCutPhase(db, userId);
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-21T16:00:00Z",
      kcal: 1800,
      protein_g: 180,
      carb_g: 170,
      fat_g: 55,
    });
    createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-21",
      steps: 10000,
      est_kcal: 400,
    });
    const result = computeDailyTargetForDate(db, userId, "America/Toronto", "2026-05-21");
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.dayTarget.observed.steps_kcal).toBe(400);
  });
});
