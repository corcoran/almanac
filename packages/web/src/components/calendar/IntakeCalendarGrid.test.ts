import type { DayMacrosResponseSchema } from "@almanac/core/schemas";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import IntakeCalendarGrid from "./IntakeCalendarGrid.vue";

type DayMacros = z.infer<typeof DayMacrosResponseSchema>;
type Status = "on_track" | "at_risk" | "off_track";

function makeDay(
  date: string,
  over: {
    kcal?: number;
    alcohol?: number;
    status?: Status | null;
    vsTarget?: number;
    untracked?: boolean;
  } = {},
): DayMacros {
  const kcal = over.kcal ?? 1914;
  const alcohol = over.alcohol ?? 0;
  const status = over.status === undefined ? "on_track" : over.status;
  const vsTarget = over.vsTarget ?? 14;
  return {
    date,
    day_totals: {
      kcal,
      protein_g: 150,
      carb_g: 180,
      fat_g: 60,
      kcal_from_food: kcal - alcohol,
      kcal_from_alcohol: alcohol,
    },
    day_target:
      status === null
        ? null
        : {
            target: { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 70 },
            maintenance: { kcal: 2370 },
            intake: { kcal, protein_g: 150, carb_g: 180, fat_g: 60 },
            observed: {
              cardio_kcal: 0,
              workout_kcal: 0,
              steps_kcal: 0,
              vs_target: vsTarget,
              vs_maintenance: kcal - 2370,
              status,
            },
          },
    net_kcal: null,
    untracked: over.untracked ?? false,
  };
}

function mountGrid(days: DayMacros[]) {
  return mount(IntakeCalendarGrid, {
    props: { month: "2026-06", today: "2026-06-10", days },
  });
}

function cell(wrapper: ReturnType<typeof mountGrid>, date: string) {
  return wrapper.get(`[data-date="${date}"]`);
}

