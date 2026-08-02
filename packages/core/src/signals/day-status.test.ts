import { describe, expect, it } from "vitest";
import { createAlcoholSession } from "../repos/alcohol.repo.js";
import { createBodyWeight } from "../repos/body-weights.repo.js";
import { createGroup } from "../repos/exercise-groups.repo.js";
import { createExercise } from "../repos/exercises.repo.js";
import { createMeal } from "../repos/meals.repo.js";
import { closeAndStartPhase } from "../repos/nutrition-phases.repo.js";
import { createSleepLog } from "../repos/sleep.repo.js";
import { createOrUpdateStepLog } from "../repos/step-logs.repo.js";
import { createUntrackedPeriod } from "../repos/untracked-periods.repo.js";
import { updateUser } from "../repos/users.repo.js";
import { createWorkout } from "../repos/workouts.repo.js";
import { freshDb, seedUser } from "../test-support/db.js";
import { defined } from "../test-support/index.js";
import { computeDayStatus } from "./day-status.js";

/**
 * Scaffold for day-status tests — seeds a user with a Toronto timezone,
 * one nutrition phase, and one push-up exercise so tests that need to log a
 * workout have an exercise ID to use.
 */
function setup(tz = "America/Toronto", phaseType: "cut" | "bulk" | "maintenance" = "cut") {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, { timezone: tz });
  const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
  const push = createExercise(db, {
    user_id: userId,
    group_id: chest.id,
    name: "Push-up",
  });
  closeAndStartPhase(db, {
    user_id: userId,
    name: phaseType,
    intent: phaseType,
    phase_type: phaseType,
    tdee_at_phase_start: 2400,
    tdee_source: "user_asserted",
    deficit_kcal: phaseType === "cut" ? -500 : phaseType === "bulk" ? 300 : 0,
    daily_kcal_target: phaseType === "cut" ? 1900 : phaseType === "bulk" ? 2700 : 2400,
    base_protein_g: 180,
    base_carb_g: 170,
    base_fat_g: 60,
    started_on: "2026-05-01",
  });
  return { db, userId, pushExerciseId: push.id };
}

/**
 * Seed a 7-day daily-meal history of `kcal` kcal each, ending one day BEFORE
 * `endingOnExclusive`. Used to give the 7-day average a meaningful baseline
 * for the low_intake_today nudge tests.
 */
