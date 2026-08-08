import { describe, expect, it } from "vitest";
import { createAlcoholSession } from "../repos/alcohol.repo.js";
import { createBodyWeight } from "../repos/body-weights.repo.js";
import { createCardioSession } from "../repos/cardio.repo.js";
import { createGroup } from "../repos/exercise-groups.repo.js";
import { createExercise } from "../repos/exercises.repo.js";
import { createMeal } from "../repos/meals.repo.js";
import { closeAndStartPhase, type StartPhaseInput } from "../repos/nutrition-phases.repo.js";
import { createSleepLog } from "../repos/sleep.repo.js";
import { createOrUpdateStepLog, updateStepLog } from "../repos/step-logs.repo.js";
import { createUntrackedPeriod } from "../repos/untracked-periods.repo.js";
import { updateUser } from "../repos/users.repo.js";
import { createTemplate } from "../repos/workout-templates.repo.js";
import { createWorkout } from "../repos/workouts.repo.js";
import { freshDb, seedUser } from "../test-support/db.js";
import { defined } from "../test-support/index.js";
import { computeDayStatus } from "./day-status.js";
import { getTodayContext } from "./today.js";

/**
 * Defaults for the TDEE-refactor phase fields that every test phase needs.
 * Tests can spread + override (e.g. to set planned_end_on) without restating
 * the boilerplate. Mirrors the production "starting a cut at TDEE 2400 with a
 * 500-kcal deficit" shape, giving per-day numbers of a 1900 kcal target against
 * 2400 maintenance.
 */
const DEFAULT_PHASE: Omit<StartPhaseInput, "user_id" | "started_on" | "name"> = {
  intent: "cut",
  phase_type: "cut",
  tdee_at_phase_start: 2400,
  tdee_source: "user_asserted",
  deficit_kcal: -500,
  daily_kcal_target: 1900,
  base_protein_g: 180,
  base_carb_g: 170,
  base_fat_g: 60,
};

function startCutPhase(
  db: ReturnType<typeof freshDb>,
  overrides: Partial<StartPhaseInput> & { user_id: number; started_on: string },
) {
  return closeAndStartPhase(db, {
    ...DEFAULT_PHASE,
    name: "1900 cut",
    ...overrides,
  });
}

