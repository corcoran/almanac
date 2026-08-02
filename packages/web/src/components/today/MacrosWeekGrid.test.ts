import { at } from "@almanac/core/test-support";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MacrosWeekGrid from "./MacrosWeekGrid.vue";

// Post-tgt/maint-drop fixture shape — matches DayMacrosResponseSchema:
//   { date, day_totals, day_target: DailyTargetResponseSchema | null }
// `day_target` is the structured target/maintenance/intake/observed snapshot
// from packages/core/src/schemas/signals.ts. `day_target: null` represents a
// day with no active nutrition phase (a phase-less day's intake still renders,
// but activity rows and net collapse to em-dashes, and the per-row avg
// excludes them so it doesn't get diluted by cold-start days).
//
// The grid renders 8 rows now (kcal, P, C, F, cardio, workout, steps, net)
// plus a trailing "avg" column. The previous tgt/maint rows were phase
// constants — they rendered as flat horizontal lines and added no signal
// per-day. The avg column replaces that visual real-estate with the actual
// weekly trend, which is the unit of truth for a cut.

type DayTotals = {
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  kcal_from_food: number;
  kcal_from_alcohol: number;
};

type Observed = {
  cardio_kcal: number;
  workout_kcal: number;
  steps_kcal: number;
  vs_target: number;
  vs_maintenance: number;
  status: "on_track" | "at_risk" | "off_track";
};

type Macros = { kcal: number; protein_g: number; carb_g: number; fat_g: number };

type DayMacros = {
  date: string;
  untracked: boolean;
  day_totals: DayTotals;
  day_target: {
    target: Macros;
    maintenance: { kcal: number };
    intake: Macros;
    observed: Observed;
  } | null;
  net_kcal: number | null;
};

/**
 * Build a phase-day fixture. Defaults model a typical cut day at the
 * 1900-kcal anchor: maintenance 2370, observed.status driven by intake.
 * Override any field as needed.
 */
function makeDay(
  date: string,
  totals: { kcal: number; protein_g: number; carb_g: number; fat_g: number },
  overrides: Partial<{
    target_kcal: number;
    maintenance_kcal: number;
    cardio_kcal: number;
    workout_kcal: number;
    steps_kcal: number;
    status: Observed["status"];
    // Top-level snapshotted net: intake − TDEE (deficit negative). When set,
    // overrides the default null. Used to test the new net_kcal field path.
    net_kcal: number | null;
    // For testing the null branch: returns day_target: null when true.
    no_phase: boolean;
    // Marks the day as an untracked (vacation/sick/deload) day.
    untracked: boolean;
  }> = {},
): DayMacros {
  const day_totals: DayTotals = {
    ...totals,
    kcal_from_food: totals.kcal,
    kcal_from_alcohol: 0,
  };
  if (overrides.no_phase) {
    return {
      date,
      untracked: overrides.untracked ?? false,
      day_totals,
      day_target: null,
      net_kcal: overrides.net_kcal !== undefined ? overrides.net_kcal : null,
    };
  }
  const target_kcal = overrides.target_kcal ?? 1900;
  const maintenance_kcal = overrides.maintenance_kcal ?? 2370;
  const cardio_kcal = overrides.cardio_kcal ?? 0;
  const workout_kcal = overrides.workout_kcal ?? 0;
  const steps_kcal = overrides.steps_kcal ?? 0;
  const status = overrides.status ?? "on_track";
  return {
    date,
    untracked: overrides.untracked ?? false,
    day_totals,
    day_target: {
      target: { kcal: target_kcal, protein_g: 180, carb_g: 200, fat_g: 70 },
      maintenance: { kcal: maintenance_kcal },
      intake: {
        kcal: totals.kcal,
        protein_g: totals.protein_g,
        carb_g: totals.carb_g,
        fat_g: totals.fat_g,
      },
      observed: {
        cardio_kcal,
        workout_kcal,
        steps_kcal,
        vs_target: totals.kcal - target_kcal,
        vs_maintenance: totals.kcal - maintenance_kcal,
        status,
      },
    },
    net_kcal: overrides.net_kcal !== undefined ? overrides.net_kcal : null,
  };
}

