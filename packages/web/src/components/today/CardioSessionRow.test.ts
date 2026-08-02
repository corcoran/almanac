import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CardioSessionRow from "./CardioSessionRow.vue";

const SESSION = { id: 7, modality: "run", duration_min: 32, est_kcal: 410 };

describe("CardioSessionRow", () => {
  it("renders modality, duration, and kcal in read-only mode", () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    const text = wrapper.text();
    expect(text).toContain("run");
    expect(text).toContain("32");
    expect(text).toContain("410");
    expect(wrapper.find('[data-test="cardio-row-edit"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="cardio-row-delete"]').exists()).toBe(true);
  });

  it("falls back to 'Cardio' when modality is null", () => {
    const wrapper = mount(CardioSessionRow, {
      props: { session: { ...SESSION, modality: null } },
    });
    expect(wrapper.text().toLowerCase()).toContain("cardio");
    expect(wrapper.text()).not.toContain("null");
  });

  it("omits duration when null", () => {
    const wrapper = mount(CardioSessionRow, {
      props: { session: { ...SESSION, duration_min: null } },
    });
    expect(wrapper.text()).not.toContain("null");
    expect(wrapper.text()).toContain("410");
  });

  it("clicking edit shows the form pre-filled", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    expect(
      (wrapper.find('[data-test="cardio-modality-input"]').element as HTMLInputElement).value,
    ).toBe("run");
    expect(
      (wrapper.find('[data-test="cardio-duration-input"]').element as HTMLInputElement).value,
    ).toBe("32");
    expect(
      (wrapper.find('[data-test="cardio-kcal-input"]').element as HTMLInputElement).value,
    ).toBe("410");
  });

  it("disables Save when kcal is empty or negative", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    const kcal = wrapper.find('[data-test="cardio-kcal-input"]');
    const save = wrapper.find('[data-test="cardio-row-save"]');
    await kcal.setValue("");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await kcal.setValue("-5");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await kcal.setValue("0");
    expect((save.element as HTMLButtonElement).disabled).toBe(false);
    await kcal.setValue("300");
    expect((save.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("emits save with the edited fields (blank modality/duration → null)", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    await wrapper.find('[data-test="cardio-modality-input"]').setValue("");
    await wrapper.find('[data-test="cardio-duration-input"]').setValue("");
    await wrapper.find('[data-test="cardio-kcal-input"]').setValue("250");
    await wrapper.find('[data-test="cardio-row-save"]').trigger("click");
    expect(wrapper.emitted("save")).toEqual([
      [{ modality: null, duration_min: null, est_kcal: 250 }],
    ]);
  });

  it("emits save with trimmed modality and parsed duration", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    await wrapper.find('[data-test="cardio-modality-input"]').setValue("  bike ");
    await wrapper.find('[data-test="cardio-duration-input"]').setValue("40");
    await wrapper.find('[data-test="cardio-kcal-input"]').setValue("300");
    await wrapper.find('[data-test="cardio-row-save"]').trigger("click");
    expect(wrapper.emitted("save")).toEqual([
      [{ modality: "bike", duration_min: 40, est_kcal: 300 }],
    ]);
  });

  it("cancel exits edit mode without emitting", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    await wrapper.find('[data-test="cardio-row-cancel"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-modality-input"]').exists()).toBe(false);
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("closes the edit form after a successful save", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    await wrapper.find('[data-test="cardio-kcal-input"]').setValue("300");
    await wrapper.find('[data-test="cardio-row-save"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-kcal-input"]').exists()).toBe(false);
  });

  it("rejects malformed kcal and coerces bad/zero duration to null", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    const kcal = wrapper.find('[data-test="cardio-kcal-input"]');
    const save = wrapper.find('[data-test="cardio-row-save"]');
    // malformed kcal disables save
    await kcal.setValue("12abc");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await kcal.setValue("3.5");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    // valid kcal, but duration "0" → null on emit (API requires > 0)
    await kcal.setValue("300");
    await wrapper.find('[data-test="cardio-duration-input"]').setValue("0");
    await save.trigger("click");
    expect(wrapper.emitted("save")).toEqual([
      [{ modality: "run", duration_min: null, est_kcal: 300 }],
    ]);
  });

  it("disables Save and delete while pending", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION, pending: true } });
    expect(
      (wrapper.find('[data-test="cardio-row-delete"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    // valid kcal but pending → Save still disabled
    expect(
      (wrapper.find('[data-test="cardio-row-save"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("delete shows a confirm; Yes emits delete with the id, No cancels", async () => {
    const wrapper = mount(CardioSessionRow, { props: { session: SESSION } });
    await wrapper.find('[data-test="cardio-row-delete"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-delete-confirm"]').exists()).toBe(true);
    await wrapper.find('[data-test="cardio-delete-no"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-delete-confirm"]').exists()).toBe(false);
    expect(wrapper.emitted("delete")).toBeUndefined();
    await wrapper.find('[data-test="cardio-row-delete"]').trigger("click");
    await wrapper.find('[data-test="cardio-delete-yes"]').trigger("click");
    expect(wrapper.emitted("delete")).toEqual([[7]]);
  });
});