describe("getTodayContext", () => {
  describe("active phase", () => {
    it("composes a coherent today payload", () => {
      const db = freshDb();
      const userId = seedUser(db);
      const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
      const push = createExercise(db, {
        user_id: userId,
        group_id: chest.id,
        name: "Push-up",
      });
      createTemplate(db, {
        user_id: userId,
        name: "PUSH",
        items: [{ exercise_id: push.id, display_order: 1, default_sets: 3, default_reps: 12 }],
      });
      startCutPhase(db, { user_id: userId, started_on: "2026-05-01" });
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-08T18:00:00Z",
        rpe: 8,
        exercises: [
          {
            exercise_id: push.id,
            display_order: 1,
            planned_sets: 3,
            sets: [
              { reps: 12, weight_kg: null },
              { reps: 12, weight_kg: null },
              { reps: 12, weight_kg: null },
            ],
          },
        ],
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.user.id).toBe(userId);
      expect(ctx.phase?.name).toBe("1900 cut");
      expect(ctx.stim_states.length).toBe(1);
      expect(ctx.stim_states[0]?.group_name).toBe("Chest");
      expect(ctx.tdee.basis).toBe("profile_baseline"); // not enough weight data
      expect(ctx.tdee.confidence).toBe("early");
    });

    it("user.preferred_unit_system flows through from the users row", () => {
      // Default seedUser fixture leaves preferred_unit_system at the column
      // default ("metric"). Surface it on TodayContext so a future web client
      // can honor it without an extra fetch.
      const { db, userId } = setupTzScenario("America/Toronto");
      const ctxDefault = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctxDefault.user.preferred_unit_system).toBe("metric");

      // Flip the user preference and confirm it round-trips.
      updateUser(db, userId, { preferred_unit_system: "imperial" });
      const ctxImperial = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctxImperial.user.preferred_unit_system).toBe("imperial");
    });

    it("today.target/maintenance/observed populate from the active phase", () => {
      // Sanity check that the promoted-to-top-level target/maintenance/observed
      // fields wire through computeDailyTarget correctly. With the default cut
      // fixture (daily_kcal_target=1900, tdee_at_phase_start=2400) and a single
      // 800 kcal meal logged today, observed.vs_target should be negative
      // (intake under target), observed.status "on_track" (under target on a
      // cut = on track), maintenance.kcal echoes tdee_at_phase_start.
      const { db, userId } = setupTzScenario("America/Toronto");
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-12T16:00:00Z",
        kcal: 800,
        protein_g: 70,
        carb_g: 90,
        fat_g: 25,
      });
      const ctx = getTodayContext(db, userId, new Date("2026-05-12T20:00:00Z"));
      expect(ctx.today.target).toEqual({ kcal: 1900, protein_g: 180, carb_g: 170, fat_g: 60 });
      expect(ctx.today.maintenance).toEqual({ kcal: 2400 });
      expect(ctx.today.intake.kcal).toBe(800);
      expect(ctx.today.observed?.status).toBe("on_track");
      expect(ctx.today.observed?.vs_target).toBe(800 - 1900);
      expect(ctx.today.observed?.vs_maintenance).toBe(800 - 2400);
    });

    it("excludes today's in-progress intake from the displayed TDEE (no intraday drift)", () => {
      // The displayed Current TDEE must end its back-calc window on the last
      // COMPLETED day (asOf = today − 1), so a half-logged "today" can't drag it
      // intraday. To make the bug observable the basis must be measured_intake:
      // seed a full back-calc window of daily weigh-ins (>= 14) and daily meals
      // (>= the meal-days floor) on every day INCLUDING today.
      const { db, userId } = setupTzScenario("America/Toronto");
      const now = new Date("2026-05-13T18:00:00Z"); // ~2pm ET on the 13th

      // 24 days of weigh-ins + a steady ~2000 kcal/day of meals, every day from
      // 2026-04-20 through today (2026-05-13). Enough weight data for the
      // back-calc and enough meal-days that measured_intake engages.
      for (let i = 0; i < 24; i++) {
        const d = new Date("2026-04-20T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + i);
        const day = d.toISOString().slice(0, 10);
        createBodyWeight(db, { user_id: userId, measured_on: day, weight_kg: 80 });
        createMeal(db, {
          user_id: userId,
          eaten_at: `${day}T16:00:00Z`, // noon ET — lands on `day`
          kcal: 2000,
          protein_g: 150,
          carb_g: 200,
          fat_g: 60,
        });
      }

      // Baseline TDEE before any FURTHER meal is logged today.
      const before = getTodayContext(db, userId, now);
      expect(before.tdee.basis).toBe("measured_intake"); // bug only shows here
      const tdeeBefore = before.tdee.kcal;
      const intakeBefore = before.today.intake.kcal;

      // Log a large EXTRA meal dated TODAY.
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-13T17:00:00Z", // 1pm ET on the 13th — today
        kcal: 1500,
        protein_g: 100,
        carb_g: 150,
        fat_g: 50,
      });

      const after = getTodayContext(db, userId, now);

      // Same-day running intake DID move (proves the meal landed today).
      expect(after.today.intake.kcal).toBe(intakeBefore + 1500);
      // ...but the displayed TDEE did NOT — today is excluded from its window.
      expect(after.tdee.kcal).toBe(tdeeBefore);
    });

    /**
     * Bundles the minimum scaffolding getTodayContext needs (user + active
     * nutrition phase + one exercise group/exercise). Returns the userId and
     * exercise id callers might want to log workouts against.
     */
    function setupTzScenario(tz: string): {
      db: ReturnType<typeof freshDb>;
      userId: number;
      pushExerciseId: number;
    } {
      const db = freshDb();
      const userId = seedUser(db);
      updateUser(db, userId, { timezone: tz });
      const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
      const push = createExercise(db, {
        user_id: userId,
        group_id: chest.id,
        name: "Push-up",
      });
      startCutPhase(db, { user_id: userId, started_on: "2026-05-01" });
      return { db, userId, pushExerciseId: push.id };
    }

    it("today_date applies the 4am rollover and matches get_day_status.date", () => {
      // 03:00 ET on 2026-06-03 = 2026-06-03T07:00:00Z (EDT, UTC-4). Before the
      // 4am DAY_START_HOUR rollover, so the user-day is still 2026-06-02 even
      // though `now`'s date portion reads 2026-06-03. The surfaced today_date
      // must be the rolled-over day, and must equal what get_day_status reports.
      const { db, userId } = setupTzScenario("America/Toronto");
      const now = new Date("2026-06-03T07:00:00Z");

      const ctx = getTodayContext(db, userId, now);
      expect(ctx.now.slice(0, 10)).toBe("2026-06-03"); // raw instant's date
      expect(ctx.today_date).toBe("2026-06-02"); // rolled-over user-day

      // The two tools must not disagree on what "today" is.
      const status = computeDayStatus(db, userId, now);
      expect(ctx.today_date).toBe(status.date);
    });

    it("a workout at 22:00 ET yesterday is excluded from today.workouts", () => {
      // 22:00 ET on 2026-05-12 = 2026-05-13T02:00:00Z (during EDT, UTC-4).
      // Asking for "today" at 2026-05-13T14:00:00Z (10:00 ET on 2026-05-13).
      // The workout's user-day is 2026-05-12, so it must NOT appear in today's
      // workouts.
      const { db, userId, pushExerciseId } = setupTzScenario("America/Toronto");
      const w = createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-13T02:00:00Z",
        rpe: 8,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: null }],
          },
        ],
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-13T14:00:00Z"));
      expect(ctx.user.timezone).toBe("America/Toronto");
      expect(ctx.today.workouts.find((x) => x.id === w.id)).toBeUndefined();
    });

    it("a 02:00 ET drink on a calendar day buckets to the previous user-day", () => {
      // 02:00 ET on 2026-05-13 = 2026-05-13T06:00:00Z. DAY_START_HOUR=4 means
      // 02:00 local is still part of user-day 2026-05-12. Asking "today" at
      // 2026-05-13T14:00:00Z (10:00 ET on the 13th), this drink must NOT appear
      // in today.alcohol.
      const { db, userId } = setupTzScenario("America/Toronto");
      const r = db
        .prepare(
          `INSERT INTO alcohol_sessions (user_id, started_at, drinks_count, est_kcal)
           VALUES (?, ?, ?, ?) RETURNING id`,
        )
        .get(userId, "2026-05-13T06:00:00Z", 2, 200) as { id: number };

      const ctx = getTodayContext(db, userId, new Date("2026-05-13T14:00:00Z"));
      expect(ctx.today.alcohol.find((a) => a.id === r.id)).toBeUndefined();
    });

    it("an evening workout in EDT correctly appears in today's workouts when we are still on the same user-day", () => {
      // 19:00 ET on 2026-05-13 = 2026-05-13T23:00:00Z. Asking "today" at
      // 2026-05-13T23:30:00Z (= 19:30 ET) — same user-day 2026-05-13. Workout
      // SHOULD appear in today.workouts.
      const { db, userId, pushExerciseId } = setupTzScenario("America/Toronto");
      const w = createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-13T23:00:00Z",
        rpe: 8,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: null }],
          },
        ],
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-13T23:30:00Z"));
      expect(ctx.today.workouts.find((x) => x.id === w.id)).toBeDefined();
    });

    it("today.kcal_in counts a 21:00 ET meal that landed on the next UTC date", () => {
      // 21:00 ET on 2026-05-13 = 2026-05-14T01:00:00Z (EDT, UTC-4). User-day is
      // still 2026-05-13. Asking "today" at 2026-05-14T02:00:00Z (= 22:00 ET on
      // the 13th). The meal MUST be summed into today.kcal_in / protein_g_in /
      // carb_g_in / fat_g_in — a UTC-slice filter would drop it, because
      // "2026-05-14".slice(0,10) !== "2026-05-13".
      const { db, userId } = setupTzScenario("America/Toronto");
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-14T01:00:00Z",
        kcal: 650,
        protein_g: 45,
        carb_g: 60,
        fat_g: 25,
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-14T02:00:00Z"));
      expect(ctx.today.kcal_in).toBe(650);
      expect(ctx.today.protein_g_in).toBe(45);
      expect(ctx.today.carb_g_in).toBe(60);
      expect(ctx.today.fat_g_in).toBe(25);
    });

    it("today.carb_g_in and today.fat_g_in sum across multiple meals in the user-day window", () => {
      // Spec §5.1 calls for protein/carb/fat-in totals on /v1/signals/today.
      // Two meals on the same user-day must sum to the total carb/fat just like
      // kcal_in and protein_g_in. Different meal magnitudes so a swapped column
      // would surface as a wrong total.
      const { db, userId } = setupTzScenario("America/Toronto");
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-13T16:00:00Z", // 12:00 ET on 2026-05-13
        kcal: 500,
        protein_g: 30,
        carb_g: 55,
        fat_g: 18,
      });
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-13T22:00:00Z", // 18:00 ET on 2026-05-13
        kcal: 700,
        protein_g: 40,
        carb_g: 65,
        fat_g: 22,
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-13T23:00:00Z"));
      expect(ctx.today.kcal_in).toBe(1200);
      expect(ctx.today.protein_g_in).toBe(70);
      expect(ctx.today.carb_g_in).toBe(120);
      expect(ctx.today.fat_g_in).toBe(40);
    });

    it("today.observed.workout_kcal counts a 21:00 ET workout that landed on the next UTC date", () => {
      // Replaces the old `today.effective_target.activity_kcal` assertion. Same
      // user-day boundary stress: a workout logged at 21:00 ET (= 01:00 UTC the
      // next day) MUST be summed into today's observed.workout_kcal when we
      // query "today" at 22:00 ET (= 02:00 UTC next day). User-day is
      // 2026-05-13.
      const { db, userId, pushExerciseId } = setupTzScenario("America/Toronto");
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-14T01:00:00Z",
        rpe: 8,
        est_kcal: 300,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: null }],
          },
        ],
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-14T02:00:00Z"));
      expect(ctx.today.observed?.workout_kcal).toBe(300);
      expect(ctx.today.observed?.cardio_kcal).toBe(0);
      // target.kcal is the STATIC phase target — does NOT shift with today's
      // activity, unlike the old `effective_kcal` which added activity in.
      expect(ctx.today.target?.kcal).toBe(1900);
    });

    it("attributes an evening meal to its user-local day in week_to_date avg", () => {
      // America/New_York user. now = 2026-06-05T22:00:00Z (18:00 ET) → WTD
      // window May30..Jun5. Untracked period covers user-local 2026-05-30..05-31.
      const { db, userId } = setupTzScenario("America/New_York");
      createUntrackedPeriod(db, {
        user_id: userId,
        started_on: "2026-05-30",
        ended_on: "2026-05-31",
        reason: "vacation",
      });
      // Evening meal: 2026-06-01T01:00:00Z = 21:00 ET on user-local 2026-05-31
      // (inside the untracked period → must be excluded from the "usual" avg).
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-06-01T01:00:00Z",
        kcal: 300,
        protein_g: 10,
        carb_g: 40,
        fat_g: 8,
      });
      // Two tracked midday meals on user-local Jun 3 & Jun 4.
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-06-03T16:00:00Z",
        kcal: 2000,
        protein_g: 150,
        carb_g: 200,
        fat_g: 60,
      });
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-06-04T16:00:00Z",
        kcal: 2000,
        protein_g: 150,
        carb_g: 200,
        fat_g: 60,
      });

      const ctx = getTodayContext(db, userId, new Date("2026-06-05T22:00:00Z"));
      // CORRECT: evening meal belongs to user-local 2026-05-31 (untracked) →
      // excluded. Only Jun 3 & 4 count → 2000 over 2 days.
      // BUG: date(eaten_at)=2026-06-01 (UTC) escapes the user-local untracked
      // set → leaks in → 1433/3.
      expect(ctx.week_to_date.avg_kcal_in).toEqual({
        value: 2000,
        window_days: 7,
        days_with_data: 2,
      });
    });

    it("excludes the in-progress day from week-to-date avg intake (partial today doesn't drag it)", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      const now = new Date("2026-05-13T18:00:00Z"); // ~2pm ET on the 13th

      // 7 COMPLETE prior days of meals at 2000 kcal each (2026-05-06 .. 2026-05-12).
      for (const day of [
        "2026-05-06",
        "2026-05-07",
        "2026-05-08",
        "2026-05-09",
        "2026-05-10",
        "2026-05-11",
        "2026-05-12",
      ]) {
        createMeal(db, {
          user_id: userId,
          eaten_at: `${day}T16:00:00Z`, // noon ET — unambiguously that user-day
          kcal: 2000,
          protein_g: 150,
          carb_g: 200,
          fat_g: 60,
        });
      }

      const before = getTodayContext(db, userId, now);
      // Non-vacuous guard: 7 complete days at 2000 → avg 2000 (today not in window).
      expect(before.week_to_date.avg_kcal_in.value).toBe(2000);

      // Small partial meal dated TODAY (2026-05-13).
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-13T17:00:00Z",
        kcal: 300,
        protein_g: 20,
        carb_g: 30,
        fat_g: 10,
      });

      const after = getTodayContext(db, userId, now);
      expect(after.today.intake.kcal).toBe(300); // today's running total moved
      expect(after.week_to_date.avg_kcal_in.value).toBe(2000); // ...but the 7-day avg did NOT
    });

    it("a skipped exercise_instance does not refresh last_hit_at or contribute to stim volume", () => {
      // Regression for code-review C1: skipped rows are persisted with
      // skipped_at set so adherence/audit can see them, but they're NOT training
      // and must NOT make stim.ts treat the workout as a "hit" for the group.
      //
      // Setup: yesterday's workout has ONE Chest exercise, which the user
      // skipped (sets=[], skipped_at set). No earlier workouts. The expected
      // behaviour is that Chest's last_hit_at stays null (no real session ever)
      // and no contributing session is recorded for the group.
      const db = freshDb();
      const userId = seedUser(db);
      const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
      const push = createExercise(db, {
        user_id: userId,
        group_id: chest.id,
        name: "Push-up",
      });
      startCutPhase(db, { user_id: userId, started_on: "2026-05-01" });
      // Yesterday, started_at = 2026-05-11T18:00 → skipped via deviation,
      // which persists sets=[] and skipped_at = started_at.
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-11T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: push.id,
            display_order: 1,
            planned_sets: 3,
            sets: [],
            skipped_at: "2026-05-11T18:00:00Z",
          },
        ],
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      const chestState = ctx.stim_states.find((s) => s.group_name === "Chest");
      expect(chestState).toBeDefined();
      // Critical: skip must NOT count as a hit. With no real sessions ever,
      // last_hit_at falls back to null.
      expect(chestState?.last_hit_at).toBeNull();
      expect(chestState?.contributing_sessions).toEqual([]);
    });

    it("trend_weight.weight_change reports an early-confidence delta with as few as 2 readings", () => {
      // Two readings 3 days apart → meaningful delta, but the window is far
      // short of 30 days, so the confidence tag must be `early`. This is the
      // Gap 11 fix: don't return null just because the window isn't full.
      const { db, userId } = setupTzScenario("America/Toronto");
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-09", weight_kg: 80 });
      createBodyWeight(db, {
        user_id: userId,
        measured_on: "2026-05-12",
        weight_kg: 79.7,
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.trend_weight.weight_change).toEqual({
        value_kg: -0.3,
        over_days: 3,
        confidence: "early",
      });
    });

    it("trend_weight.current_kg is rounded to 2dp, not surfaced as a raw EMA float", () => {
      // Several readings drive the EMA to a many-decimal value. Without rounding
      // at the surface, current_kg leaks full float noise (e.g. ...41836737017).
      const { db, userId } = setupTzScenario("America/Toronto");
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-08", weight_kg: 77.3 });
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-09", weight_kg: 76.9 });
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-10", weight_kg: 77.1 });
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-11", weight_kg: 76.7 });
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-12", weight_kg: 76.8 });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      const current = ctx.trend_weight.current_kg;
      expect(current).not.toBeNull();
      // At most 2 decimal places.
      expect(current).toBe(Number(defined(current, "current").toFixed(2)));
    });

    it("trend_weight.as_of is the date of the last real weigh-in, not today", () => {
      // Last actual reading is 07-25; context is generated on 08-07, so the
      // EWMA has been carrying forward for 13 days. as_of must still read
      // 07-25 — the date the trend value reflects, not "today".
      const { db, userId } = setupTzScenario("America/Toronto");
      createBodyWeight(db, { user_id: userId, measured_on: "2026-07-20", weight_kg: 80 });
      createBodyWeight(db, { user_id: userId, measured_on: "2026-07-25", weight_kg: 79.5 });

      const ctx = getTodayContext(db, userId, new Date("2026-08-07T18:00:00Z"));
      expect(ctx.trend_weight.as_of).toBe("2026-07-25");
      expect(ctx.trend_weight.current_kg).not.toBeNull();
    });

    it("trend_weight.current_kg and as_of are both null when no weights exist", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.trend_weight.current_kg).toBeNull();
      expect(ctx.trend_weight.as_of).toBeNull();
    });

    it("today.most_recent_weight returns the latest reading even when no reading today (Gap 21)", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-12", weight_kg: 71.2 });

      // Asking on 2026-05-14 — no weight logged today, but yesterday's value is
      // available. body_weight_kg stays null (preserves "did the user weigh
      // today" signal); most_recent_weight provides the fallback.
      const ctx = getTodayContext(db, userId, new Date("2026-05-14T18:00:00Z"));
      expect(ctx.today.body_weight_kg).toBeNull();
      expect(ctx.today.most_recent_weight).toEqual({
        value_kg: 71.2,
        on_date: "2026-05-12",
      });
    });

    it("today.most_recent_weight is null when no readings exist (Gap 21)", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      const ctx = getTodayContext(db, userId, new Date("2026-05-14T18:00:00Z"));
      expect(ctx.today.body_weight_kg).toBeNull();
      expect(ctx.today.most_recent_weight).toBeNull();
    });

    it("today.most_recent_weight echoes today's reading when one exists (Gap 21)", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-14", weight_kg: 71.5 });
      const ctx = getTodayContext(db, userId, new Date("2026-05-14T18:00:00Z"));
      expect(ctx.today.body_weight_kg).toBe(71.5);
      expect(ctx.today.most_recent_weight).toEqual({
        value_kg: 71.5,
        on_date: "2026-05-14",
      });
    });

    it("today.energy_balance composes food/alcohol/TDEE/activity without double-counting", () => {
      // The key correctness property: net is total_in − tdee_baseline ONLY.
      // It does NOT also subtract today's cardio/workout — TDEE already
      // encompasses average activity via the energy-balance back-calc, so
      // adding today's activity a second time would double-count.
      const { db, userId } = setupTzScenario("America/Toronto");
      // Food: 1500 kcal across two meals in the user-day window.
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-13T16:00:00Z",
        kcal: 900,
        protein_g: 60,
        carb_g: 80,
        fat_g: 25,
      });
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-13T22:00:00Z",
        kcal: 600,
        protein_g: 40,
        carb_g: 50,
        fat_g: 18,
      });
      // Alcohol: 200 kcal (a beer or two).
      createAlcoholSession(db, {
        user_id: userId,
        started_at: "2026-05-14T01:30:00Z", // 21:30 ET 2026-05-13
        drinks_count: 2,
        est_kcal: 200,
      });
      // Cardio: 250 kcal.
      createCardioSession(db, {
        user_id: userId,
        started_at: "2026-05-13T20:00:00Z",
        modality: "run",
        duration_min: 30,
        est_kcal: 250,
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-14T02:00:00Z"));
      const eb = ctx.today.energy_balance;

      expect(eb.food_in).toBe(1500); // meals only
      expect(eb.alcohol_in).toBe(200); // alcohol only
      expect(eb.total_in).toBe(1700); // food + alcohol
      expect(eb.cardio_out).toBe(250);
      expect(eb.workout_out).toBe(0); // no workouts today
      // tdee_baseline echoes the trailing TDEE estimate (whatever computeTDEE
      // returned for this fixture); assert it matches the same `tdee.kcal` so
      // the two views can never disagree.
      expect(eb.tdee_baseline).toBe(ctx.tdee.kcal);
      // net = total_in − tdee_baseline. NOT total_in − tdee − cardio − workout
      //                                  − steps.
      expect(eb.net).toBe(1700 - ctx.tdee.kcal);
    });

    it("today.steps is null when no step log exists for the user-day", () => {
      // Distinguishes "didn't log steps today" from an explicit zero — same
      // rule meals_logged_today applies. energy_balance.steps_out is null (no
      // step log, not a zero burn), and the net is computed exactly as if
      // steps were absent (it never subtracts steps_out anyway).
      const { db, userId } = setupTzScenario("America/Toronto");
      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.today.steps).toBeNull();
      expect(ctx.today.energy_balance.steps_out).toBeNull();
      // net is unchanged by steps_out — confirms the display-only rule.
      expect(ctx.today.energy_balance.net).toBe(
        ctx.today.energy_balance.total_in - ctx.today.energy_balance.tdee_baseline,
      );
    });

    it("observed.steps_kcal is null when no step log exists for the user-day", () => {
      // Same fixture shape as the today.steps null test above.
      const { db, userId } = setupTzScenario("America/Toronto");
      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.today.observed?.steps_kcal).toBeNull();
    });

    it("energy_balance.steps_out is null when no step log exists", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.today.energy_balance.steps_out).toBeNull();
    });

    it("today.steps and energy_balance.steps_out populate from step_logs", () => {
      // Seed an explicit (steps, est_kcal) so the assertion doesn't depend on
      // body-weight-derived estimation. observed.steps_kcal flows through the
      // computeDailyTarget call site, so it should also reflect the seeded
      // est_kcal — proves the wiring from repo → today.ts → daily-target.
      const { db, userId } = setupTzScenario("America/Toronto");
      createOrUpdateStepLog(db, {
        user_id: userId,
        on_date: "2026-05-12",
        steps: 8000,
        est_kcal: 320,
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.today.steps).toEqual({ id: 1, count: 8000, est_kcal: 320 });
      expect(ctx.today.energy_balance.steps_out).toBe(320);
      expect(ctx.today.observed?.steps_kcal).toBe(320);
    });

    it("today.steps.est_kcal stays null when the estimate is cleared, without un-logging the day", () => {
      // A logged day (steps: 8000) whose est_kcal was explicitly cleared via
      // update (PATCH { est_kcal: null }) must still report the row — count
      // present, est_kcal null — not collapse to est_kcal: 0, which would read
      // as "logged, burned nothing" instead of "no estimate available".
      const { db, userId } = setupTzScenario("America/Toronto");
      const row = createOrUpdateStepLog(db, {
        user_id: userId,
        on_date: "2026-05-12",
        steps: 8000,
        est_kcal: 320,
      });
      updateStepLog(db, userId, row.id, { est_kcal: null });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.today.steps).toEqual({ id: row.id, count: 8000, est_kcal: null });
    });

    it("a stored row is distinguished from absence regardless of its steps value", () => {
      // The repo layer isn't the validation boundary — StepLogInputSchema
      // rejects steps: 0 above the repo, but a row written directly still
      // surfaces as a logged day (today.steps non-null), never collapsing to
      // the same shape as "didn't log" (null).
      const { db, userId } = setupTzScenario("America/Toronto");
      createOrUpdateStepLog(db, {
        user_id: userId,
        on_date: "2026-05-12",
        steps: 0,
        est_kcal: 0,
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.today.steps).toEqual({ id: 1, count: 0, est_kcal: 0 });
      expect(ctx.today.energy_balance.steps_out).toBe(0);
    });

    it("trend_weight.weight_change is null when there are fewer than 2 readings", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-12", weight_kg: 80 });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.trend_weight.weight_change).toBeNull();
    });

    it("week_to_date reports alcohol aggregates (Gap 19)", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      // Two drinking events on two distinct days inside WTD window.
      db.prepare(
        `INSERT INTO alcohol_sessions (user_id, started_at, drinks_count, est_kcal)
         VALUES (?, ?, ?, ?)`,
      ).run(userId, "2026-05-09T22:00:00Z", 3, 350);
      db.prepare(
        `INSERT INTO alcohol_sessions (user_id, started_at, drinks_count, est_kcal)
         VALUES (?, ?, ?, ?)`,
      ).run(userId, "2026-05-11T22:00:00Z", 2, 200);

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.week_to_date.alcohol_drinks_count).toEqual({
        value: 5,
        window_days: 7,
        days_with_data: 2,
      });
      expect(ctx.week_to_date.alcohol_kcal).toEqual({
        value: 550,
        window_days: 7,
        days_with_data: 2,
      });
      expect(ctx.week_to_date.drinking_days_count).toEqual({
        value: 2,
        window_days: 7,
        days_with_data: 2,
      });
    });

    it("week_to_date reports cardio aggregates (Gap 19)", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      // Two cardio sessions on two distinct days inside the WTD window.
      db.prepare(
        `INSERT INTO cardio_sessions (user_id, started_at, duration_min, est_kcal)
         VALUES (?, ?, ?, ?)`,
      ).run(userId, "2026-05-09T17:00:00Z", 45, 380);
      db.prepare(
        `INSERT INTO cardio_sessions (user_id, started_at, duration_min, est_kcal)
         VALUES (?, ?, ?, ?)`,
      ).run(userId, "2026-05-11T17:00:00Z", 30, 250);

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.week_to_date.cardio_sessions_count).toEqual({
        value: 2,
        window_days: 7,
        days_with_data: 2,
      });
      expect(ctx.week_to_date.cardio_minutes).toEqual({
        value: 75,
        window_days: 7,
        days_with_data: 2,
      });
      expect(ctx.week_to_date.cardio_kcal).toEqual({
        value: 630,
        window_days: 7,
        days_with_data: 2,
      });
    });

    it("week_to_date reports meal + workout aggregates with windowing metadata", () => {
      // Two meal-days inside a 7-day window; one workout. Aggregate wrappers
      // expose the value alongside window_days (7) and days_with_data (per-field
      // denominator), so two aggregators using the same name can't silently
      // disagree about which days they counted.
      const { db, userId, pushExerciseId } = setupTzScenario("America/Toronto");
      // Meals on two distinct calendar days inside the WTD window.
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-09T13:00:00Z",
        kcal: 800,
        protein_g: 60,
        carb_g: 80,
        fat_g: 25,
      });
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-11T13:00:00Z",
        kcal: 600,
        protein_g: 40,
        carb_g: 70,
        fat_g: 20,
      });
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-10T18:00:00Z",
        rpe: 8,
        exercises: [
          {
            exercise_id: pushExerciseId,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: null }],
          },
        ],
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      expect(ctx.week_to_date.avg_kcal_in).toEqual({
        value: 700, // (800 + 600) / 2 = 700
        window_days: 7,
        days_with_data: 2,
      });
      expect(ctx.week_to_date.avg_protein_g).toEqual({
        value: 50, // (60 + 40) / 2 = 50
        window_days: 7,
        days_with_data: 2,
      });
      expect(ctx.week_to_date.workouts_count).toEqual({
        value: 1,
        window_days: 7,
        days_with_data: 1,
      });
      // No sleep logged → zero-data wrapper, not null.
      expect(ctx.week_to_date.sleep_avg_hours).toEqual({
        value: 0,
        window_days: 7,
        days_with_data: 0,
      });
    });

    it("excludes untracked (vacation) days from the week meal + sleep averages", () => {
      // Window for today=2026-05-12 is 2026-05-06..05-12. Two tracked meal
      // days (05-09, 05-10) plus a lightly-logged vacation day (05-11). The
      // vacation day must not drag the per-day average down.
      const { db, userId } = setupTzScenario("America/Toronto");
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-09T13:00:00Z",
        kcal: 2000,
        protein_g: 150,
        carb_g: 200,
        fat_g: 60,
      });
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-10T13:00:00Z",
        kcal: 2000,
        protein_g: 150,
        carb_g: 200,
        fat_g: 60,
      });
      // Vacation day: light meal + a short night, both should be excluded.
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-11T13:00:00Z",
        kcal: 200,
        protein_g: 10,
        carb_g: 30,
        fat_g: 5,
      });
      createSleepLog(db, { user_id: userId, slept_on: "2026-05-09", hours: 8, quality: 4 });
      createSleepLog(db, { user_id: userId, slept_on: "2026-05-11", hours: 4, quality: 2 });
      createUntrackedPeriod(db, {
        user_id: userId,
        started_on: "2026-05-11",
        ended_on: "2026-05-11",
        reason: "vacation",
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-12T18:00:00Z"));
      // Meal average over the 2 tracked days only (05-11 excluded): 2000.
      expect(ctx.week_to_date.avg_kcal_in).toEqual({
        value: 2000,
        window_days: 7,
        days_with_data: 2,
      });
      expect(ctx.week_to_date.avg_protein_g).toEqual({
        value: 150,
        window_days: 7,
        days_with_data: 2,
      });
      // Sleep average over the single tracked night (05-09, 8h); 05-11 excluded.
      expect(ctx.week_to_date.sleep_avg_hours).toEqual({
        value: 8,
        window_days: 7,
        days_with_data: 1,
      });
    });

    it("phase.days_in counts user-local days since started_on (Gap 28)", () => {
      // Phase fixture started 2026-05-01 (set up by setupTzScenario).
      // Asking "today" at 2026-05-14T18:00:00Z → user-local date 2026-05-14
      // (in EDT). days_in = (2026-05-14 minus 2026-05-01) = 13.
      const { db, userId } = setupTzScenario("America/Toronto");
      const ctx = getTodayContext(db, userId, new Date("2026-05-14T18:00:00Z"));
      expect(ctx.phase?.days_in).toBe(13);
      // No planned_end_on set in the fixture → null.
      expect(ctx.phase?.days_remaining).toBeNull();
    });

    it("phase.days_remaining counts user-local days to planned_end_on (Gaps 25, 28)", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      // Replace the seeded phase with one that has planned_end_on.
      startCutPhase(db, {
        user_id: userId,
        name: "cut",
        started_on: "2026-05-01",
        planned_end_on: "2026-07-01",
      });
      const ctx = getTodayContext(db, userId, new Date("2026-05-14T18:00:00Z"));
      expect(ctx.phase?.days_in).toBe(13);
      expect(ctx.phase?.days_remaining).toBe(48); // 2026-05-14 to 2026-07-01
    });

    it("phase.days_remaining is negative when today is past planned_end_on (overrun)", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      startCutPhase(db, {
        user_id: userId,
        name: "cut",
        started_on: "2026-05-01",
        planned_end_on: "2026-05-10",
      });
      const ctx = getTodayContext(db, userId, new Date("2026-05-14T18:00:00Z"));
      expect(ctx.phase?.days_remaining).toBe(-4);
    });

    it("a meal at exactly endUtc belongs to the next user-day, not today", () => {
      // The user-day window is half-open: [startUtc, endUtc). A meal logged at
      // the exact endUtc instant belongs to the NEXT user-day, not today. For
      // America/Toronto on 2026-05-13, endUtc = 2026-05-14T08:00:00Z (next day
      // 04:00 ET, the DAY_START_HOUR boundary).
      const { db, userId } = setupTzScenario("America/Toronto");
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-14T08:00:00Z",
        kcal: 500,
        protein_g: 30,
        carb_g: 50,
        fat_g: 20,
      });

      // Ask for "today" just before the boundary so we're still on user-day
      // 2026-05-13 (= 03:59 ET on the 14th).
      const ctx = getTodayContext(db, userId, new Date("2026-05-14T07:59:00Z"));
      expect(ctx.today.kcal_in).toBe(0);
      expect(ctx.today.protein_g_in).toBe(0);
      expect(ctx.today.carb_g_in).toBe(0);
      expect(ctx.today.fat_g_in).toBe(0);
    });

    it("today.meals_logged_today is true when at least one meal exists for the user-day", () => {
      const { db, userId } = setupTzScenario("America/Toronto");
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-12T16:00:00Z",
        kcal: 500,
        protein_g: 30,
        carb_g: 50,
        fat_g: 20,
      });
      const ctx = getTodayContext(db, userId, new Date("2026-05-12T20:00:00Z"));
      expect(ctx.today.meals_logged_today).toBe(true);
    });

    it("today.meals_logged_today is false when no meals exist for the user-day", () => {
      // Distinguishes "ate zero kcal" from "didn't log anything" for the
      // MCP summary tools (get_macros_today, get_day_status) — without
      // the flag they would render "Today: 0 kcal in" verbatim and an LLM
      // would surface that as if the user actually fasted.
      const { db, userId } = setupTzScenario("America/Toronto");
      const ctx = getTodayContext(db, userId, new Date("2026-05-12T20:00:00Z"));
      expect(ctx.today.meals_logged_today).toBe(false);
      // Sanity: zero meals means zero kcal_in (no alcohol logged here either).
      expect(ctx.today.kcal_in).toBe(0);
    });
  });

  describe("empty states", () => {
    // Task 6 lets the dashboard load for users who haven't started a phase yet
    // (new signups) or haven't logged a body weight yet (incomplete profile).
    // Previously getTodayContext threw "no active nutrition phase" and the API
    // returned 500 — the empty-state UX was impossible.

    it("returns success with null phase fields when no active phase", () => {
      // Brand-new user: account exists, weight logged (so profile_complete
      // can be true), but no phase yet. Dashboard must load — phase/target/
      // maintenance/observed all null; intake and energy_balance still populate
      // from logged events.
      const db = freshDb();
      const userId = seedUser(db);
      createBodyWeight(db, { user_id: userId, measured_on: "2026-05-20", weight_kg: 80 });
      createMeal(db, {
        user_id: userId,
        eaten_at: "2026-05-20T16:00:00Z",
        kcal: 600,
        protein_g: 40,
        carb_g: 70,
        fat_g: 20,
      });

      const ctx = getTodayContext(db, userId, new Date("2026-05-20T20:00:00Z"));
      expect(ctx.phase).toBeNull();
      expect(ctx.today.target).toBeNull();
      expect(ctx.today.maintenance).toBeNull();
      expect(ctx.today.observed).toBeNull();
      // intake stays non-null even without a phase — meals are still tracked.
      expect(ctx.today.intake).not.toBeNull();
      expect(ctx.today.intake.kcal).toBe(600);
      expect(ctx.today.kcal_in).toBe(600);
      expect(ctx.profile_complete).toBe(true);
      // Phase-independent fields still resolve normally.
      expect(ctx.tdee).toBeDefined();
      expect(ctx.tdee.basis).toBe("profile_baseline");
      expect(ctx.today.energy_balance.total_in).toBe(600);
      expect(ctx.week_to_date).toBeDefined();
      expect(ctx.stim_states).toEqual([]);
    });

    it("returns success when user exists but has no logged body weight", () => {
      // The web UI uses profile_complete to render a "log your weight first"
      // banner. A user who hasn't logged any weight yet should NOT be
      // profile_complete — TDEE will still run via profile_baseline, but the
      // back-calc has nothing to calibrate against.
      const db = freshDb();
      const userId = seedUser(db);
      const ctx = getTodayContext(db, userId, new Date("2026-05-20T20:00:00Z"));
      expect(ctx.phase).toBeNull();
      expect(ctx.profile_complete).toBe(false);
    });

    // No-user state (userId not in DB) is handled at the route layer (404),
    // not inside getTodayContext — it still throws "user N not found" because
    // we have no shape to populate at all.
  });
});

