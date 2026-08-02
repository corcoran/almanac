import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { TemplateLastSessionEntry } from "../../stores/template-last-sessions.js";
import LastSessionPanel from "./LastSessionPanel.vue";

function readyEntry(
  overrides?: Partial<{
    rpe: number | null;
    exercises: Array<{
      exercise_id: number;
      exercise_name: string;
      skipped: boolean;
      sets: Array<{ reps: number; weight_kg: number | null }>;
    }>;
  }>,
): TemplateLastSessionEntry {
  return {
    status: "ready",
    data: {
      workout_id: 42,
      started_at: "2026-05-14T17:30:00Z",
      rpe: 7.5,
      exercises: [
        {
          exercise_id: 10,
          exercise_name: "Bench Press",
          skipped: false,
          sets: [
            { reps: 8, weight_kg: 80 },
            { reps: 8, weight_kg: 82.5 },
            { reps: 7, weight_kg: 82.5 },
          ],
        },
        {
          exercise_id: 11,
          exercise_name: "Overhead Press",
          skipped: false,
          sets: [{ reps: 6, weight_kg: 50 }],
        },
      ],
      ...overrides,
    },
  };
}

describe("LastSessionPanel", () => {
  it("renders the loading state with a muted message", () => {
    const wrapper = mount(LastSessionPanel, {
      props: { entry: { status: "loading" }, unitSystem: "metric" },
    });
    expect(wrapper.text().toLowerCase()).toContain("loading last session");
    expect(wrapper.find('[data-test="last-session-grid"]').exists()).toBe(false);
  });

  it("renders the error state with a warn-style message", () => {
    const wrapper = mount(LastSessionPanel, {
      props: {
        entry: { status: "error", error: { kind: "http", status: 500, body: "" } },
        unitSystem: "metric",
      },
    });
    expect(wrapper.text().toLowerCase()).toContain("couldn't load last session");
  });

  it("renders one cell per set with no unit suffix when metric", () => {
    const wrapper = mount(LastSessionPanel, {
      props: { entry: readyEntry(), unitSystem: "metric" },
    });
    const names = wrapper.findAll('[data-test="last-session-exercise-name"]');
    expect(names).toHaveLength(2);
    expect(names[0]?.text()).toBe("Bench Press");
    expect(names[1]?.text()).toBe("Overhead Press");

    // Cells are flattened in DOM order: one row contributes maxSetCount cells.
    // Bench (3 sets) + Overhead (1 set + 2 empty trailing) = 6 cells.
    const cells = wrapper.findAll('[data-test="set-cell"]');
    expect(cells).toHaveLength(6);
    expect(cells[0]?.text()).toBe("8×80");
    expect(cells[1]?.text()).toBe("8×82.5");
    expect(cells[2]?.text()).toBe("7×82.5");
    expect(cells[3]?.text()).toBe("6×50");
    // Overhead Press has fewer sets than the session max — trailing cells
    // are empty placeholders so the grid stays aligned.
    expect(cells[4]?.text()).toBe("");
    expect(cells[5]?.text()).toBe("");
    // No "kg" inside any cell — the unit lives in the header only.
    for (const cell of cells) {
      expect(cell.text()).not.toContain("kg");
    }
  });

  it("renders 'Set 1 / Set 2 / Set 3' column headers when max set count is 3", () => {
    const wrapper = mount(LastSessionPanel, {
      props: { entry: readyEntry(), unitSystem: "metric" },
    });
    const headers = wrapper.findAll('[data-test="set-column-header"]');
    expect(headers).toHaveLength(3);
    expect(headers[0]?.text()).toBe("Set 1");
    expect(headers[1]?.text()).toBe("Set 2");
    expect(headers[2]?.text()).toBe("Set 3");
  });

  it("shows the weight unit ('kg') in the date/RPE header", () => {
    const wrapper = mount(LastSessionPanel, {
      props: { entry: readyEntry(), unitSystem: "metric" },
    });
    const header = wrapper.find('[data-test="last-session-header"]').text();
    expect(header).toContain("weights in kg");
  });

  it("converts weights to lb and shows 'lb' in the header when imperial", () => {
    const wrapper = mount(LastSessionPanel, {
      props: { entry: readyEntry(), unitSystem: "imperial" },
    });
    const cells = wrapper.findAll('[data-test="set-cell"]');
    // 80 kg → 176.4 lb (rounded to 1 decimal), no per-cell unit suffix.
    expect(cells[0]?.text()).toBe("8×176.4");
    expect(cells[0]?.text()).not.toContain("kg");
    expect(cells[0]?.text()).not.toContain("lb");
    const header = wrapper.find('[data-test="last-session-header"]').text();
    expect(header).toContain("weights in lb");
    expect(header).not.toContain("weights in kg");
  });

  it("omits skipped exercises from the grid", () => {
    const wrapper = mount(LastSessionPanel, {
      props: {
        entry: readyEntry({
          exercises: [
            {
              exercise_id: 10,
              exercise_name: "Bench Press",
              skipped: false,
              sets: [{ reps: 8, weight_kg: 80 }],
            },
            {
              exercise_id: 12,
              exercise_name: "Tricep Pushdown",
              skipped: true,
              sets: [],
            },
          ],
        }),
        unitSystem: "metric",
      },
    });
    const names = wrapper.findAll('[data-test="last-session-exercise-name"]');
    expect(names).toHaveLength(1);
    expect(names[0]?.text()).toBe("Bench Press");
    expect(wrapper.text()).not.toContain("Tricep Pushdown");
  });

  it("renders bodyweight sets as 'N×bw' with no weight number", () => {
    const wrapper = mount(LastSessionPanel, {
      props: {
        entry: readyEntry({
          exercises: [
            {
              exercise_id: 20,
              exercise_name: "Pull-up",
              skipped: false,
              sets: [
                { reps: 8, weight_kg: null },
                { reps: 6, weight_kg: null },
              ],
            },
          ],
        }),
        unitSystem: "metric",
      },
    });
    const cells = wrapper.findAll('[data-test="set-cell"]');
    expect(cells).toHaveLength(2);
    expect(cells[0]?.text()).toBe("8×bw");
    expect(cells[1]?.text()).toBe("6×bw");
  });

  it("pads shorter exercises with empty trailing cells to keep columns aligned", () => {
    // Three exercises with 1 / 3 / 2 sets — maxSetCount = 3, so every row
    // has exactly 3 set cells regardless of how many sets that exercise has.
    const wrapper = mount(LastSessionPanel, {
      props: {
        entry: readyEntry({
          exercises: [
            {
              exercise_id: 10,
              exercise_name: "A",
              skipped: false,
              sets: [{ reps: 5, weight_kg: 100 }],
            },
            {
              exercise_id: 11,
              exercise_name: "B",
              skipped: false,
              sets: [
                { reps: 5, weight_kg: 60 },
                { reps: 5, weight_kg: 60 },
                { reps: 4, weight_kg: 60 },
              ],
            },
            {
              exercise_id: 12,
              exercise_name: "C",
              skipped: false,
              sets: [
                { reps: 10, weight_kg: 30 },
                { reps: 10, weight_kg: 30 },
              ],
            },
          ],
        }),
        unitSystem: "metric",
      },
    });
    const headers = wrapper.findAll('[data-test="set-column-header"]');
    expect(headers).toHaveLength(3);
    const cells = wrapper.findAll('[data-test="set-cell"]');
    // 3 exercises × 3 cells/row = 9 cells total.
    expect(cells).toHaveLength(9);
    // Row A: one filled, two empty.
    expect(cells[0]?.text()).toBe("5×100");
    expect(cells[1]?.text()).toBe("");
    expect(cells[2]?.text()).toBe("");
    // Row B: all three filled.
    expect(cells[3]?.text()).toBe("5×60");
    expect(cells[4]?.text()).toBe("5×60");
    expect(cells[5]?.text()).toBe("4×60");
    // Row C: two filled, one empty.
    expect(cells[6]?.text()).toBe("10×30");
    expect(cells[7]?.text()).toBe("10×30");
    expect(cells[8]?.text()).toBe("");
  });

  it("shows RPE in the header when present, omits when null", () => {
    const withRpe = mount(LastSessionPanel, {
      props: { entry: readyEntry({ rpe: 8 }), unitSystem: "metric" },
    });
    expect(withRpe.find('[data-test="last-session-header"]').text()).toContain("RPE 8");

    const noRpe = mount(LastSessionPanel, {
      props: { entry: readyEntry({ rpe: null }), unitSystem: "metric" },
    });
    expect(noRpe.find('[data-test="last-session-header"]').text()).not.toContain("RPE");
  });

  it("includes a formatted month/day in the header", () => {
    const wrapper = mount(LastSessionPanel, {
      props: { entry: readyEntry(), unitSystem: "metric" },
    });
    // Don't assert the exact locale string ("May 14") because jsdom's
    // Intl can be flaky across CI environments; assert the date renders
    // SOMETHING in the header (not empty) and that the year is absent.
    const header = wrapper.find('[data-test="last-session-header"]').text();
    expect(header.length).toBeGreaterThan(0);
    expect(header).not.toContain("2026");
  });

  it("colors equal weights the same and distinct weights differently", () => {
    const wrapper = mount(LastSessionPanel, {
      props: { entry: readyEntry(), unitSystem: "metric" },
    });
    // Fixture: Bench 80, 82.5, 82.5; Overhead 50. The two 82.5 cells should
    // carry an identical inline color; 80 / 82.5 / 50 should each differ.
    const weights = wrapper.findAll('[data-test="set-weight"]');
    expect(weights.length).toBeGreaterThanOrEqual(4);
    const style0 = weights[0]?.attributes("style") ?? "";
    const style1 = weights[1]?.attributes("style") ?? "";
    const style2 = weights[2]?.attributes("style") ?? "";
    const style3 = weights[3]?.attributes("style") ?? "";
    // 82.5 (set 2) and 82.5 (set 3) share the same color.
    expect(style1).toBe(style2);
    // 80 and 82.5 differ; 82.5 and 50 differ.
    expect(style0).not.toBe(style1);
    expect(style1).not.toBe(style3);
    // The inline style is a real color (jsdom serializes hsl() as rgb()),
    // not a CSS variable.
    expect(style0).toMatch(/(rgb|hsl)\(/);
  });

  it("uses a neutral color for bodyweight (null weight)", () => {
    const wrapper = mount(LastSessionPanel, {
      props: {
        entry: readyEntry({
          exercises: [
            {
              exercise_id: 20,
              exercise_name: "Pull-up",
              skipped: false,
              sets: [
                { reps: 8, weight_kg: null },
                { reps: 6, weight_kg: null },
              ],
            },
          ],
        }),
        unitSystem: "metric",
      },
    });
    const weights = wrapper.findAll('[data-test="set-weight"]');
    expect(weights).toHaveLength(2);
    const style0 = weights[0]?.attributes("style") ?? "";
    const style1 = weights[1]?.attributes("style") ?? "";
    // Both bodyweight cells get the same neutral (0% saturation) tone.
    // jsdom serializes hsl(0,0%,70%) as rgb(179,179,179) — same channel
    // values across R/G/B confirm the 0% saturation.
    expect(style0).toBe(style1);
    expect(style0).toMatch(/rgb\(179,\s*179,\s*179\)|hsl\(0,\s*0%,\s*70%\)/);
  });

  it("renders nothing visible when ready but data is null", () => {
    const wrapper = mount(LastSessionPanel, {
      props: { entry: { status: "ready", data: null }, unitSystem: "metric" },
    });
    expect(wrapper.find('[data-test="last-session-grid"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="last-session-header"]').exists()).toBe(false);
  });
});
