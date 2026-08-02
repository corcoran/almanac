import { at } from "@almanac/core/test-support";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SleepBlock from "./SleepBlock.vue";

const sleepDebt = {
  debt_hours: 4.2,
  window_days: 7,
  baseline_hours: 8,
  avg_hours: 7.4,
  nights_logged: 7,
};

// 7-day window matching makeNights(): Sat 2026-05-16 … Fri 2026-05-22.
const windowDates = Array.from(
  { length: 7 },
  (_, i) => `2026-05-${String(16 + i).padStart(2, "0")}`,
);

function makeNights() {
  // 7-night fixture, Sat 2026-05-16 through Fri 2026-05-22.
  // Hours: 6.2, 7.0, 7.0, 5.4, 9.0, 6.5, 6.667
  // 8h target → all but Wed (9.0) are short
  const hours = [6.2, 7.0, 7.0, 5.4, 9.0, 6.5, 6.667];
  return hours.map((h, i) => {
    const day = 16 + i;
    const sleptOn = `2026-05-${String(day).padStart(2, "0")}`;
    return {
      id: i + 1,
      user_id: 1,
      slept_on: sleptOn,
      hours: h,
      quality: null as number | null,
      notes: null,
      created_at: `${sleptOn}T08:00:00Z`,
    };
  });
}

function nightsWithTodayQuality(q: number | null) {
  const nights = makeNights();
  // today = windowDates[6] = "2026-05-22" → the last fixture night (index 6)
  const last = nights[6];
  if (last) last.quality = q;
  return nights;
}

function makeClient(
  overrides: Partial<{ post: (p: string, b: unknown) => Promise<unknown> }> = {},
) {
  return {
    post:
      overrides.post ??
      (async () => ({
        id: 99,
        user_id: 1,
        slept_on: "2026-05-22",
        hours: 7,
        quality: 4,
        notes: null,
        created_at: "2026-05-22T08:00:00Z",
      })),
    get: async () => [],
    delete: async () => undefined,
  } as unknown as import("../../api/client.js").ApiClient;
}

const SLEEP_BASE_PROPS = () => ({
  sleepDebt,
  nights: makeNights(),
  windowDates,
  client: makeClient(),
  date: "2026-05-22",
});

