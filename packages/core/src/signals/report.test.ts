import { describe, expect, it } from "vitest";
import { createGroup } from "../repos/exercise-groups.repo.js";
import { createExercise } from "../repos/exercises.repo.js";
import { closeAndStartPhase, type StartPhaseInput } from "../repos/nutrition-phases.repo.js";
import { updateUser } from "../repos/users.repo.js";
import { createTemplate } from "../repos/workout-templates.repo.js";
import { createWorkout } from "../repos/workouts.repo.js";
import { ShareReportSchema } from "../schemas/report.js";
import { freshDb, seedUser } from "../test-support/db.js";
import { assembleReport } from "./report.js";

/**
 * Mirrors the today.test.ts cut-phase fixture so per-day targets resolve to a
 * "ready" state (all TDEE-refactor fields present).
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
  return closeAndStartPhase(db, { ...DEFAULT_PHASE, name: "1900 cut", ...overrides });
}

const NOW = new Date("2026-06-20T17:00:00Z");

/** Seeds a user (America/Toronto) + a Chest group/exercise + a PUSH template. */
function setupScenario(): {
  db: ReturnType<typeof freshDb>;
  userId: number;
  pushExerciseId: number;
  templateId: number;
} {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, { timezone: "America/Toronto" });
  const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
  const push = createExercise(db, { user_id: userId, group_id: chest.id, name: "Push-up" });
  const template = createTemplate(db, {
    user_id: userId,
    name: "PUSH",
    items: [{ exercise_id: push.id, display_order: 1, default_sets: 3, default_reps: 12 }],
  });
  return { db, userId, pushExerciseId: push.id, templateId: template.id };
}

function logWorkout(
  db: ReturnType<typeof freshDb>,
  userId: number,
  exerciseId: number,
  startedAt: string,
  templateId: number | null,
) {
  return createWorkout(db, {
    user_id: userId,
    started_at: startedAt,
    template_id: templateId ?? undefined,
    rpe: 8,
    exercises: [
      {
        exercise_id: exerciseId,
        display_order: 1,
        planned_sets: 1,
        sets: [{ reps: 10, weight_kg: null }],
      },
    ],
  });
}

describe("assembleReport", () => {
  it("returns a value the ShareReportSchema accepts", () => {
    const { db, userId } = setupScenario();
    startCutPhase(db, { user_id: userId, started_on: "2026-06-10" });
    const report = assembleReport(db, userId, NOW);
    const parsed = ShareReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
  });

  it("generated_for_date equals context.today_date", () => {
    const { db, userId } = setupScenario();
    startCutPhase(db, { user_id: userId, started_on: "2026-06-10" });
    const report = assembleReport(db, userId, NOW);
    expect(report.generated_for_date).toBe(report.context.today_date);
  });

  it("history_14d has <= 14 days, sorted oldest->newest, last == today_date", () => {
    const { db, userId } = setupScenario();
    startCutPhase(db, { user_id: userId, started_on: "2026-06-10" });
    const report = assembleReport(db, userId, NOW);
    expect(report.history_14d.length).toBeLessThanOrEqual(14);
    expect(report.history_14d.length).toBe(14);
    const dates = report.history_14d.map((d) => d.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
    expect(dates[dates.length - 1]).toBe(report.context.today_date);
  });

  it("with an active phase, window_label is 'phase' and window_from is started_on", () => {
    const { db, userId } = setupScenario();
    startCutPhase(db, { user_id: userId, started_on: "2026-06-12" });
    const report = assembleReport(db, userId, NOW);
    expect(report.workouts.window_label).toBe("phase");
    expect(report.workouts.window_from).toBe("2026-06-12");
  });

  it("with no active phase, window_label is 'last_14_days'", () => {
    const { db, userId } = setupScenario();
    const report = assembleReport(db, userId, NOW);
    expect(report.workouts.window_label).toBe("last_14_days");
  });

  it("by_template groups by template (null for ad-hoc), total counts the window, desc by count", () => {
    const { db, userId, pushExerciseId, templateId } = setupScenario();
    startCutPhase(db, { user_id: userId, started_on: "2026-06-10" });
    // Two PUSH workouts + one ad-hoc (null template) inside the window.
    logWorkout(db, userId, pushExerciseId, "2026-06-15T18:00:00Z", templateId);
    logWorkout(db, userId, pushExerciseId, "2026-06-17T18:00:00Z", templateId);
    logWorkout(db, userId, pushExerciseId, "2026-06-18T18:00:00Z", null);

    const report = assembleReport(db, userId, NOW);
    expect(report.workouts.total).toBe(3);
    // Sorted by count descending: PUSH (2) before ad-hoc null (1).
    expect(report.workouts.by_template).toEqual([
      { template_name: "PUSH", count: 2 },
      { template_name: null, count: 1 },
    ]);
  });

  it("sets per-day workout_name on the user-local day the workout was done", () => {
    const { db, userId, pushExerciseId, templateId } = setupScenario();
    startCutPhase(db, { user_id: userId, started_on: "2026-06-10" });
    // A PUSH workout on 2026-06-15 (noon UTC → same user-local day for Toronto).
    logWorkout(db, userId, pushExerciseId, "2026-06-15T16:00:00Z", templateId);
    const report = assembleReport(db, userId, NOW);
    const day15 = report.history_14d.find((d) => d.date === "2026-06-15");
    const day16 = report.history_14d.find((d) => d.date === "2026-06-16");
    expect(day15?.workout_name).toBe("PUSH");
    expect(day16?.workout_name).toBeNull(); // no workout that day
  });

  it("buckets an evening workout to the correct user-local day (not UTC)", () => {
    const { db, userId, pushExerciseId, templateId } = setupScenario();
    startCutPhase(db, { user_id: userId, started_on: "2026-06-10" });
    // 2026-06-15 23:30 America/Toronto = 2026-06-16T03:30Z. UTC bucketing would
    // mis-file it on the 16th; user-local must keep it on the 15th.
    logWorkout(db, userId, pushExerciseId, "2026-06-16T03:30:00Z", templateId);
    const report = assembleReport(db, userId, NOW);
    const day15 = report.history_14d.find((d) => d.date === "2026-06-15");
    const day16 = report.history_14d.find((d) => d.date === "2026-06-16");
    expect(day15?.workout_name).toBe("PUSH");
    expect(day16?.workout_name).toBeNull();
  });

  // NOTE: the "phase_incomplete day yields day_target: null" case is intentionally
  // NOT tested here. assembleReport's own grid loop falls back to null on a
  // phase_incomplete day (kind !== "ready"), but it can't reach that path in
  // isolation: getTodayContext (an upstream dependency assembleReport calls
  // first) THROWS when the active phase is missing TDEE-refactor fields, so no
  // phase_incomplete state is cheaply seedable for the whole report. The grid's
  // null-fallback for phase_incomplete is exercised indirectly via macros.ts.
});
