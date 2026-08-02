import { describe, expect, it } from "vitest";
import { createGroup } from "../repos/exercise-groups.repo.js";
import { createExercise } from "../repos/exercises.repo.js";
import { createTemplate } from "../repos/workout-templates.repo.js";
import { createWorkout } from "../repos/workouts.repo.js";
import { freshDb, seedUser } from "../test-support/db.js";
import { defined } from "../test-support/index.js";
import { summarizeTrainingHistory } from "./training-history.js";

function setup() {
  const db = freshDb();
  const userId = seedUser(db);
  const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
  const pushUp = createExercise(db, {
    user_id: userId,
    group_id: chest.id,
    name: "Push-up",
  });
  const tpl = createTemplate(db, {
    user_id: userId,
    name: "PUSH",
    items: [{ exercise_id: pushUp.id, display_order: 1, default_sets: 3, default_reps: 12 }],
  });
  return { db, userId, pushUp, tpl };
}

function setupMultiSplit() {
  const db = freshDb();
  const userId = seedUser(db);
  const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
  const pushUp = createExercise(db, { user_id: userId, group_id: chest.id, name: "Push-up" });
  const legs = createGroup(db, { user_id: userId, name: "Legs", display_order: 2 });
  const squat = createExercise(db, { user_id: userId, group_id: legs.id, name: "Squat" });
  const back = createGroup(db, { user_id: userId, name: "Back", display_order: 3 });
  const row = createExercise(db, { user_id: userId, group_id: back.id, name: "Row" });
  const pushTpl = createTemplate(db, {
    user_id: userId,
    name: "PUSH",
    items: [{ exercise_id: pushUp.id, display_order: 1, default_sets: 3, default_reps: 12 }],
  });
  const legsTpl = createTemplate(db, {
    user_id: userId,
    name: "LEGS",
    items: [{ exercise_id: squat.id, display_order: 1, default_sets: 4, default_reps: 8 }],
  });
  const pullTpl = createTemplate(db, {
    user_id: userId,
    name: "PULL",
    items: [{ exercise_id: row.id, display_order: 1, default_sets: 3, default_reps: 10 }],
  });
  return { db, userId, pushUp, squat, row, pushTpl, legsTpl, pullTpl };
}