describe("SleepBlock", () => {
  it("renders last night's hours from the night dated today (Xh Ym)", () => {
    // Sleep is dated the wake-up day, so "last night" is the night dated
    // *today* = windowDates[6] = 2026-05-22, whose fixture night is 6.667h →
    // 6h 40m. (Not windowDates[5]=05-21, which is two nights ago.)
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    expect(wrapper.text()).toContain("6h 40m");
  });

  it("shows '— no log' when today has no logged night", () => {
    // Sparse fixture: only 2026-05-16 logged. Today (2026-05-22) is
    // unlogged, so the headline must read no-log — NOT borrow an older night.
    const sparseNights = [
      {
        id: 1,
        user_id: 1,
        slept_on: "2026-05-16",
        hours: 7,
        quality: null,
        notes: null,
        created_at: "2026-05-16T08:00:00Z",
      },
    ];
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: sparseNights,
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    expect(wrapper.text()).toMatch(/no log/i);
  });

  it("renders the 7-day sleep debt total", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    expect(wrapper.text()).toMatch(/4\.2/);
    expect(wrapper.text()).toContain("7d");
    expect(wrapper.text()).toMatch(/debt/i);
  });

  it("renders 7 bar elements", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    const bars = wrapper.findAll('[data-test="sleep-bar"]');
    expect(bars.length).toBe(7);
  });

  it("marks bars under 8h with the .short class", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    const bars = wrapper.findAll('[data-test="sleep-bar"]');
    // Of the seven nights, only Wed (9.0h, index 4) is NOT short
    const shortCount = bars.filter((b) => b.classes("short")).length;
    expect(shortCount).toBe(6);
    expect(at(bars, 4).classes("short")).toBe(false);
  });

  it("places the 8h reference line at the geometry-computed position", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    // observedMax = 9.0; referenceLinePct = (8/9)*100 = 88.888…%
    // Rendered as "bottom: 88.88…%" on the reference line.
    const ref = wrapper.find('[data-test="sleep-reference"]');
    expect(ref.exists()).toBe(true);
    const style = ref.attributes("style") ?? "";
    expect(style).toMatch(/bottom:\s*88\.8/);
  });

  it("renders the debt line in green when user is ahead (negative debt)", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt: {
          debt_hours: -2.5,
          window_days: 7,
          baseline_hours: 8,
          avg_hours: 8.4,
          nights_logged: 7,
        },
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    const delta = wrapper.find(".delta");
    expect(delta.text().toLowerCase()).toContain("ahead");
    expect(delta.classes()).toContain("dn");
    expect(delta.classes()).not.toContain("up");
  });

  it("renders the hour value inside each bar", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    const labels = wrapper.findAll('[data-test="sleep-bar-hours"]').map((el) => el.text());
    // Hours fixture: 6.2, 7.0, 7.0, 5.4, 9.0, 6.5, 6.667
    // formatHours drops trailing .0 (so 7.0 → "7", 9.0 → "9").
    expect(labels).toEqual(["6.2", "7", "7", "5.4", "9", "6.5", "6.7"]);
  });

  it("colors bars by hours: a 5.4h bar differs from a 9h bar", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    const bars = wrapper.findAll('[data-test="sleep-bar"]');
    // Index 3 is 5.4h (red-ish), index 4 is 9h (green-ish capped).
    const style3 = bars[3]?.attributes("style") ?? "";
    const style4 = bars[4]?.attributes("style") ?? "";
    // Both bars carry an inline background color from sleepColor().
    // jsdom serializes hsl() into rgb() — just confirm the two are
    // different colors (proves the gradient is wired up, not the
    // old binary "short/not-short" rule).
    const bg3 = /background-color:\s*([^;]+)/.exec(style3)?.[1]?.trim();
    const bg4 = /background-color:\s*([^;]+)/.exec(style4)?.[1]?.trim();
    expect(bg3).toBeTruthy();
    expect(bg4).toBeTruthy();
    expect(bg3).not.toBe(bg4);
  });

  it("colors two identical-hour bars the same", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    const bars = wrapper.findAll('[data-test="sleep-bar"]');
    // Index 1 and 2 are both 7.0h — same color.
    const style1 = bars[1]?.attributes("style") ?? "";
    const style2 = bars[2]?.attributes("style") ?? "";
    const bg1 = /background-color:\s*([^;]+)/.exec(style1)?.[1]?.trim();
    const bg2 = /background-color:\s*([^;]+)/.exec(style2)?.[1]?.trim();
    expect(bg1).toBeTruthy();
    expect(bg1).toBe(bg2);
  });

  it("renders a placeholder when nights is empty", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt: {
          debt_hours: 0,
          window_days: 7,
          baseline_hours: 8,
          avg_hours: 0,
          nights_logged: 0,
        },
        nights: [],
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    expect(wrapper.find(".sleep-bars").exists()).toBe(false);
    expect(wrapper.text()).toMatch(/no sleep logged/i);
  });

  it("renders ghost slots for unlogged days within the window", () => {
    const sparseNights = [
      {
        id: 1,
        user_id: 1,
        slept_on: "2026-05-16",
        hours: 7,
        quality: null,
        notes: null,
        created_at: "2026-05-16T08:00:00Z",
      },
      {
        id: 2,
        user_id: 1,
        slept_on: "2026-05-22",
        hours: 6,
        quality: null,
        notes: null,
        created_at: "2026-05-22T08:00:00Z",
      },
    ];
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: sparseNights,
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    expect(wrapper.findAll('[data-test="sleep-bar"]').length).toBe(2);
    expect(wrapper.findAll('[data-test="sleep-ghost"]').length).toBe(5);
  });

  it("ghost slots keep the weekday label and show no hours value", () => {
    const sparseNights = [
      {
        id: 1,
        user_id: 1,
        slept_on: "2026-05-16",
        hours: 7,
        quality: null,
        notes: null,
        created_at: "2026-05-16T08:00:00Z",
      },
    ];
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: sparseNights,
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    const ghosts = wrapper.findAll('[data-test="sleep-ghost"]');
    expect(ghosts.length).toBe(6);
    for (const g of ghosts) {
      expect(g.find(".lbl").exists()).toBe(true);
    }
    expect(ghosts.every((g) => g.find('[data-test="sleep-bar-hours"]').exists() === false)).toBe(
      true,
    );
  });

  it("renders 7 columns total (bars + ghosts) for a full window", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: makeNights(),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    const total =
      wrapper.findAll('[data-test="sleep-bar"]').length +
      wrapper.findAll('[data-test="sleep-ghost"]').length;
    expect(total).toBe(7);
  });

  it("shows the quality clause as N/5 when today's night has a quality", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: nightsWithTodayQuality(4),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    expect(wrapper.find('[data-test="sleep-quality"]').text()).toContain("4/5");
  });

  it("omits the quality clause when today's night quality is null", () => {
    const wrapper = mount(SleepBlock, {
      props: {
        sleepDebt,
        nights: nightsWithTodayQuality(null),
        windowDates,
        client: makeClient(),
        date: "2026-05-22",
      },
    });
    expect(wrapper.find('[data-test="sleep-quality"]').exists()).toBe(false);
  });

  it("labels the rows 'Last night' when viewing today (default / isPastDay omitted)", () => {
    const wrapper = mount(SleepBlock, { props: SLEEP_BASE_PROPS() });
    expect(wrapper.find(".stat-row .label").text()).toBe("Last night");
  });

  it("labels the display + edit rows with the short night date when viewing a past day", async () => {
    const wrapper = mount(SleepBlock, {
      props: { ...SLEEP_BASE_PROPS(), date: "2026-05-16", isPastDay: true },
    });
    // Display-row label is date-aware (locale-robust: assert the parts).
    const displayLabel = wrapper.find(".stat-row .label").text();
    expect(displayLabel).not.toBe("Last night");
    expect(displayLabel).toContain("Sat");
    expect(displayLabel).toContain("May");
    expect(displayLabel).toContain("16");
    // Edit-row label too.
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    const editLabel = wrapper.find(".edit-row .label").text();
    expect(editLabel).toContain("Sat");
    expect(editLabel).toContain("May");
    expect(editLabel).toContain("16");
  });

  it("keeps 'Last night' when isPastDay is explicitly false", () => {
    const wrapper = mount(SleepBlock, {
      props: { ...SLEEP_BASE_PROPS(), isPastDay: false },
    });
    expect(wrapper.find(".stat-row .label").text()).toBe("Last night");
  });
});

