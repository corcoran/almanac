import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../api/client.js";
import { CALENDAR_MODE_KEY } from "../../lib/calendar-mode.js";
import { useCalendarStore } from "../../stores/calendar.js";
import { useIntakeCalendarStore } from "../../stores/intake-calendar.js";
import MonthCalendar from "./MonthCalendar.vue";

const TODAY = "2026-06-10";

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function workoutFixture(month: string) {
  return {
    month,
    tally: { total: 2, by_template: { "PUSH A": 2 } },
    past_sessions: [
      { date: `${month}-04`, workout_id: 1, template_id: 10, template_name: "PUSH A" },
      { date: `${month}-08`, workout_id: 2, template_id: 10, template_name: "PUSH A" },
    ],
    pill_segments: [],
    untracked_bands: [],
  };
}

function intakeDay(date: string, kcal: number) {
  return {
    date,
    day_totals: {
      kcal,
      protein_g: 150,
      carb_g: 180,
      fat_g: 60,
      kcal_from_food: kcal,
      kcal_from_alcohol: 0,
    },
    day_target:
      kcal > 0
        ? {
            target: { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 70 },
            maintenance: { kcal: 2370 },
            intake: { kcal, protein_g: 150, carb_g: 180, fat_g: 60 },
            observed: {
              cardio_kcal: 0,
              workout_kcal: 0,
              steps_kcal: 0,
              vs_target: kcal - 1900,
              vs_maintenance: kcal - 2370,
              status: "on_track" as const,
            },
          }
        : null,
    net_kcal: null,
    untracked: false,
  };
}

