import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../api/client.js";
import { useExerciseGroupsStore } from "../../stores/exercise-groups.js";
import { useExercisesStore } from "../../stores/exercises.js";
import { useNextBestActionStore } from "../../stores/nextBestAction.js";
import { useTemplatesStore } from "../../stores/templates.js";
import IdleView from "./IdleView.vue";

function makeClient(): ApiClient {
  const fetchImpl = vi.fn(async () => new Response("not mocked", { status: 500 }));
  return new ApiClient({ baseUrl: "/api", fetchImpl });
}

// Stub the children — these tests only care about what onSaved refreshes.
const childStubs = {
  NudgeSummary: true,
  ProgramPicker: true,
  TemplateFormModal: true,
  WinsPanel: true,
};

describe("IdleView — refresh after a template save", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("reloads the nudge when a template is saved", async () => {
    // Regression: creating the first template clears the
    // `create_workout_templates` onboarding nudge, but the nudge is served by a
    // SEPARATE store from the template list. onSaved reloaded templates,
    // exercises and groups but not the nudge, so the "Set up workout templates"
    // prompt lingered until a full page reload.
    const templatesStore = useTemplatesStore();
    const exercisesStore = useExercisesStore();
    const groupsStore = useExerciseGroupsStore();
    const nudgeStore = useNextBestActionStore();

    // The modal is v-if'd on an open flag and the list only renders once the
    // stores are ready, so put them in a loaded state before mounting.
    templatesStore.status = "ready";
    exercisesStore.status = "ready";
    groupsStore.status = "ready";

    const templatesReload = vi.spyOn(templatesStore, "reload").mockResolvedValue();
    vi.spyOn(exercisesStore, "load").mockResolvedValue();
    vi.spyOn(groupsStore, "load").mockResolvedValue();
    const nudgeReload = vi.spyOn(nudgeStore, "reload").mockResolvedValue();

    const wrapper = mount(IdleView, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });

    // Open the modal the way a user does, rather than reaching into state.
    await wrapper.find('[data-test="new-template"]').trigger("click");

    const modal = wrapper.findComponent({ name: "TemplateFormModal" });
    expect(modal.exists()).toBe(true);
    modal.vm.$emit("saved");
    await wrapper.vm.$nextTick();
    await Promise.resolve();

    // The template list refreshing is the pre-existing behavior; the nudge
    // refreshing is what this test pins.
    expect(templatesReload).toHaveBeenCalled();
    expect(nudgeReload).toHaveBeenCalled();
  });
});
