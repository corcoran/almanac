// packages/web/src/components/calendar/TallyHeader.test.ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TallyHeader from "./TallyHeader.vue";

const workoutProps = {
  month: "2026-05",
  tally: { total: 9, by_template: { "PUSH A": 4, "PULL A": 3, "LEGS A": 2 } },
  mode: "workouts" as const,
  intakeSummary: null,
};

describe("TallyHeader", () => {
  it("formats the month into a long-name year string", () => {
    const wrapper = mount(TallyHeader, { props: workoutProps });
    expect(wrapper.text()).toContain("May 2026");
  });

  it("renders the total and inline dotted per-template counts in workout mode", () => {
    const wrapper = mount(TallyHeader, { props: workoutProps });
    expect(wrapper.text()).toContain("Total 9");
    const chips = wrapper.findAll('[data-test="tally-chip"]');
    expect(chips).toHaveLength(3);
    expect(wrapper.text()).toContain("PUSH A 4");
    expect(wrapper.text()).toContain("PULL A 3");
    expect(wrapper.text()).toContain("LEGS A 2");
    // Separator and dot-color binding are part of the rendered contract.
    expect(wrapper.text()).toContain("Total 9 · PUSH A 4");
    expect(chips[0]?.find(".chip-dot").attributes("style")).toContain("background-color");
  });

  it("no longer renders the separate chips row", () => {
    const wrapper = mount(TallyHeader, { props: workoutProps });
    expect(wrapper.find(".cal-tally-chips").exists()).toBe(false);
  });

  it("renders the intake summary instead of the tally in intake mode", () => {
    const wrapper = mount(TallyHeader, {
      props: {
        ...workoutProps,
        mode: "intake" as const,
        intakeSummary: { logged: 6, on_target: 3, off_track: 2 },
      },
    });
    const summary = wrapper.get('[data-test="intake-summary"]');
    expect(summary.text()).toContain("6 logged");
    expect(summary.text()).toContain("3 on target");
    expect(summary.text()).toContain("2 off track");
    expect(wrapper.find('[data-test="workout-tally"]').exists()).toBe(false);
  });

  it("renders no summary while intake data is loading (null summary)", () => {
    const wrapper = mount(TallyHeader, {
      props: { ...workoutProps, mode: "intake" as const, intakeSummary: null },
    });
    expect(wrapper.find('[data-test="intake-summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="workout-tally"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("May 2026");
  });

  it("renders the mode toggle and emits update:mode", async () => {
    const wrapper = mount(TallyHeader, { props: workoutProps });
    await wrapper.get('[data-test="mode-intake"]').trigger("click");
    await wrapper.get('[data-test="mode-workouts"]').trigger("click");
    expect(wrapper.emitted("update:mode")).toEqual([["intake"], ["workouts"]]);
  });

  it("marks the active mode button", () => {
    const wrapper = mount(TallyHeader, { props: { ...workoutProps, mode: "intake" as const } });
    expect(wrapper.get('[data-test="mode-intake"]').classes()).toContain("active");
    expect(wrapper.get('[data-test="mode-workouts"]').classes()).not.toContain("active");
  });

  it("emits prev/next when the nav buttons are clicked", async () => {
    const wrapper = mount(TallyHeader, { props: workoutProps });
    await wrapper.get('[data-test="cal-prev"]').trigger("click");
    await wrapper.get('[data-test="cal-next"]').trigger("click");
    expect(wrapper.emitted("prev")).toHaveLength(1);
    expect(wrapper.emitted("next")).toHaveLength(1);
  });
});
