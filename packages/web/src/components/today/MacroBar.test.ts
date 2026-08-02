import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MacroBar from "./MacroBar.vue";

describe("MacroBar", () => {
  it("renders name, 'N g left', and the macro color class when under target", () => {
    const wrapper = mount(MacroBar, {
      props: { name: "Protein", macro: "protein", target: 180, intake: 116 },
    });
    expect(wrapper.text()).toContain("Protein");
    expect(wrapper.find('[data-test="macro-value"]').text()).toContain("64");
    expect(wrapper.find('[data-test="macro-value"]').text()).toContain("g left");
    expect(wrapper.find(".bar-fill").classes()).toContain("protein");
  });

  it("renders 'N g over' but keeps the macro color (never red) when over", () => {
    const wrapper = mount(MacroBar, {
      props: { name: "Carbs", macro: "carb", target: 165, intake: 168.5 },
    });
    expect(wrapper.find('[data-test="macro-value"]').text()).toContain("3.5");
    expect(wrapper.find('[data-test="macro-value"]').text()).toContain("g over");
    // own color, not --bad / not a red class.
    expect(wrapper.find(".bar-fill").classes()).toContain("carb");
    expect(wrapper.find(".bar-fill").classes()).not.toContain("over");
  });
});