// Standard 7-day cut fixture, Sat 2026-05-16 through Fri 2026-05-22. Every
// day is inside the same phase (target 1900, maintenance 2370). Different
// days carry different cardio/workout values so the cardio/workout rows have
// visible variance; the avg column should reflect those variances correctly.
const fixtureDays: DayMacros[] = [
  makeDay("2026-05-16", { kcal: 1880, protein_g: 178, carb_g: 198, fat_g: 68 }),
  makeDay(
    "2026-05-17",
    { kcal: 2050, protein_g: 182, carb_g: 220, fat_g: 72 },
    { cardio_kcal: 280, status: "at_risk" },
  ),
  makeDay("2026-05-18", { kcal: 1920, protein_g: 185, carb_g: 205, fat_g: 70 }),
  makeDay(
    "2026-05-19",
    { kcal: 1850, protein_g: 178, carb_g: 195, fat_g: 68 },
    { workout_kcal: 350 },
  ),
  makeDay("2026-05-20", { kcal: 1890, protein_g: 180, carb_g: 198, fat_g: 66 }),
  makeDay(
    "2026-05-21",
    { kcal: 2500, protein_g: 190, carb_g: 240, fat_g: 90 },
    { status: "off_track" },
  ),
  makeDay("2026-05-22", { kcal: 1730, protein_g: 168, carb_g: 178, fat_g: 60 }),
];

// 8 rows × 7 day columns: kcal, P, C, F, cardio, workout, steps, net.
// tgt and maint rows were dropped — they were phase constants already shown
// in the header and rendered as flat lines with no per-day signal.
const ROW_COUNT = 8;
const KCAL_ROW = 0;
const CARDIO_ROW = 4;
const WORKOUT_ROW = 5;
const STEPS_ROW = 6;
const NET_ROW = 7;

function cellsAt(wrapper: ReturnType<typeof mount>, row: number, cols: number) {
  const all = wrapper.findAll('[data-test="macros-cell"]');
  return Array.from({ length: cols }, (_, i) => at(all, row * cols + i));
}

function avgCellsAll(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-test="macros-cell-avg"]');
}