describe("SleepBlock inline edit", () => {
  it("shows the edit button in read-only mode", () => {
    const wrapper = mount(SleepBlock, { props: SLEEP_BASE_PROPS() });
    expect(wrapper.find('[data-test="block-edit"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="sleep-hours-input"]').exists()).toBe(false);
  });

  it("clicking edit shows the hours input pre-filled and the quality picker pre-set", async () => {
    const wrapper = mount(SleepBlock, {
      props: { ...SLEEP_BASE_PROPS(), nights: nightsWithTodayQuality(4) },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    const input = wrapper.find('[data-test="sleep-hours-input"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("6.667");
    const pressed = wrapper
      .findAll('[data-test="quality-option"]')
      .filter((b) => b.attributes("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.text()).toBe("4");
  });

  it("pre-fills hours empty when the active day has no night", async () => {
    const nights = makeNights().filter((n) => n.slept_on !== "2026-05-22");
    const wrapper = mount(SleepBlock, { props: { ...SLEEP_BASE_PROPS(), nights } });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    expect(
      (wrapper.find('[data-test="sleep-hours-input"]').element as HTMLInputElement).value,
    ).toBe("");
  });

  it("disables Save when hours is empty, zero, or negative (quality irrelevant)", async () => {
    const wrapper = mount(SleepBlock, { props: SLEEP_BASE_PROPS() });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    const input = wrapper.find('[data-test="sleep-hours-input"]');
    const save = wrapper.find('[data-test="sleep-save"]');
    await input.setValue("");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("0");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("-1");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("7.5");
    expect((save.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("on save POSTs slept_on=date prop with hours + quality, emits saved, returns to read-only", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = makeClient({
      post: async (path, body) => {
        calls.push({ path, body });
        return {
          id: 1,
          user_id: 1,
          slept_on: "2026-05-22",
          hours: 7.5,
          quality: 5,
          notes: null,
          created_at: "x",
        };
      },
    });
    const wrapper = mount(SleepBlock, {
      props: { ...SLEEP_BASE_PROPS(), client, date: "2026-05-22" },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="sleep-hours-input"]').setValue("7.5");
    await wrapper.findAll('[data-test="quality-option"]')[4]?.trigger("click");
    await wrapper.find('[data-test="sleep-save"]').trigger("click");
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/sleep-logs");
    const body = calls[0]?.body as { slept_on: string; hours: number; quality: number | null };
    expect(body.slept_on).toBe("2026-05-22");
    expect(body.hours).toBeCloseTo(7.5, 5);
    expect(body.quality).toBe(5);
    expect(wrapper.find('[data-test="sleep-hours-input"]').exists()).toBe(false);
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("posts quality: null when the rating is cleared", async () => {
    const calls: Array<{ body: unknown }> = [];
    const client = makeClient({
      post: async (_p, body) => {
        calls.push({ body });
        return {
          id: 1,
          user_id: 1,
          slept_on: "2026-05-22",
          hours: 7,
          quality: null,
          notes: null,
          created_at: "x",
        };
      },
    });
    const wrapper = mount(SleepBlock, {
      props: { ...SLEEP_BASE_PROPS(), client, nights: nightsWithTodayQuality(3) },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    const three = wrapper.findAll('[data-test="quality-option"]')[2];
    await three?.trigger("click");
    await wrapper.find('[data-test="sleep-save"]').trigger("click");
    await flushPromises();
    expect((calls[0]?.body as { quality: number | null }).quality).toBeNull();
  });

  it("on save failure shows an inline error and stays in edit mode", async () => {
    const client = makeClient({
      post: async () => {
        throw new Error("Network down");
      },
    });
    const wrapper = mount(SleepBlock, { props: { ...SLEEP_BASE_PROPS(), client } });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="sleep-hours-input"]').setValue("7");
    await wrapper.find('[data-test="sleep-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="sleep-edit-error"]').text()).toContain("Network down");
    expect(wrapper.find('[data-test="sleep-hours-input"]').exists()).toBe(true);
    expect(wrapper.emitted("saved")).toBeUndefined();
  });

  it("cancel exits edit mode without saving", async () => {
    const wrapper = mount(SleepBlock, { props: SLEEP_BASE_PROPS() });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="sleep-cancel"]').trigger("click");
    expect(wrapper.find('[data-test="sleep-hours-input"]').exists()).toBe(false);
  });

  it("posts the date it is GIVEN (not today) — proves the date seam", async () => {
    const calls: Array<{ body: unknown }> = [];
    const client = makeClient({
      post: async (_p, body) => {
        calls.push({ body });
        return {
          id: 1,
          user_id: 1,
          slept_on: "2026-05-21",
          hours: 6.5,
          quality: null,
          notes: null,
          created_at: "x",
        };
      },
    });
    // date prop = 2026-05-21 (NOT the last window date 2026-05-22)
    const wrapper = mount(SleepBlock, {
      props: { ...SLEEP_BASE_PROPS(), client, date: "2026-05-21" },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    // pre-fill should be the 2026-05-21 night's hours (6.5), proving edit resolves via props.date
    expect(
      (wrapper.find('[data-test="sleep-hours-input"]').element as HTMLInputElement).value,
    ).toBe("6.5");
    await wrapper.find('[data-test="sleep-save"]').trigger("click");
    await flushPromises();
    expect((calls[0]?.body as { slept_on: string }).slept_on).toBe("2026-05-21");
  });
});
