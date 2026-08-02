import { describe, expect, it } from "vitest";
import type { ActiveExercise, ActiveWorkout, TemplateBaseline } from "./active-workout-types.js";
import { computeDivergences } from "./divergence-diff.js";

const baseline: TemplateBaseline = {
  template_id: 1,
  template_name: "PUSH A",
  exercises: [
    {
      exercise_id: 10,
      name: "Bench Press",
      group_id: 1,
      display_order: 1,
      planned_sets: 3,
      default_reps: 8,
      default_weight_kg: 80,
    },
    {
      exercise_id: 11,
      name: "Overhead Press",
      group_id: 2,
      display_order: 2,
      planned_sets: 3,
      default_reps: 6,
      default_weight_kg: 50,
    },
  ],
};

function exerciseDoing(
  exercise_id: number,
  name: string,
  group_id: number,
  display_order: number,
  baseline_planned_sets: number,
  sets: Array<{ reps: number; weight_kg: number | null; done: boolean }>,
  opts: Partial<Pick<ActiveExercise, "added_mid_session" | "skipped">> = {},
): ActiveExercise {
  return {
    client_id: `c-${exercise_id}`,
    exercise_id,
    name,
    group_id,
    added_mid_session: opts.added_mid_session ?? false,
    display_order,
    baseline_planned_sets,
    skipped: opts.skipped ?? false,
    sets: sets.map((s, i) => ({ set_number: i + 1, ...s })),
  };
}

describe("computeDivergences", () => {
  it("returns empty when session matches baseline exactly", () => {
    const active: Pick<ActiveWorkout, "exercises"> = {
      exercises: [
        exerciseDoing(10, "Bench Press", 1, 1, 3, [
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
        ]),
        exerciseDoing(11, "Overhead Press", 2, 2, 3, [
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
        ]),
      ],
    };
    expect(computeDivergences(active.exercises, baseline)).toEqual([]);
  });

  it("flags reps/load change as set_changes", () => {
    const active: Pick<ActiveWorkout, "exercises"> = {
      exercises: [
        exerciseDoing(10, "Bench Press", 1, 1, 3, [
          { reps: 8, weight_kg: 82.5, done: true }, // weight bumped
          { reps: 8, weight_kg: 82.5, done: true },
          { reps: 8, weight_kg: 82.5, done: true },
        ]),
        // Overhead matches baseline exactly
        exerciseDoing(11, "Overhead Press", 2, 2, 3, [
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
        ]),
      ],
    };
    const diff = computeDivergences(active.exercises, baseline);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      kind: "set_changes",
      exercise_id: 10,
      new_default_weight_kg: 82.5,
    });
  });

  it("flags added sets when completed count exceeds planned", () => {
    const active: Pick<ActiveWorkout, "exercises"> = {
      exercises: [
        exerciseDoing(10, "Bench Press", 1, 1, 3, [
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true }, // 4th set
        ]),
        exerciseDoing(11, "Overhead Press", 2, 2, 3, [
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
        ]),
      ],
    };
    const diff = computeDivergences(active.exercises, baseline);
    expect(diff).toContainEqual(
      expect.objectContaining({ kind: "added_sets", exercise_id: 10, new_planned_sets: 4 }),
    );
  });

  it("does NOT flag missed sets (asymmetric rule per spec §7.2)", () => {
    const active: Pick<ActiveWorkout, "exercises"> = {
      exercises: [
        exerciseDoing(10, "Bench Press", 1, 1, 3, [
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
          // Only 2 of 3 completed
        ]),
        exerciseDoing(11, "Overhead Press", 2, 2, 3, [
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
        ]),
      ],
    };
    expect(computeDivergences(active.exercises, baseline)).toEqual([]);
  });

  it("does NOT flag skipped exercises", () => {
    const active: Pick<ActiveWorkout, "exercises"> = {
      exercises: [
        exerciseDoing(10, "Bench Press", 1, 1, 3, [], { skipped: true }),
        exerciseDoing(11, "Overhead Press", 2, 2, 3, [
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
        ]),
      ],
    };
    expect(computeDivergences(active.exercises, baseline)).toEqual([]);
  });

  it("flags ad-hoc added exercises", () => {
    const active: Pick<ActiveWorkout, "exercises"> = {
      exercises: [
        exerciseDoing(10, "Bench Press", 1, 1, 3, [
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
        ]),
        exerciseDoing(11, "Overhead Press", 2, 2, 3, [
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
        ]),
        exerciseDoing(
          99,
          "Cable Crossover",
          1,
          3,
          0, // baseline_planned_sets = 0 means added mid-session
          [{ reps: 12, weight_kg: 30, done: true }],
          { added_mid_session: true },
        ),
      ],
    };
    const diff = computeDivergences(active.exercises, baseline);
    expect(diff).toContainEqual(
      expect.objectContaining({
        kind: "added_exercise",
        exercise_id: 99,
        name: "Cable Crossover",
      }),
    );
  });

  it("set_changes uses first-encountered value on a tie", () => {
    // Bench with three sets of distinct reps — all completed.
    // Each rep value appears exactly once: a 3-way tie.
    // The first encountered (set 1's reps = 9) wins per mode's tie-break rule.
    const active = {
      exercises: [
        exerciseDoing(10, "Bench Press", 1, 1, 3, [
          { reps: 9, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
          { reps: 7, weight_kg: 80, done: true },
        ]),
        exerciseDoing(11, "Overhead Press", 2, 2, 3, [
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
        ]),
      ],
    };
    const diff = computeDivergences(active.exercises, baseline);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      kind: "set_changes",
      exercise_id: 10,
      new_default_reps: 9, // first encountered
    });
  });

  it("does NOT flag reorders alone", () => {
    const active: Pick<ActiveWorkout, "exercises"> = {
      exercises: [
        exerciseDoing(11, "Overhead Press", 2, 1, 3, [
          // Now at display_order 1 (was 2 in baseline)
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
          { reps: 6, weight_kg: 50, done: true },
        ]),
        exerciseDoing(10, "Bench Press", 1, 2, 3, [
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
          { reps: 8, weight_kg: 80, done: true },
        ]),
      ],
    };
    expect(computeDivergences(active.exercises, baseline)).toEqual([]);
  });
});
