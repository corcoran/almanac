import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiClient } from "../../api/client.js";
import { useTodayStore } from "../../stores/today.js";
import TodayPane from "./TodayPane.vue";

// TodayPane requires a `client` prop only to forward to MonthCalendar.
// Neither error nor loading branches render the calendar, so a dummy
// cast is enough for the idle/error tests below.
const dummyClient = {} as ApiClient;

const WINDOW_DATES = [
  "2026-05-28",
  "2026-05-29",
  "2026-05-30",
  "2026-05-31",
  "2026-06-01",
  "2026-06-02",
  "2026-06-03",
];

const STUBS = [
  "PhaseHeader",
  "RemainingToday",
  "MealsList",
  "MovementBlock",
  "MacrosWeekGrid",
  "WeightBlock",
  "SleepBlock",
  "MonthCalendar",
];

describe("TodayPane", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows loading message when todayStore is idle", () => {
    const wrapper = mount(TodayPane, {
      props: {
        client: dummyClient,
        windowDates: WINDOW_DATES,
        selectedDate: "2026-06-03",
      },
      global: {
        stubs: STUBS,
      },
    });
    expect(wrapper.text()).toContain("Loading");
  });

  it("shows error message when todayStore is in error state", () => {
    const store = useTodayStore();
    // Manually mutate the store to error state.
    store.status = "error";
    store.error = { kind: "network", cause: new Error("offline") };
    const wrapper = mount(TodayPane, {
      props: {
        client: dummyClient,
        windowDates: WINDOW_DATES,
        selectedDate: "2026-06-03",
      },
      global: {
        stubs: STUBS,
      },
    });
    expect(wrapper.text()).toMatch(/couldn't load/i);
    expect(wrapper.text()).not.toContain("Loading");
  });

  it("re-emits MonthCalendar's select as select-date", async () => {
    const store = useTodayStore();
    // Seed store to "ready" with a minimal fixture so the dashboard branch
    // (and MonthCalendar) render. All children are stubbed so only the fields
    // accessed directly in TodayPane's script need to be present.
    store.status = "ready";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.data = {
      now: "2026-06-03T14:00:00Z",
      today_date: "2026-06-03",
      user: {
        id: 1,
        name: "Test",
        timezone: "UTC",
        preferred_unit_system: "metric",
        activity_level: null,
      },
      phase: null,
      today: {
        kcal_in: 0,
        protein_g_in: 0,
        carb_g_in: 0,
        fat_g_in: 0,
        meals_logged_today: false,
        target: null,
        maintenance: null,
        intake: { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
        observed: null,
        body_weight_kg: null,
        most_recent_weight: null,
        sleep: null,
        steps: null,
        workouts: [],
        cardio: [],
        alcohol: [],
        energy_balance: {
          food_in: 0,
          alcohol_in: 0,
          total_in: 0,
          tdee_baseline: 0,
          cardio_out: 0,
          workout_out: 0,
          steps_out: 0,
          net: 0,
        },
      },
      week_to_date: {
        workouts_count: { value: 0, window_days: 7, days_with_data: 0 },
        cardio_sessions_count: { value: 0, window_days: 7, days_with_data: 0 },
        cardio_minutes: { value: 0, window_days: 7, days_with_data: 0 },
        cardio_kcal: { value: 0, window_days: 7, days_with_data: 0 },
        alcohol_drinks_count: { value: 0, window_days: 7, days_with_data: 0 },
        alcohol_kcal: { value: 0, window_days: 7, days_with_data: 0 },
        drinking_days_count: { value: 0, window_days: 7, days_with_data: 0 },
        avg_kcal_in: { value: 0, window_days: 7, days_with_data: 0 },
        avg_protein_g: { value: 0, window_days: 7, days_with_data: 0 },
        sleep_avg_hours: { value: 0, window_days: 7, days_with_data: 0 },
        sleep_debt: {
          debt_hours: 0,
          nights_logged: 0,
          baseline_hours: 8,
        },
      },
      stim_states: [],
      tdee: {
        value: 2000,
        basis: "profile_baseline",
        components: {
          avg_kcal_in: { value: 0, window_days: 0, days_with_data: 0 },
          avg_net_kcal: { value: 0, window_days: 0, days_with_data: 0 },
          avg_weight_change_kcal_per_day: 0,
          measurement_days: 0,
        },
      },
      trend_weight: { current_kg: null, weight_change: null },
      profile_complete: true,
      unexplained_gap: null,
      phase_adherence: null,
      accomplishments: [],
      // biome-ignore lint/suspicious/noExplicitAny: minimal test fixture — TypeScript-checked children are stubbed
    } as any;

    const wrapper = mount(TodayPane, {
      props: {
        client: dummyClient,
        windowDates: WINDOW_DATES,
        selectedDate: "2026-06-03",
      },
      global: {
        stubs: STUBS,
      },
    });

    const cal = wrapper.findComponent({ name: "MonthCalendar" });
    if (cal.exists()) {
      await cal.vm.$emit("select", "2026-06-10");
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("select-date")?.[0]).toEqual(["2026-06-10"]);
    } else {
      throw new Error("MonthCalendar stub not found — cannot test re-emit");
    }
  });

  // (Skip the "ready" test — exercising it requires constructing a full
  // TodayContext fixture which is overkill for this composition shell.
  // The child component tests cover the ready branch.)
});
