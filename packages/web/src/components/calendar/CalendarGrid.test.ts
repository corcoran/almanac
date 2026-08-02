import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CalendarGrid from "./CalendarGrid.vue";

function mountGrid(overrides: Record<string, unknown> = {}) {
  return mount(CalendarGrid, {
    props: {
      month: "2026-05",
      pastSessions: [],
      pillSegments: [],
      today: "2026-05-15",
      untrackedBands: [],
      ...overrides,
    },
  });
}

describe("CalendarGrid time-off tint", () => {
  it("tints every day inside a multi-day band and no others", () => {
    const wrapper = mountGrid({
      untrackedBands: [{ from: "2026-05-11", to: "2026-05-13", reason: "vacation" }],
    });
    for (const d of ["11", "12", "13"]) {
      const cell = wrapper.find(`[data-date="2026-05-${d}"]`);
      expect(cell.classes()).toContain("off-vacation");
    }
    expect(wrapper.find('[data-date="2026-05-10"]').classes()).not.toContain("off-vacation");
    expect(wrapper.find('[data-date="2026-05-14"]').classes()).not.toContain("off-vacation");
  });

  it("maps each reason to its own class", () => {
    const wrapper = mountGrid({
      untrackedBands: [
        { from: "2026-05-05", to: "2026-05-05", reason: "sick" },
        { from: "2026-05-20", to: "2026-05-22", reason: "deload" },
      ],
    });
    expect(wrapper.find('[data-date="2026-05-05"]').classes()).toContain("off-sick");
    expect(wrapper.find('[data-date="2026-05-21"]').classes()).toContain("off-deload");
  });

  it("tints a single-day band as exactly one cell", () => {
    const wrapper = mountGrid({
      untrackedBands: [{ from: "2026-05-09", to: "2026-05-09", reason: "vacation" }],
    });
    expect(wrapper.find('[data-date="2026-05-09"]').classes()).toContain("off-vacation");
    expect(wrapper.find('[data-date="2026-05-08"]').classes()).not.toContain("off-vacation");
    expect(wrapper.find('[data-date="2026-05-10"]').classes()).not.toContain("off-vacation");
  });

  it("includes both inclusive endpoints", () => {
    const wrapper = mountGrid({
      untrackedBands: [{ from: "2026-05-11", to: "2026-05-13", reason: "vacation" }],
    });
    expect(wrapper.find('[data-date="2026-05-11"]').classes()).toContain("off-vacation");
    expect(wrapper.find('[data-date="2026-05-13"]').classes()).toContain("off-vacation");
  });

  it("sets a capitalized reason tooltip on tinted cells and none on others", () => {
    const wrapper = mountGrid({
      untrackedBands: [{ from: "2026-05-12", to: "2026-05-12", reason: "vacation" }],
    });
    expect(wrapper.find('[data-date="2026-05-12"]').attributes("title")).toBe("Vacation");
    expect(wrapper.find('[data-date="2026-05-10"]').attributes("title")).toBeUndefined();
  });

  it("renders both the tint and a session chip when a day has both", () => {
    const wrapper = mountGrid({
      untrackedBands: [{ from: "2026-05-15", to: "2026-05-15", reason: "deload" }],
      pastSessions: [
        { date: "2026-05-15", workout_id: 1, template_id: 1, template_name: "PUSH A" },
      ],
    });
    const cell = wrapper.find('[data-date="2026-05-15"]');
    expect(cell.classes()).toContain("off-deload");
    // SessionChip truncates the visible label to its first 4 chars but keeps
    // the full template name in its `title`; either proves the chip renders
    // alongside the tint.
    const chip = cell.find(".session-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.attributes("title")).toBe("PUSH A");
  });

  it("applies no off-* class when there are no bands", () => {
    const html = mountGrid({ untrackedBands: [] }).html();
    expect(html).not.toContain("off-vacation");
    expect(html).not.toContain("off-sick");
    expect(html).not.toContain("off-deload");
  });
});

describe("CalendarGrid cell selection", () => {
  it("emits select with the cell date when a past day is clicked", async () => {
    const wrapper = mountGrid({ today: "2026-05-15", selectedDate: "2026-05-15" });
    await wrapper.find('[data-date="2026-05-10"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["2026-05-10"]);
  });

  it("does not emit select for a future day", async () => {
    const wrapper = mountGrid({ today: "2026-05-15", selectedDate: "2026-05-15" });
    await wrapper.find('[data-date="2026-05-20"]').trigger("click");
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("marks the selectedDate cell with the .selected class", () => {
    const wrapper = mountGrid({ today: "2026-05-15", selectedDate: "2026-05-10" });
    expect(wrapper.find('[data-date="2026-05-10"]').classes()).toContain("selected");
  });
});
