import { defined } from "@almanac/core/test-support";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SetRow from "./SetRow.vue";

describe("SetRow", () => {
  it("renders planned reps × weight", () => {
    const wrapper = mount(SetRow, {
      props: {
        set: { set_number: 1, reps: 8, weight_kg: 80, done: false },
        plannedReps: 8,
        plannedWeightKg: 80,
        unitSystem: "metric",
      },
    });
    expect(wrapper.text()).toContain("8");
    expect(wrapper.text()).toContain("80");
  });

  it("emits tick on ✓ click", async () => {
    const wrapper = mount(SetRow, {
      props: {
        set: { set_number: 1, reps: 8, weight_kg: 80, done: false },
        plannedReps: 8,
        plannedWeightKg: 80,
        unitSystem: "metric",
      },
    });
    await wrapper.find('[data-test="set-check"]').trigger("click");
    expect(wrapper.emitted("tick")).toEqual([[1]]);
  });

  it("emits edit when reps input changes", async () => {
    const wrapper = mount(SetRow, {
      props: {
        set: { set_number: 1, reps: 8, weight_kg: 80, done: false },
        plannedReps: 8,
        plannedWeightKg: 80,
        unitSystem: "metric",
      },
    });
    const repsInput = wrapper.find('[data-test="set-reps"]');
    await repsInput.setValue("10");
    expect(wrapper.emitted("edit")).toEqual([[1, { reps: 10 }]]);
  });

  it("displays weight in lb when unitSystem is imperial", () => {
    const wrapper = mount(SetRow, {
      props: {
        // 80 kg → ~176.4 lb
        set: { set_number: 1, reps: 8, weight_kg: 80, done: false },
        plannedReps: 8,
        plannedWeightKg: 80,
        unitSystem: "imperial",
      },
    });
    const weightInput = wrapper.find('[data-test="set-weight"]');
    expect((weightInput.element as HTMLInputElement).value).toBe("176.4");
    // Planned column also shows the converted weight, not raw kg.
    expect(wrapper.text()).toContain("176.4");
    expect(wrapper.text()).not.toContain("× 80");
  });

  it("applies an hsl color to the planned-weight span (not the editable inputs)", () => {
    const wrapper = mount(SetRow, {
      props: {
        set: { set_number: 1, reps: 8, weight_kg: 80, done: false },
        plannedReps: 8,
        plannedWeightKg: 80,
        unitSystem: "metric",
      },
    });
    const planned = wrapper.find(".planned-weight");
    expect(planned.exists()).toBe(true);
    // weightColor returns an hsl(...) string; JSDOM normalizes it to rgb()
    // when set via inline style. We don't assert the exact hue here (that's
    // covered in weight-color.test.ts), just that it's wired up.
    expect(planned.attributes("style") ?? "").toMatch(/color:\s*(hsl|rgb)/);
    // Editable inputs must stay default-colored — color there would be
    // visual noise while typing.
    const repsInput = wrapper.find('[data-test="set-reps"]');
    expect(repsInput.attributes("style") ?? "").not.toMatch(/color:\s*(hsl|rgb)/);
  });

  it("tags the row with is-done when the set is done", () => {
    const wrapper = mount(SetRow, {
      props: {
        set: { set_number: 1, reps: 8, weight_kg: 80, done: true },
        plannedReps: 8,
        plannedWeightKg: 80,
        unitSystem: "metric",
      },
    });
    const tr = wrapper.find("tr");
    expect(tr.classes()).toContain("is-done");
  });

  it("converts imperial weight input back to kg on emit", async () => {
    const wrapper = mount(SetRow, {
      props: {
        set: { set_number: 1, reps: 8, weight_kg: 80, done: false },
        plannedReps: 8,
        plannedWeightKg: 80,
        unitSystem: "imperial",
      },
    });
    const weightInput = wrapper.find('[data-test="set-weight"]');
    // User types 200 lb → ~90.7185 kg.
    await weightInput.setValue("200");
    const emitted = wrapper.emitted("edit");
    expect(emitted).toBeDefined();
    const last = defined(emitted, "emitted")[defined(emitted, "emitted").length - 1] as [
      number,
      { weight_kg: number | null },
    ];
    expect(last[0]).toBe(1);
    expect(last[1].weight_kg).toBeCloseTo(90.72, 1);
  });
});
