import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { at, defined } from "../test-support/index.js";
import { createGroup } from "./exercise-groups.repo.js";
import { createExercise } from "./exercises.repo.js";
import { createTemplate } from "./workout-templates.repo.js";
import {
  addExerciseInstance,
  applyTemplateWithDeviations,
  createWorkout,
  deleteSet,
  deleteWorkout,
  findExerciseInstance,
  findSetById,
  findSetByIdForUser,
  findWorkoutById,
  findWorkoutByIdForUser,
  listWorkoutsInRange,
  listWorkoutsInRangeWithTemplateName,
  listWorkoutsWithDetail,
  updateSet,
  updateWorkout,
} from "./workouts.repo.js";

function setup() {
  const db = freshDb();
  const userId = seedUser(db);
  const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
  const push = createExercise(db, {
    user_id: userId,
    group_id: chest.id,
    name: "Push-up",
  });
  const incline = createExercise(db, {
    user_id: userId,
    group_id: chest.id,
    name: "Incline Press",
  });
  const tpl = createTemplate(db, {
    user_id: userId,
    name: "PUSH",
    items: [
      { exercise_id: push.id, display_order: 1, default_sets: 3, default_reps: 12 },
      {
        exercise_id: incline.id,
        display_order: 2,
        default_sets: 3,
        default_reps: 10,
        default_weight_kg: 20.4,
      },
    ],
  });
  return { db, userId, chest, push, incline, tpl };
}

describe("workouts.repo — createWorkout / findWorkoutById", () => {
  it("createWorkout with full-session shape inserts nested rows and returns the full tree", () => {
    const { db, userId, push, incline, tpl } = setup();
    const w = createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-12T21:20:00Z",
      duration_min: 80,
      rpe: 8.5,
      exercises: [
        {
          exercise_id: push.id,
          display_order: 1,
          planned_sets: 3,
          sets: [
            { reps: 12, weight_kg: null },
            { reps: 12, weight_kg: null },
            { reps: 10, weight_kg: null },
          ],
        },
        {
          exercise_id: incline.id,
          display_order: 2,
          planned_sets: 3,
          sets: [
            { reps: 10, weight_kg: 20.4 },
            { reps: 10, weight_kg: 20.4 },
            { reps: 10, weight_kg: 20.4 },
          ],
        },
      ],
    });
    // createWorkout returns the full tree directly (composite re-read inside tx).
    expect(w.id).toBeGreaterThan(0);
    expect(w.rpe).toBe(8.5);
    expect(w.exercises?.length).toBe(2);
    expect(w.exercises?.[0]?.sets?.length).toBe(3);
    expect(w.exercises?.[1]?.sets?.[0]?.weight_kg).toBe(20.4);
    // findWorkoutById returns the same shape.
    const full = findWorkoutById(db, w.id);
    expect(full?.exercises?.length).toBe(2);
    expect(full?.exercises?.[0]?.sets?.length).toBe(3);
  });

  it("createWorkout accepts compact set form and expands per the count", () => {
    const { db, userId, push, tpl } = setup();
    const w = createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-12T21:20:00Z",
      rpe: 8,
      exercises: [
        {
          exercise_id: push.id,
          display_order: 1,
          planned_sets: 4,
          sets: { count: 4, reps: 10, weight_kg: 22.7 },
        },
      ],
    });
    expect(w.exercises?.[0]?.sets?.length).toBe(4);
    expect(w.exercises?.[0]?.sets?.[0]?.weight_kg).toBe(22.7);
    expect(w.exercises?.[0]?.sets?.[3]?.reps).toBe(10);
  });

  it("preserves 'did 0 of 3 planned' as planned_sets with no child sets", () => {
    const { db, userId, push, tpl } = setup();
    const w = createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-12T21:20:00Z",
      rpe: 7,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 3, sets: [] }],
    });
    expect(w.exercises?.[0]?.planned_sets).toBe(3);
    expect(w.exercises?.[0]?.sets).toEqual([]);
  });

  it("createWorkout allows null template_id (ad-hoc workouts)", () => {
    const { db, userId, push } = setup();
    const w = createWorkout(db, {
      user_id: userId,
      started_at: "2026-05-12T21:20:00Z",
      rpe: 7,
      exercises: [
        {
          exercise_id: push.id,
          display_order: 1,
          planned_sets: 1,
          sets: [{ reps: 10, weight_kg: null }],
        },
      ],
    });
    expect(w.template_id).toBeNull();
  });

  it("createWorkout rolls back atomically if a child INSERT fails", () => {
    const { db, userId } = setup();
    // exercise_id 9999 doesn't exist — FK constraint will throw inside the tx.
    expect(() =>
      createWorkout(db, {
        user_id: userId,
        started_at: "2026-05-12T21:20:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 9999,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: null }],
          },
        ],
      }),
    ).toThrow();
    // The parent workouts row should NOT exist either — the whole tx rolled back.
    const all = listWorkoutsInRange(db, userId, {});
    expect(all.length).toBe(0);
  });

  it("findWorkoutById returns null when missing", () => {
    const { db } = setup();
    expect(findWorkoutById(db, 999)).toBeNull();
  });

  it("findWorkoutById orders nested exercise_instances by display_order and sets by set_number", () => {
    // Insert in REVERSE display_order so the assertion fails if ORDER BY is
    // dropped — insertion order would otherwise mask it.
    const { db, userId, push, incline, tpl } = setup();
    const w = createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-12T21:20:00Z",
      rpe: 8,
      exercises: [
        {
          exercise_id: incline.id,
          display_order: 2,
          planned_sets: 2,
          sets: [
            { reps: 10, weight_kg: 20 },
            { reps: 8, weight_kg: 20 },
          ],
        },
        {
          exercise_id: push.id,
          display_order: 1,
          planned_sets: 1,
          sets: [{ reps: 12, weight_kg: null }],
        },
      ],
    });
    const full = findWorkoutById(db, w.id);
    expect(full?.exercises?.map((e) => e.display_order)).toEqual([1, 2]);
    expect(full?.exercises?.[1]?.sets?.map((s) => s.set_number)).toEqual([1, 2]);
  });
});