describe("MacrosWeekGrid", () => {
  it("renders 8 rows × 7 day columns of day cells (tgt/maint dropped)", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const cells = wrapper.findAll('[data-test="macros-cell"]');
    expect(cells.length).toBe(ROW_COUNT * 7);
  });

  it("renders 8 avg cells — one per row", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    expect(avgCellsAll(wrapper).length).toBe(ROW_COUNT);
  });

  it("renders a '6d avg' column header — the '6d' signals today is excluded", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const avgHead = wrapper.find('[data-test="macros-head-avg"]');
    expect(avgHead.exists()).toBe(true);
    expect(avgHead.text()).toBe("6d avg");
  });

  it("today (rightmost DAY column) is highlighted across all rows — avg cells excluded", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const todayCells = wrapper.findAll('[data-test="macros-cell"].today');
    // 8 today highlights — one per row — and none of them are avg cells.
    expect(todayCells.length).toBe(ROW_COUNT);
    expect(at(todayCells, 0).text()).toBe("1730");
    // Avg cells must NOT carry the today highlight: avg is a 7-day summary,
    // not a per-day reading.
    const todayAvgs = wrapper.findAll('[data-test="macros-cell-avg"].today');
    expect(todayAvgs.length).toBe(0);
  });

  it("derives day-of-week headers from each day's date", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const headers = wrapper.findAll('[data-test="macros-head"]');
    // 7 weekday headers (avg-head has its own data-test attribute).
    expect(headers.length).toBe(7);
    expect(at(headers, 0).text()).toBe("Sa");
    expect(at(headers, 1).text()).toBe("Su");
    expect(at(headers, 2).text()).toBe("Mo");
    expect(at(headers, 6).text()).toBe("Fr");
  });

  it("each row label is colored with the matching hue", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const labels = wrapper.findAll('[data-test="macros-rowlbl"]');
    expect(labels.length).toBe(ROW_COUNT);
    expect(at(labels, 0).attributes("style")).toContain("var(--m-kcal)");
    expect(at(labels, 1).attributes("style")).toContain("var(--m-protein)");
    expect(at(labels, 2).attributes("style")).toContain("var(--m-carb)");
    expect(at(labels, 3).attributes("style")).toContain("var(--m-fat)");
    expect(at(labels, CARDIO_ROW).attributes("style")).toContain("var(--warn");
    expect(at(labels, WORKOUT_ROW).attributes("style")).toContain("var(--accent");
    expect(at(labels, STEPS_ROW).attributes("style")).toContain("var(--ok");
    expect(at(labels, NET_ROW).attributes("style")).toContain("var(--ink-dim");
  });

  it("does NOT render tgt or maint row labels", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const labels = wrapper.findAll('[data-test="macros-rowlbl"]');
    const labelTexts = labels.map((l) => l.text());
    expect(labelTexts).not.toContain("tgt");
    expect(labelTexts).not.toContain("maint");
  });

  it("renders day_totals.kcal in the kcal row for every day", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const kcalCells = cellsAt(wrapper, KCAL_ROW, 7);
    expect(kcalCells.map((c) => c.text())).toEqual([
      "1880",
      "2050",
      "1920",
      "1850",
      "1890",
      "2500",
      "1730",
    ]);
  });

  it("renders P/C/F intake from day_totals", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const text = wrapper.text();
    expect(text).toContain("178");
    expect(text).toContain("198");
    expect(text).toContain("68");
    expect(text).toContain("168");
    expect(text).toContain("178");
    expect(text).toContain("60");
  });

  it("reads cardio_kcal and workout_kcal from day_target.observed (post-refactor source)", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const cardioCells = cellsAt(wrapper, CARDIO_ROW, 7);
    expect(at(cardioCells, 1).text()).toBe("280");
    expect(at(cardioCells, 3).text()).toBe("0");
    const workoutCells = cellsAt(wrapper, WORKOUT_ROW, 7);
    expect(at(workoutCells, 1).text()).toBe("0");
    expect(at(workoutCells, 3).text()).toBe("350");
  });

  it("renders a steps row sourced from day_target.observed.steps_kcal", () => {
    const days = [
      makeDay(
        "2026-05-20",
        { kcal: 1800, protein_g: 180, carb_g: 200, fat_g: 70 },
        { steps_kcal: 320 },
      ),
      makeDay("2026-05-21", { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }, { no_phase: true }),
      makeDay(
        "2026-05-22",
        { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 70 },
        { steps_kcal: 410 },
      ),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const stepsCells = cellsAt(wrapper, STEPS_ROW, 3);
    expect(at(stepsCells, 0).text()).toBe("320");
    expect(at(stepsCells, 1).text()).toBe("—");
    expect(at(stepsCells, 2).text()).toBe("410");
  });

  it("net row reads net_kcal directly (no sign flip): deficit negative, surplus positive", () => {
    // net_kcal = intake − TDEE. Deficit days are negative, surplus days positive.
    // The net row reads net_kcal as-is (no sign flip).
    const days = [
      makeDay(
        "2026-05-20",
        { kcal: 1500, protein_g: 180, carb_g: 200, fat_g: 70 },
        { net_kcal: -470 },
      ),
      makeDay(
        "2026-05-21",
        { kcal: 2800, protein_g: 200, carb_g: 280, fat_g: 100 },
        { net_kcal: 430 },
      ),
      makeDay(
        "2026-05-22",
        { kcal: 2370, protein_g: 180, carb_g: 220, fat_g: 75 },
        { net_kcal: null },
      ),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const netCells = cellsAt(wrapper, NET_ROW, 3);
    // -470 renders as "-470" (no extra negation).
    expect(at(netCells, 0).text()).toBe("-470");
    // 430 renders as "430" (surplus shows positive).
    expect(at(netCells, 1).text()).toBe("430");
    // null net_kcal renders as em-dash.
    expect(at(netCells, 2).text()).toBe("—");
  });

  it("net row is phase-independent: renders net_kcal even when day_target is null", () => {
    // NEW behavior: net_kcal is top-level, not nested under day_target.observed.
    // A day with day_target: null but net_kcal: 30 should show "30", not "—".
    const days = [
      makeDay(
        "2026-05-20",
        { kcal: 2400, protein_g: 180, carb_g: 200, fat_g: 70 },
        { no_phase: true, net_kcal: 30 },
      ),
      makeDay(
        "2026-05-21",
        { kcal: 1800, protein_g: 160, carb_g: 190, fat_g: 65 },
        { net_kcal: -200 },
      ),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const netCells = cellsAt(wrapper, NET_ROW, 2);
    // day_target is null but net_kcal: 30 — must render "30", not "—".
    expect(at(netCells, 0).text()).toBe("30");
    // Normal phase day with net_kcal: -200 — renders "-200".
    expect(at(netCells, 1).text()).toBe("-200");
  });

  it("kcal cell carries the status-* class for each observed.status", () => {
    const days = [
      makeDay(
        "2026-05-20",
        { kcal: 1800, protein_g: 180, carb_g: 200, fat_g: 70 },
        { status: "on_track" },
      ),
      makeDay(
        "2026-05-21",
        { kcal: 2200, protein_g: 180, carb_g: 200, fat_g: 70 },
        { status: "at_risk" },
      ),
      makeDay(
        "2026-05-22",
        { kcal: 2800, protein_g: 180, carb_g: 200, fat_g: 70 },
        { status: "off_track" },
      ),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const kcalCells = cellsAt(wrapper, KCAL_ROW, 3);
    expect(at(kcalCells, 0).classes()).toContain("status-on_track");
    expect(at(kcalCells, 1).classes()).toContain("status-at_risk");
    expect(at(kcalCells, 2).classes()).toContain("status-off_track");
    expect(at(kcalCells, 2).classes()).toContain("today");
  });

  it("does not apply status-* classes to non-kcal rows", () => {
    const days = [
      makeDay(
        "2026-05-22",
        { kcal: 2800, protein_g: 180, carb_g: 200, fat_g: 70 },
        { status: "off_track" },
      ),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const cells = wrapper.findAll('[data-test="macros-cell"]');
    // 8 rows × 1 col = 8 cells. The kcal cell (row 0) carries the status; all
    // other rows must NOT carry any status-* class.
    for (const row of [1, 2, 3, CARDIO_ROW, WORKOUT_ROW, STEPS_ROW, NET_ROW]) {
      const cls = at(cells, row).classes();
      expect(cls).not.toContain("status-on_track");
      expect(cls).not.toContain("status-at_risk");
      expect(cls).not.toContain("status-off_track");
    }
    expect(at(cells, KCAL_ROW).classes()).toContain("status-off_track");
  });

  it("renders em-dash for activity rows and net on days with day_target: null", () => {
    // Mix two phase days with a phase-less day; the no-phase column should
    // collapse activity rows and net to em-dash. Surrounding phase columns
    // are untouched.
    const days = [
      makeDay("2026-05-20", { kcal: 1800, protein_g: 180, carb_g: 200, fat_g: 70 }),
      makeDay("2026-05-21", { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }, { no_phase: true }),
      makeDay("2026-05-22", { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 70 }),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const cardio = cellsAt(wrapper, CARDIO_ROW, 3);
    const workout = cellsAt(wrapper, WORKOUT_ROW, 3);
    const steps = cellsAt(wrapper, STEPS_ROW, 3);
    const net = cellsAt(wrapper, NET_ROW, 3);
    const kcal = cellsAt(wrapper, KCAL_ROW, 3);

    expect(at(cardio, 1).text()).toBe("—");
    expect(at(workout, 1).text()).toBe("—");
    expect(at(steps, 1).text()).toBe("—");
    expect(at(net, 1).text()).toBe("—");
    // kcal still shows day_totals (always present, even no-phase).
    expect(at(kcal, 1).text()).toBe("0");
    const kcalCls = at(kcal, 1).classes();
    expect(kcalCls).not.toContain("status-on_track");
    expect(kcalCls).not.toContain("status-at_risk");
    expect(kcalCls).not.toContain("status-off_track");
  });

  // ---------------------------------------------------------------------------
  // Avg column tests — the headline new behavior. Each row gets one cell
  // showing the trailing "6d avg" of its values. Two rules apply:
  //   (1) Today (rightmost column) is EXCLUDED — it's a WIP reading and would
  //       drag the average toward partial numbers.
  //   (2) For activity/net rows: no-phase days are SKIPPED (matches
  //       `get-macros-range.ts:rolling_7d_avg_kcal_in`).
  // ---------------------------------------------------------------------------

  it("avg cell for kcal row excludes today (rightmost column) — prior days only", () => {
    // Three days: [1800, 1900, 2000]. Today is the last → excluded from avg.
    // Avg of [1800, 1900] = 1850.
    const days = [
      makeDay("2026-05-20", { kcal: 1800, protein_g: 0, carb_g: 0, fat_g: 0 }),
      makeDay("2026-05-21", { kcal: 1900, protein_g: 0, carb_g: 0, fat_g: 0 }),
      makeDay("2026-05-22", { kcal: 2000, protein_g: 0, carb_g: 0, fat_g: 0 }),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const avgs = avgCellsAll(wrapper);
    expect(at(avgs, KCAL_ROW).text()).toBe("1850");
  });

  it("avg cell for activity rows skips no-phase days AND today", () => {
    // cardio source array: [100, null (no_phase), 200]. Drop today → [100, null].
    // Skip-null mean → 100. (If today were included, [100, null, 200] → 150.)
    const days = [
      makeDay(
        "2026-05-20",
        { kcal: 1800, protein_g: 0, carb_g: 0, fat_g: 0 },
        { cardio_kcal: 100 },
      ),
      makeDay("2026-05-21", { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }, { no_phase: true }),
      makeDay(
        "2026-05-22",
        { kcal: 1800, protein_g: 0, carb_g: 0, fat_g: 0 },
        { cardio_kcal: 200 },
      ),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const avgs = avgCellsAll(wrapper);
    expect(at(avgs, CARDIO_ROW).text()).toBe("100");
  });

  it("avg cell for net row uses net_kcal directly (no flip) and excludes today and null days", () => {
    // net_kcal values, oldest→today: [-600, null (no net_kcal), 200, 0 (today)].
    // Drop today (0) → [-600, null, 200]. Skip-null mean of [-600, 200] = -200.
    const days = [
      makeDay("2026-05-19", { kcal: 1500, protein_g: 0, carb_g: 0, fat_g: 0 }, { net_kcal: -600 }),
      makeDay("2026-05-20", { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }, { no_phase: true }),
      makeDay("2026-05-21", { kcal: 2570, protein_g: 0, carb_g: 0, fat_g: 0 }, { net_kcal: 200 }),
      makeDay("2026-05-22", { kcal: 2370, protein_g: 0, carb_g: 0, fat_g: 0 }, { net_kcal: 0 }),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const avgs = avgCellsAll(wrapper);
    expect(at(avgs, NET_ROW).text()).toBe("-200");
  });

  it("avg cell renders em-dash when only one day is provided (today alone)", () => {
    // Single-day input: today is the only entry. After dropping today, the
    // average has nothing to average → em-dash everywhere.
    const days = [
      makeDay(
        "2026-05-22",
        { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 70 },
        { cardio_kcal: 100, workout_kcal: 200, steps_kcal: 300 },
      ),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const avgs = avgCellsAll(wrapper);
    for (const avg of avgs) {
      expect(avg.text()).toBe("—");
    }
  });

  it("net-row avg cell carries the cell-avg-net class for emphasis", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: fixtureDays } });
    const avgs = avgCellsAll(wrapper);
    expect(at(avgs, NET_ROW).classes()).toContain("cell-avg-net");
    // Other rows must NOT carry that emphasis class — only net is the headline.
    for (const row of [KCAL_ROW, 1, 2, 3, CARDIO_ROW, WORKOUT_ROW, STEPS_ROW]) {
      expect(at(avgs, row).classes()).not.toContain("cell-avg-net");
    }
  });

  it("avg cells carry no status tint and no today highlight regardless of day data", () => {
    const days = [
      makeDay(
        "2026-05-20",
        { kcal: 2800, protein_g: 180, carb_g: 200, fat_g: 70 },
        { status: "off_track" },
      ),
      makeDay(
        "2026-05-21",
        { kcal: 2800, protein_g: 180, carb_g: 200, fat_g: 70 },
        { status: "off_track" },
      ),
      makeDay(
        "2026-05-22",
        { kcal: 2800, protein_g: 180, carb_g: 200, fat_g: 70 },
        { status: "off_track" },
      ),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    for (const avg of avgCellsAll(wrapper)) {
      const cls = avg.classes();
      expect(cls).not.toContain("status-on_track");
      expect(cls).not.toContain("status-at_risk");
      expect(cls).not.toContain("status-off_track");
      expect(cls).not.toContain("today");
    }
  });

  it("avg cell shows em-dash when every entry was skipped (all no-phase days)", () => {
    // All three days are phase-less → activity rows have nothing to average.
    // The intake (kcal/P/C/F) rows still have day_totals data, so they show
    // an avg of 0 (or whatever). The activity + net rows show em-dash.
    const days = [
      makeDay("2026-05-20", { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }, { no_phase: true }),
      makeDay("2026-05-21", { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }, { no_phase: true }),
      makeDay("2026-05-22", { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 }, { no_phase: true }),
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    const avgs = avgCellsAll(wrapper);
    expect(at(avgs, CARDIO_ROW).text()).toBe("—");
    expect(at(avgs, WORKOUT_ROW).text()).toBe("—");
    expect(at(avgs, STEPS_ROW).text()).toBe("—");
    expect(at(avgs, NET_ROW).text()).toBe("—");
    // Intake rows still average from day_totals — three zeros → 0.
    expect(at(avgs, KCAL_ROW).text()).toBe("0");
  });

  it("excludes an untracked (vacation) day from the row averages", () => {
    // 7 days; last day = today (grid always drops today from avgs).
    // days[0,1,3,4,5] tracked kcal 2000; days[2] untracked vacation kcal 200; days[6] today.
    const days = [
      makeDay("2026-05-15", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-16", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay(
        "2026-05-17",
        { kcal: 200, protein_g: 10, carb_g: 30, fat_g: 5 },
        { untracked: true },
      ),
      makeDay("2026-05-18", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-19", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-20", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-21", { kcal: 1500, protein_g: 120, carb_g: 150, fat_g: 50 }), // today
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    // The kcal avg is over days[0,1,3,4,5] = five 2000s (day2 untracked excluded,
    // day6 today dropped) → 2000, NOT a value dragged down by the 200.
    const avgs = avgCellsAll(wrapper);
    expect(at(avgs, KCAL_ROW).text()).toBe("2000");
    // The untracked day's CELL still renders 200 — cells are never hidden.
    const kcalCells = cellsAt(wrapper, KCAL_ROW, 7);
    expect(at(kcalCells, 2).text()).toBe("200");
  });

  it("drops today before filtering untracked (untracked today does not drop an extra day)", () => {
    // days[0..4] tracked kcal 2000; days[5] tracked kcal 1000; days[6] = today, untracked: true.
    const days = [
      makeDay("2026-05-15", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-16", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-17", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-18", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-19", { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 }),
      makeDay("2026-05-20", { kcal: 1000, protein_g: 100, carb_g: 120, fat_g: 40 }),
      makeDay(
        "2026-05-21",
        { kcal: 9999, protein_g: 200, carb_g: 250, fat_g: 90 },
        { untracked: true },
      ), // today, untracked
    ];
    const wrapper = mount(MacrosWeekGrid, { props: { days } });
    // Correct: drop today (day6) positionally first → [d0..d5], none untracked among
    // them → avg = (5*2000 + 1000)/6 = 1833.33 → "1833.3".
    // The ordering BUG (filter untracked first) would remove day6, then slice(0,-1)
    // drops day5=1000, yielding 2000 — so this assertion catches the bug.
    const avgs = avgCellsAll(wrapper);
    expect(at(avgs, KCAL_ROW).text()).toBe("1833.3");
  });

  it("renders a loading placeholder when days is empty", () => {
    const wrapper = mount(MacrosWeekGrid, { props: { days: [] } });
    expect(wrapper.find('[data-test="macros-cell"]').exists()).toBe(false);
    expect(wrapper.text()).toMatch(/loading|—|no data/i);
  });
});
