import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import QualityPicker from "./QualityPicker.vue";

describe("QualityPicker", () => {
  it("renders five buttons labelled 1–5", () => {
    const wrapper = mount(QualityPicker, { props: { modelValue: null } });
    const btns = wrapper.findAll('[data-test="quality-option"]');
    expect(btns).toHaveLength(5);
    expect(btns.map((b) => b.text())).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("marks the button matching modelValue as pressed", () => {
    const wrapper = mount(QualityPicker, { props: { modelValue: 4 } });
    const btns = wrapper.findAll('[data-test="quality-option"]');
    expect(btns[3]?.attributes("aria-pressed")).toBe("true");
    expect(btns[0]?.attributes("aria-pressed")).toBe("false");
  });

  it("marks none pressed when modelValue is null", () => {
    const wrapper = mount(QualityPicker, { props: { modelValue: null } });
    const pressed = wrapper
      .findAll('[data-test="quality-option"]')
      .filter((b) => b.attributes("aria-pressed") === "true");
    expect(pressed).toHaveLength(0);
  });

  it("emits the clicked value", async () => {
    const wrapper = mount(QualityPicker, { props: { modelValue: null } });
    await wrapper.findAll('[data-test="quality-option"]')[2]?.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[3]]);
  });

  it("emits null when the already-selected button is clicked (clear)", async () => {
    const wrapper = mount(QualityPicker, { props: { modelValue: 3 } });
    await wrapper.findAll('[data-test="quality-option"]')[2]?.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[null]]);
  });

  it("uses a default group aria-label of 'Quality'", () => {
    const wrapper = mount(QualityPicker, { props: { modelValue: null } });
    expect(wrapper.find('[role="group"]').attributes("aria-label")).toBe("Quality");
  });

  it("uses a custom group aria-label when label is provided", () => {
    const wrapper = mount(QualityPicker, { props: { modelValue: null, label: "Sleep quality" } });
    expect(wrapper.find('[role="group"]').attributes("aria-label")).toBe("Sleep quality");
  });
});
