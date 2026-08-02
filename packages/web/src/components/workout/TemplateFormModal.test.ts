import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import TemplateFormModal from "./TemplateFormModal.vue";

const exercises = [
  {
    id: 1,
    user_id: 1,
    group_id: 1,
    name: "Bench",
    notes: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  },
];
const groups = [
  { id: 1, user_id: 1, name: "Chest", display_order: 0, created_at: "2026-01-01T00:00:00.000Z" },
];

function makeClient(
  over: Partial<Record<"get" | "post" | "patch" | "put" | "delete", ReturnType<typeof vi.fn>>> = {},
) {
  return {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ id: 7 }),
    patch: vi.fn().mockResolvedValue({ id: 7 }),
    put: vi.fn().mockResolvedValue({ id: 7 }),
    delete: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function mountModal(client: ReturnType<typeof makeClient>, props: Record<string, unknown> = {}) {
  return mount(TemplateFormModal, {
    props: {
      client: client as never,
      mode: "create",
      unitSystem: "metric",
      exercises,
      groups,
      ...props,
    },
  });
}

describe("TemplateFormModal", () => {
  it("create posts { name, items } and emits saved", async () => {
    const client = makeClient();
    const wrapper = mountModal(client);
    await wrapper.find('[data-test="template-name"]').setValue("Push");
    // add an exercise row via the (stubbed-open) picker path: call the exposed add
    (wrapper.vm as unknown as { addExercise: (e: unknown) => void }).addExercise({
      exercise_id: 1,
      name: "Bench",
      group_id: 1,
      groupName: "Chest",
    });
    await flushPromises();
    // set sets/reps on the row
    await wrapper.find('[data-test="row-sets"]').setValue("3");
    await wrapper.find('[data-test="row-reps"]').setValue("5");
    await wrapper.find('[data-test="template-save"]').trigger("click");
    await flushPromises();
    expect(client.post).toHaveBeenCalledWith(
      "/v1/workout-templates",
      {
        name: "Push",
        items: [
          {
            exercise_id: 1,
            display_order: 0,
            default_sets: 3,
            default_reps: 5,
            default_weight_kg: null,
          },
        ],
      },
      expect.anything(),
    );
    expect(wrapper.emitted("saved")).toBeTruthy();
  });

  it("edit issues PATCH then PUT with the full items list", async () => {
    const client = makeClient({
      get: vi.fn().mockResolvedValue({
        id: 7,
        user_id: 1,
        name: "Push",
        notes: null,
        archived_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        items: [
          {
            id: 1,
            template_id: 7,
            exercise_id: 1,
            display_order: 0,
            default_sets: 3,
            default_reps: 5,
            default_weight_kg: null,
          },
        ],
      }),
    });
    const wrapper = mountModal(client, { mode: "edit", templateId: 7 });
    await flushPromises();
    await wrapper.find('[data-test="template-save"]').trigger("click");
    await flushPromises();
    expect(client.patch).toHaveBeenCalledWith(
      "/v1/workout-templates/7",
      { name: "Push" },
      expect.anything(),
    );
    expect(client.put).toHaveBeenCalledWith(
      "/v1/workout-templates/7/items",
      {
        items: [
          {
            exercise_id: 1,
            display_order: 0,
            default_sets: 3,
            default_reps: 5,
            default_weight_kg: null,
          },
        ],
      },
      expect.anything(),
    );
    const patchOrder = client.patch.mock.invocationCallOrder[0] ?? 0;
    const putOrder = client.put.mock.invocationCallOrder[0] ?? 0;
    expect(patchOrder).toBeLessThan(putOrder);
  });

  it("renders the empty-state nudge for a 0-set row", async () => {
    const client = makeClient();
    const wrapper = mountModal(client);
    (wrapper.vm as unknown as { addExercise: (e: unknown) => void }).addExercise({
      exercise_id: 1,
      name: "Bench",
      group_id: 1,
      groupName: "Chest",
    });
    await flushPromises();
    await wrapper.find('[data-test="row-sets"]').setValue("0");
    await flushPromises();
    expect(wrapper.find('[data-test="row-nudge"]').exists()).toBe(true);
  });

  it("shows the nudge when the sets field is cleared (empty string)", async () => {
    const client = makeClient();
    const wrapper = mountModal(client);
    (wrapper.vm as unknown as { addExercise: (e: unknown) => void }).addExercise({
      exercise_id: 1,
      name: "Bench",
      group_id: 1,
      groupName: "Chest",
    });
    await flushPromises();
    await wrapper.find('[data-test="row-sets"]').setValue("");
    await flushPromises();
    expect(wrapper.find('[data-test="row-nudge"]').exists()).toBe(true);
  });

  it("archive calls DELETE and emits saved", async () => {
    const client = makeClient({
      get: vi.fn().mockResolvedValue({
        id: 7,
        user_id: 1,
        name: "Push",
        notes: null,
        archived_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        items: [],
      }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mountModal(client, { mode: "edit", templateId: 7 });
    await flushPromises();
    await wrapper.find('[data-test="template-archive"]').trigger("click");
    await flushPromises();
    expect(client.delete).toHaveBeenCalledWith("/v1/workout-templates/7", expect.anything());
    expect(wrapper.emitted("saved")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("keeps the modal open and shows an error when save fails", async () => {
    const client = makeClient({ post: vi.fn().mockRejectedValue(new Error("boom")) });
    const wrapper = mountModal(client);
    await wrapper.find('[data-test="template-name"]').setValue("Push");
    (wrapper.vm as unknown as { addExercise: (e: unknown) => void }).addExercise({
      exercise_id: 1,
      name: "Bench",
      group_id: 1,
      groupName: "Chest",
    });
    await flushPromises();
    await wrapper.find('[data-test="row-sets"]').setValue("3");
    await wrapper.find('[data-test="template-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("saved")).toBeFalsy();
    expect(wrapper.find('[data-test="template-error"]').exists()).toBe(true);
  });
});
