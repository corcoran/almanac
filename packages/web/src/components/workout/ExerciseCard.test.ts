import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { ActiveExercise } from "../../lib/active-workout-types.js";
import ExerciseCard from "./ExerciseCard.vue";

function makeExercise(): ActiveExercise {
  return {
    client_id: "c-1",
    exercise_id: 10,
    name: "Bench Press",
    group_id: 1,
    added_mid_session: false,
    display_order: 1,
    baseline_planned_sets: 3,
    skipped: false,
    sets: [{ set_number: 1, reps: 8, weight_kg: 80, done: false }],
  };
}

const templateItem = {
  exercise_id: 10,
  name: "Bench Press",
  group_id: 1,
  display_order: 1,
  planned_sets: 3,
  default_reps: 8,
  default_weight_kg: 80,
};

describe("ExerciseCard — alternating background", () => {
  it("applies card-even when index is 0", () => {
    const wrapper = mount(ExerciseCard, {
      props: {
        exercise: makeExercise(),
        templateItem,
        unitSystem: "metric",
        index: 0,
      },
    });
    const section = wrapper.find('[data-test="exercise-card"]');
    expect(section.classes()).toContain("card-even");
    expect(section.classes()).not.toContain("card-odd");
  });

  it("applies card-odd when index is 1", () => {
    const wrapper = mount(ExerciseCard, {
      props: {
        exercise: makeExercise(),
        templateItem,
        unitSystem: "metric",
        index: 1,
      },
    });
    const section = wrapper.find('[data-test="exercise-card"]');
    expect(section.classes()).toContain("card-odd");
    expect(section.classes()).not.toContain("card-even");
  });

  it("defaults to card-even when index is not provided", () => {
    const wrapper = mount(ExerciseCard, {
      props: {
        exercise: makeExercise(),
        templateItem,
        unitSystem: "metric",
      },
    });
    const section = wrapper.find('[data-test="exercise-card"]');
    expect(section.classes()).toContain("card-even");
  });
});
