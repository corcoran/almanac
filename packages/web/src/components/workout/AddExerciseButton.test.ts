import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AddExerciseButton from "./AddExerciseButton.vue";

const isoNow = "2026-05-19T20:00:00.000Z";

const groups = [
  { id: 1, user_id: 1, name: "Push", display_order: 0, created_at: isoNow },
  { id: 2, user_id: 1, name: "Pull", display_order: 1, created_at: isoNow },
];

const exercises = [
  {
    id: 10,
    user_id: 1,
    group_id: 1,
    name: "Bench press",
    notes: null,
    archived_at: null,
    created_at: isoNow,
  },
  {
    id: 11,
    user_id: 1,
    group_id: 1,
    name: "Overhead press",
    notes: null,
    archived_at: null,
    created_at: isoNow,
  },
  {
    id: 20,
    user_id: 1,
    group_id: 2,
    name: "Barbell row",
    notes: null,
    archived_at: null,
    created_at: isoNow,
  },
];

function makeProps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    exercises,
    groups,
    primaryGroupId: 1,
    createExercise: vi.fn(),
    ...overrides,
  };
}

describe("AddExerciseButton", () => {
  it("renders only primary-group exercises by default", async () => {
    const wrapper = mount(AddExerciseButton, { props: makeProps() });
    await wrapper.find('[data-test="open-add-exercise"]').trigger("click");

    const options = wrapper.findAll('[data-test="exercise-option"]');
    const names = options.map((o) => o.text());
    expect(names).toContain("Bench press");
    expect(names).toContain("Overhead press");
    expect(names).not.toContain("Barbell row");
  });

  it("toggling 'Show all' includes off-group exercises", async () => {
    const wrapper = mount(AddExerciseButton, { props: makeProps() });
    await wrapper.find('[data-test="open-add-exercise"]').trigger("click");

    await wrapper.find('[data-test="show-all"]').setValue(true);

    const names = wrapper.findAll('[data-test="exercise-option"]').map((o) => o.text());
    expect(names).toContain("Bench press");
    expect(names).toContain("Overhead press");
    expect(names).toContain("Barbell row");
  });

  it("create-new form requires a group and calls createExercise on submit", async () => {
    const created = {
      id: 99,
      user_id: 1,
      group_id: 2,
      name: "Cable curl",
      notes: null,
      archived_at: null,
      created_at: isoNow,
    };
    const createExercise = vi.fn().mockResolvedValue(created);
    const wrapper = mount(AddExerciseButton, {
      props: makeProps({ createExercise }),
    });
    await wrapper.find('[data-test="open-add-exercise"]').trigger("click");

    // Type something that doesn't match → "create new" form appears.
    await wrapper.find('[data-test="search-input"]').setValue("Cable curl");

    // Submitting without a group should not call the API.
    await wrapper.find('[data-test="create-submit"]').trigger("click");
    expect(createExercise).not.toHaveBeenCalled();

    // Choose a group, then submit.
    await wrapper.find('[data-test="create-group"]').setValue("2");
    await wrapper.find('[data-test="create-submit"]').trigger("click");

    expect(createExercise).toHaveBeenCalledWith({
      name: "Cable curl",
      group_id: 2,
    });

    // Wait for the promise to resolve so the emit fires.
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("select")).toEqual([
      [{ exercise_id: 99, name: "Cable curl", group_id: 2 }],
    ]);
  });
});
