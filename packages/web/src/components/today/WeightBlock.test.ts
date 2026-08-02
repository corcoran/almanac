import { defined } from "@almanac/core/test-support";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { displayWeightToKg } from "../../lib/units.js";
import WeightBlock from "./WeightBlock.vue";

function makeTodayBody(
  overrides: Partial<{
    body_weight_kg: number | null;
    most_recent: { value_kg: number; on_date: string } | null;
  }> = {},
) {
  const o = {
    body_weight_kg: 82.4 as number | null,
    most_recent: { value_kg: 82.4, on_date: "2026-05-21" } as {
      value_kg: number;
      on_date: string;
    } | null,
    ...overrides,
  };
  return {
    kcal_in: 0,
    protein_g_in: 0,
    carb_g_in: 0,
    fat_g_in: 0,
    meals_logged_today: false,
    target: {
      kcal: 2200,
      protein_g: 180,
      carb_g: 200,
      fat_g: 70,
    },
    maintenance: { kcal: 2200 },
    intake: {
      kcal: 0,
      protein_g: 0,
      carb_g: 0,
      fat_g: 0,
    },
    observed: {
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
      vs_target: -2200,
      vs_maintenance: -2200,
      status: "off_track" as const,
    },
    body_weight_kg: o.body_weight_kg,
    most_recent_weight: o.most_recent,
    sleep: null,
    steps: null,
    workouts: [],
    cardio: [],
    alcohol: [],
    energy_balance: {
      food_in: 0,
      alcohol_in: 0,
      total_in: 0,
      tdee_baseline: 2200,
      cardio_out: 0,
      workout_out: 0,
      steps_out: 0,
      net: -2200,
    },
  };
}

const trend = {
  current_kg: 82.58,
  weight_change: {
    value_kg: -0.42,
    over_days: 14,
    confidence: "established" as const,
  },
};

function makeSeries(n: number) {
  const out: Array<{
    id: number;
    user_id: number;
    measured_on: string;
    weight_kg: number;
    notes: null;
    created_at: string;
  }> = [];
  for (let i = 0; i < n; i++) {
    const day = 9 + i; // 2026-05-09 onward
    const dateStr = `2026-05-${String(day).padStart(2, "0")}`;
    out.push({
      id: i + 1,
      user_id: 1,
      measured_on: dateStr,
      weight_kg: 83 - i * 0.05,
      notes: null,
      created_at: `${dateStr}T08:00:00Z`,
    });
  }
  return out;
}

function makeClient(
  overrides: Partial<{ post: (p: string, b: unknown) => Promise<unknown> }> = {},
) {
  return {
    post:
      overrides.post ??
      (async () => ({
        id: 1,
        user_id: 1,
        measured_on: "2026-06-14",
        weight_kg: 80,
        notes: null,
        created_at: "2026-06-14T12:00:00.000Z",
      })),
    get: async () => [],
    delete: async () => undefined,
  } as unknown as import("../../api/client.js").ApiClient;
}

const BASE_PROPS = () => ({
  todayBody: makeTodayBody(),
  trend: {
    current_kg: 82.1,
    weight_change: { value_kg: -0.4, over_days: 10, confidence: "established" as const },
  },
  series: [],
  unitSystem: "metric" as const,
  client: makeClient(),
  timezone: "UTC",
  date: "2026-06-14",
});

