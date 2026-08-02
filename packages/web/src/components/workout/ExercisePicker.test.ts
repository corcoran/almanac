import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ExercisePicker from "./ExercisePicker.vue";

const exercises = [
  {
    id: 1,
    user_id: 1,
    group_id: 1,
    name: "Barbell bench press",
    notes: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    user_id: 1,
    group_id: 2,
    name: "Overhead press",
    notes: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  },
];
const groups = [
  { id: 1, user_id: 1, name: "Chest", display_order: 0, created_at: "2026-01-01T00:00:00.000Z" },
  {
    id: 2,
    user_id: 1,
    name: "Shoulders",
    display_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

function mountPicker(client: { post: ReturnType<typeof vi.fn> }) {
  return mount(ExercisePicker, {
    props: { exercises, groups, client: client as never },
  });
}

describe("ExercisePicker", () => {
  it("filters exercises by case-insensitive substring", async () => {
    const wrapper = mountPicker({ post: vi.fn() });
    await wrapper.find('[data-test="picker-search"]').setValue("bench");
    const rows = wrapper.findAll('[data-test="picker-exercise"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text()).toContain("Barbell bench press");
  });

  it("emits select with an AddableExercise when a row is clicked", async () => {
    const wrapper = mountPicker({ post: vi.fn() });
    await wrapper.findAll('[data-test="picker-exercise"]')[1]?.trigger("click");
    const emitted = wrapper.emitted("select");
    expect(emitted?.[0]?.[0]).toEqual({
      exercise_id: 2,
      name: "Overhead press",
      group_id: 2,
      groupName: "Shoulders",
    });
  });

  it("shows the create affordance only when the query matches nothing", async () => {
    const wrapper = mountPicker({ post: vi.fn() });
    expect(wrapper.find('[data-test="picker-create"]').exists()).toBe(false);
    await wrapper.find('[data-test="picker-search"]').setValue("cable fly");
    expect(wrapper.find('[data-test="picker-create"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="picker-create"]').text()).toContain("cable fly");
  });

  it("create posts to /v1/exercises and emits the new exercise", async () => {
    const created = {
      id: 99,
      user_id: 1,
      group_id: 1,
      name: "Cable fly",
      notes: null,
      archived_at: null,
      created_at: "2026-06-21T00:00:00.000Z",
    };
    const post = vi.fn().mockResolvedValue(created);
    const wrapper = mountPicker({ post });
    await wrapper.find('[data-test="picker-search"]').setValue("Cable fly");
    await wrapper.find('[data-test="picker-create-group"]').setValue("1");
    await wrapper.find('[data-test="picker-create-submit"]').trigger("click");
    await flushPromises();
    expect(post).toHaveBeenCalledWith(
      "/v1/exercises",
      { group_id: 1, name: "Cable fly" },
      expect.anything(),
    );
    const emitted = wrapper.emitted("select");
    expect(emitted?.[0]?.[0]).toEqual({
      exercise_id: 99,
      name: "Cable fly",
      group_id: 1,
      groupName: "Chest",
    });
  });
});
