import { at } from "@almanac/core/test-support";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DayBarChart, { type ChartBar } from "./DayBarChart.vue";

const bars: ChartBar[] = [
  {
    key: "2026-10-04",
    logged: true,
    heightPct: 50,
    color: "rgb(1, 2, 3)",
    valueLabel: "5k",
    dayLabel: "Sa",
    ariaLabel: "Edit x for Sat 4 Oct",
    highlighted: false,
    classes: ["short"],
  },
  {
    key: "2026-10-05",
    logged: false,
    heightPct: 0,
    dayLabel: "Su",
    ariaLabel: "Edit x for Sun 5 Oct",
    highlighted: true,
  },
];

describe("DayBarChart", () => {
  it("renders logged bars and ghosts as labelled buttons", () => {
    const wrapper = mount(DayBarChart, { props: { testId: "x", bars, editingKey: null } });
    const bar = wrapper.find('[data-test="x-bar"]');
    expect(bar.element.tagName).toBe("BUTTON");
    expect(bar.attributes("aria-label")).toBe("Edit x for Sat 4 Oct");
    expect(bar.attributes("style")).toContain("height: 50%");
    expect(bar.attributes("style")).toContain("background-color: rgb(1, 2, 3)");
    expect(bar.classes()).toContain("short");
    expect(bar.find('[data-test="x-bar-value"]').text()).toBe("5k");
    expect(bar.find(".lbl").text()).toBe("Sa");
    const ghost = wrapper.find('[data-test="x-ghost"]');
    expect(ghost.element.tagName).toBe("BUTTON");
    expect(ghost.find(".lbl").text()).toBe("Su");
  });

  it("marks the highlighted bar and the one being edited", () => {
    const wrapper = mount(DayBarChart, {
      props: { testId: "x", bars, editingKey: "2026-10-04" },
    });
    expect(wrapper.find('[data-test="x-ghost"]').classes()).toContain("target");
    expect(wrapper.find('[data-test="x-bar"]').classes()).not.toContain("target");
    expect(wrapper.find('[data-test="x-bar"]').classes()).toContain("editing");
    expect(wrapper.find('[data-test="x-ghost"]').classes()).not.toContain("editing");
  });

  it("emits select with the bar's key", async () => {
    const wrapper = mount(DayBarChart, { props: { testId: "x", bars, editingKey: null } });
    await wrapper.find('[data-test="x-ghost"]').trigger("click");
    await wrapper.find('[data-test="x-bar"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([["2026-10-05"], ["2026-10-04"]]);
  });

  it("draws an optional reference line", () => {
    const without = mount(DayBarChart, { props: { testId: "x", bars, editingKey: null } });
    expect(without.find('[data-test="x-reference"]').exists()).toBe(false);
    const withRef = mount(DayBarChart, {
      props: { testId: "x", bars, editingKey: null, reference: { pct: 80, label: "8h" } },
    });
    const ref = withRef.find('[data-test="x-reference"]');
    expect(ref.text()).toBe("8h");
    expect(ref.attributes("style")).toContain("bottom: 80%");
  });

  it("keeps bars in the given order", () => {
    const wrapper = mount(DayBarChart, { props: { testId: "x", bars, editingKey: null } });
    const labels = wrapper.findAll(".lbl").map((l) => l.text());
    expect(labels).toEqual(["Sa", "Su"]);
    expect(at(labels, 0)).toBe("Sa");
  });
});
