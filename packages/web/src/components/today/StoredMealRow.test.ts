import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import StoredMealRow from "./StoredMealRow.vue";

function makeStored(overrides = {}) {
  return {
    id: 1,
    user_id: 1,
    name: "My usual breakfast",
    kcal: 520,
    protein_g: 32,
    carb_g: 50,
    fat_g: 18,
    description: null as string | null,
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("StoredMealRow read mode", () => {
  it("renders name + macros and the log/edit/delete actions (no time)", () => {
    const wrapper = mount(StoredMealRow, { props: { storedMeal: makeStored() } });
    expect(wrapper.find('[data-test="stored-row"]').exists()).toBe(true);
    const text = wrapper.text();
    expect(text).toContain("My usual breakfast");
    expect(text).toContain("520");
    expect(text).toContain("32");
    expect(wrapper.find('[data-test="stored-row-log"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="stored-row-edit"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="stored-row-delete"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="stored-time"]').exists()).toBe(false);
  });

  it("sets the title attribute to the full name", () => {
    const wrapper = mount(StoredMealRow, {
      props: { storedMeal: makeStored({ name: "Long stored meal name" }) },
    });
    expect(wrapper.find('[data-test="stored-name"]').attributes("title")).toBe(
      "Long stored meal name",
    );
  });

  it("emits log(id) when the log button is clicked", async () => {
    const wrapper = mount(StoredMealRow, { props: { storedMeal: makeStored({ id: 7 }) } });
    await wrapper.find('[data-test="stored-row-log"]').trigger("click");
    expect(wrapper.emitted("log")).toEqual([[7]]);
  });

  it("shows inline Delete? and emits delete(id) on Yes", async () => {
    const wrapper = mount(StoredMealRow, { props: { storedMeal: makeStored({ id: 9 }) } });
    await wrapper.find('[data-test="stored-row-delete"]').trigger("click");
    expect(wrapper.text()).toContain("Delete?");
    await wrapper.find('[data-test="stored-delete-yes"]').trigger("click");
    expect(wrapper.emitted("delete")).toEqual([[9]]);
  });

  it("reverts to read mode on No without emitting delete", async () => {
    const wrapper = mount(StoredMealRow, { props: { storedMeal: makeStored() } });
    await wrapper.find('[data-test="stored-row-delete"]').trigger("click");
    await wrapper.find('[data-test="stored-delete-no"]').trigger("click");
    expect(wrapper.find('[data-test="stored-row-delete"]').exists()).toBe(true);
    expect(wrapper.emitted("delete")).toBeUndefined();
  });
});

describe("StoredMealRow edit mode", () => {
  it("enters edit prefilled from the stored meal", async () => {
    const wrapper = mount(StoredMealRow, { props: { storedMeal: makeStored() } });
    await wrapper.find('[data-test="stored-row-edit"]').trigger("click");
    expect((wrapper.find('[data-test="stored-edit-name"]').element as HTMLInputElement).value).toBe(
      "My usual breakfast",
    );
    expect((wrapper.find('[data-test="stored-edit-kcal"]').element as HTMLInputElement).value).toBe(
      "520",
    );
    expect(wrapper.find('[data-test="stored-edit-time"]').exists()).toBe(false);
  });

  it("disables Save until BOTH name is non-empty AND kcal is valid", async () => {
    const wrapper = mount(StoredMealRow, { props: { storedMeal: makeStored() } });
    await wrapper.find('[data-test="stored-row-edit"]').trigger("click");
    const name = wrapper.find('[data-test="stored-edit-name"]');
    const kcal = wrapper.find('[data-test="stored-edit-kcal"]');
    const saveBtn = () =>
      wrapper.find('[data-test="stored-edit-save"]').element as HTMLButtonElement;
    await name.setValue("");
    expect(saveBtn().disabled).toBe(true);
    await name.setValue("Breakfast");
    await kcal.setValue("");
    expect(saveBtn().disabled).toBe(true);
    await kcal.setValue("400");
    expect(saveBtn().disabled).toBe(false);
  });

  it("emits save with name + macros (no time)", async () => {
    const wrapper = mount(StoredMealRow, { props: { storedMeal: makeStored() } });
    await wrapper.find('[data-test="stored-row-edit"]').trigger("click");
    await wrapper.find('[data-test="stored-edit-name"]').setValue("Big breakfast");
    await wrapper.find('[data-test="stored-edit-kcal"]').setValue("600");
    await wrapper.find('[data-test="stored-edit-protein"]').setValue("40");
    await wrapper.find('[data-test="stored-edit-carb"]').setValue("55");
    await wrapper.find('[data-test="stored-edit-fat"]').setValue("20");
    await wrapper.find('[data-test="stored-edit-save"]').trigger("click");
    expect(wrapper.emitted("save")).toEqual([
      [{ name: "Big breakfast", kcal: 600, protein_g: 40, carb_g: 55, fat_g: 20 }],
    ]);
  });

  it("opens directly in edit mode with blank drafts when startEditing", () => {
    const wrapper = mount(StoredMealRow, {
      props: {
        storedMeal: makeStored({ name: "", kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }),
        startEditing: true,
      },
    });
    expect(wrapper.find('[data-test="stored-edit-form"]').exists()).toBe(true);
    expect((wrapper.find('[data-test="stored-edit-name"]').element as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("emits cancel-add when cancelling an add-mode row", async () => {
    const wrapper = mount(StoredMealRow, {
      props: { storedMeal: makeStored({ name: "", kcal: 0 }), startEditing: true },
    });
    await wrapper.find('[data-test="stored-edit-cancel"]').trigger("click");
    expect(wrapper.emitted("cancel-add")).toBeTruthy();
  });
});
