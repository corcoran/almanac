import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useTodayStore } from "./today.js";

describe("useTodayStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useTodayStore();
    expect(store.status).toBe("idle");
    expect(store.data).toBeNull();
    expect(store.error).toBeNull();
  });

  it("transitions idle -> loading -> ready on success", async () => {
    const fixture = makeTodayFixture();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTodayStore();
    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data).not.toBeNull();
    expect(store.data?.phase?.name).toBe("Cut Q2 2026");
    expect(store.data?.today.kcal_in).toBe(1850);
  });

  it("transitions to error on http failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTodayStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });
});

describe("useTodayStore date param", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("requests /v1/signals/today with no date by default", async () => {
    const captured: { path?: string } = {};
    const store = useTodayStore();
    await store.load(makeClient(captured));
    expect(captured.path).toBe("/v1/signals/today");
  });

  it("requests /v1/signals/today?date= when a date is given", async () => {
    const captured: { path?: string } = {};
    const store = useTodayStore();
    await store.load(makeClient(captured), "2026-03-14");
    expect(captured.path).toBe("/v1/signals/today?date=2026-03-14");
  });

  it("reload passes the date parameter through", async () => {
    const captured: { path?: string } = {};
    const store = useTodayStore();
    await store.reload(makeClient(captured), "2026-03-14");
    expect(captured.path).toBe("/v1/signals/today?date=2026-03-14");
  });
});

// Helper to stub the ApiClient for path capture without needing full fixture setup
function makeClient(captured: { path?: string }) {
  return {
    get: async (path: string) => {
      captured.path = path;
      throw { kind: "network", cause: new Error("stub") };
    },
  } as unknown as ApiClient;
}

/**
 * Constructed from TodayContextResponseSchema, not captured from a live API.
 * Values are illustrative — they pass safeParse and are internally consistent
 * (e.g. days_with_data matches the value field's implied day count), but a
 * real API response would have realistic numeric magnitudes.
 */
function makeTodayFixture() {
  return {
    now: "2026-05-18T14:00:00Z",
    today_date: "2026-05-18",
    user: {
      id: 1,
      name: "Tester",
      timezone: "America/New_York",
      preferred_unit_system: "metric" as const,
      activity_level: null,
    },
    phase: {
      id: 1,
      user_id: 1,
      name: "Cut Q2 2026",
      intent: "cut" as const,
      phase_type: "cut" as const,
      tdee_at_phase_start: 2400,
      tdee_source: "measured" as const,
      deficit_kcal: 200,
      daily_kcal_target: 2200,
      base_protein_g: 180,
      base_carb_g: 200,
      base_fat_g: 70,
      started_on: "2026-04-01",
      planned_end_on: null,
      ended_on: null,
      notes: null,
      created_at: "2026-04-01T08:00:00Z",
      days_in: 47,
      days_remaining: null,
    },
    today: {
      kcal_in: 1850,
      protein_g_in: 170,
      carb_g_in: 180,
      fat_g_in: 65,
      meals_logged_today: true,
      target: {
        kcal: 2200,
        protein_g: 180,
        carb_g: 200,
        fat_g: 70,
      },
      maintenance: { kcal: 2400 },
      intake: {
        kcal: 1850,
        protein_g: 170,
        carb_g: 180,
        fat_g: 65,
      },
      observed: {
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
        vs_target: -350,
        vs_maintenance: -550,
        status: "on_track" as const,
      },
      body_weight_kg: 82.5,
      most_recent_weight: { value_kg: 82.5, on_date: "2026-05-18" },
      sleep: { hours: 7.5, quality: 4 },
      steps: null,
      workouts: [],
      cardio: [],
      alcohol: [],
      energy_balance: {
        food_in: 1850,
        alcohol_in: 0,
        total_in: 1850,
        tdee_baseline: 2400,
        cardio_out: 0,
        workout_out: 0,
        steps_out: 0,
        net: -550,
      },
    },
    week_to_date: {
      workouts_count: { value: 3, window_days: 7, days_with_data: 3 },
      cardio_sessions_count: { value: 1, window_days: 7, days_with_data: 1 },
      cardio_minutes: { value: 30, window_days: 7, days_with_data: 1 },
      cardio_kcal: { value: 250, window_days: 7, days_with_data: 1 },
      alcohol_drinks_count: { value: 0, window_days: 7, days_with_data: 0 },
      alcohol_kcal: { value: 0, window_days: 7, days_with_data: 0 },
      drinking_days_count: { value: 0, window_days: 7, days_with_data: 0 },
      avg_kcal_in: { value: 1900, window_days: 7, days_with_data: 7 },
      avg_protein_g: { value: 170, window_days: 7, days_with_data: 7 },
      sleep_avg_hours: { value: 7.4, window_days: 7, days_with_data: 7 },
      sleep_debt: {
        debt_hours: 1.2,
        window_days: 14,
        baseline_hours: 8,
        avg_hours: 7.4,
        nights_logged: 14,
      },
    },
    stim_states: [],
    tdee: {
      kcal: 2400,
      basis: "measured_intake" as const,
      confidence: "established" as const,
      source: "measured" as const,
      window_days: 14,
      days_of_data: 14,
      components: {
        avg_kcal_in: { value: 1950, window_days: 14, days_with_data: 14 },
        trend_weight_change_kg: -0.3,
      },
    },
    trend_weight: {
      current_kg: 82.6,
      as_of: "2026-06-21",
      weight_change: {
        value_kg: -0.4,
        over_days: 14,
        confidence: "established" as const,
      },
    },
    profile_complete: true,
    unexplained_gap: null,
    phase_adherence: null,
  };
}