describe("WeightBlock", () => {
  it("renders today's weight in kg for metric users", () => {
    const wrapper = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody(),
        trend,
        series: makeSeries(14),
        unitSystem: "metric",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    expect(wrapper.text()).toContain("82.4");
    expect(wrapper.text()).toContain("kg");
  });

  it("renders today's weight converted to lb for imperial users", () => {
    const wrapper = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody(),
        trend,
        series: makeSeries(14),
        unitSystem: "imperial",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    // 82.4 kg * 2.20462262 = 181.66 → round1 → 181.7
    expect(wrapper.text()).toContain("181.7");
    expect(wrapper.text()).toContain("lb");
  });

  it("renders the EMA trend value and the 14d delta", () => {
    const wrapper = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody(),
        trend,
        series: makeSeries(14),
        unitSystem: "metric",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    // EMA: 82.58, delta: -0.42 kg → formatDelta uses toFixed(1) → "-0.4"
    expect(wrapper.text()).toContain("82.58");
    expect(wrapper.text()).toMatch(/-0\.4/);
    expect(wrapper.text()).not.toContain("-0.42");
    expect(wrapper.text()).toContain("14d");
    expect(wrapper.text()).toMatch(/EMA/i);
  });

  it("formats weight deltas to 1 decimal place (P9)", () => {
    // today=82.42, trend=82.0 → delta=+0.42 kg → toFixed(1) → "+0.4"
    const wrapper = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody({ body_weight_kg: 82.42 }),
        trend: { current_kg: 82.0, weight_change: null },
        series: makeSeries(2),
        unitSystem: "metric",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    // vsTrend = round2(82.42 - 82.0) = round2(0.42) = 0.42
    // formatDelta(0.42) = "+0.4" (verified: (0.42).toFixed(1) === "0.4")
    const deltaSpan = wrapper.find(".delta");
    expect(deltaSpan.exists()).toBe(true);
    expect(deltaSpan.text()).toContain("+0.4");
    expect(deltaSpan.text()).not.toContain("+0.42");
  });

  it("EMA label carries the tooltip title attribute (P8)", () => {
    const wrapper = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody(),
        trend,
        series: makeSeries(14),
        unitSystem: "metric",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    const emaLabel = wrapper.findAll(".label").find((el) => el.text().includes("EMA"));
    expect(emaLabel).toBeDefined();
    expect(emaLabel?.attributes("title")).toBe("10-day exponential moving average");
  });

  it("renders an SVG polyline when series has data", () => {
    const wrapper = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody(),
        trend,
        series: makeSeries(14),
        unitSystem: "metric",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    const poly = wrapper.find("polyline");
    expect(poly.exists()).toBe(true);
    const points = poly.attributes("points");
    expect(points).toBeTruthy();
    expect(defined(points, "points").length).toBeGreaterThan(0);
  });

  it("labels first/last/min/max sparkline points and respects unit system", () => {
    // Build a series where first/last/min/max are all distinct days so we
    // can confirm each contributes a label rather than collapsing to two.
    //  idx 0  → 82.0 (first)
    //  idx 3  → 83.5 (max)
    //  idx 7  → 80.5 (min)
    //  idx 13 → 81.2 (last)
    const weights = [
      82.0, 82.4, 82.8, 83.5, 83.0, 82.3, 81.5, 80.5, 80.9, 81.0, 81.1, 81.0, 81.05, 81.2,
    ];
    const series = weights.map((kg, i) => {
      const day = 9 + i;
      const dateStr = `2026-05-${String(day).padStart(2, "0")}`;
      return {
        id: i + 1,
        user_id: 1,
        measured_on: dateStr,
        weight_kg: kg,
        notes: null,
        created_at: `${dateStr}T08:00:00Z`,
      };
    });
    const metric = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody(),
        trend,
        series,
        unitSystem: "metric",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    // One circle marker per series point.
    expect(metric.findAll('[data-test="weight-point"]').length).toBe(14);

    // Exactly four labels (first, last, min, max are all distinct).
    const metricLabels = metric.findAll('[data-test="weight-point-label"]').map((l) => l.text());
    expect(metricLabels).toContain("82.0"); // first
    expect(metricLabels).toContain("83.5"); // max
    expect(metricLabels).toContain("80.5"); // min
    expect(metricLabels).toContain("81.2"); // last
    expect(metricLabels.length).toBe(4);

    // Imperial users see the same four points converted to lb.
    const imperial = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody(),
        trend,
        series,
        unitSystem: "imperial",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    const imperialLabels = imperial
      .findAll('[data-test="weight-point-label"]')
      .map((l) => l.text());
    // 82.0 kg → 180.779 → "180.8"
    // 83.5 kg → 184.086 → "184.1"
    // 80.5 kg → 177.472 → "177.5"
    // 81.2 kg → 179.015 → "179.0"
    expect(imperialLabels).toContain("180.8");
    expect(imperialLabels).toContain("184.1");
    expect(imperialLabels).toContain("177.5");
    expect(imperialLabels).toContain("179.0");
  });

  it("renders a 'no data' placeholder when series is empty", () => {
    const wrapper = mount(WeightBlock, {
      props: {
        todayBody: makeTodayBody({ body_weight_kg: null, most_recent: null }),
        trend: { current_kg: null, weight_change: null },
        series: [],
        unitSystem: "metric",
        client: makeClient(),
        timezone: "UTC",
        date: "2026-06-14",
      },
    });
    expect(wrapper.find("polyline").exists()).toBe(false);
    expect(wrapper.text()).toMatch(/no data|—/i);
  });
});

