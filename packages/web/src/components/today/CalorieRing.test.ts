import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CalorieRing from "./CalorieRing.vue";

describe("CalorieRing", () => {
  it("shows magnitude and 'kcal left' when under target", () => {
    const wrapper = mount(CalorieRing, { props: { target: 1900, intake: 1380 } });
    expect(wrapper.find('[data-test="ring-number"]').text()).toBe("520");
    expect(wrapper.find('[data-test="ring-unit"]').text()).toContain("kcal left");
  });

  it("shows 'kcal over' but a positive magnitude when over target", () => {
    const wrapper = mount(CalorieRing, { props: { target: 1900, intake: 2020 } });
    expect(wrapper.find('[data-test="ring-number"]').text()).toBe("120");
    expect(wrapper.find('[data-test="ring-unit"]').text()).toContain("kcal over");
    // No minus sign anywhere in the number.
    expect(wrapper.find('[data-test="ring-number"]').text()).not.toContain("-");
  });

  it("keeps the ring in the kcal color when over (never red)", () => {
    const wrapper = mount(CalorieRing, { props: { target: 1900, intake: 2020 } });
    const arc = wrapper.find('[data-test="ring-arc"]');
    // stroke is the kcal token, not --bad. We assert the class that maps to it.
    expect(arc.classes()).toContain("arc");
    expect(arc.classes()).not.toContain("arc--over");
  });
});