describe("IntakeCalendarGrid", () => {
  it("renders 42 cells plus the DOW header", () => {
    const wrapper = mountGrid([]);
    expect(wrapper.findAll("[data-date]")).toHaveLength(42);
  });

  it("tints an on-track day green with kcal and signed delta", () => {
    const wrapper = mountGrid([makeDay("2026-06-01", { status: "on_track", vsTarget: 14 })]);
    const c = cell(wrapper, "2026-06-01");
    expect(c.classes()).toContain("ok");
    expect(c.text()).toContain("1,914");
    expect(c.text()).toContain("+14");
  });

  it("tints at-risk amber and off-track red", () => {
    const wrapper = mountGrid([
      makeDay("2026-06-03", { status: "at_risk", vsTarget: 310 }),
      makeDay("2026-06-05", { status: "off_track", vsTarget: 580 }),
    ]);
    expect(cell(wrapper, "2026-06-03").classes()).toContain("risk");
    expect(cell(wrapper, "2026-06-05").classes()).toContain("off");
  });

  it("renders a negative delta with the U+2212 minus", () => {
    const wrapper = mountGrid([makeDay("2026-06-02", { kcal: 1755, vsTarget: -145 })]);
    expect(cell(wrapper, "2026-06-02").text()).toContain("−145");
  });

  it("renders ±0 for a dead-on delta", () => {
    const wrapper = mountGrid([makeDay("2026-06-02", { vsTarget: 0 })]);
    expect(cell(wrapper, "2026-06-02").text()).toContain("±0");
  });

  it("shows the beer line only when alcohol kcal is positive", () => {
    const wrapper = mountGrid([
      makeDay("2026-06-05", { alcohol: 412 }),
      makeDay("2026-06-09", { alcohol: 0 }),
    ]);
    expect(cell(wrapper, "2026-06-05").text()).toContain("🍺 412");
    expect(cell(wrapper, "2026-06-09").text()).not.toContain("🍺");
  });

  it("renders untracked days as solid gray with a skipped label and no numbers", () => {
    const wrapper = mountGrid([makeDay("2026-06-06", { untracked: true, kcal: 800 })]);
    const c = cell(wrapper, "2026-06-06");
    expect(c.classes()).toContain("untracked");
    expect(c.text()).toContain("skipped");
    expect(c.text()).not.toContain("800");
  });

  it("untracked wins over today", () => {
    const wrapper = mountGrid([makeDay("2026-06-10", { untracked: true })]);
    const c = cell(wrapper, "2026-06-10");
    expect(c.classes()).toContain("untracked");
    expect(c.classes()).not.toContain("progress");
  });

  it("renders an unlogged past day as an empty faint cell", () => {
    const wrapper = mountGrid([makeDay("2026-06-04", { kcal: 0 })]);
    const c = cell(wrapper, "2026-06-04");
    expect(c.classes()).toContain("unlogged");
    expect(c.text().trim()).toBe("4");
  });

  it("renders today with stripes, kcal and a neutral delta", () => {
    const wrapper = mountGrid([makeDay("2026-06-10", { kcal: 1140, vsTarget: -760 })]);
    const c = cell(wrapper, "2026-06-10");
    expect(c.classes()).toContain("progress");
    expect(c.text()).toContain("1,140");
    expect(c.text()).toContain("−760");
  });

  it("renders today with zero intake as stripes and day number only", () => {
    const wrapper = mountGrid([makeDay("2026-06-10", { kcal: 0 })]);
    const c = cell(wrapper, "2026-06-10");
    expect(c.classes()).toContain("progress");
    expect(c.text().trim()).toBe("10");
  });

  it("renders a no-target day with kcal but no delta or tint", () => {
    const wrapper = mountGrid([makeDay("2026-06-01", { status: null, kcal: 2105 })]);
    const c = cell(wrapper, "2026-06-01");
    expect(c.classes()).toContain("notarget");
    expect(c.text()).toContain("2,105");
    expect(c.text()).not.toMatch(/[+−±]/);
  });

  it("leaves future days empty", () => {
    const wrapper = mountGrid([makeDay("2026-06-01")]);
    const c = cell(wrapper, "2026-06-15");
    expect(c.text().trim()).toBe("15");
    expect(c.classes()).not.toContain("ok");
  });

  it("suppresses data on out-of-month spill cells even when present in days", () => {
    const wrapper = mountGrid([makeDay("2026-05-31", { status: "on_track" })]);
    const c = cell(wrapper, "2026-05-31");
    expect(c.classes()).toContain("dim");
    expect(c.classes()).not.toContain("ok");
    expect(c.text().trim()).toBe("31");
  });

  it("renders the legend footer", () => {
    const wrapper = mountGrid([]);
    const legend = wrapper.get('[data-test="intake-legend"]');
    for (const label of [
      "on target",
      "at risk",
      "off track",
      "untracked",
      "unlogged",
      "in progress",
    ]) {
      expect(legend.text()).toContain(label);
    }
  });
});

describe("IntakeCalendarGrid cell selection", () => {
  it("emits select with the cell date when a past day is clicked", async () => {
    const wrapper = mount(IntakeCalendarGrid, {
      props: { month: "2026-06", today: "2026-06-10", days: [], selectedDate: "2026-06-10" },
    });
    await wrapper.find('[data-date="2026-06-05"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["2026-06-05"]);
  });

  it("does not emit select for a future day", async () => {
    const wrapper = mount(IntakeCalendarGrid, {
      props: { month: "2026-06", today: "2026-06-10", days: [], selectedDate: "2026-06-10" },
    });
    await wrapper.find('[data-date="2026-06-15"]').trigger("click");
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("marks the selectedDate cell with the .selected class", () => {
    const wrapper = mount(IntakeCalendarGrid, {
      props: { month: "2026-06", today: "2026-06-10", days: [], selectedDate: "2026-06-05" },
    });
    expect(wrapper.find('[data-date="2026-06-05"]').classes()).toContain("selected");
  });
});