describe("getTodayContext unexplained_gap", () => {
  // "now" fixed so "today" resolves to 2026-05-21 (after the 4am rollover).
  const NOW = new Date("2026-05-21T18:00:00Z");

  function seedWeights(db: ReturnType<typeof freshDb>, userId: number, upToDate: string) {
    let d = "2026-04-25";
    while (d <= upToDate) {
      db.prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (?, ?, 80)",
      ).run(userId, d);
      const nd = new Date(`${d}T00:00:00Z`);
      nd.setUTCDate(nd.getUTCDate() + 1);
      d = nd.toISOString().slice(0, 10);
    }
  }

  it("surfaces a current gap of >= threshold days with no logged data", () => {
    const db = freshDb();
    const userId = seedUser(db);
    seedWeights(db, userId, "2026-05-16");
    const ctx = getTodayContext(db, userId, NOW);
    expect(ctx.unexplained_gap).not.toBeNull();
    expect(ctx.unexplained_gap?.from).toBe("2026-05-17");
    expect(ctx.unexplained_gap?.to).toBe("2026-05-21");
    expect(ctx.unexplained_gap?.days).toBe(5);
  });

  it("is null when the trailing gap is below the threshold", () => {
    const db = freshDb();
    const userId = seedUser(db);
    seedWeights(db, userId, "2026-05-19");
    const ctx = getTodayContext(db, userId, NOW);
    expect(ctx.unexplained_gap).toBeNull();
  });

  it("is null when an untracked period already covers the gap", () => {
    const db = freshDb();
    const userId = seedUser(db);
    seedWeights(db, userId, "2026-05-16");
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-17",
      ended_on: "2026-05-21",
      reason: "vacation",
    });
    const ctx = getTodayContext(db, userId, NOW);
    expect(ctx.unexplained_gap).toBeNull();
  });

  it("is null when there is no current gap (data today)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    seedWeights(db, userId, "2026-05-21");
    const ctx = getTodayContext(db, userId, NOW);
    expect(ctx.unexplained_gap).toBeNull();
  });

  it("is null when a long gap is stale (does not end recently)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // A 9-day gap (05-10..05-18) sits in the middle, but data resumes
    // 05-19..05-21, so the gap does not reach today-1 and shouldn't surface.
    for (const d of ["2026-04-25", "2026-05-09", "2026-05-19", "2026-05-20", "2026-05-21"]) {
      db.prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (?, ?, 80)",
      ).run(userId, d);
    }
    const ctx = getTodayContext(db, userId, NOW);
    expect(ctx.unexplained_gap).toBeNull();
  });
});
