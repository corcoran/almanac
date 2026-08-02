import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MealRow from "./MealRow.vue";

function makeMeal(overrides = {}) {
  return {
    id: 1,
    user_id: 1,
    eaten_at: "2026-05-21T13:15:00Z",
    name: "Chicken burrito" as string | null,
    kcal: 680,
    protein_g: 42,
    carb_g: 71,
    fat_g: 22,
    notes: null as string | null,
    created_at: "2026-05-21T13:15:00Z",
    ...overrides,
  };
}

describe("MealRow read mode", () => {
  it("renders time, name, kcal and macros with edit/delete actions", () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal() } });
    expect(wrapper.find('[data-test="meal-row"]').exists()).toBe(true);
    const text = wrapper.text();
    expect(text).toContain("Chicken burrito");
    expect(text).toContain("680");
    expect(text).toContain("42");
    expect(wrapper.find('[data-test="meal-row-edit"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="meal-row-delete"]').exists()).toBe(true);
  });

  it("falls back to '(unnamed)' when name is null", () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal({ name: null }) } });
    expect(wrapper.find('[data-test="meal-name"]').text()).toBe("(unnamed)");
  });

  it("sets the title attribute to the full name for truncation tooltip", () => {
    const wrapper = mount(MealRow, {
      props: { meal: makeMeal({ name: "A very long meal name" }) },
    });
    expect(wrapper.find('[data-test="meal-name"]').attributes("title")).toBe(
      "A very long meal name",
    );
  });
});

describe("MealRow delete confirm", () => {
  it("shows inline 'Delete?' Yes/No when delete is clicked", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal() } });
    await wrapper.find('[data-test="meal-row-delete"]').trigger("click");
    expect(wrapper.text()).toContain("Delete?");
    expect(wrapper.find('[data-test="meal-delete-yes"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="meal-delete-no"]').exists()).toBe(true);
  });

  it("emits delete(id) when Yes is clicked", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal({ id: 9 }) } });
    await wrapper.find('[data-test="meal-row-delete"]').trigger("click");
    await wrapper.find('[data-test="meal-delete-yes"]').trigger("click");
    expect(wrapper.emitted("delete")).toEqual([[9]]);
  });

  it("reverts to read mode when No is clicked, no emit", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal() } });
    await wrapper.find('[data-test="meal-row-delete"]').trigger("click");
    await wrapper.find('[data-test="meal-delete-no"]').trigger("click");
    expect(wrapper.find('[data-test="meal-row-delete"]').exists()).toBe(true);
    expect(wrapper.emitted("delete")).toBeUndefined();
  });
});

describe("MealRow edit mode", () => {
  it("enters edit mode prefilled from the meal", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal() } });
    await wrapper.find('[data-test="meal-row-edit"]').trigger("click");
    expect((wrapper.find('[data-test="meal-edit-name"]').element as HTMLInputElement).value).toBe(
      "Chicken burrito",
    );
    expect((wrapper.find('[data-test="meal-edit-kcal"]').element as HTMLInputElement).value).toBe(
      "680",
    );
    expect(
      (wrapper.find('[data-test="meal-edit-protein"]').element as HTMLInputElement).value,
    ).toBe("42");
  });

  it("disables Save until kcal is a valid non-negative integer", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal({ kcal: 0 }) } });
    await wrapper.find('[data-test="meal-row-edit"]').trigger("click");
    const kcal = wrapper.find('[data-test="meal-edit-kcal"]');
    await kcal.setValue("");
    expect(
      (wrapper.find('[data-test="meal-edit-save"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
    await kcal.setValue("500");
    expect(
      (wrapper.find('[data-test="meal-edit-save"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("emits save with macros, name, and the user-local HH:MM time", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal() } });
    await wrapper.find('[data-test="meal-row-edit"]').trigger("click");
    await wrapper.find('[data-test="meal-edit-name"]').setValue("Burrito bowl");
    await wrapper.find('[data-test="meal-edit-kcal"]').setValue("700");
    await wrapper.find('[data-test="meal-edit-protein"]').setValue("44");
    await wrapper.find('[data-test="meal-edit-carb"]').setValue("70");
    await wrapper.find('[data-test="meal-edit-fat"]').setValue("20");
    await wrapper.find('[data-test="meal-edit-time"]').setValue("12:30");
    await wrapper.find('[data-test="meal-edit-save"]').trigger("click");
    expect(wrapper.emitted("save")).toEqual([
      [{ name: "Burrito bowl", kcal: 700, protein_g: 44, carb_g: 70, fat_g: 20, time: "12:30" }],
    ]);
  });

  it("emits null name when the name field is blank", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal({ name: null }) } });
    await wrapper.find('[data-test="meal-row-edit"]').trigger("click");
    await wrapper.find('[data-test="meal-edit-kcal"]').setValue("300");
    await wrapper.find('[data-test="meal-edit-save"]').trigger("click");
    const payload = wrapper.emitted("save")?.[0]?.[0] as { name: string | null };
    expect(payload.name).toBeNull();
  });

  it("emits the raw time string (including empty) — parent owns date composition", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal() } });
    await wrapper.find('[data-test="meal-row-edit"]').trigger("click");
    await wrapper.find('[data-test="meal-edit-kcal"]').setValue("400");
    await wrapper.find('[data-test="meal-edit-time"]').setValue("");
    await wrapper.find('[data-test="meal-edit-save"]').trigger("click");
    const payload = wrapper.emitted("save")?.[0]?.[0] as { time: string };
    expect(payload.time).toBe("");
  });

  it("cancels edit mode without emitting", async () => {
    const wrapper = mount(MealRow, { props: { meal: makeMeal() } });
    await wrapper.find('[data-test="meal-row-edit"]').trigger("click");
    await wrapper.find('[data-test="meal-edit-cancel"]').trigger("click");
    expect(wrapper.find('[data-test="meal-row-edit"]').exists()).toBe(true);
    expect(wrapper.emitted("save")).toBeUndefined();
  });
});