function seedSevenDaysOfMeals(
  db: ReturnType<typeof freshDb>,
  userId: number,
  endingOnExclusive: string,
  kcal: number,
) {
  for (let i = 7; i >= 1; i--) {
    const d = new Date(`${endingOnExclusive}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString();
    createMeal(db, {
      user_id: userId,
      eaten_at: iso,
      kcal,
      protein_g: 100,
      carb_g: 150,
      fat_g: 60,
    });
  }
}

describe("computeDayStatus", () => {
  describe("summary", () => {
    it("composes kcal/protein in vs target and 'logged today' booleans", () => {
      const { db, userId } = setup();
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-21T16:00:00Z", // 12:00 ET
        kcal: 800,
        protein_g: 70,
        carb_g: 90,
        fat_g: 25,
      });
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-21", weight_kg: 82 });
      createSleepLog(db, { user_id: userId, slept_on: "2026-05-21", hours: 7.5, quality: 4 });

      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));

      expect(r.date).toBe("2026-05-21");
      expect(r.summary.kcal_in).toBe(800);
      expect(r.summary.kcal_target).toBe(1900); // base_kcal, no activity
      expect(r.summary.kcal_delta).toBe(800 - 1900);
      expect(r.summary.protein_g_in).toBe(70);
      expect(r.summary.protein_g_target).toBe(180);
      expect(r.summary.weight_logged).toBe(true);
      expect(r.summary.sleep_logged).toBe(true);
      expect(r.summary.workout_done).toBe(false);
      expect(r.summary.alcohol_logged).toBe(false);
      // Sibling to the other 'logged today' booleans. Distinguishes "user
      // ate zero kcal" (impossible in practice) from "user didn't log any
      // meals", which surfaces in MCP tools that would otherwise emit a
      // misleading "0 kcal in" summary.
      expect(r.summary.meals_logged).toBe(true);
      // 800 kcal is below 1900 target; cut phase with grace band so it's "on_track"
      expect(r.summary.status).toBe("on_track");
    });

    it("meals_logged is false when no meals exist for the user-day", () => {
      const { db, userId } = setup();
      // No createMeal call — user-day starts and stays empty.
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.summary.meals_logged).toBe(false);
      expect(r.summary.kcal_in).toBe(0);
    });

    it("workout_done flips to true once any workout exists for the user-day", () => {
      const { db, userId, pushExerciseId } = setup();
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-21T17:00:00Z",
        rpe: 8,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 0 }],
          },
        ],
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.summary.workout_done).toBe(true);
    });

    it("returns status=null when no active nutrition phase exists", () => {
      const db = freshDb();
      const userId = seedUser(db);
      updateUser(db, userId, { timezone: "America/Toronto" });
      // Note: NOT starting a phase.
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-21T16:00:00Z",
        kcal: 800,
        protein_g: 70,
        carb_g: 90,
        fat_g: 25,
      });

      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.summary.kcal_target).toBe(0);
      expect(r.summary.status).toBeNull();
    });

    it("mirrors today.energy_balance verbatim onto summary.energy_balance", () => {
      const { db, userId } = setup();
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-21T16:00:00Z",
        kcal: 1200,
        protein_g: 100,
        carb_g: 130,
        fat_g: 40,
      });
      createAlcoholSession(db, {
        user_id: userId,
        started_at: "2026-05-21T22:00:00Z",
        drinks_count: 2,
        est_kcal: 200,
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T23:00:00Z"));
      expect(r.summary.energy_balance.food_in).toBe(1200);
      expect(r.summary.energy_balance.alcohol_in).toBe(200);
      expect(r.summary.energy_balance.total_in).toBe(1400);
      // tdee_baseline is whatever TDEE computed for this fixture; just assert
      // net is total_in minus that (no double-count).
      expect(r.summary.energy_balance.net).toBe(1400 - r.summary.energy_balance.tdee_baseline);
    });
  });

  describe("low_intake_today nudge", () => {
    it("fires when today's kcal is under 30% of 7-day avg, after 14:00 local", () => {
      const { db, userId } = setup();
      // 7-day avg: 2000 kcal/day. Today: 400 kcal (20%). After 14:00 ET.
      seedSevenDaysOfMeals(db, userId, "2026-05-21", 2000);
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-21T13:00:00Z", // 9:00 ET
        kcal: 400,
        protein_g: 25,
        carb_g: 40,
        fat_g: 15,
      });

      const r = computeDayStatus(db, userId, new Date("2026-05-21T22:00:00Z")); // 18:00 ET
      const nudge = r.nudges.find((n) => n.code === "low_intake_today");
      expect(nudge).toBeDefined();
      expect(defined(nudge, "nudge").severity).toBe("warn");
      expect(defined(nudge, "nudge").details).toMatchObject({
        kcal_in: 400,
        avg7d_kcal_in: 2000,
      });
      expect((defined(nudge, "nudge").details as { fraction: number }).fraction).toBeCloseTo(0.2);
    });

    it("does NOT fire before 14:00 local — morning low intake is normal", () => {
      const { db, userId } = setup();
      seedSevenDaysOfMeals(db, userId, "2026-05-21", 2000);
      // 09:00 ET = 13:00 UTC. Before the 14:00 gate.
      const r = computeDayStatus(db, userId, new Date("2026-05-21T13:00:00Z"));
      expect(r.nudges.find((n) => n.code === "low_intake_today")).toBeUndefined();
    });

    it("does NOT fire when avg7d is 0 (no baseline to compare against)", () => {
      const { db, userId } = setup();
      // No meal history seeded — avg7d = 0.
      const r = computeDayStatus(db, userId, new Date("2026-05-21T22:00:00Z"));
      expect(r.nudges.find((n) => n.code === "low_intake_today")).toBeUndefined();
    });

    it("does NOT fire when today's intake is at or above the threshold", () => {
      const { db, userId } = setup();
      seedSevenDaysOfMeals(db, userId, "2026-05-21", 2000);
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-21T16:00:00Z",
        kcal: 700, // 35% — above the 30% threshold
        protein_g: 50,
        carb_g: 70,
        fat_g: 25,
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T22:00:00Z"));
      expect(r.nudges.find((n) => n.code === "low_intake_today")).toBeUndefined();
    });

    it("does NOT fire when no meals are logged today (treat as 'no data', not 'ate zero')", () => {
      // A user with a strong 7-day meal history takes a day off logging
      // (e.g., vacation). Without this guard, the nudge fires every
      // afternoon because today's kcal_in is 0 and avg7d is nonzero —
      // pure noise. The fix: require kcal_in > 0 to consider today a
      // "low intake" day at all.
      const { db, userId } = setup();
      seedSevenDaysOfMeals(db, userId, "2026-05-21", 2000);
      // No meal created for 2026-05-21.
      const r = computeDayStatus(db, userId, new Date("2026-05-21T22:00:00Z"));
      expect(r.nudges.find((n) => n.code === "low_intake_today")).toBeUndefined();
    });

    it("excludes untracked (vacation) days from the 7-day average", () => {
      // The trailing window is 2026-05-14..05-20. Five tracked days at 2000
      // kcal; two vacation days (05-19, 05-20) where the user still logged a
      // light 200 kcal each. Those low-logged vacation days would drag the
      // raw average down to (5*2000 + 2*200)/7 ≈ 1486 — but excluding
      // untracked days keeps the baseline at the tracked-only 2000.
      const { db, userId } = setup();
      const trackedKcal = 2000;
      const vacationKcal = 200;
      for (let i = 7; i >= 1; i--) {
        const d = new Date("2026-05-21T12:00:00Z");
        d.setUTCDate(d.getUTCDate() - i);
        const day = d.toISOString().slice(0, 10);
        const isVacation = day === "2026-05-19" || day === "2026-05-20";
        createMeal(db, {
          user_id: userId,
          eaten_at: d.toISOString(),
          kcal: isVacation ? vacationKcal : trackedKcal,
          protein_g: 100,
          carb_g: 150,
          fat_g: 60,
        });
      }
      createUntrackedPeriod(db, {
        user_id: userId,
        started_on: "2026-05-19",
        ended_on: "2026-05-20",
        reason: "vacation",
      });
      // Today's low intake (400 < 30% of 2000).
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-21T16:00:00Z",
        kcal: 400,
        protein_g: 25,
        carb_g: 40,
        fat_g: 15,
      });

      const r = computeDayStatus(db, userId, new Date("2026-05-21T22:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "low_intake_today");
      expect(nudge).toBeDefined();
      // Average is the tracked-only 2000 — NOT ~1486, which is what the raw
      // (untracked-inclusive) average would yield.
      expect(defined(nudge, "nudge").details).toMatchObject({ avg7d_kcal_in: 2000 });
    });

    it("excludes an evening untracked-day meal from the low_intake 7d baseline", () => {
      // America/New_York. Window is user-local 2026-05-14..2026-05-20.
      // Five tracked midday meal-days at 2000 kcal give a clean baseline.
      // 2026-05-19 is a one-day vacation (untracked). An evening (9pm ET)
      // meal on that vacation day is stored at 2026-05-20T01:00:00Z — its
      // UTC date is 05-20, but its user-local day is 05-19 (untracked).
      // Correct user-local bucketing drops it (it's on an untracked day);
      // buggy UTC bucketing files it under 05-20 (a tracked day with no
      // other meal), polluting the average down to ~1750.
      const { db, userId } = setup("America/New_York");
      for (const day of ["2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18"]) {
        createMeal(db, {
          user_id: userId,
          eaten_at: `${day}T16:00:00Z`, // 12:00 ET — same UTC date
          kcal: 2000,
          protein_g: 100,
          carb_g: 150,
          fat_g: 60,
        });
      }
      createUntrackedPeriod(db, {
        user_id: userId,
        started_on: "2026-05-19",
        ended_on: "2026-05-19",
        reason: "vacation",
      });
      // Evening meal on the user-local vacation day 2026-05-19 (9pm ET),
      // which lands on the next UTC date 2026-05-20.
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-20T01:00:00Z",
        kcal: 500,
        protein_g: 30,
        carb_g: 50,
        fat_g: 15,
      });
      // Today's low intake so the nudge fires and exposes avg7d in details.
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-21T16:00:00Z", // 12:00 ET on 2026-05-21
        kcal: 400,
        protein_g: 25,
        carb_g: 40,
        fat_g: 15,
      });

      const r = computeDayStatus(db, userId, new Date("2026-05-21T22:00:00Z")); // 18:00 ET
      const nudge = defined(
        r.nudges.find((n) => n.code === "low_intake_today"),
        "nudge",
      );
      // Tracked-only baseline = 2000. The evening untracked-day meal must NOT
      // count; UTC bucketing would yield ~1750.
      expect(nudge.details).toMatchObject({ avg7d_kcal_in: 2000 });
    });

    it("phrases the message as a keep-logging prompt, not an error", () => {
      const { db, userId } = setup();
      seedSevenDaysOfMeals(db, userId, "2026-05-21", 2000);
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-21T16:00:00Z",
        kcal: 400,
        protein_g: 25,
        carb_g: 40,
        fat_g: 15,
      });

      const r = computeDayStatus(db, userId, new Date("2026-05-21T22:00:00Z"));
      const nudge = defined(
        r.nudges.find((n) => n.code === "low_intake_today"),
        "nudge",
      );
      // Question-framed reminder to keep logging, surfacing today's logged
      // total and the (approximate) usual. Must NOT read like an error.
      expect(nudge.message).toContain("Logged 400 kcal so far today");
      expect(nudge.message).toContain("~2000");
      expect(nudge.message).toContain("More meals to add?");
      expect(nudge.message).not.toContain("under");
    });
  });

  describe("no_workout_streak nudge", () => {
    it("fires when last workout is >= 7 days ago", () => {
      const { db, userId, pushExerciseId } = setup();
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-13T17:00:00Z", // 8 days before 2026-05-21
        rpe: 8,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 0 }],
          },
        ],
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "no_workout_streak");
      expect(nudge).toBeDefined();
      expect(defined(nudge, "nudge").severity).toBe("warn");
      expect((defined(nudge, "nudge").details as { days_since_last: number }).days_since_last).toBe(
        8,
      );
    });

    it("escalates to 'concern' at 2x the threshold (14+ days)", () => {
      const { db, userId, pushExerciseId } = setup();
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-06T17:00:00Z", // 15 days before
        rpe: 7,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 0 }],
          },
        ],
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "no_workout_streak");
      expect(defined(nudge, "nudge").severity).toBe("concern");
    });

    it("attributes an evening workout to its user-local day for no_workout_streak", () => {
      // America/New_York. Last workout at 9pm ET on 2026-05-14, stored at
      // 2026-05-15T01:00:00Z. Its UTC date is 05-15, its user-local day is
      // 05-14. With today = 2026-05-21 and threshold 7:
      //   UTC bucketing  → daysSince = daysBetween(05-15, 05-21) = 6 → no fire
      //   user-local     → daysSince = daysBetween(05-14, 05-21) = 7 → fires
      // So the nudge firing (with days_since_last = 7) proves user-local
      // bucketing; UTC bucketing would suppress it.
      const { db, userId, pushExerciseId } = setup("America/New_York");
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-15T01:00:00Z", // 9pm ET on 2026-05-14
        rpe: 8,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 0 }],
          },
        ],
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "no_workout_streak");
      expect(nudge).toBeDefined();
      expect((defined(nudge, "nudge").details as { days_since_last: number }).days_since_last).toBe(
        7,
      );
    });

    it("does NOT fire when the user has never logged a workout", () => {
      // Honors the "nutrition-only users shouldn't be nagged about training"
      // case — the streak nudge is for lapsed trainers, not non-trainers.
      const { db, userId } = setup();
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.nudges.find((n) => n.code === "no_workout_streak")).toBeUndefined();
    });

    it("does NOT fire when a workout exists within the window", () => {
      const { db, userId, pushExerciseId } = setup();
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-18T17:00:00Z", // 3 days before
        rpe: 7,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 0 }],
          },
        ],
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.nudges.find((n) => n.code === "no_workout_streak")).toBeUndefined();
    });
  });

  describe("stale_weight_log nudge", () => {
    it("fires when last weight is older than 3 days", () => {
      const { db, userId } = setup();
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-15", weight_kg: 82 });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "stale_weight_log");
      expect(nudge).toBeDefined();
      expect(
        (defined(nudge, "nudge").details as { days_since_last: number | null }).days_since_last,
      ).toBe(6);
    });

    it("fires with 'concern' severity when the user has never logged a weight", () => {
      const { db, userId } = setup();
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "stale_weight_log");
      expect(nudge).toBeDefined();
      expect(defined(nudge, "nudge").severity).toBe("concern");
      expect(
        (defined(nudge, "nudge").details as { days_since_last: number | null }).days_since_last,
      ).toBeNull();
    });

    it("does NOT fire when last weight is within the window (3 days)", () => {
      const { db, userId } = setup();
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-19", weight_kg: 82 });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.nudges.find((n) => n.code === "stale_weight_log")).toBeUndefined();
    });
  });

  describe("summary.steps_logged", () => {
    it("is true when a step log exists for the user-day", () => {
      const { db, userId } = setup();
      createOrUpdateStepLog(db, {
        user_id: userId,
        on_date: "2026-05-21",
        steps: 8000,
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.summary.steps_logged).toBe(true);
    });

    it("is false when no step log exists for the user-day", () => {
      const { db, userId } = setup();
      // No step log seeded.
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.summary.steps_logged).toBe(false);
    });

    it("is true even when the logged steps count is zero (explicit zero, not missing)", () => {
      // Mirrors the meals_logged story: { count: 0 } is distinct from null
      // — the user told us they didn't walk, vs. we don't know yet.
      const { db, userId } = setup();
      createOrUpdateStepLog(db, {
        user_id: userId,
        on_date: "2026-05-21",
        steps: 0,
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.summary.steps_logged).toBe(true);
    });
  });

  describe("unlogged_steps nudge", () => {
    it("fires at hour >= 20 for a cut phase with no step log", () => {
      const { db, userId } = setup("America/Toronto", "cut");
      // 2026-05-22T00:00:00Z = 20:00 ET on 2026-05-21.
      const r = computeDayStatus(db, userId, new Date("2026-05-22T00:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "unlogged_steps");
      expect(nudge).toBeDefined();
      expect(defined(nudge, "nudge").severity).toBe("info");
      expect((defined(nudge, "nudge").details as { hour_local: number }).hour_local).toBe(20);
    });

    it("fires at hour >= 20 for a bulk phase with no step log", () => {
      const { db, userId } = setup("America/Toronto", "bulk");
      const r = computeDayStatus(db, userId, new Date("2026-05-22T00:00:00Z"));
      expect(r.nudges.find((n) => n.code === "unlogged_steps")).toBeDefined();
    });

    it("does NOT fire for a maintenance phase even past the threshold", () => {
      // Maintenance doesn't need the NEAT precision a cut/bulk does.
      const { db, userId } = setup("America/Toronto", "maintenance");
      const r = computeDayStatus(db, userId, new Date("2026-05-22T00:00:00Z"));
      expect(r.nudges.find((n) => n.code === "unlogged_steps")).toBeUndefined();
    });

    it("does NOT fire before hour 20 — user still has chances to walk", () => {
      const { db, userId } = setup("America/Toronto", "cut");
      // 2026-05-21T22:00:00Z = 18:00 ET — before the 20:00 gate.
      const r = computeDayStatus(db, userId, new Date("2026-05-21T22:00:00Z"));
      expect(r.nudges.find((n) => n.code === "unlogged_steps")).toBeUndefined();
    });

    it("does NOT fire when a step log exists, even with zero steps", () => {
      const { db, userId } = setup("America/Toronto", "cut");
      createOrUpdateStepLog(db, {
        user_id: userId,
        on_date: "2026-05-21",
        steps: 0,
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-22T00:00:00Z"));
      expect(r.nudges.find((n) => n.code === "unlogged_steps")).toBeUndefined();
    });

    it("does NOT fire when a step log exists with a nonzero count", () => {
      const { db, userId } = setup("America/Toronto", "cut");
      createOrUpdateStepLog(db, {
        user_id: userId,
        on_date: "2026-05-21",
        steps: 9500,
      });
      const r = computeDayStatus(db, userId, new Date("2026-05-22T00:00:00Z"));
      expect(r.nudges.find((n) => n.code === "unlogged_steps")).toBeUndefined();
    });

    it("does NOT fire when no nutrition phase is active", () => {
      const db = freshDb();
      const userId = seedUser(db);
      updateUser(db, userId, { timezone: "America/Toronto" });
      // No phase started.
      const r = computeDayStatus(db, userId, new Date("2026-05-22T00:00:00Z"));
      expect(r.nudges.find((n) => n.code === "unlogged_steps")).toBeUndefined();
    });
  });

  describe("stale_sleep_log nudge", () => {
    it("fires when last sleep log is older than 2 days", () => {
      const { db, userId } = setup();
      createSleepLog(db, { user_id: userId, slept_on: "2026-05-18", hours: 7, quality: 3 });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "stale_sleep_log");
      expect(nudge).toBeDefined();
      expect(
        (defined(nudge, "nudge").details as { days_since_last: number | null }).days_since_last,
      ).toBe(3);
    });

    it("fires with 'info' severity when the user has never logged sleep", () => {
      // Lighter touch than missing weight — sleep is informational, no
      // calibration story attached, so a never-logged user gets `info` not
      // `concern`.
      const { db, userId } = setup();
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      const nudge = r.nudges.find((n) => n.code === "stale_sleep_log");
      expect(nudge).toBeDefined();
      expect(defined(nudge, "nudge").severity).toBe("info");
    });

    it("does NOT fire when last sleep is within the window", () => {
      const { db, userId } = setup();
      createSleepLog(db, { user_id: userId, slept_on: "2026-05-20", hours: 8, quality: 4 });
      const r = computeDayStatus(db, userId, new Date("2026-05-21T20:00:00Z"));
      expect(r.nudges.find((n) => n.code === "stale_sleep_log")).toBeUndefined();
    });
  });

  describe("stale-nudge suppression over untracked periods", () => {
    const NOW = new Date("2026-05-21T18:00:00Z"); // today = 2026-05-21

    it("suppresses stale_weight_log when the whole staleness run is untracked", () => {
      const db = freshDb();
      const userId = seedUser(db);
      db.prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (?, '2026-05-16', 80)",
      ).run(userId);
      createUntrackedPeriod(db, {
        user_id: userId,
        started_on: "2026-05-17",
        ended_on: "2026-05-21",
        reason: "vacation",
      });
      const r = computeDayStatus(db, userId, NOW);
      expect(r.nudges.find((n) => n.code === "stale_weight_log")).toBeUndefined();
    });

    it("still fires stale_weight_log when a day in the run is tracked-but-unlogged", () => {
      const db = freshDb();
      const userId = seedUser(db);
      db.prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (?, '2026-05-16', 80)",
      ).run(userId);
      createUntrackedPeriod(db, {
        user_id: userId,
        started_on: "2026-05-17",
        ended_on: "2026-05-20",
        reason: "vacation",
      });
      const r = computeDayStatus(db, userId, NOW);
      expect(r.nudges.find((n) => n.code === "stale_weight_log")).toBeDefined();
    });

    it("suppresses stale_sleep_log when the whole run is untracked", () => {
      const db = freshDb();
      const userId = seedUser(db);
      db.prepare(
        "INSERT INTO sleep_logs (user_id, slept_on, hours) VALUES (?, '2026-05-18', 8)",
      ).run(userId);
      createUntrackedPeriod(db, {
        user_id: userId,
        started_on: "2026-05-19",
        ended_on: "2026-05-21",
        reason: "vacation",
      });
      const r = computeDayStatus(db, userId, NOW);
      expect(r.nudges.find((n) => n.code === "stale_sleep_log")).toBeUndefined();
    });

    it("does NOT suppress no_workout_streak (out of scope)", () => {
      const db = freshDb();
      const userId = seedUser(db);
      db.prepare(
        "INSERT INTO workouts (user_id, started_at, rpe) VALUES (?, '2026-05-11T12:00:00Z', 7)",
      ).run(userId);
      createUntrackedPeriod(db, {
        user_id: userId,
        started_on: "2026-05-12",
        ended_on: "2026-05-21",
        reason: "deload",
      });
      const r = computeDayStatus(db, userId, NOW);
      expect(r.nudges.find((n) => n.code === "no_workout_streak")).toBeDefined();
    });
  });
});