describe("summarizeTrainingHistory", () => {
  it("returns a zeroed summary for a user with no workouts", () => {
    const db = freshDb();
    seedUser(db);
    const out = summarizeTrainingHistory(
      db,
      1,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      { days: 14 },
    );
    expect(out.sessions).toBe(0);
    expect(out.by_split).toEqual([]);
    expect(out.load_progression).toEqual([]);
    expect(out.frequency_note).toBeNull();
  });

  it("counts sessions per split with last_trained and avg_rpe", () => {
    const { db, userId, pushUp, tpl } = setup();

    // Two PUSH workouts within the 14-day window (rpe 7 and 9)
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-06-22T10:00:00Z",
      duration_min: 45,
      rpe: 7,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 3,
          sets: [
            { reps: 12, weight_kg: null },
            { reps: 12, weight_kg: null },
            { reps: 10, weight_kg: null },
          ],
        },
      ],
    });
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-06-26T10:00:00Z",
      duration_min: 50,
      rpe: 9,
      exercises: [
        {
          exercise_id: pushUp.id,
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

    const out = summarizeTrainingHistory(
      db,
      userId,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      {
        days: 14,
      },
    );
    expect(out.sessions).toBe(2);

    const push = defined(
      out.by_split.find((s) => s.template_name === "PUSH"),
      "push split",
    );
    expect(push.sessions).toBe(2);
    expect(push.avg_rpe).toBe(8); // (7+9)/2
    expect(typeof push.last_trained).toBe("string");
    expect(push.last_trained).toBe("2026-06-26");
  });

  it("excludes workouts outside the window", () => {
    const { db, userId, pushUp, tpl } = setup();

    // This workout is 20 days ago — outside the 14-day window
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-06-08T10:00:00Z",
      duration_min: 45,
      rpe: 7,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 3,
          sets: [{ reps: 12, weight_kg: null }],
        },
      ],
    });

    const out = summarizeTrainingHistory(
      db,
      userId,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      {
        days: 14,
      },
    );
    expect(out.sessions).toBe(0);
    expect(out.by_split).toEqual([]);
  });

  it("groups unlabeled workouts (no template_id) under Unlabeled", () => {
    const { db, userId, pushUp } = setup();

    createWorkout(db, {
      user_id: userId,
      template_id: null,
      started_at: "2026-06-25T10:00:00Z",
      duration_min: 30,
      rpe: 6,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 2,
          sets: [{ reps: 10, weight_kg: null }],
        },
      ],
    });

    const out = summarizeTrainingHistory(
      db,
      userId,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      {
        days: 14,
      },
    );
    expect(out.sessions).toBe(1);
    const unlabeled = defined(
      out.by_split.find((s) => s.template_name === "Unlabeled"),
      "unlabeled split",
    );
    expect(unlabeled.sessions).toBe(1);
    expect(unlabeled.avg_rpe).toBe(6);
  });

  it("classifies rpe_vs_baseline as 'up' when recent sessions are harder", () => {
    const { db, userId, pushUp, pushTpl } = setupMultiSplit();
    // 4 PUSH sessions in-window, ascending by date.
    // Earlier pair: rpe 7, recent pair: rpe 9. Delta = +2 >= 0.5 → "up".
    const pushSets = [
      {
        exercise_id: pushUp.id,
        display_order: 1,
        planned_sets: 3,
        sets: [{ reps: 12, weight_kg: null }],
      },
    ];
    createWorkout(db, {
      user_id: userId,
      template_id: pushTpl.id,
      started_at: "2026-06-16T10:00:00Z",
      duration_min: 45,
      rpe: 7,
      exercises: pushSets,
    });
    createWorkout(db, {
      user_id: userId,
      template_id: pushTpl.id,
      started_at: "2026-06-19T10:00:00Z",
      duration_min: 45,
      rpe: 7,
      exercises: pushSets,
    });
    createWorkout(db, {
      user_id: userId,
      template_id: pushTpl.id,
      started_at: "2026-06-23T10:00:00Z",
      duration_min: 45,
      rpe: 9,
      exercises: pushSets,
    });
    createWorkout(db, {
      user_id: userId,
      template_id: pushTpl.id,
      started_at: "2026-06-26T10:00:00Z",
      duration_min: 45,
      rpe: 9,
      exercises: pushSets,
    });

    const out = summarizeTrainingHistory(
      db,
      1,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      { days: 14 },
    );
    const push = defined(
      out.by_split.find((s) => s.template_name === "PUSH"),
      "push",
    );
    expect(push.rpe_vs_baseline).toBe("up");
  });

  it("reports rpe_vs_baseline null when fewer than 3 sessions", () => {
    const { db, userId, pushUp, pushTpl } = setupMultiSplit();
    // Only 1 PUSH session → null trend
    createWorkout(db, {
      user_id: userId,
      template_id: pushTpl.id,
      started_at: "2026-06-25T10:00:00Z",
      duration_min: 45,
      rpe: 8,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 3,
          sets: [{ reps: 12, weight_kg: null }],
        },
      ],
    });

    const out = summarizeTrainingHistory(
      db,
      1,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      { days: 14 },
    );
    const push = out.by_split.find((s) => s.template_name === "PUSH");
    expect(push?.rpe_vs_baseline).toBeNull();
  });

  it("computes deviation_rate from skipped exercises", () => {
    const { db, userId, pushUp, tpl } = setup();

    const skippedAt = "2026-06-22T10:00:00Z";
    // Session 1: pushUp skipped
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: skippedAt,
      duration_min: 45,
      rpe: 7,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 3,
          sets: [],
          skipped_at: skippedAt,
        },
      ],
    });
    // Session 2: pushUp skipped again
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-06-25T10:00:00Z",
      duration_min: 45,
      rpe: 8,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 3,
          sets: [],
          skipped_at: "2026-06-25T10:00:00Z",
        },
      ],
    });

    const out = summarizeTrainingHistory(
      db,
      userId,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      {
        days: 14,
      },
    );
    const push = defined(
      out.by_split.find((s) => s.template_name === "PUSH"),
      "push",
    );
    expect(push.deviation_rate).toBeGreaterThan(0);
    expect(push.notable_deviation).not.toBeNull();
  });

  it("classifies load progression direction for a main lift", () => {
    const { db, userId, pushUp, tpl } = setup();

    // Earlier session: top-set 60 kg
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-06-20T10:00:00Z",
      duration_min: 45,
      rpe: 7,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 3,
          sets: [
            { reps: 8, weight_kg: 55 },
            { reps: 8, weight_kg: 60 },
            { reps: 8, weight_kg: 60 },
          ],
        },
      ],
    });
    // Later session: top-set 70 kg
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-06-26T10:00:00Z",
      duration_min: 45,
      rpe: 8,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 3,
          sets: [
            { reps: 8, weight_kg: 65 },
            { reps: 8, weight_kg: 70 },
            { reps: 8, weight_kg: 70 },
          ],
        },
      ],
    });

    const out = summarizeTrainingHistory(
      db,
      userId,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      {
        days: 14,
      },
    );
    const prog = defined(
      out.load_progression.find((l) => l.exercise_name === "Push-up"),
      "Push-up progression",
    );
    expect(prog.direction).toBe("climbing");
    expect(prog.to_kg).toBeGreaterThan(prog.from_kg);
  });

  it("notes a frequency imbalance across splits", () => {
    const { db, userId, squat, legsTpl, pullTpl, row } = setupMultiSplit();
    const legsSets = [
      {
        exercise_id: squat.id,
        display_order: 1,
        planned_sets: 4,
        sets: [{ reps: 8, weight_kg: 60 }],
      },
    ];
    const pullSets = [
      {
        exercise_id: row.id,
        display_order: 1,
        planned_sets: 3,
        sets: [{ reps: 10, weight_kg: 50 }],
      },
    ];
    // LEGS x3, PULL x1 → LEGS 3x / PULL 1x imbalance
    createWorkout(db, {
      user_id: userId,
      template_id: legsTpl.id,
      started_at: "2026-06-18T10:00:00Z",
      duration_min: 50,
      rpe: 7,
      exercises: legsSets,
    });
    createWorkout(db, {
      user_id: userId,
      template_id: legsTpl.id,
      started_at: "2026-06-21T10:00:00Z",
      duration_min: 50,
      rpe: 7,
      exercises: legsSets,
    });
    createWorkout(db, {
      user_id: userId,
      template_id: legsTpl.id,
      started_at: "2026-06-24T10:00:00Z",
      duration_min: 50,
      rpe: 8,
      exercises: legsSets,
    });
    createWorkout(db, {
      user_id: userId,
      template_id: pullTpl.id,
      started_at: "2026-06-20T10:00:00Z",
      duration_min: 45,
      rpe: 7,
      exercises: pullSets,
    });

    const out = summarizeTrainingHistory(
      db,
      1,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      { days: 14 },
    );
    expect(out.frequency_note).toMatch(/pull/i);
  });

  it("buckets last_trained to the user's LOCAL day, not the UTC date", () => {
    const { db, userId, pushUp, tpl } = setup();
    // 2026-06-15T01:00:00Z is 9pm EDT on 2026-06-14 in America/Toronto. The
    // user trained on the evening of the 14th (their local day), so last_trained
    // must be "2026-06-14" — NOT the UTC-truncated "2026-06-15".
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-06-15T01:00:00Z",
      duration_min: 45,
      rpe: 8,
      exercises: [
        {
          exercise_id: pushUp.id,
          display_order: 1,
          planned_sets: 3,
          sets: [{ reps: 12, weight_kg: null }],
        },
      ],
    });

    const out = summarizeTrainingHistory(
      db,
      userId,
      new Date("2026-06-28T12:00:00Z"),
      "America/Toronto",
      {
        days: 14,
      },
    );
    const push = defined(
      out.by_split.find((s) => s.template_name === "PUSH"),
      "push split",
    );
    expect(push.last_trained).toBe("2026-06-14");
  });
});