describe("workouts.repo — listWorkoutsInRange / listWorkoutsWithDetail", () => {
  it("listWorkoutsInRange filters by user_id and time, orders by started_at DESC", () => {
    const { db, userId, push, tpl } = setup();
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-01T21:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-10T21:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    const recent = listWorkoutsInRange(db, userId, {
      from: "2026-05-05T00:00:00Z",
      to: "2026-05-12T00:00:00Z",
    });
    expect(recent.length).toBe(1);
    expect(recent[0]?.started_at?.startsWith("2026-05-10")).toBe(true);
  });

  it("listWorkoutsInRange from is inclusive, to is exclusive", () => {
    const { db, userId, push, tpl } = setup();
    const boundary = "2026-05-12T00:00:00Z";
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: boundary,
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    expect(listWorkoutsInRange(db, userId, { from: boundary }).length).toBe(1);
    expect(listWorkoutsInRange(db, userId, { to: boundary }).length).toBe(0);
  });

  it("listWorkoutsInRange filters by template_id when supplied", () => {
    const { db, userId, push, tpl } = setup();
    const otherTpl = createTemplate(db, {
      user_id: userId,
      name: "PULL",
      items: [{ exercise_id: push.id, display_order: 1, default_sets: 1 }],
    });
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-10T21:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    createWorkout(db, {
      user_id: userId,
      template_id: otherTpl.id,
      started_at: "2026-05-11T21:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    const onlyPush = listWorkoutsInRange(db, userId, { template_id: tpl.id });
    expect(onlyPush.length).toBe(1);
    expect(onlyPush[0]?.template_id).toBe(tpl.id);
  });

  it("listWorkoutsInRange falsy or negative limit falls back to default 50", () => {
    const { db, userId, push, tpl } = setup();
    for (let i = 0; i < 60; i++) {
      createWorkout(db, {
        user_id: userId,
        template_id: tpl.id,
        // Vary minutes so all started_at values are distinct.
        started_at: `2026-05-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`,
        rpe: 8,
        exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
      });
    }
    expect(listWorkoutsInRange(db, userId, { limit: 0 }).length).toBe(50);
    expect(listWorkoutsInRange(db, userId, { limit: -5 }).length).toBe(50);
    expect(listWorkoutsInRange(db, userId, {}).length).toBe(50);
  });

  it("listWorkoutsInRange filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const groupA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const groupB = createGroup(db, { user_id: userB, name: "Chest", display_order: 1 });
    const exA = createExercise(db, { user_id: userA, group_id: groupA.id, name: "Push-up" });
    const exB = createExercise(db, { user_id: userB, group_id: groupB.id, name: "Push-up" });
    createWorkout(db, {
      user_id: userA,
      started_at: "2026-05-12T08:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: exA.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    createWorkout(db, {
      user_id: userB,
      started_at: "2026-05-12T08:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: exB.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    const aList = listWorkoutsInRange(db, userA, {});
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });

  it("listWorkoutsInRangeWithTemplateName returns template_name from join", () => {
    const { db, userId, push, tpl } = setup();
    // Workout WITH a template — template_name should come back as the template's name.
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-10T21:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    // Workout WITHOUT a template (ad-hoc) — template_name should be null.
    createWorkout(db, {
      user_id: userId,
      started_at: "2026-05-11T21:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    const all = listWorkoutsInRangeWithTemplateName(db, userId, {});
    expect(all).toHaveLength(2);
    const withTpl = all.find((w) => w.template_id !== null);
    const adHoc = all.find((w) => w.template_id === null);
    expect(withTpl?.template_name).toBe("PUSH");
    expect(adHoc?.template_name).toBeNull();
  });

  it("listWorkoutsInRangeWithTemplateName respects from/to filtering", () => {
    const { db, userId, push, tpl } = setup();
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-01T21:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-10T21:00:00Z",
      rpe: 8,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 1, sets: [] }],
    });
    const recent = listWorkoutsInRangeWithTemplateName(db, userId, {
      from: "2026-05-05T00:00:00Z",
      to: "2026-05-12T00:00:00Z",
    });
    expect(recent.length).toBe(1);
    expect(recent[0]?.started_at?.startsWith("2026-05-10")).toBe(true);
    expect(recent[0]?.template_name).toBe("PUSH");
  });

  it("listWorkoutsWithDetail returns the full nested tree for each workout", () => {
    const { db, userId, push, tpl } = setup();
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-10T21:00:00Z",
      rpe: 8,
      exercises: [
        {
          exercise_id: push.id,
          display_order: 1,
          planned_sets: 2,
          sets: [
            { reps: 12, weight_kg: null },
            { reps: 12, weight_kg: null },
          ],
        },
      ],
    });
    const detail = listWorkoutsWithDetail(db, userId, {});
    expect(detail.length).toBe(1);
    expect(detail[0]?.exercises?.length).toBe(1);
    expect(detail[0]?.exercises?.[0]?.sets?.length).toBe(2);
  });
});