/** fetchImpl serving both endpoints; records hit URLs for assertions. */
function makeFetch(urls: string[]) {
  return vi.fn((input: URL | RequestInfo) => {
    const url = typeof input === "string" ? input : input.toString();
    urls.push(url);
    const calMatch = url.match(/\/v1\/calendar\?month=(\d{4}-\d{2})$/);
    if (calMatch?.[1]) {
      return Promise.resolve(jsonOk(workoutFixture(calMatch[1])));
    }
    if (/\/v1\/signals\/macros\?from_date=2026-06-01&to_date=2026-06-10$/.test(url)) {
      return Promise.resolve(jsonOk({ days: [intakeDay("2026-06-01", 1914)] }));
    }
    if (/\/v1\/signals\/macros\?from_date=/.test(url)) {
      return Promise.resolve(jsonOk({ days: [] }));
    }
    if (/\/v1\/untracked-periods$/.test(url)) {
      return Promise.resolve(jsonOk([]));
    }
    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

function mountCal(urls: string[]) {
  const client = new ApiClient({ baseUrl: "/api", fetchImpl: makeFetch(urls) });
  return mount(MonthCalendar, { props: { client, today: TODAY, selectedDate: TODAY } });
}

function mountCalWithDate(urls: string[], selectedDate: string) {
  const client = new ApiClient({ baseUrl: "/api", fetchImpl: makeFetch(urls) });
  return mount(MonthCalendar, { props: { client, today: TODAY, selectedDate } });
}

describe("MonthCalendar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("defaults to workout mode: fetches /v1/calendar and renders the workout grid", async () => {
    const urls: string[] = [];
    const wrapper = mountCal(urls);
    await flushPromises();
    expect(urls.some((u) => u.includes("/v1/calendar?month=2026-06"))).toBe(true);
    expect(urls.some((u) => u.includes("/v1/signals/macros"))).toBe(false);
    expect(wrapper.find('[data-test="calendar-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="intake-grid"]').exists()).toBe(false);
  });

  it("switches to intake mode on toggle: fetches macros range, renders intake grid, persists", async () => {
    const urls: string[] = [];
    const wrapper = mountCal(urls);
    await flushPromises();

    await wrapper.get('[data-test="mode-intake"]').trigger("click");
    await flushPromises();

    expect(urls.some((u) => u.includes("from_date=2026-06-01&to_date=2026-06-10"))).toBe(true);
    expect(wrapper.find('[data-test="intake-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="calendar-grid"]').exists()).toBe(false);
    expect(localStorage.getItem(CALENDAR_MODE_KEY)).toBe("intake");
  });

  it("shows the intake summary in the header once data is ready", async () => {
    const urls: string[] = [];
    const wrapper = mountCal(urls);
    await flushPromises();
    await wrapper.get('[data-test="mode-intake"]').trigger("click");
    await flushPromises();

    const summary = wrapper.get('[data-test="intake-summary"]');
    expect(summary.text()).toContain("1 logged");
  });

  it("mounts directly into intake mode when persisted", async () => {
    localStorage.setItem(CALENDAR_MODE_KEY, "intake");
    const urls: string[] = [];
    const wrapper = mountCal(urls);
    await flushPromises();
    expect(wrapper.find('[data-test="intake-grid"]').exists()).toBe(true);
    expect(urls.some((u) => u.includes("/v1/calendar?month="))).toBe(false);
  });

  it("renders Mark vacation inside the intake legend row (not its own footer row)", async () => {
    localStorage.setItem(CALENDAR_MODE_KEY, "intake");
    const urls: string[] = [];
    const wrapper = mountCal(urls);
    await flushPromises();
    // Button lives in the legend row's slot; the standalone footer row is gone.
    const btn = wrapper.find('[data-test="open-time-off"]');
    expect(btn.exists()).toBe(true);
    expect(btn.element.closest(".legend-row")).not.toBeNull();
    expect(wrapper.find(".mark-time-off-row").exists()).toBe(false);
    // Still opens the modal.
    await btn.trigger("click");
    expect(wrapper.find('[data-test="time-off-modal"]').exists()).toBe(true);
  });

  it("fetches the navigated month in intake mode without touching /v1/calendar", async () => {
    localStorage.setItem(CALENDAR_MODE_KEY, "intake");
    const urls: string[] = [];
    const wrapper = mountCal(urls);
    await flushPromises();

    await wrapper.get('[data-test="cal-prev"]').trigger("click");
    await flushPromises();

    expect(urls.some((u) => u.includes("from_date=2026-05-01&to_date=2026-05-31"))).toBe(true);
    expect(urls.some((u) => u.includes("/v1/calendar?month="))).toBe(false);
  });

  it("shows the error paragraph when the intake fetch fails", async () => {
    localStorage.setItem(CALENDAR_MODE_KEY, "intake");
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const wrapper = mount(MonthCalendar, { props: { client, today: TODAY, selectedDate: TODAY } });
    await flushPromises();
    expect(wrapper.find('[data-test="cal-error"]').exists()).toBe(true);
  });

  it("re-emits select from the grid", async () => {
    const urls: string[] = [];
    const wrapper = mountCalWithDate(urls, "2026-06-15");
    await flushPromises();
    // Try clicking a real cell; fall back to emitting directly on the child component.
    const cell = wrapper.find('[data-date="2026-06-10"]');
    if (cell.exists()) {
      await cell.trigger("click");
      expect(wrapper.emitted("select")?.[0]).toEqual(["2026-06-10"]);
    } else {
      const grid = wrapper.findComponent({ name: "CalendarGrid" });
      grid.vm.$emit("select", "2026-06-10");
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("select")?.[0]).toEqual(["2026-06-10"]);
    }
  });

  it("auto-follows the selectedDate's month", async () => {
    const urls: string[] = [];
    const wrapper = mountCalWithDate(urls, "2026-06-15");
    await flushPromises();
    // Before: header title should show June (not April).
    const titleBefore = wrapper.get('[data-test="cal-head"] .title').text();
    expect(titleBefore).toMatch(/June|Jun/i);
    // Change selectedDate to April; the watch should update currentMonth.
    await wrapper.setProps({ selectedDate: "2026-04-03" });
    await wrapper.vm.$nextTick();
    const titleAfter = wrapper.get('[data-test="cal-head"] .title').text();
    expect(titleAfter).toMatch(/April|Apr/i);
  });

  it("falls back to today's month when selectedDate is the empty boot value", async () => {
    // Regression: App sets selectedDate to today only AFTER the today-context
    // loads, so the dashboard's first render passes selectedDate="". An empty
    // "".slice(0,7) month string makes TallyHeader format an Invalid Date and
    // throw, blanking the whole dashboard. The calendar must fall back to
    // `today` and never render an empty month.
    const urls: string[] = [];
    const wrapper = mountCalWithDate(urls, "");
    await flushPromises();
    const title = wrapper.get('[data-test="cal-head"] .title').text();
    expect(title).toMatch(/June|Jun/i); // TODAY = 2026-06-10
    expect(title.trim()).not.toBe("");
    // And once selectedDate resolves to today, it stays valid.
    await wrapper.setProps({ selectedDate: TODAY });
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="cal-head"] .title').text()).toMatch(/June|Jun/i);
  });

  it("opens the time-off modal when Mark vacation is clicked", async () => {
    const urls: string[] = [];
    const wrapper = mountCal(urls);
    await flushPromises();
    expect(wrapper.find('[data-test="time-off-modal"]').exists()).toBe(false);
    await wrapper.find('[data-test="open-time-off"]').trigger("click");
    expect(wrapper.find('[data-test="time-off-modal"]').exists()).toBe(true);
  });

  it("reloads both calendar stores when the modal reports a change", async () => {
    const urls: string[] = [];
    const wrapper = mountCal(urls);
    await flushPromises();
    const calStore = useCalendarStore();
    const intakeStore = useIntakeCalendarStore();
    const calSpy = vi.spyOn(calStore, "reloadForMonth").mockResolvedValue();
    const intakeSpy = vi.spyOn(intakeStore, "reloadForMonth").mockResolvedValue();

    await wrapper.find('[data-test="open-time-off"]').trigger("click");
    wrapper.findComponent({ name: "TimeOffModal" }).vm.$emit("changed");
    await flushPromises();

    const month = TODAY.slice(0, 7);
    expect(calSpy).toHaveBeenCalledWith(expect.anything(), month);
    expect(intakeSpy).toHaveBeenCalledWith(expect.anything(), month, TODAY);
  });
});