describe("WeightBlock inline edit", () => {
  it("shows the edit button in read-only mode", () => {
    const wrapper = mount(WeightBlock, { props: BASE_PROPS() });
    expect(wrapper.find('[data-test="block-edit"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="weight-edit-input"]').exists()).toBe(false);
  });

  it("clicking edit shows an input pre-filled with today's display weight", async () => {
    const wrapper = mount(WeightBlock, {
      props: { ...BASE_PROPS(), todayBody: makeTodayBody({ body_weight_kg: 82.4 }) },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    const input = wrapper.find('[data-test="weight-edit-input"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("82.4");
  });

  it("pre-fills empty when there is no weigh-in today", async () => {
    const wrapper = mount(WeightBlock, {
      props: {
        ...BASE_PROPS(),
        todayBody: makeTodayBody({ body_weight_kg: null, most_recent: null }),
      },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    expect(
      (wrapper.find('[data-test="weight-edit-input"]').element as HTMLInputElement).value,
    ).toBe("");
  });

  it("pre-fills from the most-recent weight when there's no weigh-in today", async () => {
    const wrapper = mount(WeightBlock, {
      props: {
        ...BASE_PROPS(),
        todayBody: makeTodayBody({
          body_weight_kg: null,
          most_recent: { value_kg: 81.7, on_date: "2026-06-13" },
        }),
      },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    expect(
      (wrapper.find('[data-test="weight-edit-input"]').element as HTMLInputElement).value,
    ).toBe("81.7");
  });

  it("disables Save when the input is empty, zero, or negative", async () => {
    const wrapper = mount(WeightBlock, { props: BASE_PROPS() });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    const input = wrapper.find('[data-test="weight-edit-input"]');
    const save = wrapper.find('[data-test="weight-edit-save"]');
    await input.setValue("");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("0");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("-5");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("81.2");
    expect((save.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("on save POSTs today's user-date weight in kg and returns to read-only", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = makeClient({
      post: async (path, body) => {
        calls.push({ path, body });
        return {
          id: 1,
          user_id: 1,
          measured_on: "2026-06-14",
          weight_kg: 81.2,
          notes: null,
          created_at: "x",
        };
      },
    });
    const wrapper = mount(WeightBlock, { props: { ...BASE_PROPS(), client, timezone: "UTC" } });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="weight-edit-input"]').setValue("81.2");
    await wrapper.find('[data-test="weight-edit-save"]').trigger("click");
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/body-weights");
    const body = calls[0]?.body as { measured_on: string; weight_kg: number };
    expect(body.weight_kg).toBeCloseTo(81.2, 5);
    expect(body.measured_on).toBe("2026-06-14");
    expect(wrapper.find('[data-test="weight-edit-input"]').exists()).toBe(false);
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("converts imperial input to kg on save", async () => {
    const calls: Array<{ body: unknown }> = [];
    const client = makeClient({
      post: async (_path, body) => {
        calls.push({ body });
        return {
          id: 1,
          user_id: 1,
          measured_on: "2026-06-14",
          weight_kg: 80,
          notes: null,
          created_at: "x",
        };
      },
    });
    const wrapper = mount(WeightBlock, {
      props: { ...BASE_PROPS(), unitSystem: "imperial", client },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="weight-edit-input"]').setValue("180");
    await wrapper.find('[data-test="weight-edit-save"]').trigger("click");
    await flushPromises();
    const body = calls[0]?.body as { weight_kg: number };
    expect(body.weight_kg).toBeCloseTo(displayWeightToKg(180, "imperial"), 6);
  });

  it("on save failure shows an inline error and stays in edit mode", async () => {
    const client = makeClient({
      post: async () => {
        throw new Error("Network down");
      },
    });
    const wrapper = mount(WeightBlock, { props: { ...BASE_PROPS(), client } });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="weight-edit-input"]').setValue("81.2");
    await wrapper.find('[data-test="weight-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="weight-edit-error"]').text()).toContain("Network down");
    expect(wrapper.find('[data-test="weight-edit-input"]').exists()).toBe(true);
    expect(wrapper.emitted("saved")).toBeUndefined();
  });

  it("cancel exits edit mode without saving", async () => {
    const wrapper = mount(WeightBlock, { props: BASE_PROPS() });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="weight-edit-cancel"]').trigger("click");
    expect(wrapper.find('[data-test="weight-edit-input"]').exists()).toBe(false);
  });

  it("posts the date it is GIVEN (not today) — proves the date seam", async () => {
    const calls: Array<{ body: unknown }> = [];
    const client = makeClient({
      post: async (_p, body) => {
        calls.push({ body });
        return {
          id: 1,
          user_id: 1,
          measured_on: "2026-03-02",
          weight_kg: 80,
          notes: null,
          created_at: "x",
        };
      },
    });
    const wrapper = mount(WeightBlock, { props: { ...BASE_PROPS(), client, date: "2026-03-02" } });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="weight-edit-input"]').setValue("81");
    await wrapper.find('[data-test="weight-edit-save"]').trigger("click");
    await flushPromises();
    expect((calls[0]?.body as { measured_on: string }).measured_on).toBe("2026-03-02");
  });
});