describe("workouts.repo — applyTemplateWithDeviations", () => {
  it("skip + override_sets + add resolves correctly with explicit display_order", () => {
    const { db, userId, push, incline, tpl, chest } = setup();
    const benchHeavy = createExercise(db, {
      user_id: userId,
      group_id: chest.id,
      name: "Bench Heavy",
    });
    const startedAt = "2026-05-08T18:00:00Z";
    const resolved = applyTemplateWithDeviations(
      db,
      tpl.id,
      [
        { op: "skip", exercise_id: push.id },
        {
          op: "override_sets",
          exercise_id: incline.id,
          sets: { count: 3, reps: 12, weight_kg: 22.7 },
        },
        {
          op: "add",
          exercise_id: benchHeavy.id,
          display_order: 8,
          planned_sets: 2,
          sets: { count: 2, reps: 6, weight_kg: 30.0 },
        },
      ],
      startedAt,
    );
    // Skipped exercises now appear in the resolved list (with sets=[] and
    // skipped_at set) so the persisted workout records adherence directly.
    expect(resolved.map((r) => r.exercise_id)).toEqual([push.id, incline.id, benchHeavy.id]);
    const skippedRow = defined(
      resolved.find((r) => r.exercise_id === push.id),
      "skipped row",
    );
    expect(skippedRow.sets).toEqual([]);
    // skipped_at is anchored to the workout's started_at, NOT log-time.
    expect(skippedRow.skipped_at).toBe(startedAt);
    const overrideRow = defined(
      resolved.find((r) => r.exercise_id === incline.id),
      "override row",
    );
    expect(overrideRow.sets.length).toBe(3);
    expect(overrideRow.sets[0]?.reps).toBe(12);
    expect(overrideRow.sets[0]?.weight_kg).toBe(22.7);
    expect(overrideRow.skipped_at).toBeNull();
  });

  it("skip referencing exercise NOT in template throws", () => {
    const { db, userId, chest, tpl } = setup();
    const orphan = createExercise(db, {
      user_id: userId,
      group_id: chest.id,
      name: "Not In Template",
    });
    expect(() =>
      applyTemplateWithDeviations(
        db,
        tpl.id,
        [{ op: "skip", exercise_id: orphan.id }],
        "2026-05-08T18:00:00Z",
      ),
    ).toThrow(/not in template/i);
  });

  it("override_sets referencing exercise NOT in template throws", () => {
    const { db, userId, chest, tpl } = setup();
    const orphan = createExercise(db, {
      user_id: userId,
      group_id: chest.id,
      name: "Orphan",
    });
    expect(() =>
      applyTemplateWithDeviations(
        db,
        tpl.id,
        [
          {
            op: "override_sets",
            exercise_id: orphan.id,
            sets: { count: 1, reps: 1, weight_kg: 10 },
          },
        ],
        "2026-05-08T18:00:00Z",
      ),
    ).toThrow(/not in template/i);
  });

  it("add referencing exercise ALREADY in template throws", () => {
    const { db, push, tpl } = setup();
    expect(() =>
      applyTemplateWithDeviations(
        db,
        tpl.id,
        [
          {
            op: "add",
            exercise_id: push.id,
            planned_sets: 1,
            sets: { count: 1, reps: 1, weight_kg: 10 },
          },
        ],
        "2026-05-08T18:00:00Z",
      ),
    ).toThrow(/already in template/i);
  });

  it("add without display_order auto-assigns at the end (max + 1)", () => {
    const { db, userId, chest, tpl } = setup();
    const tail = createExercise(db, {
      user_id: userId,
      group_id: chest.id,
      name: "Tail Exercise",
    });
    const resolved = applyTemplateWithDeviations(
      db,
      tpl.id,
      [
        {
          op: "add",
          exercise_id: tail.id,
          planned_sets: 1,
          sets: { count: 1, reps: 1, weight_kg: 10 },
          // display_order omitted on purpose
        },
      ],
      "2026-05-08T18:00:00Z",
    );
    const tailEntry = resolved.find((r) => r.exercise_id === tail.id);
    expect(tailEntry).toBeDefined();
    expect(defined(tailEntry, "tailEntry").display_order).toBeGreaterThanOrEqual(3);
    expect(resolved[resolved.length - 1]?.exercise_id).toBe(tail.id);
  });

  it("a skip deviation persists an exercise_instances row with sets=[] and skipped_at", () => {
    const { db, userId, push, incline, tpl } = setup();
    const startedAt = "2026-05-08T18:00:00Z";
    const w = createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: startedAt,
      rpe: 7,
      exercises: applyTemplateWithDeviations(
        db,
        tpl.id,
        [{ op: "skip", exercise_id: incline.id }],
        startedAt,
      ),
    });
    const got = findWorkoutById(db, w.id);
    expect(got?.exercises).toHaveLength(2); // both rows present, including the skip
    const gotExercises = defined(defined(got, "got").exercises, "exercises");
    const skipped = gotExercises.find((e) => e.exercise_id === incline.id);
    expect(skipped).toBeDefined();
    expect(defined(skipped, "skipped").sets).toEqual([]);
    // skipped_at is anchored to the workout's started_at, NOT log-time —
    // critical for retro-logged workouts whose started_at is in the past.
    expect(defined(skipped, "skipped").skipped_at).toBe(startedAt);
    expect(defined(skipped, "skipped").planned_sets).toBeGreaterThan(0);
    // And the non-skipped one keeps skipped_at null (distinguishable from skip).
    const completed = gotExercises.find((e) => e.exercise_id === push.id);
    expect(defined(completed, "completed").skipped_at).toBeNull();
  });

  it("a 'bombed' exercise_instance with sets=[] but skipped_at=null is still distinguishable", () => {
    const { db, userId, push, tpl } = setup();
    // Logged as planned-but-zero-sets via the full-shape path (NOT a skip).
    const w = createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-05-08T18:00:00Z",
      rpe: 7,
      exercises: [{ exercise_id: push.id, display_order: 1, planned_sets: 3, sets: [] }],
    });
    const got = findWorkoutById(db, w.id);
    const bombed = at(defined(defined(got, "got").exercises, "exercises"), 0);
    expect(bombed.sets).toEqual([]);
    expect(bombed.planned_sets).toBe(3);
    expect(bombed.skipped_at).toBeNull(); // distinguishable from a skip
  });
});

describe("workouts.repo — corrections (update / delete)", () => {
  function makeWorkout() {
    const ctx = setup();
    const w = createWorkout(ctx.db, {
      user_id: ctx.userId,
      template_id: ctx.tpl.id,
      started_at: "2026-05-12T21:20:00Z",
      duration_min: 60,
      rpe: 8,
      notes: "felt good",
      exercises: [
        {
          exercise_id: ctx.push.id,
          display_order: 1,
          planned_sets: 2,
          sets: [
            { reps: 12, weight_kg: null },
            { reps: 12, weight_kg: null },
          ],
        },
      ],
    });
    return { ...ctx, w };
  }

  it("updateWorkout mutates only provided fields", () => {
    const { db, w, userId } = makeWorkout();
    updateWorkout(db, userId, w.id, { rpe: 9.5 });
    const after = findWorkoutById(db, w.id);
    expect(after?.rpe).toBe(9.5);
    expect(after?.duration_min).toBe(60);
    expect(after?.notes).toBe("felt good");
  });

  it("updateWorkout on a nonexistent id returns null", () => {
    const { db, userId } = setup();
    expect(updateWorkout(db, userId, 999, { rpe: 8 })).toBeNull();
  });

  it("updateWorkout with empty patch returns the current row (re-fetch)", () => {
    const { db, w, userId } = makeWorkout();
    const result = updateWorkout(db, userId, w.id, {});
    expect(result?.rpe).toBe(8);
  });

  it("updateWorkout silently ignores keys outside the allowlist", () => {
    const { db, w, userId } = makeWorkout();
    updateWorkout(db, userId, w.id, {
      rpe: 7,
      id: 999,
      user_id: 999,
      created_at: "1970-01-01",
    } as never);
    const after = findWorkoutById(db, w.id);
    expect(after?.id).toBe(w.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.rpe).toBe(7);
  });

  it("updateWorkout can null out notes", () => {
    const { db, w, userId } = makeWorkout();
    updateWorkout(db, userId, w.id, { notes: null });
    expect(findWorkoutById(db, w.id)?.notes).toBeNull();
  });

  it("deleteWorkout removes the row and cascades to exercise_instances and sets", () => {
    const { db, w } = makeWorkout();
    const eiId = at(defined(w.exercises, "exercises"), 0).id;
    const setId = at(defined(at(defined(w.exercises, "exercises"), 0).sets, "sets"), 0).id;
    deleteWorkout(db, w.user_id, w.id);
    expect(findWorkoutById(db, w.id)).toBeNull();
    expect(findExerciseInstance(db, eiId)).toBeNull();
    expect(findSetById(db, setId)).toBeNull();
  });

  // --- Ownership scoping (IDOR fix) -----------------------------------------
  // The workout write surface (update/delete) and the nested set write surface
  // must be no-ops across users. `sets`/`exercise_instances` carry no user_id;
  // ownership is enforced by joining up to the parent workout's user_id.

  it("updateWorkout cannot mutate another user's workout", () => {
    const { db, w } = makeWorkout();
    const otherUser = seedUser(db, { name: "Mallory" });
    expect(updateWorkout(db, otherUser, w.id, { rpe: 1 })).toBeNull();
    expect(findWorkoutById(db, w.id)?.rpe).toBe(8); // untouched
  });

  it("deleteWorkout cannot delete another user's workout", () => {
    const { db, w } = makeWorkout();
    const otherUser = seedUser(db, { name: "Mallory" });
    deleteWorkout(db, otherUser, w.id);
    expect(findWorkoutById(db, w.id)?.id).toBe(w.id); // still there
  });

  it("updateSet cannot mutate a set in another user's workout", () => {
    const { db, w } = makeWorkout();
    const otherUser = seedUser(db, { name: "Mallory" });
    const setId = at(defined(at(defined(w.exercises, "exercises"), 0).sets, "sets"), 0).id;
    expect(updateSet(db, otherUser, setId, { reps: 1 })).toBeNull();
    expect(findSetById(db, setId)?.reps).toBe(12); // untouched
  });

  it("deleteSet cannot delete a set in another user's workout", () => {
    const { db, w } = makeWorkout();
    const otherUser = seedUser(db, { name: "Mallory" });
    const setId = at(defined(at(defined(w.exercises, "exercises"), 0).sets, "sets"), 0).id;
    deleteSet(db, otherUser, setId);
    expect(findSetById(db, setId)?.id).toBe(setId); // still there
  });

  it("findWorkoutByIdForUser returns the workout for the owner but null for others", () => {
    const { db, w } = makeWorkout();
    const otherUser = seedUser(db, { name: "Mallory" });
    expect(findWorkoutByIdForUser(db, w.user_id, w.id)?.id).toBe(w.id);
    expect(findWorkoutByIdForUser(db, otherUser, w.id)).toBeNull();
  });

  it("findSetByIdForUser returns the set for the owner but null for others", () => {
    const { db, w } = makeWorkout();
    const otherUser = seedUser(db, { name: "Mallory" });
    const setId = at(defined(at(defined(w.exercises, "exercises"), 0).sets, "sets"), 0).id;
    expect(findSetByIdForUser(db, w.user_id, setId)?.id).toBe(setId);
    expect(findSetByIdForUser(db, otherUser, setId)).toBeNull();
  });

  it("updateSet mutates only provided fields", () => {
    const { db, w, userId } = makeWorkout();
    const setId = at(defined(at(defined(w.exercises, "exercises"), 0).sets, "sets"), 0).id;
    updateSet(db, userId, setId, { reps: 10 });
    const after = findSetById(db, setId);
    expect(after?.reps).toBe(10);
    expect(after?.weight_kg).toBeNull();
  });

  it("updateSet on a nonexistent id returns null", () => {
    const { db, userId } = setup();
    expect(updateSet(db, userId, 999, { reps: 10 })).toBeNull();
  });

  it("updateSet with empty patch returns the current row (re-fetch)", () => {
    const { db, w, userId } = makeWorkout();
    const setId = at(defined(at(defined(w.exercises, "exercises"), 0).sets, "sets"), 0).id;
    const result = updateSet(db, userId, setId, {});
    expect(result?.reps).toBe(12);
  });

  it("updateSet silently ignores keys outside the allowlist", () => {
    const { db, w, userId } = makeWorkout();
    const setId = at(defined(at(defined(w.exercises, "exercises"), 0).sets, "sets"), 0).id;
    const before = defined(findSetById(db, setId), "set");
    updateSet(db, userId, setId, {
      reps: 11,
      id: 999,
      exercise_instance_id: 999,
      set_number: 99,
    } as never);
    const after = findSetById(db, setId);
    expect(after?.id).toBe(before.id);
    expect(after?.exercise_instance_id).toBe(before.exercise_instance_id);
    expect(after?.set_number).toBe(before.set_number);
    expect(after?.reps).toBe(11);
  });

  it("updateSet can null out weight_kg", () => {
    const { db, userId, push } = setup();
    const created = createWorkout(db, {
      user_id: userId,
      started_at: "2026-05-12T21:20:00Z",
      rpe: 8,
      exercises: [
        {
          exercise_id: push.id,
          display_order: 1,
          planned_sets: 1,
          sets: [{ reps: 10, weight_kg: 25 }],
        },
      ],
    });
    const setId = at(defined(at(defined(created.exercises, "exercises"), 0).sets, "sets"), 0).id;
    updateSet(db, userId, setId, { weight_kg: null });
    expect(findSetById(db, setId)?.weight_kg).toBeNull();
  });

  it("deleteSet removes the row", () => {
    const { db, w, userId } = makeWorkout();
    const setId = at(defined(at(defined(w.exercises, "exercises"), 0).sets, "sets"), 0).id;
    deleteSet(db, userId, setId);
    expect(findSetById(db, setId)).toBeNull();
  });

  it("findSetById returns null when missing", () => {
    const { db } = setup();
    expect(findSetById(db, 999)).toBeNull();
  });

  it("addExerciseInstance appends a new exercise_instance with its sets", () => {
    const { db, w, incline } = makeWorkout();
    const ei = addExerciseInstance(db, w.id, {
      exercise_id: incline.id,
      display_order: 2,
      planned_sets: 1,
      sets: [{ reps: 8, weight_kg: 20 }],
    });
    expect(ei.id).toBeGreaterThan(0);
    expect(ei.sets?.length).toBe(1);
    expect(ei.sets?.[0]?.weight_kg).toBe(20);
    // addExerciseInstance is the on-the-fly add path (inverse of skip), so it
    // must always persist skipped_at=NULL — never inherit a skipped state.
    expect(ei.skipped_at).toBeNull();
    const after = findWorkoutById(db, w.id);
    expect(after?.exercises?.length).toBe(2);
  });

  it("findExerciseInstance returns null when missing", () => {
    const { db } = setup();
    expect(findExerciseInstance(db, 999)).toBeNull();
  });
});
